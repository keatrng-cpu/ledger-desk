import { test } from "node:test";
import assert from "node:assert/strict";
import { register } from "tsx/esm/api";
register();
const m = await import("../src/lib/smc/mtf-context.ts");
const cp = await import("../src/lib/trading/card-plan.ts");
const s = (tf, kind, leader = "MNQ", failing = "ES", ageBars = 1) => ({ tf, kind, leader, failing, ageBars });
test("weighted SMT: the 10:28 ET mix leads bullish, trigger is the fastest bullish read", () => {
  const w = m.weightedSmt([s("1m", "bullish"), s("2m", "bearish"), s("3m", "bearish"), s("5m", "bullish"), s("30m", "bullish"), s("4h", "bullish")]);
  assert.equal(w.lead?.kind, "bullish");
  assert.equal(w.lead?.tf, "1m");
  assert.ok(w.vote.bullish > w.vote.bearish);
});
test("weighted SMT: a lone 1m read against slower reads does not lead", () => {
  const w = m.weightedSmt([s("1m", "bearish"), s("15m", "bullish"), s("1h", "bullish")]);
  assert.equal(w.lead?.kind, "bullish");
  assert.equal(w.lead?.tf, "15m");
});
test("weighted SMT: no majority → no lead", () => {
  assert.equal(m.weightedSmt([s("15m", "bullish"), s("30m", "bearish")]).lead, null);
  assert.equal(m.weightedSmt([]).lead, null);
});
test("primaryTarget: T1 stays the first target even under 1R (no silent T2 promotion; live 10/15 13:02 CT T1 jump)", () => {
  assert.deepEqual(cp.primaryTarget({ t1: 30792, t2: 31058, rr1: 0.28, rr2: 1.9 }), { price: 30792, rr: 0.28, which: "t1" });
  assert.deepEqual(cp.primaryTarget({ t1: 7792.25, t2: 7874.25, rr1: 0.92, rr2: 12.0 }), { price: 7792.25, rr: 0.92, which: "t1" });
  assert.deepEqual(cp.primaryTarget({ t1: null, t2: 101, rr1: null, rr2: 1.2 }), { price: 101, rr: 1.2, which: "t2" });
  assert.deepEqual(cp.primaryTarget({ t1: 100, t2: null, rr1: 1.5, rr2: null }), { price: 100, rr: 1.5, which: "t1" });
  assert.deepEqual(cp.primaryTarget({ t1: 100, t2: 101, rr1: 0.3, rr2: 0.6 }), { price: 100, rr: 0.3, which: "t1" });
  assert.deepEqual(cp.primaryTarget(null), { price: null, rr: null, which: null });
});
