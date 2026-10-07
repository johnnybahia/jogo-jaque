import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { Rig, LOCO } from "./rig";
import { buildEnvironment, blobTexture, COURT } from "./scene";
import { S, loadRecord, saveRecord } from "./settings";
import { Footprints } from "./footprints";
import { Ball, BALL_R, Sample, Tun, heightAtWall, newBall, predict, stepBall } from "./physics";

const MAX_SPEED = 3.4, MAX_SIDE = 3.0, MAX_BACK = 2.6;   // m/s: frente, lado, ré (a ré é mais lenta, como no jogo de verdade)
interface Swing { startT: number; endT: number; clip: string; s: number; contactT: number; t: number; duration: number; x0: number; z0: number; x1: number; z1: number; contacted: boolean; kind: string; plan?: number[]; }
interface Plan { st: number; smp?: Sample;  clip: string; s: number; ct: number; x1: number; z1: number; kind: string; cost: number; }
export interface LogEntry { t: number; type: string; [k: string]: unknown; }

export class Game {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(55, 1, 0.1, 150);
  renderer: THREE.WebGLRenderer;
  rig = new Rig(); foot: Footprints;
  ball: Ball = newBall();
  ballMesh: THREE.Object3D; ballShadow: THREE.Mesh; playerShadow: THREE.Mesh;
  tun: Tun = { eSand: S.eSand, eWall: S.eWall, wallZ: COURT.wallZ, wallW: COURT.wallW, wallH: COURT.wallH };
  input = { right: 0, fwd: 0 };
  state: "wait" | "rally" | "dead" = "wait";
  rally = 0; record = loadRecord(); deadTimer = 0; time = 0; serveTime = 0;
  swing: Swing | null = null; swingAct: THREE.AnimationAction | null = null; swingW = 0;
  vx = 0; vz = 0; phase = 0; idlePhase = 0; alt = 0;
  log: LogEntry[] = [];
  onToast: (m: string) => void = () => {};
  onHud: () => void = () => {};
  info = "";

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    buildEnvironment(this.scene, import.meta.env.BASE_URL); this.foot = new Footprints(this.scene);
    const bt = blobTexture();
    const bm = new THREE.MeshBasicMaterial({ map: bt, transparent: true, depthWrite: false });
    this.playerShadow = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1.1), bm); this.playerShadow.rotation.x = -Math.PI / 2; this.playerShadow.position.y = 0.01; this.scene.add(this.playerShadow);
    this.ballShadow = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.3), bm); this.ballShadow.rotation.x = -Math.PI / 2; this.ballShadow.position.y = 0.012; this.scene.add(this.ballShadow);
    this.ballMesh = new THREE.Group(); this.ballMesh.add(new THREE.Mesh(new THREE.SphereGeometry(BALL_R, 20, 14), new THREE.MeshStandardMaterial({ color: 0xd8f23a, emissive: 0x6a7a10, roughness: 0.7 }))); this.scene.add(this.ballMesh);
    this.ballMesh.visible = false; this.ballShadow.visible = false;
    this.resize();
  }

  async init(base: string): Promise<void> {
    await this.rig.load(base);
    try {
      const l = new GLTFLoader(); l.setMeshoptDecoder(MeshoptDecoder); const bg = await l.loadAsync(base + "models/ball_green.glb");
      bg.scene.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { const mt = m.material as THREE.MeshStandardMaterial; mt.emissive = mt.color.clone().multiplyScalar(0.45); mt.roughness = 0.8; mt.metalness = 0; } });
      this.ballMesh.clear(); this.ballMesh.add(bg.scene);
    } catch { /* mantém a esfera */ }
    this.scene.add(this.rig.root);
    this.rig.root.position.set(0, 0, 0);
    this.rig.faceAssist = S.faceAssist; this.rig.applyRacketTransform(S, S.playerScale); this.rig.findPeaks();
    this.applySettings();
    this.foot.bind(this.rig.model); this.animate(0); this.rig.root.updateMatrixWorld(true); this.foot.calibrate();
    this.setCamera(true);
  }

  applySettings(recalc = true): void {
    this.rig.faceAssist = S.faceAssist; this.tun.eSand = S.eSand; this.tun.eWall = S.eWall;
    this.rig.applyRacketTransform(S, S.playerScale);
    if (recalc) this.rig.calibrate(S.contactOffset);
    this.ballMesh.scale.setScalar(S.ballVisual);
  }

  resize(): void {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false); this.camera.aspect = w / h;
    this.camera.fov = w / h < 0.8 ? 68 : 55; this.camera.updateProjectionMatrix();
  }

  private emit(type: string, extra: Record<string, unknown> = {}): void {
    this.log.push({ t: +this.time.toFixed(3), type, ...extra }); if (this.log.length > 400) this.log.shift();
  }

  serve(): void {
    if (!this.rig.mixer) return;
    if (this.swing && !this.swing.contacted) this.swing = null;
    const p = this.rig.root.position;
    Object.assign(this.ball, newBall(), { x: p.x - 0.3, y: 1.3, z: p.z + 1.0 });
    this.aimBall(THREE.MathUtils.clamp(p.x + (Math.random() - 0.5) * 2.4, -2.5, 2.5), 1.8 + Math.random() * 0.8, 13);
    this.state = "rally"; this.rally = 0; this.serveTime = this.time; this.foot.clear();
    this.ballMesh.visible = true; this.ballShadow.visible = true; this.emit("serve"); this.onHud();
  }

  /** dá à bola a velocidade para atingir (tx,ty) na parede com a rapidez dada (ignora arrasto) */
  private aimBall(tx: number, ty: number, speed: number): void {
    const b = this.ball; const dx = tx - b.x, dz = COURT.wallZ - BALL_R - b.z; const hl = Math.hypot(dx, dz); const ux = dx / hl, uz = dz / hl;
    const hAt = (th: number): number => heightAtWall(b, speed * Math.cos(th) * ux, speed * Math.sin(th), speed * Math.cos(th) * uz, COURT.wallZ - BALL_R);
    let lo = -0.25, hi = 1.0;
    for (let i = 0; i < 18; i++) { const mid = (lo + hi) / 2; if (hAt(mid) < ty) lo = mid; else hi = mid; }
    const th = (lo + hi) / 2;
    b.vx = speed * Math.cos(th) * ux; b.vy = speed * Math.sin(th); b.vz = speed * Math.cos(th) * uz; b.bounces = 0;
  }

  // ---------- planejamento ----------
  private classify(smp: Sample, px: number): { clip: string; kind: string } {
    const dx = smp.x - px; const fore = dx <= 0; const n = (this.alt % 2) + 1;
    if (smp.y > 1.95) return { clip: `smash_${n}`, kind: "smash" };
    if (smp.bounces === 0 && smp.y > 0.75) return { clip: `${fore ? "f" : "b"}volley_${n}`, kind: "volley" };
    return { clip: `${fore ? "fore" : "back"}hand_${n}`, kind: "ground" };
  }

  private evaluate(smp: Sample, clip: string, kind: string, s: number, ct: number): Plan | null {
    const cl = this.rig.contactLocal.get(clip); if (!cl) return null;
    const p = this.rig.root.position;
    const x1 = smp.x - cl.x, z1 = smp.z - cl.z;
    if (x1 < -4.6 || x1 > 4.6 || z1 < -5 || z1 > 6.5) return null;
    const shift = Math.hypot(x1 - p.x, z1 - p.z);
    if (shift > 0.25 + 1.5 * S.assist) return null;
    const dy = Math.abs(smp.y - cl.y); if (dy > 0.45) return null;
    return { st: this.rig.startT(clip, S.contactOffset), smp, clip, s, ct, x1, z1, kind, cost: shift + 1.5 * dy + 0.2 * smp.t };
  }

  private planAuto(): Plan | null {
    const p = this.rig.root.position; let best: Plan | null = null;
    for (const smp of predict(this.ball, this.tun, 3.0)) {
      if (smp.vz >= -0.2 || smp.bounces > 2 || smp.y < 0.12 || smp.y > 2.7 || smp.t < 0.2) continue;
      const { clip, kind } = this.classify(smp, p.x);
      const ct = this.rig.ct(clip, S.contactOffset); const s = (ct - this.rig.startT(clip, S.contactOffset)) / smp.t;
      if (s < 0.85 || s > 1.7) continue;
      const pl = this.evaluate(smp, clip, kind, s, ct);
      if (pl && (!best || pl.cost < best.cost)) best = pl;
    }
    return best;
  }

  private planManual(): Plan {
    const p = this.rig.root.position; const samples = predict(this.ball, this.tun, 3.0); let best: Plan | null = null;
    for (const clip of ["forehand_1", "forehand_2", "backhand_1", "backhand_2", "fvolley_1", "bvolley_1", "smash_1", "fvolley_2", "bvolley_2", "smash_2"]) {
      const ct = this.rig.ct(clip, S.contactOffset);
      const smp = samples[Math.min(samples.length - 1, Math.max(0, Math.round((ct - this.rig.startT(clip, S.contactOffset)) * 60) - 1))]; if (!smp) continue;
      const c = this.classify(smp, p.x); if (c.clip.replace(/_\d$/, "") !== clip.replace(/_\d$/, "")) continue;
      const pl = this.evaluate(smp, clip, c.kind, 1, ct); if (pl && (!best || pl.cost < best.cost)) best = pl;
    }
    if (best) return best;
    const fore = this.ball.x <= p.x; const clip = `${fore ? "fore" : "back"}hand_${(this.alt % 2) + 1}`;
    return { st: this.rig.startT(clip, S.contactOffset), clip, s: 1, ct: this.rig.ct(clip, S.contactOffset), x1: p.x, z1: p.z, kind: "ground", cost: 99 };
  }

  startSwing(pl: Plan): void {
    const act = this.rig.actions.get(pl.clip); if (!act || this.swing) return;
    const p = this.rig.root.position; this.alt++;
    this.swing = { clip: pl.clip, s: pl.s * S.timeScale, contactT: pl.ct, t: pl.st, startT: pl.st, endT: Math.min((this.rig.durations.get(pl.clip) ?? 2) - 0.02, pl.ct + 0.55), duration: this.rig.durations.get(pl.clip) ?? 2, x0: p.x, z0: p.z, x1: pl.x1, z1: pl.z1, contacted: false, kind: pl.kind };
    this.swingAct = act; this.vx = 0; this.vz = 0;
    this.info = `${pl.clip} ×${pl.s.toFixed(2)}`; this.swing.plan = pl.smp ? [pl.smp.x, pl.smp.y, pl.smp.z, pl.smp.t].map((v) => +v.toFixed(2)) : []; this.emit("swing", { clip: pl.clip, s: +pl.s.toFixed(2), cost: +pl.cost.toFixed(2), plan: this.swing.plan });
  }

  manualSwing(): void { if (!this.swing && this.state !== "wait") this.startSwing(this.planManual()); }

  // ---------- contato ----------
  private doContact(sw: Swing): void {
    const act = this.swingAct!; act.time = Math.min(sw.contactT, sw.duration - 1e-3);
    this.rig.root.position.set(sw.x1, 0, sw.z1);
    this.rig.mixer.update(0); this.rig.root.updateMatrixWorld(true); this.rig.fixRacket(this.rig.faceAssist); this.rig.root.updateMatrixWorld(true);
    const H = new THREE.Vector3(); this.rig.head.getWorldPosition(H);
    const b = this.ball; const B = new THREE.Vector3(b.x, b.y, b.z); const gap = H.distanceTo(B);
    this.emit("contact", { clip: sw.clip, gap_cm: Math.round(gap * 100), dy_cm: Math.round((B.y - H.y) * 100), ball: [b.x, b.y, b.z].map((v) => +v.toFixed(2)), head: [H.x, H.y, H.z].map((v) => +v.toFixed(2)), plan: sw.plan });
    this.info = `${sw.clip} ×${(sw.s / S.timeScale).toFixed(2)} gap ${Math.round(gap * 100)} cm`;
    if (gap > S.hitRadius) { this.onToast("Errou o tempo"); this.onHud(); return; }
    B.lerp(H, 0.7); b.x = B.x; b.y = Math.max(B.y, BALL_R); b.z = B.z;
    const aim = this.input.right * -1;
    const tx = THREE.MathUtils.clamp(aim * 2.4 + (Math.random() - 0.5) * 2 * S.aimSpread * (Math.abs(aim) > 0.3 ? 0.3 : 1), -2.6, 2.6);
    const smash = sw.kind === "smash";
    const ty = smash ? 0.6 + Math.random() * 0.5 : 1.0 + Math.random() * 1.2;
    const speed = S.ballSpeed * (smash ? 1.25 : sw.kind === "volley" ? 0.9 : 1);
    this.aimBall(tx, ty, speed);
    this.rally++; if (this.rally > this.record) { this.record = this.rally; saveRecord(this.record); }
    this.onToast(gap < 0.15 ? "Perfeito!" : "Bom!"); this.onHud();
  }

  private advance(dt: number): void {
    const sw = this.swing; let rem = dt;
    const sim = (d: number) => {
      let r = d; while (r > 1e-6) { const h = Math.min(r, 1 / 120); this.handleEvent(stepBall(this.ball, h, this.tun)); r -= h; }
    };
    if (sw && !sw.contacted) {
      const left = (sw.contactT - sw.t) / sw.s;
      if (left <= dt) { sim(Math.max(left, 0)); sw.t = sw.contactT; sw.contacted = true; this.doContact(sw); rem = dt - Math.max(left, 0); sw.t += rem * sw.s; sim(rem); return; }
    }
    sim(rem); if (sw) sw.t += dt * sw.s;
  }

  private handleEvent(ev: string | null): void {
    if (!ev) return;
    if (ev === "wall") this.emit("wall", { z: +this.ball.z.toFixed(2) });
    if (ev === "wallout" && this.state === "rally") this.kill("Fora da parede");
  }

  private kill(msg: string): void {
    if (this.state !== "rally") return; if (this.swing && !this.swing.contacted) this.swing = null; this.state = "dead"; this.deadTimer = 1.4; this.onToast(`${msg} — rali ${this.rally}`); this.emit("dead", { msg, rally: this.rally }); this.onHud();
  }

  // ---------- loop ----------
  tick(dt: number): void {
    if (!this.rig.mixer) return;
    dt = Math.min(dt, 0.05); this.time += dt; const root = this.rig.root; const p = root.position;
    if (this.state === "dead") { this.deadTimer -= dt; if (this.deadTimer <= 0) { this.state = "wait"; if (S.autoServe) this.serve(); } }

    if (!this.swing) {
      const tx = -this.input.right * MAX_SIDE, tz = this.input.fwd * (this.input.fwd >= 0 ? MAX_SPEED : MAX_BACK); const k = Math.min(1, 10 * dt);
      this.vx += (tx - this.vx) * k; this.vz += (tz - this.vz) * k;
      p.x = THREE.MathUtils.clamp(p.x + this.vx * dt, -4.6, 4.6); p.z = THREE.MathUtils.clamp(p.z + this.vz * dt, -5, 6.5);
    }

    if (this.state === "rally") {
      this.advance(dt);
      const b = this.ball;
      if (b.bounces >= 3) this.kill("Quicou 3x");
      else if (b.z < p.z - 2.5 && b.vz < 0) this.kill("Passou");
      else if (b.y <= BALL_R + 0.01 && Math.hypot(b.vx, b.vz) < 0.3) this.kill("Parou");
      else if (this.time - this.serveTime > 40) this.kill("Tempo");
      if (!this.swing && this.state === "rally" && S.auto) { const pl = this.planAuto(); if (pl) this.startSwing(pl); }
    } else if (this.swing) { this.swing.t += dt * this.swing.s; }

    const sw = this.swing;
    if (sw) {
      const pr = Math.max(0, Math.min(1, (sw.t - sw.startT) / (sw.contactT - sw.startT))); const e = pr * pr * (3 - 2 * pr);
      p.x = sw.x0 + (sw.x1 - sw.x0) * e; p.z = sw.z0 + (sw.z1 - sw.z0) * e;
      if (sw.t >= sw.endT) { this.swing = null; }
    }
    this.animate(dt);
    this.rig.root.updateMatrixWorld(true);
    this.foot.enabled = S.footprints; this.foot.life = S.footLife; this.foot.update(dt, this.swing ? 0 : Math.hypot(this.vx, this.vz));
    this.syncVisuals(dt);
  }

  private animate(dt: number): void {
    const R = this.rig; const target = this.swing ? 1 : 0;
    this.swingW += Math.sign(target - this.swingW) * Math.min(Math.abs(target - this.swingW), dt / (target ? 0.15 : 0.3));
    const Lw = 1 - this.swingW;
    if (R.loco.ready) R.loco.step(R, dt, this.vx, this.vz, Lw);
    else {   // sem loco2.glb: locomoção do GLB principal
      const speed = Math.hypot(this.vx, this.vz); const m = Math.min(1, speed / MAX_SPEED);
      const f = this.vz, l = this.vx; const sum = Math.abs(f) + Math.abs(l) + 1e-6;
      const w: Record<string, number> = { idle: 1 - m, run_f: Math.max(f, 0) / sum * m, run_b: Math.max(-f, 0) / sum * m, run_l: Math.max(l, 0) / sum * m, run_r: Math.max(-l, 0) / sum * m };
      this.phase = (this.phase + dt * m / 0.75) % 1; this.idlePhase = (this.idlePhase + dt / 1.8) % 1;
      for (const n of LOCO) {
        const a = R.actions.get(n); if (!a) continue; const d = R.durations.get(n) ?? 1;
        a.setEffectiveWeight(w[n] * Lw); a.time = (n === "idle" ? this.idlePhase : this.phase) * d * 0.999;
      }
    }
    if (this.swingAct) {
      const sw = this.swing; const d = this.swingAct.getClip().duration;
      if (sw) this.swingAct.time = Math.min(sw.t, d - 1e-3);
      this.swingAct.setEffectiveWeight(this.swingW);
      if (!sw && this.swingW <= 0) { this.swingAct = null; }
    }
    R.mixer.update(0);
    const sw = this.swing; let fw = 0;
    if (sw) { const x = Math.max(0, 1 - Math.abs(sw.t - sw.contactT) / 0.3); fw = x * x * (3 - 2 * x) * S.faceAssist; }
    R.fixRacket(fw);
  }

  private syncVisuals(dt: number): void {
    const b = this.ball, p = this.rig.root.position;
    this.ballMesh.position.set(b.x, b.y, b.z); this.ballShadow.position.set(b.x, 0.012, b.z);
    this.ballShadow.scale.setScalar(Math.max(0.4, 1.2 - b.y * 0.25));
    this.playerShadow.position.set(p.x, 0.01, p.z);
    this.setCamera(false, dt);
  }

  private setCamera(snap: boolean, dt = 0.016): void {
    const p = this.rig.root.position; const k = snap ? 1 : Math.min(1, 6 * dt);
    const tp = new THREE.Vector3(p.x * 0.6, 2.5, p.z - 4.8);
    this.camera.position.lerp(tp, k);
    const look = new THREE.Vector3(p.x * 0.6, 1.1, p.z + 4); this.camera.lookAt(look);
  }

  render(): void { this.renderer.render(this.scene, this.camera); }
  advanceSeconds(sec: number): void { const n = Math.round(sec * 60); for (let i = 0; i < n; i++) this.tick(1 / 60); }
}
