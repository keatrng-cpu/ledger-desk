import { test } from "node:test";
import assert from "node:assert/strict";
import { register } from "tsx/esm/api";
register();
const g = await import("../src/lib/smc/seq/ladder-grade.ts");
const cfg = await import("../src/lib/aplus/config.ts");

const prob = (p, n = 100, proxy = false) => ({ p, n, key: "k", ...(proxy ? { proxy: true } : {}) });
const entry = (o) => ({
  kind: o.kind ?? "ifvg CE", tf: o.tf ?? "5m", entry: o.entry ?? 100, stop: o.stop ?? 99,
  stopWhy: "x", distAtr: 0.5, valid: o.valid ?? true, invalidWhy: o.invalidWhy ?? null,
  pFill: o.pFill ?? prob(0.6), pWin: o.pWin ?? prob(0.7), t1R: o.t1R ?? 1.5, targets: [],
});

test("A+ cut is anchored to the desk's own target win rate (not invented)", () => {
  assert.equal(g.LADDER_GRADE.bandCuts["A+"], cfg.APLUS_RULES.profitPath.targetWinRate);
});

test("measured win rate + R → EV, band and GO", () => {
  const r = g.gradeEntry(entry({ pFill: prob(0.6), pWin: prob(0.72), t1R: 1.5 }));
  // EV = 0.72*1.5 - 0.28 = 0.80R ; pReachT1 = 0.6*0.72 = 0.432
  assert.equal(r.evR, 0.8);
  assert.equal(r.pReachT1, 0.432);
  assert.equal(r.band, "A+");
  assert.equal(r.word, "GO");
});

test("EV floor vetoes a high win rate with a tiny target (the 75%-hit trap)", () => {
  // pWin 0.55 clears the A- cut, but a 0.2R target makes EV negative → WATCH, never GO.
  const r = g.gradeEntry(entry({ pWin: prob(0.55), t1R: 0.2 }));
  assert.ok(r.evR < 0);
  assert.equal(r.word, "WATCH");
  assert.notEqual(r.band, "A-");
});

test("no calibrated win rate → WATCH with null EV", () => {
  const r = g.gradeEntry(entry({ pWin: { p: null, n: 12, key: "k", note: "n=12 too small" } }));
  assert.equal(r.pWinGivenFill, null);
  assert.equal(r.evR, null);
  assert.equal(r.word, "WATCH");
});

test("an invalidated plan can never be GO", () => {
  const r = g.gradeEntry(entry({ valid: false, invalidWhy: "price crossed stop", pWin: prob(0.8), t1R: 2 }));
  assert.equal(r.word, "STAND");
});

test("proxy calibration is flagged through", () => {
  const r = g.gradeEntry(entry({ pWin: prob(0.7, 100, true) }));
  assert.equal(r.proxy, true);
  assert.match(r.why, /proxy/);
});

test("gradeSide ranks by EV and picks the best GO", () => {
  const side = {
    side: "long", bias: "bull", prior: { p: null, method: "x", n: 0 },
    entries: [
      entry({ entry: 100, pWin: prob(0.55), t1R: 1.2 }), // EV = 0.66-0.45 = 0.21
      entry({ entry: 101, pWin: prob(0.72), t1R: 1.5 }), // EV = 0.80  ← best
    ],
    targets: [],
  };
  const { best, graded } = g.gradeSide(side);
  assert.equal(graded[0].evR, 0.8);
  assert.equal(best.entry, 101);
  assert.equal(best.word, "GO");
});

const side = (label, entries) => ({ side: label, bias: label === "long" ? "bull" : "bear", prior: { p: null, method: "x", n: 0 }, entries, targets: [] });
const book = (bull, bear) => ({ symbol: "MNQ", price: 100, atr1h: 5, asOfT: 0, bars1h: 100, spanDays: 60, bull, bear, flip: null, cardCheck: null, ltfFlip: null, noUpgrade: [], missing: [] });

test("gradeBook picks the best GO across both sides, and gradeRow summarizes it", () => {
  const b = book(
    side("long", [entry({ entry: 101, pWin: prob(0.72), t1R: 1.5 })]),   // EV 0.80 GO
    side("short", [entry({ entry: 99, pWin: prob(0.5), t1R: 1.0 })]),    // EV 0.00 WATCH
  );
  const gb = g.gradeBook(b);
  assert.ok(gb);
  assert.equal(gb.best.entry, 101);
  const row = g.gradeRow("MNQ", gb);
  assert.match(row, /MNQ measured A\+/);
  assert.match(row, /pWin 72%/);
});

test("gradeRow is null when a book has no gradeable entries", () => {
  const b = book(side("long", []), side("short", []));
  assert.equal(g.gradeRow("MNQ", g.gradeBook(b)), null);
});
