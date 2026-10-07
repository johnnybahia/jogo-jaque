import * as THREE from "three";
import { NEED_OK, NEED_RELAX } from "./game";
import type { Game, Cand } from "./game";
import type { Opponent, OppSwing } from "./opponent";
import { Score, Format, Side } from "./rules";
import { MATCH, NET_H } from "./scene";
import { BALL_R, Ball, Sample, Tun, predict, solveShot } from "./physics";
import { INTENT_W, FOLLOW, SERVE_CLIP, SERVE_FOLLOW, SERVE_START, TOSS_REL, tossApex, strokeOf } from "./strokes";
import { S } from "./settings";

/** nível da adversária: velocidade máxima (m/s), tempo de reação (s), chance de errar, quão difícil ela coloca a bola (× alcance), esperteza (deixa passar bola fora) */
export interface Level { id: string; label: string; speed: number; react: number; err: number; diff: number; smart: number; reach: number; }
export const LEVELS: Record<string, Level> = {
  facil: { id: "facil", label: "Fácil", speed: 2.6, react: 0.4, err: 0.2, diff: 0.55, smart: 0.45, reach: 1.0 },
  medio: { id: "medio", label: "Médio", speed: 3.1, react: 0.25, err: 0.11, diff: 0.85, smart: 0.8, reach: 1.4 },
  dificil: { id: "dificil", label: "Difícil", speed: 3.6, react: 0.14, err: 0.05, diff: 1.1, smart: 0.95, reach: 1.8 },
};

/** perfil de cada golpe: tempo de voo (s) e quão fundo (m depois da rede) a bola cai */
const PROFILE: Record<string, { T: number; d: [number, number] }> = {
  fh_din: { T: 1.1, d: [3.5, 6.5] }, fh_est: { T: 1.15, d: [3.5, 6.5] }, bh_din: { T: 1.1, d: [3.5, 6.5] }, bh_est: { T: 1.15, d: [3.5, 6.5] }, anomalo: { T: 1.2, d: [3, 6] },
  rainbow: { T: 1.8, d: [5, 7.2] }, band_fh: { T: 1.35, d: [3, 5.5] }, band_bh: { T: 1.35, d: [3, 5.5] }, arco: { T: 1.9, d: [5.5, 7.3] },
  smash: { T: 0.8, d: [2.5, 6] }, gancho: { T: 1.0, d: [3, 6] }, veronica: { T: 0.85, d: [3, 6.5] }, espeto: { T: 0.8, d: [1.5, 4] }, saque: { T: 1.4, d: [3.5, 7] },
};
const clamp = THREE.MathUtils.clamp;
/** a bola está dentro das linhas (a linha vale) */
export const inCourt = (x: number, z: number): boolean => Math.abs(x) <= MATCH.halfW + 0.05 && z >= -0.05 && z <= MATCH.len + 0.05;

interface AIPlan { arrival: number; startAt: number; x1: number; z1: number; clip: string; key: string; kind: string; whiff: boolean; err: boolean; stretch: number; }
export interface ScoreView { server: Side; games: [number, number]; sets: [number, number]; points: [string, string]; decisive: boolean; history: string; over: Side | null; fmt: string; fmtId: string; level: string; levelId: string; multi: boolean; }

/** Partida: placar, regras de ponto (rede, fora, bola na areia), golpe por cima da rede e a IA da adversária */
export class Match {
  score: Score; lastHitter: Side = 0; hitId = 0; over: Side | null = null;
  stats = { plans: 0, noPlan: 0, letGo: 0, whiff: 0, miss: 0, hit: 0, err: 0, serves: 0 };   // diagnóstico da IA
  private plan: AIPlan | null = null; private planned = -1; private hitAt = 0; private letGo = false; serveBy: Side = 0;
  private toss: { rel: number; apex: number; hx: number; hy: number; hz: number; cx: number; cy: number; cz: number } | null = null;
  private tmp = new THREE.Vector3(); private noNet: Tun;

  get opp(): Opponent { return this.o; }
  constructor(private g: Game, private o: Opponent, public fmt: Format, public lvl: Level, firstServer: Side = 0) {
    this.score = new Score(fmt, firstServer); this.noNet = { ...g.tun, net: undefined };
  }

