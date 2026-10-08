import * as THREE from "three";
import { NEED_OK, NEED_RELAX } from "./game";
import type { Game, Cand } from "./game";
import type { Opponent, OppSwing } from "./opponent";
import { Score, Format, Side } from "./rules";
import { MATCH, NET_H } from "./scene";
import { BALL_R, Ball, Sample, Tun, predict, solveShot } from "./physics";
import { INTENT_W, FOLLOW, SERVE_CLIP, SERVE_FOLLOW, SERVE_START, TOSS_REL, tossApex, strokeOf } from "./strokes";
import { S } from "./settings";
import { fitCost } from "./fit";

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

/** s depois do último ponto da partida em que as vencedoras começam a ir ao ponto de comemoração */
export const CELEB_AT = 0.7;
const LANE = 2.0, BLOCK = 0.8;   // centro de cada corredor da dupla (m) e quanto a parceira acompanha, em bloco, o deslocamento lateral da outra ("corda invisível")
const NAMES: [[string, string], [string, string]] = [["Jaqueline", "Lari"], ["Bia", "Duda"]];

interface AIPlan { arrival: number; startAt: number; x1: number; z1: number; clip: string; key: string; kind: string; whiff: boolean; err: boolean; stretch: number; }
/** atleta controlada pelo computador (a adversária ou, nas duplas, a parceira da jogadora) e o estado da IA dela */
export interface Ai { o: Opponent; team: Side; idx: 0 | 1; lvl: Level; plan: AIPlan | null; hitAt: number; letGo: boolean; chase: boolean; }
/** quem está em quadra além da jogadora: a parceira (duplas) e as adversárias (1 no single, 2 nas duplas) */
export interface Lineup { partner: Opponent | null; foes: Opponent[]; }
export interface ScoreView { server: Side; games: [number, number]; sets: [number, number]; points: [string, string]; decisive: boolean; history: string; over: Side | null; fmt: string; fmtId: string; level: string; levelId: string; multi: boolean; names: [string, string]; doubles: boolean; }
interface Planned { cost: number; plan: AIPlan; pick: { key: string; y: number; lat: number; ahead: number; shift: number }; }
interface Target { human: boolean; ai?: Ai; }

/** Partida (single ou duplas): placar, regras de ponto (rede, fora, bola na areia), golpe por cima da rede e a IA das adversárias e da parceira.
 *  Lados: 0 = a jogadora (e a parceira), z de 0 a 8; 1 = as adversárias, z de 8 a 16. */
export class Match {
  score: Score; lastHitter: Side = 0; hitId = 0; private hits0 = 0; over: Side | null = null;
  stats = { plans: 0, noPlan: 0, letGo: 0, whiff: 0, miss: 0, hit: 0, err: 0, soft: 0, serves: 0 };   // diagnóstico da IA
  lastPick: { key: string; y: number; lat: number; ahead: number; shift: number } | null = null;        // diagnóstico: último golpe escolhido por uma IA e onde a bola chega em relação ao corpo dela
  readonly doubles: boolean; readonly ais: Ai[]; readonly partner: Ai | null; readonly foes: Ai[];
  /** duplas: a bola que vem das adversárias é da jogadora (true) ou da parceira (false); a IA que bateu escolhe a quem manda */
  humanOwns = true;
  /** quem saca neste ponto, se for uma IA (a adversária ou a parceira); null = a jogadora */
  serveAi: Ai | null = null;
  private serverIdx = 0; private nextIdx: [number, number] = [0, 0]; private planned0 = -1; private planned1 = -1;
  private toss: { rel: number; apex: number; hx: number; hy: number; hz: number; cx: number; cy: number; cz: number } | null = null;
  private tmp = new THREE.Vector3(); private noNet: Tun;

  get opp(): Opponent { return this.foes[0].o; }
  constructor(private g: Game, lineup: Lineup, public fmt: Format, public lvl: Level, firstServer: Side = 0) {
    this.score = new Score(fmt, firstServer); this.noNet = { ...g.tun, net: undefined };
    this.doubles = !!lineup.partner;
    const mk = (o: Opponent, team: Side, idx: 0 | 1, lv: Level): Ai => ({ o, team, idx, lvl: lv, plan: null, hitAt: 0, letGo: false, chase: false });
    this.partner = lineup.partner ? mk(lineup.partner, 0, 1, LEVELS.dificil) : null;   // a parceira é sempre difícil
    this.foes = lineup.foes.map((o, i) => mk(o, 1, i as 0 | 1, lvl));
    this.ais = [...(this.partner ? [this.partner] : []), ...this.foes];
    this.rotateServer();
  }

