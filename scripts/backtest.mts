/**
 * Nightly / branch backtest. Fetches Yahoo 1m (7-day chunks, up to 20 sessions) for NQ=F and ES=F,
 * replays every session through src/lib/backtest/engine.ts (shared detectors + shared/desk-rules.json),
 * walk-forward split (last 25% of sessions = holdout; never used for tuning), and diffs vs the last run.
 * Usage: npx tsx scripts/backtest.mts [days=10] [--out ai/backtest/latest.json] [--md out.md]
 * Never fabricates: a session with no bars is skipped and listed.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { replayDay, summarize, splitDays, diffSummaries, type Bar, type Trade } from "../src/lib/backtest/engine";
import { et } from "../src/lib/smc/day-context";
const args = process.argv.slice(2);
const days = Math.min(20, Math.max(5, Number(args.find((a) => /^\d+$/.test(a)) ?? 10)));
const outPath = args[args.indexOf("--out") + 1] && args.includes("--out") ? args[args.indexOf("--out") + 1]! : "ai/backtest/latest.json";
const mdPath = args.includes("--md") ? args[args.indexOf("--md") + 1]! : null;

async function chunk(sym: string, p1: number, p2: number): Promise<Bar[]> {
  const u = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1m&period1=${p1}&period2=${p2}&includePrePost=true`;
  const r = await fetch(u, { headers: { "user-agent": "Mozilla/5.0" } });
  if (!r.ok) return [];
  const j = await r.json(); const res = j?.chart?.result?.[0]; if (!res?.timestamp) return [];
  const q = res.indicators.quote[0];
  return res.timestamp.map((t: number, i: number) => ({ t: t * 1000, o: q.open[i], h: q.high[i], l: q.low[i], c: q.close[i], v: q.volume[i] ?? 0 }))
    .filter((b: Bar) => [b.o, b.h, b.l, b.c].every((x) => x != null));
}
async function load(sym: string): Promise<Bar[]> {
  const now = Math.floor(Date.now() / 1000); const out: Bar[] = [];
  const span = Math.ceil((days * 1.5 + 2) / 7);
  for (let k = span; k >= 1; k--) out.push(...(await chunk(sym, now - k * 7 * 86400, now - (k - 1) * 7 * 86400)));
  const m = new Map(out.map((b) => [b.t, b])); return [...m.values()].sort((a, b) => a.t - b.t);
}
const book: Record<string, string> = { MNQ: "NQ=F", ES: "ES=F" };
const trades: Trade[] = []; const skipped: string[] = []; const sessions = new Set<string>();
for (const [sym, y] of Object.entries(book)) {
  const m1 = await load(y);
  const byDay = new Map<string, Bar[]>();
  for (const b of m1) { const e = et(b.t); if (e.wd === "Sat" || e.wd === "Sun") continue; const k = new Date(b.t - 4 * 3600_000).toISOString().slice(0, 10); (byDay.get(k) ?? byDay.set(k, []).get(k)!).push(b); }
  const keys = [...byDay.keys()].sort().slice(-days);
  for (const d of keys) {
    const bars = byDay.get(d)!; const rth = bars.filter((b) => { const m = et(b.t).min; return m >= 570 && m <= 960; });
    if (rth.length < 300) { skipped.push(`${sym} ${d} (${rth.length} RTH bars)`); continue; }
    sessions.add(d);
    const hist = m1.filter((b) => b.t < rth[0]!.t && b.t > rth[0]!.t - 3 * 86400_000);
    const h15: Bar[] = []; for (const b of hist) { const k = Math.floor(b.t / 900_000) * 900_000; const L = h15[h15.length - 1]; if (L && L.t === k) { L.h = Math.max(L.h, b.h); L.l = Math.min(L.l, b.l); L.c = b.c; } else h15.push({ ...b, t: k }); }
    for (const t of replayDay(sym, rth, h15)) trades.push({ ...t, day: d } as Trade & { day: string });
  }
}
const all = [...sessions].sort(); const { train, holdout } = splitDays(all);
const of = (ds: string[]) => trades.filter((t) => ds.includes((t as Trade & { day: string }).day));
const summary = { all: summarize(trades), train: summarize(of(train)), holdout: summarize(of(holdout)),
  MNQ: summarize(trades.filter((t) => t.symbol === "MNQ")), ES: summarize(trades.filter((t) => t.symbol === "ES")) };
const prev = existsSync(outPath) ? JSON.parse(readFileSync(outPath, "utf8")) : null;
const diff = diffSummaries(prev?.summary ?? null, summary);
const rules = JSON.parse(readFileSync("shared/desk-rules.json", "utf8"));
const res = { at: new Date().toISOString(), rulesVersion: rules.version, sessions: all, train, holdout, skipped, summary, diff, trades };
writeFileSync(outPath, JSON.stringify(res, null, 1));
const md = [`### Backtest (${all.length} sessions, rules v${rules.version})`, "", ...diff.map((l) => `- ${l}`), "", `holdout (never tuned on): ${holdout.join(", ")}`, skipped.length ? `skipped: ${skipped.join("; ")}` : ""].join("\n");
if (mdPath) writeFileSync(mdPath, md);
console.log(md);
