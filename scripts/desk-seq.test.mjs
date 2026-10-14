import { test } from "node:test";
import assert from "node:assert/strict";
import { register } from "tsx/esm/api";
register();
const RULES = (await import("../shared/desk-rules.json", { with: { type: "json" } })).default;
const bb = await import("../src/lib/smc/seq/brain-books.ts");

test("deskSeq: every item ships shadow; band edges unchanged", () => {
  for (const [k, v] of Object.entries(RULES.deskSeq)) if (v && typeof v === "object" && "mode" in v) assert.equal(v.mode, "shadow", k);
  assert.deepEqual(RULES.bandEdges, { "A+": 0.75, A: 0.68, "A-": 0.65, "B+": 0.6, B: 0.5 });
});

test("F5 brainBooks: today's 09:52 — legacy STAND ES long, MNQ book TAKE short → caution not block", () => {
  const books = bb.brainBooks([{ symbol: "MNQ", side: "short", word: "TAKE" }, { symbol: "ES", side: "long", word: "STAND", missing: "POI in correct half" }]);
  assert.equal(books.words.MNQ.short, "TAKE");
  assert.equal(books.words.MNQ.long, "UNGRADED");
  const t = bb.ticketWord(books, { symbol: "MNQ", side: "short" }, { symbol: "ES", side: "long", word: "STAND" });
  assert.equal(t.otherBookBlock, true);
  assert.equal(t.wouldUnblock, true);
  assert.equal(t.wouldBlock, false);
});

test("F5 brainBooks: same symbol opposite side is never weakened (Accuracy #2)", () => {
  const books = bb.brainBooks([{ symbol: "MNQ", side: "short", word: "TAKE" }]);
  const t = bb.ticketWord(books, { symbol: "MNQ", side: "short" }, { symbol: "MNQ", side: "long", word: "STAND" });
  assert.equal(t.otherBookBlock, false);
  assert.equal(t.wouldUnblock, false);
});

test("F5 brainBooks: legacy agreement via another book while this book refuses → wouldBlock", () => {
  const books = bb.brainBooks([{ symbol: "MNQ", side: "short", word: "STAND" }]);
  const t = bb.ticketWord(books, { symbol: "MNQ", side: "short" }, { symbol: "ES", side: "short", word: "TAKE" });
  assert.equal(t.wouldBlock, true);
});

test("F5 brainBooks: ungraded book never unblocks", () => {
  const books = bb.brainBooks([{ symbol: "ES", side: "long", word: "STAND" }]);
  const t = bb.ticketWord(books, { symbol: "MNQ", side: "short" }, { symbol: "ES", side: "long", word: "STAND" });
  assert.equal(t.word, "UNGRADED");
  assert.equal(t.wouldUnblock, false);
});

const pd = await import("../src/lib/smc/seq/pd-leg.ts");
const T = Date.UTC(2026, 9, 14, 13, 30); // 09:30 ET
const mk = (xs) => xs.map(([o, h, l, c], k) => ({ t: T + k * 60e3, o, h, l, c }));

test("F6 pdLeg: continuation short POI in the leg's premium passes while current price is in discount", () => {
  // rally to 30656 (manipulation high), displacement to 30472
  const xs = [];
  let p = 30560;
  for (let k = 0; k < 10; k++) { xs.push([p, p + 12, p - 2, p + 10]); p += 10; }    // up to ~30660
  xs.push([30650, 30656, 30640, 30645]);
  for (let k = 0; k < 9; k++) { xs.push([p, p + 2, p - 22, p - 20]); p -= 20; }       // down
  const bars = mk(xs);
  const leg = pd.legOf(bars, "short");
  assert.equal(leg.hi, Math.max(...bars.map((b) => b.h)));
  const r = pd.pdLegRead({ side: "short", poi: 30600, price: leg.lo + 5, closed1m: bars, feedNowMs: bars.at(-1).t + 60e3, legacyFail: true });
  assert.equal(r.atPoi.zone, "premium");
  assert.equal(r.atPrice.zone, "discount");
  assert.equal(r.pass, true);
  assert.equal(r.flipsLegacy, true);
});

