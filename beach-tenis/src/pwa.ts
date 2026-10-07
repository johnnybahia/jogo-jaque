let userRequested = false;
export function initPwa(onUpdate: (reg: ServiceWorkerRegistration) => void): void {
  if (!("serviceWorker" in navigator) || import.meta.env.DEV) return;
  navigator.serviceWorker.register("./sw.js").then((reg) => {
    const check = () => { reg.update().catch(() => {}); };
    if (reg.waiting && navigator.serviceWorker.controller) onUpdate(reg);
    reg.addEventListener("updatefound", () => {
      const w = reg.installing;
      w?.addEventListener("statechange", () => { if (w.state === "installed" && navigator.serviceWorker.controller) onUpdate(reg); });
    });
    document.addEventListener("visibilitychange", () => { if (!document.hidden) check(); });
    setInterval(check, 5 * 60 * 1000);
  }).catch(() => {});
  let reloading = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => { if (reloading || !userRequested) return; reloading = true; location.reload(); });
}
export function applyUpdate(reg: ServiceWorkerRegistration): void {
  userRequested = true;
  if (reg.waiting) reg.waiting.postMessage({ type: "SKIP_WAITING" }); else location.reload();
}
