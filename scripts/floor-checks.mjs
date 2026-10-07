/**
 * Browser checks for the 3D Floor, against a RUNNING dev server (it needs a real WebGL page, so it is deliberately not a
 * `verify-*` script: those run offline in verify-all).
 *
 *   npx vite dev --port 8123          # in another terminal (a dev build exposes window.__floor)
 *   node scripts/floor-checks.mjs [--url http://localhost:8123] [--shots]
 *
 * It opens the Floor tab in headless Chromium (software GL: it records COUNTS, never frame rate) and checks the things that
 * were reported broken on 2026-10-07 and fixed:
 *   walking     walk mode starts only when asked; any camera choice, follow, fly-to or Esc ends it; a click in the canvas
 *               does not teleport the camera; a key starts it; held keys are cleared;
 *   director    the close-up keeps the speaker's head AND the whole speech bubble inside the frame, standing and seated,
 *               at several window shapes;
 *   z-fighting  no pair of big flat surfaces shares a height and footprint without one of them winning by depth offset, and no
 *               flat transparent decal writes depth;
 *   budget      draw calls, triangles, textures, shader programs and shadow casters, written to .cache/floor-shots/baseline.json
 *               (compared with the previous run: more than 15% worse is a failure).
 * With --shots it also saves a PNG per camera preset to .cache/floor-shots/ for a look.
 * Presentation only; nothing here touches the desk.
 */
