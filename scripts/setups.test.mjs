import { test } from "node:test";
import assert from "node:assert/strict";
import { register } from "tsx/esm/api";
register();
const s = await import("../src/lib/smc/setups.ts");
const T = Date.UTC(2026, 9, 13, 14);
const mk = (rows) => rows.map(([o, h, l, c], i) => ({ t: T + i * 300e3, o, h, l, c, v: 1 }));
test("32 turtle soup: wick above a level, close back under → short", () => {
  const b = mk([[100, 101, 99, 100], [100, 101, 99, 100.5], [100, 101.5, 99, 100], [100, 106, 99.5, 101]]);
  const r = s.turtleSoup(b, [{ name: "PDH", price: 105 }]);
  assert.equal(r?.side, "short"); assert.equal(r?.level, 105);
  assert.equal(s.turtleSoup(b, [{ name: "far", price: 120 }]), null);
});
test("35 BOS retest: break the swing high, retest it, hold", () => {
  const b = mk([[100,101,99,100],[100,102,99,101],[101,105,100,104],[104,104.5,101,102],[102,103,100,101],[101,102,99,100],[100,104,99.5,103.5],[103.5,107,103,106.5],[106.5,107,104.9,106],[106,108,105.5,107.5]]);
  const r = s.bosRetest(b, 4, "long");
  assert.ok(r); assert.equal(r.level, 105);
});
test("37 leg count grows with higher highs; 39 regime + fits", () => {
  const up = mk(Array.from({ length: 30 }, (_, i) => { const base = 100 + Math.floor(i / 5) * 5 + (i % 5 === 2 ? 3 : 0); return [base, base + 1, base - 1, base]; }));
  assert.ok(s.legCount(up, "long") >= 3);
  assert.equal(s.regimeOf({ setupRegime: "reversal" }), "reversal");
  assert.equal(s.regimeOf({ chop: true }), "range");
  assert.equal(s.regimeOf({}), "trend");
  assert.equal(s.fits("bosRetest", "range"), false);
  assert.equal(s.fits("turtleSoup", "range"), true);
});
test("33/36 reversal entries: first IFVG after the CHoCH, second gap is the add-on", () => {
  const rows = [
    { tf: "1m", kind: "fvg", dir: "bear", lo: 1, hi: 2, ce: 1.5, mitigated: false, ageBars: 3, formedAgeBars: 3, createdT: 0 },
    { tf: "1m", kind: "ifvg", dir: "bear", lo: 3, hi: 4, ce: 3.5, mitigated: false, ageBars: 6, formedAgeBars: 9, createdT: 0 },
    { tf: "1m", kind: "ifvg", dir: "bear", lo: 9, hi: 10, ce: 9.5, mitigated: false, ageBars: 20, formedAgeBars: 25, createdT: 0 },
  ];
  const r = s.reversalEntries(rows, "short", 8, "1m");
  assert.equal(r.first.ce, 3.5); assert.equal(r.second.ce, 1.5);
});
test("38 sponsored hold: touched, never closed through", () => {
  const g = { tf: "1m", kind: "sponsored", dir: "bull", lo: 10, hi: 12, ce: 11, mitigated: false, ageBars: 3, formedAgeBars: 3, createdT: 0 };
  assert.ok(s.sponsoredHold([g], [{ t: 60e3, o: 13, h: 14, l: 11.5, c: 13, v: 1 }], "long"));
  assert.equal(s.sponsoredHold([g], [{ t: 60e3, o: 13, h: 14, l: 9, c: 9.5, v: 1 }], "long"), null);
});
