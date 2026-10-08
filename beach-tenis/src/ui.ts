import { Game } from "./game";
import { S, DEFAULTS, saveSettings, Settings } from "./settings";
import { cueState, cueProgress } from "./cuemark";
import { mountPwaUI } from "./pwaui";
import { STROKES, strokeOf } from "./strokes";
import { initMenu } from "./menu";
import type { Choice } from "./quality";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
type Spec = { key: keyof Settings; label: string; min: number; max: number; step: number; recalc?: boolean };
const SPECS: Array<[string, Spec[]]> = [
  ["Jogo", [
    { key: "assist", label: "Raio de posição (m): quão longe do ponto ainda acerta", min: 0.2, max: 1.5, step: 0.05 },
    { key: "timing", label: "Janela de tempo (×): perfeito/bom", min: 0.6, max: 2.5, step: 0.1 },
    { key: "hitRadius", label: "Raio de acerto da bola (m)", min: 0.15, max: 0.8, step: 0.01 },
    { key: "ballSpeed", label: "Velocidade da bola (m/s)", min: 6, max: 16, step: 0.5 },
    { key: "aimSpread", label: "Dispersão da mira (m)", min: 0, max: 2.5, step: 0.1 },
    { key: "timeScale", label: "Velocidade das animações", min: 0.5, max: 1.5, step: 0.05 },
  ]],
  ["Câmera", [
    { key: "camSens", label: "Sensibilidade do giro (×)", min: 0.4, max: 2.5, step: 0.1 },
  ]],
  ["Marcas dos pés", [{ key: "footLife", label: "Duração (s)", min: 5, max: 60, step: 1 }]],
  ["Sincronia", [{ key: "contactOffset", label: "Ajuste do contato (frames)", min: -10, max: 10, step: 1, recalc: true }]],
  ["Visual", [
    { key: "ballVisual", label: "Tamanho visual da bola ×", min: 1, max: 4, step: 0.1 },
    { key: "faceAssist", label: "Face da raquete na parede (contato)", min: 0, max: 1, step: 0.05, recalc: true },
    { key: "playerScale", label: "Escala da jogadora", min: 1.3, max: 2.2, step: 0.01, recalc: true },
  ]],
  ["Raquete — ajuste fino sobre a pegada (m / °)", [
    { key: "rkX", label: "X", min: -0.15, max: 0.15, step: 0.005 }, { key: "rkY", label: "Y", min: -0.15, max: 0.15, step: 0.005 }, { key: "rkZ", label: "Z", min: -0.15, max: 0.15, step: 0.005 },
    { key: "rkRX", label: "Rot X", min: -180, max: 180, step: 1 }, { key: "rkRY", label: "Rot Y", min: -180, max: 180, step: 1 }, { key: "rkRZ", label: "Rot Z", min: -180, max: 180, step: 1 },
  ]],
];

