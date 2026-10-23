import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "tsx/esm/api";
register();
const m = await import("../src/lib/smc/retest-reentry.ts");
const h = await import("../src/lib/desk/rules-hash.ts");
// Synthetic 10/16-shaped short: drift up, sweep the 20-bar high, OB, displacement down through it, extend, pull back.
const bar = (i, o, h_, l, c) => ({ t: 1_760_000_000_000 + i * 60_000, o, h: h_, l, c, v: 1 });
function tape(pullback) {
  const b = []; let px = 29900;
  for (let i = 0; i < 60; i++) { const o = px; px += i < 40 ? 1.5 : -0.5; b.push(bar(i, o, Math.max(o, px) + 3, Math.min(o, px) - 3, px)); }
  b.push(bar(60, px, 29990, px - 2, 29985));            // sweep of the 20-bar high, closes back
  b.push(bar(61, 29985, 29988, 29975, 29978));          // last down-close? no: OB = last UP-close for a short
  b.push(bar(62, 29978, 29984, 29976, 29982));          // up-close OB 29976–29984
  b.push(bar(63, 29982, 29983, 29940, 29942));          // displacement closes below the OB low
  let p = 29942; for (let i = 64; i < 80; i++) { const o = p; p -= 3; b.push(bar(i, o, o + 1, p - 1, p)); }
  if (pullback) { let q = p; for (let i = 80; i < 112; i++) { const o = q; q += 3; b.push(bar(i, o, q + 1, o - 1, q)); } }
  return b;
}
test("arms a shadow short on the broken OB, stop beyond the sweep, >= 0.85R", () => {
  const r = m.retestReentryOf({ side: "short", minute: tape(false), pools: [29850] });
  assert.ok(r); assert.equal(r.mode, "shadow"); assert.equal(r.state, "armed");
  assert.equal(r.entry, 29980); assert.ok(r.stop > 29990); assert.ok(r.target < r.entry); assert.ok(r.rr >= 0.85);
});
test("triggers on the pullback touch", () => {
  const r = m.retestReentryOf({ side: "short", minute: tape(true), pools: [29850] });
  assert.ok(r); assert.equal(r.state, "triggered");
});
test("refuses under 0.85R", () => {
  assert.equal(m.retestReentryOf({ side: "short", minute: tape(false), pools: [29960], cfg: { minRR: 5 } }), null);
});
test("shadow module does not change the rules hash (constants stay out of desk-rules.json)", () => {
  const rules = JSON.parse(readFileSync("shared/desk-rules.json", "utf8"));
  assert.equal("retestReentry" in rules, false);
  assert.equal(h.RULES_HASH, "eeb84801a0b5c5b2");
});
