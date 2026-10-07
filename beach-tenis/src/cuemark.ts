import * as THREE from "three";

// Marcador de rebatida no chão: anel fixo = onde ficar; anel que encolhe até fechar nele = quando apertar GOLPE.
// Cores: branco (longe no tempo) → amarelo (perto) → verde (agora) → laranja (passou); vermelho = fora de alcance.
const COL = { far: 0xffffff, near: 0xffd23a, now: 0x35e06a, late: 0xff9a2e, bad: 0xff4a4a, out: 0x8fa3b5 };   // out: a bola vai cair fora (deixa passar)
const LEAD = 1.2;   // s antes do aperto ideal em que o anel externo aparece

export interface CueView { x: number; z: number; ttp: number; reach: boolean; win: number; out?: boolean; }

export function cueState(v: { ttp: number; reach: boolean; win: number; out?: boolean }): keyof typeof COL {
  if (v.out) return "out";
  if (!v.reach) return "bad";
  if (Math.abs(v.ttp) <= v.win) return "now";
  if (v.ttp < 0) return "late";
  return v.ttp < 0.45 ? "near" : "far";
}
export const cueProgress = (ttp: number) => THREE.MathUtils.clamp(ttp / LEAD, 0, 1);

export class CueMarker {
  group = new THREE.Group();
  private base: THREE.Mesh; private pulse: THREE.Mesh; private mb: THREE.MeshBasicMaterial; private mp: THREE.MeshBasicMaterial;
  private halo: THREE.Sprite;   // brilho em volta da bola enquanto ela se aproxima: muda de cor junto com o anel

  constructor(scene: THREE.Scene) {
    const mat = () => new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide });
    this.mb = mat(); this.mp = mat();
    this.base = new THREE.Mesh(new THREE.RingGeometry(0.4, 0.52, 48), this.mb);
    this.pulse = new THREE.Mesh(new THREE.RingGeometry(0.47, 0.52, 64), this.mp);
    for (const m of [this.base, this.pulse]) { m.rotation.x = -Math.PI / 2; m.renderOrder = 4; this.group.add(m); }
    this.group.position.y = 0.04; this.group.visible = false; scene.add(this.group);
    const cv = document.createElement("canvas"); cv.width = cv.height = 64; const cx = cv.getContext("2d")!;
    const gr = cx.createRadialGradient(32, 32, 4, 32, 32, 31); gr.addColorStop(0, "rgba(255,255,255,0.95)"); gr.addColorStop(0.45, "rgba(255,255,255,0.35)"); gr.addColorStop(1, "rgba(255,255,255,0)");
    cx.fillStyle = gr; cx.fillRect(0, 0, 64, 64);
    const hm = new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cv), transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending });
    this.halo = new THREE.Sprite(hm); this.halo.scale.setScalar(0.8); this.halo.renderOrder = 5; this.halo.visible = false; scene.add(this.halo);
  }

  update(v: CueView | null, ball?: THREE.Vector3): void {
    this.group.visible = !!v; this.halo.visible = false; if (!v) return;
    const st = cueState(v), c = COL[st];
    this.mb.color.setHex(c); this.mp.color.setHex(c);
    this.group.position.x = v.x; this.group.position.z = v.z;
    const p = cueProgress(v.ttp);
    this.pulse.scale.setScalar(1 + 2.6 * p); this.mp.opacity = st === "bad" ? 0 : 0.35 + 0.55 * (1 - p);
    this.base.scale.setScalar(st === "now" ? 1.12 : 1);
    if (ball && st !== "bad" && v.ttp < 0.9) {
      const hm = this.halo.material as THREE.SpriteMaterial; hm.color.setHex(c); hm.opacity = st === "now" ? 1 : 0.7;
      this.halo.position.copy(ball); this.halo.scale.setScalar(st === "now" ? 0.95 : 0.7); this.halo.visible = true;
    }
  }
}
