/**
 * A/B measurement harness (SHADOW analysis — reads bars, places nothing).
 *
 * Answers the two questions behind PRs #59/#61/#63 on your own walk-forward data:
 *   A. Option model — OLD linear (delta·move − flat theta − spread) vs NEW convex
 *      (delta·move + ½·gamma·move² − √theta − spread), per trade. "Does the realism
 *      change the measured option P&L, and by how much?"
 *   B. Target selection — futures-R (nearest pool ≥ rrMin, today's rule) vs option-EV
 *      (argmax EV from the convex model + the ladder's T1-before-stop calibration).
 *      "Would picking targets by option EV have paid more than picking by futures R?"
 *
 * Data: fetched from Yahoo exactly like scripts/backtest.mts (no local files needed),
 * replayed through the SAME engine. No lookahead beyond what the engine already does.
 * Part B is a post-hoc re-selection on the engine's own taken signals — an
 * approximation (it does not re-run entry logic), labelled as such.
 *
 * Usage:
 *   npx tsx scripts/ab-measure.mts [days=12] [--out ai/ab-measure.json] [--md out.md]
 *   npx tsx scripts/ab-measure.mts --selftest     # synthetic bars; proves it runs
 */
import { readFileSync, writeFileSync } from "node:fs";
import {
  replayDay, resolve1m, optionPnlPct, minutesToRthClose, DEFAULT_OPT,
  splitDays, type Bar, type Trade, type OptModel,
} from "../src/lib/backtest/engine";
import { rankTargetsByOptionEv, type TargetCand } from "../src/lib/backtest/target-ev";
import { probOf, rrBucket } from "../src/lib/smc/seq/ladder";
import CAL from "../src/lib/smc/seq/ladder-calibration.json";
import { fractalSwings } from "../src/lib/trading/detectors";
import { et } from "../src/lib/smc/day-context";

const RULES = JSON.parse(readFileSync("shared/desk-rules.json", "utf8")) as { rrMin: number; version: number };
const ENTRY_WIN = (CAL as { entryWin?: Record<string, { hit: number; n: number }> }).entryWin;

// ── Part A: old linear vs new convex option P&L for one trade ───────────────
const linear = (o: OptModel): OptModel => ({ ...o, gamma: 0 });
function optOld(t: Trade): number | null {
  const o = DEFAULT_OPT[t.symbol]; if (!o || t.exitPx == null || t.minutes == null) return null;
  return optionPnlPct(linear(o), t.side, t.entry, t.exitPx, t.minutes); // no minutesToExpiry → flat theta
}
function optNew(t: Trade): number | null {
  const o = DEFAULT_OPT[t.symbol]; if (!o || t.exitPx == null || t.minutes == null) return null;
  return optionPnlPct(o, t.side, t.entry, t.exitPx, t.minutes, minutesToRthClose(t.t));
}

// ── Part B: for a taken trade, compare the futures-R target vs the option-EV target ──
export interface AbTargetResult {
  symbol: string; side: "long" | "short"; rChosenRR: number | null; evChosenRR: number | null;
  diverged: boolean; optR: number | null; optEv: number | null; delta: number | null;
}
/**
 * `m1` = the session's 1m bars; `i` = the trade's entry bar index; `levels` = real
 * fractal levels (15m) known at entry. Picks the futures-R target and the option-EV
 * target, resolves each on the exact 1m path, and returns their realized option P&L.
 */
export function compareTargets(
  m1: Bar[], i: number, t: Trade, levels: number[], o: OptModel, timeStopMin = 90,
): AbTargetResult {
  const long = t.side === "long";
  const risk = Math.abs(t.entry - t.stop);
  const ahead = levels
    .filter((l) => (long ? l > t.entry : l < t.entry))
    .map((l) => ({ price: l, rr: +(Math.abs(l - t.entry) / (risk || 1)).toFixed(2) }))
    .sort((a, b) => Math.abs(a.price - t.entry) - Math.abs(b.price - t.entry));
  if (!ahead.length) return { symbol: t.symbol, side: t.side, rChosenRR: null, evChosenRR: null, diverged: false, optR: null, optEv: null, delta: null };
  // futures-R rule: nearest target clearing rrMin (today's engine rule)
  const rPick = ahead.find((a) => a.rr >= RULES.rrMin) ?? ahead[ahead.length - 1]!;
  // option-EV rule: argmax EV from convex model + ladder pWin by R bucket
  const cands: TargetCand[] = ahead.map((a) => ({ price: a.price, rr: a.rr, pWin: probOf(ENTRY_WIN, rrBucket(a.rr)).p }));
  const { best } = rankTargetsByOptionEv(cands, { model: o, side: t.side, entry: t.entry, stop: t.stop, entryTms: t.t });
  const evPick = best ? ahead.find((a) => a.price === best.price)! : rPick;
  const realizedOpt = (targetPrice: number): number | null => {
    const r = resolve1m(m1, i, t.side, t.entry, t.stop, targetPrice, timeStopMin);
    return r.outcome === "open" ? null : optionPnlPct(o, t.side, t.entry, r.px, r.j - i, minutesToRthClose(t.t));
  };
  const optR = realizedOpt(rPick.price);
  const optEv = realizedOpt(evPick.price);
  return {
    symbol: t.symbol, side: t.side, rChosenRR: rPick.rr, evChosenRR: evPick.rr,
    diverged: rPick.price !== evPick.price, optR, optEv,
    delta: optR != null && optEv != null ? +(optEv - optR).toFixed(4) : null,
  };
}

