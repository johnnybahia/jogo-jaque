import * as THREE from "three";
import type { Rig } from "./rig";

/** danças de vitória: "Samba Dancing" e "Gangnam Style" do pacote Mixamo do autor, no esqueleto da Jaqueline (dance.glb, tools/add_clips.py) */
export const DANCES = ["dance_samba", "dance_gangnam"];
export const isDance = (n: string): boolean => n.startsWith("dance_");
const FADE = 0.6;

/** toca uma dança inteira, sem cortar, por cima da locomoção: o peso sobe em FADE s no começo e desce nos últimos FADE s (quem chama diminui a locomoção e a camada de vida por w) */
export class Dancer {
  clip: string | null = null; t = 0; w = 0;
  private act: THREE.AnimationAction | null = null; private dur = 0;

  get active(): boolean { return this.clip !== null; }

  /** começa a dança `clip` no rig; false se o clipe não carregou */
  start(rig: Rig, clip: string): boolean {
    const a = rig.actions.get(clip); if (!a) return false;
    this.stop(); this.act = a; this.clip = clip; this.dur = a.getClip().duration; this.t = 0; this.w = 0; return true;
  }

  /** avança dt e devolve o peso da dança (0 = parada); acabou o clipe: solta a ação */
  update(dt: number): number {
    const a = this.act; if (!a) return 0;
    this.t += dt;
    if (this.t >= this.dur) { this.stop(); return 0; }
    const x = Math.min(1, this.t / FADE, (this.dur - this.t) / FADE); this.w = x * x * (3 - 2 * x);
    a.time = Math.min(this.t, this.dur - 1e-3); a.setEffectiveWeight(this.w);
    return this.w;
  }

  stop(): void { if (this.act) this.act.setEffectiveWeight(0); this.act = null; this.clip = null; this.w = 0; this.t = 0; }
}

/** sorteia uma dança entre as que existem no rig, sem repetir a última */
export function pickDance(rig: Rig, last: string | null): string | null {
  const l = DANCES.filter((c) => rig.actions.has(c)), pool = l.length > 1 ? l.filter((c) => c !== last) : l;
  return pool.length ? pool[(Math.random() * pool.length) | 0] : null;
}