  view(): ScoreView {
    const s = this.score, [a, b] = s.pointText();
    return { server: s.server, games: [...s.games], sets: [...s.sets], points: [a, b], decisive: s.decisive, history: s.history.map((h) => `${h[0]}-${h[1]}`).join(" "), over: this.over, fmt: this.fmt.label, fmtId: this.fmt.id, level: this.lvl.label, levelId: this.lvl.id, multi: this.fmt.setsToWin > 1 };
  }

  // ---------- tiro por cima da rede ----------
  /** velocidade para a bola sair de `from`, passar por cima da rede e cair em (lx, lz) em ~T s; null se nenhum arco passa da fita */
  private shotOver(from: THREE.Vector3, lx: number, lz: number, T0: number, clear: boolean): { v: { vx: number; vy: number; vz: number }; T: number } | null {
    for (let k = 0; k < 9; k++) {
      const T = T0 + 0.1 * k, v = solveShot(from, { x: lx, y: BALL_R, z: lz }, T);
      if (Math.hypot(v.vx, v.vy, v.vz) > 32) continue;
      if (!clear) return { v, T };
      const b: Ball = { x: from.x, y: from.y, z: from.z, vx: v.vx, vy: v.vy, vz: v.vz, bounces: 0, wallHits: 0, ret: null };
      let prev = from.z, ok = false;
      for (const sm of predict(b, this.noNet, T + 0.05, 1 / 120, true)) {
        if ((prev - MATCH.netZ) * (sm.z - MATCH.netZ) <= 0) { ok = sm.y >= NET_H + BALL_R + 0.1; break; }
        prev = sm.z;
      }
      if (ok) return { v, T };
    }
    return null;
  }

  /** lança a bola de `from` para (lx, lz): side 0 = jogadora, 1 = adversária; clear = confere a folga da rede (false: deixa bater na rede) */
  private launch(from: THREE.Vector3, lx: number, lz: number, T: number, side: Side, clear = true): void {
    const net = MATCH.netZ;
    let r = this.shotOver(from, lx, lz, T, clear);
    for (const k of [0.75, 0.5, 0.3]) if (!r) r = this.shotOver(from, lx, net + (lz - net) * k, T, clear);   // não passa: encurta a bola
    if (!r) r = this.shotOver(from, lx, lz, T, false);
    const v = r!.v, b = this.g.ball;
    Object.assign(b, { x: from.x, y: from.y, z: from.z, vx: v.vx, vy: v.vy, vz: v.vz, bounces: 0, wallHits: 0, ret: null });
    this.lastHitter = side; this.hitId++;
  }

  /** bola da jogadora: onde cai (mira + qualidade do tempo) e quanto voa (golpe + velocidade da bola nos ajustes) */
  playerShot(H: THREE.Vector3, clip: string, q: number, aim: number, serve = false): void {
    const key = serve ? "saque" : strokeOf(clip)?.key ?? "fh_din", pr = PROFILE[key] ?? PROFILE.fh_din;
    const spread = S.aimSpread * (q === 2 ? 0.35 : q === 1 ? 0.9 : 1.6);
    const lx = clamp(aim * 3.0 + (Math.random() - 0.5) * 2 * spread, -4.9, 4.9);
    let d = pr.d[0] + (pr.d[1] - pr.d[0]) * Math.random() + (q === 2 ? 0.5 : q === 0 ? -1.0 : 0);
    let T = pr.T * Math.pow(12.5 / S.ballSpeed, 0.6) * (serve ? 0.95 : q === 2 ? 0.94 : q === 0 ? 1.1 : 1), clear = true;
    if (!serve && q === 0) { const r = Math.random(); if (r < 0.2) { clear = false; T *= 0.6; } else if (r < 0.4) d += 3.2; }   // tempo ruim: bola na rede ou longa
    this.launch(H, lx, MATCH.netZ + clamp(d, 1, 9.5), T, 0, clear);
  }

  // ---------- pontos ----------
  /** o 1º toque na areia decide o ponto (bola viva): de quem foi o último golpe, em que lado caiu e se foi dentro das linhas */
  onSand(): void {
    const b = this.g.ball, side: Side = b.z < MATCH.netZ ? 0 : 1, H = this.lastHitter, inside = inCourt(b.x, b.z);
    if (side === H) this.pointEnd(H === 0 ? 1 : 0, H === 0 ? "Bola curta" : "Bola curta da adversária");
    else if (inside) this.pointEnd(H, H === 0 ? "Bola no chão da adversária" : "Quicou na areia");
    else this.pointEnd(H === 0 ? 1 : 0, H === 0 ? "Fora!" : "Fora da adversária");
  }
  onNet(): void { this.pointEnd(this.lastHitter === 0 ? 1 : 0, this.lastHitter === 0 ? "Na rede" : "Rede da adversária"); }

