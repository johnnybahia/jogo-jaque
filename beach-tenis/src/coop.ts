import type { Level } from "./match";

/** Frescobol cooperativo: a parceira (IA) quer manter a bola no ar. O nível só muda o desafio dos passes e a chance de ela errar:
 *  err = chance de a parceira errar a devolução; diff = quão longe da jogadora ela coloca a bola (× o que a jogadora alcança, sempre abaixo de 1: nunca é bola vencedora); tf = tempo de voo do passe (s). */
export interface CoopLevel { speed: number; react: number; reach: number; err: number; diff: number; tf: [number, number]; }
export const COOP: Record<string, CoopLevel> = {
  facil: { speed: 3.3, react: 0.3, reach: 1.5, err: 0, diff: 0.2, tf: [1.4, 1.8] },
  medio: { speed: 3.5, react: 0.22, reach: 1.6, err: 0.01, diff: 0.4, tf: [1.15, 1.6] },
  dificil: { speed: 3.7, react: 0.14, reach: 1.7, err: 0.03, diff: 0.65, tf: [0.95, 1.4] },
};
/** o nível da parceira no Frescobol: no lugar do da adversária (que tenta ganhar), o da tabela acima; sem esperteza de deixar passar (não há linhas) */
export function coopLevel(l: Level): Level { const c = COOP[l.id] ?? COOP.medio; return { ...l, speed: c.speed, react: c.react, reach: c.reach, err: c.err, diff: c.diff, smart: 0, tf: c.tf }; }

/** recorde de uma combinação nível × Golpe automático: mais rebatidas seguidas e mais tempo sem a bola cair (guardados separados) */
export interface CoopBest { hits: number; secs: number; }
export interface CoopData { best: Record<string, CoopBest>; }
const KEY = "bt.fresco.v1";
export const coopKey = (levelId: string, auto: boolean): string => levelId + (auto ? "_a" : "");
export function loadCoop(): CoopData {
  const best: Record<string, CoopBest> = {};
  try { const d = JSON.parse(localStorage.getItem(KEY) || "null"); for (const [k, v] of Object.entries(d?.best ?? {})) { const b = v as Partial<CoopBest> | null; if (Number.isFinite(b?.hits) && Number.isFinite(b?.secs)) best[k] = { hits: Math.max(0, b!.hits!), secs: Math.max(0, b!.secs!) }; } } catch { /* sem storage ou dado estragado */ }
  return { best };
}
export function saveCoop(d: CoopData): void { try { localStorage.setItem(KEY, JSON.stringify(d)); } catch { /* ignora */ } }
/** m:ss (ou h:mm:ss) */
export function fmtTime(s: number): string { const t = Math.max(0, Math.floor(s)), h = Math.floor(t / 3600), m = Math.floor(t / 60) % 60, r = t % 60; return h ? `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}` : `${m}:${String(r).padStart(2, "0")}`; }
