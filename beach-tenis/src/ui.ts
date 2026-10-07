import { Game } from "./game";
import { S, DEFAULTS, saveSettings, Settings } from "./settings";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
type Spec = { key: keyof Settings; label: string; min: number; max: number; step: number; recalc?: boolean };
const SPECS: Array<[string, Spec[]]> = [
  ["Jogo", [
    { key: "assist", label: "Assistência de posição", min: 0, max: 1, step: 0.05 },
    { key: "hitRadius", label: "Raio de acerto (m)", min: 0.1, max: 1.2, step: 0.05 },
    { key: "ballSpeed", label: "Velocidade da bola (m/s)", min: 8, max: 22, step: 0.5 },
    { key: "aimSpread", label: "Dispersão da mira (m)", min: 0, max: 2.5, step: 0.1 },
    { key: "timeScale", label: "Velocidade das animações", min: 0.5, max: 1.5, step: 0.05 },
  ]],
  ["Marcas dos pés", [{ key: "footLife", label: "Duração (s)", min: 5, max: 60, step: 1 }]],
  ["Sincronia", [{ key: "contactOffset", label: "Ajuste do contato (frames)", min: -10, max: 10, step: 1, recalc: true }]],
  ["Física", [
    { key: "eSand", label: "Quique na areia", min: 0.1, max: 0.8, step: 0.01 },
    { key: "eWall", label: "Quique na parede", min: 0.5, max: 0.95, step: 0.01 },
  ]],
  ["Visual", [
    { key: "ballVisual", label: "Tamanho visual da bola ×", min: 1, max: 4, step: 0.1 },
    { key: "faceAssist", label: "Face da raquete na parede (contato)", min: 0, max: 1, step: 0.05, recalc: true },
    { key: "playerScale", label: "Escala da jogadora", min: 1.3, max: 2.2, step: 0.01, recalc: true },
  ]],
  ["Raquete (posição m / rotação °)", [
    { key: "rkX", label: "X", min: -0.15, max: 0.15, step: 0.005 }, { key: "rkY", label: "Y", min: -0.15, max: 0.15, step: 0.005 }, { key: "rkZ", label: "Z", min: -0.15, max: 0.15, step: 0.005 },
    { key: "rkRX", label: "Rot X", min: -180, max: 180, step: 1 }, { key: "rkRY", label: "Rot Y", min: -180, max: 180, step: 1 }, { key: "rkRZ", label: "Rot Z", min: -180, max: 180, step: 1 },
  ]],
];

