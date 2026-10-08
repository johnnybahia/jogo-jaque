/** Qualidade gráfica: três níveis (Alta, Média, Baixa) e o modo Auto, que começa pelo que o aparelho aparenta aguentar e desce um degrau quando o FPS fica baixo por alguns segundos (nunca sobe sozinho).
 *  `?q=alta|media|baixa` na URL força o nível (sem Auto e sem salvar): serve aos testes automáticos. */
export type Tier = "alta" | "media" | "baixa";
export type Choice = Tier | "auto";

export interface Profile {
  tier: Tier;
  dprCap: number;   // teto da densidade de pixels (o aparelho pode ter 3×; o jogo nunca passa disto)
}
export const PROFILES: Record<Tier, Profile> = {
  alta: { tier: "alta", dprCap: 2 },
  media: { tier: "media", dprCap: 1.5 },
  baixa: { tier: "baixa", dprCap: 1 },
};
export const TIER_NAMES: Record<Tier, string> = { alta: "Alta", media: "Média", baixa: "Baixa" };

/** degraus do Auto, do melhor para o pior: nível + escala de resolução */
const STEPS: { tier: Tier; scale: number }[] = [
  { tier: "alta", scale: 1 }, { tier: "media", scale: 1 }, { tier: "media", scale: 0.85 }, { tier: "baixa", scale: 0.85 }, { tier: "baixa", scale: 0.7 },
];
const KEY = "bt.quality.v1";
const WINDOW = 2, FPS_MIN = 38, BAD_WINDOWS = 2, COOLDOWN = 6, GRACE = 4;

/** nível inicial do Auto: celular/tablet (toque) ou tela pequena → Média; computador → Alta */
export function detectStep(): number {
  const coarse = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
  const small = Math.min(innerWidth, innerHeight) < 700;
  const mem = (navigator as unknown as { deviceMemory?: number }).deviceMemory ?? 8;
  return mem <= 2 ? 3 : coarse || small ? 1 : 0;
}

export class Quality {
  choice: Choice = "auto";
  private step = 0;
  private forced: Tier | null = null;
  private acc = 0; private n = 0; private acc2 = 0; private bad = 0; private cool = GRACE;
  onChange: () => void = () => {};

  constructor() {
    const q = new URLSearchParams(location.search).get("q");
    if (q === "alta" || q === "media" || q === "baixa") { this.forced = q; this.choice = q; return; }
    try {
      const r = JSON.parse(localStorage.getItem(KEY) || "null") as { choice?: string; step?: number } | null;
      if (r && (r.choice === "auto" || r.choice === "alta" || r.choice === "media" || r.choice === "baixa")) this.choice = r.choice;
      this.step = this.choice === "auto" && typeof r?.step === "number" ? Math.max(0, Math.min(STEPS.length - 1, r.step | 0)) : -1;
    } catch { this.step = -1; }
    if (this.step < 0) this.step = detectStep();
  }

  get tier(): Tier { return this.forced ?? (this.choice === "auto" ? STEPS[this.step].tier : (this.choice as Tier)); }
  get scale(): number { return this.forced || this.choice !== "auto" ? 1 : STEPS[this.step].scale; }
  get profile(): Profile { return PROFILES[this.tier]; }
  get auto(): boolean { return !this.forced && this.choice === "auto"; }
  /** densidade de pixels efetiva do renderizador */
  pixelRatio(dpr: number): number { return Math.max(0.5, Math.min(dpr, this.profile.dprCap) * this.scale); }
  label(): string { return this.auto ? `Auto · ${TIER_NAMES[this.tier]}${this.scale < 1 ? ` · ${Math.round(this.scale * 100)}%` : ""}` : TIER_NAMES[this.tier]; }

  set(c: Choice): void {
    this.choice = c; this.forced = null; this.step = c === "auto" ? detectStep() : this.step; this.bad = 0; this.acc = this.n = this.acc2 = 0; this.cool = COOLDOWN;
    this.save(); this.onChange();
  }

  private save(): void { try { localStorage.setItem(KEY, JSON.stringify({ choice: this.choice, step: this.step })); } catch { /* sem storage */ } }

  /** chamar a cada quadro com o tempo real (s). Devolve true quando o Auto desceu um degrau. */
  frame(dt: number): boolean {
    if (!this.auto || document.hidden) { this.acc = this.n = this.acc2 = 0; return false; }
    if (dt > 0.25) { this.acc = this.n = this.acc2 = 0; return false; }   // engasgo de carregamento/troca de aba: não conta
    this.acc += dt; this.acc2 += dt * dt; this.n++;
    if (this.acc < WINDOW) return false;
    const fps = this.n / this.acc, mean = this.acc / this.n, sd = Math.sqrt(Math.max(0, this.acc2 / this.n - mean * mean));
    this.acc = this.n = this.acc2 = 0;
    if (this.cool > 0) { this.cool -= WINDOW; this.bad = 0; return false; }
    const locked30 = fps > 27 && fps < 33.5 && sd < 0.002;   // travado em 30 pelo sistema (economia de energia): descer não adianta
    if (fps >= FPS_MIN || locked30) { this.bad = 0; return false; }
    if (++this.bad < BAD_WINDOWS || this.step >= STEPS.length - 1) return false;
    this.step++; this.bad = 0; this.cool = COOLDOWN; this.save(); this.onChange(); return true;
  }
}
