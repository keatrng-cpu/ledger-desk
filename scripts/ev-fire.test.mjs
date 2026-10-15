import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { register } from "tsx/esm/api";
register();
const RULES = JSON.parse(readFileSync(new URL("../shared/desk-rules.json", import.meta.url)));
const CAL = JSON.parse(readFileSync(new URL("../shared/ev-calibration.json", import.meta.url)));
const ev = await import("../src/lib/desk/ev-fire.ts");
const cal = await import("./ev-calibrate.mjs");
const CASES = [[0.47, 6, true], [0.6499, 0, false], [0.52, 5, true], [0.9, 9, true], [0.45, 0, true]];
test("evFire is OFF by default; every sub-flag off; band edges and caps unchanged", () => {
  assert.equal(RULES.evFire.mode, "off");
  for (const k of ["ltfSoft", "qRawOnce", "dropCrossedStop"]) assert.equal(RULES.evFire[k].mode, "off");
  assert.equal(RULES.evFire.fullUsd, 650); assert.equal(RULES.evFire.probeUsd, 325);
  assert.equal(RULES.timing.mode, "shadow");
});
test("calibration table hash is pinned and recomputes", () => {
  assert.equal(cal.tableHash(CAL), CAL.hash); assert.equal(CAL.hash, RULES.evFire.calibration.tableHash); assert.ok(CAL.trained);
  assert.equal(ev.pOf(0.6, 6, true, { ...CAL, trained: false }), null);
  assert.equal(ev.pOf(0.6, 6, true, CAL, "deadbeef"), null);
});
test("EV math: RR cap 4, cost floor 0.10", () => {
  assert.equal(ev.evR(0.5, 2), +(0.5 * 2 - 0.5 - 0.1).toFixed(6));
  assert.equal(ev.evR(0.3, 34), ev.evR(0.3, 4));
  assert.equal(ev.evR(0.5, 2, 0.05), ev.evR(0.5, 2));
  assert.equal(ev.sizeUsd("B"), 325); assert.equal(ev.sizeUsd("B+"), 650); assert.equal(ev.sizeUsd("A+"), 650);
});
test("stop crossed / ltfSoft cap", () => {
  assert.equal(ev.stopCrossed("short", 29800, 29798.31), true); assert.equal(ev.stopCrossed("short", 29760, 29798.31), false);
  assert.equal(ev.stopCrossed("long", 6689, 6690), true);
  assert.equal(ev.ltfSoftCap(0.59), "B"); assert.equal(ev.ltfSoftCap(0.6), null); assert.equal(ev.ltfSoftCap(null), "B");
});
test("golden: today's 08:30 / 08:40 / 08:55 (CT) MNQ shorts", () => {
  const g = (q, band, entry, stop, t1, rungs, htfOk) => ev.evCard({ q, band, side: "short", entry, stop, t1, rungs, htfOk });
  const a = g(0.6499, "B+", 29771.13, 29798.31, 29703.25, 0, true);
  assert.equal(a.would, false);   // calibrated p ≈ 0.14 → EV < 0 (the design's +1.02R fire does not survive calibration)
  const b = g(0.6699, "A-", 29999.75, 30039.0, 29869.125, 0, true);
  assert.equal(b.sizeUsd, 650);   // EV may pass; the watcher's fast:entry (180 pt vs 28 pt limit) refuses it
  const c = g(0.4999, "C", 29717.75, 29760.5, 29357.75, 0, true);
  assert.equal(c.sizeUsd, 325);
});
test("watcher (Python) evfire matches the TS p/EV within 1e-6", () => {
  const dir = [process.env.WATCHER_DIR, "/workspace/dw-evfire"].filter(Boolean).find((d) => existsSync(`${d}/watcher/evfire.py`));
  if (!dir) return;
  const py = `import json,sys\nsys.path.insert(0, ${JSON.stringify(dir)})\nfrom watcher import evfire as e\nout=[]\nfor q,r,h in json.loads(${JSON.stringify(JSON.stringify(CASES))}):\n  p=e.p_of(q,r,h); out.append([p, e.ev_r(p,2.5), e.ev_r(p,8.4)])\nprint(json.dumps(out))`;
  const r = JSON.parse(execFileSync("python3", ["-c", py]).toString());
  CASES.forEach(([q, rg, h], i) => {
    const p = ev.pOf(q, rg, h);
    assert.ok(Math.abs(p - r[i][0]) < 1e-6); assert.ok(Math.abs(ev.evR(p, 2.5) - r[i][1]) < 1e-6); assert.ok(Math.abs(ev.evR(p, 8.4) - r[i][2]) < 1e-6);
  });
});