import { chromium } from "playwright";
import { mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const arg = (k, d) => {
  const i = process.argv.indexOf(k);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : d;
};
const URL_ = arg("--url", "http://localhost:8123");
const SHOTS = process.argv.includes("--shots");
const OUT = join(process.cwd(), ".cache", "floor-shots");
mkdirSync(OUT, { recursive: true });

let pass = 0;
let fail = 0;
const check = (name, ok, detail = "") => {
  if (ok) pass++;
  else fail++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : ` — ${detail}`}`);
};

const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e).slice(0, 160)));
await page.goto(URL_, { waitUntil: "domcontentloaded" });
await page.getByRole("button", { name: "Floor", exact: true }).first().waitFor({ timeout: 60_000 });
await page.getByRole("button", { name: "Floor", exact: true }).first().click();
await page.waitForFunction(() => Boolean(window.__floor && window.__floor.officeRoot), null, { timeout: 90_000 });
await page.waitForTimeout(2500); // the coplanar pass runs 1.5 s after the office loads

console.log("walking");
const walk = await page.evaluate(() => {
  const f = window.__floor;
  const key = (k) => f.onKey({ key: k, preventDefault() {}, target: document.body, ctrlKey: false, metaKey: false, altKey: false });
  const st = () => ({ walk: f.isWalkMode(), chase: f.ownerChase, focused: f.focused, w: f.keys.w });
  const r = { start: st() };
  f.setFocused(true);
  r.clickInCanvas = st();
  f.engageOwner();
  r.engaged = { ...st(), blend: !!f.walkBlend };
  f.setCamera("auto");
  r.director = { ...st(), preset: f.preset };
  f.setFocused(true);
  r.clickAfter = st();
  f.setFocused(false);
  f.setFocused(true);
  key("w");
  r.keyW = st();
  f.setCamera("lounge");
  r.preset = st();
  f.setFocused(true);
  key("w");
  f.follow("Gemma");
  r.follow = st();
  f.follow(null);
  f.setFocused(true);
  key("w");
  key("Escape");
  r.esc = st();
  f.engageOwner();
  f.focusScreen("whiteboard");
  r.flyTo = st();
  f.setFocused(false);
  return r;
});
check("walking is off until asked", !walk.start.walk && !walk.start.chase);
check("a click in the canvas does not start it or move the camera", !walk.clickInCanvas.walk && !walk.clickInCanvas.chase);
check("the Walk button starts it, with a glide", walk.engaged.walk && walk.engaged.chase && walk.engaged.blend);
check("choosing the Director while walking ends the walk", !walk.director.walk && !walk.director.chase && walk.director.preset === "auto");
check("the next click does not phase the camera back to the owner", !walk.clickAfter.walk && !walk.clickAfter.chase);
check("W starts it (focused)", walk.keyW.walk && walk.keyW.chase && walk.keyW.w);
check("any camera preset ends it and clears the held key", !walk.preset.walk && !walk.preset.chase && !walk.preset.w);
check("following a person ends it", !walk.follow.walk && !walk.follow.chase);
check("Esc ends it and clears the keys", !walk.esc.walk && !walk.esc.chase && !walk.esc.w && !walk.esc.focused);
check("flying to a screen ends it", !walk.flyTo.walk && !walk.flyTo.chase);

console.log("director framing (head and the whole speech bubble inside the frame)");
for (const [w, h] of [
  [1500, 900],
  [1100, 900],
  [800, 900],
]) {
  await page.setViewportSize({ width: w, height: h });
  await page.waitForTimeout(700);
  const rows = await page.evaluate(() => {
    const f = window.__floor;
    const cam = f.camera;
    const V = cam.position.constructor;
    const out = [];
    const keepPos = cam.position.clone();
    const keepTarget = f.controls.target.clone();
    for (const who of ["Gemma", "Jax", "Nova", "Sterling", "Vince"]) {
      const a = f.avatars.get(who);
      const keepMode = a.mode;
      for (const mode of new Set([keepMode, "stand"])) {
        a.mode = mode;
        for (const side of [1, -1]) {
          const shot = f.closeShot(a, side);
          if (!shot) {
            out.push({ who, mode, side, wide: true });
            continue;
          }
          cam.position.set(...shot.pos);
          f.controls.target.set(...shot.target);
          cam.lookAt(...shot.target);
          cam.updateMatrixWorld(true);
          a.viewDist = cam.position.distanceTo(a.root.position);
          a.speaking = true;
          a.update(0.016, f.time);
          a.root.updateMatrixWorld(true);
          const right = new V().setFromMatrixColumn(cam.matrixWorld, 0).normalize();
          const b = a.bubble.getWorldPosition(new V());
          const sw = a.bubble.scale.x / 2;
          const sh = a.bubble.scale.y;
          const headY = mode === "stand" ? 1.55 : 1.2;
          const pts = [
            ["head", new V(a.root.position.x, headY, a.root.position.z)],
            ["bubbleBottomLeft", b.clone().addScaledVector(right, -sw)],
            ["bubbleBottomRight", b.clone().addScaledVector(right, sw)],
            ["bubbleTopLeft", b.clone().add(new V(0, sh, 0)).addScaledVector(right, -sw)],
            ["bubbleTopRight", b.clone().add(new V(0, sh, 0)).addScaledVector(right, sw)],
          ];
          const outside = pts.filter(([, p]) => {
            const v = p.clone().project(cam);
            return !(Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1 && v.z < 1);
          }).map(([n]) => n);
          out.push({ who, mode, side, dist: +a.viewDist.toFixed(2), outside });
          a.speaking = false;
        }
      }
      a.mode = keepMode;
    }
    cam.position.copy(keepPos);
    f.controls.target.copy(keepTarget);
    return { aspect: +cam.aspect.toFixed(2), out };
  });
  const shots = rows.out.filter((r) => !r.wide);
  const bad = shots.filter((r) => r.outside.length);
  check(`${w}x${h} (aspect ${rows.aspect}): ${shots.length} close-ups (${rows.out.length - shots.length} fell back to a wide shot), head and the whole bubble inside the frame in all`, shots.length >= 6 && bad.length === 0, JSON.stringify(bad.slice(0, 3)));
}
await page.setViewportSize({ width: 1500, height: 900 });
await page.waitForTimeout(500);

console.log("z-fighting");
const zf = await page.evaluate(() => {
  const f = window.__floor;
  const V = f.camera.position.constructor;
  const boxes = [];
  f.scene.updateMatrixWorld(true);
  f.scene.traverse((o) => {
    if (!o.isMesh || !o.visible) return;
    const g = o.geometry;
    if (!g.boundingBox) g.computeBoundingBox();
    const bb = g.boundingBox;
    const xs = [];
    const ys = [];
    const zs = [];
    for (const x of [bb.min.x, bb.max.x]) for (const y of [bb.min.y, bb.max.y]) for (const z of [bb.min.z, bb.max.z]) {
      const p = new V(x, y, z).applyMatrix4(o.matrixWorld);
      xs.push(p.x);
      ys.push(p.y);
      zs.push(p.z);
    }
    const b = { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys), z0: Math.min(...zs), z1: Math.max(...zs) };
    if (b.y1 - b.y0 < 0.03 && b.x1 - b.x0 > 1.5 && b.z1 - b.z0 > 1.5) {
      const m = Array.isArray(o.material) ? o.material[0] : o.material;
      boxes.push({ name: o.name || o.parent?.name || "?", y: (b.y0 + b.y1) / 2, ...b, area: (b.x1 - b.x0) * (b.z1 - b.z0), po: m.polygonOffset ? m.polygonOffsetUnits : 0, dw: m.depthWrite, t: m.transparent });
    }
  });
  const bad = [];
  let pairs = 0;
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i];
      const b = boxes[j];
      if (Math.abs(a.y - b.y) > 0.012) continue;
      const ox = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
      const oz = Math.min(a.z1, b.z1) - Math.max(a.z0, b.z0);
      if (ox <= 0.5 || oz <= 0.5) continue;
      pairs++;
      const small = a.area <= b.area ? a : b;
      const big = a.area <= b.area ? b : a;
      if (!(small.po < big.po) && Math.abs(a.y - b.y) <= 0.004) bad.push(`${small.name} vs ${big.name}`);
      if (a.t && b.t && (a.dw || b.dw)) bad.push(`${a.name}+${b.name} transparent and writing depth`);
    }
  return { pairs, bad: bad.slice(0, 6) };
});
check("every same-height overlap has a winner, and no flat decal writes depth", zf.bad.length === 0, JSON.stringify(zf.bad));

console.log("budget (counts, not speed)");
const info = await page.evaluate(async () => {
  const f = window.__floor;
  // The counts depend on where the camera looks: always measure from the overview, once it has settled.
  f.setCamera("overview");
  await new Promise((r) => setTimeout(r, 3500));
  const i = f.renderer.info;
  let casters = 0;
  f.scene.traverse((o) => {
    if (o.isMesh && o.castShadow) casters++;
  });
  return { calls: i.render.calls, triangles: i.render.triangles, textures: i.memory.textures, geometries: i.memory.geometries, programs: i.programs?.length ?? 0, shadowCasters: casters };
});
console.log(`      ${JSON.stringify(info)}`);
const basePath = join(OUT, "baseline.json");
const prev = existsSync(basePath) ? JSON.parse(readFileSync(basePath, "utf8")) : null;
if (prev) {
  for (const k of ["calls", "triangles", "textures", "shadowCasters"]) {
    check(`${k} not more than 15% above the last run (${prev[k]} → ${info[k]})`, info[k] <= prev[k] * 1.15 + 5, `${prev[k]} → ${info[k]}`);
  }
}
if (!prev || process.argv.includes("--rebase")) {
  writeFileSync(basePath, JSON.stringify(info, null, 2));
  console.log(`      baseline ${prev ? "replaced" : "written"}: ${basePath}`);
}

if (SHOTS) {
  console.log("screenshots");
  for (const p of ["overview", "board", "quant", "offices", "lounge", "rnd", "ops", "goal", "invest", "boardroom"]) {
    await page.evaluate((p) => window.__floor.setCamera(p), p);
    await page.waitForTimeout(2600);
    // The Floor's own canvas (the page has other canvases, some hidden): scroll it into view and clip to it.
    const rect = await page.evaluate(() => {
      const c = window.__floor.renderer.domElement;
      c.scrollIntoView({ block: "center" });
      const b = c.getBoundingClientRect();
      return { x: Math.max(0, b.x), y: Math.max(0, b.y), width: Math.min(b.width, innerWidth), height: Math.min(b.height, innerHeight) };
    });
    await page.waitForTimeout(300);
    await page.screenshot({ path: join(OUT, `${p}.png`), clip: rect });
  }
  console.log(`      saved to ${OUT}`);
}

check("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
await browser.close();
console.log(`\nfloor-checks: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
