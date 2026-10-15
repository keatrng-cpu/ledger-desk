import { test } from "node:test";
import assert from "node:assert/strict";
import { register } from "tsx/esm/api";
register();
const det = await import("../src/lib/trading/detectors.ts");
const arr = await import("../src/lib/smc/mtf-arrays.ts");
const su = await import("../src/lib/smc/smc-unity.ts");
const ctxm = await import("../src/lib/smc/mtf-context.ts");
const RULES = (await import("../shared/desk-rules.json", { with: { type: "json" } })).default;

const T0 = Date.UTC(2026, 9, 14, 13, 0);
const bar = (i, o, h, l, c, step = 60e3) => ({ t: T0 + i * step, o, h, l, c });

test("every smcUnity item ships shadow (no live behaviour change)", () => {
  for (const [k, v] of Object.entries(RULES.smcUnity)) if (v && typeof v === "object" && "mode" in v) assert.equal(v.mode, "shadow", k);
  assert.deepEqual(RULES.bandEdges, { "A+": 0.75, A: 0.68, "A-": 0.65, "B+": 0.6, B: 0.5 });
});

function failedBullIfvgTape() {
  // filler, a bear FVG (down move), inversion up (close above top), then a close back below bottom (failure)
  const b = [];
  let p = 100;
  for (let i = 0; i < 20; i++) { b.push(bar(i, p, p + 1, p - 1, p + 0.2)); p += 0.2; }
  b.push(bar(20, 104, 104.5, 103.5, 104));        // a: low 103.5
  b.push(bar(21, 104, 104, 98, 98.2));            // displacement down
  b.push(bar(22, 98.2, 99, 97, 97.5));            // c: high 99 → bear gap 99–103.5
  b.push(bar(23, 97.5, 101, 97, 100.5));
  b.push(bar(24, 100.5, 105, 100, 104.6));        // close > 103.5 → inverted (bull iFVG)
  b.push(bar(25, 104.6, 105, 102, 102.5));
  b.push(bar(26, 102.5, 102.6, 96, 96.5));        // close < 99 → failed inversion
  b.push(bar(27, 96.5, 97, 95, 95.5));
  return b;
}

test("F1: detectFvgs marks a failed inversion; mitigated stays legacy in shadow", () => {
  const g = det.detectFvgs(failedBullIfvgTape()).find((x) => x.kind === "bear" && x.inverted);
  assert.ok(g, "bear gap inverted");
  assert.equal(g.inversionFailed, true);
  assert.ok(g.inversionFailedIndex > g.invertedIndex);
});

test("F1/F7: kill built only on a failed iFVG is flagged failedOnly with the inversion anchor", () => {
  const rows = [{ tf: "5m", kind: "ifvg", dir: "bull", ageBars: 2, mitigated: false, lo: 99, hi: 103.5, failed: true, invertedT: T0 + 24 * 60e3 }];
  const minute = failedBullIfvgTape();
  const revs = ctxm.ltfReversalsOf(rows, minute);
  const s = revs.find((r) => r.against === "short");
  assert.ok(s);
  assert.equal(s.smc.failedOnly, true);
  assert.equal(s.smc.killTInv, T0 + 24 * 60e3);
});

test("ranges: per-rung premium/discount judged at the POI, not price", () => {
  const b = [];
  // up to a swing high 120 then down to 100 (swing low) then small bounce
  const path = [100, 104, 108, 112, 116, 120, 116, 112, 108, 104, 100, 102, 101, 103, 102];
  path.forEach((c, i) => b.push(bar(i, c, c + 0.5, c - 0.5, c)));
  const atPoi = su.rungRange(b, 115);
  const atPx = su.rungRange(b, 102);
  assert.equal(atPoi.zone, "premium");
  assert.equal(atPx.zone, "discount");
});

test("F2: nextTarget rolls to the next real level ≥ minR from the POI", () => {
  const lv = [{ name: "Range low", price: 30465.75 }, { name: "London low", price: 30410 }, { name: "PDL", price: 30591.25 }];
  const t = su.nextTarget(lv, "short", 30470, 30552, 30575, 1);
  assert.equal(t.name, "Range low"); // 86/23 = 3.7R and nearest below price
  const t2 = su.nextTarget(lv, "short", 30460, 30552, 30575, 1);
  assert.equal(t2.name, "London low");
  assert.equal(su.nextTarget(lv, "short", 30400, 30552, 30575, 1), null);
});

test("F2: continuationPoi picks the newest same-direction array above price for a short", () => {
  const rows = [
    { tf: "15m", kind: "fvg", dir: "bear", lo: 30640, hi: 30670, ce: 30655, mitigated: false, ageBars: 2 },
    { tf: "1m", kind: "fvg", dir: "bear", lo: 30545, hi: 30560, ce: 30552.5, mitigated: false, ageBars: 3 },
    { tf: "5m", kind: "ifvg", dir: "bear", lo: 30500, hi: 30520, ce: 30510, mitigated: false, ageBars: 1, failed: true },
  ];
  const p = su.continuationPoi(rows, "short", 30490);
  assert.equal(p.tf, "1m");
  assert.equal(p.ce, 30552.5);
});

