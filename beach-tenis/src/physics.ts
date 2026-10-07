export const G = 9.81;
export const BALL_R = 0.033;
export interface Vel { vx: number; vy: number; vz: number; }
/** ret: devolução planejada da parede (velocidade de saída no próximo toque na parede); sem ela, a parede reflete a bola com Tun.eWall */
export interface Ball { x: number; y: number; z: number; vx: number; vy: number; vz: number; bounces: number; wallHits: number; ret?: Vel | null; }
export interface Net { z: number; h: number; w: number; }   // plano da rede (z), altura (m) e largura (m) entre os postes
export interface Tun { eSand: number; eWall: number; wallZ: number; wallW: number; wallH: number; net?: Net; }
export type Ev = "sand" | "wall" | "wallout" | "net" | null;
export const DRAG = 0.025; // 0.5*rho*Cd*A/m para bola ~6,5 cm / 45 g
const FRIC_SAND = 0.8;

export function newBall(): Ball { return { x: 0, y: 1, z: 0, vx: 0, vy: 0, vz: 0, bounces: 0, wallHits: 0, ret: null }; }

export function stepBall(b: Ball, dt: number, t: Tun): Ev {
  const k = DRAG * Math.hypot(b.vx, b.vy, b.vz);
  b.vx -= k * b.vx * dt; b.vz -= k * b.vz * dt; b.vy -= (G + k * b.vy) * dt;
  b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
  let ev: Ev = null;
  if (b.y < BALL_R && b.vy < 0) {
    b.y = BALL_R; b.vy = -b.vy * t.eSand; if (b.vy < 0.5) b.vy = 0;
    b.vx *= FRIC_SAND; b.vz *= FRIC_SAND; b.bounces++; ev = "sand";
  } else if (b.y <= BALL_R + 1e-3 && b.vy === 0) { const f = Math.max(0, 1 - 3 * dt); b.vx *= f; b.vz *= f; }
  if (b.z > t.wallZ - BALL_R && b.vz > 0) {
    if (Math.abs(b.x) <= t.wallW / 2 && b.y <= t.wallH) {
      b.z = t.wallZ - BALL_R; b.bounces = 0; b.wallHits++; ev = "wall";
      if (b.ret) { b.vx = b.ret.vx; b.vy = b.ret.vy; b.vz = b.ret.vz; b.ret = null; } else { b.vz = -b.vz * t.eWall; b.vx *= 0.97; }
    } else if (b.z > t.wallZ + 0.3) ev = "wallout";
  }
  // rede (partida): a bola que cruza o plano da rede abaixo da fita bate nela e cai
  const n = t.net;
  if (n && ev === null) {
    const zPrev = b.z - b.vz * dt;
    if ((zPrev - n.z) * (b.z - n.z) < 0 && Math.abs(b.x) <= n.w / 2 && b.y < n.h + BALL_R * 0.5) {
      b.z = n.z + (zPrev < n.z ? -1 : 1) * (BALL_R + 0.01); b.vz = -b.vz * 0.15; b.vx *= 0.35; b.vy = Math.min(b.vy, 0.5); ev = "net";
    }
  }
  return ev;
}

export interface Sample { t: number; x: number; y: number; z: number; vx: number; vy: number; vz: number; bounces: number; wallHits: number; }
export function predict(b0: Ball, t: Tun, maxT = 3.2, dt = 1 / 60, live = false): Sample[] {
  const b = { ...b0 }; const out: Sample[] = []; let time = 0;
  while (time < maxT) {
    const ev = stepBall(b, dt, t); time += dt;
    out.push({ t: time, x: b.x, y: b.y, z: b.z, vx: b.vx, vy: b.vy, vz: b.vz, bounces: b.bounces, wallHits: b.wallHits });
    if (ev === "wallout" || b.bounces >= 3) break;
    if (live && (ev === "sand" || ev === "net")) break;       // bola viva (beach tênis): o 1º toque na areia (ou na rede) encerra o ponto
  }
  return out;
}

/** altura da bola ao chegar no plano z=zWall, voo livre (sem quique) — usado para mirar */
export function heightAtWall(b: Ball, vx: number, vy: number, vz: number, zWall: number): number {
  let x = b.x, y = b.y, z = b.z; const dt = 1 / 120;
  for (let i = 0; i < 1200; i++) {
    const k = DRAG * Math.hypot(vx, vy, vz);
    vx -= k * vx * dt; vz -= k * vz * dt; vy -= (G + k * vy) * dt; x += vx * dt; y += vy * dt; z += vz * dt;
    if (z >= zWall) return y;
  }
  return -9;
}

/** velocidade de saída para a bola partir de `from` e passar por `to` depois de T s (com arrasto, mesmo passo da física); a devolução da parede usa isto */
export function solveShot(from: { x: number; y: number; z: number }, to: { x: number; y: number; z: number }, T: number): Vel {
  let vx = (to.x - from.x) / T, vz = (to.z - from.z) / T, vy = (to.y - from.y + 0.5 * G * T * T) / T;
  const n = Math.max(1, Math.round(T * 120)), dt = T / n;
  for (let it = 0; it < 4; it++) {   // converge ~4,5× por volta: 4 voltas dão erro < 3 mm
    let x = from.x, y = from.y, z = from.z, ux = vx, uy = vy, uz = vz;
    for (let i = 0; i < n; i++) { const k = DRAG * Math.hypot(ux, uy, uz); ux -= k * ux * dt; uz -= k * uz * dt; uy -= (G + k * uy) * dt; x += ux * dt; y += uy * dt; z += uz * dt; }
    vx += (to.x - x) / T; vy += (to.y - y) / T; vz += (to.z - z) / T;
  }
  return { vx, vy, vz };
}
