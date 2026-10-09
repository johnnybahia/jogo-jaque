import * as THREE from "three";

/** Efeitos de jogo (como os pools de faíscas e o rastro da lâmina do ninja): rastro e brilho da bola, anel + faíscas no contato, areia que sobe onde a bola cai, risco no ar da raquete, confete.
 *  Tudo em poucas chamadas: 2 `Points` (aditivo e normal), 1 ribbon da bola, 1 ribbon por atleta, sprites do brilho e dos anéis. A quantidade cai com a qualidade. */
const TONE = `#include <tonemapping_fragment>\n#include <colorspace_fragment>`;
const rnd = (a: number, b: number) => a + Math.random() * (b - a);

function tex(draw: (c: CanvasRenderingContext2D, n: number) => void, n = 64): THREE.CanvasTexture {
  const cv = document.createElement("canvas"); cv.width = cv.height = n; draw(cv.getContext("2d")!, n);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
}
const softTex = () => tex((c, n) => { const g = c.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2); g.addColorStop(0, "rgba(255,255,255,1)"); g.addColorStop(0.45, "rgba(255,255,255,.55)"); g.addColorStop(1, "rgba(255,255,255,0)"); c.fillStyle = g; c.fillRect(0, 0, n, n); });
const sparkTex = () => tex((c, n) => { const g = c.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2); g.addColorStop(0, "rgba(255,255,255,1)"); g.addColorStop(0.16, "rgba(255,255,255,.95)"); g.addColorStop(0.4, "rgba(255,255,255,.22)"); g.addColorStop(1, "rgba(255,255,255,0)"); c.fillStyle = g; c.fillRect(0, 0, n, n); });
const ringTex = () => tex((c, n) => { const g = c.createRadialGradient(n / 2, n / 2, n * 0.3, n / 2, n / 2, n / 2); g.addColorStop(0, "rgba(255,255,255,0)"); g.addColorStop(0.62, "rgba(255,255,255,.95)"); g.addColorStop(0.8, "rgba(255,255,255,.35)"); g.addColorStop(1, "rgba(255,255,255,0)"); c.fillStyle = g; c.fillRect(0, 0, n, n); }, 128);
const squareTex = () => tex((c, n) => { c.fillStyle = "#fff"; c.fillRect(n * 0.12, n * 0.12, n * 0.76, n * 0.76); });