test("F6 pdLeg: a long mirrors; POI on the leg EQ is no edge", () => {
  const xs = [];
  let p = 100;
  for (let k = 0; k < 8; k++) { xs.push([p, p + 0.5, p - 2, p - 1.8]); p -= 2; }
  for (let k = 0; k < 8; k++) { xs.push([p, p + 2.2, p - 0.3, p + 2]); p += 2; }
  const bars = mk(xs);
  const leg = pd.legOf(bars, "long");
  const eq = (leg.hi + leg.lo) / 2;
  const r = pd.pdLegRead({ side: "long", poi: eq, price: leg.hi, closed1m: bars, feedNowMs: null, legacyFail: false });
  assert.equal(r.noEdge, true);
  assert.equal(r.pass, false);
  assert.equal(pd.pdLegRead({ side: "long", poi: leg.lo + 0.1 * (leg.hi - leg.lo), price: leg.hi, closed1m: bars, feedNowMs: null, legacyFail: false }).pass, true);
});

test("F6 eqStack: prior session uses one session with the 18:00 ET roll", () => {
  const d1 = Date.UTC(2026, 9, 13, 21, 0); // 17:00 ET 10/13 (session 10/13)
  const d2 = Date.UTC(2026, 9, 13, 22, 30); // 18:30 ET (session 10/14)
  const bars = [{ t: d1, o: 1, h: 10, l: 5, c: 6 }, { t: d2, o: 6, h: 8, l: 6, c: 7 }, { t: d2 + 60e3, o: 7, h: 7.5, l: 6.5, c: 7 }];
  const st = pd.eqStack(bars, 7, d2 + 120e3);
  const prior = st.find((r) => r.name.startsWith("Prior"));
  assert.deepEqual([prior.hi, prior.lo], [10, 5]);
  const cur = st.find((r) => r.name === "This session");
  assert.deepEqual([cur.hi, cur.lo], [8, 6]);
});

const pm = await import("../src/lib/smc/seq/premarket-map.ts");
const yahoo = (sym) => { try { return JSON.parse((await_fs()).readFileSync(`/workspace/audits/seq-data/yahoo-1m-${sym}.json`, "utf8")); } catch { return null; } };
import * as fsmod from "node:fs";
function await_fs() { return fsmod; }

test("F1 premarketMap: frozen at 09:25 ET, reads no bar closing after the cut", () => {
  const T9 = Date.UTC(2026, 9, 14, 13, 25); // 09:25 ET
  const bars = [];
  for (let k = -2000; k < 120; k++) { const p = 100 + Math.sin(k / 30) * 5 + (k > 0 ? 50 : 0); bars.push({ t: T9 + k * 60e3, o: p, h: p + 1, l: p - 1, c: p }); }
  const a = pm.premarketMap({ symbol: "X", minute: bars, nowMs: T9 + 100 * 60e3 });
  const b = pm.premarketMap({ symbol: "X", minute: bars.filter((x) => x.t + 60e3 <= T9), nowMs: T9 + 100 * 60e3 });
  assert.equal(a.frozen, true);
  assert.equal(a.asOfT, T9);
  assert.deepEqual(a.levels, b.levels);           // bars after 09:25 (the +50 jump) never leak in
  assert.ok(a.price < 120);
  assert.ok(a.missing.some((m) => m.startsWith("30s")));
});

test("F1 premarketMap: blocks — OB, breaker and rejection detected on closed bars", () => {
  const xs = [];
  let p = 100;
  for (let k = 0; k < 20; k++) { const w = [0, 0.6, 0.2, 0.9, 0.1][k % 5]; xs.push({ t: k * 300e3, o: p, h: p + 1 + w, l: p - 1 - w, c: p + (k % 2 ? 0.5 : -0.5) }); }
  xs.push({ t: 20 * 300e3, o: 100, h: 100.2, l: 99, c: 99.2 });      // last down candle (bull OB)
  xs.push({ t: 21 * 300e3, o: 99.2, h: 106, l: 99.1, c: 105.8 });    // displacement up through the swing highs
  for (let k = 22; k < 30; k++) xs.push({ t: k * 300e3, o: 105, h: 106, l: 104, c: 105 });
  const bl = pm.blocksOf(xs, "5m");
  assert.ok(bl.some((b) => b.kind === "ob" && b.dir === "bull"));
  xs.push({ t: 30 * 300e3, o: 104, h: 104, l: 97, c: 97.5 });        // close through the OB → breaker
  assert.ok(pm.blocksOf(xs, "5m").some((b) => b.kind === "breaker" && b.dir === "bear"));
});

