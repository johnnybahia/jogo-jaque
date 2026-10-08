import * as THREE from "three";

/** Rede de beach tênis: malha de pano (alpha-to-coverage, iluminada pela atmosfera), fita branca no topo, fitas laterais e postes acolchoados.
 *  O pano balança: uma brisa leve o tempo todo e uma onda que sai do ponto onde a bola bateu (amplitude decai em ~1 s). */
function netTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas"); c.width = 1024; c.height = 128; const g = c.getContext("2d")!;
  g.clearRect(0, 0, c.width, c.height); g.strokeStyle = "#14181f"; g.lineWidth = 2.6;
  for (let x = 0; x <= 1024; x += 16) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 128); g.stroke(); }
  for (let y = 0; y <= 128; y += 16) { g.beginPath(); g.moveTo(0, y); g.lineTo(1024, y); g.stroke(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; return t;
}

export class Net {
  readonly group = new THREE.Group();
  private u = { uAmp: { value: 0 }, uTime: { value: 0 }, uHitX: { value: 0 }, uPhase: { value: 0 } };
  private amp = 0; private time = 0;

  constructor(private halfW: number, private netH: number, netZ: number) {
    const g = this.group, nw = 2 * halfW + 0.6, nh = 0.9;
    const mat = new THREE.MeshStandardMaterial({ map: netTexture(), alphaToCoverage: true, side: THREE.DoubleSide, roughness: 1, metalness: 0 });
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, this.u);
      sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nuniform float uAmp; uniform float uTime; uniform float uHitX; uniform float uPhase;")
        .replace("#include <begin_vertex>", `#include <begin_vertex>
          float topW = 0.2 + 0.8 * clamp((${(nh / 2).toFixed(3)} - position.y) / ${nh.toFixed(3)}, 0.0, 1.0);
          float dx = position.x - uHitX;
          transformed.z += topW * (uAmp * exp(-dx * dx * 0.5) * sin(uPhase - abs(dx) * 3.2) + 0.012 * sin(position.x * 0.9 + uTime * 1.4 + position.y * 2.0));`);
    };
    const cloth = new THREE.Mesh(new THREE.PlaneGeometry(nw, nh, 80, 8), mat);
    cloth.position.set(0, netH - nh / 2, netZ); g.add(cloth);
    const tape = new THREE.MeshStandardMaterial({ color: 0xf4f6f8, roughness: 0.6 });
    const top = new THREE.Mesh(new THREE.BoxGeometry(nw, 0.065, 0.014), tape); top.position.set(0, netH - 0.0325, netZ); g.add(top);
    for (const s of [-1, 1]) { const side = new THREE.Mesh(new THREE.BoxGeometry(0.045, nh, 0.012), tape); side.position.set(s * (nw / 2 - 0.02), netH - nh / 2, netZ); g.add(side); }
    // postes acolchoados: espuma azul, faixa branca no topo e base chata
    const foam = new THREE.MeshStandardMaterial({ color: 0x1b6fb4, roughness: 0.75 }), steel = new THREE.MeshStandardMaterial({ color: 0xcfd4da, roughness: 0.45, metalness: 0.4 });
    for (const x of [-halfW - 0.3, halfW + 0.3]) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.058, netH + 0.18, 14), foam); pole.position.set(x, (netH + 0.18) / 2, netZ); g.add(pole);
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.058, 0.058, 0.06, 14), tape); cap.position.set(x, netH + 0.15, netZ); g.add(cap);
      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, 0.03, 16), steel); base.position.set(x, 0.015, netZ); g.add(base);
    }
    top.castShadow = true; g.children.forEach((o) => { if (o !== cloth && (o as THREE.Mesh).isMesh) o.castShadow = true; });   // o pano com alpha-to-coverage ficaria uma lâmina maciça na sombra
  }

  /** a bola bateu na rede em (x, y) com velocidade de entrada `speed` (m/s): a onda sai dali */
  hit(x: number, _y: number, speed: number): void {
    this.u.uHitX.value = THREE.MathUtils.clamp(x, -this.halfW, this.halfW); this.amp = Math.min(0.22, 0.05 + speed * 0.012); this.u.uPhase.value = 0;
  }

  update(dt: number): void {
    this.time += dt; this.u.uTime.value = this.time;
    if (this.amp > 0.0005) { this.amp *= Math.exp(-dt * 2.4); this.u.uPhase.value += dt * 16; this.u.uAmp.value = this.amp; } else if (this.u.uAmp.value !== 0) { this.amp = 0; this.u.uAmp.value = 0; }
  }
}
