/** Fix A (stale kills clear) + Fix B (timing = entryState, not quality). Keaton 2026-10-14 09:55 ET. Run: npm test */
import { test } from "node:test";
import assert from "node:assert/strict";
import { register } from "tsx/esm/api";
register();
import RULES from "../shared/desk-rules.json" with { type: "json" };
const mc = await import("../src/lib/smc/mtf-context.ts");
const es = await import("../src/lib/smc/entry-state.ts");
const d = await import("../src/lib/smc/discipline.ts");

const T0 = Date.UTC(2026, 9, 14, 13, 30); // 09:30 ET, 5m-aligned
const bar = (i, c, o = c) => ({ t: T0 + i * 60_000, o, h: Math.max(o, c) + 0.25, l: Math.min(o, c) - 0.25, c, v: 1 });

test("rules: kill.clear and timing ship in shadow; band edges unchanged", () => {
  assert.equal(RULES.kill.clear.mode, "shadow");
  assert.ok(RULES.kill.clear.rungs.includes("1m") && RULES.kill.clear.rungs.includes("4h"));
  assert.equal(RULES.timing.mode, "shadow");
  assert.deepEqual(RULES.bandEdges, { "A+": 0.75, A: 0.68, "A-": 0.65, "B+": 0.6, B: 0.5 });
});

test("MNQ 10/14: bull IFVG vs the short clears once 2m–5m closes sit below its lo (multi-TF)", () => {
  // kill at bar 0; price holds above lo 30568.5 then closes below 30548 for 10 closed minutes
  const m = [];
  for (let i = 0; i < 10; i++) m.push(bar(i, 30580));
  for (let i = 10; i < 21; i++) m.push(bar(i, 30548));
  const kills = [{ side: "short", t: T0, level: 30568.5, why: "5m IFVG bull (1b) against the short" }];
  const r = mc.killClearedOf(m, "short", kills);
  assert.ok(r, "cleared");
  assert.match(r.why, /^killCleared:/);
  assert.match(r.why, /5m/);
});

test("a 5m close back below the lo clears (spec); one of two pieces of evidence still standing does not", () => {
  const m = []; for (let i = 0; i < 9; i++) m.push(bar(i, 30580)); m.push(bar(9, 30548));
  assert.ok(mc.killClearedOf(m, "short", [{ side: "short", t: T0, level: 30568.5, why: "x" }]));
  const m2 = []; for (let i = 0; i < 21; i++) m2.push(bar(i, i < 10 ? 30580 : 30548));
  assert.equal(mc.killClearedOf(m2, "short", [
    { side: "short", t: T0, level: 30568.5, why: "a" },
    { side: "short", t: T0, level: 30540, why: "b" },
  ]), null);
});

test("1m-only tape never clears (needs a ≥2m rung)", () => {
  const m = [bar(0, 30580), bar(1, 30548)];
  assert.equal(mc.killClearedOf(m, "short", [{ side: "short", t: T0, level: 30568.5, why: "x" }]), null);
});

test("entryState: at / near / late / missed and a real-POI re-entry only", () => {
  const base = { side: "long", band: "A", entry: 100, atr15: 10, zone: { top: 101, bottom: 99 }, t1: 130 };
  assert.equal(es.entryStateOf({ ...base, price: 100.5 }).state, "at");
  assert.equal(es.entryStateOf({ ...base, price: 95 }).state, "near");
  assert.equal(es.entryStateOf({ ...base, price: 104 }).state, "near");
  const late = es.entryStateOf({ ...base, price: 108, rows: [
    { tf: "3m", kind: "fvg", dir: "bull", lo: 104, hi: 106, ce: 105, mitigated: false },
    { tf: "5m", kind: "fvg", dir: "bear", lo: 106, hi: 107, ce: 106.5, mitigated: false },
  ] });
  assert.equal(late.state, "late");
  assert.equal(late.reentry.px, 105);
  assert.match(late.label, /^A, late, waiting for retest @ 105/);
  const missed = es.entryStateOf({ ...base, price: 115 });
  assert.equal(missed.state, "missed");
  assert.equal(missed.reentry.px, 101); // retest of the broken zone — no invented level
  const none = es.entryStateOf({ ...base, zone: null, price: 115 });
  assert.equal(none.reentry, null);
  assert.match(none.label, /no real POI/);
});

test("discipline R3 records the chase; shadow still applies it (timing.mode shadow)", () => {
  const c = { side: "long", confluence: 0.8, pathBand: "A+", actionable: true, htfOk: true, gapSide: "long", entryPx: 100, plan: null, reasons: [] };
  const quiet = Array.from({ length: 20 }, (_, i) => ({ t: i * 900_000, o: 100 + i * 6, h: 102 + i * 6, l: 99 + i * 6, c: 101.5 + i * 6, v: 1 }));
  d.applyDiscipline(c, { price: 106, atr15: 10, closed15: quiet, minute: [], nowMs: 1e13, levels: [] });
  assert.equal(c.chase.distAtr, 0.6);
  assert.equal(c.chase.applied, d.TIMING_MODE !== "live");
  if (d.TIMING_MODE !== "live") assert.ok(c.confluence < 0.8);
});