  view(): ScoreView {
    const s = this.score, [a, b] = s.pointText(), d = this.doubles;
    return { server: s.server, games: [...s.games], sets: [...s.sets], points: [a, b], decisive: s.decisive, history: s.history.map((h) => `${h[0]}-${h[1]}`).join(" "), over: this.over, fmt: this.fmt.label, fmtId: this.fmt.id, level: this.lvl.label, levelId: this.lvl.id, multi: this.fmt.setsToWin > 1,
      names: d ? [`${NAMES[0][0]} e ${NAMES[0][1]}`, `${NAMES[1][0]} e ${NAMES[1][1]}`] : ["Jaqueline", "Adversária"], doubles: d };
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

  /** lança a bola de `from` para (lx, lz): side 0 = a jogadora e a parceira, 1 = as adversárias; clear = confere a folga da rede (false: deixa bater na rede) */
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
    const g = this.g, srv = this.score.server, r = this.score.pointWon(winner);
    const hits = this.hitId - this.hits0, landed = reason === "Bola no chão da adversária" || reason === "Quicou na areia"; this.hits0 = this.hitId;   // destaques: ace (saque sem devolução), smash que cai dentro, ralis longos
    const tag = landed && winner === srv && hits <= 1 ? "ACE!" : landed && hits >= 3 && (g.lastKey === "smash" || g.lastKey === "espeto") ? "SMASH!" : hits >= 16 ? `RALI DE ${hits}!` : undefined;
    if (r.match !== undefined) this.over = r.match;
    if (this.score.server !== srv || r.game !== undefined) this.rotateServer();
    this.toss = null; this.humanOwns = true;
    for (const a of this.ais) {
      const o = a.o; a.plan = null; a.letGo = false; a.chase = false; o.swing = null; o.reactT = 0;
      o.react = a.team === 1 ? (r.match !== undefined ? (winner === 1 ? 0 : 1) : winner === 1 ? (g.rally >= 8 ? 2 : 0) : 1) : 0;   // fim da partida: quem perde suspira e quem ganha dança (game.ts)
    }
    g.endPoint(winner, reason, r, tag);
    if (this.partner) this.partner.o.react = g.react;   // a parceira reage como a jogadora
  }

  // ---------- saque em rodízio (duplas): cada atleta saca no seu game, as duas duplas alternam ----------
  private rotateServer(): void { const t = this.score.server; this.serverIdx = this.nextIdx[t]; this.nextIdx[t] ^= 1; }
  /** quem saca no ponto atual: null = a jogadora; senão a IA (a adversária do single, a que cabe à dupla adversária ou a parceira) */
  currentServer(): Ai | null {
    const t = this.score.server, idx = this.doubles ? this.serverIdx : 0;
    if (t === 0 && idx === 0) return null;
    return this.ais.find((a) => a.team === t && a.idx === idx) ?? this.foes[0];
  }