  pointEnd(winner: Side, reason: string): void {
    const g = this.g, o = this.o, r = this.score.pointWon(winner);
    if (r.match !== undefined) this.over = r.match;
    this.plan = null; this.letGo = false; this.toss = null;
    o.swing = null; o.react = winner === 1 ? (g.rally >= 8 ? 2 : 0) : 1; o.reactT = 0;
    g.endPoint(winner, reason, r);
  }

  // ---------- adversária (IA) ----------
  private cap(): number { return this.lvl.speed * 1.15 * (S.stamina ? this.o.stamina.mul() : 1); }   // corrida de ataque à bola (um pouco acima do passo normal)
  private homeX(): number { return clamp(-this.g.rig.root.position.x * 0.3, -1.5, 1.5); }
  /** onde cada uma espera o ponto: quem saca fica atrás da linha de fundo; quem recebe, um pouco à frente */
  homeZ(side: Side): number { const serving = this.score.server === side; return side === 0 ? (serving ? -0.3 : 1.5) : serving ? MATCH.len + 0.3 : MATCH.len - 1.6; }

  private moveTo(tx: number, tz: number, sp: number, dt: number): void {
    const o = this.o, dx = tx - o.x, dz = tz - o.z, d = Math.hypot(dx, dz), want = d > 0.05 ? Math.min(sp, d * 4) : 0, k = Math.min(1, 9 * dt);
    o.vx += ((d > 0.05 ? (dx / d) * want : 0) - o.vx) * k; o.vz += ((d > 0.05 ? (dz / d) * want : 0) - o.vz) * k;
    o.x = clamp(o.x + o.vx * dt, -5.2, 5.2); o.z = clamp(o.z + o.vz * dt, MATCH.netZ + 0.7, MATCH.len + 4);
  }

  /** onde e com qual golpe pegar a bola que vem: o ponto da trajetória (no ar) que dá para alcançar correndo, com o golpe de altura certa */
  private makePlan(): void {
    const g = this.g, o = this.o, lv = this.lvl, cap = this.cap(), ts = S.timeScale;
    this.plan = null; this.letGo = false; this.stats.plans++;
    const smps = predict(g.ball, g.tun, 5, 1 / 120, true), last = smps[smps.length - 1];
    if (last && last.y <= BALL_R + 0.02 && !inCourt(last.x, last.z) && Math.random() < lv.smart) { this.letGo = true; this.stats.letGo++; return; }   // vai cair fora: deixa passar
    let best: { cost: number; smp: { t: number; x: number; y: number; z: number }; c: Cand; x1: number; z1: number; need: number } | null = null;
    const cands = g.candList();
    for (const smp of smps) {
      if (smp.vz < 0.2 || smp.z < MATCH.netZ + 0.5 || smp.y < 0.3 || smp.y > 2.3 || smp.t < lv.react + 0.3) continue;
      for (const c of cands) {
        const dy = Math.abs(smp.y - c.cy); if (dy > 0.2) continue;
        const x1 = smp.x + c.cx, z1 = smp.z + c.cz;   // posição dela para o ponto de contato (o clipe é espelhado: ela olha para −z)
        if (Math.abs(x1) > 5.2 || z1 < MATCH.netZ + 0.8 || z1 > MATCH.len + 3.5) continue;
        const shift = Math.hypot(x1 - o.x, z1 - o.z), need = Math.max(0, shift - lv.reach) / Math.max(0.05, smp.t - lv.react - 0.6 * c.prep / ts - 0.1);   // o golpe acelera até 1,9× (preparo comprimido)
        if (need > cap) continue;
        const cost = 0.3 * smp.t + 1.5 * need / cap + 1.2 * dy - (INTENT_W[c.key] ?? 1) * 0.12 + Math.random() * 0.25;
        if (!best || cost < best.cost) best = { cost, smp, c, x1, z1, need };
      }
    }
    if (!best) { this.stats.noPlan++; return; }
    const stretch = clamp(best.need / cap, 0, 1), pErr = lv.err * (0.5 + 1.1 * stretch), r = Math.random();
    this.plan = { arrival: g.time + best.smp.t, startAt: g.time + best.smp.t - 0.8 * best.c.prep / ts, x1: best.x1, z1: best.z1, clip: best.c.clip, key: best.c.key, kind: best.c.kind, whiff: r < pErr * 0.35, err: r >= pErr * 0.35 && r < pErr, stretch };
  }

