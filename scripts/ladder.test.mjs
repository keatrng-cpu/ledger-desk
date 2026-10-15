/**
 * Two-sided ladder (src/lib/smc/seq/ladder.ts) — Keaton 2026-10-15. Display-only.
 * Fixture: scripts/fixtures/ladder-2026-10-15.json — Yahoo 60m/1d up to 2026-10-15 08:37 CT + the live card's map levels.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "tsx/esm/api";
register();
const L = await import("../src/lib/smc/seq/ladder.ts");
const CAL = JSON.parse(readFileSync(new URL("../src/lib/smc/seq/ladder-calibration.json", import.meta.url), "utf8"));
const FX = JSON.parse(readFileSync(new URL("./fixtures/ladder-2026-10-15.json", import.meta.url), "utf8"));
const RULES = JSON.parse(readFileSync(new URL("../shared/desk-rules.json", import.meta.url), "utf8"));

const mapOf = (b, sym) => ({ symbol: sym, levels: b.levels, pools: b.pools, arrays: [], biasStack: { htf: "mixed", mtf: "mixed", ltf: "mixed" }, atr15: null });
const bookOf = (sym, card = null) => {
  const b = FX.books[sym];
  return L.ladderBook({ symbol: sym, price: b.price, nowMs: FX.cutT, hourly: b.hourly, daily: b.daily, map: mapOf(b, sym), card });
};
const covers = (side, px, tol) => side.targets.some((t) => px >= t.lo - tol && px <= t.hi + tol) || side.entries.some((e) => Math.abs(e.entry - px) <= tol);

test("10-15 08:37 CT (a): MNQ sell side carries 29648-29659, 29616, 29369-29406, 29053", () => {
  const b = bookOf("MNQ");
  for (const px of [29648, 29659, 29616, 29369, 29053]) assert.ok(covers(b.bear, px, 4), `MNQ bear ladder missing ${px}`);
  assert.ok(b.bars1h > 2500 && b.spanDays >= 180, `~6 months of 1h history (got ${b.bars1h} bars / ${b.spanDays}d)`);
});

test("10-15 08:37 CT (a): ES sell side carries 7707, 7673, 7655, 7618", () => {
  const b = bookOf("ES");
  for (const px of [7707, 7673, 7655, 7618]) assert.ok(covers(b.bear, px, 1.5), `ES bear ladder missing ${px}`);
});

test("10-15 (a): buy side runs up to PDH and PWH, every rung above price, in distance order", () => {
  for (const sym of ["MNQ", "ES"]) {
    const b = bookOf(sym);
    const pdh = FX.books[sym].levels.find((l) => l.name === "PDH").price, pwh = FX.books[sym].levels.find((l) => l.name === "PWH").price;
    for (const lv of [pdh, pwh]) if (lv > b.price) assert.ok(b.bull.targets.some((t) => lv >= t.lo - 0.25 && lv <= t.hi + 0.25), `${sym} bull ladder stops short of ${lv}`);
    assert.ok(b.bull.targets.every((t) => t.touch > b.price) && b.bear.targets.every((t) => t.touch < b.price));
    for (const s of [b.bull, b.bear]) for (let k = 1; k < s.targets.length; k++) assert.ok(s.targets[k].distAtr >= s.targets[k - 1].distAtr);
  }
});

test("10-15 08:28 CT (b): ES long entry 7747.38 / stop 7741.5 with px 7736 is INVALID", () => {
  const c = L.stopCheck("long", 7747.38, 7741.5, 7736);
  assert.equal(c.valid, false);
  assert.match(c.why, /already crossed the stop 7741.5/);
  const b = L.ladderBook({ symbol: "ES", price: 7736, nowMs: FX.cutT, hourly: FX.books.ES.hourly, daily: FX.books.ES.daily, map: mapOf(FX.books.ES, "ES"), card: { side: "long", entry: 7747.38, stop: 7741.5 } });
  assert.equal(b.cardCheck.valid, false);
});

test("stops: wrong side of entry is invalid; every ladder entry's stop sits beyond entry on the protective side", () => {
  assert.equal(L.stopCheck("short", 100, 99, 98).valid, false);
  assert.equal(L.stopCheck("short", 100, 101, 102).valid, false);
  assert.equal(L.stopCheck("short", 100, 101, 99).valid, true);
  for (const sym of ["MNQ", "ES"]) {
    const b = bookOf(sym);
    assert.ok(b.bull.entries.length + b.bear.entries.length > 0, `${sym} has candidate entries`);
    for (const e of b.bull.entries) { assert.ok(e.stop < e.entry); assert.equal(e.valid, b.price > e.stop); }
    for (const e of b.bear.entries) { assert.ok(e.stop > e.entry); assert.equal(e.valid, b.price < e.stop); }
  }
});

test("both conditions always present + flip line", () => {
  for (const sym of ["MNQ", "ES"]) {
    const b = bookOf(sym);
    assert.equal(b.bull.side, "long"); assert.equal(b.bear.side, "short");
    assert.ok(b.bull.targets.length > 0 && b.bear.targets.length > 0);
    assert.ok(b.flip && Number.isFinite(b.flip.level) && b.flip.tf === "1h body close");
  }
});

test("odds are calibrated, labelled, and never shown on a thin cell", () => {
  assert.match(CAL.method, /empirical hit rate/);
  assert.ok(CAL.train.sessions >= 200 && CAL.holdout.sessions >= 50);
  for (const tn of ["touchSession", "touch5d", "entryFill", "entryWin"]) assert.ok(CAL.holdout.brier[tn].table <= CAL.holdout.brier[tn].base + 0.005, `${tn} holdout Brier no worse than base rate`);
  for (const sym of ["MNQ", "ES"]) {
    const b = bookOf(sym);
    const probs = [...b.bull.targets, ...b.bear.targets].flatMap((t) => [t.pSession, t.p5d]).concat([...b.bull.entries, ...b.bear.entries].flatMap((e) => [e.pFill, e.pWin]));
    for (const p of probs) { if (p.p != null) assert.ok(p.n >= L.MIN_N); else assert.ok(p.note); }
    assert.ok(probs.some((p) => p.p != null), "some calibrated odds shown");
  }
});

test("display-only: no rules key (RULES_HASH untouched) and no scoring path reads twoSided", () => {
  assert.equal(RULES.deskSeq.ladder, undefined);
  const src = readFileSync(new URL("../src/lib/trading/build-desk.ts", import.meta.url), "utf8");
  const uses = src.split("\n").filter((l) => /twoSided/.test(l) && !/^\s*(\*|\/\/)/.test(l));
  assert.deepEqual(uses.map((l) => l.trim()), ["twoSided?: LadderWire | null;", "const twoSided = buildLadderWire({ ...payload, mtf } as Parameters<typeof buildLadderWire>[0]);", "twoSided,"]);
  const gates = readFileSync(new URL("../src/lib/trading/desk-listen.ts", import.meta.url), "utf8");
  assert.ok(!/twoSided|\.ladder\b.*(actionable|band|fire)/.test(gates));
});

test("10-15 08:55 CT fast LTF flip: MNQ sweeps 29648-29659, closes back inside, inverts the 1m/3m bear FVG → long promoted, short demoted", () => {
  const b = FX.books.MNQ;
  const m1 = b.minute;
  const end = Date.parse("2026-10-15T14:02:00Z"); // 09:02 CT
  const closed = m1.filter((x) => x.t + 60_000 <= end);
  const r = L.ladderBook({ symbol: "MNQ", price: closed.at(-1).c, nowMs: end, hourly: b.hourly.filter((x) => x.t + 3_600_000 <= end), daily: b.daily, minuteClosed: closed, map: mapOf(b, "MNQ") });
  const f = r.ltfFlip;
  assert.ok(f, "flip detected");
  assert.equal(f.side, "long"); assert.equal(f.demotes, "short"); assert.equal(f.stage, "PROMOTED");
  assert.ok(f.pool.lo <= 29659.25 && f.pool.hi >= 29638.75, `swept pool is the 29648-59 cluster (got ${f.pool.lo}-${f.pool.hi})`);
  assert.ok(f.wick < 29638.75 && f.stop < f.wick, "stop beyond the sweep wick");
  assert.ok(f.entry > f.stop && f.targets.length > 0 && f.targets.every((t) => t.touch > f.entry), "targets from the bull ladder above entry");
  assert.ok(r.noUpgrade.some((n) => n.side === "short"), "no upgrade on the short side into the just-swept pool");
  // no lookahead: before the sweep there is no flip
  const pre = Date.parse("2026-10-15T13:50:00Z");
  const c0 = m1.filter((x) => x.t + 60_000 <= pre);
  const r0 = L.ladderBook({ symbol: "MNQ", price: c0.at(-1).c, nowMs: pre, hourly: b.hourly.filter((x) => x.t + 3_600_000 <= pre), daily: b.daily, minuteClosed: c0, map: mapOf(b, "MNQ") });
  assert.ok(!r0.ltfFlip || r0.ltfFlip.stage !== "PROMOTED");
});
