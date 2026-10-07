// Golpe certo para a bola: o aviso da jogadora, a IA da adversária e o planejador do treino escolhem o golpe pela altura e pelo lado em que a bola chega.
// Os pontos de contato medidos no vídeo servem para a raquete encontrar a bola (geometria), mas o lado deles é ruidoso (um backhand com contato à direita do corpo);
// por isso o lado e a faixa de altura de cada golpe vêm do nome do golpe, e o contato do clipe só vale para posicionar.

/** side: lado da bola, em relação ao corpo, em que o golpe é natural (+1 lado da raquete = forehand, −1 lado oposto = backhand, 0 qualquer; ±0,5 inclina para um lado);
 *  lo..hi: altura (m) em que a bola costuma ser pega com esse golpe */
export interface Fit { side: number; lo: number; hi: number; }
export const FIT: Record<string, Fit> = {
  fh_din: { side: 1, lo: 0.9, hi: 1.65 }, fh_est: { side: 1, lo: 0.9, hi: 1.65 },
  bh_din: { side: -1, lo: 0.85, hi: 1.65 }, bh_est: { side: -1, lo: 0.85, hi: 1.65 },
  band_fh: { side: 1, lo: 0.85, hi: 1.4 }, band_bh: { side: -1, lo: 0.85, hi: 1.4 },
  anomalo: { side: -0.5, lo: 1.15, hi: 1.7 }, rainbow: { side: -0.5, lo: 1.1, hi: 1.7 }, arco: { side: 0, lo: 0.3, hi: 1.05 },
  smash: { side: 0.5, lo: 1.65, hi: 2.3 }, gancho: { side: 0.5, lo: 1.55, hi: 2.3 }, espeto: { side: 0.5, lo: 1.5, hi: 2.3 }, veronica: { side: -1, lo: 1.5, hi: 2.3 },
};
const OVER = new Set(["smash", "espeto", "veronica"]);   // por cima da cabeça, à frente do corpo (bola atrás: gancho)
const W_H = 3, W_S = 3.6, W_A = 1.2;

/** custo (0 = encaixe perfeito) de rebater a bola com o golpe `key`:
 *  y = altura da bola no contato (m); lat = quanto ela está ao lado do corpo (m, + = lado da raquete); ahead = quanto à frente do corpo (m, − = atrás da cabeça), vistos de onde a jogadora está agora.
 *  Dinâmico/estático: quanto ela precisa andar para ter a bola no ponto ideal do golpe (≈ 0,4 m ao lado, 0,5 m à frente), medido pelo golpe e não pelo clipe (o contato do clipe é ruidoso) */
export function fitCost(key: string, y: number, lat: number, ahead: number): number {
  const f = FIT[key]; if (!f) return 0;
  let c = W_H * (y < f.lo ? f.lo - y : y > f.hi ? y - f.hi : 0);                                  // altura fora da faixa do golpe
  const s = f.side, a = Math.abs(s);
  c += W_S * (s === 0 ? Math.max(0, Math.abs(lat) - 0.85) : Math.max(0, (s > 0 ? -lat : lat) - (0.25 + 0.6 * (1 - a))));   // bola do lado errado do corpo
  if (s < 0) c += 0.12;                                                                              // no meio, o forehand (lado forte) ganha
  const sh = Math.hypot(lat - s * 0.4, ahead - (OVER.has(key) ? 0.2 : key === "gancho" ? 0 : 0.5));
  if (key.endsWith("_din")) c += 0.5 * Math.max(0, 1 - sh / 0.5);                                    // dinâmico com a bola já no ponto: o estático é o certo
  else if (key.endsWith("_est")) c += 0.5 * Math.min(1, Math.max(0, (sh - 0.5) / 0.8));             // estático com a bola longe (corrida): o dinâmico é o certo
  if (OVER.has(key)) c += W_A * Math.max(0, -0.15 - ahead);                                          // bola atrás da cabeça não é smash
  else if (key === "gancho") c += ahead < 0.2 ? -0.4 * Math.min(1, (0.2 - ahead) / 0.4) : 0.5 * Math.min(1, Math.max(0, (ahead - 0.5) / 0.6));   // gancho: bola atrás/acima da cabeça
  return c;
}
