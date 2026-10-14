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
    assert.ok(names.has(s.t1.name) || /^(15m|30m|1h|4h|1D) /.test(s.t1.name), `T1 ${s.t1.name} is mapped`);
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