test("F1 premarketMap: 10/14 MNQ (Yahoo NQ=F) — bear stack, expect the high raid, bear arrays above price", { skip: !fsmod.existsSync("/workspace/audits/seq-data/yahoo-1m-MNQ.json") }, () => {
  const m = yahoo("MNQ");
  const now = Date.UTC(2026, 9, 14, 13, 40);
  const mp = pm.premarketMap({ symbol: "MNQ", minute: m.filter((b) => b.t + 60e3 <= now), nowMs: now });
  assert.equal(mp.biasStack.htf, "bear");
  assert.equal(mp.amd.expectManip, "high");
  assert.ok(mp.arrays.some((a) => a.dir === "bear" && ["30m", "1h"].includes(a.tf) && a.lo <= 30656 && a.hi >= 30600));
  assert.ok(mp.levels.some((l) => l.name === "PDL"));
});

const amdm = await import("../src/lib/smc/seq/amd-state.ts");
test("F4 amd: no lookahead — the read at T equals the prefix of the read at a later time", { skip: !fsmod.existsSync("/workspace/audits/seq-data/yahoo-1m-MNQ.json") }, () => {
  const m = yahoo("MNQ").filter((b) => b.t % 60e3 === 0);
  const cut = Date.UTC(2026, 9, 14, 13, 26);
  const map = pm.premarketMap({ symbol: "MNQ", minute: m.filter((b) => b.t + 60e3 <= cut && b.t > cut - 12 * 864e5), nowMs: cut });
  const bars = m.filter((b) => b.t > cut - 6 * 36e5);
  const T = Date.UTC(2026, 9, 14, 13, 55); // 09:55 ET
  const early = amdm.amdRead("MNQ", map, bars, T);
  const late = amdm.amdRead("MNQ", map, bars, Date.UTC(2026, 9, 14, 15, 0));
  const lateLogs = late.setups.flatMap((s) => s.log.filter((l) => l.t <= T).map((l) => `${s.side}:${l.t}:${l.stage}`));
  const earlyLogs = early.setups.flatMap((s) => s.log.map((l) => `${s.side}:${l.t}:${l.stage}`));
  assert.deepEqual(earlyLogs.sort(), lateLogs.sort());
  // feeding future bars must not change the read at T
  const same = amdm.amdRead("MNQ", map, bars.filter((b) => b.t + 60e3 <= T), T);
  assert.deepEqual(same.setups.map((s) => s.log), early.setups.map((s) => s.log));
});

test("F4 amd: 10/14 MNQ — raids the 15m bear breaker 09:40, confirms on a closed 5m inversion 09:55, CE ≈30,583; arms only if a real target clears minR", { skip: !fsmod.existsSync("/workspace/audits/seq-data/yahoo-1m-MNQ.json") }, async () => {
  const { setSeqOverrides } = await import("../src/lib/smc/seq/rules.ts");
  const m = yahoo("MNQ").filter((b) => b.t % 60e3 === 0);
  const cut = Date.UTC(2026, 9, 14, 13, 26);
  const map = pm.premarketMap({ symbol: "MNQ", minute: m.filter((b) => b.t + 60e3 <= cut && b.t > cut - 12 * 864e5), nowMs: cut });
  const bars = m.filter((b) => b.t > cut - 6 * 36e5);
  const r = amdm.amdRead("MNQ", map, bars, Date.UTC(2026, 9, 14, 15, 0));
  const s = r.setups.find((x) => x.side === "short" && /15m breaker/.test(x.raid?.name ?? ""));
  assert.ok(s, "the 15m bear breaker raid is a MANIP");
  assert.ok(s.log.some((l) => l.stage === "CONFIRM"));
  assert.equal(s.stage, "EXPIRED"); // shipped minR 1.25: the only real liquidity below (RTH low 30,498) is < 1R from the CE
  assert.match(s.log.at(-1).why, /no real target/);
  setSeqOverrides({ amd: { minR: 0.9 } });
  try {
    const r2 = amdm.amdRead("MNQ", map, bars, Date.UTC(2026, 9, 14, 15, 0));
    const e = r2.setups.find((x) => x.side === "short" && (x.stage === "ARMED" || x.stage === "ENTERED") && x.entry > 30570 && x.entry < 30600);
    assert.ok(e, "at minR 0.9 it arms the displacement-gap CE (≈30,583) on the 09:55 5m close");
    assert.ok(e.stop > 30660.75); // real stop beyond the manipulation extreme
  } finally { setSeqOverrides(null); }
});

test("F4 amd: no map / thin tape → no setups, never throws", () => {
  const r = amdm.amdRead("X", null, [], Date.now());
  assert.equal(r.setups.length, 0);
});

