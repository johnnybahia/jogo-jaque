import * as THREE from "three";

/** Luz de contorno das atletas (as bordas voltadas para o sol brilham quando ele está atrás delas, como no contra-luz do entardecer): um termo de Fresnel somado antes da saída do material.
 *  Os uniformes são compartilhados; a `Atmosphere` atualiza direção (em espaço da câmera), cor e força a cada quadro. */
export const rim = { dir: { value: new THREE.Vector3(0, 0.3, -1) }, color: { value: new THREE.Color(1, 0.7, 0.45) }, k: { value: 0 } };

export function addRim(mat: THREE.Material): void {
  const m = mat as THREE.MeshStandardMaterial; if (!m.isMeshStandardMaterial) return;
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (sh, r) => {
    prev?.(sh, r);
    sh.uniforms.uRimDir = rim.dir; sh.uniforms.uRimColor = rim.color; sh.uniforms.uRimK = rim.k;
    sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\nuniform vec3 uRimDir; uniform vec3 uRimColor; uniform float uRimK;")
      .replace("#include <opaque_fragment>", `
        { vec3 Vv = normalize(vViewPosition); float fr = pow(1.0 - clamp(dot(normal, Vv), 0.0, 1.0), 3.0);
          float lit = smoothstep(-0.15, 0.55, dot(normal, uRimDir)); float back = smoothstep(0.0, 0.65, -dot(uRimDir, Vv));
          outgoingLight += uRimColor * (fr * lit * back * uRimK); }
        #include <opaque_fragment>`);
  };
  m.customProgramCacheKey = () => "rim";
}
