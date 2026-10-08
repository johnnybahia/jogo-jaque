import * as THREE from "three";
import { Atmosphere } from "./atmosphere";
import { Net } from "./net";
import { buildSky, buildSea, buildRidge, buildSandGeometry, makeNoiseTexture, SHORE } from "./sky";

export const COURT = { wallZ: 11, wallW: 6, wallH: 3 };
export const MATCH = { netZ: 8, halfW: 4, len: 16 };   // quadra de partida (m): rede no meio de 16 m; lado da jogadora z ∈ [0, 8], da adversária [8, 16]; largura 8 m
export const NET_H = 1.7;   // altura da rede de beach tênis (m): o risco da parede; a bola precisa bater na parede acima dele

function canvasTex(w: number, h: number, draw: (c: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const cv = document.createElement("canvas"); cv.width = w; cv.height = h;
  draw(cv.getContext("2d")!); const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}

export function buildEnvironment(scene: THREE.Scene, base: string, renderer: THREE.WebGLRenderer): { train: THREE.Group; atmosphere: Atmosphere; courtMask: { value: number } } {
  const train = new THREE.Group(); scene.add(train);
  renderer.toneMapping = THREE.NeutralToneMapping;   // preserva as cores de base (pele, roupas) e comprime os brilhos do sol
  const fog = new THREE.Fog(0xcfe8f5, 30, 190); scene.fog = fog;
  const hemi = new THREE.HemisphereLight(0xffffff, 0xe0c890, 1.25); scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff2d6, 1.9); scene.add(sun, sun.target);
  // sombras do sol só em volta da quadra (Média/Alta; a Baixa fica com as manchas): caixa ortográfica 20 m de largura × 30 m na altura da luz (no sol baixo cobre bem mais chão ao longo da luz)
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const sc = sun.shadow.camera; sc.left = -10; sc.right = 10; sc.top = 15; sc.bottom = -15; sc.near = 1; sc.far = 170; sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03; sun.target.position.set(0, 0, MATCH.netZ);
  const fill = new THREE.DirectionalLight(0xdce9ff, 0.5); fill.position.set(2, 10, -16); scene.add(fill, fill.target);   // vem de trás da câmera: o rosto da jogadora não fica só em contraluz

  const noise = makeNoiseTexture(); const sky = buildSky(noise, true); scene.add(sky.mesh);
  const sea = buildSea(); scene.add(sea.mesh);
  const far = buildRidge(330, 14, 42, 3.3, true), near = buildRidge(165, 3, 9, 7.1, true); scene.add(far.mesh, near.mesh);

  const sand = canvasTex(256, 256, (c) => {
    c.fillStyle = "#e7d3a0"; c.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 5200; i++) { const v = 200 + Math.random() * 40 | 0; c.fillStyle = `rgba(${v},${v - 22},${v - 70},0.35)`; c.fillRect(Math.random() * 256, Math.random() * 256, 1.6, 1.6); }
  });
  sand.wrapS = sand.wrapT = THREE.RepeatWrapping;
  const sandMat = new THREE.MeshStandardMaterial({ map: sand, roughness: 1 });
  // areia: (1) variação de tom em escala grande (a textura repete a cada 4 m e isso denunciava o azulejo), (2) molhada perto do mar: escurece e fica mais lisa,
  // (3) quadra rastelada: faixas paralelas à rede e um tom um pouco mais claro dentro de 16 × 8 m (+ margem), só na partida
  const courtMask = { value: 0 };
  sandMat.onBeforeCompile = (sh) => {
    sh.uniforms.uNoise = { value: noise }; sh.uniforms.uCourt = courtMask;
    sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nvarying vec3 vWp;").replace("#include <begin_vertex>", "#include <begin_vertex>\nvWp = (modelMatrix * vec4(transformed, 1.0)).xyz;");
    sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\nvarying vec3 vWp; uniform sampler2D uNoise; uniform float uCourt;")
      .replace("#include <map_fragment>", `#include <map_fragment>
        vec2 wxz = vWp.xz;
        float macro = texture2D(uNoise, wxz * 0.011).r * 0.6 + texture2D(uNoise, wxz * 0.047 + 0.37).g * 0.4;
        diffuseColor.rgb *= 0.86 + 0.28 * macro;
        float wet = 1.0 - smoothstep(${(SHORE.x0 - 8).toFixed(1)}, ${(SHORE.x0 + 2).toFixed(1)}, vWp.x); diffuseColor.rgb *= mix(1.0, 0.55, wet);
        float inX = 1.0 - smoothstep(4.9, 6.6, abs(wxz.x)); float inZ = smoothstep(-2.6, -0.9, wxz.y) * (1.0 - smoothstep(16.9, 18.6, wxz.y));
        float court = inX * inZ * uCourt; float rake = 0.5 + 0.5 * sin(wxz.y * 41.0 + 1.3 * sin(wxz.x * 2.3));
        diffuseColor.rgb *= 1.0 + court * (0.05 + 0.05 * (rake - 0.5));`)
      .replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\n roughnessFactor *= mix(1.0, 0.6, wet);");
  };
  const floor = new THREE.Mesh(buildSandGeometry(), sandMat); floor.receiveShadow = true; scene.add(floor);
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
  return { train, atmosphere, courtMask };
}