const contm = await import("../src/lib/smc/seq/continuation.ts");
const dayRead = (sym, Y, M, D, nowH) => {
  const m = yahoo(sym).filter((b) => b.t % 60e3 === 0);
  const cut = Date.UTC(Y, M - 1, D, 13, 26);
  const map = pm.premarketMap({ symbol: sym, minute: m.filter((b) => b.t + 60e3 <= cut && b.t > cut - 12 * 864e5), nowMs: cut });
  const bars = m.filter((b) => b.t > cut - 6 * 36e5);
  const now = Date.UTC(Y, M - 1, D, nowH, 0);
  const amd = amdm.amdRead(sym, map, bars, now);
  return { map, bars, now, amd, cont: contm.continuationRead(sym, map, bars, now, amd) };
};
test("F9 continuation: 10/13 ES — real stops beyond entry, T1 is a mapped name, never counted as a second AMD entry", { skip: !fsmod.existsSync("/workspace/audits/seq-data/yahoo-1m-ES.json") }, () => {
  const d = dayRead("ES", 2026, 10, 13, 16);
  assert.ok(d.cont.setups.length >= 1);
  const names = new Set([...d.map.levels.map((l) => l.name), "15m", "30m", "1h", "4h", "1D"]);
  for (const s of d.cont.setups) {
    assert.ok(s.side === "short" ? s.stop > s.entry : s.stop < s.entry, "stop beyond entry");
    assert.ok(d.map.levels.some((l) => s.t1.name.split(" = ").includes(l.name)) || /^(15m|30m|1h|4h|1D) /.test(s.t1.name), `T1 ${s.t1.name} is mapped`);
    assert.equal(s.regime, "trend");
  }
  assert.equal(d.amd.setups.filter((s) => s.stage === "ENTERED").length, dayRead("ES", 2026, 10, 13, 16).amd.setups.filter((s) => s.stage === "ENTERED").length);
});
test("F9 continuation: no lookahead — setups armed before T are identical when read at T and later", { skip: !fsmod.existsSync("/workspace/audits/seq-data/yahoo-1m-ES.json") }, () => {
  const a = dayRead("ES", 2026, 10, 13, 15), b = dayRead("ES", 2026, 10, 13, 16);
  const T = a.now;
  const pre = (r) => r.cont.setups.filter((s) => s.armedT <= T - 30 * 60e3).map((s) => [s.side, s.armedT, s.parentT].join());
  assert.deepEqual(pre(a), pre(b));
});
test("F9 regimeAt: trend needs two consecutive closed 15m closes beyond the open", () => {
  const t0 = Date.UTC(2026, 9, 14, 13, 30);
  const mk = (k, c) => ({ t: t0 + k * 60e3, o: c, h: c + 1, l: c - 1, c, v: 1 });
  const bars = [...Array(30)].map((_, k) => mk(k, k < 15 ? 99 : 98));
  assert.equal(contm.regimeAt(bars, 100, "short", t0 + 30 * 60e3), "trend");
  assert.equal(contm.regimeAt(bars, 100, "short", t0 + 15 * 60e3), "range");
  assert.equal(contm.regimeAt(bars, 100, "long", t0 + 30 * 60e3), "range");
});

