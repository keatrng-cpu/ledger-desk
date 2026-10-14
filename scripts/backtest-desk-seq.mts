/**
 * deskSeq backtest over every session in the cached tape (Yahoo 1m NQ=F → MNQ, ES=F → ES; source labelled
 * "yahoo", fetched read-only into /workspace/audits/seq-data). Every read is cut at the bar-close time it
 * would have been made (no lookahead). Usage: npx tsx scripts/backtest-desk-seq.mts [--out file]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { premarketMap } from "../src/lib/smc/seq/premarket-map";
import { sessionKeyOf } from "../src/lib/smc/smc-unity";
import { etOf } from "../src/lib/smc/seq/rules";
import { setSeqOverrides } from "../src/lib/smc/seq/rules";
import { replayDay, replayDayLtfArm, resolve1m, optionPnlPct, DEFAULT_OPT, summarize, resample, type Trade } from "../src/lib/backtest/engine";
import { amdRead, type AmdSetup } from "../src/lib/smc/seq/amd-state";
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

// ---- current desk (replayDay), ltfArm (replayDayLtfArm) and the AMD state machine on the SAME sessions
const CAP = 650;
export function seqTrades(sym: string, m: B[], day: string, opts: { timeStopMin?: number } = {}): (Trade & { day: string; setup: AmdSetup })[] {
  const cut = at(day, 9 * 60 + 26);
  const hist = m.filter((b) => b.t + 60_000 <= cut && b.t > cut - 12 * 86_400_000);
  if (hist.length < 500) return [];
  const map = premarketMap({ symbol: sym, minute: hist, nowMs: cut });
  const end = at(day, 16 * 60);
  const bars = m.filter((b) => b.t > cut - 6 * 3_600_000 && b.t < end);
  const r = amdRead(sym, map, bars, at(day, 11 * 60 + 1));
  const out: (Trade & { day: string; setup: AmdSetup })[] = [];
  for (const s of r.setups.filter((x) => x.stage === "ENTERED")) {
    const fill = bars.findIndex((b) => b.t + 60_000 === s.enteredT);
    if (fill < 0) continue;
    const fb = bars[fill]!;
    const stopOnFill = s.side === "long" ? fb.l <= s.stop! : fb.h >= s.stop!;
    const res = resolve1m(bars, fill, s.side, s.entry!, s.stop!, s.t1!.price, opts.timeStopMin ?? 90);
    const px = stopOnFill ? s.stop! : res.px; const outcome = stopOnFill ? "stop" as const : res.outcome;
    const risk = Math.abs(s.entry! - s.stop!);
    const R = outcome === "open" ? null : +(((s.side === "long" ? px - s.entry! : s.entry! - px) / risk)).toFixed(2);
    const mins = (stopOnFill ? fill : res.j) - fill;
    out.push({ symbol: sym, side: s.side, t: fb.t, entry: s.entry!, stop: s.stop!, target: s.t1!.price, rr: s.t1!.r, exitT: bars[stopOnFill ? fill : res.j]?.t ?? null, exitPx: px, outcome, r: R, minutes: mins,
      optPnlPct: optionPnlPct(DEFAULT_OPT[sym]!, s.side, s.entry!, px, mins), why: `amd ${s.raid?.name} → ${s.confirm?.why} → ${s.entryWhy}`, day, setup: s, ctx: { expect: map.amd.expectManip, htf: map.biasStack.htf, mtf: map.biasStack.mtf, zone: map.zone } } as never);
  }
  return out;
}
const dollars = (ts: Trade[]) => +ts.reduce((a, t) => a + (t.optPnlPct == null ? 0 : Math.max(-1, t.optPnlPct) * CAP), 0).toFixed(0);
export function kpis(ts: (Trade & { day: string })[], nDays: number) {
  const s = summarize(ts); const weeks = nDays / 5;
  const done = ts.filter((t) => t.r != null);
  const avgWin = done.filter((t) => t.r! > 0).reduce((a, t) => a + t.r!, 0) / Math.max(1, done.filter((t) => t.r! > 0).length);
  const avgLoss = -done.filter((t) => t.r! <= 0).reduce((a, t) => a + t.r!, 0) / Math.max(1, done.filter((t) => t.r! <= 0).length);
  return { ...s, rrRealized: avgLoss ? +(avgWin / avgLoss).toFixed(2) : null, firesPerWeek: +(ts.length / weeks).toFixed(1), dollarsPerWeek: +(dollars(ts) / weeks).toFixed(0), dollarsTotal: dollars(ts) };
}
const GRID = args.includes("--grid");
if (GRID) {
  // walk-forward: choose on the first 75% of sessions, report the untouched last 25% (holdout)
  const variants: [string, Record<string, Record<string, unknown>>][] = [
    ["rules (as shipped)", {}],
    ["confirm ≥2m", { amd: { confirmMinTfMin: 2 } }],
    ["confirm ≥3m", { amd: { confirmMinTfMin: 3 } }],
    ["confirm ≥5m", { amd: { confirmMinTfMin: 5 } }],
    ["disp 1.5", { amd: { dispAtr: 1.5 } }],
    ["1 trade/side", { amd: { maxPerSide: 1 } }],
    ["minR 1.5", { amd: { minR: 1.5 } }],
    ["minR 0.9", { amd: { minR: 0.9 } }],
    ["minR 1.25", { amd: { minR: 1.25 } }],
    ["stopBuf 0.15", { amd: { stopBufAtr15: 0.15 } }],
    ["confirm ≥2m + stopBuf 0.15", { amd: { confirmMinTfMin: 2, stopBufAtr15: 0.15 } }],
  ];
  const all = sessionsOf(TAPE.MNQ!).slice(1); const cutI = Math.floor(all.length * 0.75);
  const train = new Set(all.slice(0, cutI)), hold = new Set(all.slice(cutI));
  const g: Record<string, unknown> = {};
  for (const [name, o] of variants) {
    setSeqOverrides(o);
    const ts: (Trade & { day: string })[] = [];
    for (const sym of ["MNQ", "ES"]) for (const day of all) ts.push(...seqTrades(sym, TAPE[sym]!, day));
    const tr = ts.filter((t) => train.has(t.day)), ho = ts.filter((t) => hold.has(t.day));
    g[name] = { train: kpis(tr, train.size), holdout: kpis(ho, hold.size) };
    console.log(name.padEnd(28), "train", JSON.stringify(kpis(tr, train.size)), "\n", "".padEnd(27), "hold ", JSON.stringify(kpis(ho, hold.size)));
  }
  setSeqOverrides(null);
  report.grid = { train: [...train], holdout: [...hold], g };
}
if (!GRID) {
  const desk: (Trade & { day: string })[] = [], arm: (Trade & { day: string })[] = [], seq: (Trade & { day: string; setup: AmdSetup })[] = [];
  const daysUsed = new Set<string>();
  for (const sym of ["MNQ", "ES"]) {
    const m = TAPE[sym]!;
    for (const day of sessionsOf(m).slice(1)) {
      const bars = m.filter((b) => sessionKeyOf(b.t) === day);
      const rth = bars.filter((b) => { const e = etOf(b.t).hm; return e >= 570 && e <= 960; });
      if (rth.length < 60) continue;
      daysUsed.add(day);
      const hist = m.filter((b) => b.t < bars[0]!.t && b.t > bars[0]!.t - 3 * 86_400_000);
      const h15 = resample(m.filter((b) => b.t < rth[0]!.t && b.t > rth[0]!.t - 3 * 86_400_000), 900_000);
      for (const t of replayDay(sym, rth, h15)) desk.push({ ...t, day });
      for (const t of replayDayLtfArm(sym, bars, hist)) arm.push({ ...t, day });
      seq.push(...seqTrades(sym, m, day));
    }
  }
  const n = daysUsed.size;
  report.engines = { sessions: n, days: [...daysUsed].sort(), desk: kpis(desk, n), ltfArm: kpis(arm, n), amd: kpis(seq, n) };
  report.amdTrades = seq.map((t) => ({ day: t.day, sym: t.symbol, side: t.side, at: new Date(t.t).toLocaleString("en-US", { timeZone: "America/New_York", hour12: false }), entry: t.entry, stop: t.stop, target: t.target, outcome: t.outcome, r: t.r, opt$: t.optPnlPct == null ? null : Math.round(Math.max(-1, t.optPnlPct) * CAP), why: t.why, raid: t.setup.raid?.name, confTf: t.setup.confirm?.tf, ctx: (t as never as { ctx: unknown }).ctx }));
  console.log(`\nengines on ${n} sessions (${[...daysUsed].sort()[0]} … ${[...daysUsed].sort().at(-1)}), $ = ${CAP} × engine option model:`);
  for (const k of ["desk", "ltfArm", "amd"] as const) console.log(" ", k.padEnd(7), JSON.stringify((report.engines as never)[k]));
  for (const t of report.amdTrades as { day: string }[]) console.log("   ", JSON.stringify(t));
}
if (outPath) writeFileSync(outPath, JSON.stringify(report, null, 1));
