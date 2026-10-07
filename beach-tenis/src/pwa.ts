// PWA: service worker (jogo offline + aviso de nova versão), progresso do download e o evento de instalação do navegador.
export interface PwaState { supported: boolean; phase: "idle" | "downloading" | "ready"; pct: number; installable: boolean; standalone: boolean; }
interface InstallEvent extends Event { prompt(): Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }>; }

const standaloneNow = (): boolean => {
  try { return matchMedia("(display-mode: standalone)").matches || matchMedia("(display-mode: fullscreen)").matches || (navigator as { standalone?: boolean }).standalone === true; } catch { return false; }
};
let state: PwaState = { supported: false, phase: "idle", pct: 0, installable: false, standalone: standaloneNow() };
const listeners = new Set<(s: PwaState) => void>();
const set = (p: Partial<PwaState>): void => { state = { ...state, ...p }; listeners.forEach((l) => l(state)); };
export const onPwa = (l: (s: PwaState) => void): void => { listeners.add(l); l(state); };

let deferred: InstallEvent | null = null;
addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); deferred = e as InstallEvent; set({ installable: true }); });   // guarda o evento para o nosso botão
addEventListener("appinstalled", () => { deferred = null; set({ installable: false, standalone: true }); });
export const isIos = (): boolean => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

export async function installApp(): Promise<void> {
  const ev = deferred; if (!ev) return;
  deferred = null; set({ installable: false });
  try { await ev.prompt(); await ev.userChoice; } catch { /* dispensado */ }
}

let userRequested = false;
export function initPwa(onUpdate: (reg: ServiceWorkerRegistration) => void): void {
  if (!("serviceWorker" in navigator) || import.meta.env.DEV) return;
  navigator.serviceWorker.addEventListener("message", (e) => {   // o sw.js avisa quantos arquivos já guardou
    const d = e.data as { type?: string; done?: number; total?: number } | null;
    if (d?.type === "progress" && d.total && state.phase !== "ready") { const pct = Math.round(100 * (d.done ?? 0) / d.total); set(pct >= 100 ? { phase: "ready", pct: 100 } : { phase: "downloading", pct }); }
  });
  navigator.serviceWorker.register("./sw.js").then((reg) => {
    set({ supported: true, ...(reg.active && navigator.serviceWorker.controller ? { phase: "ready", pct: 100 } : { phase: "downloading" }) });
    const check = () => { reg.update().catch(() => {}); };
    if (reg.waiting && navigator.serviceWorker.controller) onUpdate(reg);
    reg.addEventListener("updatefound", () => {
      const w = reg.installing;
      w?.addEventListener("statechange", () => { if (w.state === "installed" && navigator.serviceWorker.controller) onUpdate(reg); });
    });
    document.addEventListener("visibilitychange", () => { if (!document.hidden) check(); });
    setInterval(check, 5 * 60 * 1000);
    void navigator.serviceWorker.ready.then(() => set({ phase: "ready", pct: 100 }));
  }).catch(() => {});
  let reloading = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => { if (reloading || !userRequested) return; reloading = true; location.reload(); });
}
export function applyUpdate(reg: ServiceWorkerRegistration): void {
  userRequested = true;
  if (reg.waiting) reg.waiting.postMessage({ type: "SKIP_WAITING" }); else location.reload();
}
