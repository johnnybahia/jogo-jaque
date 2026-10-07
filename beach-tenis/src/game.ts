import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { Rig, LOCO, PREP, SWINGS, prepOf } from "./rig";
import { buildEnvironment, blobTexture, COURT } from "./scene";
import { S, loadRecord, saveRecord } from "./settings";
import { Footprints } from "./footprints";
import { CueMarker } from "./cuemark";
import { Ball, BALL_R, Sample, Tun, heightAtWall, newBall, predict, stepBall } from "./physics";

const CAM_PITCH = 0.285;   // inclinação padrão da câmera (rad): 2,5 m de altura a 4,8 m atrás
const MAX_SPEED = 3.4, MAX_SIDE = 3.0, MAX_BACK = 2.6;   // m/s: frente, lado, ré (a ré é mais lenta, como no jogo de verdade)
interface Swing { startT: number; endT: number; clip: string; s: number; contactT: number; t: number; duration: number; x0: number; z0: number; x1: number; z1: number; contacted: boolean; kind: string; plan?: number[]; err: number; whiff: boolean; msg?: string; preview?: boolean; }
/** próxima rebatida: onde a jogadora deve estar, quando a bola chega e quando apertar GOLPE (tempos no relógio do jogo) */
interface Cue { arrival: number; press: number; prep: number; x1: number; z1: number; smp: Sample; clip: string; kind: string; shift: number; cost: number; }
export interface CueView { ttp: number; reach: boolean; win: number; }
// tempo (s) do começo do golpe ao contato vem de PREP (rig.ts); a bola chega PREP depois do aperto ideal. O clipe é acelerado/retardado
// (S_MIN..S_MAX) para o contato cair na bola quando o aperto vem um pouco cedo/tarde; fora disso o golpe passa em branco
const S_MIN = 0.62, S_MAX = 1.9, DY_MAX = 0.2, NEED_MAX = 2.7, NEED_OK = 1.7, NEED_RELAX = 2.3;   // NEED: corrida (m/s) exigida para chegar ao ponto a tempo
const FOLLOW = 0.42;   // s de clipe depois do contato em que a jogadora ainda fica presa no golpe (depois volta a correr)
const WIN = { perfect: 0.07, good: 0.16 };   // erro de tempo (s) × Ajustes › janela
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
  cue: Cue | null = null; private lastCue: Cue | null = null; marker: CueMarker; perfects = 0;
  cam = { yaw: 0, pitch: CAM_PITCH, dist: S.camDist };   // câmera em órbita em torno da jogadora: giro (360°), inclinação e distância (zoom)
  vx = 0; vz = 0; phase = 0; idlePhase = 0; alt = 0;
  log: LogEntry[] = [];
  onToast: (m: string) => void = () => {};
  onHud: () => void = () => {};
  onCue: (v: CueView | null) => void = () => {};
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
    this.marker = new CueMarker(this.scene);
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
    this.ballMesh.scale.setScalar(S.ballVisual); this.cam.dist = S.camDist;
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
    this.launch(THREE.MathUtils.clamp(p.x + (Math.random() - 0.5) * 2.4, -2.5, 2.5), S.ballSpeed * 1.05, false);
    this.state = "rally"; this.rally = 0; this.serveTime = this.time; this.foot.clear(); this.cue = null; this.lastCue = null;
    this.ballMesh.visible = true; this.ballShadow.visible = true; this.emit("serve"); this.onHud();
  }

  /** dá à bola b a velocidade para atingir (tx,ty) na parede com a rapidez dada (ignora arrasto) */
  private aimBall(b: Ball, tx: number, ty: number, speed: number): void {
    const dx = tx - b.x, dz = COURT.wallZ - BALL_R - b.z; const hl = Math.hypot(dx, dz); const ux = dx / hl, uz = dz / hl;
    const hAt = (th: number): number => heightAtWall(b, speed * Math.cos(th) * ux, speed * Math.sin(th), speed * Math.cos(th) * uz, COURT.wallZ - BALL_R);
    let lo = -0.25, hi = 1.0;
    for (let i = 0; i < 18; i++) { const mid = (lo + hi) / 2; if (hAt(mid) < ty) lo = mid; else hi = mid; }
    const th = (lo + hi) / 2;
    b.vx = speed * Math.cos(th) * ux; b.vy = speed * Math.sin(th); b.vz = speed * Math.cos(th) * uz; b.bounces = 0;
  }

  // ---------- tempo e posição ----------
  private reachR(): number { return S.assist * (S.auto ? 1.6 : 1); }   // raio em que o golpe ainda leva a jogadora ao ponto certo

  /** golpe do vídeo se o clipe existe; senão o de mocap de tênis */
  private pick(clip: string, fallback: string): string { return this.rig.contactLocal.has(clip) ? clip : fallback; }

  private candidates(smp: Sample): { clip: string; kind: string }[] {
    const n = (this.alt % 2) + 1;
    if (smp.y > 1.95) return [{ clip: this.pick(`v_smash_${n}`, `smash_${n}`), kind: "smash" }];
    if (smp.bounces === 0 && smp.y > 0.75) return [{ clip: `fvolley_${n}`, kind: "volley" }, { clip: `bvolley_${n}`, kind: "volley" }];
    return [{ clip: this.pick(n === 1 ? "v_fh_din_1" : "v_fh_est_1", `forehand_${n}`), kind: "ground" }, { clip: this.pick(n === 1 ? "v_bh_din_1" : "v_bh_est_1", `backhand_${n}`), kind: "ground" }];
  }

  /** prévia de um golpe (galeria dos Ajustes): toca o clipe inteiro no lugar, sem bola */
  previewStroke(clip: string): boolean {
    if (!this.rig.mixer || this.swing || this.state === "rally") return false;
    const act = this.rig.actions.get(clip); if (!act) return false;
    const p = this.rig.root.position, dur = this.rig.durations.get(clip) ?? 2, ct = Math.min(this.rig.ct(clip, S.contactOffset), dur - 0.05);
    this.swing = { clip, s: 1, contactT: ct, t: 0, startT: 0, endT: dur - 0.02, duration: dur, x0: p.x, z0: p.z, x1: p.x, z1: p.z, contacted: false, kind: "preview", err: 0, whiff: true, preview: true };
    this.swingAct = act; this.vx = 0; this.vz = 0; this.cue = null; this.info = `prévia: ${clip}`; this.onHud(); return true;
  }

  // ---------- câmera ----------
  orbit(dyaw: number, dpitch: number): void { this.cam.yaw += dyaw; this.cam.pitch = THREE.MathUtils.clamp(this.cam.pitch + dpitch, 0.06, 1.35); }
  zoom(f: number): void { this.cam.dist = S.camDist = THREE.MathUtils.clamp(this.cam.dist * f, 1.8, 14); }
  recenter(): void { this.cam.yaw = 0; this.cam.pitch = CAM_PITCH; }

  /** tempo (s) que a jogadora ainda fica parada no fim do golpe em andamento (0 sem golpe): não dá para correr nesse intervalo */
  private lockLeft(): number { const sw = this.swing; return sw ? Math.max(0, (sw.endT - sw.t) / sw.s) : 0; }

  /** rebatidas possíveis na amostra smp para quem está em (px,pz): ponto do chão, velocidade necessária para chegar a tempo (need, m/s); lock = tempo parada antes de poder correr */
  private evalSample(smp: Sample, px: number, pz: number, n: number, lock = 0): { clip: string; kind: string; prep: number; x1: number; z1: number; shift: number; need: number; dy: number }[] {
    type Ev = { clip: string; kind: string; prep: number; x1: number; z1: number; shift: number; need: number; dy: number };
    const out: Ev[] = [];
    if (smp.vz >= -0.2 || smp.bounces > 2 || smp.y < 0.12 || smp.y > 2.7) return out;
    const alt = this.alt; this.alt = n - 1;                              // candidates() usa a variante do golpe (1/2) pela paridade de alt
    const cands = this.candidates(smp); this.alt = alt;
    for (const { clip, kind } of cands) {
      const prep = (PREP[kind] ?? PREP.ground) / S.timeScale; if (smp.t < prep * 0.55) continue;
      const cl = this.rig.contactLocal.get(clip); if (!cl) continue;
      const dy = Math.abs(smp.y - cl.y); if (dy > DY_MAX) continue;
      const x1 = smp.x - cl.x, z1 = smp.z - cl.z; if (x1 < -4.6 || x1 > 4.6 || z1 < -5 || z1 > 6.5) continue;
      const shift = Math.hypot(x1 - px, z1 - pz);
      out.push({ clip, kind, prep, x1, z1, shift, dy, need: Math.max(0, shift - this.reachR()) / Math.max(0.05, smp.t - lock - prep - 0.1) });
    }
    return out;
  }

  /** próxima rebatida confortável: onde ficar (x1,z1), quando a bola chega e quando apertar GOLPE. Prefere o ponto que exige menos corrida;
   *  mantém o marcador onde estava enquanto ainda dá para chegar e, se nada der, mostra o mais próximo mesmo assim (fica vermelho) */
  private computeCue(): void {
    this.cue = null; if (this.state !== "rally" || (this.swing && !this.swing.contacted)) return;
    const p = this.rig.root.position, prev = this.lastCue, lock = this.lockLeft(), n = (this.alt % 2) + 1;
    let best: Cue | null = null, keep: Cue | null = null, near: Cue | null = null;
    for (const smp of predict(this.ball, this.tun, 5, 1 / 120)) {
      for (const c of this.evalSample(smp, p.x, p.z, n, lock)) {
        const mk = (cost: number): Cue => ({ arrival: this.time + smp.t, press: this.time + smp.t - c.prep, prep: c.prep, x1: c.x1, z1: c.z1, smp, clip: c.clip, kind: c.kind, shift: c.shift, cost });
        if (prev && prev.clip === c.clip && Math.abs(prev.arrival - (this.time + smp.t)) < 0.1 && this.time < prev.arrival && c.need <= NEED_MAX * 1.3) { const k = mk(Math.abs(prev.arrival - (this.time + smp.t))); if (!keep || k.cost < keep.cost) keep = k; }
        if (c.need > NEED_MAX) { const k = mk(c.need); if (!near || k.cost < near.cost) near = k; continue; }
        const cost = 0.35 * smp.t + 1.6 * c.need / NEED_MAX + (c.kind === "volley" ? 1.6 : c.kind === "smash" ? 1.2 : 0) + 0.12 * Math.max(0, c.z1 - 4.6) + 1.2 * c.dy + (smp.t < c.prep + lock ? 1 : 0) + (smp.bounces > 1 ? 1.5 * (smp.bounces - 1) : 0);   // 2º quique é último recurso
        if (!best || cost < best.cost) best = mk(cost);
      }
    }
    this.cue = keep ?? best ?? near; if (this.cue) this.lastCue = this.cue;
  }

  /** a devolução da parede passa, depois do 1º quique, por altura de golpe de fundo, perto o bastante e com tempo de sobra? (relaxed: aceita corrida maior e quique 1–2) */
  private hittable(b: Ball, relaxed = false): boolean {
    const p = this.rig.root.position, n = (this.alt % 2) + 1, need = relaxed ? NEED_RELAX : NEED_OK, lock = this.lockLeft();
    for (const smp of predict(b, this.tun, 5, 1 / 120)) {
      if (smp.bounces < 1 || smp.bounces > (relaxed ? 2 : 1) || smp.t < 1.0 || smp.y < 0.8 || smp.y > 1.25) continue;
      for (const c of this.evalSample(smp, p.x, p.z, n, lock)) if (c.kind === "ground" && c.dy <= 0.14 && c.z1 <= (relaxed ? 5.9 : 5.4) && c.need <= need) return true;
    }
    return false;
  }

  /** manda a bola para a parede (tx = lado); testa alturas, velocidades e lados (do pedido da jogadora até reto nela) até achar uma devolução rebatível */
  private launch(tx: number, speed: number, smash: boolean): void {
    const p = this.rig.root.position, cl = (v: number) => THREE.MathUtils.clamp(v, -2.6, 2.6);
    const tys = (smash ? [0.7, 0.9, 1.1, 1.3] : [1.1, 1.3, 1.5, 1.7, 1.9, 2.1, 2.3, 2.5]).sort(() => Math.random() - 0.5);
    const txs = [tx, (tx + p.x) / 2, p.x, p.x + 0.7, p.x - 0.7, (tx + p.x) / 2 + 1.2, (tx + p.x) / 2 - 1.2].map(cl);
    for (const relaxed of [false, true]) for (const t of txs) for (const f of [1, 0.9, 1.12, 0.8]) for (const ty of tys) {
      const b2 = { ...this.ball }; this.aimBall(b2, t, ty, speed * f);
      if (this.hittable(b2, relaxed)) { Object.assign(this.ball, b2); return; }
    }
    this.aimBall(this.ball, tx, tys[0], speed);
  }

  private beginSwing(clip: string, kind: string, ct: number, s: number, x1: number, z1: number, err: number, whiff: boolean, smp?: Sample, msg?: string): void {
    const act = this.rig.actions.get(clip); if (!act || this.swing) return;
    const p = this.rig.root.position; this.alt++; const st = this.rig.startT(clip, S.contactOffset), dur = this.rig.durations.get(clip) ?? 2;
    const plan = smp ? [smp.x, smp.y, smp.z, smp.t].map((v) => +v.toFixed(2)) : [];
    this.swing = { clip, s, contactT: ct, t: st, startT: st, endT: Math.min(dur - 0.02, ct + FOLLOW), duration: dur, x0: p.x, z0: p.z, x1, z1, contacted: false, kind, plan, err, whiff, msg };
    this.swingAct = act; this.vx = 0; this.vz = 0; this.cue = null;
    this.info = `${clip} ×${s.toFixed(2)} erro ${Math.round(err * 1000)} ms`; this.emit("swing", { clip, s: +s.toFixed(2), err_ms: Math.round(err * 1000), whiff, plan });
  }

  /** GOLPE: dentro da janela a jogadora vai ao ponto e acerta; fora dela o golpe passa em branco ("Cedo!", "Tarde!", "Longe!") */
  manualSwing(): void {
    if (this.swing || this.state === "wait" || this.state === "dead") return;
    const cue = this.cue ?? (this.lastCue && this.time - this.lastCue.press < 0.5 ? this.lastCue : null); if (!cue) { this.whiff(1); return; }   // lastCue: apertou um pouco depois da bola passar da janela
    const dtp = cue.arrival - this.time, err = dtp - cue.prep;                       // err > 0: apertou cedo; < 0: tarde
    const ct = this.rig.ct(cue.clip, S.contactOffset), st = this.rig.startT(cue.clip, S.contactOffset), s = (ct - st) / Math.max(dtp, 1e-3);
    if (cue.shift > this.reachR() + 1e-3) { this.whiff(err, "Longe!"); return; }
    if (s < S_MIN || s > S_MAX) { this.whiff(err); return; }
    this.beginSwing(cue.clip, cue.kind, ct, s, cue.x1, cue.z1, err, false, cue.smp);
  }

  private whiff(err: number, msg?: string): void {
    const p = this.rig.root.position, n = (this.alt % 2) + 1, clip = this.ball.x <= p.x ? this.pick(n === 1 ? "v_fh_din_1" : "v_fh_est_1", `forehand_${n}`) : this.pick(n === 1 ? "v_bh_din_1" : "v_bh_est_1", `backhand_${n}`);
    this.beginSwing(clip, "ground", this.rig.ct(clip, S.contactOffset), S.timeScale, p.x, p.z, err, true, undefined, msg);
  }

  // ---------- contato ----------
  private doContact(sw: Swing): void {
    if (sw.preview) return;
    const act = this.swingAct!; act.time = Math.min(sw.contactT, sw.duration - 1e-3);
    this.rig.root.position.set(sw.x1, 0, sw.z1);
    this.rig.mixer.update(0); this.rig.root.updateMatrixWorld(true); this.rig.fixRacket(this.rig.faceAssist); this.rig.root.updateMatrixWorld(true);
    const H = new THREE.Vector3(); this.rig.head.getWorldPosition(H);
    const b = this.ball; const B = new THREE.Vector3(b.x, b.y, b.z); const gap = H.distanceTo(B);
    this.emit("contact", { clip: sw.clip, gap_cm: Math.round(gap * 100), dy_cm: Math.round((B.y - H.y) * 100), err_ms: Math.round(sw.err * 1000), whiff: sw.whiff, hit: gap <= S.hitRadius, ball: [b.x, b.y, b.z].map((v) => +v.toFixed(2)), head: [H.x, H.y, H.z].map((v) => +v.toFixed(2)), plan: sw.plan });
    this.info = `${sw.clip} erro ${Math.round(sw.err * 1000)} ms gap ${Math.round(gap * 100)} cm`;
    if (gap > S.hitRadius) { this.onToast(sw.msg ?? (sw.err > 0 ? "Cedo!" : "Tarde!")); this.onHud(); return; }
    b.x = H.x; b.y = Math.max(H.y, BALL_R); b.z = H.z;                       // a bola encosta na face da raquete
    const e = Math.abs(sw.err) / S.timing, q = e <= WIN.perfect ? 2 : e <= WIN.good ? 1 : 0;   // 2 perfeito, 1 bom, 0 fraco (cedo/tarde)
    const aim = this.input.right * -1;
    const spread = S.aimSpread * (q === 2 ? 0.4 : q === 1 ? 1 : 1.6);
    const tx = THREE.MathUtils.clamp(aim * 2.4 + (Math.random() - 0.5) * 2 * spread * (Math.abs(aim) > 0.3 ? 0.3 : 1), -2.6, 2.6);
    const smash = sw.kind === "smash";
    const speed = S.ballSpeed * (smash ? 1.25 : sw.kind === "volley" ? 0.9 : 1) * (q === 2 ? 1.12 : q === 1 ? 1 : 0.86);
    this.launch(tx, speed, smash);
    this.rally++; if (q === 2) this.perfects++; if (this.rally > this.record) { this.record = this.rally; saveRecord(this.record); }
    this.onToast(q === 2 ? "Perfeito!" : q === 1 ? "Bom!" : sw.err > 0 ? "Cedo!" : "Tarde!"); this.onHud();
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
      const cyw = Math.cos(this.cam.yaw), syw = Math.sin(this.cam.yaw);   // direcional relativo à câmera (com a câmera atrás da jogadora: frente = parede)
      const mx = -this.input.right * cyw + this.input.fwd * syw, mz = this.input.fwd * cyw + this.input.right * syw;
      const tx = mx * MAX_SIDE, tz = mz * (mz >= 0 ? MAX_SPEED : MAX_BACK); const k = Math.min(1, 10 * dt);
      this.vx += (tx - this.vx) * k; this.vz += (tz - this.vz) * k;
      p.x = THREE.MathUtils.clamp(p.x + this.vx * dt, -4.6, 4.6); p.z = THREE.MathUtils.clamp(p.z + this.vz * dt, -5, 6.5);
    }

    if (this.state === "rally") {
      this.advance(dt);
      const b = this.ball;
      if (b.bounces >= 3) this.kill("Quicou 3x");
      else if (b.z < p.z - 2.5 && b.vz < 0) this.kill("Passou");
      else if (b.y <= BALL_R + 0.01 && Math.hypot(b.vx, b.vz) < 0.3) this.kill("Parou");
      else if (this.time - this.serveTime > 180) this.kill("Tempo");
      if (this.state === "rally") {
        this.computeCue();
        if (S.auto && !this.swing && this.cue && this.time >= this.cue.press && this.cue.shift <= this.reachR()) this.manualSwing();   // modo fácil: o jogo aperta na hora
      } else this.cue = null;
    } else { this.cue = null; if (this.swing) this.swing.t += dt * this.swing.s; }

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
    for (const n of SWINGS) {   // golpe anterior ainda desvanecendo quando começa outro: sai de cena (antes ficava com o peso congelado e deformava o contato)
      const a = R.actions.get(n); if (!a || a === this.swingAct) continue;
      const w = a.getEffectiveWeight(); if (w > 0) a.setEffectiveWeight(Math.max(0, w - dt / 0.2));
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
    const c = this.cue, v = c ? { ttp: c.press - this.time, reach: c.shift <= this.reachR(), win: WIN.good * S.timing } : null;
    this.marker.update(c && v ? { x: c.x1, z: c.z1, ...v } : null, this.ballMesh.position); this.onCue(v);
    this.setCamera(false, dt);
  }

  private setCamera(snap: boolean, dt = 0.016): void {
    const p = this.rig.root.position, { yaw, pitch, dist } = this.cam; const k = snap ? 1 : Math.min(1, 8 * dt);
    const sy = Math.sin(yaw), cy = Math.cos(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
    const lead = 4 * (1 - Math.min(1, pitch / 1.2));                                   // olha à frente da jogadora; de cima, olha para ela
    const bx = p.x * 0.6;                                                              // segue 60% do deslocamento lateral
    const tp = new THREE.Vector3(bx - sy * cp * dist, 1.1 + sp * dist, p.z - cy * cp * dist);
    this.camera.position.lerp(tp, k);
    this.camera.lookAt(bx + sy * lead, 1.1, p.z + cy * lead);
  }

  render(): void { this.renderer.render(this.scene, this.camera); }
  advanceSeconds(sec: number): void { const n = Math.round(sec * 60); for (let i = 0; i < n; i++) this.tick(1 / 60); }
}
