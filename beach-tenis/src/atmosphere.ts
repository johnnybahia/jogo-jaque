import * as THREE from "three";
import type { SkyUniforms, SeaUniforms, RidgeUniforms } from "./sky";

/** Atmosferas (como `atmosphere.ts` do ninja): céu, névoa, luzes, mar e exposição de cada hora do dia. A partida percorre Manhã → Tarde → Pôr do sol; a transição é suave (constante de tempo ~2,5 s). */
export interface Atmos {
  zenith: THREE.Color; horizon: THREE.Color; sunGlow: THREE.Color; sunEl: number; sunAz: number; lightEl: number;   // cores do céu em linear HDR; sol em graus (az: 0 = à frente da câmera padrão, + para a esquerda da tela, − para o mar); lightEl = altura da LUZ (no pôr do sol fica acima do disco visível: o chão a 6° quase não recebe luz direta)
  fog: THREE.Color; fogNear: number; fogFar: number;
  sunLight: THREE.Color; sunI: number; skyFill: THREE.Color; groundFill: THREE.Color; hemiI: number; front: THREE.Color; frontI: number;   // luz do sol, céu/areia e preenchimento por trás da câmera (rosto da jogadora)
  seaDeep: THREE.Color; seaShallow: THREE.Color; ridgeFar: THREE.Color; ridgeNear: THREE.Color;
  cloud: THREE.Color; cloudAmt: number; exposure: number; sand: THREE.Color; haze: number;
}

const L = (r: number, g: number, b: number) => new THREE.Color(r, g, b);   // linear
const H = (hex: number) => new THREE.Color(hex);                            // sRGB

export const ATMOS: Atmos[] = [
  { // Manhã: ar limpo, azul fresco, luz suave vinda de trás-esquerda
    zenith: L(0.05, 0.22, 0.68), horizon: L(0.68, 0.83, 0.95), sunGlow: L(1.4, 1.15, 0.85), sunEl: 28, sunAz: 100, lightEl: 38,
    fog: L(0.68, 0.83, 0.95), fogNear: 34, fogFar: 200,
    sunLight: H(0xfff0d8), sunI: 1.9, skyFill: H(0xd2e8ff), groundFill: H(0xe8d8aa), hemiI: 1.2, front: H(0xdce9ff), frontI: 0.5,
    seaDeep: L(0.012, 0.14, 0.3), seaShallow: L(0.1, 0.52, 0.58), ridgeFar: H(0x8aa3b8), ridgeNear: H(0x93a07a),
    cloud: L(0.95, 0.96, 0.98), cloudAmt: 0.42, exposure: 1, sand: L(1, 1, 1), haze: 300,
  },
  { // Tarde: sol alto na frente-esquerda, azul profundo e muito contraste
    zenith: L(0.04, 0.2, 0.7), horizon: L(0.6, 0.8, 0.96), sunGlow: L(1.55, 1.3, 0.9), sunEl: 50, sunAz: 35, lightEl: 55,
    fog: L(0.6, 0.8, 0.96), fogNear: 32, fogFar: 200,
    sunLight: H(0xfff2d6), sunI: 2.0, skyFill: H(0xc5defa), groundFill: H(0xe0c890), hemiI: 1.2, front: H(0xe6efff), frontI: 0.45,
    seaDeep: L(0.01, 0.16, 0.34), seaShallow: L(0.08, 0.58, 0.62), ridgeFar: H(0x7f9db6), ridgeNear: H(0x86986c),
    cloud: L(1, 1, 1), cloudAmt: 0.46, exposure: 1, sand: L(1, 1, 1), haze: 280,
  },
  { // Pôr do sol: sol baixo sobre o mar (à direita), horizonte laranja, luz rasante quente e preenchimento frio
    zenith: L(0.05, 0.1, 0.36), horizon: L(1.0, 0.5, 0.32), sunGlow: L(2.4, 0.9, 0.35), sunEl: 6, sunAz: -38, lightEl: 19,
    fog: L(0.9, 0.5, 0.36), fogNear: 26, fogFar: 170,
    sunLight: H(0xffa468), sunI: 2.7, skyFill: H(0x8c94c8), groundFill: H(0xd9a070), hemiI: 1.05, front: H(0xc0c8f0), frontI: 0.7,
    seaDeep: L(0.02, 0.07, 0.17), seaShallow: L(0.34, 0.27, 0.3), ridgeFar: H(0x5e5a7e), ridgeNear: H(0x55584c),
    cloud: L(1, 0.45, 0.4), cloudAmt: 0.5, exposure: 1, sand: L(1, 0.93, 0.86), haze: 220,
  },
];
export const ATMOS_NAMES = ["Manhã", "Tarde", "Pôr do sol"];

const cloneA = (a: Atmos): Atmos => ({ ...a, zenith: a.zenith.clone(), horizon: a.horizon.clone(), sunGlow: a.sunGlow.clone(), fog: a.fog.clone(), sunLight: a.sunLight.clone(), skyFill: a.skyFill.clone(), groundFill: a.groundFill.clone(), front: a.front.clone(), seaDeep: a.seaDeep.clone(), seaShallow: a.seaShallow.clone(), ridgeFar: a.ridgeFar.clone(), ridgeNear: a.ridgeNear.clone(), cloud: a.cloud.clone(), sand: a.sand.clone() });
const NUM: (keyof Atmos)[] = ["sunEl", "sunAz", "lightEl", "fogNear", "fogFar", "sunI", "hemiI", "frontI", "cloudAmt", "exposure", "haze"];
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
  private sunDir = new THREE.Vector3(); private lightDir = new THREE.Vector3(); private tmp = new THREE.Color(); private time = 0;
  constructor(private p: AtmosParts) { this.apply(); }

  /** vai para `t` (0..1) com suavidade; `snap` pula direto */
  setTarget(t: number, snap = false): void { this.target = THREE.MathUtils.clamp(t, 0, 1); if (snap) this.t = this.target; }

  private mix(t: number): void { const x = t * 2, i = Math.min(1, Math.floor(x)); mixInto(this.cur, ATMOS[i], ATMOS[i + 1], x - i); }

  update(dt: number, cam: THREE.Vector3): void {
    this.time += dt; this.t += (this.target - this.t) * (1 - Math.exp(-dt / 2.5)); this.mix(this.t);
    this.apply(); this.p.sky.mesh.position.copy(cam); this.p.sea.u.uCam.value.copy(cam); this.p.sky.u.uTime.value = this.time; this.p.sea.u.uTime.value = this.time;
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
    p.sun.color.copy(c.sunLight); p.sun.intensity = c.sunI; p.sun.position.copy(this.lightDir).multiplyScalar(60);
    p.fill.color.copy(c.front); p.fill.intensity = c.frontI;
    p.sand.color.copy(c.sand); p.renderer.toneMappingExposure = c.exposure;
  }
}
