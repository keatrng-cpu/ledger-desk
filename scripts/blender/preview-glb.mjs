/**
 * preview-glb.mjs - load a .glb with a PLAIN three.js GLTFLoader in headless Chromium, light it the way the
 * Floor does (hemisphere + sun + warm point lamps, ACES, PCF shadows) and save PNGs.
 *
 *   node scripts/blender/preview-glb.mjs --glb public/floor/office.glb --out <dir> [--shots overview,front] [--size 1280x720]
 *        [--cam name=px,py,pz:tx,ty,tz]...   extra cameras (three axes, metres)
 *        [--novc]        strip COLOR_0 first (A/B for baked occlusion)
 *        [--open-doors]  slide every node with extras.slide_axis to its open position
 *        [--decoders]    force-register Draco + Meshopt decoders (always registered; kept for clarity)
 *
 * Prints one JSON line: load time, errors, node/mesh/triangle counts, how many meshes carry vertex colours,
 * door nodes with their extras, and the PNG paths. Presentation tooling only: it reads the repo, it writes outside it.
 */
import { createServer } from "node:http";
import { readFileSync, mkdirSync, existsSync, statSync } from "node:fs";
import { resolve, extname, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..");
const args = process.argv.slice(2);
const opt = (k, d = null) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const flag = (k) => args.includes(k);
const multi = (k) => args.flatMap((a, i) => (a === k ? [args[i + 1]] : []));

const glbPath = resolve(opt("--glb", join(REPO, "public/floor/office.glb")));
const outDir = resolve(opt("--out", join(REPO, ".cache", "floor-preview")));
const [W, H] = (opt("--size", "1280x720") || "1280x720").split("x").map(Number);
const layout = JSON.parse(readFileSync(join(REPO, "src/data/floor-layout.json"), "utf8"));
const presets = layout.camera;
const wanted = (opt("--shots", "overview") || "overview").split(",").filter(Boolean);
const cams = {};
for (const n of wanted) if (presets[n]) cams[n] = presets[n];
for (const spec of multi("--cam")) {
  const [name, rest] = spec.split("=");
  const [p, t] = rest.split(":");
  cams[name] = { pos: p.split(",").map(Number), target: t.split(",").map(Number) };
}
mkdirSync(outDir, { recursive: true });

const MIME = { ".js": "text/javascript", ".mjs": "text/javascript", ".wasm": "application/wasm", ".glb": "model/gltf-binary", ".html": "text/html", ".json": "application/json" };
const page = `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:#0b1220}canvas{display:block}</style>
<script type="importmap">{"imports":{"three":"/three/build/three.module.js","three/addons/":"/three/examples/jsm/"}}</script></head><body>
<script type="module">
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
const W = ${W}, H = ${H};
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setSize(W, H); renderer.setPixelRatio(1);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene(); scene.background = new THREE.Color("#0b1220");
const camera = new THREE.PerspectiveCamera(42, W / H, 0.1, 200);
scene.add(new THREE.HemisphereLight(0xe0ecff, 0x2a2a33, 0.95));
const sun = new THREE.DirectionalLight(0xffffff, 1.7); sun.position.set(10, 22, 12); sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048); Object.assign(sun.shadow.camera, { left: -18, right: 18, top: 14, bottom: -14, near: 2, far: 48 });
sun.shadow.bias = -0.001; sun.shadow.normalBias = 0.12; sun.shadow.camera.updateProjectionMatrix();
sun.target.position.set(-2, 0, -1); scene.add(sun, sun.target);
for (const [x, z] of [[-7, -1], [8, -4], [-6.5, -7.5], [-8.5, 5.5]]) { const l = new THREE.PointLight(0xffe2b8, 9, 11, 1.6); l.position.set(x, 3.2, z); scene.add(l); }
const draco = new DRACOLoader(); draco.setDecoderPath("/three/examples/jsm/libs/draco/gltf/");
const loader = new GLTFLoader(); loader.setDRACOLoader(draco); loader.setMeshoptDecoder(MeshoptDecoder);
const info = { errors: [], doors: [] };
window.__info = info;
window.__ready = (async () => {
  const t0 = performance.now();
  const gltf = await loader.loadAsync("/model.glb");
  info.loadMs = Math.round(performance.now() - t0);
  const root = gltf.scene; let tris = 0, meshes = 0, vc = 0, morphs = 0, nodes = 0; const mats = new Set(); const textures = new Set();
  root.traverse((o) => {
    nodes++;
    if (o.userData && o.userData.slide_axis) info.doors.push({ name: o.name, pos: o.position.toArray().map((v) => +v.toFixed(3)), extras: o.userData });
    if (!o.isMesh) return;
    meshes++;
    const g = o.geometry; tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
    if (g.attributes.color) vc++;
    if (o.morphTargetInfluences) morphs++;
    if (${flag("--novc") ? "true" : "false"} && g.attributes.color) { g.deleteAttribute("color"); }
    const list = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of list) {
      mats.add(m.uuid); if (m.map) textures.add(m.map.uuid);
      if (${flag("--novc") ? "true" : "false"}) m.vertexColors = false, m.needsUpdate = true;
      const blob = (o.name + " " + (m.name || "")).toLowerCase();
      if (/glass|lens|window/.test(blob) || m.transparent || m.opacity < 0.92) { m.transparent = true; m.depthWrite = false; o.castShadow = false; o.receiveShadow = false; }
      else { o.castShadow = true; o.receiveShadow = true; }
    }
  });
  info.nodes = nodes; info.meshes = meshes; info.triangles = Math.round(tris); info.vertexColorMeshes = vc; info.morphMeshes = morphs; info.materials = mats.size; info.textures = textures.size;
  if (${flag("--open-doors") ? "true" : "false"}) root.traverse((o) => { const e = o.userData; if (e && e.slide_axis) { const a = e.slide_axis, d = e.slide_distance; o.position.x += a[0] * d; o.position.y += a[1] * d; o.position.z += a[2] * d; } });
  scene.add(root);
  window.__root = root;
  return info;
})().catch((e) => { info.errors.push(String(e && e.message || e)); return info; });
window.__shot = (pos, target) => { camera.position.set(...pos); camera.lookAt(...target); renderer.render(scene, camera); };
window.addEventListener("error", (e) => info.errors.push(String(e.message)));
</script></body></html>`;

const server = createServer((req, res) => {
  const url = decodeURIComponent((req.url || "/").split("?")[0]);
  if (url === "/" || url === "/index.html") { res.writeHead(200, { "content-type": "text/html" }); res.end(page); return; }
  let file = null;
  if (url === "/model.glb") file = glbPath;
  else if (url.startsWith("/three/")) file = join(REPO, "node_modules", "three", url.slice(7));
  if (!file || !existsSync(file) || !statSync(file).isFile()) { res.writeHead(404); res.end("nf"); return; }
  res.writeHead(200, { "content-type": MIME[extname(file)] || "application/octet-stream" });
  res.end(readFileSync(file));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = server.address().port;

const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const out = { glb: glbPath, shots: [], errors: [] };
try {
  const pg = await browser.newPage({ viewport: { width: W, height: H } });
  pg.on("console", (m) => { if (m.type() === "error") out.errors.push(m.text()); });
  pg.on("pageerror", (e) => out.errors.push(String(e.message || e)));
  await pg.goto(`http://127.0.0.1:${port}/`, { waitUntil: "load" });
  const info = await pg.evaluate(() => window.__ready);
  Object.assign(out, info);
  const base = glbPath.replace(/^.*[\\/]/, "").replace(/\.glb$/, "");
  for (const [name, c] of Object.entries(cams)) {
    await pg.evaluate(([p, t]) => window.__shot(p, t), [c.pos, c.target]);
    const file = join(outDir, `${base}.${name}${flag("--novc") ? ".novc" : ""}${flag("--open-doors") ? ".open" : ""}.png`);
    await pg.locator("canvas").screenshot({ path: file });
    out.shots.push(file);
  }
} catch (e) {
  out.errors.push(String(e && e.message || e));
} finally {
  await browser.close();
  server.close();
}
console.log(JSON.stringify(out));
process.exit(out.errors.length ? 2 : 0);