  // ---------- lugares ----------
  /** corredor de cada uma (m): a jogadora na esquerda (+x, de quem olha para a rede), a parceira na direita; nas adversárias o lado delas é o oposto */
  private lane(team: Side, idx: 0 | 1): number { return (team === 0 ? (idx === 0 ? 1 : -1) : (idx === 0 ? -1 : 1)) * LANE; }
  private homeX1(): number { return clamp(-this.g.rig.root.position.x * 0.3, -1.5, 1.5); }
  /** onde cada uma espera o ponto. Single: quem saca fica atrás da linha de fundo e quem recebe, um pouco à frente. Duplas: quem saca atrás da linha, a parceira colada na rede (1,8 m);
   *  quem recebe, a de trás a ~6 m da rede e a parceira a 2,7 m */
  homeOf(team: Side, idx: 0 | 1): { x: number; z: number } {
    const serving = this.score.server === team;
    if (!this.doubles) return team === 0 ? { x: 0, z: serving ? -0.3 : 1.5 } : { x: this.homeX1(), z: serving ? MATCH.len + 0.3 : MATCH.len - 1.6 };
    const dir = team === 0 ? 1 : -1, x = this.lane(team, idx), at = (d: number) => MATCH.netZ - dir * d;
    if (serving) return idx === this.serverIdx ? { x: x * 0.75, z: at(MATCH.netZ + 0.3) } : { x, z: at(1.8) };
    return idx === 0 ? { x, z: at(6.0) } : { x, z: at(2.7) };
  }
  homeOfHuman(): { x: number; z: number } { return this.homeOf(0, 0); }
  /** onde quem venceu comemora: no meio da metade dela, a ~6 m da rede (longe da rede, para a câmera da dança ficar na metade dela), lado a lado nas duplas */
  celebrationSpot(team: Side, idx: 0 | 1): { x: number; z: number } { const dir = team === 0 ? 1 : -1; return { x: this.doubles ? this.lane(team, idx) * 0.65 : 0, z: MATCH.netZ - dir * 6.0 }; }
  /** fim da partida: todas as vencedoras chegaram ao ponto de comemoração (a jogadora também) */
  celebrationReady(): boolean {
    const w = this.over; if (w === null) return false; const p = this.g.rig.root.position;
    if (w === 0) { const h = this.celebrationSpot(0, 0); if (Math.hypot(p.x - h.x, p.z - h.z) > 0.4) return false; }
    return this.ais.every((a) => { if (a.team !== w) return true; const h = this.celebrationSpot(a.team, a.idx); return Math.hypot(a.o.x - h.x, a.o.z - h.z) < 0.4; });
  }
  /** põe as IAs nos lugares de saque (começo da partida) */
  placeAll(): void { for (const a of this.ais) { const h = this.homeOf(a.team, a.idx); a.o.place(h.x, h.z); } }
  /** todas as IAs em posição de saque (para começar o ponto) */
  atHome(): boolean { return this.ais.every((a) => { const h = this.homeOf(a.team, a.idx); return Math.hypot(a.o.x - h.x, a.o.z - h.z) < 0.35 && !a.o.swing; }); }

  /** onde fica quem não vai na bola: no single, volta ao centro; nas duplas, a "corda invisível": no corredor dela, acompanhando em bloco a parceira (se uma vai à lateral, a outra fecha o meio)
   *  e a uma distância da rede que depende da dela (uma sobe, a outra cobre atrás; se uma recua para o lob, a outra sobe) */
  private formation(a: Ai): { x: number; z: number } {
    if (!this.doubles) return { x: this.homeX1(), z: MATCH.len - 3.2 };
    const dir = a.o.dir, mate = a.team === 0 ? this.g.rig.root.position : this.ais.find((b) => b !== a && b.team === a.team)!.o, mateIdx: 0 | 1 = a.team === 0 ? 0 : (a.idx ^ 1) as 0 | 1;
    const dm = dir * (MATCH.netZ - mate.z), dp = clamp(4.5 - 0.45 * dm, 2.0, 4.5);
    const x = this.lane(a.team, a.idx) + BLOCK * (mate.x - this.lane(a.team, mateIdx));
    return { x: clamp(x, -3.6, 3.6), z: MATCH.netZ - dir * dp };
  }

  // ---------- IA ----------
  private cap(a: Ai): number { return a.lvl.speed * 1.15 * (S.stamina ? a.o.stamina.mul() : 1); }   // corrida de ataque à bola (um pouco acima do passo normal)

  private moveTo(a: Ai, tx: number, tz: number, sp: number, dt: number): void {
    const o = a.o, dx = tx - o.x, dz = tz - o.z, d = Math.hypot(dx, dz), want = d > 0.05 ? Math.min(sp, d * 4) : 0, k = Math.min(1, 9 * dt);
    o.vx += ((d > 0.05 ? (dx / d) * want : 0) - o.vx) * k; o.vz += ((d > 0.05 ? (dz / d) * want : 0) - o.vz) * k;
    o.x = clamp(o.x + o.vx * dt, -5.2, 5.2);
    o.z = MATCH.netZ - o.dir * clamp(o.dir * (MATCH.netZ - (o.z + o.vz * dt)), 0.7, 12);   // do lado dela: de 0,7 a 12 m da rede
    if (this.doubles) this.separate(a);
  }

  /** duas da mesma dupla não se sobrepõem: se chegam a menos de 1,3 m, a IA se afasta */
  private separate(a: Ai): void {
    const o = a.o, m = a.team === 0 ? this.g.rig.root.position : this.ais.find((b) => b !== a && b.team === a.team)?.o; if (!m) return;
    const dx = o.x - m.x, dz = o.z - m.z, d = Math.hypot(dx, dz);
    if (d < 1.3 && d > 1e-3) { const k = (1.3 - d) * 0.35; o.x += (dx / d) * k; o.z += (dz / d) * k; }
  }

