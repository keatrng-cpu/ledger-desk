import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "tsx/esm/api";
register();
const ex = await import("../src/lib/smc/exec-context.ts");
const dayc = await import("../src/lib/smc/day-context.ts");
const { resampleMs } = await import("../src/lib/trading/tf-ladder.ts");
const L = await import("../src/lib/desk/learning.ts");
const { atr15Of } = await import("../src/lib/smc/mtf-arrays.ts");
const card = JSON.parse(readFileSync(new URL("./fixtures/card-2026-10-13-1201ct-mnq-short-noplan.json", import.meta.url)));
const bars = JSON.parse(readFileSync(new URL("./fixtures/mnq-bars-2026-10-13-to-1202ct.json", import.meta.url)));

export function replay() {
  const s = card.wire.strategy;
  const price = card.quotes.left.price;
  const a = atr15Of(bars.bars15);
  const m = bars.minute.slice(0, -1);
  const b5 = resampleMs(m, 300_000).slice(0, -1);
  const or = s.context?.openingRange ?? null;
  return ex.completePlan({
    symbol: "MNQ", side: s.side, price, atr: a,
    minute: bars.minute, bars15: bars.bars15,
    draws: card.wire.draws, sd: ex.sdDraws(or?.sd, price), blocks: dayc.blocks5m(b5),
    bosLevel: null, orRange: or ? { high: or.high, low: or.low } : null,
    sessionHL: { high: Math.max(...m.map((b) => b.h)), low: Math.min(...m.map((b) => b.l)) },
  });
}
test("fixture: 12:01 CT MNQ short B+ shipped with no entry/stop/target", () => {
  const s = card.wire.strategy;
  assert.equal(s.entry, null); assert.equal(s.stopPx, null); assert.equal(s.target, null); assert.equal(s.band, "B+");
});
test("REPLAY 12:01 CT: the fallback chain prices a complete short plan from real levels", () => {
  const r = replay();
  assert.ok(r.plan, r.missing);
  const p = r.plan;
  assert.ok(p.entry >= card.quotes.left.price - 1e-9 || p.entryZone.top >= card.quotes.left.price, "short entry on the pullback side");
  assert.ok(p.stop > p.entry && p.stop - p.entry >= 0.5 * p.atr - 1e-6);
  assert.ok(p.t1 < p.entry);
  console.log("replay:", JSON.stringify({ entry: p.entry, entrySrc: p.entrySrc, zone: p.entryZone, stop: p.stop, stopWhy: p.stopWhy, t1: p.t1, t2: p.t2, rr1: p.rr1, rr2: p.rr2, targetSrc: p.targetSrc, resting: p.resting, atr: p.atr }));
});
test("no level → no plan (watch row), never a guess", () => {
  const r = ex.completePlan({ symbol: "MNQ", side: "short", price: 100, atr: 4, minute: [], bars15: [], draws: [], sd: [], blocks: [], bosLevel: null, orRange: null, sessionHL: null });
  assert.equal(r.plan, null); assert.match(r.missing, /no entry level/);
  const r2 = ex.completePlan({ symbol: "MNQ", side: "short", price: 100, atr: 4, minute: [], bars15: [], draws: [], sd: [], blocks: [{ kind: "ob", dir: "bear", lo: 101, hi: 103 }], bosLevel: null, orRange: null, sessionHL: null });
  assert.equal(r2.plan, null); assert.match(r2.missing, /no target/);
});
test("task 3: band edges can only rise", () => {
  const b = L.bandEdgeMoves(Array.from({ length: 40 }, () => ({ band: "A-", win: true, r: 2 })), { "A-": 0.65 }, { "A-": 0.65 });
  assert.equal(b["A-"].to, 0.65);
});
