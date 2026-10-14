/**
 * deskSeq backtest over every session in the cached tape (Yahoo 1m NQ=F → MNQ, ES=F → ES; source labelled
 * "yahoo", fetched read-only into /workspace/audits/seq-data). Every read is cut at the bar-close time it
 * would have been made (no lookahead). Usage: npx tsx scripts/backtest-desk-seq.mts [--out file]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { premarketMap, rungBias, closedBuckets } from "../src/lib/smc/seq/premarket-map";
import { sessionKeyOf } from "../src/lib/smc/smc-unity";
import { etOf } from "../src/lib/smc/seq/rules";
import { setSeqOverrides } from "../src/lib/smc/seq/rules";
import { replayDay, replayDayLtfArm, resolve1m, optionPnlPct, DEFAULT_OPT, summarize, resample, type Trade } from "../src/lib/backtest/engine";
import { amdRead, type AmdSetup } from "../src/lib/smc/seq/amd-state";
import { continuationRead } from "../src/lib/smc/seq/continuation";
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
export function seqTrades(sym: string, m: B[], day: string, opts: { timeStopMin?: number; cont?: boolean; contUntilHm?: number } = {}): (Trade & { day: string; setup: AmdSetup })[] {
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
  if (opts.cont) {
    const c = continuationRead(sym, map, bars, at(day, opts.contUntilHm ?? 12 * 60), r);
    for (const s of c.setups.filter((x) => x.stage === "ENTERED")) {
      const fill = bars.findIndex((b) => b.t + 60_000 === s.enteredT);
      if (fill < 0) continue;
      const fb = bars[fill]!;
      const stopOnFill = s.side === "long" ? fb.l <= s.stop : fb.h >= s.stop;
      const res = resolve1m(bars, fill, s.side, s.entry, s.stop, s.t1.price, opts.timeStopMin ?? 90);
      const px = stopOnFill ? s.stop : res.px; const outcome = stopOnFill ? "stop" as const : res.outcome;
      const risk = Math.abs(s.entry - s.stop);
      const mins = (stopOnFill ? fill : res.j) - fill;
      out.push({ symbol: sym, side: s.side, t: fb.t, entry: s.entry, stop: s.stop, target: s.t1.price, rr: s.t1.r, exitT: bars[stopOnFill ? fill : res.j]?.t ?? null, exitPx: px, outcome,
        r: outcome === "open" ? null : +(((s.side === "long" ? px - s.entry : s.entry - px) / risk)).toFixed(2), minutes: mins,
        optPnlPct: optionPnlPct(DEFAULT_OPT[sym]!, s.side, s.entry, px, mins), why: `cont ${s.entryWhy} → ${s.t1.name}`, day, setup: { raid: null, confirm: { tf: "cont" } } as never, cont: true, gateCtx: gateCtx(bars, fill, s.side, map) } as never);
    }
  }
  return out;
}
function gateCtx(bars: B[], fill: number, side: "long" | "short", map: ReturnType<typeof premarketMap>) {
  const T = bars[fill]!.t; const win = bars.slice(Math.max(0, fill - 3000), fill); // closed before the fill bar
  const want = side === "long" ? "bull" : "bear";
  const rungs = [1, 2, 3, 5, 15, 30, 60].filter((mn) => rungBias(closedBuckets(win, mn * 60_000, T)) === want).length;
  const w60 = win.slice(-60); const atr1 = w60.reduce((a, b) => a + (b.h - b.l), 0) / Math.max(1, w60.length);
  const v20 = win.slice(-20).reduce((a, b) => a + b.v, 0) / 20; const fb = bars[fill - 1]!;
  return { hm: etOf(T).hm, htfAligned: map.biasStack.htf === want, rungs, shockAtr: +((fb.h - fb.l) / (atr1 || 1)).toFixed(2), shockVol: +(fb.v / (v20 || 1)).toFixed(2) };
}
const dollars = (ts: Trade[]) => +ts.reduce((a, t) => a + (t.optPnlPct == null ? 0 : Math.max(-1, t.optPnlPct) * CAP), 0).toFixed(0);
export function kpis(ts: (Trade & { day: string })[], nDays: number) {
  const s = summarize(ts); const weeks = nDays / 5;
  const done = ts.filter((t) => t.r != null);
  const avgWin = done.filter((t) => t.r! > 0).reduce((a, t) => a + t.r!, 0) / Math.max(1, done.filter((t) => t.r! > 0).length);
  const avgLoss = -done.filter((t) => t.r! <= 0).reduce((a, t) => a + t.r!, 0) / Math.max(1, done.filter((t) => t.r! <= 0).length);
  return { ...s, rrRealized: avgLoss ? +(avgWin / avgLoss).toFixed(2) : null, firesPerWeek: +(ts.length / weeks).toFixed(1), dollarsPerWeek: +(dollars(ts) / weeks).toFixed(0), dollarsTotal: dollars(ts) };
}
const GRID = args.includes("--grid") || args.includes("--gate");
if (args.includes("--gate")) {
  // session-gate study: continuation run all day; entries outside the killzones (08:30–11:00, 13:30–16:00 ET) are the
  // refusals the gate makes when the rest of the sequence passed. Shock exception (≥2.0×ATR AND ≥1.5×vol) shown separately.
  setSeqOverrides({ continuation: { endEtMin: 959 } });
  const ts: any[] = [];
  for (const sym of ["MNQ", "ES"]) for (const day of sessionsOf(TAPE[sym]!).slice(1)) ts.push(...seqTrades(sym, TAPE[sym]!, day, { cont: true, contUntilHm: 16 * 60 }).filter((t: any) => t.cont));
  setSeqOverrides(null);
  const inKz = (hm: number) => (hm >= 510 && hm < 660) || (hm >= 810 && hm < 960);
  const nDays = sessionsOf(TAPE.MNQ!).slice(1).length;
  const out: Record<string, unknown> = {};
  const add = (k: string, xs: any[]) => { out[k] = kpis(xs, nDays); console.log(k.padEnd(44), JSON.stringify(out[k])); };
  const oow = ts.filter((t) => !inKz(t.gateCtx.hm));
  const refused = oow.filter((t) => !(t.gateCtx.shockAtr >= 2 && t.gateCtx.shockVol >= 1.5));
  add("in-window continuation (gate passes)", ts.filter((t) => inKz(t.gateCtx.hm)));
  add("out-of-window, shock exception passes", oow.filter((t) => !refused.includes(t)));
  for (const [nm, f] of [["lunch 11:00-13:30", (t: any) => t.gateCtx.hm >= 660 && t.gateCtx.hm < 810], ["other out-of-window", (t: any) => !(t.gateCtx.hm >= 660 && t.gateCtx.hm < 810)]] as const) {
    const b = refused.filter(f);
    add(`REFUSED ${nm}`, b);
    add(`REFUSED ${nm} | HTF-aligned & ≥4 rungs`, b.filter((t) => t.gateCtx.htfAligned && t.gateCtx.rungs >= 4));
    add(`REFUSED ${nm} | not (HTF-aligned & ≥4 rungs)`, b.filter((t) => !(t.gateCtx.htfAligned && t.gateCtx.rungs >= 4)));
  }
  report.gate = { buckets: out, refusedTrades: refused.map((t) => ({ day: t.day, sym: t.symbol, side: t.side, ...t.gateCtx, r: t.r, opt$: t.optPnlPct == null ? null : Math.round(Math.max(-1, t.optPnlPct) * CAP), outcome: t.outcome })) };
  if (outPath) writeFileSync(outPath, JSON.stringify(report, null, 1));
  process.exit(0);
}
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
    ["1m confirm (confirmMinTfMin 1)", { amd: { confirmMinTfMin: 1 } }],
    ["minR 0.85 (Keaton R:R floor)", { amd: { minR: 0.85 } }],
    ["1m confirm + minR 0.85", { amd: { confirmMinTfMin: 1, minR: 0.85 } }],
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
  const desk: (Trade & { day: string })[] = [], arm: (Trade & { day: string })[] = [], seq: (Trade & { day: string; setup: AmdSetup })[] = [], cont: (Trade & { day: string })[] = [];
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
      cont.push(...seqTrades(sym, m, day, { cont: true }).filter((t) => (t as never as { cont?: boolean }).cont));
    }
  }
  const n = daysUsed.size;
  report.engines = { sessions: n, days: [...daysUsed].sort(), desk: kpis(desk, n), ltfArm: kpis(arm, n), amd: kpis(seq, n), continuation: kpis(cont, n), amdPlusCont: kpis([...seq, ...cont], n) };
  { const all = [...daysUsed].sort(); const ci = Math.floor(all.length * 0.75); const H = new Set(all.slice(ci));
    report.holdout = { days: all.slice(ci), desk: kpis(desk.filter((t) => H.has(t.day)), H.size), ltfArm: kpis(arm.filter((t) => H.has(t.day)), H.size), amd: kpis(seq.filter((t) => H.has(t.day)), H.size), continuation: kpis(cont.filter((t) => H.has(t.day)), H.size), amdPlusCont: kpis([...seq, ...cont].filter((t) => H.has(t.day)), H.size) };
    report.train = { desk: kpis(desk.filter((t) => !H.has(t.day)), all.length - H.size), continuation: kpis(cont.filter((t) => !H.has(t.day)), all.length - H.size), amd: kpis(seq.filter((t) => !H.has(t.day)), all.length - H.size) };
    console.log("HOLDOUT", JSON.stringify(report.holdout)); console.log("TRAIN", JSON.stringify(report.train)); }
  report.contTrades = cont.map((t: any) => ({ day: t.day, sym: t.symbol, side: t.side, at: new Date(t.t).toLocaleString("en-US", { timeZone: "America/New_York", hour12: false }), entry: t.entry, stop: t.stop, target: t.target, outcome: t.outcome, r: t.r, opt$: t.optPnlPct == null ? null : Math.round(Math.max(-1, t.optPnlPct) * CAP), why: t.why }));
  report.amdTrades = seq.map((t) => ({ day: t.day, sym: t.symbol, side: t.side, at: new Date(t.t).toLocaleString("en-US", { timeZone: "America/New_York", hour12: false }), entry: t.entry, stop: t.stop, target: t.target, outcome: t.outcome, r: t.r, opt$: t.optPnlPct == null ? null : Math.round(Math.max(-1, t.optPnlPct) * CAP), why: t.why, raid: t.setup.raid?.name, confTf: t.setup.confirm?.tf, ctx: (t as never as { ctx: unknown }).ctx }));
  // F10: the same AMD fires priced as a 0DTE ticket (DEFAULT_OPT, 0–1DTE ATM approximation) vs a 5DTE ticket
  // (documented approximation: premium ≈3.75× the 0DTE ATM, theta/min ≈0.45×, delta 0.52, spread 0.03; model, not recorded chains)
  const OPT5: Record<string, typeof DEFAULT_OPT[string]> = Object.fromEntries(Object.entries(DEFAULT_OPT).map(([k, o]) => [k, { ...o, delta: 0.52, thetaPerMin: o.thetaPerMin * 0.45, spread: 0.03, premium: o.premium * 3.75 }]));
  const pnl = (o: typeof OPT5, t: Trade, px: number, mins: number) => Math.max(-1, optionPnlPct(o[t.symbol]!, t.side, t.entry, px, mins)) * CAP;
  const marks = (t: Trade & { day: string }, k: number) => { const m = TAPE[t.symbol]!; const j = m.findIndex((b) => b.t >= t.t + k * 60_000); return j < 0 ? null : m[j]!.c; };
  const row = (o: typeof OPT5) => {
    const tot = seq.reduce((a, t) => a + (t.exitPx == null ? 0 : pnl(o, t, t.exitPx, t.minutes ?? 0)), 0);
    const m10 = seq.reduce((a, t) => { const px = marks(t, 10); return a + (px == null ? 0 : pnl(o, t, px, 10)); }, 0);
    const m30 = seq.reduce((a, t) => { const px = marks(t, 30); return a + (px == null ? 0 : pnl(o, t, px, 30)); }, 0);
    return { dollarsTotal: Math.round(tot), dollarsPerWeek: Math.round(tot / (n / 5)), markPlus10$: Math.round(m10), markPlus30$: Math.round(m30) };
  };
  const z = row(DEFAULT_OPT), f5 = row(OPT5);
  report.F10 = { zeroDte: z, fiveDte: f5, note: "model option prices (no recorded chains); same fires, same exits", ratioAtExit: f5.dollarsTotal ? +(z.dollarsTotal / f5.dollarsTotal).toFixed(2) : null };
  console.log("F10 0DTE vs 5DTE on the AMD fires:", JSON.stringify(report.F10));
  console.log(`\nengines on ${n} sessions (${[...daysUsed].sort()[0]} … ${[...daysUsed].sort().at(-1)}), $ = ${CAP} × engine option model:`);
  for (const k of ["desk", "ltfArm", "amd", "continuation", "amdPlusCont"] as const) console.log(" ", k.padEnd(7), JSON.stringify((report.engines as never)[k]));
  for (const t of report.amdTrades as { day: string }[]) console.log("   ", JSON.stringify(t));
}
if (outPath) writeFileSync(outPath, JSON.stringify(report, null, 1));
