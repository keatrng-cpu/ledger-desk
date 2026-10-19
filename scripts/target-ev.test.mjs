import { test } from "node:test";
import assert from "node:assert/strict";
import { register } from "tsx/esm/api";
register();
const t = await import("../src/lib/backtest/target-ev.ts");

const model = { delta: 0.6, gamma: 0.4, thetaPerMin: 0.0003, spread: 0.004, ratio: 0.2, premium: 0.5 };
const base = { model, side: "long", entry: 100, stop: 99.5, minutesToExpiry: 360, minutesToStop: 10 };

test("convex payoff: a farther target earns more option P&L at equal time + pWin", () => {
  const near = t.targetEv({ price: 100.5, rr: 1, pWin: 0.6, minutesToTarget: 20 }, base);
  const far = t.targetEv({ price: 101.5, rr: 3, pWin: 0.6, minutesToTarget: 20 }, base);
  assert.ok(far.optWin > near.optWin, "farther target should pay more (convex)");
  assert.ok(far.evOpt > near.evOpt, "with equal pWin, farther EV wins here");
});

test("theta: holding the same target longer lowers the option win", () => {
  const quick = t.targetEv({ price: 101, rr: 2, pWin: 0.6, minutesToTarget: 10 }, base);
  const slow = t.targetEv({ price: 101, rr: 2, pWin: 0.6, minutesToTarget: 180 }, base);
  assert.ok(slow.optWin < quick.optWin, "more time to target = more theta = less win");
});

test("picker chooses the max option-EV target and reports futures EV alongside", () => {
  const cands = [
    { price: 100.3, rr: 0.6, pWin: 0.82, minutesToTarget: 8 },   // high hit, tiny payoff
    { price: 101.2, rr: 2.4, pWin: 0.52, minutesToTarget: 30 },  // lower hit, real payoff
    { price: 103.0, rr: 6.0, pWin: 0.18, minutesToTarget: 90 },  // lottery
  ];
  const { best, ranked } = t.rankTargetsByOptionEv(cands, base);
  // best must be the argmax of evOpt among positive-EV candidates
  const maxEv = Math.max(...ranked.filter((r) => r.evOpt != null).map((r) => r.evOpt));
  assert.equal(best.evOpt, maxEv);
  // futures EV is computed for comparison (may disagree with option EV)
  assert.ok(ranked.every((r) => r.evR != null));
});

test("a tiny-target, high-hit setup does not win when its option payoff is negative", () => {
  // The '75% hit' trap at the P&L layer: 0.82 hit but the move can't clear spread+theta.
  const tiny = t.targetEv({ price: 100.1, rr: 0.2, pWin: 0.82, minutesToTarget: 6 }, base);
  const real = t.targetEv({ price: 101.2, rr: 2.4, pWin: 0.52, minutesToTarget: 30 }, base);
  assert.ok(real.evOpt > tiny.evOpt, "a payable target beats a high-hit unpayable one");
});

test("uncalibrated targets (null pWin) are shown but never chosen", () => {
  const cands = [
    { price: 101.2, rr: 2.4, pWin: null, minutesToTarget: 30 },
    { price: 100.8, rr: 1.6, pWin: 0.6, minutesToTarget: 20 },
  ];
  const { best, ranked } = t.rankTargetsByOptionEv(cands, base);
  assert.equal(ranked.find((r) => r.pWin == null).evOpt, null);
  assert.equal(best.pWin, 0.6);
});

test("option loss is floored at the debit (never worse than -1)", () => {
  const r = t.targetEv({ price: 102, rr: 4, pWin: 0.5, minutesToTarget: 30 },
    { ...base, stop: 80 }); // absurdly far stop
  assert.ok(r.optLoss >= -1);
});
