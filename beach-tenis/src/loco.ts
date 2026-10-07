import * as THREE from "three";
import type { Rig } from "./rig";

// Locomoção com cadência casada à velocidade. Cada clipe de andar/correr (frente, trás, esquerda, direita) tem uma
// velocidade natural MEDIDA nos pés (média da velocidade do pé apoiado em relação ao corpo): se o corpo anda nessa
// velocidade e o clipe toca no ritmo natural, o pé fica parado no chão. A cadência vem de velocidade ÷ distância por ciclo,
// por direção, e todos os clipes usam uma fase comum com o toque do pé esquerdo alinhado, então a mistura entre
// frente/lado/trás e entre andar/correr não desencontra os passos.
const AX: Record<string, THREE.Vector2> = { f: new THREE.Vector2(0, 1), b: new THREE.Vector2(0, -1), l: new THREE.Vector2(1, 0), r: new THREE.Vector2(-1, 0) };   // (x = esquerda, y = frente)
const DIRS = ["f", "b", "l", "r"];
export const LOCO_CLIPS = ["idle", ...DIRS.map((d) => `walk_${d}`), ...DIRS.map((d) => `run_${d}`)];
const smooth = (a: number, b: number, x: number) => { if (b <= a) return x >= b ? 1 : 0; const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

export interface LocoClip { name: string; speed: number; dur: number; tl: number; tr: number; }   // tl/tr: instante (fração do ciclo) em que o pé esquerdo/direito pisa

export class Loco {
  static P = 2;   // expoente dos pesos de direção (maior = diagonais com menos mistura de clipes)
  /** pesos de direção que somam 1: cos^P normalizado */
  static pow(c: number): number { return Math.pow(c, Loco.P); }
  clips = new Map<string, LocoClip>();
  ready = false;
  private phase = 0; private idlePhase = 0;

  /** mede velocidade natural (unidades nativas/s) e o instante do toque do pé esquerdo de cada clipe; chamar com o modelo em escala 1 */
  measure(rig: Rig, meta: Record<string, { speed_x_m_s?: number; speed_z_m_s?: number }>): void {
    const find = (re: RegExp) => { let f: THREE.Object3D | null = null; rig.model.traverse((o) => { if (!f && (o as THREE.Bone).isBone && re.test(o.name)) f = o; }); return f as THREE.Object3D | null; };
    const feet = [find(/LeftFoot$/), find(/RightFoot$/)]; if (!feet[0] || !feet[1]) return;
    const sc = rig.model.scale.x || 1, v = new THREE.Vector3();
    for (const name of LOCO_CLIPS) {
      const act = rig.actions.get(name); if (!act) return;
      const dur = act.getClip().duration; if (name === "idle") { this.clips.set(name, { name, speed: 0, dur, tl: 0, tr: 0.5 }); continue; }
      const N = Math.max(16, Math.round(dur * 30)), P: THREE.Vector3[][] = [[], []];
      for (const [, a] of rig.actions) a.setEffectiveWeight(0);
      act.setEffectiveWeight(1);
      for (let i = 0; i < N; i++) { act.time = (i / N) * dur * 0.999; rig.mixer.update(0); rig.root.updateMatrixWorld(true); feet.forEach((f, k) => P[k].push(f!.getWorldPosition(v.clone()).divideScalar(sc))); }
      act.setEffectiveWeight(0);
      const dt = dur / N, acc = new THREE.Vector2(); let n = 0; const strike = [0, N / 2];
      const stance: boolean[][] = P.map((ps) => { const ymin = Math.min(...ps.map((p) => p.y)); return ps.map((p) => p.y < ymin + 0.018); });
      for (let k = 0; k < 2; k++) for (let i = 0; i < N; i++) { const j = (i + 1) % N; if (stance[k][i] && stance[k][j]) { acc.x += (P[k][j].x - P[k][i].x) / dt; acc.y += (P[k][j].z - P[k][i].z) / dt; n++; } }
      for (let k = 0; k < 2; k++) for (let i = 0; i < N; i++) if (stance[k][i] && !stance[k][(i + N - 1) % N]) { strike[k] = i; break; }
      let speed = n >= 3 ? acc.length() / n : 0;
      if (speed < 0.1) { const m = meta[name]; speed = Math.hypot(m?.speed_x_m_s ?? 0, m?.speed_z_m_s ?? 0); }
      this.clips.set(name, { name, speed, dur, tl: strike[0] / N, tr: strike[1] / N });
    }
    this.ready = LOCO_CLIPS.every((n) => this.clips.has(n));
  }

  /** fase comum (0 = pé esquerdo pisa, 0,5 = pé direito pisa) → tempo normalizado do clipe, alinhando os dois toques para os passos de clipes diferentes coincidirem */
  private warp(c: LocoClip): number {
    const m1 = (x: number) => ((x % 1) + 1) % 1, p = this.phase;
    const dl = m1(c.tr - c.tl), dr = m1(c.tl - c.tr);
    if (dl < 0.15 || dr < 0.15) return m1(p + c.tl);                         // toques degenerados: só desloca
    return p < 0.5 ? m1(c.tl + (p / 0.5) * dl) : m1(c.tr + ((p - 0.5) / 0.5) * dr);
  }

  /** velocidade (vx = esquerda, vz = frente) em m/s do mundo → pesos, tempos e fase dos clipes; lw = fração da locomoção (1 − golpe) */
  step(rig: Rig, dt: number, vx: number, vz: number, lw: number): void {
    const sc = rig.model.scale.x, sp = Math.hypot(vx, vz);
    const ux = sp > 1e-4 ? vx / sp : 0, uz = sp > 1e-4 ? vz / sp : 1;
    const move = smooth(0.12, 0.55, sp);
    const W: Record<string, number> = { idle: 1 - move };
    // cadência única (fase comum): mínimos quadrados entre a velocidade do corpo e o movimento dos pés de cada clipe misturado
    // (um clipe tocado no ritmo natural move o pé a velocidade_natural; G = Σ peso · distância_por_ciclo · eixo)
    const G = new THREE.Vector2();
    const norm = DIRS.reduce((a, d) => a + Loco.pow(Math.max(0, ux * AX[d].x + uz * AX[d].y)), 0) || 1;
    for (const d of DIRS) {
      const walk = this.clips.get(`walk_${d}`)!, run = this.clips.get(`run_${d}`)!;
      const sW = Math.max(0.05, walk.speed * sc), sR = Math.max(0.05, run.speed * sc);
      const wd = Loco.pow(Math.max(0, ux * AX[d].x + uz * AX[d].y)) / norm, wm = move * wd, t = smooth(0.9 * sW, 0.85 * sR, sp);
      W[`walk_${d}`] = wm * (1 - t); W[`run_${d}`] = wm * t;
      G.addScaledVector(AX[d], wd * ((1 - t) * sW * walk.dur + t * sR * run.dur));
    }
    const g2 = G.lengthSq();
    if (g2 > 1e-6 && move > 0.01) this.phase = (this.phase + Math.max(0, (vx * G.x + vz * G.y) / g2) * dt) % 1;
    const idle = this.clips.get("idle")!; this.idlePhase = (this.idlePhase + dt / idle.dur) % 1;
    for (const c of this.clips.values()) {
      const a = rig.actions.get(c.name); if (!a) continue;
      a.setEffectiveWeight((W[c.name] ?? 0) * lw);
      a.time = (c.name === "idle" ? this.idlePhase : this.warp(c)) * c.dur * 0.999;
    }
  }
}