export function blobTexture(): THREE.CanvasTexture {
  return canvasTex(64, 64, (c) => { const g = c.createRadialGradient(32, 32, 2, 32, 32, 30); g.addColorStop(0, "rgba(0,0,0,0.55)"); g.addColorStop(1, "rgba(0,0,0,0)"); c.fillStyle = g; c.fillRect(0, 0, 64, 64); });
}

/** quadra de partida: fitas azuis de 5 cm de 16 × 8 m com estacas nos cantos e rede de 1,70 m no meio (z = MATCH.netZ), com pano que balança, fita branca e postes acolchoados */
export function buildMatchCourt(scene: THREE.Scene): { group: THREE.Group; net: Net } {
  const g = new THREE.Group(); g.visible = false; scene.add(g);
  const ribbon = new THREE.MeshStandardMaterial({ color: 0x2680ea, emissive: 0x0b3f86, roughness: 0.65, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const strip = (w: number, l: number, x: number, z: number, m: THREE.Material = ribbon) => { const s = new THREE.Mesh(new THREE.PlaneGeometry(w, l), m); s.rotation.x = -Math.PI / 2; s.position.set(x, 0.006, z); g.add(s); };
  const W = MATCH.halfW, L = MATCH.len, T = 0.08;   // fita de 8 cm (a oficial tem 5): de longe 5 cm some e a linha decide o ponto
  strip(2 * W + T, T, 0, 0); strip(2 * W + T, T, 0, L); strip(T, L + T, -W, L / 2); strip(T, L + T, W, L / 2);   // fundo, fundo, laterais
  strip(2 * W, T * 0.5, 0, MATCH.netZ, new THREE.MeshStandardMaterial({ color: 0x1f72d6, roughness: 0.7, transparent: true, opacity: 0.45, depthWrite: false }));   // projeção da rede
  // estacas que prendem as fitas: cantos, pés da rede e pontos intermediários
  const pegs: [number, number][] = [[-W, 0], [W, 0], [-W, L], [W, L], [-W, MATCH.netZ], [W, MATCH.netZ], [0, 0], [0, L], [-W, L / 4], [W, L / 4], [-W, 3 * L / 4], [W, 3 * L / 4]];
  const pm = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.013, 0.01, 0.07, 6), new THREE.MeshStandardMaterial({ color: 0xff6a00, roughness: 0.6 }), pegs.length);
  const mm = new THREE.Matrix4(); pegs.forEach(([x, z], i) => { pm.setMatrixAt(i, mm.makeTranslation(x, 0.03, z)); }); g.add(pm);
  const net = new Net(W, NET_H, MATCH.netZ); g.add(net.group);
  return { group: g, net };
}
