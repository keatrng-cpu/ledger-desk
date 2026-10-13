import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "tsx/esm/api";
register();
const RULES = JSON.parse(readFileSync(new URL("../shared/desk-rules.json", import.meta.url)));
test("fast wire: shadow line for a fresh failed spike; stale feed shows nothing", async () => {
  const { fastWire } = await import("../src/lib/desk/fast.ts");
  const now = 2_000_000_000_000;
  const sp = { symbol: "ES", t: now / 1000 - 20, dir: "up", tag: "failed", moveAtr: 0.42, ext: 7860, atExtreme: true, fast: { kill: "long", arm: "short" } };
  const w = fastWire({ at: now / 1000 - 3, spikes: [sp], bars15s: { ES: [] } }, now);
  assert.equal(w.shadow, RULES.fast.shadow); assert.match(w.floorLine, /failed push.*kill the long.*shadow/);
  const st = fastWire({ at: now / 1000 - 999, spikes: [sp] }, now);
  assert.equal(st.fresh, false); assert.equal(st.floorLine, null); assert.deepEqual(st.spikes, []); // stale feed: no spikes
});
test("displacement shadow fields never change the graded score", async () => {
  const ex = await import("../src/lib/smc/exec-context.ts");
  const t0 = Date.UTC(2026, 9, 13, 14, 0); const m = [];
  for (let i = 0; i < 120; i++) { const o = 100 + (i > 100 ? (i - 100) * 2 : 0); m.push({ t: t0 + i * 60_000, o, h: o + 2.2, l: o - 0.2, c: o + 2, v: i > 100 ? 900 : 100 }); }
  const d = ex.displacementStrength(m, "long");
  assert.ok(d); assert.ok(d.shadowScore != null); assert.ok(d.volBurst == null || d.volBurst > 0);
  const base = +(0.5 * Math.min(d.bodyAtr / 2, 1) + (d.leftFvg ? 0.25 : 0) + (d.closeFrac >= 0.75 ? 0.25 : 0)).toFixed(2);
  assert.equal(d.score, base);
  assert.equal(RULES.fast.shadow, true);
});