  /** a melhor forma de a IA `a` pegar a bola que vem: o ponto da trajetória (no ar) que dá para alcançar correndo, com o golpe de altura e lado certos (null: não alcança) */
  private plan(a: Ai, smps: Sample[]): Planned | null {
    const g = this.g, o = a.o, lv = a.lvl, dir = o.dir, net = MATCH.netZ, cap = this.cap(a), ts = S.timeScale;
    let best: { cost: number; smp: Sample; c: Cand; x1: number; z1: number; need: number; lat: number; ahead: number; shift: number } | null = null;
    const cands = g.candList();
    for (const smp of smps) {
      if (dir * smp.vz > -0.2 || dir * (net - smp.z) < 0.5 || smp.y < 0.3 || smp.y > 2.3 || smp.t < lv.react + 0.3) continue;   // a bola vem para o lado dela, no ar, dá tempo de reagir
      for (const c of cands) {
        const dy = Math.abs(smp.y - c.cy); if (dy > 0.2) continue;
        const x1 = smp.x - dir * c.cx, z1 = smp.z - dir * c.cz, dn1 = dir * (net - z1);   // posição dela para o ponto de contato (o clipe é espelhado quando ela olha para −z)
        if (Math.abs(x1) > 5.2 || dn1 < 0.8 || dn1 > 11.5) continue;
        const shift = Math.hypot(x1 - o.x, z1 - o.z), need = Math.max(0, shift - lv.reach) / Math.max(0.05, smp.t - lv.react - 0.6 * c.prep / ts - 0.1);   // o golpe acelera até 1,9× (preparo comprimido)
        if (need > cap) continue;
        const lat = -dir * (smp.x - o.x), ahead = dir * (smp.z - o.z);   // a direita dela é −dir·x e a frente, dir·z
        const cost = 0.3 * smp.t + 1.5 * need / cap + 1.2 * dy - (INTENT_W[c.key] ?? 1) * 0.12 + Math.random() * 0.25 + fitCost(c.key, smp.y, lat, ahead) + this.centerBias(a, smp.x);   // golpe certo para a altura e o lado da bola
        if (!best || cost < best.cost) best = { cost, smp, c, x1, z1, need, lat, ahead, shift };
      }
    }
    if (!best) return null;
    const stretch = clamp(best.need / cap, 0, 1), pErr = lv.err * (0.5 + 1.1 * stretch), r = Math.random();
    return { cost: best.cost, pick: { key: best.c.key, y: best.smp.y, lat: best.lat, ahead: best.ahead, shift: best.shift },
      plan: { arrival: g.time + best.smp.t, startAt: g.time + best.smp.t - 0.8 * best.c.prep / ts, x1: best.x1, z1: best.z1, clip: best.c.clip, key: best.c.key, kind: best.c.kind, whiff: r < pErr * 0.35, err: r >= pErr * 0.35 && r < pErr, stretch } };
  }

  /** bola no meio da quadra: a da esquerda (forehand voltado para o meio) tem prioridade, como na regra da dupla */
  private centerBias(a: Ai, x: number): number { return this.doubles && a.idx === 0 ? -0.3 * Math.max(0, 1 - Math.abs(x) / 1.2) : 0; }

  /** a bola vai para o lado do time `team`: decide quem a pega (a de menor custo), as outras seguram a formação; se vai cair fora, o time deixa passar (esperteza do nível) */
  private assign(team: Side): void {
    const g = this.g, ais = this.ais.filter((a) => a.team === team);
    this.stats.plans++;
    for (const a of ais) { a.plan = null; a.letGo = false; a.chase = false; a.hitAt = g.time; }
    const smps = predict(g.ball, g.tun, 5, 1 / 120, true), last = smps[smps.length - 1];
    if (last && last.y <= BALL_R + 0.02 && !inCourt(last.x, last.z) && Math.random() < ais[0].lvl.smart) { for (const a of ais) a.letGo = true; this.stats.letGo++; if (this.doubles) { const b = g.ball; g.call("Fora!", ais.reduce((m, a) => (Math.hypot(a.o.x - b.x, a.o.z - b.z) < Math.hypot(m.o.x - b.x, m.o.z - b.z) ? a : m)).o, team); } return; }   // vai cair fora: deixa passar (e avisa)
    let best: { a: Ai; p: Planned } | null = null;
    for (const a of ais) { const p = this.plan(a, smps); if (p && (!best || p.cost < best.p.cost)) best = { a, p }; }
    if (!best) { this.stats.noPlan++; const b = g.ball; let near = ais[0]; for (const a of ais) if (Math.hypot(a.o.x - b.x, a.o.z - b.z) < Math.hypot(near.o.x - b.x, near.o.z - b.z)) near = a; near.chase = true; return; }   // não alcança: a mais perto corre atrás
    this.lastPick = best.p.pick; best.a.plan = best.p.plan;
    if (this.doubles && (team === 0 || Math.abs(this.g.ball.x) < 2.0)) g.call("Minha!", best.a.o, team);   // a que vai na bola chama (a parceira sempre: a jogadora fica sem aviso; as adversárias, quando a bola vai para o meio)
  }

