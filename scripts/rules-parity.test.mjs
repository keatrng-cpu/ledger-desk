import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { register } from "tsx/esm/api";
register();
const RULES = JSON.parse(readFileSync(new URL("../shared/desk-rules.json", import.meta.url)));
test("desk TS values come from shared/desk-rules.json (no drift)", async () => {
  const d = await import("../src/lib/smc/discipline.ts");
  const ex = await import("../src/lib/smc/exec-context.ts");
  const ma = await import("../src/lib/smc/mtf-arrays.ts");
  const mc = await import("../src/lib/smc/mtf-context.ts");
  const cf = await import("../src/lib/trading/config.ts");
  assert.deepEqual({ ...d.BAND_EDGES_BASE }, RULES.bandEdges);
  for (const v of [d.MIN_STOP_ATR, ex.MIN_STOP_ATR, ex.CONT_MIN_STOP_ATR, ma.MIN_STOP_ATR15]) assert.equal(v, RULES.minStopAtr);
  assert.equal(ex.RR_DISPLAY_MAX, RULES.rrDisplayMax); assert.equal(ex.RR_MIN, RULES.rrMin);
  assert.equal(mc.IFVG5_MAX_AGE, RULES.kill.ifvg5MaxAge); assert.equal(mc.REJECT_WICK_FRAC, RULES.kill.rejectWickFrac); assert.equal(mc.DISP1_ATR, RULES.kill.disp1Atr);
  assert.equal(cf.KILL_BOOST_BASE, RULES.kill.boost); assert.equal(cf.KILL_BOOST_BOUNDS[1], RULES.kill.boostMax);
  assert.equal(d.bandFromQ(RULES.bandEdges["A-"]), "A-"); assert.equal(d.bandFromQ(RULES.bandEdges["A-"] - 0.001), "B+");
});
test("watcher copy of the rules is byte-identical (when the watcher checkout is on this box)", () => {
  for (const p of ["/workspace/desk-watcher-next/watcher/desk-rules.json"]) {
    if (!existsSync(p)) continue;
    assert.deepEqual(JSON.parse(readFileSync(p, "utf8")), RULES, `${p} drifted from shared/desk-rules.json`);
  }
});
test("RH gate quote ages come from shared rules (parity with the watcher)", async () => {
  const a = await import("../src/lib/execution/rh-autofire.ts");
  const g = await import("../src/lib/execution/rh-autofire-gates.ts");
  assert.equal(a.RH_LIVE_QUOTE_MAX_AGE_MS, RULES.fire.quoteMaxAgeS * 1000);
  assert.equal(a.RH_ORDER_REVIEW_MAX_AGE_MS, RULES.fire.orderReviewMaxAgeS * 1000);
  assert.equal(g.RH_PATH_FIRE_MAX_AGE_MS, RULES.fire.quoteMaxAgeS * 1000);
});
