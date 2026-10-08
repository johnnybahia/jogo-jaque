// Extrai da Jaqueline (com o jogo rodando em http://127.0.0.1:5181/) o atlas de cor original (base.png) e o mapa de grupos do corpo por ilha da textura (groups.png:
// valor do pixel = 30 × grupo; 1 cabeça, 2 pescoço, 3 tronco, 4 braço, 5 quadril, 6 perna, 7 outro). Uso: node extract.mjs <pasta_de_saida> [url]; depois make_looks.py.
// O mapa vem dos ossos que dominam cada triângulo da malha (pesos de pele) pintados no espaço UV.
import { createRequire } from "module"; import fs from "fs";
const require = createRequire("/node-tools/node_modules/"); const { chromium } = require("playwright");
const out = process.argv[2] || "."; const url = process.argv[3] || "http://127.0.0.1:5181/";
const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox"] });
const page = await (await browser.newContext({ viewport: { width: 420, height: 640 } })).newPage();
await page.goto(url, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => window.__game && !document.getElementById("loading"), null, { timeout: 120000 });
const r = await page.evaluate(() => {
  const g = window.__game; let mesh; g.rig.model.traverse((o) => { if (o.isSkinnedMesh) mesh = o; });
  const im = mesh.material.map.image, W = im.width, c0 = document.createElement("canvas"); c0.width = W; c0.height = im.height; c0.getContext("2d").drawImage(im, 0, 0);
  const geo = mesh.geometry, uv = geo.attributes.uv, si = geo.attributes.skinIndex, sw = geo.attributes.skinWeight, idx = geo.index.array, bones = mesh.skeleton.bones.map((b) => b.name);
  const grp = (n) => /Neck/.test(n) ? 2 : /Head/.test(n) ? 1 : /Spine|Shoulder/.test(n) ? 3 : /Arm|Hand|Thumb|Index|Middle|Ring|Pinky/.test(n) ? 4 : /Hips/.test(n) ? 5 : /Leg|Foot|Toe/.test(n) ? 6 : 7;
  const vg = new Uint8Array(geo.attributes.position.count);
  for (let i = 0; i < vg.length; i++) { const w = [0, 0, 0, 0, 0, 0, 0, 0]; for (let k = 0; k < 4; k++) w[grp(bones[si.getComponent(i, k)])] += sw.getComponent(i, k); let b = 7; for (let k = 1; k <= 7; k++) if (w[k] > w[b]) b = k; vg[i] = b; }
  const c = document.createElement("canvas"); c.width = W; c.height = W; const x = c.getContext("2d"); x.fillStyle = "#000"; x.fillRect(0, 0, W, W);
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t], b = idx[t + 1], d = idx[t + 2]; const m = vg[b] === vg[d] ? vg[b] : vg[a], col = `rgb(${m * 30},${m * 30},${m * 30})`;
    x.fillStyle = col; x.strokeStyle = col; x.lineWidth = 1.5; x.beginPath(); x.moveTo(uv.getX(a) * W, uv.getY(a) * W); x.lineTo(uv.getX(b) * W, uv.getY(b) * W); x.lineTo(uv.getX(d) * W, uv.getY(d) * W); x.closePath(); x.fill(); x.stroke();
  }
  return { base: c0.toDataURL("image/png"), groups: c.toDataURL("image/png") };
});
fs.mkdirSync(out, { recursive: true });
for (const k of ["base", "groups"]) fs.writeFileSync(`${out}/${k}.png`, Buffer.from(r[k].split(",")[1], "base64"));
console.log("ok", out); await browser.close();
