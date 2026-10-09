import * as THREE from "three";
import type { Tier } from "./quality";

/** Adereços da praia: palmeiras (tronco curvo + folhas recortadas por alpha, balançando ao vento), guarda-sóis listrados com toalhas e suas sombras.
 *  Tudo instanciado: ~7 draw calls no total; a quantidade cai com a qualidade (Alta 100%, Média 60%, Baixa nenhum). */
const rng = (seed: number) => { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); };

function leafTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas"); c.width = 128; c.height = 256; const g = c.getContext("2d")!;
  g.clearRect(0, 0, 128, 256); g.lineCap = "round";
  for (let y = 244; y > 6; y -= 6.5) {
    const k = 1 - y / 256, w = 60 * Math.pow(Math.sin(Math.PI * Math.min(1, k * 1.05 + 0.04)), 0.75) + 2, len = 20 + 8 * (1 - k);
    const col = `rgb(${Math.round(44 + 40 * k)},${Math.round(118 + 38 * k)},${Math.round(44 + 14 * k)})`;
    g.strokeStyle = col; g.lineWidth = 4.2;
    g.beginPath(); g.moveTo(64, y); g.lineTo(64 - w, y - len); g.stroke();
    g.beginPath(); g.moveTo(64, y); g.lineTo(64 + w, y - len); g.stroke();
  }
  g.strokeStyle = "rgb(120,140,60)"; g.lineWidth = 4; g.beginPath(); g.moveTo(64, 256); g.lineTo(64, 2); g.stroke();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}

/** tronco curvo (12 anéis × 8 lados) com faixas de cicatrizes por cor de vértice */
function trunkGeometry(H: number, lean: number): THREE.BufferGeometry {
  const rings = 12, sides = 8, pos: number[] = [], col: number[] = [], idx: number[] = [];
  for (let i = 0; i <= rings; i++) {
    const t = i / rings, cx = lean * t * t, cy = H * t, r = 0.095 + 0.075 * (1 - t) + 0.07 * Math.pow(1 - t, 7);
    const band = 0.5 + 0.5 * Math.sin(t * H * 10), shade = 0.78 + 0.22 * band;
    for (let j = 0; j < sides; j++) { const a = (j / sides) * Math.PI * 2; pos.push(cx + Math.cos(a) * r, cy, Math.sin(a) * r); col.push(0.62 * shade, 0.45 * shade, 0.29 * shade); }
  }
  for (let i = 0; i < rings; i++) for (let j = 0; j < sides; j++) { const a = i * sides + j, b = i * sides + ((j + 1) % sides), c = a + sides, d = b + sides; idx.push(a, c, b, b, c, d); }
  const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3)); g.setIndex(idx); g.computeVertexNormals();
  return g;
}

/** coroa: 11 folhas em leque saindo do topo do tronco, cada uma uma faixa de 8 segmentos que curva para baixo */
function frondGeometry(H: number, lean: number): THREE.BufferGeometry {
  const R = rng(7), N = 11, segs = 8, pos: number[] = [], uv: number[] = [], idx: number[] = [];
  const topX = lean, topY = H;
  for (let k = 0; k < N; k++) {
    const phi = (k / N) * Math.PI * 2 + (R() - 0.5) * 0.3, th = (k % 2 ? 0.35 : 0.8) + (R() - 0.5) * 0.25, L = 2.5 + R() * 0.9, W = 0.62 + R() * 0.12, droop = 0.55 + R() * 0.4;
    const dx = Math.cos(phi), dz = Math.sin(phi), px = -dz, pz = dx;   // direção da folha e perpendicular (largura)
    const base = pos.length / 3;
    for (let s = 0; s <= segs; s++) {
      const u = s / segs, len = u * L, h = Math.sin(th) * len - droop * len * len * 0.19, out = Math.cos(th) * len;
      const w = W * Math.sin(Math.PI * Math.pow(u, 0.7)) * 0.5 + 0.015, cx = topX + dx * out, cy = topY + h, cz = dz * out;
      pos.push(cx - px * w, cy, cz - pz * w, cx + px * w, cy, cz + pz * w); uv.push(0, u, 1, u);
    }
    for (let s = 0; s < segs; s++) { const a = base + s * 2, b = a + 1, c = a + 2, d = a + 3; idx.push(a, c, b, b, c, d); }
  }
  const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
  return g;
}

/** guarda-sol: poste 2,2 m + copa de 8 gomos (u cresce em volta: os gomos alternam cor de acento e branco no shader) */
function canopyGeometry(R = 1.15, rise = 0.4): THREE.BufferGeometry {
  const rings = 3, seg = 32, pos: number[] = [], uv: number[] = [], idx: number[] = [];
  for (let j = 0; j <= rings; j++) { const f = j / rings, r = R * f, y = rise * (1 - Math.pow(f, 1.7)); for (let i = 0; i <= seg; i++) { const a = (i / seg) * Math.PI * 2; pos.push(Math.cos(a) * r, y, Math.sin(a) * r); uv.push(i / seg, f); } }
  for (let j = 0; j < rings; j++) for (let i = 0; i < seg; i++) { const a = j * (seg + 1) + i, b = a + 1, c = a + seg + 1, d = c + 1; idx.push(a, b, c, b, d, c); }
  const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
  return g;
}

