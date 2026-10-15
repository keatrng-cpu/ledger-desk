/**
 * Deep audit 2026-10-15 (audits/deep-audit-1015/report.md) — one test block per desk item.
 * Run: npm test  (node --test, TypeScript via tsx's loader)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { register } from "tsx/esm/api";
register();
const await_fs = () => _fs;
const _fs = await import("node:fs");
const D = await import("../src/lib/smc/deep-audit.ts");
const { entryStateOf } = await import("../src/lib/smc/entry-state.ts");
const { etParse, decisionMsForDay } = await import("../src/lib/trading/session-backtest.ts");
const { sharedDeskBuild, _clearDeskTickCache } = await import("../src/lib/trading/desk-tick-cache.ts");
const { ticketCheck } = await import("../src/lib/trading/desk-listen.ts");

const bar = (t, o, h, l, c) => ({ t, o, h, l, c, v: 0 });

test("#1/#13 invalidated: 10/14 14:33 MNQ long A- 6.6×ATR under its stop is dead, not 'near'", () => {
  const o = { side: "long", price: 30217, entry: 30641.75, stop: 30537.75, atr: 48.5 };
  const inv = D.invalidationOf(o);
  assert.equal(inv.invalid, true);
  assert.ok(inv.beyondAtr > 6);
  const es = entryStateOf({ side: "long", band: "A-", price: 30217, entry: 30641.75, stop: 30537.75, atr15: 48.5 });
  assert.equal(es.state, "invalidated");
  // a long that has not reached entry but is above its stop stays "near"
  assert.equal(entryStateOf({ side: "long", band: "A-", price: 30650, entry: 30641.75, stop: 30537.75, atr15: 48.5 }).state, "near");
  // short: price at the stop counts
  assert.equal(D.invalidationOf({ side: "short", price: 7851.25, entry: 7840, stop: 7851.25 }).invalid, true);
  // #13: the stop printed in the bars since entry even if price came back
  assert.equal(D.invalidationOf({ side: "short", price: 7845, entry: 7840, stop: 7851.25, sinceEntry: [bar(1, 7840, 7858.5, 7839, 7845)] }).invalid, true);
  assert.equal(D.invalidationOf({ side: "short", price: 7845, entry: 7840, stop: 7851.25, sinceEntry: [bar(1, 7840, 7850, 7839, 7845)] }).invalid, false);
});

test("#2 T1 already traded = missed: 10/15 08:39 MNQ short, T1 29869.125 traded, price 29815.25", () => {
  const minute = [];
  for (let i = 0; i < 20; i++) minute.push(bar(i, 30000, 30001, 29999, 30000)); // at entry 29999.75
  for (let i = 20; i < 40; i++) { const p = 29999 - (i - 19) * 9.5; minute.push(bar(i, p + 5, p + 6, p - 5, p)); }
  const since = D.barsSinceEntry(minute, 29999.75);
  assert.ok(since.length >= 20 && since.length < 40);
  const es = entryStateOf({ side: "short", band: "A-", price: 29815.25, entry: 29999.75, t1: 29869.125, atr15: 55, sinceEntry: since });
  assert.equal(es.state, "missed");
  // without sinceEntry the old code never fired (the bug)
  const old = entryStateOf({ side: "short", band: "A-", price: 29990, entry: 29999.75, t1: 29869.125, atr15: 55 });
  assert.notEqual(old.state, "missed");
  // no touch in the window: falls back to the last 30 bars
  assert.equal(D.barsSinceEntry(minute, 40000).length, 30);
});

test("#12 stale tape: lag > 30 s or unknown withholds grades", () => {
  assert.equal(D.tapeStale([1, 2]), false);
  assert.equal(D.tapeStale([600, 2]), true);
  assert.equal(D.tapeStale([null, 2]), true);
  assert.equal(D.tapeStale([30, 30]), false);
});

test("#14 stop text is rendered from stopPx", () => {
  const t = D.stopText(7796.18, "Stop 7788.50 — beyond the 5m sweep");
  assert.equal(t, "Stop 7796.18 — beyond the 5m sweep");
  assert.equal(D.stopFromText(t), 7796.18);
  assert.equal(D.stopText(7796), "Stop 7796.00");
});

test("#15 tick rounding: entry toward market, stop away, targets toward entry", () => {
  assert.equal(D.roundTick(29798.31, "MNQ", "near"), 29798.25);
  const L = D.roundPlan({ entry: 29771.13, stop: 29740.1, t1: 29869.125, t2: 7741.0278 * 4, riskPts: 0, rr1: 0, rr2: 0 }, "long", "MNQ", 29800);
  assert.equal(L.entry, 29771.25); // market above → up (fillable)
  assert.equal(L.stop, 29740);     // away from entry
  assert.equal(L.t1, 29869);       // toward entry
  for (const v of [L.entry, L.stop, L.t1, L.t2]) assert.equal(Math.round(v * 4), v * 4);
  assert.equal(L.riskPts, 31.25);
  const S = D.roundPlan({ entry: 7741.0278, stop: 7748.1, t1: 7720.3, t2: null }, "short", "ES", 7735);
  assert.deepEqual([S.entry, S.stop, S.t1], [7741, 7748.25, 7720.5]);
});

test("#16 level hysteresis: levels hold until a newer closed bar", () => {
  const m = new Map();
  const a = D.pinLevels("k", { entry: 29783.75, stop: 29799.5, t1: 29703.25, t2: null, barT: 100 }, 0, m);
  assert.equal(a.held, false);
  const b = D.pinLevels("k", { entry: 29999.75, stop: 29798.25, t1: 29684.25, t2: null, barT: 100 }, 1000, m);
  assert.equal(b.held, true);
  assert.equal(b.levels.entry, 29783.75);
  const c = D.pinLevels("k", { entry: 29999.75, stop: 29798.25, t1: 29684.25, t2: null, barT: 200 }, 2000, m);
  assert.equal(c.held, false);
  assert.equal(c.levels.entry, 29999.75);
});

test("#5/#6 ticket follows the card; DTE fits the intraday plan", () => {
  assert.deepEqual(D.ticketForCard("MNQ", "short"), { underlier: "QQQ", right: "put" });
  assert.deepEqual(D.ticketForCard("ES", "long"), { underlier: "SPY", right: "call" });
  // 10/14 08:32 ES long card with a QQQ put 5DTE
  const bad = ticketCheck({ underlier: "QQQ", side: "put", dteTarget: 5, contracts: 2 }, { symbol: "ES", side: "long" }, 8, 32, null);
  assert.equal(bad.contradicts, true);
  assert.equal(bad.handable, false);
  assert.equal(bad.flags.dteOk, false);
  assert.equal(bad.flags.liveAskMissing, true);
  // 10/13 MNQ short with a SPY put
  assert.equal(ticketCheck({ underlier: "SPY", side: "put", dteTarget: 0, contracts: 1 }, { symbol: "MNQ", side: "short" }, 9, 0, 1.2).contradicts, true);
  const ok = ticketCheck({ underlier: "QQQ", side: "put", dteTarget: 0, contracts: 1 }, { symbol: "MNQ", side: "short" }, 9, 0, null);
  // owner rule 2026-10-15: intraday = 0DTE; 1DTE+ is swing-only, so a 1DTE intraday ticket fails
  assert.equal(ticketCheck({ underlier: "QQQ", side: "put", dteTarget: 1, contracts: 1 }, { symbol: "MNQ", side: "short" }, 9, 0, 1).flags.dteOk, false);
  // late day: 0DTE impractical → blocked, never rolled (a 1DTE ticket is not accepted instead)
  const late = ticketCheck({ underlier: "QQQ", side: "put", dteTarget: 0, contracts: 1 }, { symbol: "MNQ", side: "short" }, 15, 31, 1);
  assert.equal(late.handable, false);
  assert.ok(late.blocks.some((b) => /0DTE impractical/.test(b)));
  assert.equal(ticketCheck({ underlier: "QQQ", side: "put", dteTarget: 1, contracts: 1 }, { symbol: "MNQ", side: "short" }, 15, 31, 1).handable, false);
  assert.equal(ok.handable, true); // missing live ask is flagged, not blocked
  assert.equal(ok.flags.liveAskMissing, true);
  assert.equal(ticketCheck({ underlier: "QQQ", side: "put", dteTarget: 0, contracts: 0 }, { symbol: "MNQ", side: "short" }, 9, 0, 1).handable, false);
});

test("#4 journal: one row per setup idea, not per redrawn entry", () => {
  const day = "2026-10-15";
  const ids = [7747.38, 7727.63, 7737.25, 7728.5].map((entry) => D.journalSetupId(day, { symbol: "ES", side: "long", entry, context: { anchor: 7712.25 } }));
  assert.equal(new Set(ids).size, 1);
  assert.notEqual(D.journalSetupId(day, { symbol: "ES", side: "long", entry: 7700, context: { anchor: 7690 } }), ids[0]);
  assert.notEqual(D.journalSetupId(day, { symbol: "ES", side: "short", entry: 7747, context: { anchor: 7712.25 } }), ids[0]);
});

test("#17 DST: ET wall time is right on both sides of Nov 1 2026", () => {
  assert.equal(new Date(etParse("2026-10-15T10:00:00")).toISOString(), "2026-10-15T14:00:00.000Z");
  assert.equal(new Date(etParse("2026-11-02T10:00:00")).toISOString(), "2026-11-02T15:00:00.000Z");
  assert.equal(new Date(etParse("2024-01-10T23:59:59")).toISOString(), "2024-01-11T04:59:59.000Z");
  assert.equal(new Date(decisionMsForDay("2025-12-01")).toISOString(), "2025-12-01T15:00:00.000Z");
});

test("#10 one desk build per tick: concurrent callers share it; failures are not cached", async () => {
  _clearDeskTickCache();
  let n = 0, now = 0;
  const build = async () => { n++; await new Promise((r) => setTimeout(r, 20)); return { ok: true, n }; };
  const [a, b, c] = await Promise.all([1, 2, 3].map(() => sharedDeskBuild({ left: "MNQ", right: "ES" }, build, () => now)));
  assert.equal(n, 1);
  assert.equal(a, b); assert.equal(b, c);
  now = 500; await sharedDeskBuild({ left: "MNQ", right: "ES" }, build, () => now); assert.equal(n, 1);
  now = 1600; await sharedDeskBuild({ left: "MNQ", right: "ES" }, build, () => now); assert.equal(n, 2);
  _clearDeskTickCache(); n = 0;
  const fail = async () => { n++; return { ok: false }; };
  await sharedDeskBuild({ left: "MNQ", right: "ES" }, fail, () => now);
  await new Promise((r) => setTimeout(r, 1));
  await sharedDeskBuild({ left: "MNQ", right: "ES" }, fail, () => now);
  assert.equal(n, 2);
});

test("owner rule 2026-10-15: intraday ticket = 0DTE ATM single, 1 OTM fallback, no spreads; late = block; swing keeps 1DTE+", async () => {
  const { INTRADAY, intradayLateBlocked } = await import("../src/lib/trading/options-desk.ts");
  const { floorDteRead } = await import("../src/lib/smc/smc-unity.ts");
  const { dteFitsPlan } = await import("../src/lib/smc/deep-audit.ts");
  const rules = JSON.parse((await import("node:fs")).readFileSync(new URL("../shared/desk-rules.json", import.meta.url), "utf8"));
  assert.equal(rules.optExec.intradayTicket.fallback, "OTM_1");
  assert.equal(INTRADAY.live, true);
  assert.equal(INTRADAY.dte, 0);
  assert.ok(INTRADAY.deltaLo <= 0.5 && INTRADAY.deltaHi >= 0.5); // ATM
  assert.equal(INTRADAY.debitSpread, false);
  for (const [h, m] of [[8, 30], [9, 52], [14, 45], [15, 24]]) { assert.equal(floorDteRead(h, m, 0).want, 0); assert.equal(floorDteRead(h, m, 0).lateBlocked, false); }
  for (const [h, m] of [[15, 25], [15, 31], [15, 55]]) { assert.equal(floorDteRead(h, m, 0).want, 0); assert.equal(floorDteRead(h, m, 0).lateBlocked, true); assert.equal(intradayLateBlocked(h, m), true); }
  assert.equal(intradayLateBlocked(10, 0), false);
  assert.equal(dteFitsPlan(0, "intraday"), true); assert.equal(dteFitsPlan(1, "intraday"), false);
  assert.equal(dteFitsPlan(0, "swing"), false); assert.equal(dteFitsPlan(5, "swing"), true);
  const src = (await import("node:fs")).readFileSync(new URL("../src/lib/trading/options-desk.ts", import.meta.url), "utf8");
  assert.ok(src.includes("if (!INTRADAY.debitSpread) return null;"));
  assert.equal((src.match(/INTRADAY\.live \? INTRADAY\.dte : /g) ?? []).length, 2); // rule off keeps the old lanes // path/continuation + judas killzone lanes; SMT is swing
  assert.equal((src.match(/&& !lateBlocked/g) ?? []).length, 2);
  assert.ok(/5, \/\/ swing-classified/.test(src)); // SMT lead keeps its 5DTE
});

test("deep-audit-1015: T2 must be beyond T1 or dropped (long T1 30174 / T2 29878.75)", async () => {
  const { orderTargets, planTargetText } = await import("../src/lib/trading/card-plan.ts");
  const long = { side: "long", t1: 30174, t2: 29878.75, rr1: 1.4, rr2: 0.2, runnerPool: { name: "x" } };
  assert.equal(orderTargets(long), true);
  assert.equal(long.t2, null); assert.equal(long.rr2, null); assert.equal(long.runnerPool, null);
  const longOk = { side: "long", t1: 30174, t2: 30300, rr2: 2 };
  assert.equal(orderTargets(longOk), false); assert.equal(longOk.t2, 30300);
  const shortBad = { side: "short", t1: 29800, t2: 29900, rr2: 1 };
  assert.equal(orderTargets(shortBad), true); assert.equal(shortBad.t2, null);
  const eq = { side: "short", t1: 29800, t2: 29800 };
  assert.equal(orderTargets(eq), true);
  // text never shows a T2 behind T1 even if a plan slipped through
  const tx = planTargetText({ side: "long", t1: 30174, t2: 29878.75, rr1: 1.4, rr2: 0.2 });
  assert.equal(tx.some((t) => /T2/.test(t)), false);
  assert.equal(planTargetText({ side: "long", t1: 30174, t2: 30300, rr1: 1, rr2: 2 }).some((t) => /T2/.test(t)), true);
  const bd = (await import("node:fs")).readFileSync(new URL("../src/lib/trading/build-desk.ts", import.meta.url), "utf8");
  assert.ok(bd.includes("T2 dropped") && bd.includes("orderTargets("));
});

test("Accuracy PR #19: missing price = unknown (not valid); T1-then-back-to-entry stays played out", () => {
  const u = D.invalidationOf({ side: "long", price: null, entry: 100, stop: 99 });
  assert.equal(u.invalid, false); assert.equal(u.unknown, true); assert.match(u.why, /UNKNOWN/);
  assert.equal(D.invalidationOf({ side: "long", price: 100.5, entry: 100, stop: 99 }).unknown, undefined);
  const b = (t, l, h) => ({ t, o: l, c: h, l, h });
  // long, entry 100, T1 102: touch entry, run to 102.5, come back to entry
  const m = [b(1, 99.8, 100.2), b(2, 100.5, 102.5), b(3, 99.9, 100.3)];
  const last = D.barsSinceEntry(m, 100);
  const first = D.barsSinceEntry(m, 100, 240, 30, "first");
  assert.equal(last.some((x) => x.h >= 102), false);   // last-touch slice forgets T1 (the revive bug)
  assert.equal(first.some((x) => x.h >= 102), true);   // first-touch slice keeps it played out
  const bd = (await_fs()).readFileSync(new URL("../src/lib/trading/build-desk.ts", import.meta.url), "utf8");
  assert.ok(bd.includes('barsSinceEntry(minute, entry, 240, 30, "first")') && bd.includes("playedOut = true") && bd.includes("priceUnknown = true"));
  // brain STAND covers played-out / unknown; re-sort is stable (only dead cards move)
  assert.ok(bd.includes("x.invalidated || x.staleTape || x.playedOut || x.priceUnknown"));
  assert.ok(bd.includes("payload.scan.candidates.sort((a, b) => Number(isDead(a)) - Number(isDead(b)));"));
});

test("Accuracy PR #19: stale boundary at exactly 30 s is fresh on both wire and seal", () => {
  assert.equal(D.tapeStale([30, 30]), false);
  assert.equal(D.tapeStale([30.01, 1]), true);
  const dl = (await_fs()).readFileSync(new URL("../src/lib/trading/desk-listen.ts", import.meta.url), "utf8");
  assert.ok(dl.includes("const tapeFresh = !tapeStale([desk.quotes.left.lagSec, desk.quotes.right.lagSec]);"));
});

test("Accuracy PR #19: a coincident cluster with a swept member is swept (draw.ts mergeCoincident)", async () => {
  const { mergeCoincident } = await import("../src/lib/trading/draw.ts");
  const out = mergeCoincident([{ name: "PDH", price: 100, kind: "high", swept: true, weight: 0.8 }, { name: "EQH", price: 100.1, kind: "high", swept: false, weight: 0.6 }], 5);
  assert.equal(out.length, 1); assert.equal(out[0].swept, true);
});

test("owner rule: rule off keeps the pre-rule lanes; 0DTE live allows 2 contracts", () => {
  const src = (await_fs()).readFileSync(new URL("../src/lib/trading/options-desk.ts", import.meta.url), "utf8");
  assert.ok(src.includes("INTRADAY.live ? INTRADAY.dte : 1,") && src.includes("INTRADAY.live ? INTRADAY.dte : 0,"));
  assert.ok(src.includes("if (dte <= 0) return INTRADAY.live ? 2 : 1;"));
});
