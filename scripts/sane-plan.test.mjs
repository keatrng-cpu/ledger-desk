import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "tsx/esm/api";
register();
const ex = await import("../src/lib/smc/exec-context.ts");
const card = JSON.parse(readFileSync(new URL("./fixtures/card-2026-10-13-1233ct-mnq-short-fake-rr.json", import.meta.url)));
const s = card.wire.strategy;
const levels = card.wire.draws.map((d) => d.price);
test("fixture: 12:33 CT MNQ short showed a 3.6pt stop vs ATR 45.9 and rr 13.12", () => {
  assert.equal(s.entry, 30735.13); assert.equal(s.stopPx, 30738.75); assert.equal(s.rr, 13.12); assert.ok(s.atr > 45);
});
test("rule 1: stop widened to the real swing ≥ 0.5×ATR; R:R recomputed (no 13.12)", () => {
  // 3m/5m swing highs above entry on that tape: 30738.75 (too close), 30771 (real LH)
  const r = ex.sanePlan({ side: "short", entry: s.entry, stop: s.stopPx, t1: s.target, t2: s.t2 }, s.atr, [30738.75, 30771], levels);
  assert.equal(r.widened, true); assert.equal(r.stop, 30771.25);
  assert.ok(r.riskPts >= 0.5 * s.atr);
  assert.equal(r.rr1, 1.32); assert.ok(r.ok); assert.equal(r.flagged, false);
});
test("rule 1: no swing far enough → the 0.5×ATR floor", () => {
  const r = ex.sanePlan({ side: "short", entry: s.entry, stop: s.stopPx, t1: s.target, t2: s.t2 }, s.atr, [30738.75], levels);
  assert.equal(r.stop, +(s.entry + 0.5 * s.atr).toFixed(2));
});
test("rule 2: rr < 1 after widening, or an unreal T1 → watch row", () => {
  const r = ex.sanePlan({ side: "short", entry: s.entry, stop: s.stopPx, t1: 30720, t2: null }, s.atr, [30771], [...levels, 30720]);
  assert.equal(r.ok, false); assert.match(r.why, /< 1\.0/);
  const r2 = ex.sanePlan({ side: "short", entry: s.entry, stop: 30771.25, t1: 30600.5, t2: null }, s.atr, [], levels);
  assert.equal(r2.ok, false); assert.match(r2.why, /not a real ranked level/);
});
test("rule 3: R:R above 6 is flagged and shown capped", () => {
  const r = ex.sanePlan({ side: "short", entry: s.entry, stop: 30758.5, t1: 30591.25, t2: null }, s.atr, [], [...levels, 30591.25]);
  assert.ok(r.ok); assert.equal(r.flagged, true); assert.equal(r.rrShown, 6); assert.ok(r.rr1 > 6);
});
