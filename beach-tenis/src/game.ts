import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { Rig, LOCO, SWINGS, prepOf } from "./rig";
import { buildEnvironment, buildMatchCourt, blobTexture, COURT, MATCH, NET_H } from "./scene";
import { S, loadRecord, saveRecord } from "./settings";
import { Footprints } from "./footprints";
import { CueMarker } from "./cuemark";
import { STROKES, strokeOf, INTENT_W, FOLLOW, SERVE_CLIP, SERVE_FOLLOW, SERVE_START, TOSS_REL, tossApex } from "./strokes";
import { Stamina } from "./stamina";
import { PoseFX } from "./posefx";
import { WallFx } from "./wallfx";
import { Dust } from "./dust";
import { Opponent } from "./opponent";
import { Match, LEVELS, ScoreView, inCourt } from "./match";
import { FORMATS, PointResult, Side } from "./rules";
import { Ball, BALL_R, G, Sample, Tun, heightAtWall, newBall, predict, solveShot, stepBall } from "./physics";

const CAM_PITCH = 0.285;   // inclinação padrão da câmera (rad): 2,5 m de altura a 4,8 m atrás
const MAX_SPEED = 3.4, MAX_SIDE = 3.0, MAX_BACK = 2.6;   // m/s: frente, lado, ré (a ré é mais lenta, como no jogo de verdade)
const NO_EV: Ev[] = [];
interface Ev { clip: string; kind: string; key: string; prep: number; x1: number; z1: number; shift: number; need: number; dy: number; }
export interface Cand { clip: string; kind: string; key: string; prep: number; cx: number; cy: number; cz: number; }
const DEFAULT_CAND: Cand = { clip: "", kind: "ground", key: "fh_din", prep: 0.55, cx: -0.3, cy: 1.2, cz: 0.5 };   // se os clipes do vídeo não carregaram
/** saque: a bola sai da mão esquerda em `rel` (s do clipe) e sobe em arco até o ponto de contato com a raquete (mão em h*, contato em c*, mundo) */
interface Toss { rel: number; apex: number; hx: number; hy: number; hz: number; cx: number; cy: number; cz: number; }
interface Swing { toss?: Toss; startT: number; endT: number; clip: string; s: number; contactT: number; t: number; duration: number; x0: number; z0: number; x1: number; z1: number; contacted: boolean; kind: string; plan?: number[]; err: number; whiff: boolean; msg?: string; preview?: boolean; }
/** próxima rebatida: onde a jogadora deve estar, quando a bola chega e quando apertar GOLPE (tempos no relógio do jogo) */
interface Cue { arrival: number; press: number; prep: number; x1: number; z1: number; smp: Sample; clip: string; kind: string; key: string; shift: number; cost: number; }
export interface CueView { ttp: number; reach: boolean; win: number; label: string; out?: boolean; }
/** visualizador de golpes (galeria): o que a tela mostra */
export interface ViewState { clip: string; label: string; n: number; total: number; speed: number; paused: boolean; }
interface Viewer { clip: string; speed: number; paused: boolean; wait: number; prev: { yaw: number; pitch: number; dist: number }; }
// tempo (s) do começo do golpe ao contato vem de PREP (rig.ts); a bola chega PREP depois do aperto ideal. O clipe é acelerado/retardado
// (S_MIN..S_MAX) para o contato cair na bola quando o aperto vem um pouco cedo/tarde; fora disso o golpe passa em branco
export const S_MIN = 0.62, S_MAX = 1.9, DY_MAX = 0.2, NEED_MAX = 2.7, NEED_OK = 1.7, NEED_RELAX = 2.3;   // NEED: corrida (m/s) exigida para chegar ao ponto a tempo
const HOME = { x: 0, z: 0 }, WALK_HOME = 2.0;   // posição de saque (atrás da linha de fundo, no centro) e velocidade com que ela volta andando depois do ponto (m/s)
const WIN = { perfect: 0.07, good: 0.16 };   // erro de tempo (s) × Ajustes › janela
export interface LogEntry { t: number; type: string; [k: string]: unknown; }

