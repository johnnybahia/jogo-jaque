import * as THREE from "three";

/** visuais das outras atletas: a mesma Jaqueline com o atlas de cor recolorido (tools/looks/make_looks.py) */
export interface Look { id: string; name: string; file: string; }
export const LOOKS: Record<string, Look> = {
  lari: { id: "lari", name: "Lari", file: "textures/look_lari.jpg" },   // loira, camiseta coral, saia e viseira grafite
  bia: { id: "bia", name: "Bia", file: "textures/look_bia.jpg" },       // cabelo preto, camiseta rosa, saia e viseira roxas
  duda: { id: "duda", name: "Duda", file: "textures/look_duda.jpg" },   // cabelo preto, camiseta verde-limão, saia e viseira verde-floresta
};

/** carrega os atlas recoloridos (no mesmo formato do atlas do GLB: sem inverter o V, sRGB); o que não carregar fica de fora e a atleta usa o visual da Jaqueline */
export async function loadLooks(base: string): Promise<Map<string, THREE.Texture>> {
  const loader = new THREE.TextureLoader(), out = new Map<string, THREE.Texture>();
  await Promise.all(Object.values(LOOKS).map(async (l) => {
    try { const t = await loader.loadAsync(base + l.file); t.flipY = false; t.colorSpace = THREE.SRGBColorSpace; out.set(l.id, t); } catch { /* sem a textura: fica o visual original */ }
  }));
  return out;
}

/** troca o atlas de cor do modelo por `tex`; o material é clonado (o da Jaqueline e o das outras ficam intactos) */
export function applyLook(model: THREE.Object3D, tex: THREE.Texture | undefined): void {
  if (!tex) return;
  model.traverse((o) => {
    const m = o as THREE.SkinnedMesh; if (!m.isSkinnedMesh) return;
    const mat = (m.material as THREE.MeshStandardMaterial).clone(); mat.map = tex; mat.needsUpdate = true; m.material = mat;
  });
}
