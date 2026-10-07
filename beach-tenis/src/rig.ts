import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { cleanWrists, WristTwist } from "./wrist";
import { applyReadyPose } from "./ready";
import { Loco, LOCO_CLIPS } from "./loco";
import { isVideoClip, strokeOf } from "./strokes";

export interface ClipMeta { name: string; kind: string; contact_time?: number; frames: number; duration?: number; speed_x_m_s?: number; speed_z_m_s?: number; }
export const LOCO = ["idle", "run_f", "run_b", "run_l", "run_r"] as const;
// tempo (s) do começo do golpe até o contato: o golpe de mocap começa PREP antes do instante de contato (o resto da preparação é pulado)
export const PREP: Record<string, number> = { ground: 0.55, volley: 0.4, smash: 0.7, serve: 0.9 };
export const prepOf = (clip: string): number => strokeOf(clip)?.prep ?? (/smash/.test(clip) ? PREP.smash : /volley/.test(clip) ? PREP.volley : /serve/.test(clip) ? PREP.serve : PREP.ground);
export const SWINGS: string[] = ["forehand_1", "forehand_2", "backhand_1", "backhand_2", "serve_1", "serve_2", "smash_1", "smash_2", "fvolley_1", "fvolley_2", "bvolley_1", "bvolley_2"];

// Pegada da raquete. Referencial da mão (medido nos ossos, pose de repouso): F = dedos, A = lado do polegar, N = palma.
// A raquete atravessa a palma na diagonal: eixo do cabo→cabeça = A girado BETA para F; a face fica paralela à palma (normal = N).
const D2R = Math.PI / 180;
const GRIP = { beta: 55 * D2R, handleY: -0.035, handleZ: 0.008, palmLift: 1.2 };   // y do cabo na palma (m), centro do cabo em z (m), cabo acima do osso (unid. da mão)
// curvatura dos dedos da mão que segura (graus por junta: base, meio, ponta), em torno do eixo F×N
const FINGERS: [string, number[]][] = [["Index", [38, 62, 40]], ["Middle", [44, 68, 44]], ["Ring", [50, 70, 46]], ["Pinky", [56, 70, 46]]];
const THUMB = [22, 28, 20];

/** O GLB sai sem metallicFactor (padrão glTF = 1) e a cena não tem mapa de ambiente: sem isto a jogadora renderiza preta. O BLEND do export também é desnecessário (textura opaca). */
function fixSkinMaterial(mt: THREE.Material): void {
  const s = mt as THREE.MeshStandardMaterial;
  if (!s.isMeshStandardMaterial) return;
  s.metalness = 0; s.roughness = 0.8; s.transparent = false; s.opacity = 1; s.depthWrite = true; s.needsUpdate = true;
}

export class Rig {
  root = new THREE.Group();
  model = new THREE.Group();
  mixer!: THREE.AnimationMixer;
  actions = new Map<string, THREE.AnimationAction>();
  durations = new Map<string, number>();
  meta: Record<string, ClipMeta> = {};
  racket = new THREE.Group();
  head = new THREE.Object3D();
  hand: THREE.Object3D | null = null;
  contactLocal = new Map<string, THREE.Vector3>();
  faceAssist = 1;
  peak = new Map<string, number>();
  presetQ = new THREE.Quaternion();
  twist: WristTwist | null = null;
  loco = new Loco();
  private grip: { F: THREE.Vector3; A: THREE.Vector3; N: THREE.Vector3; palm: THREE.Vector3 } | null = null;
  private fingers: { bone: THREE.Bone; rest: THREE.Quaternion; axis: THREE.Vector3; ang: number }[] = [];
  private tq = new THREE.Quaternion(); private tp = new THREE.Vector3(); private ts = new THREE.Vector3();

