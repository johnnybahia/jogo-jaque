import * as THREE from "three";
import type { Rig } from "./rig";

// Camada de pose por cima de qualquer clipe (mocap, vídeo, Mixamo), aplicada depois do mixer: dá vida e naturalidade sem mexer nos pés.
//  · cabeça acompanha a bola (pescoço 40% + cabeça 60%, limitada em relação ao peito e suavizada);
//  · respiração do tronco: lenta e curta com fôlego, rápida e funda cansada; cansada também curva o tronco e baixa a cabeça;
//  · inclinação do tronco nas arrancadas e frenagens (para a frente/para o lado onde acelera).
// Rotações são feitas em eixos do MUNDO (o personagem olha para +z, esquerda = +x), então não dependem dos eixos locais de cada osso.
const V = THREE.Vector3, Q = THREE.Quaternion, D2R = Math.PI / 180;
const clamp = THREE.MathUtils.clamp, smooth = (a: number, b: number, x: number): number => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));
const SQUAT_MAX = 0.12;   // quanto o quadril pode descer abaixo da parada (unidades do jogo; o personagem tem ~1,45)

export interface FxIn { dt: number; time: number; ball: THREE.Vector3 | null; vx: number; vz: number; stamina: number; swingW: number; react?: number; rt?: number; }   // react: 0 nada, 1 suspiro (errou cedo), 2 comemoração; rt: s desde o fim do ponto

export class PoseFX {
  enabled = true;
  private b: Record<string, THREE.Bone | null> = {};
  private ax: Record<string, { l: THREE.Vector3; u: THREE.Vector3; f: THREE.Vector3 }> = {};   // esquerda, cima e frente DO PERSONAGEM no referencial local de cada osso (pose de referência)
  private gazeW = 0; private yaw = 0; private pitch = 0;          // olhar suavizado: peso e ângulos do mundo (rad)
  private leanF = 0; private leanS = 0; private pvx = 0; private pvz = 0; private aF = 0; private aS = 0;
  private root: THREE.Object3D; private standY = 0;   // standY: altura do quadril na parada (referência para limitar o agachamento)
  private tmpQ = new Q(); private tmpQ2 = new Q(); private tmpV = new V(); private tmpV2 = new V(); private tmpV3 = new V(); private ident = new Q();

  constructor(rig: Rig, private dir = 1) {   // dir = −1: personagem virada para −z (adversária); os eixos laterais/frontais do mundo invertem
    this.root = rig.root; this.yaw = dir === 1 ? 0 : Math.PI;   // o olhar começa para a frente do personagem
    const find = (re: RegExp): THREE.Bone | null => { let f: THREE.Bone | null = null; rig.model.traverse((o) => { if (!f && (o as THREE.Bone).isBone && re.test(o.name)) f = o as THREE.Bone; }); return f; };
    for (const k of ["Hips", "Spine", "Spine1", "Spine2", "Neck", "Head", "LeftArm", "RightArm", "LeftForeArm", "RightForeArm", "LeftHand", "RightHand", "LeftUpLeg", "RightUpLeg", "LeftLeg", "RightLeg", "LeftFoot", "RightFoot"]) this.b[k] = find(new RegExp(`${k}$`));
    // eixos de referência medidos na pose de repouso do esqueleto (todos os pesos em 0 = pose original, de pé e olhando para a frente do personagem). Antes eram
    // medidos na pose que sobrava da medição da locomoção (uma corrida no meio do passo): a cabeça mirava um eixo errado e ficava torta.
    const saved = [...rig.actions].map(([, a]) => [a, a.getEffectiveWeight(), a.time] as const);
    for (const [, a] of rig.actions) a.setEffectiveWeight(0);
    rig.mixer.update(0); rig.root.updateMatrixWorld(true);
    const rq = rig.root.getWorldQuaternion(new Q()).invert();
    for (const k of ["Spine2", "Neck", "Head"]) {
      const bone = this.b[k]; if (!bone) continue;
      const inv = rq.clone().multiply(bone.getWorldQuaternion(new Q())).invert();   // personagem → osso
      this.ax[k] = { l: new V(1, 0, 0).applyQuaternion(inv), u: new V(0, 1, 0).applyQuaternion(inv), f: new V(0, 0, 1).applyQuaternion(inv) };
    }
    // altura do quadril na parada (clipe idle)
    const idle = rig.actions.get("idle"), hips = this.b.Hips;
    if (idle && hips) { idle.setEffectiveWeight(1); idle.time = 0.5; rig.mixer.update(0); rig.root.updateMatrixWorld(true); this.standY = hips.getWorldPosition(new V()).y - rig.root.getWorldPosition(new V()).y; idle.setEffectiveWeight(0); }
    for (const [a, w, t] of saved) { a.setEffectiveWeight(w); a.time = t; }
  }