  private startSwing(p: AIPlan): void {
    const g = this.g, o = this.o, R = o.rig, act = R.actions.get(p.clip); if (!act) return;
    const st = R.startT(p.clip, S.contactOffset), ct = R.ct(p.clip, S.contactOffset), dur = R.durations.get(p.clip) ?? 2, dtp = Math.max(0.05, p.arrival - g.time);
    const s = clamp((ct - st) / dtp, 0.62, 1.9), shift = Math.hypot(p.x1 - o.x, p.z1 - o.z);
    o.swing = { clip: p.clip, key: p.key, kind: p.kind, s, t: st, startT: st, contactT: ct, endT: Math.min(dur - 0.02, ct + FOLLOW), duration: dur, x0: o.x, z0: o.z, x1: p.x1, z1: p.z1, contacted: false, serve: false, whiff: p.whiff || shift > this.lvl.reach * 1.5 + 0.2 };
    o.swingAct = act; o.vx = o.vz = 0;
  }

  /** contato da adversária (chamado no instante exato pelo Game.advance): confere a raquete na bola e devolve */
  contact(sw: OppSwing): void {
    const g = this.g, o = this.o, R = o.rig, b = g.ball, p = this.plan;
    o.x = sw.x1; o.z = sw.z1; const act = o.swingAct!; act.time = Math.min(sw.contactT, sw.duration - 1e-3);
    R.root.position.set(o.x, 0, o.z); R.mixer.update(0); R.root.updateMatrixWorld(true); R.fixRacket(1); R.root.updateMatrixWorld(true);
    const H = o.racketHead(this.tmp), gap = Math.hypot(H.x - b.x, H.y - b.y, H.z - b.z);
    g.emit("opp", { clip: sw.clip, gap_cm: Math.round(gap * 100), whiff: sw.whiff, serve: sw.serve });
    if (!sw.serve && (sw.whiff || gap > 0.55)) { this.plan = null; if (sw.whiff) this.stats.whiff++; else this.stats.miss++; return; }
    if (!sw.serve) this.stats.hit++;   // errou a bola: ela segue e o ponto se decide na areia
    b.x = H.x; b.y = Math.max(H.y, BALL_R); b.z = H.z;
    if (S.stamina) o.stamina.drain(sw.serve ? 0.02 : sw.kind === "over" ? 0.03 : 0.012);
    this.aiShot(sw.serve, p?.err ?? false); this.plan = null;
    if (sw.serve) { g.state = "rally"; g.rally = 0; g.serveTime = g.time; }
  }