  async load(base: string): Promise<void> {
    const loader = new GLTFLoader(); loader.setMeshoptDecoder(MeshoptDecoder);
    const [gltf, meta] = await Promise.all([loader.loadAsync(base + "models/jaqueline.glb"), fetch(base + "models/clips.json").then((r) => r.json())]);
    this.meta = meta;
    // locomoção neutra (pacote "Locomotion"): troca parada/corrida do GLB principal (pose de conjuração do pacote Magic) e acrescenta as caminhadas
    let locoMeta: Record<string, { speed_x_m_s?: number; speed_z_m_s?: number }> = {};
    try {
      const [lg, lm] = await Promise.all([loader.loadAsync(base + "models/loco2.glb"), fetch(base + "models/loco2.json").then((r) => r.json())]);
      locoMeta = lm; const names = new Set(lg.animations.map((c) => c.name));
      gltf.animations = gltf.animations.filter((c) => !names.has(c.name));
      for (const c of lg.animations) { c.tracks = c.tracks.filter((t) => t.name.endsWith(".quaternion") || /Hips\.position$/.test(t.name)); gltf.animations.push(c); }
    } catch { /* sem loco2: fica a locomoção do GLB principal */ }
    // golpes do vídeo do autor (pose 3D → esqueleto da Jaqueline, tools/video): clipes v_* com o instante de contato já medido
    try {
      const [vg, vm] = await Promise.all([loader.loadAsync(base + "models/video_clips.glb"), fetch(base + "models/video_clips.json").then((r) => r.json())]);
      const have = new Set(gltf.animations.map((c) => c.name));
      for (const c of vg.animations) {
        if (have.has(c.name) || !isVideoClip(c.name)) continue;
        c.tracks = c.tracks.filter((t) => t.name.endsWith(".quaternion") || /Hips\.position$/.test(t.name)); gltf.animations.push(c);
        const m = vm[c.name] ?? {}; this.meta[c.name] = { name: c.name, kind: "video", contact_time: m.contact_time, frames: m.frames ?? Math.round(c.duration * 30), duration: c.duration };
        if (!SWINGS.includes(c.name)) SWINGS.push(c.name);
      }
    } catch { /* sem video_clips.glb: ficam só os golpes de mocap de tênis */ }
    const isLoco = (n: string) => (LOCO as readonly string[]).includes(n) || LOCO_CLIPS.includes(n);
    this.model = gltf.scene as THREE.Group;
    const skinned: THREE.SkinnedMesh[] = [];
    this.model.traverse((o) => { const m = o as THREE.SkinnedMesh; if (m.isSkinnedMesh) { skinned.push(m); m.frustumCulled = false; m.castShadow = false; for (const mt of Array.isArray(m.material) ? m.material : [m.material]) fixSkinMaterial(mt); } });
    cleanWrists(gltf.animations, WristTwist.hands(this.model), (n) => !isLoco(n) && !isVideoClip(n));
    if (skinned[0]) this.twist = WristTwist.attach(skinned[0]);
    this.root.add(this.model);
    this.model.traverse((o) => { if (!this.hand && /RightHand$/.test(o.name)) this.hand = o; });
    if (!this.hand) throw new Error("osso RightHand não encontrado");
    this.captureGrip();
    applyReadyPose(this.model, gltf.animations, [...LOCO, ...LOCO_CLIPS], this.gripAxes().q);
    this.mixer = new THREE.AnimationMixer(this.model);
    for (const c of gltf.animations) {
      const a = this.mixer.clipAction(c); a.play(); a.timeScale = 0; a.setEffectiveWeight(0); a.time = 0;
      this.actions.set(c.name, a); this.durations.set(c.name, c.duration);
    }
    this.loco.measure(this, locoMeta);
    try {
      const rk = await loader.loadAsync(base + "models/racket.glb");
      rk.scene.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { m.frustumCulled = false; } });
      this.racket.add(rk.scene); this.head.position.set(0, 0.25, 0); this.racket.add(this.head);
    } catch { this.buildRacket(); }
    this.hand.add(this.racket);
  }

  private buildRacket(): void {
    const g = this.racket; const rim = new THREE.MeshStandardMaterial({ color: 0xff6a00, roughness: 0.5 });
    const face = new THREE.MeshStandardMaterial({ color: 0x1b1d22, roughness: 0.6, metalness: 0.2 });
    const hole = new THREE.MeshBasicMaterial({ color: 0x050607 });
    const grip = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9 });
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.02, 0.22, 16), grip); handle.position.y = 0; g.add(handle);
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.016, 0.09, 12), face); neck.position.y = 0.155; g.add(neck);
    const cyl = (th: number) => { const geo = new THREE.CylinderGeometry(1, 1, th, 40); geo.rotateX(Math.PI / 2); return geo; };
    const hy = 0.31;
    const outer = new THREE.Mesh(cyl(0.022), rim); outer.scale.set(0.13, 0.165, 1); outer.position.y = hy; g.add(outer);
    const inner = new THREE.Mesh(cyl(0.0226), face); inner.scale.set(0.114, 0.149, 1); inner.position.y = hy; g.add(inner);
    const pts: THREE.Vector2[] = [];
    for (let y = -0.12; y <= 0.12; y += 0.026) for (let x = -0.1; x <= 0.1; x += 0.026) {
      const xx = x + (Math.round(y / 0.026) % 2 ? 0.013 : 0);
      if ((xx / 0.098) ** 2 + (y / 0.132) ** 2 < 1) pts.push(new THREE.Vector2(xx, y));
    }
    const hg = new THREE.CylinderGeometry(0.007, 0.007, 0.0236, 8); hg.rotateX(Math.PI / 2);
    const holes = new THREE.InstancedMesh(hg, hole, pts.length); const m = new THREE.Matrix4();
    pts.forEach((p, i) => { m.setPosition(p.x, hy + p.y, 0); holes.setMatrixAt(i, m); }); g.add(holes);
    this.head.position.set(0, hy, 0); g.add(this.head);
  }

  /** referencial da pegada e eixos de curvatura dos dedos, a partir dos ossos na pose de repouso (antes de qualquer animação) */
  private captureGrip(): void {
    const hand = this.hand!; this.model.updateMatrixWorld(true);
    const bone = (n: string) => { let f: THREE.Object3D | null = null; this.model.traverse((o) => { if (!f && new RegExp(`RightHand${n}$`).test(o.name)) f = o; }); return f as THREE.Bone | null; };
    const inv = hand.matrixWorld.clone().invert(); const at = (b: THREE.Object3D) => b.getWorldPosition(new THREE.Vector3()).applyMatrix4(inv);
    const mid = bone("Middle1"), idx = bone("Index1"), pin = bone("Pinky1"), t1 = bone("Thumb1"), t4 = bone("Thumb4");
    if (!mid || !idx || !pin || !t1 || !t4) return;
    const F = at(mid).normalize(); const A = at(idx).sub(at(pin)); A.addScaledVector(F, -A.dot(F)).normalize();
    const N = new THREE.Vector3().crossVectors(A, F).normalize(); if (N.dot(at(t4).sub(at(t1))) < 0) N.negate();
    const palm = at(mid).multiplyScalar(0.5).addScaledVector(N, GRIP.palmLift);
    this.grip = { F, A, N, palm };
    // dedos: junta a junta, eixo de curvatura (F×N) no referencial do pai (osso pai em repouso)
    const curl = new THREE.Vector3().crossVectors(F, N).normalize();
    const addFinger = (name: string, angs: number[], axisHand: THREE.Vector3) => {
      const handQ = hand.getWorldQuaternion(new THREE.Quaternion()); const aw = axisHand.clone().applyQuaternion(handQ);
      for (let j = 1; j <= 3; j++) { const b = bone(`${name}${j}`); if (!b || !b.parent) continue;
        const pq = b.parent.getWorldQuaternion(new THREE.Quaternion());
        this.fingers.push({ bone: b, rest: b.quaternion.clone(), axis: aw.clone().applyQuaternion(pq.invert()), ang: angs[j - 1] * D2R }); }
    };
    for (const [n, a] of FINGERS) addFinger(n, a, curl);
    const T = at(t4).sub(at(t1)).normalize(); addFinger("Thumb", THUMB, new THREE.Vector3().crossVectors(T, N).normalize());
  }

  /** eixos da raquete no referencial da mão (X largura, Y cabo→cabeça, Z face) e a rotação equivalente */
  private gripAxes(): { xr: THREE.Vector3; yr: THREE.Vector3; zr: THREE.Vector3; q: THREE.Quaternion } {
    const g = this.grip; if (!g) return { xr: new THREE.Vector3(1, 0, 0), yr: new THREE.Vector3(0, 1, 0), zr: new THREE.Vector3(0, 0, 1), q: new THREE.Quaternion() };
    const yr = g.A.clone().multiplyScalar(Math.cos(GRIP.beta)).addScaledVector(g.F, Math.sin(GRIP.beta)).normalize();
    const zr = g.N.clone(), xr = new THREE.Vector3().crossVectors(yr, zr);
    return { xr, yr, zr, q: new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(xr, yr, zr)) };
  }

  /** dedos da mão que segura fechados em volta do cabo (depois de cada mixer.update) */
  private applyFingers(): void {
    const q = new THREE.Quaternion();
    for (const f of this.fingers) f.bone.quaternion.copy(q.setFromAxisAngle(f.axis, f.ang).multiply(f.rest));
  }

  applyRacketTransform(p: { rkX: number; rkY: number; rkZ: number; rkRX: number; rkRY: number; rkRZ: number }, playerScale: number): void {
    this.model.scale.setScalar(playerScale); this.root.updateMatrixWorld(true);
    const ws = new THREE.Vector3(); this.hand!.getWorldScale(ws);
    this.racket.scale.setScalar(1 / ws.x);
    const g = this.grip; if (!g) return;
    const d = THREE.MathUtils.degToRad, u = 1 / ws.x;              // metros → unidades da mão
    const { xr, yr, zr, q: base } = this.gripAxes();
    this.presetQ.copy(base).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(d(p.rkRX), d(p.rkRY), d(p.rkRZ))));
    this.racket.position.copy(g.palm).addScaledVector(yr, -GRIP.handleY * u).addScaledVector(zr, -GRIP.handleZ * u)
      .addScaledVector(xr, p.rkX * u).addScaledVector(yr, p.rkY * u).addScaledVector(zr, p.rkZ * u);
    this.racket.quaternion.copy(this.presetQ);
  }

  /** gira a raquete em torno do próprio eixo para a face olhar a parede (+Z) no contato; w=0 usa só a pegada da mão */
  fixRacket(w: number): void {
    this.twist?.update(); this.applyFingers();
    const r = this.racket; const hand = this.hand!;
    hand.updateWorldMatrix(true, false); hand.matrixWorld.decompose(this.tp, this.tq, this.ts);
    const qh = this.tq.clone(); r.quaternion.copy(this.presetQ);
    if (w <= 0) return;
    const qfit = qh.clone().multiply(this.presetQ);
    const ax = new THREE.Vector3(0, 1, 0).applyQuaternion(qfit), n = new THREE.Vector3(0, 0, 1).applyQuaternion(qfit);
    const dz = new THREE.Vector3(0, 0, 1);
    const np = n.clone().addScaledVector(ax, -n.dot(ax)), dp = dz.clone().addScaledVector(ax, -dz.dot(ax));
    if (np.lengthSq() < 1e-6 || dp.lengthSq() < 1e-6) return;
    const th = Math.atan2(ax.dot(new THREE.Vector3().crossVectors(np, dp)), np.dot(dp));
    const qc = new THREE.Quaternion().setFromAxisAngle(ax, th * w).multiply(qfit);
    r.quaternion.copy(qh.invert().multiply(qc));
  }

  /** posição do centro da raquete (relativa à raiz) na pose do clipe no tempo t */
  measure(name: string, t: number): THREE.Vector3 {
    const saved = [...this.actions].map(([, a]) => [a, a.getEffectiveWeight(), a.time] as const);
    for (const [, a] of this.actions) a.setEffectiveWeight(0);
    const a = this.actions.get(name)!; a.setEffectiveWeight(1); a.time = Math.min(t, (this.durations.get(name) ?? 1) - 1e-3);
    this.mixer.update(0); this.root.updateMatrixWorld(true); this.fixRacket(this.faceAssist);
    this.root.updateMatrixWorld(true);
    const v = new THREE.Vector3(); this.head.getWorldPosition(v);
    const r = new THREE.Vector3(); this.root.getWorldPosition(r);
    for (const [x, w, tm] of saved) { x.setEffectiveWeight(w); x.time = tm; }
    return v.sub(r);
  }

  /** contato = pico de velocidade do centro da raquete (±0,4 s ao redor do pico do punho do mocap; ±0,12 s nos clipes do vídeo) */
  findPeaks(): void {
    for (const n of SWINGS) {
      const c0 = this.meta[n]?.contact_time ?? 1; const dur = this.durations.get(n) ?? 2;
      const win = isVideoClip(n) ? 0.12 : 0.4;   // clipes do vídeo: contato medido no punho; só refina ±0,12 s (a raquete sem punho ativo pode ter outro pico no vai-e-vem)
      const k0 = Math.max(1, Math.round((c0 - win) * 30)), k1 = Math.min(Math.floor(dur * 30) - 2, Math.round((c0 + win) * 30));
      const P: THREE.Vector3[] = []; for (let k = k0 - 1; k <= k1 + 1; k++) P.push(this.measure(n, k / 30));
      let best = -1, bk = k0; const sp: number[] = [];
      for (let i = 1; i < P.length - 1; i++) { const v = P[i + 1].distanceTo(P[i - 1]); sp[i] = v; if (v > best) { best = v; bk = k0 - 1 + i; } }
      // golpes por cima: o pico de velocidade vem na descida (seguimento); o contato é o ponto mais alto entre os quadros rápidos
      if (/^(serve|smash)/.test(n) || strokeOf(n)?.overhead) { let hi = -1e9; for (let i = 1; i < P.length - 1; i++) if (sp[i] >= 0.75 * best && P[i].y > hi) { hi = P[i].y; bk = k0 - 1 + i; } }
      this.peak.set(n, bk / 30);
    }
  }

  ct(name: string, offsetFrames: number): number { return (this.peak.get(name) ?? this.meta[name]?.contact_time ?? 1) + offsetFrames / 30; }

  /** instante do clipe em que o swing começa (pula a espera parada do mocap): preparação = PREP do tipo de golpe */
  startT(name: string, offsetFrames: number): number { return Math.max(0, this.ct(name, offsetFrames) - prepOf(name)); }

  calibrate(offsetFrames: number): void {
    const p = this.root.position.clone(), q = this.root.quaternion.clone(); this.root.position.set(0, 0, 0); this.root.quaternion.identity();
    for (const n of SWINGS) { const ct = this.ct(n, offsetFrames); this.contactLocal.set(n, this.measure(n, ct)); }
    this.root.position.copy(p); this.root.quaternion.copy(q);
  }
}
