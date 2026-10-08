export interface Settings {
  auto: boolean; autoServe: boolean; stamina: boolean; footprints: boolean; force: boolean; footLife: number; tod: number; assist: number; hitRadius: number; ballSpeed: number; aimSpread: number; timing: number;
  contactOffset: number; ballVisual: number; eSand: number; eWall: number; playerScale: number; timeScale: number;
  faceAssist: number; camSens: number; camDist: number; rkX: number; rkY: number; rkZ: number; rkRX: number; rkRY: number; rkRZ: number;
}
export const DEFAULTS: Settings = {
  auto: false, autoServe: true, stamina: true, footprints: true, force: true, footLife: 25, tod: 0, assist: 0.55, hitRadius: 0.32, ballSpeed: 12.5, aimSpread: 1.2, timing: 1,
  contactOffset: 0, ballVisual: 3.5, eSand: 0.88, eWall: 0.62, playerScale: 1.75, timeScale: 1,
  faceAssist: 1, camSens: 1, camDist: 5, rkX: 0, rkY: 0, rkZ: 0, rkRX: 0, rkRY: 0, rkRZ: 0,
};
const KEY = "bt.settings.v3";
export const S: Settings = { ...DEFAULTS };
export function loadSettings(): void {
  try {
    const r = localStorage.getItem(KEY); if (r) { Object.assign(S, JSON.parse(r)); return; }
    // v2: a rebatida era automática e raio/assistência/velocidade/dispersão/quique na parede tinham outro significado: esses valores
    // não servem mais, valem os padrões novos; o resto migra. v1: além disso, a raquete era posicionada à mão (sem pegada calculada)
    const NEW_MEANING = ["auto", "assist", "hitRadius", "ballSpeed", "aimSpread", "eWall"];
    const o2 = localStorage.getItem("bt.settings.v2"), o1 = localStorage.getItem("bt.settings.v1");
    const old = o2 ?? o1;
    if (old) { const v = JSON.parse(old); for (const k of NEW_MEANING) delete v[k]; if (!o2) for (const k of ["rkX", "rkY", "rkZ", "rkRX", "rkRY", "rkRZ"]) delete v[k]; Object.assign(S, v); }
  } catch { /* sem storage */ }
}
export function saveSettings(): void { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch { /* ignora */ } }
export function loadRecord(): number { try { return Number(localStorage.getItem("bt.record") || 0) || 0; } catch { return 0; } }
export function saveRecord(n: number): void { try { localStorage.setItem("bt.record", String(n)); } catch { /* ignora */ } }
