import "./style.css";
import "./hud.css";
import { Game } from "./game";
import { initUI } from "./ui";
import { initPwa, applyUpdate } from "./pwa";
import { loadSettings, S } from "./settings";

declare const __APP_VERSION__: string;
declare global { interface Window { __game?: Game } }

async function boot(): Promise<void> {
  loadSettings();
  const game = new Game(document.getElementById("c") as HTMLCanvasElement);
  const ui = initUI(game, __APP_VERSION__);
  initPwa((reg) => ui.showUpdate(() => applyUpdate(reg)));
  await game.init(import.meta.env.BASE_URL);
  window.__game = game; (window as unknown as Record<string, unknown>).__S = S;
  document.getElementById("loading")!.remove();
  addEventListener("resize", () => game.resize());
  let last = performance.now();
  const loop = (now: number) => { const dt = (now - last) / 1000; last = now; if (!document.hidden) { if (game.quality.frame(dt)) game.onToast("Qualidade: " + game.quality.label(), "o jogo estava pesado neste aparelho"); game.tick(dt); game.render(dt); } requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
}
boot().catch((e) => { const el = document.getElementById("loading"); if (el) el.textContent = "Erro: " + (e as Error).message; console.error(e); });
