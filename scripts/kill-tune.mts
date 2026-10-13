/**
 * LTF-kill threshold replay on Yahoo 1m (5 sessions, RTH 09:30–15:30 ET).
 * Every 5 minutes: rows = mtfArrays(closed 1m so far), kills = ltfReversalsOf.
 * A NEW kill is scored over the next 60 min against ATR15:
 *   right  = price moved ≥ 0.5×ATR15 against the killed side before ≥ 0.5×ATR15 for it
 *   wrong  = the reverse (a normal pullback was killed)
 *   flat   = neither
 * Usage: npx tsx scripts/kill-tune.mts <yahooDir>
 */
import { readFileSync } from "node:fs";
import { mtfArrays } from "../src/lib/smc/mtf-arrays";
import { ltfReversalsOf, setKillParams } from "../src/lib/smc/mtf-context";
import { rollingAtr } from "../src/lib/trading/detectors";
import { et } from "../src/lib/smc/day-context";
const ydir = process.argv[2] ?? "/tmp";
type Bar = { t: number; o: number; h: number; l: number; c: number; v: number };
const load = (s: string, iv: string): Bar[] => {
  const r = JSON.parse(readFileSync(`${ydir}/y_${s}_${iv}.json`, "utf8")).chart.result[0]; const q = r.indicators.quote[0];
  return r.timestamp.map((t: number, i: number) => ({ t: t * 1000, o: q.open[i], h: q.high[i], l: q.low[i], c: q.close[i], v: q.volume[i] ?? 0 })).filter((b: Bar) => [b.o, b.h, b.l, b.c].every((x) => x != null));
};
const grid = [];
for (const ifvg5MaxAge of [4, 6, 8]) for (const rejectWickFrac of [0.4, 0.5, 0.6]) for (const disp1Atr of [1.0, 1.25, 1.5]) grid.push({ ifvg5MaxAge, rejectWickFrac, disp1Atr });
const out: any[] = [];
for (const p of grid) {
  setKillParams(p);
  let right = 0, wrong = 0, flat = 0;
  const bySrc: Record<string, [number, number, number]> = {};
  for (const sym of ["MNQ", "ES"]) {
    const m1 = load(sym, "1m"), m15 = load(sym, "15m");
    const seen = new Set<string>();
    for (let i = 300; i < m1.length; i += 5) {
      const e = et(m1[i]!.t);
      if (e.min < 575 || e.min > 930 || e.wd === "Sat" || e.wd === "Sun") continue;
      const win = m1.slice(Math.max(0, i - 400), i + 1).concat([{ ...m1[i]!, t: m1[i]!.t + 60_000 }]); // trailing "forming" bar, dropped by the detector
      const rows = mtfArrays(sym, win, []);
      const b15 = m15.filter((b) => b.t + 900_000 <= m1[i]!.t);
      const a = rollingAtr(b15 as never); const atr = a[a.length - 1];
      if (!(atr > 0)) continue;
      for (const k of ltfReversalsOf(rows as never, win as never)) {
        const key = `${sym}:${k.against}:${(k as any).killT}`;
        if (seen.has(key)) continue; seen.add(key);
        const px = m1[i]!.c; let res = "flat";
        for (const b of m1.slice(i + 1, i + 61)) {
          const against = k.against === "long" ? px - b.l : b.h - px;
          const forIt = k.against === "long" ? b.h - px : px - b.l;
          if (against >= 0.5 * atr) { res = "right"; break; }
          if (forIt >= 0.5 * atr) { res = "wrong"; break; }
        }
        const src = String(k.why?.[0] ?? "").startsWith("5m") ? "5m IFVG" : "1m reject";
        bySrc[src] ??= [0, 0, 0];
        if (res === "right") { right++; bySrc[src][0]++; } else if (res === "wrong") { wrong++; bySrc[src][1]++; } else { flat++; bySrc[src][2]++; }
      }
    }
  }
  const n = right + wrong;
  out.push({ ...p, kills: right + wrong + flat, right, wrong, flat, precision: n ? +(right / n).toFixed(3) : null, bySrc });
  console.error(JSON.stringify(out[out.length - 1]));
}
console.log(JSON.stringify(out));
