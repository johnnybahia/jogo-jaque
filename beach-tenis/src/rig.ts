import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";

export interface ClipMeta { name: string; kind: string; contact_time?: number; frames: number; duration?: number; speed_x_m_s?: number; speed_z_m_s?: number; }
export const LOCO = ["idle", "run_f", "run_b", "run_l", "run_r"] as const;
export const SWINGS = ["forehand_1", "forehand_2", "backhand_1", "backhand_2", "serve_1", "serve_2", "smash_1", "smash_2", "fvolley_1", "fvolley_2", "bvolley_1", "bvolley_2"];

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
  private tq = new THREE.Quaternion(); private tp = new THREE.Vector3(); private ts = new THREE.Vector3();

  async load(base: string): Promise<void> {
    const loader = new GLTFLoader(); loader.setMeshoptDecoder(MeshoptDecoder);
    const [gltf, meta] = await Promise.all([loader.loadAsync(base + "models/jaqueline.glb"), fetch(base + "models/clips.json").then((r) => r.json())]);
    this.meta = meta;
    this.model = gltf.scene as THREE.Group;
    this.model.traverse((o) => { const m = o as THREE.SkinnedMesh; if (m.isSkinnedMesh) { m.frustumCulled = false; m.castShadow = false; for (const mt of Array.isArray(m.material) ? m.material : [m.material]) fixSkinMaterial(mt); } });
    this.root.add(this.model);
    this.mixer = new THREE.AnimationMixer(this.model);
    for (const c of gltf.animations) {
      const a = this.mixer.clipAction(c); a.play(); a.timeScale = 0; a.setEffectiveWeight(0); a.time = 0;
      this.actions.set(c.name, a); this.durations.set(c.name, c.duration);
    }
    this.model.traverse((o) => { if (!this.hand && /RightHand$/.test(o.name)) this.hand = o; });
    if (!this.hand) throw new Error("osso RightHand não encontrado");
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

  applyRacketTransform(p: { rkX: number; rkY: number; rkZ: number; rkRX: number; rkRY: number; rkRZ: number }, playerScale: number): void {
    this.model.scale.setScalar(playerScale); this.root.updateMatrixWorld(true);
    const ws = new THREE.Vector3(); this.hand!.getWorldScale(ws);
    this.racket.scale.setScalar(1 / ws.x);
    const d = THREE.MathUtils.degToRad;
    this.racket.position.set(p.rkX / ws.x, p.rkY / ws.x, p.rkZ / ws.x);
    this.racket.rotation.set(d(p.rkRX), d(p.rkRY), d(p.rkRZ)); this.presetQ.copy(this.racket.quaternion);
  }

  /** gira a raquete em torno do próprio eixo para a face olhar a parede (+Z) no contato; w=0 usa só a pegada da mão */
  fixRacket(w: number): void {
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

  /** contato = pico de velocidade do centro da raquete (±0,4 s ao redor do pico do punho do mocap) */
  findPeaks(): void {
    for (const n of SWINGS) {
      const c0 = this.meta[n]?.contact_time ?? 1; const dur = this.durations.get(n) ?? 2;
      const k0 = Math.max(1, Math.round((c0 - 0.4) * 30)), k1 = Math.min(Math.floor(dur * 30) - 2, Math.round((c0 + 0.4) * 30));
      const P: THREE.Vector3[] = []; for (let k = k0 - 1; k <= k1 + 1; k++) P.push(this.measure(n, k / 30));
      let best = -1, bk = k0;
      for (let i = 1; i < P.length - 1; i++) { const v = P[i + 1].distanceTo(P[i - 1]); if (v > best) { best = v; bk = k0 - 1 + i; } }
      this.peak.set(n, bk / 30);
    }
  }

  ct(name: string, offsetFrames: number): number { return (this.peak.get(name) ?? this.meta[name]?.contact_time ?? 1) + offsetFrames / 30; }

  /** instante do clipe em que o swing começa (pula a espera parada do mocap): preparação ≤ 0,9 s */
  startT(name: string, offsetFrames: number): number { return Math.max(0, this.ct(name, offsetFrames) - 0.9); }

  calibrate(offsetFrames: number): void {
    const p = this.root.position.clone(), q = this.root.quaternion.clone(); this.root.position.set(0, 0, 0); this.root.quaternion.identity();
    for (const n of SWINGS) { const ct = this.ct(n, offsetFrames); this.contactLocal.set(n, this.measure(n, ct)); }
    this.root.position.copy(p); this.root.quaternion.copy(q);
  }
}
