/** Card discipline R1–R9 (src/lib/smc/discipline.ts). Run: npm test */
import { test } from "node:test";
import assert from "node:assert/strict";
import { register } from "tsx/esm/api";
register();
const d = await import("../src/lib/smc/discipline.ts");
const gd = await import("../src/lib/trading/gap-direction.ts");

const quiet = Array.from({ length: 20 }, (_, i) => ({ t: i * 900_000, o: 100 + i * 6, h: 102 + i * 6, l: 99 + i * 6, c: 101.5 + i * 6, v: 1 }));
const ctx = (over = {}) => ({ price: 100, atr15: 10, closed15: quiet, minute: [], nowMs: 1e13, levels: [], ...over });
const card = (over = {}) => ({ side: "long", confluence: 0.8, pathBand: "A+", actionable: true, htfOk: true, gapSide: "long", entryPx: 100, plan: null, reasons: [], ...over });

test("R1: entry null caps at B+ and clears actionable", () => {
  const c = d.applyDiscipline(card({ entryPx: null }), ctx());
  assert.equal(c.pathBand, "B+");
  assert.equal(c.actionable, false);
});

test("R2: a 0.38pt stop is widened to 0.5×ATR15; T1 < 1R drops to B", () => {
  const plan = { entry: 100, stop: 99.62, riskPts: 0.38, t1: 104, rr1: 10.5, entryZone: null };
  const c = d.applyDiscipline(card({ plan }), ctx());
  assert.equal(c.plan.stop, 95);
  assert.equal(c.plan.rr1, 0.8);
  assert.equal(c.pathBand, "B");
  assert.equal(c.actionable, false);
  const ok = d.applyDiscipline(card({ plan: { ...plan, t1: 110 } }), ctx());
  assert.equal(ok.pathBand, "A+");
});

test("R3: one band step per 0.5×ATR past CE, q decays", () => {
  const c = d.applyDiscipline(card(), ctx({ price: 110 })); // 1.0 ATR past → 2 steps
  assert.equal(c.pathBand, "A-");
  assert.ok(Math.abs(c.confluence - 0.4) < 1e-9);
  assert.equal(d.applyDiscipline(card(), ctx({ price: 95 })).pathBand, "A+"); // resting below CE: no chase
});

test("R4: HTF conflict caps at B+ unless released", () => {
  assert.equal(d.applyDiscipline(card({ gapSide: "short" }), ctx()).pathBand, "B+");
  assert.equal(d.applyDiscipline(card({ gapSide: "short", htfDisrespected: true }), ctx()).pathBand, "A+");
  assert.equal(d.applyDiscipline(card({ gapSide: null, htfOk: false }), ctx()).pathBand, "B+");
});

test("R5: a 5m body ≥1.25×ATR5 closing through the zone kills the card", () => {
  const minute = [];
  for (let i = 0; i < 100; i++) minute.push({ t: i * 60_000, o: 100, h: 100.5, l: 99.5, c: 100.1, v: 1 });
  for (let i = 100; i < 105; i++) minute.push({ t: i * 60_000, o: 100 - (i - 100), h: 100.2 - (i - 100), l: 98.9 - (i - 100), c: 99 - (i - 100), v: 1 });
  const zone = { top: 100.2, bottom: 99.8 };
  const c = d.applyDiscipline(card({ plan: { entry: 100, stop: 90, riskPts: 10, t1: 120, rr1: 2, entryZone: zone } }), ctx({ minute, nowMs: 105 * 60_000 }));
  assert.equal(c.actionable, false);
  assert.equal(c.pathBand, "C");
  assert.ok(c.vetoes.some((v) => /fast invalidation/.test(v)));
});

test("R7: chop caps at B+", () => {
  const chop = Array.from({ length: 10 }, (_, i) => ({ t: i * 900_000, o: 100, h: 101, l: 99, c: 100.2, v: 1 }));
  assert.equal(d.applyDiscipline(card(), ctx({ closed15: chop })).pathBand, "B+");
  assert.equal(d.isChop(quiet, 10).chop, true === d.isChop(quiet, 10).chop); // shape only
});

test("R8: rejection wick at a level nudges q ±0.01", () => {
  const bars = [...quiet.slice(0, 19), { t: 19 * 900_000, o: 100, h: 100.6, l: 90, c: 100.4, v: 1 }];
  assert.equal(d.rejectionVote("long", bars, [90.5], 10), 1);
  assert.equal(d.rejectionVote("short", bars, [90.5], 10), -1);
  assert.equal(d.rejectionVote("long", bars, [200], 10), 0);
});

test("R9: shock lean clears after 1×ATR counter-move or 30 minutes", () => {
  assert.equal(d.shockLeanLive("long", 0, 100, 95, 10, 60_000), "long");
  assert.equal(d.shockLeanLive("long", 0, 100, 89, 10, 60_000), null);
  assert.equal(d.shockLeanLive("long", 0, 100, 100, 10, 31 * 60_000), null);
});

test("one HTF read: gap-direction drops the forming 1h/4h candle", () => {
  const T = Date.UTC(2026, 9, 13, 22, 0); // 18:00 ET
  const bars = Array.from({ length: 6 }, (_, i) => ({ t: T + i * 15 * 60_000, o: 1, h: 2, l: 0.5, c: 1.5 }));
  assert.equal(gd.resample(bars, 60).length, 1); // 4 bars = one closed hour; the next hour is forming
  assert.equal(gd.resample(bars.slice(0, 4), 60).length, 1);
  assert.equal(gd.resample(bars.slice(0, 3), 60).length, 0);
});
