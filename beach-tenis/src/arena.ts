import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { Tier } from "./quality";

/** Arena em volta da quadra da partida: duas arquibancadas laterais e uma atrás do fundo adversário (o lado da câmera fica aberto), placas na frente delas, cadeira do juiz e 4 postes de refletores.
 *  Tudo em poucas malhas: estrutura (1), placas (1), postes (1), lâmpadas (1) e a torcida em 2 malhas instanciadas (corpos coloridos e cabeças), que balança devagar e pula quando sai um ponto.
 *  Nada aqui projeta sombra nem tem luz própria: à noite as lâmpadas só acendem (emissivo) e a luz da quadra continua sendo a da atmosfera. */
const STEPS = 4, RISE = 0.55, RUN = 0.9, SIDE_X = 6.6, END_Z = 22.6;
interface Stand { x: number; z: number; len: number; ry: number; }   // meio da borda da frente, comprimento e giro (os degraus sobem para −z local, de costas para a quadra)
const STANDS: Stand[] = [
  { x: SIDE_X, z: 8, len: 14, ry: -Math.PI / 2 }, { x: -SIDE_X, z: 8, len: 14, ry: Math.PI / 2 }, { x: 0, z: END_Z, len: 14, ry: Math.PI },
];

function boardTexture(): THREE.Texture {
  const c = document.createElement("canvas"); c.width = 1024; c.height = 64; const g = c.getContext("2d")!;
  const cols = ["#ff6a00", "#0f4f86", "#1b6fb4", "#0f4f86"];
  for (let i = 0; i < 4; i++) { g.fillStyle = cols[i]; g.fillRect(i * 256, 0, 256, 64); }
  g.font = "800 34px system-ui, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillStyle = "#fff";
  ["JAQUE", "BEACH TENNIS", "PLAY MATCH", "BEACH TENNIS"].forEach((t, i) => g.fillText(t, i * 256 + 128, 34));
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = THREE.RepeatWrapping; t.anisotropy = 4; return t;
}

export class Arena {
  readonly group = new THREE.Group();
  private u = { uTime: { value: 0 }, uCheer: { value: 0 } };
  private bodies: THREE.InstancedMesh; private heads: THREE.InstancedMesh; private total = 0; private lamp: THREE.MeshStandardMaterial; private cheerV = 0;