/** nuvem de partículas em um `Points`: posição, velocidade, gravidade, arrasto, tamanho e alfa por partícula; o tamanho na tela acompanha a distância à câmera */
class Pool {
  readonly pts: THREE.Points;
  private n: number; private pos: Float32Array; private col: Float32Array; private size: Float32Array; private alpha: Float32Array;
  private vel: Float32Array; private life: Float32Array; private max: Float32Array; private g: Float32Array; private drag: Float32Array; private s0: Float32Array; private s1: Float32Array; private a0: Float32Array; private flut: Float32Array; private ground: Uint8Array;
  private next = 0; private geo: THREE.BufferGeometry; private u: { uK: { value: number } };
  constructor(n: number, additive: boolean, map: THREE.Texture) {
    this.n = n; this.pos = new Float32Array(n * 3); this.col = new Float32Array(n * 3); this.size = new Float32Array(n); this.alpha = new Float32Array(n);
    this.vel = new Float32Array(n * 3); this.life = new Float32Array(n); this.max = new Float32Array(n).fill(1); this.g = new Float32Array(n); this.drag = new Float32Array(n); this.s0 = new Float32Array(n); this.s1 = new Float32Array(n); this.a0 = new Float32Array(n); this.flut = new Float32Array(n); this.ground = new Uint8Array(n);
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute("position", new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage)); this.geo.setAttribute("aColor", new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute("aSize", new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage)); this.geo.setAttribute("aAlpha", new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.u = { uK: { value: 600 } };
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, fog: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, uniforms: { uMap: { value: map }, uK: this.u.uK },
      vertexShader: `attribute vec3 aColor; attribute float aSize; attribute float aAlpha; uniform float uK; varying vec3 vC; varying float vA;
        void main(){ vC = aColor; vA = aAlpha; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv; gl_PointSize = max(0.0, aSize * uK / max(0.1, -mv.z)); }`,
      fragmentShader: `uniform sampler2D uMap; varying vec3 vC; varying float vA;
        void main(){ vec4 t = texture2D(uMap, gl_PointCoord); gl_FragColor = vec4(vC, vA * t.a); if (gl_FragColor.a < 0.003) discard;\n${TONE}\n}`,
    });
    this.pts = new THREE.Points(this.geo, mat); this.pts.frustumCulled = false; this.pts.renderOrder = 4;
  }
  setK(k: number): void { this.u.uK.value = k; }
  spawn(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, s0: number, s1: number, r: number, g: number, b: number, grav: number, drag: number, a0 = 1, flutter = 0, ground = false): void {
    const i = this.next, i3 = i * 3; this.next = (this.next + 1) % this.n;
    this.pos[i3] = x; this.pos[i3 + 1] = y; this.pos[i3 + 2] = z; this.vel[i3] = vx; this.vel[i3 + 1] = vy; this.vel[i3 + 2] = vz; this.col[i3] = r; this.col[i3 + 1] = g; this.col[i3 + 2] = b;
    this.life[i] = life; this.max[i] = life; this.s0[i] = s0; this.s1[i] = s1; this.g[i] = grav; this.drag[i] = drag; this.a0[i] = a0; this.flut[i] = flutter ? rnd(0, 6.28) : -1; this.ground[i] = ground ? 1 : 0; this.size[i] = s0; this.alpha[i] = a0;
  }
  update(dt: number): void {
    let dirty = false;
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) { if (this.alpha[i] !== 0) { this.alpha[i] = 0; this.size[i] = 0; dirty = true; } continue; }
      dirty = true; const i3 = i * 3; this.life[i] -= dt; const k = 1 - Math.max(0, this.life[i]) / this.max[i], d = Math.max(0, 1 - this.drag[i] * dt);
      this.vel[i3 + 1] -= this.g[i] * dt; this.vel[i3] *= d; this.vel[i3 + 1] *= d; this.vel[i3 + 2] *= d;
      this.pos[i3] += this.vel[i3] * dt; this.pos[i3 + 1] += this.vel[i3 + 1] * dt; this.pos[i3 + 2] += this.vel[i3 + 2] * dt;
      if (this.ground[i] && this.pos[i3 + 1] < 0.015) { this.pos[i3 + 1] = 0.015; this.vel[i3] *= 0.35; this.vel[i3 + 2] *= 0.35; this.vel[i3 + 1] = 0; }
      let s = this.s0[i] + (this.s1[i] - this.s0[i]) * k; if (this.flut[i] >= 0) s *= 0.35 + 0.65 * Math.abs(Math.cos(this.flut[i] + k * 14));
      this.size[i] = s; this.alpha[i] = this.a0[i] * (1 - k) * Math.min(1, (1 - k) * 4);
    }
    if (dirty) for (const a of ["position", "aSize", "aAlpha", "aColor"]) (this.geo.getAttribute(a) as THREE.BufferAttribute).needsUpdate = true;
  }
}

