export interface Settings {
  auto: boolean; autoServe: boolean; footprints: boolean; footLife: number; assist: number; hitRadius: number; ballSpeed: number; aimSpread: number;
  contactOffset: number; ballVisual: number; eSand: number; eWall: number; playerScale: number; timeScale: number;
  faceAssist: number; rkX: number; rkY: number; rkZ: number; rkRX: number; rkRY: number; rkRZ: number;
}
export const DEFAULTS: Settings = {
  auto: true, autoServe: true, footprints: true, footLife: 25, assist: 0.85, hitRadius: 0.6, ballSpeed: 13, aimSpread: 1.5,
  contactOffset: 0, ballVisual: 3.5, eSand: 0.88, eWall: 0.8, playerScale: 1.75, timeScale: 1,
  faceAssist: 1, rkX: 0, rkY: 0, rkZ: 0, rkRX: 0, rkRY: 0, rkRZ: 0,
};
const KEY = "bt.settings.v2";
export const S: Settings = { ...DEFAULTS };
export function loadSettings(): void {
  try {
    const r = localStorage.getItem(KEY); if (r) { Object.assign(S, JSON.parse(r)); return; }
    // v1: a raquete era posicionada à mão (sem pegada calculada) e esses valores não servem mais; o resto vale
    const o = localStorage.getItem("bt.settings.v1");
    if (o) { const v = JSON.parse(o); for (const k of ["rkX", "rkY", "rkZ", "rkRX", "rkRY", "rkRZ"]) delete v[k]; Object.assign(S, v); }
  } catch { /* sem storage */ }
}
export function saveSettings(): void { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch { /* ignora */ } }
export function loadRecord(): number { try { return Number(localStorage.getItem("bt.record") || 0) || 0; } catch { return 0; } }
export function saveRecord(n: number): void { try { localStorage.setItem("bt.record", String(n)); } catch { /* ignora */ } }
