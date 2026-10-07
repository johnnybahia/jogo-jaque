import { PwaState, installApp, isIos, onPwa } from "./pwa";

/** Botão "Instalar app" no canto da tela e a linha de status offline do painel de ajustes. */
export function mountPwaUI(chip: HTMLButtonElement, box: HTMLElement, openPanel: () => void): void {
  let hideT = 0, lastPhase = "";
  const hint = isIos() ? "Compartilhar → Adicionar à Tela de Início" : "menu ⋮ do navegador → Instalar app (ou Adicionar à tela inicial)";
  const render = (s: PwaState): void => {
    // painel
    let h = "";
    if (import.meta.env.DEV) h = `<span class="mut">Offline: só na versão publicada (modo de desenvolvimento).</span>`;
    else if (!s.supported && s.phase === "idle") h = `<span class="mut">Offline indisponível aqui (precisa de https e de um navegador com service worker).</span>`;
    else if (s.phase === "downloading") h = `Baixando para jogar offline… <b>${s.pct}%</b><div class="bar"><i style="width:${s.pct}%"></i></div>`;
    else if (s.phase === "ready") h = `<b class="ok">✓ Pronto para jogar offline</b>`;
    if (s.standalone) h += `<div class="mut">App instalado.</div>`;
    else if (s.supported) h += s.installable ? `<div><button id="pwaInstall">Instalar app</button></div>` : `<div class="mut">Para instalar: ${hint}</div>`;
    box.innerHTML = h; box.querySelector<HTMLButtonElement>("#pwaInstall")?.addEventListener("click", () => void installApp());
    // botão no canto: instalar (quando dá), progresso do download e um "pronto" passageiro
    clearTimeout(hideT); chip.onclick = null; chip.classList.remove("ok");
    if (s.standalone || !s.supported) { chip.hidden = true; return; }
    if (s.phase === "downloading") { chip.hidden = false; chip.textContent = `Baixando p/ offline… ${s.pct}%`; chip.disabled = true; return; }
    chip.disabled = false;
    if (s.installable || isIos()) { chip.hidden = false; chip.textContent = "⬇ Instalar app"; chip.onclick = () => { if (s.installable) void installApp(); else openPanel(); }; return; }
    if (s.phase === "ready" && lastPhase === "downloading") { chip.hidden = false; chip.textContent = "✓ Pronto offline"; chip.classList.add("ok"); hideT = window.setTimeout(() => { chip.hidden = true; }, 4000); } else chip.hidden = true;
  };
  onPwa((s) => { render(s); lastPhase = s.phase; });
}
