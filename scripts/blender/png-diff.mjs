/**
 * png-diff.mjs - compare two PNGs of the same size (decoded by headless Chromium, no image library needed).
 *
 *   node scripts/blender/png-diff.mjs a.png b.png [--out diff.png] [--thr 12]
 *
 * Prints JSON: size, mean absolute channel difference (0..255), the share of pixels that differ by more than --thr in any
 * channel, and the bounding box of those pixels. --out writes an amplified difference image.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";

const args = process.argv.slice(2);
const [a, b] = args.filter((x) => !x.startsWith("--") && !/^\d+$/.test(x));
const outIdx = args.indexOf("--out");
const out = outIdx >= 0 ? args[outIdx + 1] : null;
const thr = args.includes("--thr") ? Number(args[args.indexOf("--thr") + 1]) : 12;
const b64 = (f) => "data:image/png;base64," + readFileSync(f).toString("base64");

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
// --crop x,y,w,h [--scale 4]: write a side-by-side (a | b) crop to --out and stop
if (args.includes("--crop")) {
  const [cx, cy, cw, ch] = args[args.indexOf("--crop") + 1].split(",").map(Number);
  const sc = args.includes("--scale") ? Number(args[args.indexOf("--scale") + 1]) : 4;
  const url = await page.evaluate(
    async ([ua, ub, cx, cy, cw, ch, sc]) => {
      const load = (u) => new Promise((r, j) => { const i = new Image(); i.onload = () => r(i); i.onerror = j; i.src = u; });
      const [ia, ib] = await Promise.all([load(ua), load(ub)]);
      const c = document.createElement("canvas"); c.width = cw * sc * 2 + 8; c.height = ch * sc;
      const x = c.getContext("2d"); x.imageSmoothingEnabled = false;
      x.drawImage(ia, cx, cy, cw, ch, 0, 0, cw * sc, ch * sc);
      x.drawImage(ib, cx, cy, cw, ch, cw * sc + 8, 0, cw * sc, ch * sc);
      return c.toDataURL("image/png");
    },
    [b64(a), b64(b), cx, cy, cw, ch, sc],
  );
  writeFileSync(out, Buffer.from(url.split(",")[1], "base64"));
  await browser.close();
  console.log(JSON.stringify({ crop: out }));
  process.exit(0);
}
const res = await page.evaluate(
  async ([ua, ub, thr]) => {
    const load = (u) => new Promise((r, j) => { const i = new Image(); i.onload = () => r(i); i.onerror = j; i.src = u; });
    const [ia, ib] = await Promise.all([load(ua), load(ub)]);
    const W = ia.width, H = ia.height;
    if (ib.width !== W || ib.height !== H) return { error: `size ${W}x${H} vs ${ib.width}x${ib.height}` };
    const cv = (img) => { const c = document.createElement("canvas"); c.width = W; c.height = H; const x = c.getContext("2d"); x.drawImage(img, 0, 0); return x.getImageData(0, 0, W, H).data; };
    const da = cv(ia), db = cv(ib);
    let sum = 0, over = 0, x0 = W, y0 = H, x1 = -1, y1 = -1;
    const o = document.createElement("canvas"); o.width = W; o.height = H;
    const ox = o.getContext("2d"); const od = ox.createImageData(W, H);
    for (let i = 0; i < W * H; i++) {
      let m = 0;
      for (let k = 0; k < 3; k++) { const d = Math.abs(da[i * 4 + k] - db[i * 4 + k]); sum += d; if (d > m) m = d; od.data[i * 4 + k] = Math.min(255, d * 8); }
      od.data[i * 4 + 3] = 255;
      if (m > thr) { over++; const px = i % W, py = (i / W) | 0; if (px < x0) x0 = px; if (px > x1) x1 = px; if (py < y0) y0 = py; if (py > y1) y1 = py; }
    }
    ox.putImageData(od, 0, 0);
    return { W, H, meanAbs: +(sum / (W * H * 3)).toFixed(3), overShare: +(over / (W * H)).toFixed(5), over, bbox: over ? [x0, y0, x1, y1] : null, diffPng: o.toDataURL("image/png") };
  },
  [b64(a), b64(b), thr],
);
await browser.close();
if (res.error) { console.log(JSON.stringify(res)); process.exit(2); }
if (out) writeFileSync(out, Buffer.from(res.diffPng.split(",")[1], "base64"));
delete res.diffPng;
console.log(JSON.stringify(res));
