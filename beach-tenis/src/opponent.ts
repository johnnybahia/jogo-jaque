import * as THREE from "three";
import { Rig, SWINGS } from "./rig";
import { PoseFX } from "./posefx";
import { Stamina } from "./stamina";
import { MATCH } from "./scene";

/** golpe da adversária em andamento (tempos do clipe, como o da jogadora; posições no mundo) */
export interface OppSwing { clip: string; key: string; kind: string; s: number; t: number; startT: number; contactT: number; endT: number; duration: number; x0: number; z0: number; x1: number; z1: number; contacted: boolean; serve: boolean; whiff: boolean; }

/**
 * A adversária: 2ª instância da Jaqueline virada para −z, do outro lado da rede. Aqui só o corpo (posição, corrida, animação, golpes por clipe);
 * quem decide e lança a bola é a IA (ver game.ts). Em coordenadas locais dela: frente = −z do mundo, esquerda = −x do mundo.
 */
export class Opponent {
  rig: Rig; fx: PoseFX; stamina = new Stamina();
  x = 0; z = MATCH.len; vx = 0; vz = 0;
  swing: OppSwing | null = null; swingAct: THREE.AnimationAction | null = null; swingW = 0;
  react = 0; reactT = 0;
  readonly shadow: THREE.Mesh;
  private ball = new THREE.Vector3();

  constructor(player: Rig, scene: THREE.Scene, shadowMat: THREE.Material) {
    this.rig = player.cloneInstance(); this.rig.root.rotation.y = Math.PI; scene.add(this.rig.root);
    this.fx = new PoseFX(this.rig, -1);
    this.shadow = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1.1), shadowMat); this.shadow.rotation.x = -Math.PI / 2; this.shadow.position.y = 0.01; scene.add(this.shadow);
    this.setVisible(false);
  }

  setVisible(v: boolean): void { this.rig.root.visible = v; this.shadow.visible = v; }

  place(x: number, z: number): void { this.x = x; this.z = z; this.vx = this.vz = 0; this.swing = null; this.swingAct = null; this.swingW = 0; this.react = 0; this.rig.root.position.set(x, 0, z); }

  /** ponto de contato do golpe no mundo, para a adversária parada em (x, z) */
  contactWorld(clip: string, x = this.x, z = this.z): THREE.Vector3 | null {
    const c = this.rig.contactLocal.get(clip); return c ? new THREE.Vector3(x - c.x, c.y, z - c.z) : null;
  }

  /** posição da cabeça da raquete (mundo), com a pose atual */
  racketHead(out: THREE.Vector3): THREE.Vector3 { return this.rig.head.getWorldPosition(out); }

  /** quadro de animação: locomoção misturada com o golpe, camada de vida e raquete; ball = bola a acompanhar com a cabeça (ou null) */
  animate(dt: number, time: number, ball: { x: number; y: number; z: number } | null): void {
    const R = this.rig, sw = this.swing;
    const target = sw ? 1 : 0;
    this.swingW += Math.sign(target - this.swingW) * Math.min(Math.abs(target - this.swingW), dt / (target ? (sw?.serve ? 0.4 : 0.15) : 0.3));
    R.loco.step(R, dt, -this.vx, -this.vz, 1 - this.swingW);   // velocidade nos eixos dela: esquerda e frente
    for (const n of SWINGS) { const a = R.actions.get(n); if (!a || a === this.swingAct) continue; const w = a.getEffectiveWeight(); if (w > 0) a.setEffectiveWeight(Math.max(0, w - dt / 0.2)); }
    if (this.swingAct) {
      const d = this.swingAct.getClip().duration;
      if (sw) this.swingAct.time = Math.min(sw.t, d - 1e-3);
      this.swingAct.setEffectiveWeight(this.swingW);
      if (!sw && this.swingW <= 0) this.swingAct = null;
    }
    R.root.position.set(this.x, 0, this.z);
    R.mixer.update(0); R.root.updateMatrixWorld(true);
    this.fx.update({ dt, time, ball: ball ? this.ball.set(ball.x, ball.y, ball.z) : null, vx: -this.vx, vz: -this.vz, stamina: this.stamina.value, swingW: this.swingW, react: this.react, rt: this.reactT });
    let fw = 0; if (sw) { const x = Math.max(0, 1 - Math.abs(sw.t - sw.contactT) / 0.3); fw = x * x * (3 - 2 * x); }
    R.fixRacket(fw);
    this.shadow.position.set(this.x, 0.01, this.z);
  }
}
