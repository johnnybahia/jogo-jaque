// Ferramenta de GLB para o pipeline de ativos (fora do build do jogo).
//   raw  <entrada.glb> <saida.glb>   decodifica meshopt e desquantiza: o Blender (tools/slim_racket.py) lê o resultado
//   pack <entrada.glb> <saida.glb>   comprime com meshopt + quantização (o formato que o jogo carrega com MeshoptDecoder)
// Dependências (não entram no package.json do jogo):
//   mkdir /tmp/gt && cd /tmp/gt && npm i @gltf-transform/core @gltf-transform/extensions @gltf-transform/functions meshoptimizer
//   NODE_PATH=/tmp/gt/node_modules node --input-type=module tools/glb_tool.mjs raw public/models/racket.glb /tmp/racket_raw.glb
// Raquete leve:  raw → python3 tools/slim_racket.py /tmp/racket_raw.glb /tmp/out 8000 1024 → pack /tmp/out/racket_slim.glb public/models/racket.glb
import { createRequire } from "module";
const require = createRequire(process.env.NODE_PATH ? process.env.NODE_PATH + "/" : process.cwd() + "/");
const { NodeIO } = require("@gltf-transform/core");
const { ALL_EXTENSIONS } = require("@gltf-transform/extensions");
const { dequantize, meshopt, prune, dedup } = require("@gltf-transform/functions");
const { MeshoptDecoder, MeshoptEncoder } = require("meshoptimizer");

const [mode, src, dst] = process.argv.slice(2);
if (!["raw", "pack"].includes(mode) || !src || !dst) { console.error("uso: glb_tool.mjs raw|pack <entrada.glb> <saida.glb>"); process.exit(1); }
await MeshoptDecoder.ready; await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "meshopt.decoder": MeshoptDecoder, "meshopt.encoder": MeshoptEncoder });
const doc = await io.read(src);
if (mode === "raw") {
  await doc.transform(dequantize());
  for (const e of doc.getRoot().listExtensionsUsed()) e.dispose();
} else {
  await doc.transform(prune(), dedup(), meshopt({ encoder: MeshoptEncoder, level: "high" }));
}
await io.write(dst, doc);
console.log("ok", dst);
