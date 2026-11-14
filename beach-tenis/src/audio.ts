import { S } from "./settings";

/** Som e vibração, tudo sintetizado na hora (WebAudio, nenhum arquivo): batida da raquete, areia, rede, parede, mar ao fundo e palmas.
 *  O navegador só libera áudio depois de um toque: o contexto nasce no primeiro toque/tecla e, até lá (ou sem suporte), todas as chamadas não fazem nada. */
export class Sfx {
  private ctx: AudioContext | null = null; private master: GainNode | null = null; private noise: AudioBuffer | null = null;
  private sea: GainNode | null = null; private seaLvl = 0.6; private air: GainNode | null = null; private airLvl = 0;

  constructor() {
    const unlock = (): void => this.start();
    for (const ev of ["pointerdown", "pointerup", "touchend", "click", "keydown"]) addEventListener(ev, unlock, { capture: true, passive: true });
    document.addEventListener("visibilitychange", () => { const c = this.ctx; if (!c) return; if (document.hidden) void c.suspend().catch(() => {}); else if (S.sound) void c.resume().catch(() => {}); });
  }

  private start(): void {
    if (!S.sound) return;
    try {
      if (!this.ctx) {
        const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext; if (!AC) return;
        const c = new AC(); this.ctx = c;
        this.master = c.createGain(); this.master.gain.value = 0.9; this.master.connect(c.destination);
        const n = c.sampleRate * 2, wb = c.createBuffer(1, n, c.sampleRate), w = wb.getChannelData(0); for (let i = 0; i < n; i++) w[i] = Math.random() * 2 - 1; this.noise = wb;
        // mar: ruído marrom em ciclo, filtrado, com o volume subindo e descendo devagar (ondas)
        const m = c.sampleRate * 4, bb = c.createBuffer(1, m, c.sampleRate), b = bb.getChannelData(0); let last = 0;
        for (let i = 0; i < m; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; b[i] = last * 3.5; }
        for (let i = 0; i < 2000; i++) { const k = i / 2000; b[i] = b[i] * k + b[m - 2000 + i] * (1 - k); }   // emenda do ciclo sem estalo
        const src = c.createBufferSource(); src.buffer = bb; src.loop = true; src.loopEnd = (m - 2000) / c.sampleRate;
        const lp = c.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 650;
        this.sea = c.createGain(); this.sea.gain.value = 0;
        const lfo = c.createOscillator(), lg = c.createGain(); lfo.frequency.value = 0.11; lg.gain.value = 0.035; lfo.connect(lg).connect(this.sea.gain);
        src.connect(lp).connect(this.sea).connect(this.master); src.start(); lfo.start();
        // vento: o mesmo ruído, mais agudo, com rajadas lentas
        const ws = c.createBufferSource(); ws.buffer = bb; ws.loop = true; ws.loopEnd = src.loopEnd; ws.playbackRate.value = 1.7;
        const bp = c.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 520; bp.Q.value = 0.5; this.air = c.createGain(); this.air.gain.value = 0;
        const l2 = c.createOscillator(), g2 = c.createGain(); l2.frequency.value = 0.23; g2.gain.value = 0.25; const ag = c.createGain(); ag.gain.value = 0.75; l2.connect(g2).connect(ag.gain);
        ws.connect(bp).connect(ag).connect(this.air).connect(this.master); ws.start(0, 1.3); l2.start(); this.apply();
      }
      if (this.ctx.state !== "running") void this.ctx.resume().catch(() => {});
    } catch { this.ctx = null; }
  }

  /** aplica os Ajustes (som ligado/desligado) e o volume do mar */
  apply(): void {
    const c = this.ctx; if (!c || !this.sea) return;
    this.sea.gain.setTargetAtTime(S.sound ? 0.07 * this.seaLvl : 0, c.currentTime, 0.4); this.air?.gain.setTargetAtTime(S.sound ? 0.3 * this.airLvl : 0, c.currentTime, 0.8);
    if (!S.sound) void c.suspend().catch(() => {}); else if (!document.hidden && c.state !== "running") void c.resume().catch(() => {});
  }
  /** vento em m/s: 0 cala, 5 é o mais forte */
  wind(speed: number): void { this.airLvl = Math.min(1, speed / 5); const c = this.ctx; if (c && this.air) this.air.gain.setTargetAtTime(S.sound ? 0.3 * this.airLvl : 0, c.currentTime, 0.8); }
  /** volume do mar: 1 = à beira d'água (frescobol), ~0,6 na quadra */
  ambience(level: number): void { this.seaLvl = level; this.apply(); }