/** fita no espaço: pares de pontos (a, b) com idade; alfa cai com a idade; face à câmera não é preciso (a fita já tem largura no plano do movimento) */
class Ribbon {
  readonly mesh: THREE.Mesh;
  private max: number; private pos: Float32Array; private al: Float32Array; private geo: THREE.BufferGeometry;
  constructor(max: number, color: THREE.Color, boost = 1) {
    this.max = max; this.pos = new Float32Array(max * 6); this.al = new Float32Array(max * 2);
    this.geo = new THREE.BufferGeometry(); this.geo.setAttribute("position", new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage)); this.geo.setAttribute("aA", new THREE.BufferAttribute(this.al, 1).setUsage(THREE.DynamicDrawUsage));
    const idx: number[] = []; for (let i = 0; i < max - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); } this.geo.setIndex(idx); this.geo.setDrawRange(0, 0);
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, fog: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, uniforms: { uC: { value: color.clone().multiplyScalar(boost) } },
      vertexShader: `attribute float aA; varying float vA; void main(){ vA = aA; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `uniform vec3 uC; varying float vA; void main(){ gl_FragColor = vec4(uC, vA);\n${TONE}\n}`,
    });
    this.mesh = new THREE.Mesh(this.geo, mat); this.mesh.frustumCulled = false; this.mesh.renderOrder = 5; this.mesh.visible = false;
  }
  /** amostras do mais antigo (0) ao mais novo (n−1): pontos a e b, alfa */
  set(n: number, get: (i: number, a: THREE.Vector3, b: THREE.Vector3) => number): void {
    if (n < 2) { this.mesh.visible = false; return; }
    const a = new THREE.Vector3(), b = new THREE.Vector3(); n = Math.min(n, this.max);
    for (let i = 0; i < n; i++) { const al = get(i, a, b); this.pos[i * 6] = a.x; this.pos[i * 6 + 1] = a.y; this.pos[i * 6 + 2] = a.z; this.pos[i * 6 + 3] = b.x; this.pos[i * 6 + 4] = b.y; this.pos[i * 6 + 5] = b.z; this.al[i * 2] = al; this.al[i * 2 + 1] = al; }
    this.geo.setDrawRange(0, (n - 1) * 6); this.geo.attributes.position.needsUpdate = true; this.geo.attributes.aA.needsUpdate = true; this.mesh.visible = true;
  }
  hide(): void { this.mesh.visible = false; }
}

interface Samp { a: THREE.Vector3; b: THREE.Vector3; age: number }
interface BallLike { x: number; y: number; z: number; vx: number; vy: number; vz: number }
export interface Swinger { key: object; head: THREE.Object3D; racket: THREE.Object3D; on: boolean }

export class Fx {
  readonly group = new THREE.Group();
  level = 1;   // 1 Alta · 0,7 Média · 0,4 Baixa (quantidade de partículas; a Baixa também desliga o risco da raquete)
  private add: Pool; private mix: Pool; private conf: Pool; private rings: { s: THREE.Sprite; age: number; life: number; r0: number; r1: number }[] = []; private ringNext = 0;
  private glow: THREE.Sprite; private trail: Ribbon; private hist: THREE.Vector3[] = []; private tmpV = new THREE.Vector3(); private tmpU = new THREE.Vector3(); private tmpS = new THREE.Vector3(); private tmpC = new THREE.Vector3(); private t = 0;
  private sw = new Map<object, { rib: Ribbon; s: Samp[]; last: THREE.Vector3; has: boolean }>();

  constructor(scene: THREE.Scene, private camera: THREE.PerspectiveCamera, private renderer: THREE.WebGLRenderer) {
    this.add = new Pool(320, true, sparkTex()); this.mix = new Pool(520, false, softTex()); this.conf = new Pool(420, false, squareTex()); this.group.add(this.add.pts, this.mix.pts, this.conf.pts);
    const rt = ringTex();
    for (let i = 0; i < 6; i++) { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: rt, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, opacity: 0 })); s.visible = false; s.renderOrder = 4; this.group.add(s); this.rings.push({ s, age: 1, life: 0.3, r0: 0.1, r1: 0.8 }); }
    this.glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: softTex(), color: new THREE.Color(0.85, 1.1, 0.3), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, opacity: 0.55 })); this.glow.visible = false; this.glow.renderOrder = 4; this.group.add(this.glow);
    this.trail = new Ribbon(24, new THREE.Color(0.8, 1, 0.3), 1.1); this.group.add(this.trail.mesh); scene.add(this.group);
  }

  private k(): number { const h = this.renderer.getDrawingBufferSize(this.tmpV2).y; return h / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2)); }
  private tmpV2 = new THREE.Vector2();

  private ring(x: number, y: number, z: number, life: number, r1: number, c: THREE.Color): void {
    const o = this.rings[this.ringNext]; this.ringNext = (this.ringNext + 1) % this.rings.length; o.age = 0; o.life = life; o.r0 = r1 * 0.18; o.r1 = r1; o.s.position.set(x, y, z); (o.s.material as THREE.SpriteMaterial).color.copy(c); o.s.visible = true;
  }

  /** contato bola × raquete: anel + faíscas; q = 2 perfeito (mais, em lima), smash/por cima = mais forte */
  hit(x: number, y: number, z: number, q: number, kind: string): void {
    const big = kind === "smash" || kind === "over", n = Math.round((q === 2 ? 22 : 12) * (big ? 1.4 : 1) * this.level), lime = q === 2;
    this.ring(x, y, z, big ? 0.38 : 0.3, (lime ? 1.1 : 0.8) * (big ? 1.25 : 1), lime ? new THREE.Color(0.8, 1.2, 0.3) : new THREE.Color(1, 1, 1));
    for (let i = 0; i < n; i++) {
      const a = rnd(0, 6.28), e = rnd(-0.5, 1.2), sp = rnd(2.4, big ? 8 : 6), cx = Math.cos(a) * Math.cos(e), cz = Math.sin(a) * Math.cos(e), cy = Math.sin(e);
      const w = Math.random() < 0.5; this.add.spawn(x, y, z, cx * sp, cy * sp, cz * sp, rnd(0.25, 0.5), rnd(0.09, 0.15), 0.01, w ? 2.2 : 1.6, w ? 2.2 : 2.4, w ? 2 : 0.5, 3, 2.2, 1);
    }
  }

  /** a bola caiu na areia em (x, z): grãos e poeira que sobem */
  sand(x: number, z: number, speed: number): void {
    const n = Math.round(Math.min(30, 12 + speed * 1.5) * this.level);
    for (let i = 0; i < n; i++) {
      const a = rnd(0, 6.28), h = rnd(0.5, 2.6) * (0.6 + speed * 0.05), dark = i % 2 === 0;   // torrões mais escuros e grãos claros: aparecem sobre a areia
      this.mix.spawn(x, 0.04, z, Math.cos(a) * h, rnd(1.8, 4.2), Math.sin(a) * h, rnd(0.5, 1), dark ? 0.09 : 0.07, 0.04, dark ? 0.52 : 1, dark ? 0.4 : 0.93, dark ? 0.26 : 0.74, 9.8, 0.6, 1, 0, true);
    }
    for (let i = 0; i < Math.round(6 * this.level); i++) { const a = rnd(0, 6.28); this.mix.spawn(x, 0.08, z, Math.cos(a) * 0.9, rnd(0.2, 0.9), Math.sin(a) * 0.9, rnd(0.8, 1.3), 0.35, 1.0, 0.98, 0.9, 0.72, -0.2, 1.4, 0.5); }
  }

  /** a bola caiu na água em (x, z) (frescobol): gotas claras que sobem e caem e um anel */
  splash(x: number, z: number): void {
    for (let i = 0, n = Math.round(26 * this.level); i < n; i++) { const a = rnd(0, 6.28), h = rnd(0.3, 1.5); this.mix.spawn(x, -0.2, z, Math.cos(a) * h, rnd(2.4, 5), Math.sin(a) * h, rnd(0.5, 0.9), 0.07, 0.035, 0.85, 0.96, 1, 9.8, 0.4); }
    this.ring(x, -0.2, z, 0.55, 1.1, new THREE.Color(0.85, 0.97, 1));
  }

  /** confete: `n` pedaços sobre (x, z), espalhados em `spread` m, caindo devagar por `dur` s */
  confetti(x: number, z: number, n: number, spread = 2.5, dur = 4.2): void {
    const pal: [number, number, number][] = [[1, 0.42, 0.05], [0.85, 0.96, 0.23], [1, 1, 1], [1, 0.35, 0.55], [0.3, 0.7, 1], [1, 0.82, 0.2], [0.35, 0.9, 0.7]];
    for (let i = 0; i < Math.round(n * this.level); i++) {
      const c = pal[(Math.random() * pal.length) | 0], a = rnd(0, 6.28), r = Math.sqrt(Math.random()) * spread;
      this.conf.spawn(x + Math.cos(a) * r, rnd(2.6, 4.4), z + Math.sin(a) * r, rnd(-1.4, 1.4), rnd(0.6, 3.4), rnd(-1.4, 1.4), rnd(dur * 0.6, dur), 0.17, 0.15, c[0], c[1], c[2], 2.4, 1.2, 1, 1);
    }
  }

  /** a cada quadro: partículas, anéis, brilho e rastro da bola, riscos das raquetes. `ball` = a bola em jogo (ou null) */
  update(dt: number, ball: BallLike | null, swingers: Swinger[]): void {
    this.t += dt; const kk = this.k(); this.add.setK(kk); this.mix.setK(kk); this.conf.setK(kk); this.add.update(dt); this.mix.update(dt); this.conf.update(dt);
    for (const o of this.rings) { if (!o.s.visible) continue; o.age += dt; const u = o.age / o.life; if (u >= 1) { o.s.visible = false; continue; } o.s.scale.setScalar(o.r0 + (o.r1 - o.r0) * (1 - (1 - u) * (1 - u))); (o.s.material as THREE.SpriteMaterial).opacity = 0.9 * (1 - u) * (1 - u); }
    // bola: brilho + rastro (as últimas ~0,4 s, afinando para trás)
    if (!ball) { this.glow.visible = false; this.hist.length = 0; this.trail.hide(); }
    else {
      this.glow.visible = true; this.glow.position.set(ball.x, ball.y, ball.z); this.glow.scale.setScalar(0.5 + 0.06 * Math.sin(this.t * 14));
      const last = this.hist[this.hist.length - 1], cur = this.tmpV.set(ball.x, ball.y, ball.z);
      if (last && last.distanceTo(cur) > 3) this.hist.length = 0;
      if (!last || last.distanceToSquared(cur) > 1e-6) { this.hist.push(cur.clone()); if (this.hist.length > 24) this.hist.shift(); }
      const sp = Math.hypot(ball.vx, ball.vy, ball.vz), n = this.hist.length;
      if (sp < 2.5 || n < 3) this.trail.hide();
      else {
        const cam = this.camera.position, tg = this.tmpU, side = this.tmpS, toCam = this.tmpC;
        this.trail.set(n, (i, a, b) => {
          const p = this.hist[i], q0 = this.hist[Math.max(0, i - 1)], q1 = this.hist[Math.min(n - 1, i + 1)]; tg.copy(q1).sub(q0); side.crossVectors(tg, toCam.copy(cam).sub(p));
          if (side.lengthSq() < 1e-8) side.set(0, 1, 0); side.normalize(); const u = i / (n - 1), w = 0.11 * Math.pow(u, 0.9) + 0.006; a.copy(p).addScaledVector(side, w); b.copy(p).addScaledVector(side, -w); return 0.6 * Math.pow(u, 1.6);
        });
      }
    }
    // risco no ar da raquete (só enquanto balança e logo depois); Baixa desliga
    if (this.level >= 0.6) for (const s of swingers) {
      let e = this.sw.get(s.key); if (!e) { e = { rib: new Ribbon(14, new THREE.Color(0.95, 1, 0.8), 0.9), s: [], last: new THREE.Vector3(), has: false }; this.sw.set(s.key, e); this.group.add(e.rib.mesh); }
      const head = s.head.getWorldPosition(this.tmpU);
      if (s.on) {
        const sp = e.has ? head.distanceTo(e.last) / Math.max(dt, 1e-3) : 0; e.last.copy(head); e.has = true;
        if (sp > 3.2) { const a = s.racket.localToWorld(new THREE.Vector3(0, 0.38, 0)), b = s.racket.localToWorld(new THREE.Vector3(0, 0.14, 0)); e.s.push({ a, b, age: 0 }); if (e.s.length > 14) e.s.shift(); }
      } else e.has = false;
      for (const m of e.s) m.age += dt; while (e.s.length && e.s[0].age > 0.26) e.s.shift();
      const L = e.s; e.rib.set(L.length, (i, a, b) => { a.copy(L[i].a); b.copy(L[i].b); return 0.5 * Math.pow(Math.max(0, 1 - L[i].age / 0.26), 1.6); });
    } else for (const e of this.sw.values()) e.rib.hide();
  }
}