export function initUI(game: Game, version: string): { showUpdate: (fn: () => void) => void } {
  const toast = $("toast"); let tt = 0;
  const hitFx = $("hitFx"); let th = 0;
  game.onToast = (m, sub, ms) => {
    if (/^(Perfeito|Bom!|Cedo|Tarde|Longe|Saque!)/.test(m)) {   // resultado da batida e nome do golpe: texto pequeno ao lado dos botões, não no meio da tela
      const k = /^Perfeito/.test(m) ? "perfect" : /^Bom/.test(m) ? "good" : /^Saque/.test(m) ? "serve" : "miss";
      hitFx.textContent = m; if (sub) { const el = document.createElement("small"); el.textContent = sub; hitFx.appendChild(el); }
      hitFx.className = `k-${k} on`; clearTimeout(th); th = window.setTimeout(() => hitFx.classList.remove("on"), sub ? 1100 : 800); return;
    }
    toast.textContent = m; if (sub) { const el = document.createElement("small"); el.textContent = sub; toast.appendChild(el); }
    const k = /^Perfeito/.test(m) ? "perfect" : /^Bom/.test(m) ? "good" : /^(Cedo|Tarde|Longe|Sem fôlego)/.test(m) ? "miss" : /^Ponto!/.test(m) ? "win" : /^Ponto da/.test(m) ? "lose" : /^Saque/.test(m) ? "serve" : /^(ACE|SMASH|RALI DE)/.test(m) ? "big" : "";
    toast.className = (k ? `k-${k} ` : "") + "on"; clearTimeout(tt); tt = window.setTimeout(() => toast.classList.remove("on"), ms ?? (sub ? 1300 : 900));
  };
  const sta = $("sta"), staSegs: HTMLElement[] = [];   // fôlego em 10 segmentos
  for (let i = 0; i < 10; i++) { const e = document.createElement("i"); sta.appendChild(e); staSegs.push(e); }
  const calls = $("calls");   // balões de chamada das duplas ("Minha!", "Sua!", "Fora!"): um elemento por balão, reaproveitado
  game.onCalls = (list) => {
    while (calls.children.length < list.length) { const e = document.createElement("div"); e.className = "call"; calls.appendChild(e); }
    for (let i = 0; i < calls.children.length; i++) { const e = calls.children[i] as HTMLElement, c = list[i]; if (!c) { e.style.display = "none"; continue; } e.style.display = ""; e.textContent = c.text; e.className = `call t${c.team}`; e.style.left = `${c.x}%`; e.style.top = `${c.y}%`; e.style.opacity = String(c.a); }
  };
  game.onStamina = (v) => { const n = Math.ceil(v * 10 - 0.001); staSegs.forEach((e, i) => e.classList.toggle("on", i < n)); sta.classList.toggle("low", v < 0.3); sta.classList.toggle("mid", v >= 0.3 && v < 0.55); };
  const rallyEl = $("rally"); let lastRally = -1;
  /** canto superior esquerdo: rali (some na partida enquanto não há rali) e último golpe (no treino, com erro em ms e distância em cm; na partida só o nome) */
  const upd = () => {
    const m = game.mode === "match";
    rallyEl.innerHTML = `<small>RALI</small><b>${game.rally}</b>${m ? "" : `<small class="rec">RECORDE ${game.record}</small>`}`; rallyEl.classList.toggle("idle", m && game.rally === 0);
    if (game.rally !== lastRally) { rallyEl.classList.remove("bump"); void rallyEl.offsetWidth; if (game.rally > 0) rallyEl.classList.add("bump"); lastRally = game.rally; }
    $("info").textContent = m ? game.info.split(" · erro")[0] : game.info;
    $("serveBtn").hidden = m && (S.autoServe || game.match?.currentServer() !== null || game.match?.over !== null);   // na partida o SACAR só existe no saque manual e na vez dela
  };
  game.onHud = upd; upd();

  // joystick
  const zone = $("joyZone"), base = $("joyBase"), knob = $("knob"); let jid = -1, cx = 0, cy = 0;
  const setKnob = (dx: number, dy: number) => {
    const L = Math.hypot(dx, dy), R = 50, k = L > R ? R / L : 1; const x = dx * k, y = dy * k;
    knob.style.transform = `translate(${x}px,${y}px)`; game.input.right = x / R; game.input.fwd = -y / R;
  };
  zone.addEventListener("pointerdown", (e) => { if (jid >= 0 && !zone.hasPointerCapture(jid)) jid = -1; if (jid >= 0) return; jid = e.pointerId; zone.setPointerCapture(jid); cx = e.clientX; cy = e.clientY; base.style.display = "block"; base.style.left = `${cx}px`; base.style.top = `${cy}px`; setKnob(0, 0); });
  zone.addEventListener("pointermove", (e) => { if (e.pointerId === jid) setKnob(e.clientX - cx, e.clientY - cy); });
  const end = (e: PointerEvent) => { if (e.pointerId !== jid) return; jid = -1; base.style.display = "none"; game.input.right = 0; game.input.fwd = 0; };
  zone.addEventListener("pointerup", end); zone.addEventListener("pointercancel", end); zone.addEventListener("lostpointercapture", end);   // perder a captura (ligação, troca de app) também solta o direcional
  addEventListener("blur", () => { if (jid >= 0) { jid = -1; base.style.display = "none"; game.input.right = 0; game.input.fwd = 0; } });
  zone.style.position = "fixed"; base.style.position = "fixed";

  // teclado
  const keys = new Set<string>();
  const kbd = () => { game.input.right = (keys.has("d") || keys.has("arrowright") ? 1 : 0) - (keys.has("a") || keys.has("arrowleft") ? 1 : 0); game.input.fwd = (keys.has("w") || keys.has("arrowup") ? 1 : 0) - (keys.has("s") || keys.has("arrowdown") ? 1 : 0); };
  addEventListener("keydown", (e) => {
    const k = e.key.toLowerCase();
    if (game.viewer && (k === "escape" || k === "arrowleft" || k === "arrowright" || k === " ")) { if (k === "escape") game.viewClose(); else if (k === " ") game.viewPause(); else game.viewStep(k === "arrowleft" ? -1 : 1); e.preventDefault(); return; }
    if (k === "g") { if (game.viewer) game.viewClose(); else openView(); return; }
    if (k === " ") { if (!e.repeat && game.manualSwing()) game.setHold(true); e.preventDefault(); } else if (k === "enter") game.serve();
    else if (k === "q") game.orbit(0.12, 0); else if (k === "e") game.orbit(-0.12, 0); else if (k === "+" || k === "=") game.zoom(0.9); else if (k === "-") game.zoom(1.1); else if (k === "r") game.recenter(); else if (k === "c") game.cycleCam();
    else { keys.add(k); kbd(); }
  });
  addEventListener("keyup", (e) => { if (e.key === " ") game.setHold(false); keys.delete(e.key.toLowerCase()); kbd(); });
  // iPhone: dois dedos ao mesmo tempo (direcional + GOLPE) não podem virar gesto de zoom do Safari, que cancelaria os dois toques
  for (const t of ["gesturestart", "gesturechange", "gestureend"]) document.addEventListener(t, (e) => e.preventDefault(), { passive: false });
  // GOLPE: apertar = tempo (como sempre); segurar até a bola bater = força (partida). Soltar, cancelar, perder o foco ou esconder a aba encerram a carga com o valor de agora
  const swingBtn = $("swingBtn");
  swingBtn.addEventListener("pointerdown", (e) => { e.preventDefault(); try { swingBtn.setPointerCapture(e.pointerId); } catch { /* sem captura */ } if (game.manualSwing()) game.setHold(true); });
  const letGo = (): void => game.setHold(false);
  for (const ev of ["pointerup", "pointercancel", "lostpointercapture"]) swingBtn.addEventListener(ev, letGo);
  addEventListener("blur", letGo); document.addEventListener("visibilitychange", () => { if (document.hidden) letGo(); });
  const pbar = $("powerBar"), pfill = pbar.firstElementChild as HTMLElement; let pf = -1, pz = "", pon = false;   // barra de força: só enquanto o dedo está no botão
  game.onPower = (v) => {
    const on = !!v && v.hold; if (on !== pon) { pon = on; pbar.classList.toggle("on", on); }
    if (!v) return;
    const f = Math.round(v.f * 200) / 200, z = f <= 0.3 ? "0" : f <= 0.75 ? "1" : "2";
    if (f !== pf) { pf = f; pfill.style.transform = `scaleX(${f})`; } if (z !== pz) { pz = z; pbar.dataset.z = z; }
  };
  // aviso de tempo: o anel em volta do GOLPE encolhe até fechar no botão (apertar agora); verde = janela de acerto
  const ring = $("timeRing");
  const cueName = $("cueName");
  game.onCue = (v) => {
    if (!v) { ring.style.opacity = "0"; swingBtn.classList.remove("now"); cueName.classList.remove("on"); return; }
    if (cueName.textContent !== v.label) cueName.textContent = v.label; cueName.classList.add("on");
    const st = cueState(v); ring.dataset.st = st; ring.style.opacity = st === "bad" ? "0.3" : st === "out" ? "0.55" : "1";
    ring.style.transform = `scale(${1 + 0.55 * cueProgress(v.ttp)})`; swingBtn.classList.toggle("now", st === "now");
  };
  $("serveBtn").addEventListener("pointerdown", (e) => { e.preventDefault(); if (game.state === "wait" || game.state === "dead") game.serve(); });

  // câmera: arrastar (um dedo ou mouse) gira 360° em volta da jogadora; pinça, roda do mouse ou ＋/－ = zoom; ⟲ recentraliza
  const camZone = $("camZone"), ptrs = new Map<number, { x: number; y: number }>(); let pinch = 0;
  const pdist = () => { const [a, b] = [...ptrs.values()]; return Math.hypot(a.x - b.x, a.y - b.y); };
  camZone.addEventListener("pointerdown", (e) => { camZone.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY }); pinch = ptrs.size === 2 ? pdist() : 0; });
  camZone.addEventListener("pointermove", (e) => {
    const q = ptrs.get(e.pointerId); if (!q) return; const dx = e.clientX - q.x, dy = e.clientY - q.y; q.x = e.clientX; q.y = e.clientY;
    if (ptrs.size === 1) game.orbit(-dx * 0.0075 * S.camSens, dy * 0.005 * S.camSens);
    else if (ptrs.size === 2) { const d = pdist(); if (pinch > 0 && d > 0) game.zoom(pinch / d); pinch = d; }
  });
  const camEnd = (e: PointerEvent) => { if (ptrs.delete(e.pointerId)) { pinch = 0; saveSettings(); } };
  camZone.addEventListener("pointerup", camEnd); camZone.addEventListener("pointercancel", camEnd);
  camZone.addEventListener("wheel", (e) => { e.preventDefault(); game.zoom(Math.exp(e.deltaY * 0.0012)); }, { passive: false });
  $("zoomIn").addEventListener("click", () => { game.zoom(0.85); saveSettings(); });
  $("zoomOut").addEventListener("click", () => { game.zoom(1.18); saveSettings(); });
  $("camReset").addEventListener("click", () => game.recenter());
  $("camCycle").addEventListener("click", () => game.cycleCam());

  // galeria de golpes: botão 🎬 Golpes (ou o menu) interrompe o rali e repete o golpe do vídeo; pausa, câmera lenta e arrastar o tempo
  const vbar = $("viewBar"), vsel = $("viewSel") as HTMLSelectElement, vseek = $("viewSeek") as HTMLInputElement, vplay = $("vPlay"), vspeed = $("vSpeed");
  const SPEEDS = [1, 0.5, 0.25], SPEED_TXT: Record<number, string> = { 1: "1×", 0.5: "½×", 0.25: "¼×" }; let seeking = false;
  game.onView = (v) => {
    document.body.classList.toggle("viewing", !!v); vbar.hidden = !v; if (!v) return;
    if (!vsel.options.length) for (const c of game.viewList()) { const st = strokeOf(c)!, o = document.createElement("option"); o.value = c; o.textContent = st.clips.length > 1 ? `${st.label} · ${st.clips.indexOf(c) + 1}/${st.clips.length}` : st.label; vsel.appendChild(o); }
    vsel.value = v.clip; vplay.textContent = v.paused ? "Seguir" : "Pausar"; vspeed.textContent = SPEED_TXT[v.speed] ?? `${v.speed}×`;
  };
  const openView = (clip?: string): boolean => { const ok = game.viewStroke(clip ?? game.viewList()[0] ?? ""); if (!ok) game.onToast("Golpes do vídeo não carregaram — feche e abra o app"); return ok; };
  $("viewBtn").addEventListener("click", () => openView());
  vsel.onchange = () => { game.viewStroke(vsel.value); vsel.blur(); };
  $("vPrev").onclick = () => game.viewStep(-1); $("vNext").onclick = () => game.viewStep(1); vplay.onclick = () => game.viewPause(); $("vExit").onclick = () => game.viewClose();
  vspeed.onclick = () => game.viewSpeed(SPEEDS[(SPEEDS.indexOf(game.viewer?.speed ?? 1) + 1) % SPEEDS.length]);
  vseek.addEventListener("pointerdown", () => { seeking = true; game.viewPause(true); });
  const seekEnd = () => { seeking = false; }; vseek.addEventListener("pointerup", seekEnd); vseek.addEventListener("pointercancel", seekEnd);
  vseek.oninput = () => { game.viewPause(true); game.viewSeek(Number(vseek.value) / 1000); };
  setInterval(() => { if (game.viewer && !seeking) vseek.value = String(Math.round(game.viewT() * 1000)); }, 60);

  // painel
  const panel = $("panel"); $("gear").addEventListener("click", () => { panel.hidden = !panel.hidden; if (!panel.hidden) renderLog(); });
  camZone.addEventListener("pointerdown", () => { panel.hidden = true; });   // toque fora do menu fecha
  const logEl = document.createElement("pre");
  const renderLog = () => { logEl.textContent = game.log.filter((l) => l.type === "contact" || l.type === "swing" || l.type === "dead").slice(-14).map((l) => JSON.stringify(l)).join("\n"); };
  const pwaBox = document.createElement("div"); pwaBox.id = "pwaBox";
  mountPwaUI($("installChip") as HTMLButtonElement, pwaBox, () => { panel.hidden = false; renderLog(); });
  const build = () => {
    panel.innerHTML = `<div class="ph"><span><b>Beach Tênis</b> <small>v${version}</small></span><button type="button">✕ Fechar</button></div>`;
    panel.querySelector<HTMLButtonElement>(".ph button")!.onclick = () => { panel.hidden = true; }; panel.appendChild(pwaBox);
    const qh = document.createElement("h3"); qh.textContent = "Qualidade gráfica"; panel.appendChild(qh);
    const ql = document.createElement("label"); ql.innerHTML = `<span>Nível<select><option value="auto">Auto (recomendado: começa pelo que o aparelho aguenta e só desce se travar)</option><option value="alta">Alta (fixa: a mais nítida)</option><option value="media">Média</option><option value="baixa">Baixa</option></select></span><small class="qnow"></small>`;
    const qs = ql.querySelector("select")!, qn = ql.querySelector(".qnow")!; qs.value = game.quality.choice;
    const QD: Record<string, string> = { alta: "sombras nítidas, bloom e cor de cinema", media: "sombras do sol e vinheta", baixa: "sem sombras do sol, sem nuvens" };
    const qshow = () => { qn.textContent = `Agora: ${game.quality.label()} — ${QD[game.quality.tier]}`; };
    qs.onchange = () => { game.quality.set(qs.value as Choice); qshow(); }; qshow(); panel.appendChild(ql);
    const tl = document.createElement("label"); tl.innerHTML = `<span>Hora do dia<select><option value="0">Avança com a partida</option><option value="1">Manhã</option><option value="2">Tarde</option><option value="3">Pôr do sol</option></select></span>`;
    const ts = tl.querySelector("select")!; ts.value = String(S.tod); ts.onchange = () => { S.tod = Number(ts.value); saveSettings(); }; panel.appendChild(tl);
    const gh = document.createElement("h3"); gh.textContent = "Golpes do vídeo (toque para ver)"; panel.appendChild(gh);
    const chips = document.createElement("div"); chips.className = "chips"; const turn = new Map<string, number>();
    for (const st of STROKES) {
      const b = document.createElement("button"); b.textContent = st.label;
      b.onclick = () => {
        const i = turn.get(st.key) ?? 0; turn.set(st.key, i + 1); const clip = st.clips[i % st.clips.length];
        if (openView(clip)) panel.hidden = true;
      };
      chips.appendChild(b);
    }
    panel.appendChild(chips);
    const chk = (key: "auto" | "autoServe" | "stamina" | "footprints" | "force", label: string) => { const l = document.createElement("label"); l.innerHTML = `<span>${label}<input type="checkbox"></span>`; const i = l.querySelector("input")!; i.checked = S[key]; i.onchange = () => { S[key] = i.checked; saveSettings(); game.onHud(); }; panel.appendChild(l); };
    chk("auto", "Golpe automático (modo fácil: o jogo aperta na hora)"); chk("autoServe", "Saque automático"); chk("stamina", "Fôlego (quem corre mais cansa e fica mais lenta)"); chk("footprints", "Marcas dos pés na areia"); chk("force", "Partida: marcador de queda e força (segure o GOLPE até a bola bater)");
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
  initMenu(game, () => { openView(); });

  return {
    showUpdate: (fn) => { const u = $("upd"); u.hidden = false; $("updBtn").onclick = fn; },
  };
}
