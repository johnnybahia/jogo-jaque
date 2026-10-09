import "./style.css";
import "./hud.css";
import { Game } from "./game";
import { initUI } from "./ui";
import { initPwa, applyUpdate } from "./pwa";
import { loadSettings, S } from "./settings";
import { PW } from "./match";
import { MATCH } from "./scene";
import { COOP } from "./coop";

declare const __APP_VERSION__: string;
declare global { interface Window { __game?: Game } }

async function boot(): Promise<void> {
  loadSettings();
  const game = new Game(document.getElementById("c") as HTMLCanvasElement);
  const ui = initUI(game, __APP_VERSION__);
  initPwa((reg) => ui.showUpdate(() => applyUpdate(reg)));
  await game.init(import.meta.env.BASE_URL);
  window.__game = game; (window as unknown as Record<string, unknown>).__S = S; (window as unknown as Record<string, unknown>).__PW = PW; (window as unknown as Record<string, unknown>).__MATCH = MATCH; (window as unknown as Record<string, unknown>).__COOP = COOP;   // ganchos de teste
  const ld = document.querySelector("#loading small"); if (ld) ld.textContent = "Preparando os gráficos…";
  await game.warmUp();   // carrega o pós-processamento e compila tudo antes de abrir (nada compila no meio do jogo); não muda a qualidade
  document.getElementById("loading")!.remove();
  addEventListener("resize", () => game.resize());
  let last = performance.now();
  const loop = (now: number) => { const dt = (now - last) / 1000; last = now; if (!document.hidden) { if (game.quality.frame(dt)) game.onToast("Qualidade: " + game.quality.label(), "o jogo estava pesado neste aparelho"); else if (game.quality.slow(dt)) game.onToast("O jogo está pesado neste aparelho", "⚙ → Qualidade gráfica → Média (ou Auto)", 5000); game.tick(dt); game.render(dt); } requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
}
boot().catch((e) => { const el = document.getElementById("loading"); if (el) el.textContent = "Erro: " + (e as Error).message; console.error(e); });
