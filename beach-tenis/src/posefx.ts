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

export interface FxIn { dt: number; time: number; ball: THREE.Vector3 | null; vx: number; vz: number; stamina: number; swingW: number; }

export class PoseFX {
  enabled = true;
  private b: Record<string, THREE.Bone | null> = {};
  private fwdLocal: Record<string, THREE.Vector3> = {};         // "frente" no referencial local do osso (do repouso, olhando +z)
  private gazeW = 0; private yaw = 0; private pitch = 0;          // olhar suavizado: peso e ângulos do mundo (rad)
  private leanF = 0; private leanS = 0; private pvx = 0; private pvz = 0; private aF = 0; private aS = 0;
  private tmpQ = new Q(); private tmpQ2 = new Q(); private tmpV = new V(); private tmpV2 = new V(); private tmpV3 = new V(); private ident = new Q();

  constructor(rig: Rig) {
    const find = (re: RegExp): THREE.Bone | null => { let f: THREE.Bone | null = null; rig.model.traverse((o) => { if (!f && (o as THREE.Bone).isBone && re.test(o.name)) f = o as THREE.Bone; }); return f; };
    for (const k of ["Hips", "Spine", "Spine1", "Spine2", "Neck", "Head"]) this.b[k] = find(new RegExp(`${k}$`));
    rig.model.updateMatrixWorld(true);
    for (const k of ["Spine2", "Head"]) { const bone = this.b[k]; if (bone) this.fwdLocal[k] = new V(0, 0, 1).applyQuaternion(bone.getWorldQuaternion(new Q()).invert()); }
  }

  /** aplica a rotação r (em eixos do mundo, em torno da junta) ao osso: local' = (pai⁻¹ · r · pai) · local */
  private rot(bone: THREE.Bone | null, r: THREE.Quaternion): void {
    if (!bone || !bone.parent) return;
    bone.parent.getWorldQuaternion(this.tmpQ); this.tmpQ2.copy(this.tmpQ).invert().multiply(r).multiply(this.tmpQ);
    bone.quaternion.premultiply(this.tmpQ2); bone.updateMatrixWorld(true);
  }
  private axisRot(ax: number, ay: number, az: number, ang: number): THREE.Quaternion { return new Q().setFromAxisAngle(this.tmpV3.set(ax, ay, az), ang); }
  private fwdOf(key: string, out: THREE.Vector3): THREE.Vector3 { const bone = this.b[key]; return out.copy(this.fwdLocal[key] ?? this.tmpV3.set(0, 0, 1)).applyQuaternion(bone!.getWorldQuaternion(this.tmpQ)); }

  update(i: FxIn): void {
    if (!this.enabled) return;
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
      // guinada em torno do eixo vertical e depois inclinação em torno do eixo lateral: a cabeça gira sem inclinar de lado (nada de "pescoço torto")
      const aim = (bone: THREE.Bone, share: number): void => {
        const f = this.fwdOf("Head", this.tmpV), fy = Math.atan2(f.x, f.z), fp = Math.atan2(f.y, Math.hypot(f.x, f.z));
        const dy = wrap(this.yaw - fy) * share * this.gazeW, dp = (this.pitch - fp) * share * this.gazeW;
        const ry = new Q().setFromAxisAngle(this.tmpV3.set(0, 1, 0), dy), ny = fy + dy;
        const rp = new Q().setFromAxisAngle(this.tmpV3.set(Math.cos(ny), 0, -Math.sin(ny)), -dp);
        this.rot(bone, rp.multiply(ry));
      };
      aim(neck, 0.4); aim(head, 1);
    }
    if (tired > 0.01) this.rot(neck, this.axisRot(1, 0, 0, tired * 3 * D2R * free));   // cansada: cabeça um pouco caída
  }
}
