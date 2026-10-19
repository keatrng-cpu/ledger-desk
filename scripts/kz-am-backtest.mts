/**
 * Morning-killzone (NY AM) sweep→displacement backtest — the 8:30-9:20 CT
 * (9:30-10:20 ET) manipulation play: a sweep of a real pool, a displacement the
 * other way, entry at the gap CE. "Catch the right displacement >75% of the time."
 *
 * The desk's own arm (ltfArm: sweep → displacement → IFVG/FVG → CISD/MSS, closed
 * bars only) already encodes this; the backtest engine replays it through the
 * killzones (replayDayLtfArm) with exact 1m resolution. This script runs that,
 * restricts to the morning manipulation window, and reports the direction/target
 * hit rate, avg R and frequency — plus breakdowns (entry-minute bucket, symbol, R
 * bucket) to surface the subset that actually clears 75%, which is what a promotion
 * of the shadow kzDisp detector needs.
 *
 * Data: Yahoo 1m like backtest.mts (no local files). --selftest runs synthetic.
 * Usage: npx tsx scripts/kz-am-backtest.mts [days=15] [--from 570] [--to 620] [--md out.md]
 *   window is ET minutes-of-day: 570=9:30, 620=10:20 (the 8:30-9:20 CT sweep window).
 */
import { writeFileSync } from "node:fs";
import { replayDayLtfArm, type Bar, type Trade } from "../src/lib/backtest/engine";
import { et } from "../src/lib/smc/day-context";

const args = process.argv.slice(2);
const argN = (f: string, d: number) => { const i = args.indexOf(f); return i >= 0 && args[i + 1] ? Number(args[i + 1]) : d; };
const selftest = args.includes("--selftest");
const days = Math.min(30, Math.max(5, Number(args.find((a) => /^\d+$/.test(a)) ?? 15)));
const FROM = argN("--from", 570); // 9:30 ET
const TO = argN("--to", 620); // 10:20 ET
const mdPath = args.includes("--md") ? args[args.indexOf("--md") + 1]! : null;