  constructor() {
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1);
    const place = (geo: THREE.BufferGeometry, s: Stand, lx: number, ly: number, lz: number): THREE.BufferGeometry => geo.applyMatrix4(m.compose(new THREE.Vector3(lx, ly, lz).applyAxisAngle(up, s.ry).add(new THREE.Vector3(s.x, 0, s.z)), q.setFromAxisAngle(up, s.ry), one));
    const frame: THREE.BufferGeometry[] = [], boards: THREE.BufferGeometry[] = [], seats: THREE.Vector3[] = [];
    for (const s of STANDS) {
      for (let i = 0; i < STEPS; i++) {
        frame.push(place(new THREE.BoxGeometry(s.len, RISE * (i + 1), RUN), s, 0, RISE * (i + 1) / 2, -(i + 0.5) * RUN));
        for (let x = -s.len / 2 + 0.4; x < s.len / 2 - 0.3; x += 0.62) if (Math.random() < 0.86) seats.push(new THREE.Vector3(x + (Math.random() - 0.5) * 0.12, RISE * (i + 1), -(i + 0.55) * RUN).applyAxisAngle(up, s.ry).add(new THREE.Vector3(s.x, 0, s.z)));
      }
      frame.push(place(new THREE.BoxGeometry(s.len, RISE * STEPS + 0.9, 0.08), s, 0, (RISE * STEPS + 0.9) / 2, -STEPS * RUN - 0.04));   // parede do fundo
      const b = new THREE.PlaneGeometry(s.len, 0.8); const uv = b.getAttribute("uv"); for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * s.len / 7);   // a faixa repete a cada 7 m
      boards.push(place(b, s, 0, 0.42, 0.55));
    }
    // cadeira do juiz, ao lado do poste da rede
    const J = { x: 5.55, z: 8 }, bar = (w: number, h: number, d: number, x: number, y: number, z: number) => frame.push(new THREE.BoxGeometry(w, h, d).translate(J.x + x, y, J.z + z));
    for (const [x, z] of [[-0.28, -0.28], [0.28, -0.28], [-0.28, 0.28], [0.28, 0.28]]) bar(0.06, 1.6, 0.06, x, 0.8, z);
    bar(0.66, 0.07, 0.66, 0, 1.62, 0); bar(0.07, 0.6, 0.66, 0.3, 1.95, 0); for (const y of [0.45, 0.9, 1.3]) bar(0.06, 0.05, 0.6, -0.28, y, 0);
    seats.push(new THREE.Vector3(J.x, 1.66, J.z));
    const structure = new THREE.Mesh(mergeGeometries(frame), new THREE.MeshStandardMaterial({ color: 0x8d97a6, roughness: 0.9 })); this.group.add(structure);
    this.group.add(new THREE.Mesh(mergeGeometries(boards), new THREE.MeshStandardMaterial({ map: boardTexture(), roughness: 0.75, side: THREE.DoubleSide })));
    // postes de refletores nos 4 cantos
    const poles: THREE.BufferGeometry[] = [], lamps: THREE.BufferGeometry[] = [];
    for (const [x, z] of [[-6.9, 0.3], [6.9, 0.3], [-6.9, 15.7], [6.9, 15.7]]) {
      poles.push(new THREE.CylinderGeometry(0.07, 0.11, 9, 8).translate(x, 4.5, z));
      lamps.push(new THREE.BoxGeometry(1.3, 0.5, 0.16).rotateX(z < 8 ? 0.5 : -0.5).rotateY(Math.atan2(-x, 8 - z)).translate(x, 9.1, z));
    }
    this.group.add(new THREE.Mesh(mergeGeometries(poles), new THREE.MeshStandardMaterial({ color: 0x4a515c, roughness: 0.7, metalness: 0.3 })));
    this.lamp = new THREE.MeshStandardMaterial({ color: 0xdfe6f2, emissive: 0xeaf1ff, emissiveIntensity: 0.1, roughness: 0.5 }); this.group.add(new THREE.Mesh(mergeGeometries(lamps), this.lamp));
    // torcida: sentados nos degraus; a ordem é embaralhada para que desenhar menos gente (qualidade) esvazie por igual
    for (let i = seats.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [seats[i], seats[j]] = [seats[j], seats[i]]; }
    const sway = (mat: THREE.MeshStandardMaterial): THREE.MeshStandardMaterial => {
      mat.onBeforeCompile = (sh) => {
        Object.assign(sh.uniforms, this.u);
        sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nuniform float uTime; uniform float uCheer;").replace("#include <begin_vertex>", `#include <begin_vertex>
          float ph = instanceMatrix[3].x * 1.7 + instanceMatrix[3].z * 2.3;
          transformed.y += 0.015 * sin(uTime * 1.3 + ph) + uCheer * 0.2 * abs(sin(uTime * 6.5 + ph));`);
      };
      return mat;
    };
    this.total = seats.length;
    this.bodies = new THREE.InstancedMesh(new THREE.BoxGeometry(0.36, 0.5, 0.24).translate(0, 0.25, 0), sway(new THREE.MeshStandardMaterial({ roughness: 0.9 })), this.total);
    this.heads = new THREE.InstancedMesh(new THREE.SphereGeometry(0.115, 7, 5).translate(0, 0.64, 0), sway(new THREE.MeshStandardMaterial({ roughness: 0.8 })), this.total);
    const shirts = [0xff6a00, 0xffffff, 0x1b6fb4, 0xffd23a, 0xe0455a, 0x35b06a, 0x24303f, 0xf2a0c0, 0x8fd3ff], skins = [0xf1c9a5, 0xd9a273, 0xa9714b, 0x7a4f33, 0xe6b98f], col = new THREE.Color();
    seats.forEach((p, i) => {
      const s = 0.9 + Math.random() * 0.25; m.compose(p, q.identity(), new THREE.Vector3(s, s, s)); this.bodies.setMatrixAt(i, m); this.heads.setMatrixAt(i, m);
      this.bodies.setColorAt(i, col.setHex(shirts[(Math.random() * shirts.length) | 0])); this.heads.setColorAt(i, col.setHex(skins[(Math.random() * skins.length) | 0]));
    });
    for (const im of [this.bodies, this.heads]) { im.frustumCulled = false; this.group.add(im); }
  }

  /** torcida por nível: Alta todos, Média 70%, Baixa 40% */
  setTier(t: Tier): void { const n = Math.round(this.total * (t === "alta" ? 1 : t === "media" ? 0.7 : 0.4)); this.bodies.count = n; this.heads.count = n; }

  /** saiu um ponto: a torcida pula (k = 1 ponto da jogadora, menos nos outros) e vai parando */
  cheer(k = 1): void { this.cheerV = Math.max(this.cheerV, k); }

  /** night: 0 de dia, 1 à noite (os refletores acendem) */
  update(dt: number, night: number): void {
    if (!this.group.visible) return;
    this.u.uTime.value += dt; this.cheerV *= Math.exp(-dt / 0.9); this.u.uCheer.value = this.cheerV;
    this.lamp.emissiveIntensity = 0.1 + 3.2 * night;
  }
}
