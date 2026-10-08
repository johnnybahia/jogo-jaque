import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";

/** Pós-processamento da qualidade Alta (carregado só quando precisa: import dinâmico): cena em HDR (meio-float, MSAA 4×) → bloom só nos brilhos acima de 1 (disco do sol, reflexo na água, nuvens ao lado do sol, bola)
 *  → grade (tons frios nas sombras e quentes nas luzes, mais forte no pôr do sol; saturação; vinheta) → tone mapping e sRGB (OutputPass). */
const Grade = {
  uniforms: { tDiffuse: { value: null as THREE.Texture | null }, uTone: { value: 0.6 }, uSat: { value: 1.1 }, uVig: { value: 0.32 } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uTone; uniform float uSat; uniform float uVig; varying vec2 vUv;
    void main(){
      vec3 c = texture2D(tDiffuse, vUv).rgb; float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      float w = smoothstep(0.05, 1.2, l);
      c *= mix(mix(vec3(1.0), vec3(0.96, 1.0, 1.04), uTone), mix(vec3(1.0), vec3(1.07, 1.0, 0.9), uTone), w);
      c = mix(vec3(l), c, uSat);
      vec2 q = (vUv - 0.5) * vec2(1.25, 1.0); c *= 1.0 - uVig * smoothstep(0.28, 0.9, length(q));
      gl_FragColor = vec4(c, 1.0);
    }`,
};

export class Post {
  private composer: EffectComposer; private bloom: UnrealBloomPass; private grade: ShaderPass;
  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, w: number, h: number, pr: number) {
    const rt = new THREE.WebGLRenderTarget(w * pr, h * pr, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(renderer, rt); this.composer.setPixelRatio(pr); this.composer.setSize(w, h);
    this.composer.addPass(new RenderPass(scene, camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.34, 0.6, 1.0); this.composer.addPass(this.bloom);
    this.grade = new ShaderPass(Grade); this.composer.addPass(this.grade);
    this.composer.addPass(new OutputPass());
  }
  setSize(w: number, h: number, pr: number): void { this.composer.setPixelRatio(pr); this.composer.setSize(w, h); }
  /** t = hora do dia (0 manhã … 1 pôr do sol): a grade quente/fria pesa mais no fim da tarde */
  update(t: number): void { this.grade.uniforms.uTone.value = 0.45 + 0.55 * t; this.bloom.strength = 0.28 + 0.14 * t; }
  render(dt: number): void { this.composer.render(dt); }
  dispose(): void { this.composer.dispose(); }
}
