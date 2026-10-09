import * as THREE from "three";

/** Céu, mar e horizonte (como `buildSky`/`buildMountains` do ninja): domo de céu em shader, mar com espuma na beira e dois anéis de silhuetas (dunas e morros) com neblina por distância.
 *  Geografia: o mar fica no lado −x do mundo (à direita da câmera padrão, que olha para +z); a areia desce em rampa a partir de x = SHORE.x0. */
export const SHORE = { x0: -20, slope: 0.05, sea: -0.3, bank: 1 };   // x0: referência da rampa (cor do mar e areia molhada); abaixo da linha d'água a areia afunda `slope` m por m; o nível do mar é y = sea
export const WATER_X = SHORE.x0 + SHORE.sea / SHORE.slope;   // −26: onde a areia encontra o mar
export const SHELF_X = WATER_X + SHORE.bank;                  // −25: até aqui a areia é plana (patamar firme onde se joga frescobol); daqui até a água, um degrau de `bank` m
/** relevo da areia: plana até o patamar, degrau até o nível do mar e, daí para dentro d'água, a rampa de sempre (a linha d'água continua em x = −26; antes a rampa começava em x = −20 e os pés ficariam no ar na beira do mar) */
export const sandHeight = (x: number): number => (x >= SHELF_X ? 0 : x >= WATER_X ? SHORE.sea * (SHELF_X - x) / SHORE.bank : -SHORE.slope * (SHORE.x0 - x));

const TONE = `#include <tonemapping_fragment>\n#include <colorspace_fragment>`;

/** ruído tileável pré-calculado (R e G: fbm de 5 oitavas com sementes diferentes) para as nuvens: 2 leituras por pixel em vez de 5 oitavas de ruído procedural */
export function makeNoiseTexture(size = 256): THREE.DataTexture {
  let s = 1337; const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const layer = (): Float32Array => {
    const out = new Float32Array(size * size);
    let amp = 0.5, tot = 0;
    for (const f of [4, 8, 16, 32, 64]) {
      const lat = new Float32Array(f * f); for (let i = 0; i < lat.length; i++) lat[i] = rnd();
      const cell = size / f;
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        const gx = x / cell, gy = y / cell, x0 = Math.floor(gx), y0 = Math.floor(gy), fx = gx - x0, fy = gy - y0;
        const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
        const a = lat[(y0 % f) * f + (x0 % f)], b = lat[(y0 % f) * f + ((x0 + 1) % f)], c = lat[((y0 + 1) % f) * f + (x0 % f)], d = lat[((y0 + 1) % f) * f + ((x0 + 1) % f)];
        out[y * size + x] += amp * (a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy);
      }
      tot += amp; amp *= 0.5;
    }
    for (let i = 0; i < out.length; i++) out[i] /= tot;
    return out;
  };
  const r = layer(), g = layer(), data = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) { data[i * 4] = Math.round(r[i] * 255); data[i * 4 + 1] = Math.round(g[i] * 255); data[i * 4 + 2] = 128; data[i * 4 + 3] = 255; }
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.needsUpdate = true;
  return t;
}

export interface SkyUniforms {
  uZenith: { value: THREE.Color }; uHorizon: { value: THREE.Color }; uSun: { value: THREE.Color }; uSunDir: { value: THREE.Vector3 };
  uCloud: { value: THREE.Color }; uCloudAmt: { value: number }; uTime: { value: number }; uNoise: { value: THREE.Texture };
}

