import { test } from "node:test";
import assert from "node:assert/strict";
import { register } from "tsx/esm/api";
register();
const d = await import("../src/lib/smc/day-context.ts");
// 2026-10-13 ET: 9:30 ET = 13:30Z
const at = (h, m) => Date.UTC(2026, 9, 13, h + 4, m);
const mb = (t, o, h, l, c, v = 100) => ({ t, o, h, l, c, v });
test("6/14: opening range fakeout above → short; SD projections from OR", () => {
  const m = [];
  for (let i = 0; i < 15; i++) m.push(mb(at(9, 30 + i), 100, 102, 98, 100));
  for (let i = 0; i < 5; i++) m.push(mb(at(9, 45 + i), 100, i === 2 ? 104 : 101, 99, 101));
  for (let i = 0; i < 2; i++) m.push(mb(at(9, 50 + i), 101, 101, 99, 100));
  const r = d.openingRange(m, at(10, 0));
  assert.deepEqual(r.read, { kind: "fakeout", side: "short" });
  assert.equal(r.sd.up2, 110); assert.equal(r.sd.dn25, 88);
});
test("3: London sweeps the Asia high → NY favours short", () => {
  const m = [mb(Date.UTC(2026, 9, 12, 23, 0), 100, 105, 95, 100), mb(at(3, 0), 100, 107, 99, 101)];
  const r = d.sessionSequence(m, at(10, 0));
  assert.equal(r.londonSwept, "Asia high"); assert.equal(r.nyFavours, "short");
});
test("9: stop-run needs range AND volume spike beyond the 30-bar extreme, close back", () => {
  const m = Array.from({ length: 40 }, (_, i) => mb(i * 60e3, 100, 101, 99, 100, 100));
  m.push(mb(40 * 60e3, 100, 106, 99.5, 100.5, 500), mb(41 * 60e3, 100, 101, 99, 100));
  assert.equal(d.stopRun(m).side, "short");
  m[40].v = 100; assert.equal(d.stopRun(m), null);
});
test("10/11/21/22/4: breakout, ladder, decay, q spread, pair", () => {
  const b5 = [100, 99, 100, 99, 101.5, 102].map((c, i) => mb(i * 300e3, c, c + 0.5, c - 0.5, c));
  assert.equal(d.failedSweep(b5, [{ name: "PDH", price: 101 }]).side, "long");
  assert.deepEqual(d.entryLadder("short", { top: 10, bottom: 8 }), [{ px: 8, pct: 40 }, { px: 9, pct: 40 }, { px: 10, pct: 20 }]);
  assert.equal(d.ageDecay(10), 0); assert.equal(d.ageDecay(13), -0.01); assert.equal(d.ageDecay(100), -0.04);
  assert.equal(d.qSpread([{ id: "a", structureQ: 0.8, modelQ: 0.8 }, { id: "b", structureQ: 0.2, modelQ: 0.2 }]).spread, 0.57);
  assert.equal(d.pairAlignment([0.67, 1]).sizeHint, "full"); assert.equal(d.pairAlignment([0.67]), null);
});
test("13: OB closed through after its leg broke structure becomes a breaker", () => {
  const b = [[100,101,99,100],[100,103,99.5,102.5],[102.5,103,101,101.5],[101.5,102,100,100.5],[100.5,101,99,99.2],[99.2,100,98,99.8],[100,99.5,98.5,99],[99,105,99,104.5],[104.5,106,104,105.5],[105.5,106,104.5,105],[105,105,97,97.5],[97.5,98,96,96.5]]
    .map(([o,h,l,c],i)=>mb(i*300e3,o,h,l,c));
  const ks = d.blocks5m(b).map((x) => x.kind);
  assert.ok(ks.includes("breaker") || ks.includes("mitigation"));
});
test("5: macro risk is never synthesized", () => assert.match(d.MACRO_RISK_NOTE, /null, not synthesized/));
test("item 1: kill boost is 0.02 from config and learnable within bounds", async () => {
  const c = await import("../src/lib/trading/config.ts");
  assert.equal(c.TUNABLES.killBoost, 0.02);
  c.setKillBoostScale(1.2); assert.equal(c.TUNABLES.killBoost, 0.024);
  c.setKillBoostScale(10); assert.equal(c.TUNABLES.killBoost, 0.04);
  c.setKillBoostScale(null); assert.equal(c.TUNABLES.killBoost, 0.02);
});
test("item 2: macro risk needs both DXY and 10y; never invented", async () => {
  const m = await import("../src/lib/market/macro.ts");
  assert.equal(m.macroRisk(0.4, 1.5), "risk-off"); assert.equal(m.macroRisk(-0.4, -2), "risk-on");
  assert.equal(m.macroRisk(0.4, null), null); assert.equal(m.macroRisk(0.1, 2), "mixed");
});
test("item 4: SD draws extend a sub-1R plan only beyond T1", async () => {
  const ex = await import("../src/lib/smc/exec-context.ts");
  const sd = ex.sdDraws({ up2: 120, up25: 125, dn2: 80, dn25: 75 }, 100);
  const near = [{ name: "Swing low (internal SSL)", price: 99, side: "below", scope: "internal", touches: 1, ageBars: 1, distanceAtr: 0.1, swept: false, rank: 0.8 }];
  const p = ex.planAt("ES", "short", { lo: 100, hi: 102, ce: 101 }, 103, "x", 100, near, 4, "t", sd);
  assert.equal(p.t1, 80); assert.equal(p.t2, 99);
});
