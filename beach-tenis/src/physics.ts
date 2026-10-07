export const G = 9.81;
export const BALL_R = 0.033;
export interface Ball { x: number; y: number; z: number; vx: number; vy: number; vz: number; bounces: number; wallHits: number; }
export interface Tun { eSand: number; eWall: number; wallZ: number; wallW: number; wallH: number; }
export type Ev = "sand" | "wall" | "wallout" | null;
export const DRAG = 0.025; // 0.5*rho*Cd*A/m para bola ~6,5 cm / 45 g
const FRIC_SAND = 0.8;

export function newBall(): Ball { return { x: 0, y: 1, z: 0, vx: 0, vy: 0, vz: 0, bounces: 0, wallHits: 0 }; }

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
      b.z = t.wallZ - BALL_R; b.vz = -b.vz * t.eWall; b.vx *= 0.97; b.bounces = 0; b.wallHits++; ev = "wall";
    } else if (b.z > t.wallZ + 0.3) ev = "wallout";
  }
  return ev;
}

export interface Sample { t: number; x: number; y: number; z: number; vx: number; vy: number; vz: number; bounces: number; wallHits: number; }
export function predict(b0: Ball, t: Tun, maxT = 3.2, dt = 1 / 60): Sample[] {
  const b = { ...b0 }; const out: Sample[] = []; let time = 0;
  while (time < maxT) {
    const ev = stepBall(b, dt, t); time += dt;
    out.push({ t: time, x: b.x, y: b.y, z: b.z, vx: b.vx, vy: b.vy, vz: b.vz, bounces: b.bounces, wallHits: b.wallHits });
    if (ev === "wallout" || b.bounces >= 3) break;
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
