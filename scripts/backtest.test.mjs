import { test } from "node:test";
import assert from "node:assert/strict";
import { register } from "tsx/esm/api";
register();
const e = await import("../src/lib/backtest/engine.ts");
const B = (t, o, h, l, c) => ({ t, o, h, l, c, v: 1 });
test("exact 1m resolution: first touch wins; both in one bar = stop unless it opened through target", () => {
  const m = [B(0, 100, 100, 100, 100), B(1, 100, 103, 99, 102), B(2, 102, 106, 94, 100), B(3, 100, 111, 100, 110)];
  assert.equal(e.resolve1m(m, 0, "long", 100, 95, 105, 90).outcome, "stop");
  assert.equal(e.resolve1m(m, 0, "long", 100, 90, 110, 90).outcome, "target");
  const g = [B(0, 100, 100, 100, 100), B(1, 106, 107, 94, 100)];
  assert.equal(e.resolve1m(g, 0, "long", 100, 95, 105, 90).outcome, "target");
  assert.equal(e.resolve1m(m, 0, "long", 100, 50, 200, 2).outcome, "time");
});
test("option PnL model: delta × move × ratio − theta − spread", () => {
  const o = { delta: 0.5, thetaPerMin: 0.001, spread: 0.02, ratio: 0.1, premium: 1 };
  assert.equal(e.optionPnlPct(o, "long", 100, 110, 10), +(0.5 * 1 - 0.01 - 0.02).toFixed(4));
  assert.ok(e.optionPnlPct(o, "short", 100, 100, 60) < 0);
});
test("option PnL: long gamma is convex both ways (winners earn more, losers lose less than linear)", () => {
  const lin = { delta: 0.5, gamma: 0, thetaPerMin: 0, spread: 0, ratio: 0.1, premium: 1 };
  const con = { ...lin, gamma: 0.3 };
  // favourable move: convex payoff beats the straight delta line
  assert.ok(e.optionPnlPct(con, "long", 100, 120, 10) > e.optionPnlPct(lin, "long", 100, 120, 10));
  // adverse move: long gamma loses LESS than the linear model
  assert.ok(e.optionPnlPct(con, "long", 100, 80, 10) > e.optionPnlPct(lin, "long", 100, 80, 10));
});
test("option PnL: theta steepens into expiry and the loss is floored at the debit", () => {
  const o = { delta: 0.5, gamma: 0.05, thetaPerMin: 0.0015, spread: 0.02, ratio: 0.1, premium: 1.2 };
  // Same 15-min hold, flat move: the last 15 min before the close decays far more than mid-session.
  const early = -e.optionPnlPct(o, "long", 100, 100, 15, 360); // 6h to close
  const late = -e.optionPnlPct(o, "long", 100, 100, 15, 15); // 15m to close
  assert.ok(late > early, "late-session theta cost must exceed early-session");
  // A long option can never lose more than 100% of the debit.
  assert.ok(e.optionPnlPct(o, "long", 100, 60, 120, 20) >= -1);
  // minutesToRthClose: 10:00 ET entry has more life than 15:30 ET entry
  const tenET = Date.parse("2026-10-15T14:00:00.000Z"); // 10:00 ET
  const lateET = Date.parse("2026-10-15T19:30:00.000Z"); // 15:30 ET
  assert.ok(e.minutesToRthClose(tenET) > e.minutesToRthClose(lateET));
});
test("walk-forward split keeps the last 25% as holdout; diff renders", () => {
  const s = e.splitDays([1, 2, 3, 4, 5, 6, 7, 8]);
  assert.deepEqual(s.holdout, [7, 8]); assert.deepEqual(s.train, [1, 2, 3, 4, 5, 6]);
  const a = e.summarize([{ r: 1, optPnlPct: 0.2 }, { r: -1, optPnlPct: -0.3 }]);
  assert.equal(a.hit, 0.5); assert.match(e.diffSummaries({ all: { ...a, trades: 1 } }, { all: a })[0], /trades 1→2/);
});