const ix = await import("../src/lib/smc/seq/intraday-exec.ts");
test("F10 intradayTicket: 0DTE before 14:30 ET at a live cross; skewed quotes / model strike refused", () => {
  const am = Date.UTC(2026, 9, 14, 13, 55); // 09:55 ET
  const fut = { price: 30580, marketTimeMs: am }, etf = { price: 611.6, marketTimeMs: am - 5e3 };
  const t = ix.intradayTicket({ book: "MNQ", side: "short", nowMs: am, entry: 30582.75, fut, etfQuote: etf, strikeSource: "chain" });
  assert.equal(t.etf, "QQQ"); assert.equal(t.dte, 0); assert.equal(t.right, "put"); assert.equal(t.refused, null);
  assert.equal(t.strike, Math.round(30582.75 * (611.6 / 30580)));
  assert.match(ix.intradayTicket({ book: "MNQ", side: "short", nowMs: am, entry: 1, fut, etfQuote: { ...etf, marketTimeMs: am - 300e3 } }).refused, /not simultaneous/);
  assert.match(ix.intradayTicket({ book: "MNQ", side: "short", nowMs: am, entry: 1, fut, etfQuote: null }).refused, /no live ETF cross/);
  assert.match(ix.intradayTicket({ book: "ES", side: "long", nowMs: am, entry: 1, fut, etfQuote: etf, strikeSource: "model" }).refused, /model strike/);
  const pm2 = Date.UTC(2026, 9, 14, 19, 0); // 15:00 ET
  assert.ok(ix.intradayTicket({ book: "ES", side: "long", nowMs: pm2, entry: 1, fut, etfQuote: etf }).dte >= 1);
});
test("F10 rungEval: wick = sweep, body close = fail/respect, closed bars only; stale feed refuses", () => {
  const t0 = Date.UTC(2026, 9, 14, 13, 30);
  const arr = [{ tf: "15m", kind: "fvg", dir: "bear", lo: 100, hi: 102, ce: 101, live: true, t: 0 }];
  const bars = [...Array(14)].map((_, k) => ({ t: t0 + k * 60e3, o: 99, h: 99.5, l: 98.5, c: 99, v: 1 }));
  const sweep = [...bars, { t: t0 + 14 * 60e3, o: 99, h: 103, l: 98.9, c: 99.5, v: 1 }];
  const r = ix.rungEval(sweep, t0 + 15 * 60e3, arr);
  assert.equal(r.stale, false);
  assert.equal(r.rungs.find((x) => x.tf === "1m").events[0].event, "sweep");
  const fail = [...bars, { t: t0 + 14 * 60e3, o: 99, h: 103, l: 98.9, c: 102.5, v: 1 }];
  assert.equal(ix.rungEval(fail, t0 + 15 * 60e3, arr).rungs.find((x) => x.tf === "1m").events[0].event, "fail");
  // a forming bar (closes after feed now) is never read: the 1m read is the PREVIOUS closed bar
  assert.equal(ix.rungEval(fail, t0 + 14 * 60e3 + 30e3, arr).stale, false);
  assert.equal(ix.rungEval(fail.slice(0, -1), t0 + 14 * 60e3 + 30e3, arr).rungs.find((x) => x.tf === "1m").events.length, 0);
  assert.equal(ix.rungEval(bars, t0 + 30 * 60e3, arr).stale, true);
});

test("F9 regression (Keaton 10/14 ES 09:55 ET short): arms ≈7827 with T1 the 1h swing low 7783, stop at the 08:30-ET gap CE; no lookahead", { skip: !fsmod.existsSync("/workspace/audits/seq-data/yahoo-1m-ES.json") }, () => {
  const d = dayRead("ES", 2026, 10, 14, 16);
  const k = d.cont.setups.find((s) => s.side === "short" && s.log.some((l) => /armed 782[5-9]/.test(l) && /swing low 7783/.test(l) && /CE of the 15m bear gap 7838.25–7870.75/.test(l)));
  assert.ok(k, "the 09:55 short arms at ≈7827 → T1 7783");
  assert.match(k.log[0], /1h/); assert.match(k.log[0], /stop 7854.5/);
  const at = Date.UTC(2026, 9, 14, 14, 0); // 10:00 ET read sees the same arm (prefix)
  const e = dayRead("ES", 2026, 10, 14, 14);
  const early = contm.continuationRead("ES", e.map, e.bars, at, amdm.amdRead("ES", e.map, e.bars, at));
  assert.ok(early.setups.some((s) => s.side === "short" && s.armedT === k.armedT && /armed 782[5-9]/.test(s.log[0])));
});
test("EQH/EQL: every rung, ticks floor, swept → used; today ES pools", async () => {
  const eq = await import("../src/lib/smc/seq/eq-pools.ts");
  const t0 = Date.UTC(2026, 9, 14, 13, 0); const mk = (k, h, l) => ({ t: t0 + k * 60e3, o: (h + l) / 2, h, l, c: (h + l) / 2, v: 1 });
  const hs = [10, 11, 12, 15, 12, 11, 10, 11, 12, 15.25, 12, 11, 10, 11, 10];
  const bars = hs.map((h, k) => mk(k, h, h - 2));
  const p = eq.eqPoolsOn(bars, "1m", 0.25, t0 + 15 * 60e3).find((x) => x.side === "buyside");
  assert.ok(p && p.price === 15.25 && p.touches === 2 && !p.used, "EQH at the extreme, unswept");
  const swept = eq.eqPoolsOn([...bars, mk(15, 15.5, 13), mk(16, 12, 10)], "1m", 0.25, t0 + 17 * 60e3).find((x) => x.side === "buyside" && x.price === 15.25);
  assert.ok(swept.used && swept.sweptT === t0 + 15 * 60e3, "a wick through marks it used");
  if (fsmod.existsSync("/workspace/audits/seq-data/yahoo-1m-ES.json")) {
    const m = yahoo("ES").filter((b) => b.t % 60e3 === 0); const c = Date.UTC(2026, 9, 14, 13, 26);
    const map = pm.premarketMap({ symbol: "ES", minute: m.filter((b) => b.t + 60e3 <= c && b.t > c - 12 * 864e5), nowMs: c });
    const live = map.pools.filter((x) => !x.used), used = map.pools.filter((x) => x.used);
    assert.ok(live.some((x) => x.price === 7834.5 && x.side === "sellside"), "4h EQL 7834.5 unswept at 09:25");
    assert.ok(used.length > 0 && used.every((u) => !pm.mappedTargets(map, "short", 9e9).some((t) => t.price === u.price && /EQ/.test(t.name))), "used pools are never targets");
    assert.ok(!pm.mappedTargets(map, "long", 0).some((t) => /PDL|\blow\b/.test(t.name)), "a low is never a buyside target");
  }
});

