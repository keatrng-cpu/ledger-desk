/** graph-drift-1016 (Graph Keeper audit): wire reasons/guards per card, reasons shadow sampler, dead-card cap dedupe proof,
 *  single PROFIT_ACTION_FLOOR, RULES_HASH unchanged. Run: npm test */
import { test } from "node:test";
import assert from "node:assert/strict";
import { register } from "tsx/esm/api";
register();
const h = await import("../src/lib/desk/rules-hash.ts");
const dl = await import("../src/lib/trading/desk-listen.ts");
const rs = await import("../src/lib/desk/reasons-shadow.ts");
const d = await import("../src/lib/smc/discipline.ts");
const qs = await import("../src/lib/trading/q-source.ts");
const cfg = await import("../src/lib/aplus/config.ts");
const pp = await import("../src/lib/trading/profit-path.ts");

test("RULES_HASH unchanged", () => assert.equal(h.RULES_HASH, "a4bfcb65c88badcd"));

test("#1/#2 wire cards: every card carries reasons (last 20) and its own guards", () => {
  const reasons = Array.from({ length: 30 }, (_, i) => `r${i}`);
  const g = { live: [{ rule: "loss.htf", did: "cut" }], shadow: [{ rule: "loss.sweep", would: "block" }] };
  const out = dl.wireCardsOf([
    { symbol: "MNQ", side: "long", pathBand: "A-", confluence: 0.66, reasons, guards: null },
    { symbol: "ES", side: "short", pathBand: "C", confluence: 0.4, reasons: ["shadow:timing (no effect): x", 7], guards: g },
    { symbol: "ES", side: "long", grade: "B", confluence: 0.5 },
  ]);
  assert.equal(out.length, 3);
  assert.equal(dl.WIRE_REASONS_CAP, 20);
  assert.deepEqual(out[0].reasons, reasons.slice(-20));
  assert.deepEqual(out[1], { symbol: "ES", side: "short", band: "C", q: 0.4, reasons: ["shadow:timing (no effect): x"], guards: g });
  assert.deepEqual(out[2], { symbol: "ES", side: "long", band: "B", q: 0.5, reasons: [], guards: null });
});

test("#3 reasons shadow: one row per card, only when its reasons change", () => {
  const last = new Map();
  const a = { symbol: "MNQ", side: "long", band: "C", q: 0.3, reasons: ["x"] };
  const b = { symbol: "ES", side: "short", band: "B", q: 0.55, reasons: [] };
  assert.equal(rs.reasonsShadowRows([a, b], last).length, 1);          // b has no reasons
  assert.equal(rs.reasonsShadowRows([a, b], last).length, 0);          // unchanged → sampled out
  const r = rs.reasonsShadowRows([{ ...a, reasons: ["x", "shadow:ltfSoft (no effect): y"] }], last);
  assert.equal(r.length, 1); assert.deepEqual(r[0].reasons, ["x", "shadow:ltfSoft (no effect): y"]);
  assert.equal(r[0].q, 0.3);                                           // low-q cards are kept (no SNAP_MIN_Q filter)
});

// #4: build-desk kill() did qWrite(capBand C) → sealBand → qWrite(capBand C). Proof the 2nd write is a no-op.
const LABEL = "dead:card (invalidated/played out/stale tape)";
const run = (c, second) => {
  qs.qWrite(c, "pathBand", d.capBand(c.pathBand, "C"), LABEL);
  qs.setQSource("dead:card seal"); d.sealBand(c); qs.setQSource(null);
  if (second) qs.qWrite(c, "pathBand", d.capBand(c.pathBand, "C"), LABEL);
  return { c, src: qs.takeQSource(), why: qs.takeQWhy() };
};
test("#4 dead-card cap: the second capBand after sealBand is provably identical (exhaustive grid)", () => {
  const bands = ["A+", "A", "A−", "A-", "B+", "B", "C", "skip", undefined, null, "?"];
  const qsList = [-1, 0, 0.1, 0.4999, 0.5, 0.55, 0.5999, 0.6, 0.65, 0.68, 0.7499, 0.75, 0.9, 1, NaN];
  const edgeSets = [null, { B: 0.52, "B+": 0.62 }, { B: 0.50005 }, { "A+": 0.8, A: 0.7, "A-": 0.66, "B+": 0.61, B: 0.55 }];
  let n = 0;
  for (const e of edgeSets) {
    d.setBandEdges(e);
    for (const pathBand of bands) for (const confluence of qsList) for (const grade of [undefined, "skip"]) for (const actionable of [true, false]) {
      const base = { confluence, pathBand, grade, actionable, qRaw0: 0.42, reasons: [] };
      const a = run(structuredClone(base), true), b = run(structuredClone(base), false);
      assert.deepEqual(b, a, JSON.stringify({ e, base }));
      n++;
    }
  }
  d.setBandEdges(null);
  assert.ok(n > 1000);
});

test("#6 one PROFIT_ACTION_FLOOR: config is the source, profit-path re-exports it, value 0.65", () => {
  assert.equal(cfg.PROFIT_ACTION_FLOOR, 0.65);
  assert.equal(cfg.PROFIT_ACTION_FLOOR, cfg.APLUS_RULES.confluenceFloorCalibration);
  assert.equal(pp.PROFIT_ACTION_FLOOR, cfg.PROFIT_ACTION_FLOOR);
});