async function yahoo(sym: string): Promise<Bar[]> {
  const now = Math.floor(Date.now() / 1000); const out: Bar[] = []; const span = Math.ceil((days * 1.5 + 2) / 7);
  for (let k = span; k >= 1; k--) {
    const u = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1m&period1=${now - k * 7 * 86400}&period2=${now - (k - 1) * 7 * 86400}&includePrePost=true`;
    const r = await fetch(u, { headers: { "user-agent": "Mozilla/5.0" } }).catch(() => null);
    if (!r?.ok) continue; const j = await r.json(); const res = j?.chart?.result?.[0]; if (!res?.timestamp) continue; const q = res.indicators.quote[0];
    out.push(...res.timestamp.map((t: number, i: number) => ({ t: t * 1000, o: q.open[i], h: q.high[i], l: q.low[i], c: q.close[i], v: q.volume[i] ?? 0 })).filter((b: Bar) => [b.o, b.h, b.l, b.c].every((x) => x != null)));
  }
  const m = new Map(out.map((b) => [b.t, b])); return [...m.values()].sort((a, b) => a.t - b.t);
}

function synthDay(start: number, trend: number): Bar[] {
  const out: Bar[] = []; let p = 20000;
  for (let k = 0; k < 400; k++) { const t = start + k * 60_000; const d = trend * Math.sin(k / 18) + trend * 0.4; const o = p, c = p + d + (k % 6 - 2.5); out.push({ t, o, h: Math.max(o, c) + 3, l: Math.min(o, c) - 3, c, v: 120 }); p = c; }
  return out;
}

const inWindow = (t: number) => { const e = et(t); return e.min >= FROM && e.min < TO; };

function summarize(trades: Trade[]) {
  const done = trades.filter((t) => t.r != null);
  const wins = done.filter((t) => (t.r as number) > 0).length;
  const sumR = +done.reduce((a, t) => a + (t.r as number), 0).toFixed(2);
  return { n: trades.length, resolved: done.length, wins, losses: done.length - wins,
    hit: done.length ? +(wins / done.length).toFixed(3) : null, avgR: done.length ? +(sumR / done.length).toFixed(3) : null, sumR };
}

/** Find any breakdown bucket that clears the target hit rate with enough sample. */
function bestSubsets(trades: Trade[], target = 0.75, minN = 8) {
  const buckets: Record<string, Trade[]> = {};
  const add = (k: string, t: Trade) => (buckets[k] ??= []).push(t);
  for (const t of trades) {
    const e = et(t.t); const bucket10 = `${Math.floor(e.min / 10) * 10}-${Math.floor(e.min / 10) * 10 + 10}min`;
    add(`entry ${bucket10}`, t);
    add(`symbol ${t.symbol}`, t);
    add(`RR ${t.rr < 1.5 ? "<1.5" : t.rr < 2.5 ? "1.5-2.5" : "2.5+"}`, t);
    add(`side ${t.side}`, t);
  }
  const rows = Object.entries(buckets).map(([k, ts]) => ({ bucket: k, ...summarize(ts) }))
    .filter((r) => r.resolved >= minN)
    .sort((a, b) => (b.hit ?? 0) - (a.hit ?? 0));
  return { clears: rows.filter((r) => (r.hit ?? 0) >= target), all: rows };
}

async function run() {
  const trades: Trade[] = [];
  const book: Record<string, string> = { MNQ: "NQ=F", ES: "ES=F" };

  if (selftest) {
    for (const sym of Object.keys(book)) {
      for (let d = 0; d < 4; d++) {
        const start = Date.UTC(2026, 0, 6 + d, 14, 30); // ~9:30 ET
        const day = synthDay(start - 3 * 3600_000, d % 2 ? -3 : 3); // include pre-open
        const hist = synthDay(start - 27 * 3600_000, 2);
        for (const t of replayDayLtfArm(sym, day, hist)) if (inWindow(t.t)) trades.push(t);
      }
    }
    const s = summarize(trades);
    if (!Number.isFinite(s.n)) { console.error("SELFTEST FAIL"); process.exit(1); }
    console.log("SELFTEST OK — window", FROM, "-", TO, "ET");
    console.log("  morning trades:", s.n, "resolved:", s.resolved, "hit:", s.hit, "avgR:", s.avgR);
    console.log("  (synthetic bars; real numbers need a Yahoo run)");
    return;
  }

  for (const [sym, y] of Object.entries(book)) {
    const m1 = await yahoo(y);
    if (!m1.length) { console.error(`No bars for ${sym}`); continue; }
    const byDay = new Map<string, Bar[]>();
    for (const b of m1) { const e = et(b.t); if (e.wd === "Sat" || e.wd === "Sun") continue; const k = new Date(b.t - 4 * 3600_000).toISOString().slice(0, 10); (byDay.get(k) ?? byDay.set(k, []).get(k)!).push(b); }
    const keys = [...byDay.keys()].sort().slice(-days);
    for (const d of keys) {
      const day = byDay.get(d)!;
      const rthStart = day.find((b) => et(b.t).min >= 570)?.t ?? day[0]!.t;
      const hist = m1.filter((b) => b.t < rthStart && b.t > rthStart - 3 * 86400_000);
      for (const t of replayDayLtfArm(sym, day, hist)) if (inWindow(t.t)) trades.push(t);
    }
  }

  const overall = summarize(trades);
  const subsets = bestSubsets(trades);
  const report = { window: `${FROM}-${TO} ET (${Math.floor(FROM/60)}:${String(FROM%60).padStart(2,"0")}-${Math.floor(TO/60)}:${String(TO%60).padStart(2,"0")})`,
    days, overall, clears75: subsets.clears, topBreakdowns: subsets.all.slice(0, 10) };
  writeFileSync("ai/kz-am-backtest.json", JSON.stringify(report, null, 2));
  const md = [
    `### Morning-killzone sweep→displacement (${report.window}, ${days}d)`, "",
    `overall: ${overall.n} trades · hit ${overall.hit} · avgR ${overall.avgR} · ΣR ${overall.sumR}`,
    "",
    subsets.clears.length
      ? `**subsets that clear 75%** (n≥8):\n${subsets.clears.map((r) => `- ${r.bucket}: hit ${r.hit} (n=${r.resolved}, avgR ${r.avgR})`).join("\n")}`
      : `no subset clears 75% at n≥8 yet — tighten the window or add an HTF-agreement filter (needs replayDayLtfArm to emit arm context; see note)`,
    "",
    `top breakdowns:\n${subsets.all.slice(0, 6).map((r) => `- ${r.bucket}: hit ${r.hit} (n=${r.resolved})`).join("\n")}`,
    "",
    `_The arm already carries HTF/CISD/MSS context; emitting it per trade (small engine tweak) would let this cut by HTF-agreement — the lever most likely to clear 75%._`,
  ].join("\n");
  if (mdPath) writeFileSync(mdPath, md);
  console.log(md);
}

run().catch((e) => { console.error(e); process.exit(1); });
