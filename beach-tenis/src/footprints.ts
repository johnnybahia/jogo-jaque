import * as THREE from "three";

const MAX = 200;
const VERT = `attribute float aAlpha; varying vec2 vUv; varying float vA;
void main(){ vUv = uv; vA = aAlpha; gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0); }`;
const FRAG = `uniform sampler2D map; uniform vec3 tint; varying vec2 vUv; varying float vA;
void main(){ float a = texture2D(map, vUv).a * vA; if (a < 0.01) discard; gl_FragColor = vec4(tint, a); }`;

function footTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas"); c.width = 64; c.height = 128; const g = c.getContext("2d")!;
  g.fillStyle = "#fff"; g.filter = "blur(1.2px)";
  const ell = (x: number, y: number, rx: number, ry: number) => { g.beginPath(); g.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); g.fill(); };
  ell(30, 106, 13, 17); ell(30, 78, 9, 14); ell(34, 48, 17, 20);           // calcanhar, arco, planta
  [[18, 22, 5], [27, 14, 5.5], [37, 12, 5.5], [46, 16, 5], [53, 25, 4.2]].forEach(([x, y, r]) => ell(x, y, r, r * 1.2));
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

interface FootState { bone: THREE.Object3D; toe: THREE.Object3D | null; planted: boolean; lifted: boolean; last: THREE.Vector3; left: boolean; }

export class Footprints {
  enabled = true; life = 25; baseY = 0.1;
  private mesh: THREE.InstancedMesh; private alpha: THREE.InstancedBufferAttribute;
  private born = new Float32Array(MAX).fill(-1e9); private peak = new Float32Array(MAX); private next = 0; private time = 0;
  private feet: FootState[] = []; private m = new THREE.Matrix4(); private q = new THREE.Quaternion(); private v = new THREE.Vector3(); private s = new THREE.Vector3();
  private tmp = new THREE.Vector3(); private tmp2 = new THREE.Vector3();

  constructor(scene: THREE.Scene) {
    const geo = new THREE.PlaneGeometry(0.13, 0.31); geo.rotateX(-Math.PI / 2); geo.translate(0, 0, -0.03);
    this.alpha = new THREE.InstancedBufferAttribute(new Float32Array(MAX), 1); geo.setAttribute("aAlpha", this.alpha);
    const mat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      uniforms: { map: { value: footTexture() }, tint: { value: new THREE.Color(0.22, 0.15, 0.07) } }, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    this.mesh = new THREE.InstancedMesh(geo, mat, MAX); this.mesh.frustumCulled = false; this.mesh.renderOrder = 1;
    this.m.makeScale(0, 0, 0); for (let i = 0; i < MAX; i++) this.mesh.setMatrixAt(i, this.m);
    scene.add(this.mesh);
  }

  /** acha os ossos dos pés e mede a altura do tornozelo na pose de repouso (idle) */
  bind(model: THREE.Object3D): void {
    const find = (re: RegExp) => { let r: THREE.Object3D | null = null; model.traverse((o) => { if (!r && re.test(o.name)) r = o; }); return r as THREE.Object3D | null; };
    this.feet = [];
    for (const left of [true, false]) {
      const b = find(left ? /LeftFoot$/ : /RightFoot$/); if (!b) continue;
      this.feet.push({ bone: b, toe: find(left ? /LeftToeBase$/ : /RightToeBase$/), planted: true, lifted: false, last: new THREE.Vector3(), left });
    }
  }

  calibrate(): void {
    let mn = 1e9; for (const f of this.feet) { f.bone.getWorldPosition(this.tmp); mn = Math.min(mn, this.tmp.y); f.last.copy(this.tmp); }
    if (mn < 1e8) this.baseY = mn;
  }

  clear(): void { this.born.fill(-1e9); for (let i = 0; i < MAX; i++) this.alpha.setX(i, 0); this.alpha.needsUpdate = true; }

  private stamp(f: FootState, speed: number): void {
    const i = this.next; this.next = (this.next + 1) % MAX;
    f.bone.getWorldPosition(this.tmp); let yaw = 0;
    if (f.toe) { f.toe.getWorldPosition(this.tmp2); yaw = Math.atan2(this.tmp2.x - this.tmp.x, this.tmp2.z - this.tmp.z); }
    const k = Math.min(1, speed / 3.6);
    this.q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    this.v.set(this.tmp.x, 0.004, this.tmp.z); const sc = 1 + 0.2 * k; this.s.set(f.left ? -sc : sc, 1, sc);
    this.m.compose(this.v, this.q, this.s); this.mesh.setMatrixAt(i, this.m); this.mesh.instanceMatrix.needsUpdate = true;
    this.born[i] = this.time; this.peak[i] = 0.6 + 0.35 * k;
  }

  /** chamar com as matrizes do esqueleto já atualizadas; rootSpeed em m/s */
  update(dt: number, rootSpeed: number): void {
    this.time += dt; if (!this.enabled) { this.mesh.visible = false; return; } this.mesh.visible = true;
    for (const f of this.feet) {
      f.bone.getWorldPosition(this.tmp); const h = this.tmp.y - this.baseY; const sp = dt > 0 ? this.tmp.distanceTo(f.last) / dt : 0; f.last.copy(this.tmp);
      if (h > 0.07) f.lifted = true;
      if (h < 0.035 && sp < 1.4 + rootSpeed * 0.6) { if (f.lifted) { this.stamp(f, rootSpeed); f.lifted = false; } }
    }
    let dirty = false;
    for (let i = 0; i < MAX; i++) {
      const age = this.time - this.born[i]; const a = age >= this.life ? 0 : this.peak[i] * Math.pow(1 - age / this.life, 1.3);
      if (this.alpha.getX(i) !== a) { this.alpha.setX(i, a); dirty = true; }
    }
    if (dirty) this.alpha.needsUpdate = true;
  }
}
