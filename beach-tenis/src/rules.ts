// Placar de beach tênis (regras ITF, simplificadas): pontos 15/30/40, sem vantagem (no 40-40 o ponto seguinte decide o game),
// set de 6 games com 2 de diferença e tie-break de 7 em 6-6. Formatos curtos para o celular.
export type Side = 0 | 1;   // 0 = jogadora (Jaqueline), 1 = adversária
export interface Format { id: string; label: string; games: number; setsToWin: number; tiebreak: boolean; }
export const FORMATS: Record<string, Format> = {
  rapida: { id: "rapida", label: "Rápida (1 set de 4 games)", games: 4, setsToWin: 1, tiebreak: false },
  set: { id: "set", label: "1 set de 6 games", games: 6, setsToWin: 1, tiebreak: true },
  melhor3: { id: "melhor3", label: "Melhor de 3 sets", games: 6, setsToWin: 2, tiebreak: true },
};
const PT = ["0", "15", "30", "40"];
export interface PointResult { game?: Side; set?: Side; match?: Side; }

export class Score {
  points: [number, number] = [0, 0];      // pontos no game (0..3 = 0/15/30/40) ou no tie-break
  games: [number, number] = [0, 0];
  sets: [number, number] = [0, 0];
  history: [number, number][] = [];       // games de cada set encerrado
  server: Side; inTiebreak = false; winner: Side | null = null; tbFirst: Side;
  constructor(public fmt: Format, firstServer: Side = 0) { this.server = firstServer; this.tbFirst = firstServer; }

  /** ponto para `side`; devolve o que terminou (game, set, partida) */
  pointWon(side: Side): PointResult {
    if (this.winner !== null) return {};
    const o: Side = side === 0 ? 1 : 0; const out: PointResult = {};
    this.points[side]++;
    if (this.inTiebreak) {
      const total = this.points[0] + this.points[1];
      if (total % 2 === 1) this.server = this.server === 0 ? 1 : 0;           // no tie-break o saque troca depois do 1º ponto e a cada 2
      if (this.points[side] >= 7 && this.points[side] - this.points[o] >= 2) { this.endGame(side, out); }
      return out;
    }
    if (this.points[side] >= 4) this.endGame(side, out);                      // sem vantagem: no 40-40 o ponto seguinte decide
    return out;
  }

  private endGame(side: Side, out: PointResult): void {
    const o: Side = side === 0 ? 1 : 0; out.game = side; this.games[side]++; this.points = [0, 0];
    const g = this.fmt.games, a = this.games[side], b = this.games[o], other = (x: Side): Side => (x === 0 ? 1 : 0);
    const wasTb = this.inTiebreak; let setDone = false;
    if (wasTb) { setDone = true; this.server = other(this.tbFirst); this.inTiebreak = false; }           // quem recebeu primeiro no tie-break saca o próximo set
    else if (this.fmt.tiebreak && a === g && b === g) { this.inTiebreak = true; this.tbFirst = other(this.server); this.server = this.tbFirst; }
    else {
      this.server = other(this.server);                                                                   // o saque troca a cada game
      if (this.fmt.tiebreak ? (a >= g && a - b >= 2) : a >= g) setDone = true;
    }
    if (setDone) {
      out.set = side; this.history.push([this.games[0], this.games[1]]); this.sets[side]++; this.games = [0, 0];
      if (this.sets[side] >= this.fmt.setsToWin) { this.winner = side; out.match = side; }
    }
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