// ── summary helpers ─────────────────────────────────────────────────────────
const mean = (xs: (number | null)[]) => { const v = xs.filter((x): x is number => x != null); return v.length ? +(v.reduce((a, b) => a + b, 0) / v.length).toFixed(4) : null; };
function partA(trades: Trade[]) {
  const olds = trades.map(optOld), news = trades.map(optNew);
  return { trades: trades.length, avgOptOld: mean(olds), avgOptNew: mean(news), deltaMean: mean(trades.map((_, k) => (olds[k] != null && news[k] != null ? news[k]! - olds[k]! : null))) };
}
function partB(results: AbTargetResult[]) {
  const comp = results.filter((r) => r.optR != null && r.optEv != null);
  return { comparable: comp.length, diverged: comp.filter((r) => r.diverged).length, avgOptFuturesR: mean(comp.map((r) => r.optR)), avgOptEvRule: mean(comp.map((r) => r.optEv)), avgDeltaPerTrade: mean(comp.map((r) => r.delta)) };
}

// ── synthetic bars for --selftest ───────────────────────────────────────────
function synthDay(startT: number, trend: number): Bar[] {
  const out: Bar[] = []; let p = 20000;
  for (let k = 0; k < 400; k++) {
    const t = startT + k * 60_000; const drift = trend * Math.sin(k / 25) + trend * 0.3;
    const o = p, c = p + drift + (k % 7 - 3) * 0.5; const h = Math.max(o, c) + 2, l = Math.min(o, c) - 2;
    out.push({ t, o, h, l, c, v: 100 + (k % 5) }); p = c;
  }
  return out;
}

