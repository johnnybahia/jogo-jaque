import * as THREE from "three";

// Poeira de areia: um sopro curto a cada passada de corrida e na freada do golpe. Poucas sprites reaproveitadas, sem custo perceptível.
const N = 40, LIFE = 0.55;

export class Dust {
  private items: { s: THREE.Sprite; m: THREE.SpriteMaterial; age: number; size: number; vy: number }[] = [];
  private next = 0;

  constructor(scene: THREE.Scene) {
    const cv = document.createElement("canvas"); cv.width = cv.height = 64; const c = cv.getContext("2d")!;
    const g = c.createRadialGradient(32, 32, 2, 32, 32, 30); g.addColorStop(0, "rgba(255,250,232,1)"); g.addColorStop(0.55, "rgba(250,238,208,0.6)"); g.addColorStop(1, "rgba(250,238,208,0)");
    c.fillStyle = g; c.fillRect(0, 0, 64, 64); const map = new THREE.CanvasTexture(cv); map.colorSpace = THREE.SRGBColorSpace;
    for (let i = 0; i < N; i++) {
      const m = new THREE.SpriteMaterial({ map, transparent: true, opacity: 0, depthWrite: false }), s = new THREE.Sprite(m);
      s.visible = false; s.renderOrder = 3; scene.add(s); this.items.push({ s, m, age: 1, size: 0.2, vy: 0 });
    }
  }

  /** sopro de poeira em (x, z); speed em m/s (parado/devagar não levanta nada) */
  puff(x: number, z: number, speed: number): void {
    if (speed < 1.6) return;
    const it = this.items[this.next], k = Math.min(1, speed / 3.6); this.next = (this.next + 1) % N;
    it.s.position.set(x + (Math.random() - 0.5) * 0.12, 0.09, z + (Math.random() - 0.5) * 0.12); it.age = 0; it.size = 0.12 + 0.14 * k; it.vy = 0.3 + 0.3 * k; it.s.visible = true;
  }

  update(dt: number): void {
    for (const it of this.items) {
      if (!it.s.visible) continue;
      it.age += dt / LIFE; if (it.age >= 1) { it.s.visible = false; continue; }
      const u = it.age; it.s.scale.setScalar(it.size * (1 + 1.9 * u)); it.s.position.y += it.vy * (1 - u) * dt; it.m.opacity = 0.75 * (1 - u) * (1 - u);
    }
  }
}
