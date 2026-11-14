import * as THREE from "three";
import type { SkyUniforms, SeaUniforms, RidgeUniforms } from "./sky";
import { rim } from "./rim";

/** Atmosferas (como `atmosphere.ts` do ninja): céu, névoa, luzes, mar e exposição de cada hora do dia. A partida percorre Manhã → Tarde → Pôr do sol; a transição é suave (constante de tempo ~2,5 s). */
export interface Atmos {
  zenith: THREE.Color; horizon: THREE.Color; sunGlow: THREE.Color; sunEl: number; sunAz: number; lightEl: number;   // cores do céu em linear HDR; sol em graus (az: 0 = à frente da câmera padrão, + para a esquerda da tela, − para o mar); lightEl = altura da LUZ (no pôr do sol fica acima do disco visível: o chão a 6° quase não recebe luz direta)
  fog: THREE.Color; fogNear: number; fogFar: number;
  sunLight: THREE.Color; sunI: number; skyFill: THREE.Color; groundFill: THREE.Color; hemiI: number; front: THREE.Color; frontI: number;   // luz do sol, céu/areia e preenchimento por trás da câmera (rosto da jogadora)
  seaDeep: THREE.Color; seaShallow: THREE.Color; ridgeFar: THREE.Color; ridgeNear: THREE.Color;
  cloud: THREE.Color; cloudAmt: number; exposure: number; sand: THREE.Color; haze: number; rim: number;
}

const L = (r: number, g: number, b: number) => new THREE.Color(r, g, b);   // linear
const H = (hex: number) => new THREE.Color(hex);                            // sRGB

export const ATMOS: Atmos[] = [
  { // Manhã: ar limpo, azul fresco, luz suave vinda de trás-esquerda
    zenith: L(0.05, 0.22, 0.68), horizon: L(0.68, 0.83, 0.95), sunGlow: L(1.4, 1.15, 0.85), sunEl: 28, sunAz: 100, lightEl: 38,
    fog: L(0.68, 0.83, 0.95), fogNear: 34, fogFar: 200,
    sunLight: H(0xfff0d8), sunI: 1.9, skyFill: H(0xd2e8ff), groundFill: H(0xe8d8aa), hemiI: 1.2, front: H(0xdce9ff), frontI: 0.5,
    seaDeep: L(0.012, 0.14, 0.3), seaShallow: L(0.1, 0.52, 0.58), ridgeFar: H(0x8aa3b8), ridgeNear: H(0x93a07a),
    cloud: L(0.95, 0.96, 0.98), cloudAmt: 0.42, exposure: 1, sand: L(1, 1, 1), haze: 300, rim: 0.35,
  },
  { // Tarde: sol alto na frente-esquerda, azul profundo e muito contraste
    zenith: L(0.04, 0.2, 0.7), horizon: L(0.6, 0.8, 0.96), sunGlow: L(1.55, 1.3, 0.9), sunEl: 50, sunAz: 35, lightEl: 55,
    fog: L(0.6, 0.8, 0.96), fogNear: 32, fogFar: 200,
    sunLight: H(0xfff2d6), sunI: 2.0, skyFill: H(0xc5defa), groundFill: H(0xe0c890), hemiI: 1.2, front: H(0xe6efff), frontI: 0.45,
    seaDeep: L(0.01, 0.16, 0.34), seaShallow: L(0.08, 0.58, 0.62), ridgeFar: H(0x7f9db6), ridgeNear: H(0x86986c),
    cloud: L(1, 1, 1), cloudAmt: 0.46, exposure: 1, sand: L(1, 1, 1), haze: 280, rim: 0.2,
  },
  { // Pôr do sol: sol baixo sobre o mar (à direita), horizonte laranja, luz rasante quente e preenchimento frio
    zenith: L(0.05, 0.1, 0.36), horizon: L(1.0, 0.5, 0.32), sunGlow: L(2.4, 0.9, 0.35), sunEl: 6, sunAz: -38, lightEl: 19,
    fog: L(0.9, 0.5, 0.36), fogNear: 26, fogFar: 170,
    sunLight: H(0xffa468), sunI: 2.7, skyFill: H(0x8c94c8), groundFill: H(0xd9a070), hemiI: 1.05, front: H(0xc0c8f0), frontI: 0.7,
    seaDeep: L(0.02, 0.07, 0.17), seaShallow: L(0.34, 0.27, 0.3), ridgeFar: H(0x5e5a7e), ridgeNear: H(0x55584c),
    cloud: L(1, 0.45, 0.4), cloudAmt: 0.5, exposure: 1, sand: L(1, 0.93, 0.86), haze: 220, rim: 1.1,
  },
  { // Noite: céu escuro com lua; a quadra é iluminada de cima por refletores (luz fria e alta), o resto da praia fica no escuro
    zenith: L(0.004, 0.008, 0.03), horizon: L(0.02, 0.035, 0.08), sunGlow: L(0.5, 0.55, 0.7), sunEl: 40, sunAz: 60, lightEl: 62,
    fog: L(0.02, 0.03, 0.06), fogNear: 30, fogFar: 160,
    sunLight: H(0xdfe8ff), sunI: 1.6, skyFill: H(0x3a4a78), groundFill: H(0x4a4238), hemiI: 0.55, front: H(0xcfd8ff), frontI: 0.65,
    seaDeep: L(0.002, 0.008, 0.02), seaShallow: L(0.01, 0.03, 0.05), ridgeFar: H(0x0e1424), ridgeNear: H(0x0c1016),
    cloud: L(0.06, 0.07, 0.1), cloudAmt: 0.35, exposure: 1, sand: L(0.85, 0.88, 1), haze: 180, rim: 0.5,
  },
];
export const ATMOS_NAMES = ["Manhã", "Tarde", "Pôr do sol", "Noite"];
const T_MAX = (ATMOS.length - 1) / 2;   // posição no dia: 0 manhã, 0,5 tarde, 1 pôr do sol, 1,5 noite (a partida vai só até o pôr do sol; a noite é escolha nos Ajustes)

