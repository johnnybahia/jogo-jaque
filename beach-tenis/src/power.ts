import * as THREE from "three";

/** Marcador de queda (só na partida): enquanto a jogadora balança a raquete, uma elipse fina no chão da quadra adversária mostra onde a bola deve cair com a mira (direcional), o tempo do aperto e a força de agora.
 *  Centro = queda esperada; tamanho = margem de erro (lateral e de profundidade); cor = chance de ficar dentro das linhas (verde, amarelo, vermelho, as mesmas do marcador de rebatida).
 *  Existe só durante o balanço e some em ~0,25 s; um quad com shader, sem alocar nada por quadro. */
const TONE = `#include <tonemapping_fragment>\n#include <colorspace_fragment>`;
const GREEN = new THREE.Color(0x35e06a), YELLOW = new THREE.Color(0xffd23a), RED = new THREE.Color(0xff4a4a);
const PAD = 0.25;   // folga do quad em volta da elipse (m)

export interface AimView { x: number; z: number; rx: number; rz: number; inside: number; }
/** barra de força na tela: f = fração do balanço com o GOLPE apertado, pw = força que isso dá (0 até a zona morta), hold = o dedo ainda está no botão */
export interface PowerView { f: number; pw: number; hold: boolean; }

export class AimMark {
  readonly mesh: THREE.Mesh;
  private u = { uR: { value: new THREE.Vector2(1, 1) }, uS: { value: new THREE.Vector2(1, 1) }, uCol: { value: new THREE.Color(0x35e06a) }, uA: { value: 0 } };
  private rx = 1; private rz = 1; private a = 0; private shown = false; private col = new THREE.Color(0x35e06a);

  constructor(scene: THREE.Scene) {
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, fog: false, uniforms: this.u,
      vertexShader: `uniform vec2 uS; varying vec2 vP;
        void main(){ vP = position.xy * uS; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `uniform vec2 uR; uniform vec3 uCol; uniform float uA; varying vec2 vP;
        void main(){
          vec2 q = vP / uR; float r = length(q);
          float d = (r - 1.0) * r / max(length(vec2(q.x / uR.x, q.y / uR.y)), 1e-4);
          float l = length(vP);
          float stroke = max(1.0 - smoothstep(0.06, 0.10, abs(d)), 1.0 - smoothstep(0.09, 0.13, l));
          float halo = max(1.0 - smoothstep(0.10, 0.18, abs(d)), 1.0 - smoothstep(0.13, 0.21, l)) * 0.3;
          float fill = (1.0 - smoothstep(0.0, 0.05, d)) * 0.12;
          float a = max(max(stroke * 0.95, halo), fill) * uA;
          vec3 c = mix(vec3(0.02, 0.05, 0.08), uCol, step(halo + 0.001, max(stroke * 0.95, fill)));
          gl_FragColor = vec4(c, a); if (a < 0.004) discard;\n${TONE}\n}`,
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat); this.mesh.rotation.x = -Math.PI / 2; this.mesh.position.y = 0.05; this.mesh.renderOrder = 4; this.mesh.frustumCulled = false; this.mesh.visible = false; scene.add(this.mesh);
  }

  update(v: AimView | null, dt: number): void {
    const m = this.mesh;
    if (v) {
      if (!this.shown) { this.shown = true; this.rx = v.rx; this.rz = v.rz; m.position.x = v.x; m.position.z = v.z; this.col.copy(v.inside >= 0.95 ? GREEN : v.inside >= 0.8 ? YELLOW : RED); }
      const k = 1 - Math.exp(-dt * 16);
      m.position.x += (v.x - m.position.x) * k; m.position.z += (v.z - m.position.z) * k; this.rx += (v.rx - this.rx) * k; this.rz += (v.rz - this.rz) * k;
      this.col.lerp(v.inside >= 0.95 ? GREEN : v.inside >= 0.8 ? YELLOW : RED, k);
    } else this.shown = false;
    this.a += ((v ? 1 : 0) - this.a) * (1 - Math.exp(-dt * (v ? 14 : 12)));   // entra rápido, sai em ~0,25 s
    if (this.a < 0.01) { m.visible = false; return; }
    m.visible = true;
    const rx = Math.max(this.rx, 0.2), rz = Math.max(this.rz, 0.2);
    this.u.uR.value.set(rx, rz); this.u.uS.value.set(rx + PAD, rz + PAD); m.scale.set(rx + PAD, rz + PAD, 1); this.u.uCol.value.copy(this.col); this.u.uA.value = this.a;
  }
}