  /** aplica a rotação r (em eixos do mundo, em torno da junta) ao osso: local' = (pai⁻¹ · r · pai) · local */
  private rot(bone: THREE.Bone | null, r: THREE.Quaternion): void {
    if (!bone || !bone.parent) return;
    bone.parent.getWorldQuaternion(this.tmpQ); this.tmpQ2.copy(this.tmpQ).invert().multiply(r).multiply(this.tmpQ);
    bone.quaternion.premultiply(this.tmpQ2); bone.updateMatrixWorld(true);
  }
  private axisRot(ax: number, ay: number, az: number, ang: number): THREE.Quaternion { return new Q().setFromAxisAngle(this.tmpV3.set(ax * this.dir, ay, az * this.dir), ang); }
  private fwdOf(key: string, out: THREE.Vector3): THREE.Vector3 { const bone = this.b[key], a = this.ax[key]; return out.copy(a ? a.f : this.tmpV3.set(0, 0, 1)).applyQuaternion(bone!.getWorldQuaternion(this.tmpQ)); }

  /** limita o agachamento: o quadril dos clipes do vídeo chega a descer 0,2 m (sentada na areia). Se descer mais que maxDrop abaixo da parada, o quadril sobe e as duas pernas
   *  esticam por IK para os pés ficarem onde estavam (plantados), com o joelho dobrando para o mesmo lado e o pé na mesma orientação */
  private squat(maxDrop: number): void {
    const hips = this.b.Hips; if (!hips || !hips.parent || this.standY <= 0) return;
    hips.updateWorldMatrix(true, false);
    const hy = hips.getWorldPosition(new V()).y - this.root.getWorldPosition(new V()).y, lift = this.standY - maxDrop - hy;
    if (lift < 0.004) return;
    const legs = (["Left", "Right"] as const).map((sd) => {
      const up = this.b[`${sd}UpLeg`], kn = this.b[`${sd}Leg`], ft = this.b[`${sd}Foot`]; if (!up || !kn || !ft) return null;
      const H = up.getWorldPosition(new V()), K = kn.getWorldPosition(new V()), A = ft.getWorldPosition(new V()), u = A.clone().sub(H).normalize();
      return { up, kn, ft, A, Qf: ft.getWorldQuaternion(new Q()), pole: K.clone().sub(H).addScaledVector(u, -K.clone().sub(H).dot(u)).normalize() };
    });
    const w = hips.getWorldPosition(new V()); w.y += lift; hips.position.copy(hips.parent.worldToLocal(w)); hips.updateMatrixWorld(true);
    for (const l of legs) {
      if (!l) continue;
      const H = l.up.getWorldPosition(new V()), K0 = l.kn.getWorldPosition(new V()), A0 = l.ft.getWorldPosition(new V()), L1 = H.distanceTo(K0), L2 = K0.distanceTo(A0);
      const toA = l.A.clone().sub(H), d0 = toA.length(); if (d0 < 1e-5) continue;
      const u = toA.divideScalar(d0), d = clamp(d0, Math.abs(L1 - L2) + 1e-3, L1 + L2 - 1e-3);
      const p = l.pole.clone().addScaledVector(u, -l.pole.dot(u)); if (p.lengthSq() < 1e-6) continue; p.normalize();
      const a = (L1 * L1 - L2 * L2 + d * d) / (2 * d), h = Math.sqrt(Math.max(0, L1 * L1 - a * a));
      const Kt = H.clone().addScaledVector(u, a).addScaledVector(p, h);
      this.rot(l.up, new Q().setFromUnitVectors(K0.clone().sub(H).normalize(), Kt.clone().sub(H).normalize()));
      const K1 = l.kn.getWorldPosition(new V()), A1 = l.ft.getWorldPosition(new V()), At = H.clone().addScaledVector(u, d);
      this.rot(l.kn, new Q().setFromUnitVectors(A1.sub(K1).normalize(), At.sub(K1).normalize()));
      l.ft.parent!.getWorldQuaternion(this.tmpQ); l.ft.quaternion.copy(this.tmpQ.invert().multiply(l.Qf)); l.ft.updateMatrixWorld(true);
    }
  }