const cloneA = (a: Atmos): Atmos => ({ ...a, zenith: a.zenith.clone(), horizon: a.horizon.clone(), sunGlow: a.sunGlow.clone(), fog: a.fog.clone(), sunLight: a.sunLight.clone(), skyFill: a.skyFill.clone(), groundFill: a.groundFill.clone(), front: a.front.clone(), seaDeep: a.seaDeep.clone(), seaShallow: a.seaShallow.clone(), ridgeFar: a.ridgeFar.clone(), ridgeNear: a.ridgeNear.clone(), cloud: a.cloud.clone(), sand: a.sand.clone() });
const NUM: (keyof Atmos)[] = ["rim", "sunEl", "sunAz", "lightEl", "fogNear", "fogFar", "sunI", "hemiI", "frontI", "cloudAmt", "exposure", "haze"];
const COL: (keyof Atmos)[] = ["zenith", "horizon", "sunGlow", "fog", "sunLight", "skyFill", "groundFill", "front", "seaDeep", "seaShallow", "ridgeFar", "ridgeNear", "cloud", "sand"];

/** mistura a e b (k de 0 a 1) em `out` */
function mixInto(out: Atmos, a: Atmos, b: Atmos, k: number): void {
  const o = out as unknown as Record<string, number & THREE.Color>, x = a as unknown as Record<string, number & THREE.Color>, y = b as unknown as Record<string, number & THREE.Color>;
  for (const f of NUM) o[f] = (x[f] + (y[f] - x[f]) * k) as number & THREE.Color;
  for (const f of COL) o[f].copy(x[f]).lerp(y[f], k);
}

export interface AtmosParts {
  renderer: THREE.WebGLRenderer; fog: THREE.Fog; hemi: THREE.HemisphereLight; sun: THREE.DirectionalLight; fill: THREE.DirectionalLight;
  sky: { mesh: THREE.Mesh; u: SkyUniforms }; sea: { mesh: THREE.Mesh; u: SeaUniforms }; far: { u: RidgeUniforms }; near: { u: RidgeUniforms }; sand: THREE.MeshStandardMaterial;
}

export class Atmosphere {
  /** posição no dia: 0 = manhã, 0,5 = tarde, 1 = pôr do sol */
  t = 0.5; target = 0.5; cur = cloneA(ATMOS[1]);
  clouds = true; waves = 1;
  private sunDir = new THREE.Vector3(); private tmp = new THREE.Color(); private time = 0;
  /** clima por cima da hora do dia: céu encoberto (0 a 1) e chuva (0 a 1); `set` dá o alvo e a mudança é suave */
  overcast = 0; rain = 0; private wO = 0; private wR = 0;
  setWeather(overcast: number, rain: number, snap = false): void { this.overcast = overcast; this.rain = rain; if (snap) { this.wO = overcast; this.wR = rain; } }
  /** do chão para a luz (sombras dos adereços) */
  readonly lightDir = new THREE.Vector3();
  readonly sun: THREE.DirectionalLight;
  constructor(private p: AtmosParts) { this.sun = p.sun; this.apply(); }

  /** vai para `t` (0..1) com suavidade; `snap` pula direto */
  setTarget(t: number, snap = false): void { this.target = THREE.MathUtils.clamp(t, 0, T_MAX); if (snap) this.t = this.target; }

  /** o sol (e a caixa da sombra) olha para este ponto do chão: a quadra, ou a faixa de areia do frescobol */
  focus(x: number, z: number): void { this.p.sun.target.position.set(x, 0, z); this.apply(); }

  private mix(t: number): void { const x = t * 2, i = Math.min(ATMOS.length - 2, Math.floor(x)); mixInto(this.cur, ATMOS[i], ATMOS[i + 1], x - i); this.weather(); }