  private startSwing(a: Ai, p: AIPlan): void {
    const g = this.g, o = a.o, R = o.rig, act = R.actions.get(p.clip); if (!act) return;
    const st = R.startT(p.clip, S.contactOffset), ct = R.ct(p.clip, S.contactOffset), dur = R.durations.get(p.clip) ?? 2, dtp = Math.max(0.05, p.arrival - g.time);
    const s = clamp((ct - st) / dtp, 0.62, 1.9), shift = Math.hypot(p.x1 - o.x, p.z1 - o.z);
    o.swing = { clip: p.clip, key: p.key, kind: p.kind, s, t: st, startT: st, contactT: ct, endT: Math.min(dur - 0.02, ct + FOLLOW), duration: dur, x0: o.x, z0: o.z, x1: p.x1, z1: p.z1, contacted: false, serve: false, whiff: p.whiff || shift > a.lvl.reach * 1.5 + 0.2 };
    o.swingAct = act; o.vx = o.vz = 0;
  }

  /** contato de uma IA (chamado no instante exato pelo Game.advance): confere a raquete na bola e devolve */
  contact(a: Ai, sw: OppSwing): void {
    const g = this.g, o = a.o, R = o.rig, b = g.ball, p = a.plan;
    o.x = sw.x1; o.z = sw.z1; const act = o.swingAct!; act.time = Math.min(sw.contactT, sw.duration - 1e-3);
    R.root.position.set(o.x, 0, o.z); R.mixer.update(0); R.root.updateMatrixWorld(true); R.fixRacket(1); R.root.updateMatrixWorld(true);
    const H = o.racketHead(this.tmp), gap = Math.hypot(H.x - b.x, H.y - b.y, H.z - b.z);
    g.emit("opp", { clip: sw.clip, gap_cm: Math.round(gap * 100), whiff: sw.whiff, serve: sw.serve, by: a.o.name });
    if (!sw.serve && (sw.whiff || gap > 0.55)) { a.plan = null; if (sw.whiff) this.stats.whiff++; else this.stats.miss++; return; }
    if (!sw.serve) this.stats.hit++;   // errou a bola: ela segue e o ponto se decide na areia
    b.x = H.x; b.y = Math.max(H.y, BALL_R); b.z = H.z; g.lastKind = sw.serve ? "serve" : sw.kind; g.lastKey = sw.serve ? "saque" : strokeOf(sw.clip)?.key ?? ""; g.vfx.hit(H.x, H.y, H.z, 1, g.lastKind);
    if (S.stamina) o.stamina.drain(sw.serve ? 0.02 : sw.kind === "over" ? 0.03 : 0.012);
    this.aiShot(a, sw.serve, p?.err ?? false); a.plan = null;
    if (sw.serve) { g.state = "rally"; g.rally = 0; g.serveTime = g.time; }
  }

  /** alvos possíveis do golpe de uma IA do time `team`, o preferido primeiro: quem bate pelas adversárias manda mais para a jogadora (e no saque, para quem recebe no fundo) */
  private targetsOf(team: Side, serve: boolean): Target[] {
    if (team === 1) {
      const h: Target = { human: true }; if (!this.partner) return [h];
      const p: Target = { human: false, ai: this.partner }; return Math.random() < (serve ? 0.7 : 0.55) ? [h, p] : [p, h];
    }
    const f: Target[] = this.foes.map((ai) => ({ human: false, ai })); if (f.length > 1 && Math.random() < 0.5) f.reverse(); return f;
  }