export function initUI(game: Game, version: string): { showUpdate: (fn: () => void) => void } {
  const toast = $("toast"); let tt = 0;
  game.onToast = (m) => { toast.textContent = m; toast.classList.add("on"); clearTimeout(tt); tt = window.setTimeout(() => toast.classList.remove("on"), 900); };
  const upd = () => { $("rally").textContent = `Rali ${game.rally} · Recorde ${game.record}`; $("info").textContent = game.info; };
  game.onHud = upd; upd();

  // joystick
  const zone = $("joyZone"), base = $("joyBase"), knob = $("knob"); let jid = -1, cx = 0, cy = 0;
  const setKnob = (dx: number, dy: number) => {
    const L = Math.hypot(dx, dy), R = 50, k = L > R ? R / L : 1; const x = dx * k, y = dy * k;
    knob.style.transform = `translate(${x}px,${y}px)`; game.input.right = x / R; game.input.fwd = -y / R;
  };
  zone.addEventListener("pointerdown", (e) => { if (jid >= 0) return; jid = e.pointerId; zone.setPointerCapture(jid); cx = e.clientX; cy = e.clientY; base.style.display = "block"; base.style.left = `${cx}px`; base.style.top = `${cy}px`; setKnob(0, 0); });
  zone.addEventListener("pointermove", (e) => { if (e.pointerId === jid) setKnob(e.clientX - cx, e.clientY - cy); });
  const end = (e: PointerEvent) => { if (e.pointerId !== jid) return; jid = -1; base.style.display = "none"; game.input.right = 0; game.input.fwd = 0; };
  zone.addEventListener("pointerup", end); zone.addEventListener("pointercancel", end);
  zone.style.position = "fixed"; base.style.position = "fixed";

  // teclado
  const keys = new Set<string>();
  const kbd = () => { game.input.right = (keys.has("d") || keys.has("arrowright") ? 1 : 0) - (keys.has("a") || keys.has("arrowleft") ? 1 : 0); game.input.fwd = (keys.has("w") || keys.has("arrowup") ? 1 : 0) - (keys.has("s") || keys.has("arrowdown") ? 1 : 0); };
  addEventListener("keydown", (e) => { const k = e.key.toLowerCase(); if (k === " ") { game.manualSwing(); e.preventDefault(); } else if (k === "enter") game.serve(); else { keys.add(k); kbd(); } });
  addEventListener("keyup", (e) => { keys.delete(e.key.toLowerCase()); kbd(); });
  $("swingBtn").addEventListener("pointerdown", (e) => { e.preventDefault(); game.manualSwing(); });
  $("serveBtn").addEventListener("pointerdown", (e) => { e.preventDefault(); if (game.state !== "rally") game.serve(); });

  // painel
  const panel = $("panel"); $("gear").addEventListener("click", () => { panel.hidden = !panel.hidden; if (!panel.hidden) renderLog(); });
  const logEl = document.createElement("pre");
  const renderLog = () => { logEl.textContent = game.log.filter((l) => l.type === "contact" || l.type === "swing" || l.type === "dead").slice(-14).map((l) => JSON.stringify(l)).join("\n"); };
  const build = () => {
    panel.innerHTML = `<b>Beach Tênis</b> <small>v${version}</small>`;
    const chk = (key: "auto" | "autoServe" | "footprints", label: string) => { const l = document.createElement("label"); l.innerHTML = `<span>${label}<input type="checkbox"></span>`; const i = l.querySelector("input")!; i.checked = S[key]; i.onchange = () => { S[key] = i.checked; saveSettings(); }; panel.appendChild(l); };
    chk("auto", "Golpe automático (sincronizado)"); chk("autoServe", "Saque automático"); chk("footprints", "Marcas dos pés na areia");
    for (const [title, specs] of SPECS) {
      const h = document.createElement("h3"); h.textContent = title; panel.appendChild(h);
      for (const sp of specs) {
        const l = document.createElement("label"); const v = S[sp.key] as number;
        l.innerHTML = `<span>${sp.label}<b>${v}</b></span><input type="range" min="${sp.min}" max="${sp.max}" step="${sp.step}" value="${v}">`;
        const inp = l.querySelector("input")!, out = l.querySelector("b")!;
        inp.oninput = () => { (S as unknown as Record<string, number>)[sp.key] = Number(inp.value); out.textContent = inp.value; if (!sp.recalc) game.applySettings(false); };
        inp.onchange = () => { saveSettings(); game.applySettings(true); };
        panel.appendChild(l);
      }
    }
    const b1 = document.createElement("button"); b1.textContent = "Restaurar padrão"; b1.onclick = () => { Object.assign(S, DEFAULTS); saveSettings(); game.applySettings(true); build(); };
    const b2 = document.createElement("button"); b2.textContent = "Copiar log"; b2.onclick = () => { navigator.clipboard?.writeText(JSON.stringify({ S, log: game.log })).catch(() => {}); };
    const b3 = document.createElement("button"); b3.textContent = "Fechar"; b3.onclick = () => { panel.hidden = true; };
    panel.append(b1, b2, b3, logEl);
  };
  build();
  setInterval(() => { if (!panel.hidden) renderLog(); }, 700);

  return {
    showUpdate: (fn) => { const u = $("upd"); u.hidden = false; $("updBtn").onclick = fn; },
  };
}
