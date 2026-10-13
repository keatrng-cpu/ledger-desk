import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "tsx/esm/api";
register();
const ex = await import("../src/lib/smc/exec-context.ts");
// Live 10:29 CT MNQ short (fixture): qRaw 0.80, displacement 0.76, chop capped B+, no plan.
const card = JSON.parse(readFileSync(new URL("./fixtures/card-2026-10-13-1029ct-mnq-short.json", import.meta.url)));
test("fixture is the stuck MNQ short", () => {
  const s = card.wire.strategy;
  assert.equal(s.symbol, "MNQ"); assert.equal(s.side, "short"); assert.equal(s.chop, true); assert.equal(s.entry, null);
  assert.ok(s.displacementStrength >= 0.6);
});
const T0 = Date.UTC(2026, 9, 13, 14, 0);
function bearLeg() {
  // drift, a 3m swing high, then a stair-step selloff leaving stacked bear gaps
  const out = []; let p = 30760; let t = T0;
  const bar = (o, h, l, c) => out.push({ t: (t += 60e3), o, h, l, c, v: 1 });
  for (let i = 0; i < 40; i++) { bar(p, p + 2, p - 2, p + (i % 2 ? 1 : -1)); }
  bar(p, p + 15, p - 1, p + 10); bar(p + 10, p + 12, p + 4, p + 5); // swing high ~30775
  for (let k = 0; k < 6; k++) { const o = p - k * 12; bar(o, o + 1, o - 14, o - 13); bar(o - 13, o - 12.5, o - 15, o - 14); }
  bar(p - 80, p - 79, p - 82, p - 81);
  return out;
}
test("fix 34: stacked bear gaps + displacement price a short pullback plan", () => {
  const m = bearLeg();
  const b15 = Array.from({ length: 40 }, (_, i) => ({ t: T0 - (40 - i) * 900e3, o: 30700, h: 30730, l: 30670, c: 30700, v: 1 }));
  const price = m[m.length - 2].c;
  const draws = [{ name: "Swing low (internal SSL)", price: 30600, side: "below", scope: "internal", touches: 2, ageBars: 4, distanceAtr: 1, swept: false, rank: 0.7 }];
  const p = ex.continuationPlan("MNQ", "short", m, b15, price, draws, 0.76);
  assert.ok(p, "plan priced");
  assert.ok(p.entry > price, "entry is a pullback up into the newest gap");
  assert.ok(p.stop > p.entry && p.stop - p.entry >= 0.5 * p.atr - 1e-9, "stop ≥ 0.5×ATR above entry");
  assert.equal(p.t1, 30600);
});
test("fix 34: no plan without displacement, gaps or a draw", () => {
  const m = bearLeg();
  const b15 = Array.from({ length: 40 }, (_, i) => ({ t: T0 - (40 - i) * 900e3, o: 30700, h: 30730, l: 30670, c: 30700, v: 1 }));
  const price = m[m.length - 2].c;
  assert.equal(ex.continuationPlan("MNQ", "short", m, b15, price, [], 0.76), null);
  assert.equal(ex.continuationPlan("MNQ", "short", m, b15, price, [{ name: "x", price: 30600, side: "below", scope: null, touches: 0, ageBars: null, distanceAtr: 1, swept: false, rank: 1 }], 0.4), null);
});