  /** devolução de uma IA: escolhe um alvo (a jogadora ou a parceira / uma adversária), um golpe e um ponto de contato para ele (a uma corrida que ele aguenta × nível de quem bate: acima de 1 é bola vencedora),
   *  confere a rede e que a bola, se ninguém bater, cai dentro da quadra. Erra (rede ou fora) com a chance do nível. */
  private aiShot(a: Ai, serve: boolean, error: boolean): void {
    const g = this.g, lv = a.lvl, pl = g.rig.root.position, b = g.ball, H = new THREE.Vector3(b.x, b.y, b.z), ts = S.timeScale, net = MATCH.netZ, rnd = (x: number, y: number) => x + (y - x) * Math.random();
    if (error) { this.stats.err++; this.aiError(a, H, serve); return; }
    const mulP = 0.5 + 0.5 * g.speedMul(), reachP = g.reachR(), lock = g.lockLeft(), keys = Object.keys(INTENT_W), foes = this.targetsOf(a.team, serve);
    for (let at = 0; at < 40; at++) {
      const tg = foes[foes.length > 1 && (at % 4 === 3 || (at >= 24 && at % 2 === 1)) ? 1 : 0], ta = tg.ai, td = ta ? ta.o.dir : 1, tp = ta ? ta.o : pl;   // td: para onde o alvo olha
      const key = keys[(Math.random() * keys.length) | 0], list = g.candList(key); if (!list.length) continue;
      const c = list[(Math.random() * list.length) | 0], Tf = serve ? rnd(1.25, 1.5) : rnd(0.95, 1.4) * (c.cy >= 1.6 ? 1.1 : 1);
      let lim: number, shiftMax: number;
      if (ta) { lim = this.cap(ta) * (at < 28 ? 0.8 : 1); shiftMax = Math.min(3.4, ta.lvl.reach + lim * Math.max(0.15, Tf - ta.lvl.react - 0.6 * c.prep / ts - 0.1)); }
      else { lim = (at < 28 ? NEED_OK : NEED_RELAX) * mulP; shiftMax = Math.min(3.4, reachP + lim * Math.max(0.15, Tf - lock - c.prep / ts - 0.1)); }
      const shift = shiftMax * Math.min(1.3, lv.diff * rnd(0.15, 1.05)), th = rnd(0, 2 * Math.PI);
      const px = clamp(tp.x + shift * Math.sin(th), -3.8, 3.8), pz = net - td * clamp(td * (net - (tp.z + shift * Math.cos(th))), 1.2, 7.6);   // o alvo fica na metade dele da quadra
      const C = new THREE.Vector3(px + td * c.cx, c.cy, pz + td * c.cz);
      if (fitCost(c.key, c.cy, -td * (C.x - tp.x), td * (C.z - tp.z)) > (at < 20 ? 0.3 : at < 32 ? 0.9 : 1e9)) continue;   // a bola chega do lado e na altura em que esse golpe é o certo para ele
      const v = solveShot(H, C, Tf);
      if (Math.hypot(v.vx, v.vy, v.vz) > 30) continue;
      const bb: Ball = { x: H.x, y: H.y, z: H.z, vx: v.vx, vy: v.vy, vz: v.vz, bounces: 0, wallHits: 0, ret: null };
      let prev = H.z, clear = false, atC: Sample | null = null, last: Sample | null = null;
      for (const sm of predict(bb, this.noNet, Tf + 2.5, 1 / 120, true)) {
        if (!clear && (prev - net) * (sm.z - net) <= 0) { clear = sm.y >= NET_H + BALL_R + 0.12; if (!clear) break; }
        prev = sm.z; if (!atC && sm.t >= Tf) atC = sm; last = sm;
      }
      if (!clear || !atC || !last || last.y > BALL_R + 0.03 || !inCourt(last.x, last.z)) continue;   // passa da rede e, se ninguém bater, cai dentro da quadra
      if (shift <= shiftMax) {   // não é bola vencedora: o alvo tem de conseguir chegar
        if (ta) { const need = Math.max(0, Math.hypot(px - tp.x, pz - tp.z) - ta.lvl.reach) / Math.max(0.05, Tf - ta.lvl.react - 0.6 * c.prep / ts - 0.1); if (need > lim) continue; }
        else { let ok = false; for (const e of g.evalSample(atC, pl.x, pl.z, lock, c.key)) if (e.clip === c.clip && e.dy <= 0.14 && e.need <= lim) { ok = true; break; } if (!ok) continue; }
      }
      Object.assign(b, { x: H.x, y: H.y, z: H.z, vx: v.vx, vy: v.vy, vz: v.vz, bounces: 0, wallHits: 0, ret: null }); this.lastHitter = a.team; this.hitId++;
      if (a.team === 1) { this.humanOwns = tg.human; if (this.partner && tg.human && Math.abs(C.x) < 1.8) g.call("Sua!", this.partner.o, 0); }   // a bola é da jogadora e vai para o meio: a parceira cede ("Sua!")
      return;
    }
    this.stats.soft++; this.aiError(a, H, serve, true);   // nada serviu (raro): bola simples no meio
  }

