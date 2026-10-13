import { test } from "node:test";
import assert from "node:assert/strict";
import { register } from "tsx/esm/api";
register();
const d = await import("../src/lib/smc/discipline.ts");
const m = await import("../src/lib/smc/mtf-context.ts");
test("bandFromQ thresholds", () => {
  assert.deepEqual([0.8, 0.7, 0.66, 0.61, 0.55, 0.2].map(d.bandFromQ), ["A+", "A", "A-", "B+", "B", "C"]);
  assert.equal(d.bandFromQ(null), null);
});
test("sealBand: path label above q is lowered to q's band", () => {
  const c = d.sealBand({ confluence: 0.2167, pathBand: "B+", actionable: true });
  assert.equal(c.pathBand, "C"); assert.equal(c.actionable, false); assert.equal(c.confluence, 0.2167);
});
test("sealBand: a cap below q clamps q, keeps qRaw, band == bandFromQ(q)", () => {
  const c = d.sealBand({ confluence: 0.7373, pathBand: "B+", actionable: true });
  assert.equal(c.pathBand, "B+"); assert.equal(c.qRaw, 0.7373); assert.equal(d.bandFromQ(c.confluence), "B+"); assert.equal(c.actionable, true);
});
test("sealBand: skip stays skip and is never actionable", () => {
  const c = d.sealBand({ confluence: 0.9, pathBand: "skip", actionable: true });
  assert.equal(c.pathBand, "skip"); assert.equal(c.actionable, false);
});
test("htfBiasOf reads the 1h/4h rungs", () => {
  const ctx = { books: [{ symbol: "ES", rungs: [{ tf: "1h", bias: "bull" }, { tf: "4h", bias: "bear" }], align: {} }], smt: [], smtLead: null };
  assert.deepEqual(m.htfBiasOf(ctx, "ES"), { symbol: "ES", bias1h: "bull", bias4h: "bear" });
  assert.equal(m.htfBiasOf(ctx, "MNQ"), null);
});