interface Spot { x: number; z: number; ry: number; s: number; tint: number }

export class Props {
  readonly group = new THREE.Group();
  private t = { uTime: { value: 0 } };
  private palms: THREE.InstancedMesh[] = []; private umbrellas: THREE.InstancedMesh[] = []; private shadows: THREE.InstancedMesh; private umbSpots: Spot[] = []; private palmSpots: Spot[] = [];
  private nPalm = 0; private nUmb = 0; private actP = 0; private actU = 0; private lastLight = new THREE.Vector3(9, 9, 9); private m = new THREE.Matrix4(); private q = new THREE.Quaternion(); private v = new THREE.Vector3(); private s = new THREE.Vector3(); private e = new THREE.Euler();

  constructor(shadowTex: THREE.Texture) {
    const R = rng(11), H = 7.4, lean = 1.3;
    // ---- palmeiras ----
    const spots: [number, number][] = [[31, 14], [34, 22], [29, 28], [36, 34], [32, 42], [-3, 40], [6, 44], [14, 38], [-12, 46], [3, 52], [30, -14], [35, -22], [-9, -26], [2, -30]];
    for (const [x, z] of spots) this.palmSpots.push({ x: x + (R() - 0.5) * 2, z: z + (R() - 0.5) * 2, ry: R() * Math.PI * 2, s: 0.8 + R() * 0.35, tint: 0.95 + R() * 0.25 });
    const trunkMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 });
    const leafMat = new THREE.MeshStandardMaterial({ map: leafTexture(), alphaToCoverage: true, side: THREE.DoubleSide, roughness: 0.85 });
    leafMat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, this.t);
      sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nuniform float uTime;").replace("#include <begin_vertex>", `#include <begin_vertex>
        float tip = uv.y * uv.y; float ph = uTime * 1.5 + instanceMatrix[3].x * 0.21 + instanceMatrix[3].z * 0.17;
        transformed.x += sin(ph + uv.y * 3.0) * 0.14 * tip; transformed.y += sin(ph * 1.3 + uv.y * 2.0) * 0.1 * tip; transformed.z += cos(ph * 0.9) * 0.09 * tip;`);
    };
    const nP = spots.length;
    for (const [geo, mat] of [[trunkGeometry(H, lean), trunkMat], [frondGeometry(H, lean), leafMat]] as [THREE.BufferGeometry, THREE.Material][]) {
      const im = new THREE.InstancedMesh(geo, mat, nP); im.frustumCulled = false;
      this.palmSpots.forEach((p, i) => { this.e.set(0, p.ry, 0); this.q.setFromEuler(this.e); this.m.compose(this.v.set(p.x, 0, p.z), this.q, this.s.setScalar(p.s)); im.setMatrixAt(i, this.m); im.setColorAt(i, new THREE.Color(p.tint, p.tint, p.tint)); });
      this.palms.push(im); this.group.add(im);
    }
    // ---- guarda-sóis e toalhas ----
    // (nenhum guarda-sol dentro da faixa do frescobol: x de −25,6 a −17,2 e z de −1,5 a 17,5)
    const us: [number, number][] = [[-13.5, 3], [-15.5, 10.5], [-12.8, 18.5], [-16.6, 24], [-15.2, 15.5], [-19, 33], [-17.5, 41]];
    const accents = [0xe5402f, 0x1f78d1, 0xf2b01e, 0x1fae7d, 0xe0508f, 0xff7a1a, 0x7a52d6];
    us.forEach(([x, z], i) => this.umbSpots.push({ x, z, ry: R() * Math.PI * 2, s: 0.9 + R() * 0.25, tint: i }));
    const stripe = (mat: THREE.MeshStandardMaterial, k: number) => {
      mat.onBeforeCompile = (sh) => {
        sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nvarying float vU;").replace("#include <begin_vertex>", "#include <begin_vertex>\nvU = uv.x;");
        sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\nvarying float vU;").replace("#include <color_fragment>", `diffuseColor.rgb *= mix(vec3(0.96), vColor, step(0.5, fract(vU * ${k.toFixed(1)})));`);
      };
    };
    const canopyMat = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.8 }); stripe(canopyMat, 4);
    const towelMat = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 1 }); stripe(towelMat, 3);
    const poleMat = new THREE.MeshStandardMaterial({ color: 0xe9e4d8, roughness: 0.5, metalness: 0.2 });
    const pole = new THREE.CylinderGeometry(0.022, 0.026, 2.25, 6); pole.translate(0, 1.125, 0);
    const canopy = canopyGeometry(); canopy.translate(0, 2.0, 0);
    const towel = new THREE.PlaneGeometry(1.6, 0.8); towel.rotateX(-Math.PI / 2); towel.translate(0, 0.012, 0);
    const nU = us.length;
    for (const [geo, mat, tilt] of [[pole, poleMat, true], [canopy, canopyMat, true], [towel, towelMat, false]] as [THREE.BufferGeometry, THREE.Material, boolean][]) {
      const im = new THREE.InstancedMesh(geo, mat, nU); im.frustumCulled = false;
      this.umbSpots.forEach((p, i) => {
        const ox = tilt ? 0 : 1.35 * Math.cos(p.ry + 1) * p.s, oz = tilt ? 0 : 1.35 * Math.sin(p.ry + 1) * p.s;   // a toalha fica ao lado
        this.e.set(tilt ? 0.07 * Math.sin(p.ry * 3) : 0, p.ry + (tilt ? 0 : 0.5), tilt ? 0.07 * Math.cos(p.ry * 3) : 0); this.q.setFromEuler(this.e);
        this.m.compose(this.v.set(p.x + ox, 0, p.z + oz), this.q, this.s.setScalar(p.s)); im.setMatrixAt(i, this.m); im.setColorAt(i, new THREE.Color(accents[i % accents.length]));
      });
      this.umbrellas.push(im); this.group.add(im);
    }
    // ---- sombras (manchas): copas dos guarda-sóis (seguem a luz) e base das palmeiras ----
    const sg = new THREE.PlaneGeometry(1, 1); sg.rotateX(-Math.PI / 2);
    this.shadows = new THREE.InstancedMesh(sg, new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false, opacity: 0.75 }), nU + nP * 2);
    this.shadows.frustumCulled = false; this.shadows.renderOrder = 1; this.group.add(this.shadows);
    this.nPalm = nP; this.nUmb = nU; this.setTier("alta"); this.placeShadows(new THREE.Vector3(0.4, 0.8, 0.4));
  }

  /** quantidade por nível: Alta tudo, Média 60%, Baixa nada */
  setTier(t: Tier): void {
    const f = t === "alta" ? 1 : t === "media" ? 0.6 : 0; this.actP = Math.round(this.nPalm * f); this.actU = Math.round(this.nUmb * f);
    for (const m of this.palms) m.count = this.actP; for (const m of this.umbrellas) m.count = this.actU; this.group.visible = f > 0; this.lastLight.set(9, 9, 9);
  }

  /** manchas de sombra no chão: a copa do guarda-sol (elipse deslocada para longe da luz, mais comprida com o sol baixo) e uma mancha curta na base de cada palmeira; só dos adereços ativos */
  private placeShadows(light: THREE.Vector3): void {
    const l = light.clone().normalize(), el = Math.max(0.2, Math.asin(l.y)), cot = 1 / Math.tan(el), hx = -l.x, hz = -l.z, hl = Math.hypot(hx, hz) || 1, dx = hx / hl, dz = hz / hl, ang = Math.atan2(dx, dz);
    let k = 0;
    for (let i = 0; i < this.actU; i++) {
      const p = this.umbSpots[i], off = Math.min(4, 2.0 * cot) * p.s, len = Math.min(3.2, 1 + cot * 0.7);
      this.e.set(0, ang, 0); this.q.setFromEuler(this.e); this.m.compose(this.v.set(p.x + dx * off * 0.7, 0.014, p.z + dz * off * 0.7), this.q, this.s.set(2.5 * p.s, 1, 2.4 * p.s * len)); this.shadows.setMatrixAt(k++, this.m);
    }
    for (let i = 0; i < this.actP; i++) {
      const p = this.palmSpots[i], off = Math.min(7, 3.6 * cot) * p.s, len = Math.min(3, 1 + cot * 0.6);
      this.e.set(0, ang, 0); this.q.setFromEuler(this.e); this.m.compose(this.v.set(p.x + dx * off * 0.5, 0.014, p.z + dz * off * 0.5), this.q, this.s.set(2.3 * p.s, 1, 2.2 * p.s * len)); this.shadows.setMatrixAt(k++, this.m);
      this.m.compose(this.v.set(p.x, 0.013, p.z), this.q.identity(), this.s.set(0.9 * p.s, 1, 0.9 * p.s)); this.shadows.setMatrixAt(k++, this.m);
    }
    this.shadows.count = k; this.shadows.instanceMatrix.needsUpdate = true;
  }

  /** `light` = direção da luz (do chão para o sol); as sombras só são refeitas quando ela muda mais de ~1° */
  update(dt: number, light: THREE.Vector3): void {
    this.t.uTime.value += dt;
    if (this.group.visible && this.lastLight.dot(light) < 0.9998) { this.lastLight.copy(light); this.placeShadows(light); }
  }
}