  /** erro de uma IA: bola na rede (baixa) ou fora (longa/aberta); com `soft`, uma bola mansa no meio */
  private aiError(a: Ai, H: THREE.Vector3, serve: boolean, soft = false): void {
    const pr = PROFILE[serve ? "saque" : "fh_din"], r = Math.random(); let lx = (Math.random() * 2 - 1) * 2, d = 2 + Math.random() * 3, T = pr.T, clear = true;   // d: distância da linha de fundo de quem recebe (< 0: fora)
    if (!soft) { if (r < 0.35) { clear = false; T *= 0.6; } else if (r < 0.7) d = -(0.6 + Math.random() * 2.4); else lx = (Math.random() < 0.5 ? -1 : 1) * (4.4 + Math.random() * 1.4); }
    if (a.team === 1) this.humanOwns = true;
    this.launch(H, lx, a.team === 1 ? d : MATCH.len - d, T, a.team, clear);
  }

  // ---------- saque de uma IA ----------
  startServe(a: Ai): void {
    const g = this.g, o = a.o, R = o.rig, clip = SERVE_CLIP, act = R.actions.get(clip), cl = R.contactLocal.get(clip);
    this.humanOwns = true;
    if (!act || !cl || !R.leftHand) { this.aiShot(a, true, false); g.state = "rally"; g.rally = 0; g.serveTime = g.time; return; }
    const dur = R.durations.get(clip) ?? 2, ct = R.ct(clip, S.contactOffset), h = R.measureObj(clip, TOSS_REL, R.leftHand);
    o.swing = { clip, key: "saque", kind: "serve", s: S.timeScale, t: SERVE_START, startT: SERVE_START, contactT: ct, endT: Math.min(dur - 0.02, ct + SERVE_FOLLOW), duration: dur, x0: o.x, z0: o.z, x1: o.x, z1: o.z, contacted: false, serve: true, whiff: false };
    o.swingAct = act; o.vx = o.vz = 0;
    this.toss = { rel: TOSS_REL, apex: tossApex((ct - TOSS_REL) / S.timeScale), hx: o.x + h.x, hy: h.y, hz: o.z + h.z, cx: o.x + o.dir * cl.x, cy: cl.y, cz: o.z + o.dir * cl.z };
    this.serveAi = a; g.state = "serve"; g.rally = 0; g.cue = null; Object.assign(g.ball, { x: this.toss.hx, y: this.toss.hy, z: this.toss.hz, vx: 0, vy: 0, vz: 0, bounces: 0, ret: null });
    g.ballMesh.visible = true; g.ballShadow.visible = true; g.emit("serve", { by: "opp", who: o.name }); g.onHud();
  }

  private serveStep(a: Ai, dt: number): void {
    const g = this.g, o = a.o, sw = o.swing, z = this.toss, b = g.ball; if (!sw || !z) { g.state = "wait"; return; }
    sw.t += dt * sw.s;
    if (sw.t >= z.rel) { const u = Math.min(1, (sw.t - z.rel) / Math.max(1e-3, sw.contactT - z.rel)); b.x = z.hx + (z.cx - z.hx) * u; b.z = z.hz + (z.cz - z.hz) * u; b.y = z.hy + (z.cy - z.hy) * u + 4 * z.apex * u * (1 - u); }
    else if (o.rig.leftHand) { o.rig.leftHand.getWorldPosition(this.tmp); b.x = this.tmp.x; b.y = this.tmp.y + 0.05; b.z = this.tmp.z; }
    b.vx = b.vy = b.vz = 0;
    if (!sw.contacted && sw.t >= sw.contactT) { sw.t = sw.contactT; sw.contacted = true; this.contact(a, sw); }
  }

