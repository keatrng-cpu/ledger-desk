/**
 * deskSeq backtest over every session in the cached tape (Yahoo 1m NQ=F → MNQ, ES=F → ES; source labelled
 * "yahoo", fetched read-only into /workspace/audits/seq-data). Every read is cut at the bar-close time it
 * would have been made (no lookahead). Usage: npx tsx scripts/backtest-desk-seq.mts [--out file]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { premarketMap } from "../src/lib/smc/seq/premarket-map";
import { sessionKeyOf } from "../src/lib/smc/smc-unity";
import { etOf } from "../src/lib/smc/seq/rules";
type B = { t: number; o: number; h: number; l: number; c: number; v: number };
const args = process.argv.slice(2);
const outPath = args.includes("--out") ? args[args.indexOf("--out") + 1]! : null;
const DIR = "/workspace/audits/seq-data";
const load = (s: string): B[] => (JSON.parse(readFileSync(`${DIR}/yahoo-1m-${s}.json`, "utf8")) as B[]).filter((b) => b.t % 60_000 === 0);
export const TAPE: Record<string, B[]> = { MNQ: load("MNQ"), ES: load("ES") };
export function sessionsOf(m: B[]): string[] {
  const ks = new Map<string, number>();
  for (const b of m) { const e = etOf(b.t); if (e.hm >= 570 && e.hm < 660 && e.wd >= 1 && e.wd <= 5) ks.set(sessionKeyOf(b.t), (ks.get(sessionKeyOf(b.t)) ?? 0) + 1); }
  return [...ks].filter(([, n]) => n >= 80).map(([k]) => k).sort();
}
const at = (k: string, hm: number) => { // epoch ms of ET wall time hm on session day k (DST-safe via etOf probe)
  const guess = Date.parse(`${k}T00:00:00Z`) + (hm + 240) * 60_000;
  const off = etOf(guess).hm - hm; return guess - off * 60_000;
};
const report: Record<string, unknown> = { source: "yahoo 1m (NQ=F→MNQ, ES=F→ES)", at: new Date().toISOString() };
// ---- F1: does the 09:25 map contain the array/level the 09:30–11:00 reversal turned at?
{
  const rows: { sym: string; day: string; ext: string; px: number; hit: string | null; dist: number | null }[] = [];
  for (const sym of ["MNQ", "ES"]) {
    const m = TAPE[sym]!;
    const days = sessionsOf(m);
    for (const day of days.slice(1)) {
      const cut = at(day, 9 * 60 + 26);
      const hist = m.filter((b) => b.t + 60_000 <= cut && b.t > cut - 12 * 86_400_000);
      if (hist.length < 500) continue;
      const map = premarketMap({ symbol: sym, minute: hist, nowMs: cut });
      const rth = m.filter((b) => b.t >= at(day, 570) && b.t < at(day, 660));
      if (rth.length < 60) continue;
      const hi = rth.reduce((a, b) => (b.h > a.h ? b : a)), lo = rth.reduce((a, b) => (b.l < a.l ? b : a));
      // the reversal = the extreme printed first (the manipulation leg), the distribution runs away from it
      const first = hi.t < lo.t ? { kind: "high", px: hi.h } : { kind: "low", px: lo.l };
      const tol = 0.25 * (map.atr15 ?? 0);
      const cands = [...map.levels.map((l) => ({ name: l.name, lo: l.price, hi: l.price })), ...map.arrays.filter((a) => a.live && ["15m", "30m", "1h", "4h", "1D"].includes(a.tf) && a.dir === (first.kind === "high" ? "bear" : "bull")).map((a) => ({ name: `${a.tf} ${a.kind}`, lo: a.lo, hi: a.hi }))];
      let best: { name: string; d: number } | null = null;
      for (const c of cands) { const d = first.px > c.hi ? first.px - c.hi : first.px < c.lo ? c.lo - first.px : 0; if (!best || d < best.d) best = { name: c.name, d }; }
      // null baseline: share of the 09:30–11:00 range lying within tol of some candidate (a random price's hit odds)
      const rlo = lo.l, rhi = hi.h; let cov = 0; const N = 200;
      for (let k = 0; k <= N; k++) { const x = rlo + ((rhi - rlo) * k) / N; if (cands.some((c) => (x > c.hi ? x - c.hi : x < c.lo ? c.lo - x : 0) <= tol)) cov++; }
      rows.push({ sym, day, ext: first.kind, px: first.px, hit: best && best.d <= tol ? best.name : null, dist: best ? +(best.d / (map.atr15 || 1)).toFixed(2) : null, nullRate: +(cov / (N + 1)).toFixed(3) } as never);
    }
  }
  const n = rows.length, h = rows.filter((r) => r.hit).length;
  const nullAvg = n ? +(rows.reduce((a, r) => a + ((r as never as { nullRate: number }).nullRate), 0) / n).toFixed(3) : null;
  report.F1 = { sessions: n, reversalInMap: h, rate: n ? +(h / n).toFixed(3) : null, nullRate: nullAvg, rows };
  console.log(`F1 map (15m–1D arrays + named levels/pools): reversal extreme within 0.25×ATR15: ${h}/${n}; a random price in the 09:30–11:00 range: ${nullAvg}`);
  for (const r of rows) console.log(" ", r.sym, r.day, r.ext, r.px, r.hit ?? `miss (${r.dist} ATR)`);
}
if (outPath) writeFileSync(outPath, JSON.stringify(report, null, 1));
