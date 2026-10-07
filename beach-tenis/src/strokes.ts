// Golpes extraídos do vídeo do autor (pose 3D → esqueleto da Jaqueline; ver tools/video). Cada golpe tem 1–2 variações (clipes v_*).
export interface StrokeInfo {
  key: string; label: string; clips: string[];
  overhead: boolean;   // o contato é o ponto mais alto (smash, saque…), não o pico de velocidade
  prep: number;        // s do aperto ao contato (preparação do golpe)
}
export const STROKES: StrokeInfo[] = [
  { key: "fh_din", label: "Forehand dinâmico", clips: ["v_fh_din_1", "v_fh_din_2"], overhead: false, prep: 0.55 },
  { key: "fh_est", label: "Forehand estático", clips: ["v_fh_est_1"], overhead: false, prep: 0.55 },
  { key: "bh_din", label: "Backhand dinâmico", clips: ["v_bh_din_1", "v_bh_din_2"], overhead: false, prep: 0.55 },
  { key: "bh_est", label: "Backhand estático", clips: ["v_bh_est_1", "v_bh_est_2"], overhead: false, prep: 0.55 },
  { key: "anomalo", label: "Anômalo", clips: ["v_anomalo_1", "v_anomalo_2"], overhead: false, prep: 0.55 },
  { key: "smash", label: "Smash", clips: ["v_smash_1", "v_smash_2"], overhead: true, prep: 0.7 },
  { key: "gancho", label: "Gancho", clips: ["v_gancho_1", "v_gancho_2"], overhead: true, prep: 0.7 },
  { key: "rainbow", label: "Rainbow / Ventaglio", clips: ["v_rainbow_1", "v_rainbow_2"], overhead: false, prep: 0.6 },
  { key: "band_fh", label: "Bandeja forehand", clips: ["v_band_fh_1", "v_band_fh_2"], overhead: false, prep: 0.6 },
  { key: "band_bh", label: "Bandeja backhand", clips: ["v_band_bh_1", "v_band_bh_2"], overhead: false, prep: 0.6 },
  { key: "veronica", label: "Verônica", clips: ["v_veronica_1", "v_veronica_2"], overhead: true, prep: 0.7 },
  { key: "espeto", label: "Espeto", clips: ["v_espeto_1", "v_espeto_2"], overhead: true, prep: 0.7 },
  { key: "arco", label: "Arco inferior / Leque", clips: ["v_arco_1"], overhead: false, prep: 0.6 },
  { key: "saque", label: "Saque / Serviço", clips: ["v_saque_1"], overhead: true, prep: 0.9 },
];
export const isVideoClip = (n: string): boolean => n.startsWith("v_");
const BY_CLIP = new Map<string, StrokeInfo>(STROKES.flatMap((s) => s.clips.map((c) => [c, s] as [string, StrokeInfo])));
export const strokeOf = (clip: string): StrokeInfo | undefined => BY_CLIP.get(clip);

// golpes do vídeo que o treino/IA sorteia (frequência relativa); o saque só é usado no saque
export const INTENT_W: Record<string, number> = { fh_din: 3, fh_est: 3, bh_din: 3, bh_est: 3, anomalo: 1.5, rainbow: 1.5, band_fh: 1.5, band_bh: 1.5, arco: 1, smash: 2, gancho: 1.2, veronica: 1.2, espeto: 1.2 };
export const FOLLOW = 0.42;   // s de clipe depois do contato em que quem bateu ainda fica preso no golpe (depois volta a correr)
// saque do vídeo e s do clipe em que a bola sai da mão. A mão esquerda do clipe chega ao ponto mais alto em ~0,63 s e começa a descer em ~0,8 s: a bola sai dela aí (antes, em 0,42 s,
// saía de uma mão baixa e passava quase 1 s no ar). O arco da bola é o de uma bola de verdade: o quanto passa acima da reta mão→contato é g·T²/8 (T = tempo no ar em s).
// O começo do clipe (0–0,45 s) é um agachamento fundo com a raquete na frente do peito, esquisito; o saque entra no clipe em SERVE_START (a mão esquerda já está subindo) e a bola sai em TOSS_REL.
export const SERVE_CLIP = "v_saque_1", SERVE_START = 0.45, TOSS_REL = 0.74, SERVE_FOLLOW = 0.3;   // SERVE_FOLLOW: s de clipe depois do contato até largar o saque (o fim do clipe é uma aterrissagem agachada esquisita)
export const tossApex = (T: number): number => 9.81 * T * T / 8;
