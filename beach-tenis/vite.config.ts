import { defineConfig, Plugin } from "vite";
import { readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

const VERSION = `${(process.env.GITHUB_SHA || "dev").slice(0, 7)}-${Date.now().toString(36)}`;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => { const p = join(dir, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
}

function pwa(): Plugin {
  let out = "dist";
  return {
    name: "bt-pwa",
    apply: "build",
    configResolved(c) { out = c.build.outDir; },
    closeBundle() {
      const files = walk(out).map((p) => relative(out, p).split("\\").join("/")).filter((f) => f !== "sw.js" && f !== "version.json");
      const list = ["./", ...files.map((f) => "./" + f)];
      writeFileSync(join(out, "version.json"), JSON.stringify({ version: VERSION, time: new Date().toISOString() }));
      writeFileSync(join(out, "sw.js"), `const VERSION=${JSON.stringify(VERSION)};const CACHE="bt-"+VERSION;const FILES=${JSON.stringify(list)};
self.addEventListener("install",e=>{e.waitUntil(caches.open(CACHE).then(async c=>{let n=0;const say=async()=>{for(const x of await self.clients.matchAll({includeUncontrolled:true}))x.postMessage({type:"progress",done:n,total:FILES.length})};await Promise.all(FILES.map(f=>c.add(new Request(f,{cache:"reload"})).then(()=>{n++;say()})))}))});
self.addEventListener("message",e=>{if(e.data&&e.data.type==="SKIP_WAITING")self.skipWaiting()});
self.addEventListener("activate",e=>{e.waitUntil((async()=>{for(const k of await caches.keys())if(k.startsWith("bt-")&&k!==CACHE)await caches.delete(k);await self.clients.claim()})())});
self.addEventListener("fetch",e=>{const r=e.request;if(r.method!=="GET")return;const u=new URL(r.url);if(u.origin!==location.origin||u.pathname.endsWith("/version.json"))return;
e.respondWith((async()=>{const c=await caches.open(CACHE);const hit=await c.match(r,{ignoreSearch:true});if(hit)return hit;if(r.mode==="navigate"){const i=await c.match("./index.html");if(i)return i}try{return await fetch(r)}catch(_){return Response.error()}})())});
`);
    },
  };
}

export default defineConfig({
  base: "./",
  define: { __APP_VERSION__: JSON.stringify(VERSION) },
  plugins: [pwa()],
  build: { target: "es2022", chunkSizeWarningLimit: 900 },
});
