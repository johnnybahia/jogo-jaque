import * as THREE from "three";
import { Atmosphere } from "./atmosphere";
import { buildSky, buildSea, buildRidge, buildSandGeometry, makeNoiseTexture, SHORE } from "./sky";

export const COURT = { wallZ: 11, wallW: 6, wallH: 3 };
export const MATCH = { netZ: 8, halfW: 4, len: 16 };   // quadra de partida (m): rede no meio de 16 m; lado da jogadora z ∈ [0, 8], da adversária [8, 16]; largura 8 m
export const NET_H = 1.7;   // altura da rede de beach tênis (m): o risco da parede; a bola precisa bater na parede acima dele

function canvasTex(w: number, h: number, draw: (c: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const cv = document.createElement("canvas"); cv.width = w; cv.height = h;
  draw(cv.getContext("2d")!); const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}

export function buildEnvironment(scene: THREE.Scene, base: string, renderer: THREE.WebGLRenderer): { train: THREE.Group; atmosphere: Atmosphere } {
  const train = new THREE.Group(); scene.add(train);
  renderer.toneMapping = THREE.NeutralToneMapping;   // preserva as cores de base (pele, roupas) e comprime os brilhos do sol
  const fog = new THREE.Fog(0xcfe8f5, 30, 190); scene.fog = fog;
  const hemi = new THREE.HemisphereLight(0xffffff, 0xe0c890, 1.25); scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff2d6, 1.9); scene.add(sun, sun.target);
  const fill = new THREE.DirectionalLight(0xdce9ff, 0.5); fill.position.set(2, 10, -16); scene.add(fill, fill.target);   // vem de trás da câmera: o rosto da jogadora não fica só em contraluz

  const sky = buildSky(makeNoiseTexture(), true); scene.add(sky.mesh);
  const sea = buildSea(); scene.add(sea.mesh);
  const far = buildRidge(330, 14, 42, 3.3, true), near = buildRidge(165, 3, 9, 7.1, true); scene.add(far.mesh, near.mesh);

  const sand = canvasTex(256, 256, (c) => {
    c.fillStyle = "#e7d3a0"; c.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 5200; i++) { const v = 200 + Math.random() * 40 | 0; c.fillStyle = `rgba(${v},${v - 22},${v - 70},0.35)`; c.fillRect(Math.random() * 256, Math.random() * 256, 1.6, 1.6); }
  });
  sand.wrapS = sand.wrapT = THREE.RepeatWrapping;
  const sandMat = new THREE.MeshStandardMaterial({ map: sand, roughness: 1 });
  // areia molhada perto do mar: escurece e fica mais lisa (x em metros do mundo)
  sandMat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nvarying float vWx;").replace("#include <begin_vertex>", "#include <begin_vertex>\nvWx = (modelMatrix * vec4(transformed, 1.0)).x;");
    sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\nvarying float vWx;")
      .replace("#include <map_fragment>", `#include <map_fragment>\n float wet = 1.0 - smoothstep(${(SHORE.x0 - 8).toFixed(1)}, ${(SHORE.x0 + 2).toFixed(1)}, vWx); diffuseColor.rgb *= mix(1.0, 0.55, wet);`)
      .replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\n roughnessFactor *= mix(1.0, 0.6, wet);");
  };
  const floor = new THREE.Mesh(buildSandGeometry(), sandMat); scene.add(floor);
  // texturas PBR de areia (Poly Haven "aerial_beach_01", CC0) — opcionais: se faltarem, fica a procedural
  const tl = new THREE.TextureLoader(); const rep = (t: THREE.Texture, srgb: boolean) => { if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; return t; };
  // carrega direto (GET passa pelo service worker, então funciona offline); se a base falhar, fica a procedural
  tl.load(base + "textures/sand.jpg", (t) => {
    sandMat.map = rep(t, true); sandMat.needsUpdate = true;
    tl.load(base + "textures/sand_nor.jpg", (n) => { sandMat.normalMap = rep(n, false); sandMat.normalScale.set(0.8, 0.8); sandMat.needsUpdate = true; });
    tl.load(base + "textures/sand_rough.jpg", (r) => { sandMat.roughnessMap = rep(r, false); sandMat.needsUpdate = true; });
  });
  const atmosphere = new Atmosphere({ renderer, fog, hemi, sun, fill, sky, sea, far, near, sand: sandMat });

  const faceTex = canvasTex(512, 256, (c) => {
    c.fillStyle = "#f4f1ea"; c.fillRect(0, 0, 512, 256);
    c.strokeStyle = "#ff6a00"; c.lineWidth = 10; c.strokeRect(5, 5, 502, 246);
    const ny = 256 - NET_H / COURT.wallH * 256;   // rede de beach tênis: 1,70 m. Malha fraca abaixo da fita; a bola precisa bater na parede acima dela
    c.strokeStyle = "rgba(27,111,180,0.22)"; c.lineWidth = 1;
    for (let x = 5; x <= 507; x += 16) { c.beginPath(); c.moveTo(x, ny); c.lineTo(x, 251); c.stroke(); }
    for (let y = ny; y <= 251; y += 16) { c.beginPath(); c.moveTo(5, y); c.lineTo(507, y); c.stroke(); }
    c.fillStyle = "#ffffff"; c.fillRect(5, ny - 3, 502, 7); c.strokeStyle = "#1b6fb4"; c.lineWidth = 2; c.strokeRect(5, ny - 3, 502, 7);
    c.fillStyle = "#1b6fb4"; c.font = "bold 22px sans-serif"; c.fillText("REDE 1,70 m", 14, ny - 10);
  });
  const face = new THREE.Mesh(new THREE.PlaneGeometry(COURT.wallW, COURT.wallH), new THREE.MeshStandardMaterial({ map: faceTex, roughness: 0.9 }));
  face.position.set(0, COURT.wallH / 2, COURT.wallZ - 0.01); face.rotation.y = Math.PI; train.add(face);
  const body = new THREE.Mesh(new THREE.BoxGeometry(COURT.wallW + 0.3, COURT.wallH + 0.15, 0.4), new THREE.MeshStandardMaterial({ color: 0x8a8f96 }));
  body.position.set(0, (COURT.wallH + 0.15) / 2, COURT.wallZ + 0.2); train.add(body);

  // linhas de referência na areia (faixa de saque e eixo central)
  const line = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55 });
  const l1 = new THREE.Mesh(new THREE.PlaneGeometry(0.06, COURT.wallZ + 4), line); l1.rotation.x = -Math.PI / 2; l1.position.set(0, 0.005, (COURT.wallZ - 4) / 2); train.add(l1);
  for (const x of [-4.5, 4.5]) { const l = l1.clone(); l.position.x = x; train.add(l); }
  return { train, atmosphere };
}

