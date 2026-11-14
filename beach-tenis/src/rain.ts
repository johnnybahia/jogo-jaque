import * as THREE from "three";

/** Chuva: riscos finos caindo numa caixa em volta da câmera, um único draw call (segmentos de linha animados no shader, sem nada por quadro na CPU).
 *  Os riscos inclinam com o vento. `amount` (0 a 1) entra e sai com suavidade; em 0 a malha nem é desenhada. */
const MAX = 1800;
export class Rain {
  readonly mesh: THREE.LineSegments;
  private u = { uTime: { value: 0 }, uCam: { value: new THREE.Vector3() }, uWind: { value: new THREE.Vector2() }, uA: { value: 0 } };
  amount = 0; target = 0;
  /** respingos: anéis pequenos que abrem e somem na areia, em pontos que mudam a cada ciclo (um draw call, tudo no shader) */
  readonly splash: THREE.Mesh; private sgeo: THREE.InstancedBufferGeometry;

  constructor(scene: THREE.Scene) {
    const pos = new Float32Array(MAX * 6), end = new Float32Array(MAX * 2), seed = new Float32Array(MAX * 2);
    for (let i = 0; i < MAX; i++) {
      const x = Math.random(), y = Math.random(), z = Math.random(), s = Math.random();
      for (let k = 0; k < 2; k++) { pos.set([x, y, z], (i * 2 + k) * 3); end[i * 2 + k] = k; seed[i * 2 + k] = s; }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3)); geo.setAttribute("aEnd", new THREE.BufferAttribute(end, 1)); geo.setAttribute("aSeed", new THREE.BufferAttribute(seed, 1));
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, fog: false, uniforms: this.u,
      vertexShader: `uniform float uTime; uniform vec3 uCam; uniform vec2 uWind; attribute float aEnd; attribute float aSeed; varying float vA;
        const vec3 BOX = vec3(26.0, 13.0, 26.0);
        void main(){
          float sp = 11.0 + 4.0 * aSeed; vec3 vel = vec3(uWind.x, -sp, uWind.y);
          vec3 p = position * BOX + vel * uTime;
          p.y = mod(p.y, BOX.y);
          p.xz = mod(p.xz - uCam.xz + BOX.xz * 0.5, BOX.xz) - BOX.xz * 0.5 + uCam.xz;
          p -= normalize(vel) * (0.32 + 0.2 * aSeed) * aEnd;
          vA = 1.0 - aEnd;
          gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
        }`,
      fragmentShader: `uniform float uA; varying float vA; void main(){ gl_FragColor = vec4(0.80, 0.86, 0.94, 0.5 * vA * uA); }`,
    });
    this.mesh = new THREE.LineSegments(geo, mat); this.mesh.frustumCulled = false; this.mesh.renderOrder = 6; this.mesh.visible = false; scene.add(this.mesh);
    const NS = 320, q = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), sg = new THREE.InstancedBufferGeometry(); sg.index = q.index; sg.setAttribute("position", q.getAttribute("position")); sg.setAttribute("uv", q.getAttribute("uv"));
    const sd = new Float32Array(NS * 3); for (let i = 0; i < sd.length; i++) sd[i] = Math.random(); sg.setAttribute("aSeed", new THREE.InstancedBufferAttribute(sd, 3)); sg.instanceCount = NS; this.sgeo = sg;
    const sm = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, fog: false, uniforms: this.u,
      vertexShader: `uniform float uTime; uniform vec3 uCam; attribute vec3 aSeed; varying vec2 vUv; varying float vL;
        void main(){
          float cyc = uTime * (1.5 + aSeed.z) + aSeed.x * 17.0, n = floor(cyc); vL = fract(cyc); vUv = uv;
          vec2 r = fract(sin(vec2(n * 12.9898 + aSeed.x * 78.233, n * 39.346 + aSeed.y * 11.135)) * 43758.5453) * 24.0;
          vec2 c = mod(r - uCam.xz + 12.0, 24.0) - 12.0 + uCam.xz;
          float s = 0.05 + 0.2 * vL;
          gl_Position = projectionMatrix * viewMatrix * vec4(c.x + position.x * s, 0.03, c.y + position.z * s, 1.0);
        }`,
      fragmentShader: `uniform float uA; varying vec2 vUv; varying float vL;
        void main(){ float d = length(vUv - 0.5) * 2.0; float ring = smoothstep(0.5, 0.78, d) * (1.0 - smoothstep(0.84, 1.0, d)); float a = ring * (1.0 - vL) * 0.5 * uA; if (a < 0.01) discard; gl_FragColor = vec4(0.86, 0.91, 0.97, a); }`,
    });
    this.splash = new THREE.Mesh(sg, sm); this.splash.frustumCulled = false; this.splash.renderOrder = 5; this.splash.visible = false; scene.add(this.splash);
  }

  /** quantos riscos desenhar (qualidade gráfica) */
  setCount(n: number): void { this.mesh.geometry.setDrawRange(0, Math.min(MAX, n) * 2); this.sgeo.instanceCount = Math.round(Math.min(MAX, n) / MAX * 320); }

  update(dt: number, cam: THREE.Vector3, wx: number, wz: number): void {
    this.amount += (this.target - this.amount) * (1 - Math.exp(-dt / 1.5));
    if (this.amount < 0.01) { this.mesh.visible = false; this.splash.visible = false; this.u.uTime.value = 0; return; }
    this.mesh.visible = true; this.splash.visible = true; this.u.uTime.value += dt; this.u.uCam.value.copy(cam); this.u.uWind.value.set(wx, wz); this.u.uA.value = this.amount;
  }
}