  private live(): AudioContext | null { const c = this.ctx; return c && S.sound && c.state === "running" && this.master && this.noise ? c : null; }

  /** rajada de ruído filtrado (f → f2 Hz) com ataque `atk` s e duração `dur` s, daqui a `at` s */
  private burst(f: number, q: number, dur: number, g: number, type: BiquadFilterType = "bandpass", f2 = 0, at = 0, atk = 0.004): void {
    const c = this.live(); if (!c) return; const t = c.currentTime + at;
    const src = c.createBufferSource(); src.buffer = this.noise; src.loop = true;
    const fl = c.createBiquadFilter(); fl.type = type; fl.Q.value = q; fl.frequency.setValueAtTime(f, t); if (f2 > 0) fl.frequency.exponentialRampToValueAtTime(f2, t + dur);
    const gn = c.createGain(); gn.gain.setValueAtTime(0.0001, t); gn.gain.exponentialRampToValueAtTime(Math.max(0.0002, g), t + atk); gn.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(fl).connect(gn).connect(this.master!); src.start(t, Math.random() * 1.5); src.stop(t + dur + 0.05);
  }
  /** tom que desce de f0 a f1 Hz */
  private tone(f0: number, f1: number, dur: number, g: number, type: OscillatorType = "sine"): void {
    const c = this.live(); if (!c) return; const t = c.currentTime;
    const o = c.createOscillator(); o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const gn = c.createGain(); gn.gain.setValueAtTime(0.0001, t); gn.gain.exponentialRampToValueAtTime(Math.max(0.0002, g), t + 0.003); gn.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(gn).connect(this.master!); o.start(t); o.stop(t + dur + 0.03);
  }

  /** raquete na bola: q = 2 perfeito (estalo cheio), 1 bom, 0 fraco (abafado); golpes por cima e saque batem mais forte; vol < 1 para quem está longe */
  hit(q: number, kind: string, vol = 1): void {
    const big = kind === "smash" || kind === "over" || kind === "serve", g = vol * (q === 2 ? 0.75 : q === 1 ? 0.55 : 0.32) * (big ? 1.25 : 1);
    this.tone(q === 0 ? 300 : big ? 380 : 470, q === 0 ? 150 : 170, q === 0 ? 0.05 : 0.08, g);
    this.burst(q === 0 ? 900 : 1900, 1, 0.035, g * 0.6);
  }
  /** raquete cortando o ar (começo do golpe) */
  swish(): void { this.burst(600, 2.2, 0.17, 0.07, "bandpass", 2400, 0, 0.06); }
  /** bola na areia: speed em m/s */
  sand(speed: number): void { this.burst(1000, 0.7, 0.13, 0.08 + 0.3 * Math.min(1, speed / 14), "lowpass", 280); }
  net(): void { this.burst(520, 0.8, 0.2, 0.3); this.tone(130, 70, 0.14, 0.3); }
  wall(): void { this.tone(210, 90, 0.08, 0.35); this.burst(1300, 1, 0.03, 0.2); }
  splash(): void { this.burst(1900, 0.6, 0.4, 0.3, "lowpass", 350, 0, 0.02); }
  /** palmas de quem está na praia: `n` batidas espalhadas em `dur` s, mais densas no começo */
  cheer(n = 26, dur = 1.3): void {
    if (!this.live()) return;
    for (let i = 0; i < n; i++) { const u = Math.random(); this.burst(1100 + 1500 * Math.random(), 1.4, 0.022, 0.16 * (1 - 0.7 * u), "bandpass", 0, 0.05 + dur * u * u, 0.002); }
  }

  /** vibração curta (Android; o iPhone não tem): ms ou padrão [vibra, pausa, vibra] */
  buzz(p: number | number[]): void { if (!S.haptics) return; try { navigator.vibrate?.(p); } catch { /* sem vibração */ } }
}