  /** encoberto: céu, névoa e mar puxam para o cinza, o sol quase some (luz difusa, sombras fracas) e as nuvens fecham; chuva: névoa mais perto, tudo mais escuro e a areia molhada (escura e menos áspera) */
  private weather(): void {
    const c = this.cur, o = this.wO, r = this.wR; if (o < 0.004 && r < 0.004) return;
    const lum = (k: THREE.Color) => 0.3 * k.r + 0.59 * k.g + 0.11 * k.b, gray = (k: THREE.Color, f: number, amt: number) => { const l = lum(k) * f; k.lerp(this.tmp.setRGB(l * 0.96, l, l * 1.05), amt); };
    const lh = lum(c.horizon); c.zenith.lerp(this.tmp.setRGB(lh * 0.5, lh * 0.52, lh * 0.56), 0.88 * o); gray(c.horizon, 0.8, 0.85 * o); gray(c.fog, 0.8, 0.85 * o);
    gray(c.cloud, 0.5, o); c.cloudAmt += (1 - c.cloudAmt) * o; gray(c.seaDeep, 0.9, 0.6 * o); gray(c.seaShallow, 0.7, 0.7 * o); gray(c.skyFill, 1, 0.6 * o);
    c.sunGlow.multiplyScalar(1 - 0.93 * o); c.sunI *= 1 - 0.72 * o; c.hemiI *= 1 + 0.25 * o - 0.18 * r; c.rim *= 1 - o; c.exposure *= 1 - 0.08 * o - 0.08 * r;
    c.fogNear *= 1 - 0.45 * r; c.fogFar *= 1 - 0.5 * r; c.haze *= 1 - 0.45 * r; c.sand.multiplyScalar(1 - 0.34 * r);
  }

  update(dt: number, camera: THREE.Camera): void {
    const cam = camera.position; this.time += dt; this.t += (this.target - this.t) * (1 - Math.exp(-dt / 2.5)); const kw = 1 - Math.exp(-dt / 3); this.wO += (this.overcast - this.wO) * kw; this.wR += (this.rain - this.wR) * kw; this.mix(this.t);
    this.apply(); rim.dir.value.copy(this.sunDir).transformDirection(camera.matrixWorldInverse); rim.color.value.copy(this.cur.sunLight).lerp(this.cur.sunGlow, 0.35); rim.k.value = this.cur.rim; this.p.sky.mesh.position.copy(cam); this.p.sea.u.uCam.value.copy(cam); this.p.sky.u.uTime.value = this.time; this.p.sea.u.uTime.value = this.time;
  }

  /** copia a atmosfera atual para céu, mar, névoa, luzes e exposição */
  apply(): void {
    const c = this.cur, p = this.p, el = THREE.MathUtils.degToRad(c.sunEl), az = THREE.MathUtils.degToRad(c.sunAz);
    this.sunDir.set(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)).normalize();
    const le = THREE.MathUtils.degToRad(c.lightEl); this.lightDir.set(Math.sin(az) * Math.cos(le), Math.sin(le), Math.cos(az) * Math.cos(le)).normalize();
    const su = p.sky.u, se = p.sea.u;
    su.uZenith.value.copy(c.zenith); su.uHorizon.value.copy(c.horizon); su.uSun.value.copy(c.sunGlow); su.uSunDir.value.copy(this.sunDir); su.uCloud.value.copy(c.cloud); su.uCloudAmt.value = this.clouds ? c.cloudAmt : 0;
    se.uDeep.value.copy(c.seaDeep); se.uShallow.value.copy(c.seaShallow); se.uHorizon.value.copy(c.horizon); se.uZenith.value.copy(c.zenith); se.uSun.value.copy(c.sunGlow); se.uSunDir.value.copy(this.sunDir); se.uHaze.value = c.haze; se.uWaves.value = this.waves;
    p.far.u.uHaze.value.copy(c.horizon); p.far.u.uRidge.value.copy(c.ridgeFar);
    p.near.u.uHaze.value.copy(this.tmp.copy(c.horizon).lerp(c.ridgeNear, 0.35)); p.near.u.uRidge.value.copy(c.ridgeNear);
    p.fog.color.copy(c.fog); p.fog.near = c.fogNear; p.fog.far = c.fogFar;
    p.hemi.color.copy(c.skyFill); p.hemi.groundColor.copy(c.groundFill); p.hemi.intensity = c.hemiI;
    p.sun.color.copy(c.sunLight); p.sun.intensity = c.sunI; p.sun.position.copy(this.lightDir).multiplyScalar(60).add(p.sun.target.position);
    p.fill.color.copy(c.front); p.fill.intensity = c.frontI;
    p.sand.color.copy(c.sand); p.sand.roughness = 1 - 0.3 * this.wR; p.renderer.toneMappingExposure = c.exposure;
  }
}
