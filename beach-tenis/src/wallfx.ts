import * as THREE from "three";

// Impacto da bola na parede: anel que se abre e um clarão que some em ~0,4 s. Faz a devolução em arco parecer um rebote da parede.
const LIFE = 0.42, N = 3;

export class WallFx {
  private items: { g: THREE.Group; ring: THREE.MeshBasicMaterial; flash: THREE.MeshBasicMaterial; age: number }[] = [];
  private next = 0;

  constructor(scene: THREE.Scene) {
    const mk = (color: number) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
    for (let i = 0; i < N; i++) {
      const ring = mk(0xfff4b0), flash = mk(0xffffff), g = new THREE.Group();
      const r = new THREE.Mesh(new THREE.RingGeometry(0.82, 1, 40), ring), f = new THREE.Mesh(new THREE.CircleGeometry(0.16, 20), flash);
      r.renderOrder = f.renderOrder = 5; g.add(r, f); g.visible = false; scene.add(g);
      this.items.push({ g, ring, flash, age: 1 });
    }
  }

  spawn(x: number, y: number, z: number): void {
    const it = this.items[this.next]; this.next = (this.next + 1) % N;
    it.g.position.set(x, y, z); it.age = 0; it.g.visible = true;
  }

  update(dt: number): void {
    for (const it of this.items) {
      if (!it.g.visible) continue;
      it.age += dt / LIFE; if (it.age >= 1) { it.g.visible = false; continue; }
      const a = it.age, e = 1 - (1 - a) * (1 - a);
      it.g.scale.setScalar(0.12 + 0.75 * e); it.ring.opacity = 0.85 * (1 - a) * (1 - a); it.flash.opacity = Math.max(0, 1 - a * 3);
    }
  }
}
