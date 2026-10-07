/** Fôlego do jogador: gasta correndo, recupera parado ou andando devagar; com pouco fôlego a corrida fica mais lenta (até 55% da velocidade). */
export class Stamina {
  value = 1;
  static COST = 0.02;                      // fração do fôlego por metro corrido (andando ou correndo, > 0,35 m/s)
  static REGEN_STILL = 0.006;              // por segundo, parada durante o rali (quase não recupera)
  static REGEN_REST = 0.08;                // por segundo, entre os pontos
  static LOW = 0.45;                       // abaixo disto a velocidade começa a cair
  static MIN_MUL = 0.55;                   // velocidade com o fôlego zerado (fração da máxima)
  /** speed em m/s; resting: entre pontos (recupera mais rápido) */
  update(dt: number, speed: number, resting = false): void {
    if (resting) this.value += Stamina.REGEN_REST * dt;
    else if (speed < 0.35) this.value += Stamina.REGEN_STILL * dt;
    else this.value -= Stamina.COST * speed * dt;
    this.value = Math.min(1, Math.max(0, this.value));
  }
  restore(x: number): void { this.value = Math.min(1, this.value + x); }
  /** gasto de um golpe (fração): bater cansa, golpes por cima mais */
  drain(x: number): void { this.value = Math.max(0, this.value - x); }
  reset(): void { this.value = 1; }
  /** multiplicador da velocidade máxima: 1 com fôlego, MIN_MUL sem */
  mul(): number { const t = Math.min(1, this.value / Stamina.LOW); return Stamina.MIN_MUL + (1 - Stamina.MIN_MUL) * t * t * (3 - 2 * t); }
}