test("F2 scenarios: four scripts, priors sum to 1, draws are real liquidity; realised() classifies", async () => {
  const sc = await import("../src/lib/smc/seq/scenarios.ts");
  if (fsmod.existsSync("/workspace/audits/seq-data/yahoo-1m-MNQ.json")) {
    const m = yahoo("MNQ").filter((b) => b.t % 60e3 === 0); const c = Date.UTC(2026, 9, 14, 13, 26);
    const map = pm.premarketMap({ symbol: "MNQ", minute: m.filter((b) => b.t + 60e3 <= c && b.t > c - 12 * 864e5), nowMs: c });
    const r = sc.scenarios(map);
    assert.equal(r.ranked.length, 4);
    assert.ok(Math.abs(r.ranked.reduce((a, x) => a + x.prior, 0) - 1) < 0.01);
    assert.equal(r.ranked[0].id, "S1-bear"); // 10/14: bear stack, expect the high raid — matches what played
    for (const s of r.ranked) for (const d of s.draws) assert.ok(d.liq);
  }
  const t0 = 0; const mk = (k, h, l, o, c) => ({ t: t0 + k * 60e3, o, h, l, c });
  const up = [...Array(40)].map((_, k) => mk(k, 100 + k, 99 + k, 99.5 + k, 100 + k)); up[2] = mk(2, 101, 90, 100, 100);
  assert.equal(sc.realised(up), "S1'-bull");
  const lr = sc.fitLr([{ feats: ["a"], y: "S1-bear" }, { feats: ["b"], y: "S1'-bull" }]);
  assert.ok(lr.a["S1-bear"] > lr.a["S1'-bull"]);
});
test("F3 respect: a body close back on the array side is held, through it is failed", async () => {
  const rs = await import("../src/lib/smc/seq/respect.ts");
  const t0 = Date.UTC(2026, 9, 14, 13, 0);
  const map = { arrays: [{ tf: "15m", kind: "fvg", dir: "bear", lo: 100, hi: 102, ce: 101, live: true, t: 0 }, { tf: "1h", kind: "fvg", dir: "bull", lo: 90, hi: 92, ce: 91, live: true, t: 0 }] };
  const bars = [...Array(60)].map((_, k) => ({ t: t0 + k * 60e3, o: 96, h: 97, l: 95, c: 96, v: 1 }));
  bars[40] = { ...bars[40], h: 101, c: 99 };  // 09:40 ET taps the bear gap, closes below → held (bear)
  bars[45] = { ...bars[45], l: 91, c: 89 };   // taps the bull gap, closes through → failed (bull)
  const r = rs.respectRead("ES", map, bars, t0 + 60 * 60e3);
  assert.equal(r.tiers.all.bear, 1); assert.equal(r.tiers.all.bull, -1); assert.equal(r.tiers.all.net, -2); assert.equal(r.tiers.all.stronger, "bear");
});
test("F8 calibrate: isotonic is monotone; E[R] and the minEdgeR shadow gate", async () => {
  const cb = await import("../src/lib/smc/seq/calibrate.ts");
  const t = cb.isotonic([{ x: 1, y: 1 }, { x: 2, y: 0 }, { x: 3, y: 1 }, { x: 4, y: 1 }]);
  for (let i = 1; i < t.length; i++) assert.ok(t[i].p >= t[i - 1].p);
  assert.equal(cb.edgeR(0.5, 2), 0.5);
  const e = cb.edgeRead(1.2, 1.2, [{ x: 1.5, p: 0.4 }]);
  assert.equal(e.p, 0.4); assert.ok(e.wouldRefuse);
});
