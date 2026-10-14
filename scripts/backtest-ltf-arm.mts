/**
 * ltfArm vs the current desk engine, same sessions, same Yahoo 1m tape (7-day chunks, NQ=F / ES=F).
 * Current desk = engine.replayDay (LTF-kill signal, RTH 09:35-15:00); ltfArm = engine.replayDayLtfArm
 * (kill zones only, limit at the gap CE). Usage: npx tsx scripts/backtest-ltf-arm.mts [days=10] [--out file]
 * Read-only: no orders, no network other than Yahoo. Never fabricates: a session with no bars is skipped.
 */
import { writeFileSync } from "node:fs";
import { replayDay, replayDayLtfArm, summarize, type Bar, type Trade } from "../src/lib/backtest/engine";
import { et } from "../src/lib/smc/day-context";
const args = process.argv.slice(2);
const days = Math.min(20, Math.max(1, Number(args.find((a) => /^\d+$/.test(a)) ?? 10)));
const outPath = args.includes("--out") ? args[args.indexOf("--out") + 1]! : null;
async function chunk(sym: string, p1: number, p2: number): Promise<Bar[]> {
  const u = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1m&period1=${p1}&period2=${p2}&includePrePost=true`;
  const r = await fetch(u, { headers: { "user-agent": "Mozilla/5.0" } }); if (!r.ok) return [];
  const j = await r.json(); const res = j?.chart?.result?.[0]; if (!res?.timestamp) return [];
  const q = res.indicators.quote[0];
  return res.timestamp.map((t: number, i: number) => ({ t: t * 1000, o: q.open[i], h: q.high[i], l: q.low[i], c: q.close[i], v: q.volume[i] ?? 0 })).filter((b: Bar) => [b.o, b.h, b.l, b.c].every((x) => x != null));
}
async function load(sym: string): Promise<Bar[]> {
  const now = Math.floor(Date.now() / 1000); const out: Bar[] = [];
  const span = Math.ceil((days * 1.5 + 2) / 7);
  for (let k = span; k >= 1; k--) out.push(...(await chunk(sym, now - k * 7 * 86400, now - (k - 1) * 7 * 86400)));
  const m = new Map(out.map((b) => [b.t, b])); return [...m.values()].sort((a, b) => a.t - b.t);
}
const book: Record<string, string> = { MNQ: "NQ=F", ES: "ES=F" };
const desk: (Trade & { day: string })[] = [], arm: (Trade & { day: string })[] = [], skipped: string[] = [];
for (const [sym, y] of Object.entries(book)) {
  const m1 = await load(y);
  const byDay = new Map<string, Bar[]>();
  for (const b of m1) { const e = et(b.t); if (e.wd === "Sat" || e.wd === "Sun") continue; const k = new Date(b.t - 4 * 3600_000).toISOString().slice(0, 10); (byDay.get(k) ?? byDay.set(k, []).get(k)!).push(b); }
  for (const d of [...byDay.keys()].sort().slice(-days)) {
    const bars = byDay.get(d)!; const rth = bars.filter((b) => { const m = et(b.t).min; return m >= 570 && m <= 960; });
    if (rth.length < 60) { skipped.push(`${sym} ${d} (${rth.length} RTH bars)`); continue; }
    const hist = m1.filter((b) => b.t < bars[0]!.t && b.t > bars[0]!.t - 3 * 86400_000);
    const h15: Bar[] = []; for (const b of m1.filter((b) => b.t < rth[0]!.t && b.t > rth[0]!.t - 3 * 86400_000)) { const k = Math.floor(b.t / 900_000) * 900_000; const L = h15[h15.length - 1]; if (L && L.t === k) { L.h = Math.max(L.h, b.h); L.l = Math.min(L.l, b.l); L.c = b.c; } else h15.push({ ...b, t: k }); }
    for (const t of replayDay(sym, rth, h15)) desk.push({ ...t, day: d });
    for (const t of replayDayLtfArm(sym, bars, hist)) arm.push({ ...t, day: d });
  }
}
const longs = (x: Trade[]) => x.filter((t) => t.side === "long"), shorts = (x: Trade[]) => x.filter((t) => t.side === "short");
const days_ = [...new Set([...desk, ...arm].map((t) => t.day))].sort();
const rep = { at: new Date().toISOString(), days: days_, skipped,
  desk: { all: summarize(desk), long: summarize(longs(desk)), short: summarize(shorts(desk)) },
  ltfArm: { all: summarize(arm), long: summarize(longs(arm)), short: summarize(shorts(arm)), MNQ: summarize(arm.filter((t) => t.symbol === "MNQ")), ES: summarize(arm.filter((t) => t.symbol === "ES")) },
  ltfArmTrades: arm.map((t) => ({ day: t.day, sym: t.symbol, side: t.side, at: new Date(t.t).toLocaleString("en-US", { timeZone: "America/New_York", hour12: false }), entry: t.entry, stop: t.stop, target: t.target, outcome: t.outcome, r: t.r, why: t.why })) };
console.log(JSON.stringify({ days: rep.days, skipped, desk: rep.desk, ltfArm: rep.ltfArm }, null, 1));
for (const t of rep.ltfArmTrades) console.log(t.day, t.sym, t.side, t.at, "entry", t.entry, "stop", t.stop, "T1", t.target, t.outcome, t.r, "|", t.why);
if (outPath) writeFileSync(outPath, JSON.stringify(rep, null, 1));
