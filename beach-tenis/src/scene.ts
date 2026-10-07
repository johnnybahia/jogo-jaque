import * as THREE from "three";

export const COURT = { wallZ: 11, wallW: 6, wallH: 3 };

function canvasTex(w: number, h: number, draw: (c: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const cv = document.createElement("canvas"); cv.width = w; cv.height = h;
  draw(cv.getContext("2d")!); const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}

export function buildEnvironment(scene: THREE.Scene, base: string): void {
  scene.background = new THREE.Color(0x9fd3f2); scene.fog = new THREE.Fog(0xcfe8f5, 22, 70);
  scene.add(new THREE.HemisphereLight(0xffffff, 0xe0c890, 1.25));
  const sun = new THREE.DirectionalLight(0xfff2d6, 1.9); sun.position.set(-6, 12, -8); scene.add(sun);

  const sand = canvasTex(256, 256, (c) => {
    c.fillStyle = "#e7d3a0"; c.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 5200; i++) { const v = 200 + Math.random() * 40 | 0; c.fillStyle = `rgba(${v},${v - 22},${v - 70},0.35)`; c.fillRect(Math.random() * 256, Math.random() * 256, 1.6, 1.6); }
  });
  sand.wrapS = sand.wrapT = THREE.RepeatWrapping; sand.repeat.set(30, 30);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(120, 120), new THREE.MeshStandardMaterial({ map: sand, roughness: 1 }));
  floor.rotation.x = -Math.PI / 2; scene.add(floor);
  // textura de areia opcional: coloque public/textures/sand.jpg (ladrilhável) e ela substitui a procedural
  fetch(base + "textures/sand.jpg", { method: "HEAD" }).then((r) => {
    if (!r.ok) return;
    new THREE.TextureLoader().load(base + "textures/sand.jpg", (t) => {
      t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(24, 24); t.anisotropy = 4;
      const m = floor.material as THREE.MeshStandardMaterial; m.map = t; m.needsUpdate = true;
    });
  }).catch(() => {});

  const faceTex = canvasTex(512, 256, (c) => {
    c.fillStyle = "#f4f1ea"; c.fillRect(0, 0, 512, 256);
    c.strokeStyle = "#ff6a00"; c.lineWidth = 10; c.strokeRect(5, 5, 502, 246);
    c.strokeStyle = "#1b6fb4"; c.lineWidth = 5; c.beginPath(); c.moveTo(5, 256 - 0.9 / 3 * 256); c.lineTo(507, 256 - 0.9 / 3 * 256); c.stroke();
    c.fillStyle = "#1b6fb4"; c.font = "bold 22px sans-serif"; c.fillText("0,90 m", 14, 256 - 0.9 / 3 * 256 - 8);
  });
  const face = new THREE.Mesh(new THREE.PlaneGeometry(COURT.wallW, COURT.wallH), new THREE.MeshStandardMaterial({ map: faceTex, roughness: 0.9 }));
  face.position.set(0, COURT.wallH / 2, COURT.wallZ - 0.01); face.rotation.y = Math.PI; scene.add(face);
  const body = new THREE.Mesh(new THREE.BoxGeometry(COURT.wallW + 0.3, COURT.wallH + 0.15, 0.4), new THREE.MeshStandardMaterial({ color: 0x8a8f96 }));
  body.position.set(0, (COURT.wallH + 0.15) / 2, COURT.wallZ + 0.2); scene.add(body);

  // linhas de referência na areia (faixa de saque e eixo central)
  const line = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55 });
  const l1 = new THREE.Mesh(new THREE.PlaneGeometry(0.06, COURT.wallZ + 4), line); l1.rotation.x = -Math.PI / 2; l1.position.set(0, 0.005, (COURT.wallZ - 4) / 2); scene.add(l1);
  for (const x of [-4.5, 4.5]) { const l = l1.clone(); l.position.x = x; scene.add(l); }
}

export function blobTexture(): THREE.CanvasTexture {
  return canvasTex(64, 64, (c) => { const g = c.createRadialGradient(32, 32, 2, 32, 32, 30); g.addColorStop(0, "rgba(0,0,0,0.55)"); g.addColorStop(1, "rgba(0,0,0,0)"); c.fillStyle = g; c.fillRect(0, 0, 64, 64); });
}