test("F2: structureHolds needs a quorum of rungs, any opposing live iFVG vetoes that rung", () => {
  const book = { symbol: "MNQ", rungs: ["1m", "2m", "3m", "5m", "15m"].map((tf) => ({ tf, structure: { kind: "BOS", dir: "bear", ageBars: 1 } })), ltfReversals: [] };
  const rows = [{ tf: "5m", kind: "ifvg", dir: "bull", lo: 1, hi: 2, ce: 1.5, mitigated: false, ageBars: 1 }];
  const h = su.structureHolds(book, rows, "short");
  assert.equal(h.holds, true);
  assert.ok(!h.rungs.includes("5m"));
});

test("F4: brain on another book is a caution; SMT failing = ticket book", () => {
  const ctx = { books: [], smt: [], smtLead: { tf: "30m", kind: "bearish", leader: "ES", failing: "MNQ", ageBars: 2 } };
  const r = su.brainBookRead({ symbol: "MNQ", side: "short" }, { symbol: "ES", side: "long", word: "STAND" }, ctx);
  assert.equal(r.otherBook, true);
  assert.equal(r.smtForTicket, true);
  assert.equal(r.wouldUnblock, true);
});

test("F9: feed clock — a stale 1m series cannot feed kills", () => {
  const now = T0 + 10 * 60e3;
  const m = [bar(0, 1, 1, 1, 1), bar(1, 1, 1, 1, 1)];
  const f = su.feedClockRead(m, null, now);
  assert.equal(f.staleForKills, true);
  const g = su.feedClockRead([bar(9, 1, 1, 1, 1)], T0 + 9.5 * 60e3, now);
  assert.equal(g.staleForKills, false);
  assert.equal(g.closeDisagrees, true); // server says closed, feed says forming
});

test("F10: floor DTE by time", () => {
  assert.equal(su.floorDteRead(9, 52, 5).want, 0); // owner rule 2026-10-15: intradayTicket live = 0DTE; 1DTE+ swing-only
  assert.equal(su.floorDteRead(9, 52, 5).mismatch, true);
  assert.equal(su.floorDteRead(15, 0, 1).want, 0);
  assert.equal(su.floorDteRead(15, 0, 1).mismatch, true);
  assert.equal(su.floorDteRead(15, 40, 0).lateBlocked, true); // late: block, not a roll to 1
});

test("F8: extension guard overruled by ≥2 rungs of reversal evidence", () => {
  const book = { rungs: [{ tf: "1m", structure: { dir: "bear", ageBars: 1 } }, { tf: "5m", sweep: { side: "buyside", ageBars: 0 } }] };
  const r = su.extensionMtfRead(book, "short", true);
  assert.equal(r.wouldAllow, true);
  assert.equal(r.capBand, "A-");
});

// ---- Accuracy CHANGES (review 2026-10-14-smc-unity-a4c9f41b) ----
const etMs = (day, hh, mm) => Date.parse(`${day}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00-04:00`);
function tape3(endDay, endH, endM) {
  // 3 sessions of 1m bars, 10/11 18:00 ET → end; each session's prices sit in its own band
  const out = []; let t = etMs("2026-10-11", 18, 0); const end = etMs(endDay, endH, endM);
  const band = (x) => { const k = su.sessionKeyOf(x); return k === "2026-10-12" ? 100 : k === "2026-10-13" ? 200 : k === "2026-10-14" ? 300 : 400; };
  for (; t <= end; t += 60e3) { const p = band(t); out.push({ t, o: p, h: p + 1, l: p - 1, c: p, v: 1 }); }
  return out;
}
test("#1 session ranges: one session, 18:00 ET roll, never pooled across days", () => {
  const m = tape3("2026-10-14", 10, 30);
  const r = Object.fromEntries(su.sessionRanges(m, etMs("2026-10-14", 10, 31)).map((x) => [x.name, x]));
  assert.deepEqual([r.Asia.lo, r.Asia.hi], [299, 301]);
  assert.deepEqual([r.Overnight.lo, r.Overnight.hi], [299, 301]);
  assert.deepEqual([r["NY OR"].lo, r["NY OR"].hi], [299, 301]);
});
test("#1 19:30 ET: tonight's session only (post-18:00 bars), no old overnight range", () => {
  const m = tape3("2026-10-14", 19, 30);
  const r = Object.fromEntries(su.sessionRanges(m, etMs("2026-10-14", 19, 31)).map((x) => [x.name, x]));
  assert.deepEqual(Object.keys(r).sort(), ["Overnight"]);
  assert.deepEqual([r.Overnight.lo, r.Overnight.hi], [399, 401]);
});
test("#2 brainPerBook: same symbol on the opposite side is NOT the other book", () => {
  const ctx = { books: [], smt: [], smtLead: null };
  const r = su.brainBookRead({ symbol: "MNQ", side: "short" }, { symbol: "MNQ", side: "long", word: "STAND" }, ctx);
  assert.equal(r.otherBook, false);
  assert.equal(r.wouldUnblock, false);
});
test("#5 closedByFeed drops the forming bar when there is no feed time", () => {
  const bs = [bar(0, 1, 2, 0, 1), bar(1, 1, 2, 0, 1)];
  assert.equal(su.closedByFeed(bs, 60e3, null).length, 1);
});
