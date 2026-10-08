import type { Game } from "./game";
import { CAMS, CAM_COUNT, CAM_NAMES, cleanPose, samePose } from "./camera";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const DEG = 180 / Math.PI;

/** tela "Ajustar câmera" (antes da partida): mostra a quadra da partida com as duas em seus lugares; as 3 câmeras são abas; arrastar, pinça, ＋/－ ou os controles movem a câmera ao vivo
 *  e "Salvar" grava a posição (giro, altura, distância) na câmera escolhida, no aparelho. onExit: volta à capa. */
export function initCamEdit(game: Game, onExit: () => void): { open: () => void } {
  const box = $("camEdit"), tabs = $("ceTabs"), save = $("ceSave") as HTMLButtonElement, reset = $("ceReset") as HTMLButtonElement;
  const yaw = $("ceYaw") as HTMLInputElement, pit = $("cePitch") as HTMLInputElement, dist = $("ceDist") as HTMLInputElement, vy = $("ceYawV"), vp = $("cePitchV"), vd = $("ceDistV");
  let raf = 0;
  const dirty = (): boolean => !samePose(cleanPose(game.cam, game.cam), CAMS.get());

  const renderTabs = (): void => {
    tabs.textContent = "";
    for (let i = 0; i < CAM_COUNT; i++) {
      const b = document.createElement("button"); b.className = i === CAMS.sel ? "on" : ""; b.innerHTML = `${i + 1}<i>${CAM_NAMES[i]}${CAMS.isCustom(i) ? " ✎" : ""}</i>`;
      b.onclick = () => { if (i === CAMS.sel) return; askSave(); CAMS.select(i); game.applyCam(); renderTabs(); };
      tabs.appendChild(b);
    }
  };

  /** alteração não salva: pergunta se quer salvar antes de trocar de câmera ou sair (OK salva; Cancelar descarta) */
  const askSave = (): void => {
    if (dirty() && confirm(`Salvar a posição na câmera ${CAMS.sel + 1}?\nOK salva; Cancelar descarta a alteração.`)) CAMS.save(CAMS.sel, cleanPose(game.cam, game.cam));
  };

  const doSave = (): void => { CAMS.save(CAMS.sel, cleanPose(game.cam, game.cam)); renderTabs(); refresh(); game.onToast(`Câmera ${CAMS.sel + 1} salva`, CAM_NAMES[CAMS.sel]); };
  $("ceEye").onclick = () => box.classList.toggle("min");   // painel recolhido: dá para ver a tela inteira como vai ficar no jogo
  save.onclick = doSave;
  reset.onclick = () => { CAMS.reset(CAMS.sel); game.applyCam(); renderTabs(); refresh(); game.onToast(`Câmera ${CAMS.sel + 1}`, "voltou ao padrão"); };
  $("ceDone").onclick = () => { askSave(); cancelAnimationFrame(raf); box.hidden = true; document.body.classList.remove("camedit"); game.camPreview(false); onExit(); };

  // controles ao vivo: mexem na câmera; o laço abaixo devolve para eles o que arrastar/pinça/zoom fizeram
  yaw.oninput = () => { game.setCamPose({ yaw: Number(yaw.value) / DEG }); refresh(); };
  pit.oninput = () => { game.setCamPose({ pitch: Number(pit.value) / DEG }); refresh(); };
  dist.oninput = () => { game.setCamPose({ dist: Number(dist.value) / 10 }); refresh(); };

  /** devolve para os controles o que a câmera está fazendo (arrastar, pinça, zoom) e mostra se há alteração não salva */
  const refresh = (): void => {
    const c = cleanPose(game.cam, game.cam), on = document.activeElement;
    if (on !== yaw) yaw.value = String(Math.round(c.yaw * DEG)); if (on !== pit) pit.value = String(Math.round(c.pitch * DEG)); if (on !== dist) dist.value = String(Math.round(c.dist * 10));
    vy.textContent = `${Math.round(c.yaw * DEG)}°`; vp.textContent = `${Math.round(c.pitch * DEG)}°`; vd.textContent = `${c.dist.toFixed(1).replace(".", ",")} m`;
    const d = dirty(); save.disabled = !d; save.textContent = d ? `💾 Salvar na câmera ${CAMS.sel + 1}` : `✔ Câmera ${CAMS.sel + 1} salva`;
  };
  const loop = (): void => { refresh(); raf = requestAnimationFrame(loop); };

  return { open: () => { renderTabs(); box.hidden = false; box.classList.remove("min"); document.body.classList.add("camedit"); game.camPreview(true); cancelAnimationFrame(raf); loop(); } };
}