  /** devolução da adversária: escolhe um golpe e um ponto de contato para a jogadora (a uma corrida que ela aguenta × nível: acima de 1 é bola vencedora), confere a rede e
   *  que a bola, se ninguém bater, cai dentro da quadra. Erra (rede ou fora) com a chance do nível. */
  private aiShot(serve: boolean, error: boolean): void {
    const g = this.g, lv = this.lvl, pl = g.rig.root.position, b = g.ball, H = new THREE.Vector3(b.x, b.y, b.z), ts = S.timeScale, rnd = (a: number, c: number) => a + (c - a) * Math.random();
    if (error) { this.stats.err++; this.aiError(H, serve); return; }
    const mulP = 0.5 + 0.5 * g.speedMul(), reachP = g.reachR(), lock = g.lockLeft(), keys = Object.keys(INTENT_W);
    for (let a = 0; a < 40; a++) {
      const key = keys[(Math.random() * keys.length) | 0], list = g.candList(key); if (!list.length) continue;
      const c = list[(Math.random() * list.length) | 0], Tf = serve ? rnd(1.25, 1.5) : rnd(0.95, 1.4) * (c.cy >= 1.6 ? 1.1 : 1);
      const lim = (a < 28 ? NEED_OK : NEED_RELAX) * mulP, ta = Math.max(0.15, Tf - lock - c.prep / ts - 0.1), shiftMax = Math.min(3.4, reachP + lim * ta);
      const shift = shiftMax * Math.min(1.3, lv.diff * rnd(0.15, 1.05)), th = rnd(0, 2 * Math.PI);
      const px = clamp(pl.x + shift * Math.sin(th), -3.8, 3.8), pz = clamp(pl.z + shift * Math.cos(th), 0.4, MATCH.netZ - 1.2);
      const C = new THREE.Vector3(px + c.cx, c.cy, pz + c.cz), v = solveShot(H, C, Tf);
      if (Math.hypot(v.vx, v.vy, v.vz) > 30) continue;
      const bb: Ball = { x: H.x, y: H.y, z: H.z, vx: v.vx, vy: v.vy, vz: v.vz, bounces: 0, wallHits: 0, ret: null };
      let prev = H.z, clear = false, atC: Sample | null = null, last: Sample | null = null;
      for (const sm of predict(bb, this.noNet, Tf + 2.5, 1 / 120, true)) {
        if (!clear && (prev - MATCH.netZ) * (sm.z - MATCH.netZ) <= 0) { clear = sm.y >= NET_H + BALL_R + 0.12; if (!clear) break; }
        prev = sm.z; if (!atC && sm.t >= Tf) atC = sm; last = sm;
      }
      if (!clear || !atC || !last || last.y > BALL_R + 0.03 || !inCourt(last.x, last.z)) continue;   // passa da rede e, se ninguém bater, cai dentro da quadra
      if (shift <= shiftMax) { let ok = false; for (const e of g.evalSample(atC, pl.x, pl.z, lock, c.key)) if (e.clip === c.clip && e.dy <= 0.14 && e.need <= lim) { ok = true; break; } if (!ok) continue; }
      Object.assign(b, { x: H.x, y: H.y, z: H.z, vx: v.vx, vy: v.vy, vz: v.vz, bounces: 0, wallHits: 0, ret: null }); this.lastHitter = 1; this.hitId++; return;
    }
    this.aiError(H, serve, true);   // nada serviu (raro): bola simples no meio
  }

  /** erro da adversária: bola na rede (baixa) ou fora (longa/aberta); com `soft`, uma bola mansa no meio */
  private aiError(H: THREE.Vector3, serve: boolean, soft = false): void {
    const pr = PROFILE[serve ? "saque" : "fh_din"], r = Math.random(); let lx = (Math.random() * 2 - 1) * 2, lz = 2 + Math.random() * 3, T = pr.T, clear = true;
    if (!soft) { if (r < 0.35) { clear = false; T *= 0.6; } else if (r < 0.7) lz = -(0.6 + Math.random() * 2.4); else lx = (Math.random() < 0.5 ? -1 : 1) * (4.4 + Math.random() * 1.4); }
    this.launch(H, lx, lz, T, 1, clear);
  }

  // ---------- saque da adversária ----------
  startServe(): void {
    const g = this.g, o = this.o, R = o.rig, clip = SERVE_CLIP, act = R.actions.get(clip), cl = R.contactLocal.get(clip);
    if (!act || !cl || !R.leftHand) { this.aiShot(true, false); g.state = "rally"; g.rally = 0; g.serveTime = g.time; return; }
    const dur = R.durations.get(clip) ?? 2, ct = R.ct(clip, S.contactOffset), h = R.measureObj(clip, TOSS_REL, R.leftHand);
    o.swing = { clip, key: "saque", kind: "serve", s: S.timeScale, t: SERVE_START, startT: SERVE_START, contactT: ct, endT: Math.min(dur - 0.02, ct + SERVE_FOLLOW), duration: dur, x0: o.x, z0: o.z, x1: o.x, z1: o.z, contacted: false, serve: true, whiff: false };
    o.swingAct = act; o.vx = o.vz = 0;
    this.toss = { rel: TOSS_REL, apex: tossApex((ct - TOSS_REL) / S.timeScale), hx: o.x + h.x, hy: h.y, hz: o.z + h.z, cx: o.x - cl.x, cy: cl.y, cz: o.z - cl.z };
    this.serveBy = 1; g.state = "serve"; g.rally = 0; g.cue = null; Object.assign(g.ball, { x: this.toss.hx, y: this.toss.hy, z: this.toss.hz, vx: 0, vy: 0, vz: 0, bounces: 0, ret: null });
    g.ballMesh.visible = true; g.ballShadow.visible = true; g.emit("serve", { by: "opp" }); g.onHud();
  }