  // ---------- quadro ----------
  /** chamar todo quadro da partida (antes de a física andar) */
  update(dt: number): void {
    const g = this.g;
    for (const a of this.ais) { const o = a.o; if (S.stamina) o.stamina.update(dt, Math.hypot(o.vx, o.vz), g.state !== "rally"); else o.stamina.reset(); o.reactT += dt; }
    if (g.state === "serve" && this.serveAi) { this.serveStep(this.serveAi, dt); for (const a of this.ais) if (a !== this.serveAi) this.goHome(a, dt); return; }
    if (g.state === "rally") { this.rally(dt); return; }
    for (const a of this.ais) {   // fora do rali: acaba o golpe e volta ao lugar de saque (depois da reação)
      const o = a.o, sw = o.swing; if (sw) { sw.t += dt * sw.s; if (sw.t >= sw.endT) o.swing = null; }
      if (this.over !== null) {   // partida acabada: quem perdeu fica onde está; quem ganhou vai ao ponto de comemoração e dança (game.ts)
        if (a.team === this.over && !o.swing && o.reactT > CELEB_AT && !o.dancer.active) { const h = this.celebrationSpot(a.team, a.idx); this.moveTo(a, h.x, h.z, 2.0 * (S.stamina ? o.stamina.mul() : 1), dt); } else o.vx = o.vz = 0;
      } else if (!o.swing) this.goHome(a, dt);
    }
  }

  private goHome(a: Ai, dt: number): void {
    const g = this.g, o = a.o, h = this.homeOf(a.team, a.idx);
    this.moveTo(a, h.x, h.z, g.state === "dead" && o.reactT < (o.react === 2 ? 1.9 : o.react === 1 ? 1.1 : 0.5) ? 0 : 2.0 * (S.stamina ? o.stamina.mul() : 1), dt);
  }

  private rally(dt: number): void {
    // a bola vai para o lado de um time: ele decide quem a pega (as adversárias sempre; a parceira só se a bola é dela)
    if (this.lastHitter === 0 && this.planned1 !== this.hitId) { this.planned1 = this.hitId; this.assign(1); }
    if (this.partner && this.lastHitter === 1 && this.planned0 !== this.hitId) { this.planned0 = this.hitId; if (!this.humanOwns) this.assign(0); }
    for (const a of this.ais) this.rallyAi(a, dt);
  }

  private rallyAi(a: Ai, dt: number): void {
    const g = this.g, o = a.o, lv = a.lvl, b = g.ball, sw = o.swing;
    if (sw) {   // golpe em andamento: desliza até o ponto de contato (o tempo anda no Game.advance)
      const pr = clamp((sw.t - sw.startT) / Math.max(1e-3, sw.contactT - sw.startT), 0, 1), e = pr * pr * (3 - 2 * pr);
      o.x = sw.x0 + (sw.x1 - sw.x0) * e; o.z = sw.z0 + (sw.z1 - sw.z0) * e; o.vx = o.vz = 0;
      if (sw.t >= sw.endT) o.swing = null;
      return;
    }
    const cap = this.cap(a), dir = o.dir, net = MATCH.netZ;
    if (a.plan) {
      if (g.time >= a.plan.startAt) { this.startSwing(a, a.plan); return; }
      this.moveTo(a, a.plan.x1, a.plan.z1, g.time - a.hitAt < lv.react ? 0 : cap, dt);
    } else if (a.chase) this.moveTo(a, clamp(b.x, -4.6, 4.6), net - dir * clamp(dir * (net - b.z), 1, 11), g.time - a.hitAt < lv.react ? 0 : cap, dt);   // não alcança: corre atrás
    else { const f = this.formation(a); this.moveTo(a, f.x, f.z, cap * 0.7, dt); }                                                                           // depois do golpe, deixando passar ou sem a bola: volta à formação
  }

  /** o relógio dos golpes das IAs durante o rali anda no Game.advance; este é o golpe que chega primeiro ao contato (tempo em s) ou null */
  nextContact(): { t: number; a: Ai } | null {
    let best: { t: number; a: Ai } | null = null;
    for (const a of this.ais) { const sw = a.o.swing; if (!sw || sw.contacted || sw.serve) continue; const t = Math.max(0, (sw.contactT - sw.t) / sw.s); if (!best || t < best.t) best = { t, a }; }
    return best;
  }
  /** anda o relógio de todos os golpes das IAs */
  advanceSwings(d: number): void { for (const a of this.ais) { const sw = a.o.swing; if (sw) sw.t += d * sw.s; } }
}