export function blobTexture(): THREE.CanvasTexture {
  return canvasTex(64, 64, (c) => { const g = c.createRadialGradient(32, 32, 2, 32, 32, 30); g.addColorStop(0, "rgba(0,0,0,0.55)"); g.addColorStop(1, "rgba(0,0,0,0)"); c.fillStyle = g; c.fillRect(0, 0, 64, 64); });
}

/** quadra de partida: linhas de 16 × 8 m e rede de 1,70 m no meio (z = MATCH.netZ), com fita branca e postes */
export function buildMatchCourt(scene: THREE.Scene): THREE.Group {
  const g = new THREE.Group(); g.visible = false; scene.add(g);
  const line = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 });
  const strip = (w: number, l: number, x: number, z: number) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, l), line); m.rotation.x = -Math.PI / 2; m.position.set(x, 0.006, z); g.add(m); };
  const W = MATCH.halfW, L = MATCH.len, T = 0.07;
  strip(2 * W + T, T, 0, 0); strip(2 * W + T, T, 0, L); strip(T, L + T, -W, L / 2); strip(T, L + T, W, L / 2);   // fundo, fundo, laterais
  strip(2 * W, T * 0.6, 0, MATCH.netZ);                                                                       // projeção da rede
  const tex = canvasTex(512, 64, (c) => {
    c.fillStyle = "rgba(20,24,30,0.18)"; c.fillRect(0, 0, 512, 64);
    c.strokeStyle = "rgba(15,18,24,0.75)"; c.lineWidth = 1.4;
    for (let x = 0; x <= 512; x += 8) { c.beginPath(); c.moveTo(x, 6); c.lineTo(x, 64); c.stroke(); }
    for (let y = 6; y <= 64; y += 8) { c.beginPath(); c.moveTo(0, y); c.lineTo(512, y); c.stroke(); }
    c.fillStyle = "#ffffff"; c.fillRect(0, 0, 512, 7);
  });
  const nw = 2 * W + 0.6, nh = 0.9;
  const net = new THREE.Mesh(new THREE.PlaneGeometry(nw, nh), new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide, depthWrite: false }));
  net.position.set(0, NET_H - nh / 2, MATCH.netZ); g.add(net);
  const pole = new THREE.MeshStandardMaterial({ color: 0xd9dde2, roughness: 0.5 });
  for (const x of [-W - 0.3, W + 0.3]) { const p = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, NET_H + 0.12, 14), pole); p.position.set(x, (NET_H + 0.12) / 2, MATCH.netZ); g.add(p); }
  return g;
}
