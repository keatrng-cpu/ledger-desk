/**
 * Ladder calibration (wire.deskSeq.ladder, display-only). Usage:
 *   npx tsx scripts/calibrate-ladder.mts <yahoo-60m-MNQ.json> <yahoo-1d-MNQ.json> <yahoo-60m-ES.json> <yahoo-1d-ES.json>
 * (raw Yahoo chart payloads: MNQ=F / ES=F, range 2y interval 60m, range 5y interval 1d).
 *
 * For every session date with >= 120 days of 1h history: cut at the 10:00 ET hourly open (levels from bars CLOSED
 * before it — no lookahead), price = that bar's open. Levels/clusters/entries come from src/lib/smc/seq/ladder.ts
 * itself, so the table measures exactly what the card shows. Outcomes on later 1h bars only:
 *   touchSession  P(level touched by 16:00 ET same session)   key group|distATR1h-bucket
 *   touch5d       P(level touched within the next 5 sessions)  same key
 *   entryFill     P(entry touched by 16:00 ET)                  key array|sweep + dist bucket
 *   entryWin      P(T1 (first target >= 1R) before stop | fill), 5 sessions max, bar that hits both = LOSS
 * Fitted on the first 80% of sessions (train); the last 20% (holdout) only scores Brier vs the base rate.
 * 1h granularity: a touch is a wick reaching the level; sweep retest = touch of the level (no reclaim test).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { basename } from "node:path";
import { htfLevels, cluster, entriesFor, distBucket, rrBucket, type RawLevel } from "../src/lib/smc/seq/ladder.ts";
import { etOf } from "../src/lib/smc/seq/rules.ts";
import { sessionKeyOf } from "../src/lib/smc/smc-unity.ts";

type B = { t: number; o: number; h: number; l: number; c: number; v: number };
const load = (f: string): B[] => { const r = JSON.parse(readFileSync(f, "utf8")).chart.result[0]; const q = r.indicators.quote[0]; return r.timestamp.map((t: number, k: number) => ({ t: t * 1000, o: q.open[k], h: q.high[k], l: q.low[k], c: q.close[k], v: q.volume[k] ?? 0 })).filter((b: B) => b.o != null && b.h != null && b.l != null && b.c != null); };
type Cell = { hit: number; n: number };
const tab = () => ({} as Record<string, Cell>);
const bump = (t: Record<string, Cell>, k: string, hit: boolean) => { const c = (t[k] ??= { hit: 0, n: 0 }); c.n++; if (hit) c.hit++; };

const [hM, dM, hE, dE] = process.argv.slice(2);
// Reproducibility receipt: sha256 of every raw Yahoo payload + its bar span. Re-running on files with these hashes
// must reproduce the tables and the Brier scores below byte-for-byte (scripts/ladder.test.mjs checks the shape).
const inputs = ([["MNQ 60m", hM], ["MNQ 1d", dM], ["ES 60m", hE], ["ES 1d", dE]] as const).map(([what, f]) => {
  const raw = readFileSync(f!); const b = load(f!);
  return { what, file: basename(f!), sha256: createHash("sha256").update(raw).digest("hex"), bytes: raw.length, bars: b.length, firstT: new Date(b[0]!.t).toISOString(), lastT: new Date(b.at(-1)!.t).toISOString() };
});
const books: [string, B[], B[]][] = [["MNQ", load(hM!), load(dM!)], ["ES", load(hE!), load(dE!)]];
const rows: { book: string; day: string; tab: string; key: string; hit: boolean }[] = [];
for (const [sym, h1, d1] of books) {
  const bySess = new Map<string, B[]>();
  for (const b of h1) { const k = sessionKeyOf(b.t); (bySess.get(k) ?? bySess.set(k, []).get(k)!).push(b); }
  const keys = [...bySess.keys()];
  for (let si = 0; si < keys.length; si++) {
    const day = keys[si]!;
    const bars = bySess.get(day)!;
    const cutBar = bars.find((b) => etOf(b.t).day === day && etOf(b.t).hm === 600);
    if (!cutBar || cutBar.t - h1[0]!.t < 120 * 86_400_000) continue;
    const cut = cutBar.t, px = cutBar.o;
    const endT = bars.find((b) => b.t > cut && etOf(b.t).hm >= 960)?.t ?? bars.at(-1)!.t + 3_600_000;
    const sess = bars.filter((b) => b.t >= cut && b.t < endT);
    const next5 = keys.slice(si + 1, si + 6).flatMap((k) => bySess.get(k)!);
    const fwd5 = [...bars.filter((b) => b.t >= cut), ...next5];
    if (sess.length < 4 || next5.length < 20) continue;
    const h = htfLevels({ symbol: sym, hourly: h1, daily: d1, cutT: cut });
    if (!h.atr1h) continue;
    const above = h.levels.filter((l) => l.price > px && (l.side === "high" || l.group === "gap") && (l.group !== "gap" || l.side === "high"));
    const below = h.levels.filter((l) => l.price < px && (l.side === "low" || l.group === "gap") && (l.group !== "gap" || l.side === "low"));
    const hiS = Math.max(...sess.map((b) => b.h)), loS = Math.min(...sess.map((b) => b.l));
    const hi5 = Math.max(...fwd5.map((b) => b.h)), lo5 = Math.min(...fwd5.map((b) => b.l));
    const tL = cluster(above, px, "long", h.atr1h, 0.25), tS = cluster(below, px, "short", h.atr1h, 0.25);
    for (const t of tL) { const k = `${t.group}|${distBucket(t.distAtr)}`; rows.push({ book: sym, day, tab: "touchSession", key: k, hit: hiS >= t.touch }, { book: sym, day, tab: "touch5d", key: k, hit: hi5 >= t.touch }); }
    for (const t of tS) { const k = `${t.group}|${distBucket(t.distAtr)}`; rows.push({ book: sym, day, tab: "touchSession", key: k, hit: loS <= t.touch }, { book: sym, day, tab: "touch5d", key: k, hit: lo5 <= t.touch }); }
    const arrays = h.gaps.map((g) => ({ tf: g.tf as "1h", kind: "fvg" as const, dir: g.dir, lo: g.lo, hi: g.hi, ce: (g.lo + g.hi) / 2, live: true, t: 0 }));
    const swings: RawLevel[] = h.levels.filter((l) => l.group !== "gap");
    for (const [side, tg] of [["long", tL], ["short", tS]] as const) {
      for (const e of entriesFor(side, px, h.atr1h, 0.25, arrays, swings, tg)) {
        if (!e.valid) continue;
        const long = side === "long";
        const fillIdx = sess.findIndex((b) => (long ? b.l <= e.entry : b.h >= e.entry));
        rows.push({ book: sym, day, tab: "entryFill", key: `${e.kind === "sweep retest" ? "sweep" : "array"}|${distBucket(e.distAtr)}`, hit: fillIdx >= 0 });
        const t1 = e.targets.find((t) => t.r >= 1);
        if (fillIdx < 0 || !t1) continue;
        const path = fwd5.slice(fwd5.indexOf(sess[fillIdx]!));
        let win: boolean | null = null;
        for (const b of path) {
          const stopHit = long ? b.l <= e.stop : b.h >= e.stop, tHit = long ? b.h >= t1.touch : b.l <= t1.touch;
          if (stopHit) { win = false; break; }
          if (tHit) { win = true; break; }
        }
        if (win != null) rows.push({ book: sym, day, tab: "entryWin", key: rrBucket(t1.r), hit: win });
      }
    }
  }
}
const days = [...new Set(rows.map((r) => r.day))].sort();
const split = days[Math.floor(days.length * 0.8)]!;
const fit: Record<string, Record<string, Cell>> = { touchSession: tab(), touch5d: tab(), entryFill: tab(), entryWin: tab() };
for (const r of rows) if (r.day < split) bump(fit[r.tab]!, r.key, r.hit);
const brier: Record<string, { n: number; table: number; base: number }> = {};
for (const tn of Object.keys(fit)) {
  const tr = rows.filter((r) => r.tab === tn && r.day < split), ho = rows.filter((r) => r.tab === tn && r.day >= split);
  const base = tr.filter((r) => r.hit).length / Math.max(1, tr.length);
  let bt = 0, bb = 0, n = 0;
  for (const r of ho) { const c = fit[tn]![r.key]; if (!c || c.n < 30) continue; const p = c.hit / c.n; bt += (p - +r.hit) ** 2; bb += (base - +r.hit) ** 2; n++; }
  brier[tn] = { n, table: +(bt / Math.max(1, n)).toFixed(4), base: +(bb / Math.max(1, n)).toFixed(4) };
}
// Brier per holdout session (table vs train base rate), so a single bad day is visible instead of averaged away.
const brierBySession: Record<string, Record<string, { n: number; table: number; base: number }>> = {};
for (const tn of Object.keys(fit)) {
  const tr = rows.filter((r) => r.tab === tn && r.day < split);
  const base = tr.filter((r) => r.hit).length / Math.max(1, tr.length);
  const acc = new Map<string, { n: number; bt: number; bb: number }>();
  for (const r of rows) {
    if (r.tab !== tn || r.day < split) continue;
    const c = fit[tn]![r.key]; if (!c || c.n < 30) continue;
    const a = acc.get(r.day) ?? acc.set(r.day, { n: 0, bt: 0, bb: 0 }).get(r.day)!;
    a.n++; a.bt += (c.hit / c.n - +r.hit) ** 2; a.bb += (base - +r.hit) ** 2;
  }
  for (const [d, a] of [...acc].sort()) (brierBySession[d] ??= {})[tn] = { n: a.n, table: +(a.bt / a.n).toFixed(4), base: +(a.bb / a.n).toFixed(4) };
}
const out = {
  inputs,
  method: `empirical hit rate by level group × distance (ATR1h), Yahoo 60m MNQ=F+ES=F, ${days[0]}→${days.at(-1)}, train < ${split} (${days.filter((d) => d < split).length} sessions), holdout ${days.filter((d) => d >= split).length} sessions; cut 10:00 ET; cells n<30 shown as n/a`,
  train: { from: days[0], to: split, sessions: days.filter((d) => d < split).length },
  holdout: { from: split, to: days.at(-1), sessions: days.filter((d) => d >= split).length, brier, brierBySession },
  ...fit,
};
writeFileSync(new URL("../src/lib/smc/seq/ladder-calibration.json", import.meta.url), JSON.stringify(out, null, 1) + "\n");
console.log(JSON.stringify({ inputs, train: out.train, holdout: { ...out.holdout, brierBySession: undefined } }, null, 1));
console.log("\nBrier per holdout session (table/base, n):");
for (const [d, t] of Object.entries(brierBySession)) console.log(`  ${d} ` + Object.entries(t).map(([k, v]) => `${k} ${v.table}/${v.base} n=${v.n}`).join(" | "));
for (const tn of Object.keys(fit)) { console.log(`\n${tn}`); for (const [k, c] of Object.entries(fit[tn]!).sort()) console.log(`  ${k.padEnd(22)} ${c.n < 30 ? "n/a " : (c.hit / c.n).toFixed(2)}  n=${c.n}`); }
