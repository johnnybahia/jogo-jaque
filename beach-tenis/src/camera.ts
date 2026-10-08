// Câmeras pré-definidas: 3 posições em órbita em volta da jogadora (giro, inclinação, distância) que o usuário pode editar e salvar no aparelho.
export interface CamPose { yaw: number; pitch: number; dist: number; }
export const CAM_COUNT = 3;
export const CAM_NAMES = ["Atrás", "Alta", "Perto"];
/** de fábrica: atrás da jogadora (a de sempre), alta para ver a quadra toda e perto para ver mais a jogadora */
export const CAM_DEFAULTS: CamPose[] = [{ yaw: 0, pitch: 0.285, dist: 5 }, { yaw: 0, pitch: 0.78, dist: 9.5 }, { yaw: 0, pitch: 0.2, dist: 3.2 }];
export const PITCH_MIN = 0.06, PITCH_MAX = 1.35, DIST_MIN = 1.8, DIST_MAX = 14;
const KEY = "bt.cams.v1";

const wrap = (a: number): number => ((a + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
const clamp = (v: number, a: number, b: number): number => Math.min(b, Math.max(a, v));
/** pose válida: giro entre −180° e 180°, inclinação e distância dentro dos limites da câmera (valor ruim vira o padrão) */
export function cleanPose(p: Partial<CamPose> | null | undefined, fallback: CamPose): CamPose {
  const n = (v: unknown, d: number): number => (typeof v === "number" && Number.isFinite(v) ? v : d);
  return { yaw: wrap(n(p?.yaw, fallback.yaw)), pitch: clamp(n(p?.pitch, fallback.pitch), PITCH_MIN, PITCH_MAX), dist: clamp(n(p?.dist, fallback.dist), DIST_MIN, DIST_MAX) };
}
/** as duas poses são a mesma (para saber se há alteração não salva) */
export function samePose(a: CamPose, b: CamPose): boolean { return Math.abs(wrap(a.yaw - b.yaw)) < 0.009 && Math.abs(a.pitch - b.pitch) < 0.009 && Math.abs(a.dist - b.dist) < 0.06; }

/** as 3 câmeras e qual está em uso; a escolha e as posições editadas ficam salvas (localStorage) */
export class CamPresets {
  sel = 0; private slots: (CamPose | null)[] = [null, null, null];

  constructor() {
    try {
      const r = JSON.parse(localStorage.getItem(KEY) || "null");
      if (r) { this.sel = Number.isInteger(r.sel) && r.sel >= 0 && r.sel < CAM_COUNT ? r.sel : 0; for (let i = 0; i < CAM_COUNT; i++) if (r.slots?.[i]) this.slots[i] = cleanPose(r.slots[i], CAM_DEFAULTS[i]); }
    } catch { /* sem storage ou dado estragado: valem as de fábrica */ }
  }

  private persist(): void { try { localStorage.setItem(KEY, JSON.stringify({ sel: this.sel, slots: this.slots })); } catch { /* ignora */ } }

  /** pose da câmera i: a salva ou a de fábrica (cópia) */
  get(i: number = this.sel): CamPose { return { ...(this.slots[i] ?? CAM_DEFAULTS[i]) }; }
  isCustom(i: number): boolean { return !!this.slots[i]; }
  select(i: number): void { this.sel = clamp(Math.round(i), 0, CAM_COUNT - 1); this.persist(); }
  save(i: number, p: CamPose): void { this.slots[i] = cleanPose(p, CAM_DEFAULTS[i]); this.persist(); }
  reset(i: number): void { this.slots[i] = null; this.persist(); }
}
export const CAMS = new CamPresets();
