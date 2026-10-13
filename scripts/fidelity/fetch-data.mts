// Pull the replay dataset: 1m (Yahoo keeps ~30 days) for futures + context symbols, and 2y daily. Real data only.
import { writeFileSync } from "node:fs";
const OUT = process.env.FID_DATA ?? "/workspace/fidelity-data";
const H = { "user-agent": "Mozilla/5.0" };
async function chart(sym: string, q: string) {
  const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?${q}&includePrePost=true`, { headers: H });
  if (!r.ok) { console.error(sym, q, r.status); return []; }
  const res = (await r.json() as any)?.chart?.result?.[0]; if (!res?.timestamp) return [];
  const k = res.indicators.quote[0];
  return res.timestamp.map((t: number, i: number) => ({ t: t * 1000, o: k.open[i], h: k.high[i], l: k.low[i], c: k.close[i], v: k.volume[i] ?? 0 }))
    .filter((b: any) => [b.o, b.h, b.l, b.c].every((x) => x != null));
}
const end = Math.floor(Date.now() / 1000);
for (const s of ["NQ=F", "ES=F", "SPY", "QQQ", "DX-Y.NYB", "^TNX"]) {
  const m = new Map<number, any>();
  for (let k = 5; k >= 1; k--) for (const b of await chart(s, `interval=1m&period1=${end - k * 7 * 86400}&period2=${end - (k - 1) * 7 * 86400}`)) m.set(b.t, b);
  writeFileSync(`${OUT}/${s}.1m.json`, JSON.stringify([...m.values()].sort((a, b) => a.t - b.t))); console.log(s, "1m", m.size);
}
for (const s of ["MNQ=F", "ES=F"]) { const d = await chart(s, "interval=1d&range=2y"); writeFileSync(`${OUT}/${s}.1d.json`, JSON.stringify(d)); console.log(s, "1d", d.length); }
