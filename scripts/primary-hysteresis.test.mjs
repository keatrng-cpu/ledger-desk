import { test } from "node:test";
import assert from "node:assert/strict";
import { register } from "tsx/esm/api";
register();
const h = await import("../src/lib/trading/primary-hysteresis.ts");

test("primary holds against a sub-margin or short-lived lead (no ES/MNQ churn)", () => {
  let s = h.emptyPrimary();
  s = h.stickyPrimary(s, { MNQ: 0.70, ES: 0.69 }); assert.equal(s.symbol, "MNQ");
  const seq = [{ MNQ: 0.70, ES: 0.72 }, { MNQ: 0.70, ES: 0.75 }, { MNQ: 0.71, ES: 0.70 }, { MNQ: 0.70, ES: 0.74 }, { MNQ: 0.70, ES: 0.74 }];
  for (const sc of seq) { s = h.stickyPrimary(s, sc); assert.equal(s.symbol, "MNQ", JSON.stringify(sc)); }
  s = h.stickyPrimary(s, { MNQ: 0.70, ES: 0.74 }); assert.equal(s.symbol, "ES"); assert.equal(s.flipped, true);
});
test("incumbent with no card hands over at once", () => {
  const s = h.stickyPrimary({ symbol: "MNQ", challenger: null, streak: 0 }, { ES: 0.66 });
  assert.equal(s.symbol, "ES");
});
test("08:33:36 CT case: ES taking primary does not rewrite the MNQ short book", () => {
  const mnq = { symbol: "MNQ", side: "short", word: "TAKE", plan: { entry: 29771.13, stop: 29801, t1: 29700 } };
  const before = { left: mnq, right: { symbol: "ES", side: "long", plan: null } };
  const after = { left: { symbol: "MNQ", side: "short", word: "WAIT", plan: { entry: 29822.75, stop: 29850, t1: 29760 } }, right: { symbol: "ES", side: "long", plan: { entry: 6700 } } };
  const out = h.keepOtherBook(before, after, "ES");
  assert.deepEqual(out.left, mnq);                       // same entry/stop/T1 and status
  assert.equal(out.right.plan.entry, 6700);              // the new primary is re-graded
});
test("build-desk wires both", async () => {
  const src = (await import("node:fs")).readFileSync("src/lib/trading/build-desk.ts", "utf8");
  assert.match(src, /primaryForPoll\(/); assert.match(src, /keepOtherBook\(before, smcMaster, lead\.symbol\)/);
});
