import { test } from "node:test";
import assert from "node:assert/strict";
import { register } from "tsx/esm/api";
register();
const L = await import("../src/lib/desk/learning.ts");
const T = Date.UTC(2026, 9, 13, 15);
const bar = (i, o, h, l, c) => ({ t: T + i * 60e3, o, h, l, c, v: 1 });
const NOW = T + 300 * 60e3;
test("plan: T1 first = win with R, MFE/MAE; stop first = loss; same bar = loss", () => {
  const s = { side: "short", entry: 100, stop: 102, target: 96 };
  const w = L.gradePlan(s, T, [bar(0, 100, 101, 99, 99.5), bar(1, 99.5, 100, 95.5, 96)], NOW);
  assert.equal(w.status, "win"); assert.equal(w.r, 2); assert.equal(w.maeR, 0.5); assert.equal(w.minutes, 2);
  assert.equal(L.gradePlan(s, T, [bar(0, 100, 102.5, 99, 102)], NOW).status, "loss");
  assert.equal(L.gradePlan(s, T, [bar(0, 100, 102.5, 95, 99)], NOW).status, "loss");
});
test("plan: a resting entry never touched is nofill, not a win", () => {
  const s = { side: "short", entry: 110, stop: 112, target: 96, resting: true };
  const bars = Array.from({ length: 200 }, (_, i) => bar(i, 100, 101, 95, 96));
  assert.equal(L.gradePlan(s, T, bars, NOW).status, "nofill");
});
test("direction: moves in ATR at 30/60/120; open until +120 closes", () => {
  const bars = Array.from({ length: 130 }, (_, i) => bar(i, 100 - i * 0.1, 100, 90, 100 - i * 0.1));
  const g = L.gradeDirection({ side: "short", price: 100, atr: 4 }, T, bars, NOW);
  assert.equal(g.moves.m30, 0.75); assert.equal(g.status, "right");
  assert.equal(L.gradeDirection({ side: "short", price: 100, atr: 4 }, T, bars, T + 50 * 60e3).status, "open");
});
test("failure modes and missed trades come from the snapshot only", () => {
  const c = { symbol: "ES", side: "long", setup: "x", band: "B+", q: 0.64, qRaw: 0.7, price: 1, atr: 1, entry: null, stop: null, target: null, present: ["smt"], missing: ["Liquidity sweep"], checklist: [], ctx: { bias1h: "bear", htfReleased: false, capReasons: ["Discipline R7: chop caps B+"] } };
  assert.equal(L.failureMode(c, { kind: "dir", status: "wrong", moves: { m30: -1, m60: -1, m120: -1 } }), "HTF conflict");
  assert.match(L.missedTrade(c, { kind: "dir", status: "right", moves: { m30: 1, m60: 1, m120: 1.2 } }), /MISSED ES long graded B\+.*chop caps B\+/);
  assert.equal(L.missedTrade({ ...c, band: "A-" }, { kind: "dir", status: "right", moves: { m120: 3 } }), null);
});
test("learning: no change under n 30; shrunk and capped ±20% above", () => {
  const few = Array.from({ length: 10 }, (_, i) => ({ present: ["smt"], win: i < 9 }));
  assert.equal(L.factorLifts(few)[0].scale, 1);
  const many = [...Array.from({ length: 40 }, (_, i) => ({ present: ["smt"], win: i < 36 })), ...Array.from({ length: 60 }, (_, i) => ({ present: ["pd"], win: i < 6 }))];
  const lifts = Object.fromEntries(L.factorLifts(many).map((l) => [l.factor, l]));
  assert.ok(lifts.smt.scale > 1 && lifts.smt.scale <= 1.2);
  assert.ok(lifts.pd.scale < 1 && lifts.pd.scale >= 0.8);
  const b = L.bandEdgeMoves(Array.from({ length: 30 }, () => ({ band: "A-", win: false, r: -1 })), { "A-": 0.65 }, { "A-": 0.65 });
  assert.equal(b["A-"].to, 0.66);
});