/** domo do céu: gradiente do horizonte ao zênite, halo e disco do sol (HDR) e nuvens à deriva; acompanha a câmera */
export function buildSky(noise: THREE.Texture, clouds: boolean): { mesh: THREE.Mesh; u: SkyUniforms } {
  const u: SkyUniforms = {
    uZenith: { value: new THREE.Color(0.1, 0.34, 0.8) }, uHorizon: { value: new THREE.Color(0.62, 0.8, 0.95) }, uSun: { value: new THREE.Color(1.5, 1.25, 0.85) }, uSunDir: { value: new THREE.Vector3(0, 0.5, 0.8).normalize() },
    uCloud: { value: new THREE.Color(1, 1, 1) }, uCloudAmt: { value: clouds ? 0.45 : 0 }, uTime: { value: 0 }, uNoise: { value: noise },
  };
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false, uniforms: u as unknown as Record<string, THREE.IUniform>,
    vertexShader: `varying vec3 vDir; void main(){ vDir = position; vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = p.xyww; }`,
    fragmentShader: `
      uniform vec3 uZenith; uniform vec3 uHorizon; uniform vec3 uSun; uniform vec3 uSunDir; uniform vec3 uCloud; uniform float uCloudAmt; uniform float uTime; uniform sampler2D uNoise;
      varying vec3 vDir;
      void main(){
        vec3 d = normalize(vDir); float h = d.y; float sd = max(dot(d, uSunDir), 0.0);
        vec3 hor = uHorizon + uSun * pow(sd, 4.0) * 0.30;
        vec3 col = mix(hor, uZenith, pow(smoothstep(-0.02, 0.62, h), 0.55));
        col += uSun * (pow(sd, 12.0) * 0.40 + pow(sd, 160.0) * 1.3);
        col += uSun * smoothstep(0.9993, 0.9998, sd) * 6.0;
        if (uCloudAmt > 0.001) {
          vec2 cuv = d.xz / (h + 0.22) * 0.55 + vec2(uTime * 0.004, uTime * 0.0015);
          float n = texture2D(uNoise, cuv).r * 0.62 + texture2D(uNoise, cuv * 2.7 + 3.1).g * 0.38;
          float cl = smoothstep(1.0 - uCloudAmt, 1.0 - uCloudAmt + 0.22, n) * smoothstep(0.015, 0.22, h) * (1.0 - smoothstep(0.6, 0.95, h));
          vec3 cc = mix(uCloud, uSun * 0.95 + uCloud * 0.2, pow(sd, 3.0) * 0.85);
          col = mix(col, cc, cl * 0.8);
        }
        col = mix(col, uHorizon * 0.9, smoothstep(0.0, -0.12, h));
        gl_FragColor = vec4(col, 1.0);
        ${TONE}
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(400, 32, 16), mat); mesh.frustumCulled = false; mesh.renderOrder = -10;
  return { mesh, u };
}

export interface SeaUniforms {
  uDeep: { value: THREE.Color }; uShallow: { value: THREE.Color }; uHorizon: { value: THREE.Color }; uZenith: { value: THREE.Color }; uSun: { value: THREE.Color }; uSunDir: { value: THREE.Vector3 };
  uTime: { value: number }; uCam: { value: THREE.Vector3 }; uHaze: { value: number }; uWaves: { value: number };
}

/** mar: ondas por soma de senos (normal analítica), cor por profundidade (a rampa da areia é conhecida), reflexo do céu por Fresnel, brilho do sol e espuma na beira; some em neblina com a distância */
export function buildSea(): { mesh: THREE.Mesh; u: SeaUniforms } {
  const u: SeaUniforms = {
    uDeep: { value: new THREE.Color(0.02, 0.2, 0.34) }, uShallow: { value: new THREE.Color(0.1, 0.55, 0.6) }, uHorizon: { value: new THREE.Color(0.62, 0.8, 0.95) }, uZenith: { value: new THREE.Color(0.1, 0.34, 0.8) },
    uSun: { value: new THREE.Color(1.5, 1.25, 0.85) }, uSunDir: { value: new THREE.Vector3(0, 0.5, 0.8).normalize() }, uTime: { value: 0 }, uCam: { value: new THREE.Vector3() }, uHaze: { value: 260 }, uWaves: { value: 1 },
  };
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, fog: false, uniforms: u as unknown as Record<string, THREE.IUniform>,
    vertexShader: `varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `
      uniform vec3 uDeep; uniform vec3 uShallow; uniform vec3 uHorizon; uniform vec3 uZenith; uniform vec3 uSun; uniform vec3 uSunDir; uniform vec3 uCam; uniform float uTime; uniform float uHaze; uniform float uWaves;
      varying vec3 vW;
      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p){ vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f); return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y); }
      const float X0 = ${SHORE.x0.toFixed(2)}; const float SLOPE = ${SHORE.slope.toFixed(3)}; const float SEA = ${SHORE.sea.toFixed(2)}; const float WATERX = ${WATER_X.toFixed(3)}; const float SHELF = ${SHELF_X.toFixed(3)}; const float BANK = ${SHORE.bank.toFixed(3)};
      vec2 waves(vec2 p, float t){
        vec2 g = vec2(0.0);
        g += vec2(0.8, 0.6) * cos(dot(vec2(0.8, 0.6), p) * 0.9 + t * 1.1) * 0.020 * 0.9;
        g += vec2(-0.6, 0.8) * cos(dot(vec2(-0.6, 0.8), p) * 1.7 + t * 1.5) * 0.012 * 1.7;
        g += vec2(0.95, -0.3) * cos(dot(vec2(0.95, -0.3), p) * 3.1 + t * 2.1) * 0.007 * 3.1;
        g += vec2(-0.2, -0.98) * cos(dot(vec2(-0.2, -0.98), p) * 5.3 + t * 2.7) * 0.004 * 5.3;
        return g;
      }
      void main(){
        vec3 toCam = uCam - vW; float dist = length(toCam); vec3 V = toCam / dist;
        vec2 g = waves(vW.xz, uTime) * uWaves; g *= 1.0 / (1.0 + dist * 0.02);
        vec3 N = normalize(vec3(-g.x, 1.0, -g.y));
        float sandY = vW.x >= SHELF ? 0.0 : (vW.x >= WATERX ? SEA * (SHELF - vW.x) / BANK : -SLOPE * (X0 - vW.x)); float depth = SEA - sandY;
        float k = clamp((X0 - 6.0 - vW.x) / 70.0, 0.0, 1.0);
        vec3 base = mix(uShallow, uDeep, smoothstep(0.0, 1.0, k));
        float fres = 0.03 + 0.97 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
        vec3 R = reflect(-V, N); R.y = abs(R.y);
        vec3 skyCol = mix(uHorizon, uZenith, pow(clamp(R.y, 0.0, 1.0), 0.45)) + uSun * pow(max(dot(R, uSunDir), 0.0), 8.0) * 0.25;
        vec3 col = mix(base, skyCol, clamp(fres * 1.3, 0.0, 1.0));
        col += uSun * pow(max(dot(R, uSunDir), 0.0), 900.0) * 6.0 * (0.4 + 0.6 * noise(vW.xz * 2.0 + uTime * 0.6));
        float swash = 0.5 + 0.5 * sin(uTime * 0.6 + vW.z * 0.045);
        float band = smoothstep(0.0, 0.04, depth) * (1.0 - smoothstep(0.07, 0.2 + 0.18 * swash, depth));
        float fn = noise(vW.xz * vec2(1.4, 4.0) + vec2(uTime * 0.25, 0.0));
        float foam = band * smoothstep(0.3, 0.62, fn + 0.35 * (1.0 - depth * 5.0));
        float lines = smoothstep(0.55, 0.75, noise(vec2(vW.x * 0.9 + sin(vW.z * 0.2 + uTime * 0.3) * 1.2, vW.z * 0.15) + uTime * 0.08)) * smoothstep(0.1, 0.5, depth) * (1.0 - smoothstep(1.2, 3.5, depth)) * 0.35;
        col = mix(col, vec3(1.0), clamp(foam * 0.9 + lines, 0.0, 1.0));
        float alpha = smoothstep(0.0, 0.32, depth);
        float fogF = 1.0 - exp(-pow(dist / uHaze, 1.5)); col = mix(col, uHorizon, fogF);
        gl_FragColor = vec4(col, alpha);
        ${TONE}
      }`,
  });
  const geo = new THREE.PlaneGeometry(1400, 1400); geo.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geo, mat); mesh.position.set(WATER_X - 700, SHORE.sea, 0); mesh.frustumCulled = false; mesh.renderOrder = -5;
  return { mesh, u };
}

