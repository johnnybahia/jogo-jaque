// Placar de beach tênis (regras ITF, simplificadas): pontos 15/30/40, sem vantagem (no 40-40 o ponto seguinte decide o game),
// set de 6 games com 2 de diferença e tie-break de 7 em 6-6. Formatos curtos para o celular.
export type Side = 0 | 1;   // 0 = jogadora (Jaqueline), 1 = adversária
export interface Format { id: string; label: string; games: number; setsToWin: number; tiebreak: boolean; matchTb?: boolean; }   // matchTb: em 1 set a 1, o set decisivo é um match tie-break de 10 pontos (regra 7 da CBBT)
export const FORMATS: Record<string, Format> = {
  rapida: { id: "rapida", label: "Rápida (1 set de 4 games)", games: 4, setsToWin: 1, tiebreak: false },
  set: { id: "set", label: "1 set de 6 games", games: 6, setsToWin: 1, tiebreak: true },
  melhor3: { id: "melhor3", label: "Melhor de 3 (3º set: match tie-break de 10)", games: 6, setsToWin: 2, tiebreak: true, matchTb: true },
};
const PT = ["0", "15", "30", "40"];
export interface PointResult { game?: Side; set?: Side; match?: Side; swap?: boolean; }   // swap: as duplas trocam de lado depois deste ponto (regra 11)

export class Score {
  points: [number, number] = [0, 0];      // pontos no game (0..3 = 0/15/30/40) ou no tie-break
  games: [number, number] = [0, 0];
  sets: [number, number] = [0, 0];
  history: [number, number][] = [];       // games de cada set encerrado
  server: Side; inTiebreak = false; winner: Side | null = null; tbFirst: Side; tbTarget = 7;   // tbTarget: 7 no tie-break do set, 10 no match tie-break
  constructor(public fmt: Format, firstServer: Side = 0) { this.server = firstServer; this.tbFirst = firstServer; }

  /** ponto para `side`; devolve o que terminou (game, set, partida) */
  pointWon(side: Side): PointResult {
    if (this.winner !== null) return {};
    const o: Side = side === 0 ? 1 : 0; const out: PointResult = {};
    this.points[side]++;
    if (this.inTiebreak) {
      const total = this.points[0] + this.points[1];
      if (total % 2 === 1) this.server = this.server === 0 ? 1 : 0;           // no tie-break o saque troca depois do 1º ponto e a cada 2
      if (this.points[side] >= this.tbTarget && this.points[side] - this.points[o] >= 2) { this.endGame(side, out); }
      else if (total % 4 === 1) out.swap = true;                              // no tie-break troca-se de lado depois do 1º ponto e a cada 4
      return out;
    }
    if (this.points[side] >= 4) this.endGame(side, out);                      // sem vantagem: no 40-40 o ponto seguinte decide
    return out;
  }

  private endGame(side: Side, out: PointResult): void {
    const o: Side = side === 0 ? 1 : 0; out.game = side; this.games[side]++; this.points = [0, 0];
    const g = this.fmt.games, a = this.games[side], b = this.games[o], other = (x: Side): Side => (x === 0 ? 1 : 0);
    const wasTb = this.inTiebreak; let setDone = false; out.swap = (a + b) % 2 === 1;   // troca de lado ao fim dos games ímpares do set (set que acaba em número par: a troca fica para depois do 1º game do seguinte)
    if (wasTb) { setDone = true; this.server = other(this.tbFirst); this.inTiebreak = false; }           // quem recebeu primeiro no tie-break saca o próximo set
    else if (this.fmt.tiebreak && a === g && b === g) { this.inTiebreak = true; this.tbTarget = 7; this.tbFirst = other(this.server); this.server = this.tbFirst; }
    else {
      this.server = other(this.server);                                                                   // o saque troca a cada game
      if (this.fmt.tiebreak ? (a >= g && a - b >= 2) : a >= g) setDone = true;
    }
    if (setDone) {
      out.set = side; this.history.push([this.games[0], this.games[1]]); this.sets[side]++; this.games = [0, 0];
      if (this.sets[side] >= this.fmt.setsToWin) { this.winner = side; out.match = side; }
      else if (this.fmt.matchTb && this.sets[0] === this.fmt.setsToWin - 1 && this.sets[1] === this.fmt.setsToWin - 1) { this.inTiebreak = true; this.tbTarget = 10; this.tbFirst = this.server; }   // 1 set a 1: match tie-break no lugar do set decisivo; saca primeiro quem tinha a vez
    }
  }

  /** andamento da partida de 0 a 1 (move a hora do dia): games jogados sobre o esperado (~1,5·games por set; melhor de 3 ≈ 2,5 sets) mais a fração do game em curso; o fim vale 1 */
  progress(): number {
    if (this.winner !== null) return 1;
    const g = this.fmt.games, total = (this.fmt.setsToWin === 1 ? 1 : 2.5) * 1.5 * g;
    const played = this.history.reduce((a, [x, y]) => a + x + y, 0) + this.games[0] + this.games[1] + Math.min(0.8, (this.points[0] + this.points[1]) / 6);
    return Math.min(0.97, played / total);
  }

  /** texto do placar do game: ["0","15"], ["40","30"]…; no tie-break, a contagem corrida */
  pointText(): [string, string] {
    if (this.inTiebreak) return [String(this.points[0]), String(this.points[1])];
    if (this.points[0] === 3 && this.points[1] === 3) return ["40", "40"];
    return [PT[Math.min(3, this.points[0])], PT[Math.min(3, this.points[1])]];
  }
  /** 40-40: o próximo ponto decide o game */
  get decisive(): boolean { return !this.inTiebreak && this.points[0] === 3 && this.points[1] === 3; }
  summary(): string { return `${this.history.map((h) => `${h[0]}-${h[1]}`).join(" ")}${this.history.length ? " · " : ""}${this.games[0]}-${this.games[1]}`; }
}