  private serveStep(dt: number): void {
    const g = this.g, o = this.o, sw = o.swing, z = this.toss, b = g.ball; if (!sw || !z) { g.state = "wait"; return; }
    sw.t += dt * sw.s;
    if (sw.t >= z.rel) { const u = Math.min(1, (sw.t - z.rel) / Math.max(1e-3, sw.contactT - z.rel)); b.x = z.hx + (z.cx - z.hx) * u; b.z = z.hz + (z.cz - z.hz) * u; b.y = z.hy + (z.cy - z.hy) * u + 4 * z.apex * u * (1 - u); }
    else if (o.rig.leftHand) { o.rig.leftHand.getWorldPosition(this.tmp); b.x = this.tmp.x; b.y = this.tmp.y + 0.05; b.z = this.tmp.z; }
    b.vx = b.vy = b.vz = 0;
    if (!sw.contacted && sw.t >= sw.contactT) { sw.t = sw.contactT; sw.contacted = true; this.contact(sw); }
  }

  // ---------- quadro ----------
  /** chamar todo quadro da partida (antes de a física andar) */
  update(dt: number): void {
    const g = this.g, o = this.o;
    if (S.stamina) o.stamina.update(dt, Math.hypot(o.vx, o.vz), g.state !== "rally"); else o.stamina.reset();
    o.reactT += dt;
    if (g.state === "serve" && this.serveBy === 1) { this.serveStep(dt); return; }
    if (g.state === "rally") { this.rally(dt); return; }
    // fora do rali: acaba o golpe e volta ao lugar de saque (depois da reação)
    const sw = o.swing; if (sw) { sw.t += dt * sw.s; if (sw.t >= sw.endT) o.swing = null; }
    if (!o.swing) this.moveTo(this.homeX(), this.homeZ(1), g.state === "dead" && o.reactT < (o.react === 2 ? 1.9 : o.react === 1 ? 1.1 : 0.5) ? 0 : 2.0 * (S.stamina ? o.stamina.mul() : 1), dt);
  }

  private rally(dt: number): void {
    const g = this.g, o = this.o, lv = this.lvl, b = g.ball;
    if (this.lastHitter === 0 && this.planned !== this.hitId) { this.planned = this.hitId; this.hitAt = g.time; this.makePlan(); }
    const sw = o.swing;
    if (sw) {   // golpe em andamento: desliza até o ponto de contato (o tempo anda no Game.advance)
      const pr = clamp((sw.t - sw.startT) / Math.max(1e-3, sw.contactT - sw.startT), 0, 1), e = pr * pr * (3 - 2 * pr);
      o.x = sw.x0 + (sw.x1 - sw.x0) * e; o.z = sw.z0 + (sw.z1 - sw.z0) * e; o.vx = o.vz = 0;
      if (sw.t >= sw.endT) o.swing = null;
      return;
    }
    const cap = this.cap();
    if (this.plan) {
      if (g.time >= this.plan.startAt) { this.startSwing(this.plan); return; }
      this.moveTo(this.plan.x1, this.plan.z1, g.time - this.hitAt < lv.react ? 0 : cap, dt);
    } else if (this.lastHitter === 0 && !this.letGo) this.moveTo(clamp(b.x, -4.6, 4.6), clamp(b.z, MATCH.netZ + 1, MATCH.len + 3), g.time - this.hitAt < lv.react ? 0 : cap, dt);   // não alcança: corre atrás
    else this.moveTo(this.homeX(), MATCH.len - 3.2, cap * 0.7, dt);                                                                                                              // depois do golpe (ou deixando passar): volta ao centro
  }

  /** o relógio do golpe da adversária durante o rali anda no Game.advance; este é o tempo até o contato (s) ou Infinity */
  timeToContact(): number { const sw = this.o.swing; return sw && !sw.contacted && !sw.serve ? Math.max(0, (sw.contactT - sw.t) / sw.s) : Infinity; }
  /** a adversária está em posição de saque (para começar o ponto) */
  atHome(): boolean { const o = this.o; return Math.hypot(o.x - this.homeX(), o.z - this.homeZ(1)) < 0.35 && !o.swing; }
}