/** areia: um retângulo enorme com rampa para o mar (poucos vértices; o relevo é a função `sandHeight`) e UV em metros × 0,25 (a repetição da textura vem do `wrap`) */
export function buildSandGeometry(extent = 450): THREE.BufferGeometry {
  const xs = [-extent, WATER_X, SHELF_X, extent], zs = [-extent, extent], pos: number[] = [], uv: number[] = [], idx: number[] = [];
  for (const z of zs) for (const x of xs) { pos.push(x, sandHeight(x), z); uv.push(x * 0.25, z * 0.25); }
  for (let j = 0; j < zs.length - 1; j++) for (let i = 0; i < xs.length - 1; i++) { const a = j * xs.length + i, b = a + 1, c = a + xs.length, d = c + 1; idx.push(a, c, b, b, c, d); }
  const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
  return g;
}

export interface RidgeUniforms { uHaze: { value: THREE.Color }; uRidge: { value: THREE.Color }; uRamp: { value: number } }

/** anel de silhuetas (dunas ou morros) em volta do mundo: altura por ruído 1D, aberto no setor do mar; cor da base = neblina, topo = cor da crista (muda com a hora do dia) */
export function buildRidge(radius: number, hMin: number, hMax: number, seed: number, openSea: boolean): { mesh: THREE.Mesh; u: RidgeUniforms } {
  const N = 220, pos: number[] = [], aH: number[] = [], idx: number[] = [];
  const rnd = (i: number) => { const s = Math.sin(i * 127.1 + seed * 311.7) * 43758.5453; return s - Math.floor(s); };
  const noise1 = (x: number) => { const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f); return rnd(i) * (1 - u) + rnd(i + 1) * u; };
  for (let i = 0; i <= N; i++) {
    const a = (i / N) * Math.PI * 2;
    let n = 0.55 * noise1(a * 5 + seed) + 0.3 * noise1(a * 13 + seed * 2) + 0.15 * noise1(a * 31 + seed * 3);
    let h = hMin + (hMax - hMin) * n;
    if (openSea) { const d = Math.abs(Math.atan2(Math.sin(a - Math.PI), Math.cos(a - Math.PI))); h *= THREE.MathUtils.smoothstep(d, 0.55, 1.05); }   // a abertura do mar fica em torno do azimute −x (a = π)
    const x = Math.cos(a) * radius, z = Math.sin(a) * radius;
    pos.push(x, -8, z, x, h, z); aH.push(0, 1);
    if (i < N) { const b = i * 2; idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2); }
  }
  const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute("aH", new THREE.Float32BufferAttribute(aH, 1)); g.setIndex(idx);
  const u: RidgeUniforms = { uHaze: { value: new THREE.Color(0.62, 0.8, 0.95) }, uRidge: { value: new THREE.Color(0.3, 0.4, 0.5) }, uRamp: { value: hMax * 0.8 } };
  const mat = new THREE.ShaderMaterial({
    side: THREE.DoubleSide, depthWrite: true, fog: false, uniforms: u as unknown as Record<string, THREE.IUniform>,
    vertexShader: `attribute float aH; varying float vH; varying float vY; void main(){ vH = aH; vY = position.y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform vec3 uHaze; uniform vec3 uRidge; uniform float uRamp; varying float vH; varying float vY;
      void main(){ float k = smoothstep(-1.0, uRamp, vY); gl_FragColor = vec4(mix(uHaze, uRidge, k), 1.0);
${TONE}
      }`,
  });
  const mesh = new THREE.Mesh(g, mat); mesh.frustumCulled = false; mesh.renderOrder = -8;
  return { mesh, u };
}