async function yahoo(sym: string, days: number): Promise<Bar[]> {
  const now = Math.floor(Date.now() / 1000); const out: Bar[] = []; const span = Math.ceil((days * 1.5 + 2) / 7);
  for (let k = span; k >= 1; k--) {
    const u = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1m&period1=${now - k * 7 * 86400}&period2=${now - (k - 1) * 7 * 86400}&includePrePost=true`;
    const r = await fetch(u, { headers: { "user-agent": "Mozilla/5.0" } }).catch(() => null);
    if (!r?.ok) continue; const j = await r.json(); const res = j?.chart?.result?.[0]; if (!res?.timestamp) continue; const q = res.indicators.quote[0];
    out.push(...res.timestamp.map((t: number, i: number) => ({ t: t * 1000, o: q.open[i], h: q.high[i], l: q.low[i], c: q.close[i], v: q.volume[i] ?? 0 })).filter((b: Bar) => [b.o, b.h, b.l, b.c].every((x) => x != null)));
  }
  const m = new Map(out.map((b) => [b.t, b])); return [...m.values()].sort((a, b) => a.t - b.t);
}

function h15Of(hist: Bar[]): Bar[] { const h: Bar[] = []; for (const b of hist) { const k = Math.floor(b.t / 900_000) * 900_000; const L = h[h.length - 1]; if (L && L.t === k) { L.h = Math.max(L.h, b.h); L.l = Math.min(L.l, b.l); L.c = b.c; } else h.push({ ...b, t: k }); } return h; }

async function run() {
  const args = process.argv.slice(2);
  const selftest = args.includes("--selftest");
  const days = Math.min(20, Math.max(5, Number(args.find((a) => /^\d+$/.test(a)) ?? 12)));
  const outPath = args.includes("--out") ? args[args.indexOf("--out") + 1]! : "ai/ab-measure.json";
  const mdPath = args.includes("--md") ? args[args.indexOf("--md") + 1]! : null;
  const book: Record<string, string> = { MNQ: "NQ=F", ES: "ES=F" };

  const trades: (Trade & { day: string })[] = [];
  const bRes: AbTargetResult[] = [];
  const sessions = new Set<string>();

  const handleDay = (sym: string, d: string, rth: Bar[], hist: Bar[]) => {
    const h15 = h15Of(hist);
    const dayTrades = replayDay(sym, rth, h15);
    for (const t of dayTrades) {
      trades.push({ ...t, day: d });
      const i = rth.findIndex((b) => b.t === t.t); if (i < 0) continue;
      // real 15m fractal levels known at entry (both kinds)
      const h15AtEntry = h15Of(hist.concat(rth.slice(0, i + 1)));
      const levels = fractalSwings(h15AtEntry.slice(-80), 2).map((s) => s.price);
      const o = DEFAULT_OPT[sym]; if (!o) continue;
      bRes.push(compareTargets(rth, i, t, levels, o));
    }
    sessions.add(d);
  };

  if (selftest) {
    for (const sym of Object.keys(book)) {
      const base = Date.UTC(2026, 0, 6, 14, 30) + 0; // a Tuesday 09:30 ET-ish
      for (let dcount = 0; dcount < 3; dcount++) {
        const start = base + dcount * 86400_000;
        const rth = synthDay(start, dcount === 1 ? -3 : 3);
        handleDay(sym, `synth-${sym}-${dcount}`, rth, synthDay(start - 86400_000, 2));
      }
    }
    // Direct coverage of both analyses regardless of whether replayDay fired:
    const t: Trade = { symbol: "MNQ", side: "long", t: Date.parse("2026-01-06T15:00:00Z"), entry: 20000, stop: 19950, target: 20100, rr: 2, exitT: null, exitPx: 20100, outcome: "target", r: 2, optPnlPct: null, minutes: 20, why: "selftest" };
    const a = { old: optOld(t), neu: optNew(t) };
    const m1 = synthDay(Date.parse("2026-01-06T14:30:00Z"), 3);
    const cmp = compareTargets(m1, 5, t, [20080, 20150, 20260], DEFAULT_OPT.MNQ!);
    if (a.old == null || a.neu == null || !Number.isFinite(cmp.rChosenRR ?? NaN)) { console.error("SELFTEST FAIL: analyses did not produce finite output", a, cmp); process.exit(1); }
    console.log("SELFTEST OK");
    console.log("  Part A (one trade): optOld", a.old, "optNew", a.neu);
    console.log("  Part B (one trade): futures-R rr", cmp.rChosenRR, "ev rr", cmp.evChosenRR, "diverged", cmp.diverged, "optR", cmp.optR, "optEv", cmp.optEv);
    console.log(`  replayDay on synthetic bars produced ${trades.length} trade(s), ${bRes.length} comparable`);
    return;
  }

  for (const [sym, y] of Object.entries(book)) {
    const m1 = await yahoo(y, days);
    if (!m1.length) { console.error(`No bars fetched for ${sym} (${y}). Check network or pass --selftest.`); continue; }
    const byDay = new Map<string, Bar[]>();
    for (const b of m1) { const e = et(b.t); if (e.wd === "Sat" || e.wd === "Sun") continue; const k = new Date(b.t - 4 * 3600_000).toISOString().slice(0, 10); (byDay.get(k) ?? byDay.set(k, []).get(k)!).push(b); }
    for (const d of [...byDay.keys()].sort().slice(-days)) {
      const bars = byDay.get(d)!; const rth = bars.filter((b) => { const m = et(b.t).min; return m >= 570 && m <= 960; });
      if (rth.length < 300) continue;
      const hist = m1.filter((b) => b.t < rth[0]!.t && b.t > rth[0]!.t - 3 * 86400_000);
      handleDay(sym, d, rth, hist);
    }
  }

  const all = [...sessions].sort(); const { holdout } = splitDays(all);
  const inHold = (t: Trade & { day: string }) => holdout.includes(t.day);
  const report = {
    at: new Date().toISOString(), rulesVersion: RULES.version, sessions: all, holdout,
    partA: { all: partA(trades), holdout: partA(trades.filter(inHold)) },
    partB: { all: partB(bRes), note: "post-hoc re-selection on the engine's taken signals; an approximation, not a re-run of entry logic" },
  };
  writeFileSync(outPath, JSON.stringify(report, null, 1));
  const a = report.partA.all, b = report.partB.all;
  const md = [
    `### A/B measurement (${all.length} sessions, rules v${RULES.version})`, "",
    `**A — option model (old linear → new convex), avg option %:**`,
    `- all: ${a.avgOptOld} → ${a.avgOptNew} (Δ ${a.deltaMean})`,
    `- holdout: ${report.partA.holdout.avgOptOld} → ${report.partA.holdout.avgOptNew}`, "",
    `**B — target selection (futures-R → option-EV), avg realized option %:**`,
    `- comparable trades: ${b.comparable}; option-EV chose a different target on ${b.diverged}`,
    `- futures-R rule: ${b.avgOptFuturesR} · option-EV rule: ${b.avgOptEvRule} · Δ/trade ${b.avgDeltaPerTrade}`,
    "", `holdout (never tuned on): ${holdout.join(", ")}`,
    `_Part B is a post-hoc re-selection (approximation); confirm via a full engine re-run before any AR: GO._`,
  ].join("\n");
  if (mdPath) writeFileSync(mdPath, md);
  console.log(md);
}

run().catch((e) => { console.error(e); process.exit(1); });