  /** gira o osso (peso w) para a frente dele apontar na direção f do mundo, com a cabeça NIVELADA (cima do osso = cima do mundo): olha sem inclinar de lado */
  private look(key: "Neck" | "Head", w: number, f: THREE.Vector3): void {
    const bone = this.b[key], a = this.ax[key]; if (!bone || !bone.parent || !a || w <= 0.001) return;
    const uT = new V(0, 1, 0).addScaledVector(f, -f.y); if (uT.lengthSq() < 1e-4) return; uT.normalize();   // cima do mundo, tirando a parte ao longo de f
    const lT = new V().crossVectors(uT, f);                                                                     // esquerda = cima × frente
    const M = new THREE.Matrix4().makeBasis(lT, uT, f).multiply(new THREE.Matrix4().makeBasis(a.l, a.u, a.f).transpose());   // osso → mundo
    const qT = new Q().setFromRotationMatrix(M), cur = bone.getWorldQuaternion(new Q()), parent = bone.parent.getWorldQuaternion(new Q());
    bone.quaternion.copy(parent.invert().multiply(cur.slerp(qT, w))); bone.updateMatrixWorld(true);
  }

  update(i: FxIn): void {
    this.root.position.y = 0;   // só a comemoração tira os pés do chão (recalculado a cada quadro)
    if (!this.enabled) return;
    this.squat(SQUAT_MAX);
    const { dt } = i, k = (tau: number) => 1 - Math.exp(-dt / tau);
    const tired = 1 - smooth(0.12, 0.65, i.stamina), free = 1 - i.swingW;          // free: fora dos golpes (nos golpes o clipe manda no tronco)
    // aceleração (m/s²) a partir da velocidade, suavizada
    const ax = dt > 1e-4 ? (i.vx - this.pvx) / dt : 0, az = dt > 1e-4 ? (i.vz - this.pvz) / dt : 0; this.pvx = i.vx; this.pvz = i.vz;
    this.aF += (clamp(az, -14, 14) - this.aF) * k(0.12); this.aS += (clamp(ax, -14, 14) - this.aS) * k(0.12);
    this.leanF += (clamp(this.aF * 0.55, -7, 9) * D2R - this.leanF) * k(0.18); this.leanS += (clamp(this.aS * 0.4, -5, 5) * D2R - this.leanS) * k(0.18);
    // tronco: inclinação por aceleração + curva de cansaço + respiração (x do mundo = lateral; + gira o tronco para a frente)
    const breathHz = 0.35 + 0.6 * tired, breath = Math.sin(i.time * Math.PI * 2 * breathHz) * (0.45 + 1.9 * tired) * D2R;
    const slump = tired * 7 * D2R * free;   // nos golpes o tronco fica exatamente como no clipe (o contato com a bola depende dele)
    this.rot(this.b.Spine, this.axisRot(1, 0, 0, (this.leanF * 0.5 + slump * 0.4) * free));
    this.rot(this.b.Spine, this.axisRot(0, 0, 1, -this.leanS * 0.5 * free));
    this.rot(this.b.Spine1, this.axisRot(1, 0, 0, this.leanF * 0.3 * free + slump * 0.3 + breath * 0.5 * free));
    this.rot(this.b.Spine2, this.axisRot(1, 0, 0, this.leanF * 0.2 * free + slump * 0.3 + breath * 0.5 * free));
    // olhar: acompanha a bola quando ela existe; senão volta ao que o clipe faz
    const head = this.b.Head, neck = this.b.Neck, chest = this.b.Spine2; if (!head || !neck || !chest) return;
    const wTarget = i.ball ? 0.9 : 0; this.gazeW += (wTarget - this.gazeW) * k(0.25);
    if (i.ball) {
      head.getWorldPosition(this.tmpV); const d = this.tmpV2.copy(i.ball).sub(this.tmpV);
      if (d.lengthSq() > 0.04) {
        const wy = Math.atan2(d.x, d.z), wp = Math.atan2(d.y, Math.hypot(d.x, d.z));
        this.fwdOf("Spine2", this.tmpV); const cy = Math.atan2(this.tmpV.x, this.tmpV.z);
        const ty = cy + clamp(wrap(wy - cy), -70 * D2R, 70 * D2R), tp = clamp(wp, -35 * D2R, 40 * D2R);
        this.yaw += wrap(ty - this.yaw) * k(0.10); this.pitch += (tp - this.pitch) * k(0.10);
      }
    }
    if (this.gazeW > 0.01) {
      // direção do olhar (yaw/pitch do mundo, suavizados) → pescoço (parte) e cabeça (o resto) viram para ela, de cabeça nivelada
      const f = this.tmpV.set(Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), Math.cos(this.yaw) * Math.cos(this.pitch));
      this.look("Neck", 0.4 * this.gazeW, f.clone()); this.look("Head", this.gazeW, f.clone());
    }
    if (tired > 0.01) this.rot(neck, this.axisRot(1, 0, 0, tired * 3 * D2R * free));   // cansada: cabeça um pouco caída
    this.react(i.react ?? 0, i.rt ?? 0, neck, head);
  }

  /** estica o cotovelo: gira o antebraço em torno do cotovelo até apontar na direção do braço (amount 0..1) */
  private straighten(arm: THREE.Bone | null, fore: THREE.Bone | null, hand: THREE.Bone | null, amount: number): void {
    if (!arm || !fore || !hand || amount <= 0.001) return;
    const A = arm.getWorldPosition(new V()), B = fore.getWorldPosition(new V()), C = hand.getWorldPosition(new V());
    const u = B.clone().sub(A).normalize(), v = C.clone().sub(B).normalize();
    this.rot(fore, new Q().setFromUnitVectors(v, u).slerp(this.ident, 1 - amount));
  }

  /** reações de fim de ponto, por cima do clipe parado: suspiro (cabeça balança, ombros caem) e comemoração (pulinhos, punho esquerdo para cima, peito aberto) */
  private react(kind: number, rt: number, neck: THREE.Bone, head: THREE.Bone): void {
    if (kind === 1) {
      const env = smooth(0, 0.18, rt) * (1 - smooth(1.0, 1.6, rt));
      if (env <= 0.001) return;
      this.rot(this.b.Spine1, this.axisRot(1, 0, 0, 9 * D2R * env)); this.rot(this.b.Spine2, this.axisRot(1, 0, 0, 6 * D2R * env));
      this.rot(neck, this.axisRot(1, 0, 0, 10 * D2R * env));
      this.rot(head, this.axisRot(0, 1, 0, Math.sin(rt * Math.PI * 2 * 1.6) * 26 * D2R * env));                 // "não acredito": balança a cabeça
    } else if (kind === 2) {
      const env = smooth(0, 0.2, rt) * (1 - smooth(1.8, 2.3, rt));
      if (env <= 0.001) return;
      const hop = Math.abs(Math.sin(rt * Math.PI * 1.3)) * 0.17 * smooth(0.1, 0.3, rt) * (1 - smooth(1.6, 2.0, rt));   // pulinhos
      this.root.position.y = hop;
      const up = (145 + 10 * Math.sin(rt * Math.PI * 2 * 2.2)) * D2R * env;                                       // braço esquerdo para cima, "socando" o ar
      this.rot(this.b.LeftArm, this.axisRot(0, 0, 1, up)); this.straighten(this.b.LeftArm, this.b.LeftForeArm, this.b.LeftHand, 0.92 * env);   // esticado (na parada o cotovelo fica dobrado)
      this.rot(this.b.Spine1, this.axisRot(1, 0, 0, -7 * D2R * env)); this.rot(this.b.Spine2, this.axisRot(1, 0, 0, -5 * D2R * env));
      this.rot(neck, this.axisRot(1, 0, 0, -12 * D2R * env));
    }
  }
}