export class Game {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(55, 1, 0.1, 150);
  renderer: THREE.WebGLRenderer;
  rig = new Rig(); foot: Footprints;
  ball: Ball = newBall();
  ballMesh: THREE.Object3D; ballShadow: THREE.Mesh; playerShadow: THREE.Mesh;
  tun: Tun = { eSand: 0.5, eWall: 0.75, wallZ: COURT.wallZ, wallW: COURT.wallW, wallH: COURT.wallH };   // eSand: só a bola depois do ponto; eWall: só sem devolução planejada
  input = { right: 0, fwd: 0 };
  state: "wait" | "serve" | "rally" | "dead" = "wait";   // serve: a jogadora saca (lança a bola e bate) antes de o rali começar
  rally = 0; record = loadRecord(); deadTimer = 0; time = 0; serveTime = 0;
  react = 0; reactT = 0; private walkAt = 0.5; private recBeaten = false;   // reação ao fim do ponto (0 nada, 1 suspiro, 2 comemoração), tempo desde o ponto e quando ela começa a voltar ao saque
  swing: Swing | null = null; swingAct: THREE.AnimationAction | null = null; swingW = 0;
  cue: Cue | null = null; cueOut = false; private lastCue: Cue | null = null; marker: CueMarker; perfects = 0;
  wallFx: WallFx; dust: Dust;
  match: Match | null = null; onScore: (v: ScoreView | null) => void = () => {}; onMatchEnd: (winner: Side, v: ScoreView) => void = () => {}; private matchEnded = false;
  mode: "train" | "match" = "train"; opp: Opponent | null = null; private envTrain: THREE.Group; private envMatch: THREE.Group; private shadowMat: THREE.Material;   // treino na parede ou partida contra a adversária
  fx: PoseFX | null = null; private fxBall = new THREE.Vector3();   // vida do personagem: olhar na bola, respiração, inclinação
  stamina = new Stamina(); private tired = false; private staSent = -1;   // fôlego: gasta correndo; sem fôlego a corrida fica mais lenta
  onStamina: (v: number, mul: number) => void = () => {};
  lastLaunch: { pass: number; want: string | null; ms: number } | null = null;   // diagnóstico: como a última bola foi escolhida
  intent: string | null = null; recent: string[] = [];   // golpe (chave de STROKES) que a bola lançada prepara; últimos golpes usados (variedade)
  cam = { yaw: 0, pitch: CAM_PITCH, dist: S.camDist };   // câmera em órbita em torno da jogadora: giro (360°), inclinação e distância (zoom)
  vx = 0; vz = 0; phase = 0; idlePhase = 0; alt = 0;
  log: LogEntry[] = [];
  onToast: (m: string, sub?: string) => void = () => {};
  onHud: () => void = () => {};
  onCue: (v: CueView | null) => void = () => {};
  onView: (v: ViewState | null) => void = () => {};
  viewer: Viewer | null = null;
  info = ""; private tmpV = new THREE.Vector3();

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.envTrain = buildEnvironment(this.scene, import.meta.env.BASE_URL).train; this.envMatch = buildMatchCourt(this.scene); this.foot = new Footprints(this.scene);
    const bt = blobTexture();
    const bm = new THREE.MeshBasicMaterial({ map: bt, transparent: true, depthWrite: false }); this.shadowMat = bm;
    this.playerShadow = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1.1), bm); this.playerShadow.rotation.x = -Math.PI / 2; this.playerShadow.position.y = 0.01; this.scene.add(this.playerShadow);
    this.ballShadow = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.3), bm); this.ballShadow.rotation.x = -Math.PI / 2; this.ballShadow.position.y = 0.012; this.scene.add(this.ballShadow);
    this.ballMesh = new THREE.Group(); this.ballMesh.add(new THREE.Mesh(new THREE.SphereGeometry(BALL_R, 20, 14), new THREE.MeshStandardMaterial({ color: 0xd8f23a, emissive: 0x6a7a10, roughness: 0.7 }))); this.scene.add(this.ballMesh);
    this.ballMesh.visible = false; this.ballShadow.visible = false;
    this.marker = new CueMarker(this.scene); this.wallFx = new WallFx(this.scene); this.dust = new Dust(this.scene); this.foot.onPlant = (x, z, sp) => this.dust.puff(x, z, sp);
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
    this.fx = new PoseFX(this.rig); this.foot.bind(this.rig.model); this.animate(0); this.rig.root.updateMatrixWorld(true); this.foot.calibrate();
    this.opp = new Opponent(this.rig, this.scene, this.shadowMat);
    this.setCamera(true);
  }

  /** treino na parede ou partida contra a adversária: troca cenário, física (parede × rede) e posições */
  setMode(mode: "train" | "match"): void {
    this.mode = mode; this.viewClose(); this.intent = null;
    const m = mode === "match"; if (!m) { this.match = null; this.onScore(null); }
    this.envTrain.visible = !m; this.envMatch.visible = m; this.opp?.setVisible(m);
    Object.assign(this.tun, m ? { wallZ: 99, net: { z: MATCH.netZ, h: NET_H, w: 2 * MATCH.halfW + 0.6 } } : { wallZ: COURT.wallZ, net: undefined });
    this.swing = null; this.state = "wait"; this.rally = 0; this.cue = null; this.lastCue = null; this.ballMesh.visible = false; this.ballShadow.visible = false;
    this.rig.root.position.set(0, 0, 0); this.vx = this.vz = 0; this.foot.clear();
    if (m) this.opp?.place(0, MATCH.len);
    this.setCamera(true); this.onHud();
  }

  /** onde ela espera o ponto: no treino, o centro atrás da linha de fundo; na partida, depende de quem saca */
  homePos(): { x: number; z: number } { return this.match ? { x: 0, z: this.match.homeZ(0) } : HOME; }

  /** começa uma partida contra a adversária (formato e nível); quem saca primeiro é a jogadora */
  startMatch(fmtId = "rapida", lvlId = "medio"): void {
    if (!this.opp) return;
    this.setMode("match"); this.matchEnded = false;
    this.match = new Match(this, this.opp, FORMATS[fmtId] ?? FORMATS.rapida, LEVELS[lvlId] ?? LEVELS.medio, 0);
    this.stamina.reset(); this.opp.stamina.reset(); this.onScore(this.match.view());
    this.nextPoint(); this.onHud();
  }
  endMatch(): void { this.setMode("train"); }

  /** próximo ponto da partida: quem saca é decidido pelo placar (a adversária saca sozinha; a jogadora, pelo botão ou no automático) */
  private nextPoint(): void {
    const m = this.match; if (!m) return;
    this.state = "wait"; this.react = 0; this.ballMesh.visible = false; this.ballShadow.visible = false; this.cue = null; this.lastCue = null; this.onScore(m.view());
    if (m.over !== null) return;
    if (m.score.server === 0) { if (S.autoServe) this.serve(); } else m.startServe();
  }

  /** fim do ponto na partida: placar, reações e volta aos lugares */
  endPoint(winner: Side, reason: string, r: PointResult): void {
    const m = this.match; if (!m || (this.state !== "rally" && this.state !== "serve")) return;
    if (this.swing && !this.swing.contacted) this.swing = null;
    this.state = "dead"; this.ball.ret = null;
    this.react = winner === 0 ? (this.rally >= 8 || r.game !== undefined ? 2 : 0) : this.rally < 3 ? 1 : 0; this.reactT = 0; this.deadTimer = [1.6, 1.9, 2.6][this.react]; this.walkAt = [0.7, 1.1, 1.9][this.react];
    this.stamina.restore(0.25); this.opp?.stamina.restore(0.25);
    const v = m.view(), pts = `${v.points[0]} – ${v.points[1]}`;
    this.onToast(`${winner === 0 ? "Ponto!" : "Ponto da adversária"} — ${reason}`, r.match !== undefined ? "Fim da partida" : r.set !== undefined ? "Set!" : r.game !== undefined ? `Game ${v.games[0]}–${v.games[1]}` : `${pts} · rali ${this.rally}`);
    this.emit("point", { winner, reason, rally: this.rally, games: v.games, points: v.points }); this.onScore(v); this.onHud();
  }

  applySettings(recalc = true): void {
    this.rig.faceAssist = S.faceAssist;
    this.rig.applyRacketTransform(S, S.playerScale);
    if (recalc) { this.rig.calibrate(S.contactOffset); this.candAll = null; }
    this.ballMesh.scale.setScalar(S.ballVisual); if (!this.viewer) this.cam.dist = S.camDist;
  }

  resize(): void {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false); this.camera.aspect = w / h;
    this.camera.fov = w / h < 0.8 ? 68 : 55; this.camera.updateProjectionMatrix();
  }

  emit(type: string, extra: Record<string, unknown> = {}): void {
    this.log.push({ t: +this.time.toFixed(3), type, ...extra }); if (this.log.length > 400) this.log.shift();
  }

  /** saque animado: a jogadora lança a bola com a mão esquerda e saca com o clipe do vídeo; no contato a bola segue para a parede e o rali começa */
  private serveStart(): boolean {
    const clip = SERVE_CLIP, r = this.rig, act = r.actions.get(clip), cl = r.contactLocal.get(clip); if (!act || !cl || !r.leftHand) return false;
    const p = r.root.position, dur = r.durations.get(clip) ?? 2, ct = r.ct(clip, S.contactOffset), h = r.measureObj(clip, TOSS_REL, r.leftHand);
    this.swing = { clip, s: S.timeScale, contactT: ct, t: SERVE_START, startT: SERVE_START, endT: Math.min(dur - 0.02, ct + SERVE_FOLLOW), duration: dur, x0: p.x, z0: p.z, x1: p.x, z1: p.z, contacted: false, kind: "serve", err: 0, whiff: false,
      toss: { rel: TOSS_REL, apex: tossApex((ct - TOSS_REL) / S.timeScale), hx: p.x + h.x, hy: h.y, hz: p.z + h.z, cx: p.x + cl.x, cy: cl.y, cz: p.z + cl.z } };
    if (this.match) this.match.serveBy = 0;
    this.swingAct = act; this.vx = 0; this.vz = 0; this.cue = null; this.lastCue = null; this.state = "serve"; this.rally = 0; this.react = 0; this.recBeaten = false; this.foot.clear();
    Object.assign(this.ball, newBall(), { x: p.x, y: 1.5, z: p.z });
    this.ballMesh.visible = true; this.ballShadow.visible = true; this.info = ""; this.emit("serve", { animated: true }); this.onHud(); return true;
  }

  /** saque em andamento: a bola fica na mão esquerda, sobe em arco e, no instante de contato do clipe, é rebatida */
  private serveStep(dt: number): void {
    this.cue = null; const sw = this.swing; if (!sw?.toss) { this.state = "wait"; return; }
    sw.t += dt * sw.s; const z = sw.toss, b = this.ball;
    if (sw.t >= z.rel) {
      const u = Math.min(1, (sw.t - z.rel) / Math.max(1e-3, sw.contactT - z.rel));
      b.x = z.hx + (z.cx - z.hx) * u; b.z = z.hz + (z.cz - z.hz) * u; b.y = z.hy + (z.cy - z.hy) * u + 4 * z.apex * u * (1 - u); b.vx = b.vy = b.vz = 0;
    }
    if (!sw.contacted && sw.t >= sw.contactT) { sw.t = sw.contactT; sw.contacted = true; this.doContact(sw); }
  }

  serve(): void {
    if (!this.rig.mixer) return;
    if (this.match && (this.match.score.server !== 0 || this.match.over !== null)) return;   // na partida a adversária saca no turno dela
    this.viewClose();
    if (this.swing && !this.swing.contacted) this.swing = null;
    if (this.serveStart()) return;
    const p = this.rig.root.position;
    Object.assign(this.ball, newBall(), { x: p.x - 0.3, y: 1.3, z: p.z + 1.0 });
    this.launch(THREE.MathUtils.clamp(p.x + (Math.random() - 0.5) * 2.4, -2.5, 2.5), S.ballSpeed * 1.05, false);
    this.state = "rally"; this.rally = 0; this.react = 0; this.recBeaten = false; this.serveTime = this.time; this.foot.clear(); this.cue = null; this.lastCue = null;
    this.ballMesh.visible = true; this.ballShadow.visible = true; this.emit("serve"); this.onHud();
  }

  /** dá à bola b a velocidade para atingir (tx,ty) na parede com a rapidez dada (ignora arrasto) */
  private aimBall(b: Ball, tx: number, ty: number, speed: number): void {
    const dx = tx - b.x, dz = COURT.wallZ - BALL_R - b.z; const hl = Math.hypot(dx, dz); const ux = dx / hl, uz = dz / hl;
    const hAt = (th: number): number => heightAtWall(b, speed * Math.cos(th) * ux, speed * Math.sin(th), speed * Math.cos(th) * uz, COURT.wallZ - BALL_R);
    let lo = -0.25, hi = 1.0;
    for (let i = 0; i < 12; i++) { const mid = (lo + hi) / 2; if (hAt(mid) < ty) lo = mid; else hi = mid; }
    const th = (lo + hi) / 2;
    b.vx = speed * Math.cos(th) * ux; b.vy = speed * Math.sin(th); b.vz = speed * Math.cos(th) * uz; b.bounces = 0;
  }

  /** fração da velocidade máxima que o fôlego atual permite (1 = descansada) */
  speedMul(): number { return S.stamina ? this.stamina.mul() : 1; }

  // ---------- tempo e posição ----------
  reachR(): number { return S.assist * (S.auto ? 1.6 : 1); }   // raio em que o golpe ainda leva a jogadora ao ponto certo

  /** golpe do vídeo se o clipe existe; senão o de mocap de tênis */
  private pick(clip: string, fallback: string): string { return this.rig.contactLocal.has(clip) ? clip : fallback; }

  /** golpes do vídeo (sem o saque) com o que precisa para avaliar uma bola: preparo e ponto de contato; recalculado quando o rig é recalibrado */
  private candAll: Cand[] | null = null; private candBy = new Map<string, Cand[]>();
  candList(only?: string): Cand[] {
    if (!this.candAll) {
      this.candAll = []; this.candBy.clear();
      for (const st of STROKES) {
        if (st.key === "saque") continue;
        const kind = st.key.startsWith("band") ? "volley" : st.overhead ? "over" : "ground";
        for (const clip of st.clips) { const cl = this.rig.contactLocal.get(clip); if (cl) this.candAll.push({ clip, kind, key: st.key, prep: prepOf(clip), cx: cl.x, cy: cl.y, cz: cl.z }); }
      }
    }
    if (!only) return this.candAll;
    let l = this.candBy.get(only); if (!l) { l = this.candAll.filter((c) => c.key === only); this.candBy.set(only, l); }
    return l;
  }

  /** golpes de mocap de tênis, só se o vídeo não carregou */
  private mocapCands(smp: Sample): Cand[] {
    const n = (this.alt % 2) + 1, mk = (clip: string, kind: string, key: string): Cand | null => { const cl = this.rig.contactLocal.get(clip); return cl ? { clip, kind, key, prep: prepOf(clip), cx: cl.x, cy: cl.y, cz: cl.z } : null; };
    const l = smp.y > 1.95 ? [mk(`smash_${n}`, "smash", "smash")] : smp.bounces === 0 && smp.y > 0.75 ? [mk(`fvolley_${n}`, "volley", "volley"), mk(`bvolley_${n}`, "volley", "volley")] : [mk(`forehand_${n}`, "ground", "fh_din"), mk(`backhand_${n}`, "ground", "bh_din")];
    return l.filter((c): c is Cand => !!c);
  }

  // ---------- visualizador de golpes (galeria) ----------
  /** clipes do vídeo disponíveis, na ordem da galeria */
  viewList(): string[] { return STROKES.flatMap((s) => s.clips).filter((c) => this.rig.actions.has(c)); }

  private viewState(): ViewState | null {
    const v = this.viewer; if (!v) return null; const l = this.viewList(), st = strokeOf(v.clip);
    return { clip: v.clip, label: st?.label ?? v.clip, n: l.indexOf(v.clip) + 1, total: l.length, speed: v.speed, paused: v.paused };
  }

  /** abre a galeria no golpe clip: interrompe o rali (a bola some), põe a câmera de frente e repete o golpe do vídeo em ciclo */
  viewStroke(clip: string): boolean {
    if (!this.rig.mixer || !this.rig.actions.has(clip) || this.match) return false;   // na partida a galeria não abre
    if (!this.viewer) {
      this.viewer = { clip, speed: 1, paused: false, wait: 0, prev: { ...this.cam } };
      this.state = "wait"; this.rally = 0; this.cue = null; this.lastCue = null; this.ballMesh.visible = false; this.ballShadow.visible = false;
      const p = this.rig.root.position; p.z = Math.min(p.z, 0);                          // a câmera de frente fica dentro da quadra (a parede é em +z)
      this.cam.yaw = 2.5; this.cam.pitch = 0.2; this.cam.dist = Math.min(this.cam.dist, 3.6);
    }
    this.viewer.clip = clip; this.swing = null; this.startView(); this.setCamera(true); this.onHud(); this.onView(this.viewState()); return true;
  }

  private startView(): void {
    const v = this.viewer; if (!v) return; const act = this.rig.actions.get(v.clip); if (!act) return;
    const p = this.rig.root.position, dur = this.rig.durations.get(v.clip) ?? 2, ct = Math.min(this.rig.ct(v.clip, S.contactOffset), dur - 0.05);
    this.swing = { clip: v.clip, s: v.paused ? 0 : v.speed, contactT: ct, t: 0, startT: 0, endT: dur - 0.02, duration: dur, x0: p.x, z0: p.z, x1: p.x, z1: p.z, contacted: false, kind: "preview", err: 0, whiff: true, preview: true };
    this.swingAct = act; this.vx = 0; this.vz = 0; this.cue = null; this.info = ""; v.wait = 0;
  }

  viewStep(d: number): void { const l = this.viewList(); if (this.viewer && l.length) this.viewStroke(l[(l.indexOf(this.viewer.clip) + d + l.length) % l.length]); }
  viewPause(on?: boolean): void { const v = this.viewer; if (!v) return; v.paused = on ?? !v.paused; if (this.swing?.preview) this.swing.s = v.paused ? 0 : v.speed; this.onView(this.viewState()); }
  viewSpeed(x: number): void { const v = this.viewer; if (!v) return; v.speed = x; if (this.swing?.preview && !v.paused) this.swing.s = x; this.onView(this.viewState()); }
  /** arrasta o tempo do golpe (0..1) */
  viewSeek(f: number): void { if (!this.viewer) return; if (!this.swing) this.startView(); if (this.swing?.preview) this.swing.t = Math.min(0.995, Math.max(0, f)) * this.swing.endT; }
  viewT(): number { const sw = this.swing; return sw?.preview ? Math.min(1, sw.t / sw.endT) : 0; }
  viewClose(): void {
    const v = this.viewer; if (!v) return; this.viewer = null; if (this.swing?.preview) this.swing = null;
    Object.assign(this.cam, v.prev); this.setCamera(true); this.onView(null); this.onHud();
  }

  // ---------- câmera ----------
  orbit(dyaw: number, dpitch: number): void { this.cam.yaw += dyaw; this.cam.pitch = THREE.MathUtils.clamp(this.cam.pitch + dpitch, 0.06, 1.35); }
  zoom(f: number): void { this.cam.dist = THREE.MathUtils.clamp(this.cam.dist * f, 1.8, 14); if (!this.viewer) S.camDist = this.cam.dist; }   // na galeria o zoom é temporário
  recenter(): void { this.cam.yaw = 0; this.cam.pitch = CAM_PITCH; }

  /** tempo (s) que a jogadora ainda fica parada no fim do golpe em andamento (0 sem golpe): não dá para correr nesse intervalo */
  lockLeft(): number { const sw = this.swing; return sw ? Math.max(0, (sw.endT - sw.t) / sw.s) : 0; }

  /** rebatidas possíveis na amostra smp para quem está em (px,pz): ponto do chão, velocidade necessária para chegar a tempo (need, m/s); lock = tempo parada antes de poder correr */
  evalSample(smp: Sample, px: number, pz: number, lock = 0, only?: string): Ev[] {
    if (smp.vz >= -0.2 || smp.bounces > 0 || smp.y < 0.12 || smp.y > 2.7) return NO_EV;   // bola viva: só no ar, antes de tocar a areia
    const out: Ev[] = [];
    const list = this.candList(only), cands = list.length ? list : (only ? [] : this.mocapCands(smp));
    const reach = this.reachR(), ts = S.timeScale;
    for (const c of cands) {
      const prep = c.prep / ts; if (smp.t < prep * 0.55) continue;
      const dy = Math.abs(smp.y - c.cy); if (dy > DY_MAX) continue;
      const x1 = smp.x - c.cx, z1 = smp.z - c.cz; if (x1 < -4.6 || x1 > 4.6 || z1 < -5 || z1 > (this.match ? MATCH.netZ - 0.7 : 6.5)) continue;
      const shift = Math.hypot(x1 - px, z1 - pz);
      out.push({ clip: c.clip, kind: c.kind, key: c.key, prep, x1, z1, shift, dy, need: Math.max(0, shift - reach) / Math.max(0.05, smp.t - lock - prep - 0.1) });
    }
    return out;
  }

  /** próxima rebatida confortável: onde ficar (x1,z1), quando a bola chega e quando apertar GOLPE. Prefere o ponto que exige menos corrida;
   *  mantém o marcador onde estava enquanto ainda dá para chegar e, se nada der, mostra o mais próximo mesmo assim (fica vermelho) */
  private computeCue(): void {
    this.cue = null; if (this.state !== "rally" || (this.swing && !this.swing.contacted)) return;
    const p = this.rig.root.position, prev = this.lastCue, lock = this.lockLeft(), last = this.recent[this.recent.length - 1];
    let best: Cue | null = null, keep: Cue | null = null, near: Cue | null = null; const needMax = NEED_MAX * (0.5 + 0.5 * this.speedMul());
    let lastS: Sample | null = null;
    for (const smp of predict(this.ball, this.tun, 5, 1 / 120, true)) {
      lastS = smp;
      for (const c of this.evalSample(smp, p.x, p.z, lock)) {
        const mk = (cost: number): Cue => ({ arrival: this.time + smp.t, press: this.time + smp.t - c.prep, prep: c.prep, x1: c.x1, z1: c.z1, smp, clip: c.clip, kind: c.kind, key: c.key, shift: c.shift, cost });
        if (prev && prev.clip === c.clip && Math.abs(prev.arrival - (this.time + smp.t)) < 0.1 && this.time < prev.arrival && c.need <= needMax * 1.3) { const k = mk(Math.abs(prev.arrival - (this.time + smp.t))); if (!keep || k.cost < keep.cost) keep = k; }
        if (c.need > needMax) { const k = mk(c.need); if (!near || k.cost < near.cost) near = k; continue; }
        const cost = 0.35 * smp.t + 1.6 * c.need / NEED_MAX + (this.match ? 0 : 0.12 * Math.max(0, c.z1 - 4.6)) + 1.2 * c.dy + (smp.t < c.prep + lock ? 1 : 0)
          - (c.key === this.intent ? 1.5 : 0) + (c.key === last ? 0.3 : 0);                                                              // prefere o golpe que a bola foi preparada para ter; evita repetir o último
        if (!best || cost < best.cost) best = mk(cost);
      }
    }
    this.cue = keep ?? best ?? near; if (this.cue) this.lastCue = this.cue;
    this.cueOut = !!this.match && !!lastS && lastS.y <= BALL_R + 0.03 && !inCourt(lastS.x, lastS.z) && lastS.z < MATCH.netZ;   // partida: a bola vai cair fora do meu lado (deixa passar e o ponto é meu)
  }

  /** sorteia o próximo golpe do treino (varia: não repete os 2 últimos) entre os do vídeo, com mais peso nos golpes de base */
  private pickIntent(not?: string): string | null {
    const pool = STROKES.filter((st) => INTENT_W[st.key] && st.key !== not && st.clips.some((c) => this.rig.contactLocal.has(c)) && !this.recent.slice(-2).includes(st.key));
    if (!pool.length) return null;
    let r = Math.random() * pool.reduce((a, st) => a + INTENT_W[st.key], 0);
    for (const st of pool) { r -= INTENT_W[st.key]; if (r <= 0) return st.key; }
    return pool[0].key;
  }

  /** altura (m) em que a bola prevista bate na parede; -1 se não chega lá */
  private wallY(b: Ball): number { for (const sm of predict(b, this.tun, 4.5, 1 / 60, true)) if (sm.wallHits > b.wallHits) return sm.y; return -1; }

  /** devolução planejada: a bola sai da parede em arco (Tr s) e passa pelo ponto de contato do golpe c quando a jogadora estiver em (x1,z1), na altura do clipe.
   *  Confere com o mesmo avaliador do aviso (evalSample): chega no ar, na altura certa e dá para chegar correndo (need ≤ lim). */
  private planReturn(leg: { b: Ball; w: Sample }, c: Cand, x1: number, z1: number, Tr: number, lim: number, lock: number): Ball | null {
    const v = solveShot({ x: leg.w.x, y: leg.w.y, z: this.tun.wallZ - BALL_R }, { x: x1 + c.cx, y: c.cy, z: z1 + c.cz }, Tr);
    if (v.vz > -1.5 || Math.hypot(v.vx, v.vz) > 14 || Math.hypot(v.vx, v.vy, v.vz) > 17 || (v.vy > 0 ? leg.w.y + v.vy * v.vy / (2 * G) : 0) > 4.3) return null;   // arco da devolução: sem foguete (apogeu até 4,3 m)
    const b: Ball = { ...leg.b, ret: v }, T = leg.w.t + Tr, p = this.rig.root.position;
    for (const sm of predict(b, this.tun, T + 0.06, 1 / 120, true)) {
      if (sm.wallHits <= b.wallHits || Math.abs(sm.t - T) > 0.05) continue;
      for (const e of this.evalSample(sm, p.x, p.z, lock, c.clip ? c.key : undefined)) if ((!c.clip || e.clip === c.clip) && e.dy <= 0.14 && e.need <= lim) return b;
    }
    return null;
  }

  /** manda a bola para a parede (tx = lado) e PLANEJA a devolução. Bola viva (beach tênis): não quica, é rebatida no ar. A parede devolve a bola em arco até o ponto
   *  de contato de um golpe sorteado (this.intent), na altura do clipe, a uma corrida que a jogadora aguenta (need); se não der, tenta o 2º sorteado, depois qualquer golpe.
   *  Se a velocidade pedida é baixa demais para a bola passar da rede na parede, ela sobe até conseguir. */
  private launch(tx: number, speed: number, smash: boolean): void {
    const p = this.rig.root.position, tStart = performance.now(), cl = (v: number) => THREE.MathUtils.clamp(v, -2.6, 2.6), rnd = (a: number, b: number) => a + (b - a) * Math.random();
    for (let i = 0; i < 14; i++) { const b2 = { ...this.ball, ret: null }; this.aimBall(b2, cl(tx), NET_H + 0.5, speed); if (this.wallY(b2) >= NET_H + 0.15) break; speed *= 1.07; }
    // 1ª perna: raquete → parede, sempre acima da rede e sem tocar a areia antes
    const tys = smash ? [NET_H + 0.2, NET_H + 0.35, NET_H + 0.5, NET_H + 0.7] : [NET_H + 0.2, NET_H + 0.4, NET_H + 0.6, NET_H + 0.8, NET_H + 1.0];   // abaixo do topo da parede (3 m)
    const legs: { b: Ball; w: Sample }[] = [], combos: [number, number][] = []; for (const ty of tys) for (const f of [1, 0.9, 1.12, 0.8]) combos.push([ty, f]);
    combos.sort(() => Math.random() - 0.5);
    for (const [ty, f] of combos) {   // alturas e velocidades em ordem aleatória; 6 primeiras pernas válidas bastam
      if (legs.length >= 6) break;
      const b2 = { ...this.ball, ret: null }; this.aimBall(b2, cl(tx), ty, speed * f);
      const w = predict(b2, this.tun, 3, 1 / 120, true).find((sm) => sm.wallHits > b2.wallHits);
      if (w && w.y >= NET_H + 0.1 && w.y <= this.tun.wallH - 0.2) legs.push({ b: b2, w });
    }
    const done = (b: Ball | null, pass: number, key: string | null): void => { if (b) Object.assign(this.ball, b); else { this.aimBall(this.ball, cl(p.x), tys[0], speed); this.ball.ret = null; } this.intent = key; this.lastLaunch = { pass, want: key, ms: +(performance.now() - tStart).toFixed(1) }; };
    if (!legs.length) { done(null, -1, null); return; }
    const w1 = this.pickIntent(), w2 = w1 ? this.pickIntent(w1) : null;
    const lock = this.lockLeft(), mul = 0.5 + 0.5 * this.speedMul(), reach = this.reachR(), ts = S.timeScale, pace = THREE.MathUtils.clamp(Math.sqrt(S.ballSpeed / speed), 0.85, 1.12);
    const ZMAX = [4.8, 5.3, 5.9], clamp = THREE.MathUtils.clamp;
    for (let a = 0; a < 60; a++) {   // 0–27: corrida confortável; 28–43: maior; 44–59: qualquer golpe, no limite
      const lvl = a < 28 ? 0 : a < 44 ? 1 : 2, want = lvl === 2 ? null : a % 3 === 2 ? (w2 ?? w1) : w1, list = this.candList(want ?? undefined);
      const c = list.length ? list[(Math.random() * list.length) | 0] : DEFAULT_CAND, leg = legs[(Math.random() * legs.length) | 0];
      const Tr = Math.max((c.cy >= 1.6 ? rnd(1.0, 1.4) : rnd(0.8, 1.15)) * pace, (this.tun.wallZ - p.z - c.cz - 2) / 11),   // lá no fundo a devolução precisa de mais tempo para chegar
         lim = [NEED_OK, NEED_RELAX, NEED_MAX][lvl] * mul, ta = Math.max(0.15, leg.w.t + Tr - lock - c.prep / ts - 0.1);
      const shift = Math.min(3.4, reach + lim * ta) * (lvl === 0 ? rnd(0.1, 0.85) : rnd(0, 0.95)), th = rnd(0, 2 * Math.PI);
      const b = this.planReturn(leg, c, clamp(p.x + shift * Math.sin(th), -4.3, 4.3), clamp(p.z + shift * Math.cos(th), -4.6, ZMAX[lvl]), Tr, lim, lock);
      if (b) { done(b, lvl, c.key); return; }
    }
    // último recurso: a bola vem exatamente no ponto de contato de um golpe de base, onde a jogadora está
    const c0 = this.candList("fh_din")[0] ?? DEFAULT_CAND;
    for (const Tr of [1.3, 1.1, 1.5]) { const b = this.planReturn(legs[0], c0, clamp(p.x, -4.3, 4.3), clamp(p.z, -4.6, 5.9), Tr, 1e9, lock); if (b) { done(b, 3, c0.key); return; } }
    done(legs[0].b, -1, null);   // sem plano: a parede reflete a bola como é
  }

  private beginSwing(clip: string, kind: string, ct: number, s: number, x1: number, z1: number, err: number, whiff: boolean, smp?: Sample, msg?: string): void {
    const act = this.rig.actions.get(clip); if (!act || this.swing) return;
    const p = this.rig.root.position; this.alt++; const st = this.rig.startT(clip, S.contactOffset), dur = this.rig.durations.get(clip) ?? 2;
    const plan = smp ? [smp.x, smp.y, smp.z, smp.t].map((v) => +v.toFixed(2)) : [];
    this.swing = { clip, s, contactT: ct, t: st, startT: st, endT: Math.min(dur - 0.02, ct + FOLLOW), duration: dur, x0: p.x, z0: p.z, x1, z1, contacted: false, kind, plan, err, whiff, msg };
    this.swingAct = act; this.vx = 0; this.vz = 0; this.cue = null;
    this.info = `${strokeOf(clip)?.label ?? clip} · erro ${Math.round(err * 1000)} ms`; this.emit("swing", { clip, s: +s.toFixed(2), err_ms: Math.round(err * 1000), whiff, plan });
  }

  /** GOLPE: dentro da janela a jogadora vai ao ponto e acerta; fora dela o golpe passa em branco ("Cedo!", "Tarde!", "Longe!") */
  manualSwing(): void {
    if (this.swing || this.state !== "rally") return;
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
    if (S.stamina) this.stamina.drain(sw.kind === "serve" ? 0.02 : sw.kind === "over" || sw.kind === "smash" ? 0.03 : 0.012);   // bater cansa (golpes por cima mais)
    const act = this.swingAct!; act.time = Math.min(sw.contactT, sw.duration - 1e-3);
    this.rig.root.position.set(sw.x1, 0, sw.z1); if (Math.hypot(sw.x1 - sw.x0, sw.z1 - sw.z0) > 0.25) this.dust.puff(sw.x1, sw.z1, 3.2);   // freada do golpe
    this.rig.mixer.update(0); this.rig.root.updateMatrixWorld(true); this.rig.fixRacket(this.rig.faceAssist); this.rig.root.updateMatrixWorld(true);
    const H = new THREE.Vector3(); this.rig.head.getWorldPosition(H);
    const b = this.ball; const B = new THREE.Vector3(b.x, b.y, b.z); const gap = H.distanceTo(B);
    this.emit("contact", { clip: sw.clip, gap_cm: Math.round(gap * 100), dy_cm: Math.round((B.y - H.y) * 100), err_ms: Math.round(sw.err * 1000), whiff: sw.whiff, hit: gap <= S.hitRadius, ball: [b.x, b.y, b.z].map((v) => +v.toFixed(2)), head: [H.x, H.y, H.z].map((v) => +v.toFixed(2)), plan: sw.plan });
    this.info = `${strokeOf(sw.clip)?.label ?? sw.clip} · erro ${Math.round(sw.err * 1000)} ms · distância ${Math.round(gap * 100)} cm`;
    if (sw.kind !== "serve" && gap > S.hitRadius) { this.onToast(sw.msg ?? (sw.err > 0 ? "Cedo!" : "Tarde!")); this.onHud(); return; }
    b.x = H.x; b.y = Math.max(H.y, BALL_R); b.z = H.z;                       // a bola encosta na face da raquete
    if (sw.kind === "serve") {   // saque: a bola vai para a parede e o rali começa
      if (this.match) this.match.playerShot(H, sw.clip, 1, this.input.right * -1, true); else this.launch(THREE.MathUtils.clamp(H.x + (Math.random() - 0.5) * 2.4, -2.5, 2.5), S.ballSpeed * 1.05, false);
      this.state = "rally"; this.rally = 0; this.serveTime = this.time; this.lastCue = null; this.onToast("Saque!"); this.onHud(); return;
    }
    const e = Math.abs(sw.err) / S.timing, q = e <= WIN.perfect ? 2 : e <= WIN.good ? 1 : 0;   // 2 perfeito, 1 bom, 0 fraco (cedo/tarde)
    const aim = this.input.right * -1;
    const spread = S.aimSpread * (q === 2 ? 0.4 : q === 1 ? 1 : 1.6);
    const tx = THREE.MathUtils.clamp(aim * 2.4 + (Math.random() - 0.5) * 2 * spread * (Math.abs(aim) > 0.3 ? 0.3 : 1), -2.6, 2.6);
    const smash = sw.kind === "smash" || sw.kind === "over";
    const speed = S.ballSpeed * (smash ? 1.25 : sw.kind === "volley" ? 0.9 : 1) * (q === 2 ? 1.12 : q === 1 ? 1 : 0.86);
    const st = strokeOf(sw.clip); if (st) { this.recent.push(st.key); if (this.recent.length > 4) this.recent.shift(); }   // antes de lançar: a próxima bola não repete este golpe
    if (this.match) this.match.playerShot(H, sw.clip, q, aim); else this.launch(tx, speed, smash);
    this.rally++; if (q === 2) this.perfects++; if (this.rally > this.record) { this.record = this.rally; saveRecord(this.record); this.recBeaten = this.rally >= 6; }
    this.onToast(q === 2 ? "Perfeito!" : q === 1 ? "Bom!" : sw.err > 0 ? "Cedo!" : "Tarde!", st?.label); this.onHud();
  }

  private advance(dt: number): void {
    const sim = (d: number) => { let r = d; while (r > 1e-6) { const h = Math.min(r, 1 / 120); this.handleEvent(stepBall(this.ball, h, this.tun)); r -= h; } };
    const step = (d: number) => { sim(d); if (this.swing) this.swing.t += d * this.swing.s; const o = this.match?.opp.swing; if (o) o.t += d * o.s; };
    let rem = dt;
    for (let n = 0; n < 4; n++) {   // contatos (da jogadora e da adversária) no instante exato: a bola anda até lá, bate e continua
      const sw = this.swing, m = this.match, tp = sw && !sw.contacted ? Math.max(0, (sw.contactT - sw.t) / sw.s) : Infinity, to = m ? m.timeToContact() : Infinity, next = Math.min(tp, to);
      if (!(next <= rem)) break;
      step(next); rem -= next;
      if (tp <= to) { sw!.t = sw!.contactT; sw!.contacted = true; this.doContact(sw!); } else { const o = m!.opp.swing!; o.t = o.contactT; o.contacted = true; m!.contact(o); }
      if (this.state !== "rally") return;
    }
    step(rem);
  }

  private handleEvent(ev: string | null): void {
    if (!ev) return;
    if (this.match) { if (this.state === "rally") { if (ev === "sand") this.match.onSand(); else if (ev === "net") this.match.onNet(); } return; }   // partida: o 1º toque na areia ou a rede decide o ponto
    if (ev === "wall") { this.wallFx.spawn(this.ball.x, this.ball.y, this.tun.wallZ - 0.03); this.emit("wall", { z: +this.ball.z.toFixed(2), y: +this.ball.y.toFixed(2) }); if (this.state === "rally" && this.ball.y < NET_H - 0.03) this.kill("Na rede"); }
    if (ev === "wallout" && this.state === "rally") this.kill("Fora da parede");
    if (ev === "sand" && this.state === "rally") this.kill(this.ball.vz > 0 ? "Bola curta" : "Quicou na areia");   // bola viva: o 1º toque na areia encerra o ponto
  }

  private kill(msg: string): void {
    if (this.state !== "rally") return; if (this.swing && !this.swing.contacted) this.swing = null; this.state = "dead"; this.ball.ret = null;
    this.react = this.recBeaten || this.rally >= 20 ? 2 : this.rally < 3 ? 1 : 0; this.reactT = 0; this.deadTimer = [1.3, 1.7, 2.4][this.react]; this.walkAt = [0.5, 1.1, 1.9][this.react];
     this.stamina.restore(0.25); this.onToast(`${msg} — rali ${this.rally}`); this.emit("dead", { msg, rally: this.rally }); this.onHud();
  }

  // ---------- loop ----------
  tick(dt: number): void {
    if (!this.rig.mixer) return;
    dt = Math.min(dt, 0.05); this.time += dt; const root = this.rig.root; const p = root.position;
    if (this.state === "dead") {
      this.deadTimer -= dt; this.reactT += dt;
      if (this.match) {   // partida: as duas voltam aos lugares e o ponto seguinte começa (ou acaba a partida)
        if (this.match.over !== null) { if (this.deadTimer <= -1.2 && !this.matchEnded) { this.matchEnded = true; this.onMatchEnd(this.match.over, this.match.view()); } }
        else if (this.deadTimer <= 0 && ((Math.hypot(p.x - this.homePos().x, p.z - this.homePos().z) < 0.3 || !S.autoServe) && this.match.atHome() || this.reactT > 6)) this.nextPoint();
      } else if (this.deadTimer <= 0 && (!S.autoServe || Math.hypot(p.x - HOME.x, p.z - HOME.z) < 0.25 || this.reactT > 5)) { this.state = "wait"; this.react = 0; if (S.autoServe) this.serve(); }   // saque automático: só depois de voltar à posição de saque
    }

    if (!this.swing && !this.viewer) {
      const cyw = Math.cos(this.cam.yaw), syw = Math.sin(this.cam.yaw);   // direcional relativo à câmera (com a câmera atrás da jogadora: frente = parede)
      const mx = -this.input.right * cyw + this.input.fwd * syw, mz = this.input.fwd * cyw + this.input.right * syw;
      const sm = this.speedMul(); let tx = mx * MAX_SIDE * sm, tz = mz * (mz >= 0 ? MAX_SPEED : MAX_BACK) * sm; const k = Math.min(1, 10 * dt);
      if (this.state === "dead" && S.autoServe && this.reactT > this.walkAt && Math.hypot(this.input.right, this.input.fwd) < 0.2) {   // depois do ponto volta andando à posição de saque
        const hm = this.homePos(), dx = hm.x - p.x, dz = hm.z - p.z, d = Math.hypot(dx, dz), sp = Math.min(WALK_HOME * sm, d * 2.5); tx = d > 0.04 ? dx / d * sp : 0; tz = d > 0.04 ? dz / d * sp : 0;
      }
      this.vx += (tx - this.vx) * k; this.vz += (tz - this.vz) * k;
      p.x = THREE.MathUtils.clamp(p.x + this.vx * dt, -4.6, 4.6); p.z = THREE.MathUtils.clamp(p.z + this.vz * dt, -5, this.match ? MATCH.netZ - 0.7 : 6.5);
    }

    if (S.stamina) {
      this.stamina.update(dt, Math.hypot(this.vx, this.vz), this.state === "dead" || this.state === "wait" || !!this.viewer);
      if (!this.tired && this.stamina.value < 0.12) { this.tired = true; this.onToast("Sem fôlego!"); } else if (this.tired && this.stamina.value > 0.4) this.tired = false;
    } else this.stamina.reset();
    if (this.match) this.match.update(dt);
    if (this.state === "rally") {
      this.advance(dt);
      const b = this.ball;
      if (this.match) { if (this.time - this.serveTime > 120 && this.state === "rally") this.match.pointEnd(1, "Tempo"); }
      else if (b.z < p.z - 2.5 && b.vz < 0) this.kill("Passou");
      else if (this.time - this.serveTime > 180) this.kill("Tempo");
      if (this.state === "rally") {
        this.computeCue();
        if (S.auto && !this.swing && this.cue && !this.cueOut && this.time >= this.cue.press && this.cue.shift <= this.reachR()) this.manualSwing();   // modo fácil: o jogo aperta na hora
      } else this.cue = null;
    } else if (this.state === "serve") { if (!(this.match && this.match.serveBy === 1)) this.serveStep(dt); else this.cue = null; }
    else { this.cue = null; if (this.swing) this.swing.t += dt * this.swing.s; if (this.state === "dead") for (let r = dt; r > 1e-6; r -= 1 / 120) stepBall(this.ball, Math.min(r, 1 / 120), this.tun); }   // depois do ponto a bola ainda quica e rola

    const sw = this.swing;
    if (sw) {
      const pr = Math.max(0, Math.min(1, (sw.t - sw.startT) / (sw.contactT - sw.startT))); const e = pr * pr * (3 - 2 * pr);
      p.x = sw.x0 + (sw.x1 - sw.x0) * e; p.z = sw.z0 + (sw.z1 - sw.z0) * e;
      if (sw.t >= sw.endT) { this.swing = null; if (this.viewer) this.viewer.wait = 0.7; }
    } else if (this.viewer) { this.viewer.wait -= dt; if (this.viewer.wait <= 0) this.startView(); }   // galeria: repete o golpe depois de uma pausa
    this.wallFx.update(dt); this.dust.update(dt); this.animate(dt);
    if (this.mode === "match" && this.opp) this.opp.animate(dt, this.time, (this.state === "rally" || this.state === "serve") && this.ballMesh.visible ? this.ball : null);
    this.rig.root.updateMatrixWorld(true);
    this.foot.enabled = S.footprints; this.foot.life = S.footLife; this.foot.update(dt, this.swing ? 0 : Math.hypot(this.vx, this.vz));
    this.syncVisuals(dt);
  }

  private animate(dt: number): void {
    const R = this.rig; const target = this.swing ? 1 : 0;
    this.swingW += Math.sign(target - this.swingW) * Math.min(Math.abs(target - this.swingW), dt / (target ? (this.swing?.kind === "serve" ? 0.35 : 0.15) : 0.3));
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
    if (this.fx) {   // vida do personagem por cima do clipe (olhar na bola, respiração, inclinação); fora na galeria
      this.fx.enabled = !this.viewer; R.root.updateMatrixWorld(true);
      const live = (this.state === "rally" || this.state === "serve") && this.ballMesh.visible;
      this.fx.update({ dt, time: this.time, ball: live ? this.fxBall.set(this.ball.x, this.ball.y, this.ball.z) : null, vx: this.vx, vz: this.vz, stamina: S.stamina ? this.stamina.value : 1, swingW: this.swingW, react: this.state === "dead" ? this.react : 0, rt: this.reactT });
    }
    const sw = this.swing; let fw = 0;
    if (sw) { const x = Math.max(0, 1 - Math.abs(sw.t - sw.contactT) / 0.3); fw = x * x * (3 - 2 * x) * S.faceAssist; }
    R.fixRacket(fw);
  }

  private syncVisuals(dt: number): void {
    const b = this.ball, p = this.rig.root.position;
    const sv = this.swing; if (this.state === "serve" && sv?.toss && sv.t < sv.toss.rel && this.rig.leftHand) { this.rig.leftHand.getWorldPosition(this.tmpV); b.x = this.tmpV.x; b.y = this.tmpV.y + 0.05; b.z = this.tmpV.z; }   // saque: a bola ainda está na mão esquerda
    this.ballMesh.position.set(b.x, b.y, b.z); this.ballShadow.position.set(b.x, 0.012, b.z);
    this.ballShadow.scale.setScalar(Math.max(0.4, 1.2 - b.y * 0.25));
    this.playerShadow.position.set(p.x, 0.01, p.z);
    const c = this.cue, v = c ? { ttp: c.press - this.time, reach: c.shift <= this.reachR(), win: WIN.good * S.timing, label: this.cueOut ? "Fora! Deixa passar" : strokeOf(c.clip)?.label ?? "", out: this.cueOut } : null;
    this.marker.update(c && v ? { x: c.x1, z: c.z1, ...v } : null, this.ballMesh.position); this.onCue(v);
    const sta = this.stamina.value; if (Math.abs(sta - this.staSent) > 0.004) { this.staSent = sta; this.onStamina(sta, this.stamina.mul()); }
    this.setCamera(false, dt);
  }

  private setCamera(snap: boolean, dt = 0.016): void {
    const p = this.rig.root.position, { yaw, pitch, dist } = this.cam; const k = snap ? 1 : Math.min(1, 8 * dt);
    const sy = Math.sin(yaw), cy = Math.cos(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
    const lead = this.viewer ? 0 : 4 * (1 - Math.min(1, pitch / 1.2));                 // olha à frente da jogadora; de cima, olha para ela
    const bx = p.x * (this.viewer ? 1 : 0.6);                                          // segue 60% do deslocamento lateral (na galeria, centrada nela)
    const tp = new THREE.Vector3(bx - sy * cp * dist, 1.1 + sp * dist, p.z - cy * cp * dist);
    this.camera.position.lerp(tp, k);
    this.camera.lookAt(bx + sy * lead, 1.1, p.z + cy * lead);
  }

  render(): void { this.renderer.render(this.scene, this.camera); }
  advanceSeconds(sec: number): void { const n = Math.round(sec * 60); for (let i = 0; i < n; i++) this.tick(1 / 60); }
}
