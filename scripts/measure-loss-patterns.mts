/**
 * Before/after for the loss-pattern guards (src/lib/smc/loss-guards.ts) on the audit trade set.
 * Input: a feature dump of the engine's trades (entry, stop, target, kill level, 1h/4h from buildMtfContext,
 * 90 1m bars after the fill, 60 before). Usage: npx tsx scripts/measure-loss-patterns.mts <feat.json>
 * Ranked-draw check approximation (no DrawRead in the dump): T1 counts as ranked when it is an equal-level
 * 15m swing (>=2 touches within 0.1xATR) or the prior-day high/low. q/band are not in the dump: the htf rule is
 * reported as count + R under each band assumption, never as one invented number.
 */
import { readFileSync } from "node:fs";
import RULES from "../shared/desk-rules.json";
import { LOSS, earlyExit, velocityRead, bufferedStop, lateGuard, chopRead, breakevenDue, optionNetAtT1, htfGuard } from "../src/lib/smc/loss-guards";
type P = [number, number, number, number];
const T: any[] = JSON.parse(readFileSync(process.argv.slice(2).find((a) => !a.includes("=")) ?? "/workspace/lossdata/feat.json", "utf8"));
// what-if overrides: loss.path=value (in-memory only; the shipped values are shared/desk-rules.json)
for (const a of process.argv.slice(2).filter((x) => x.includes("="))) { const [k, v] = a.split("="); const ks = k!.split("."); let o: any = LOSS; for (const x of ks.slice(0, -1)) o = o[x]; o[ks[ks.length - 1]!] = Number(v); }
const bars = (a: P[], t0: number) => a.map(([o, h, l, c], i) => ({ t: t0 + i * 60_000, o, h, l, c, v: 0 }));
function sim(t: any, o: { stop?: number; early?: boolean; be?: boolean } = {}) {
  const L = t.side === "long"; let stop = o.stop ?? t.stop; const risk = Math.abs(t.entry - stop); let mfe = 0;
  for (let j = 0; j < t.path.length; j++) {
    const [op, h, l, c] = t.path[j] as P;
    const hitT = L ? h >= t.target : l <= t.target, hitS = L ? l <= stop : h >= stop, thru = L ? op >= t.target : op <= t.target;
    if (hitT && (!hitS || thru)) return { r: Math.abs(t.target - t.entry) / risk, min: j + 1, how: "target" };
    if (hitS) return { r: (L ? stop - t.entry : t.entry - stop) / risk, min: j + 1, how: stop === t.entry ? "be" : "stop" };
    mfe = Math.max(mfe, L ? h - t.entry : t.entry - l);
    if (o.be && breakevenDue(t.side, t.entry, t.target, L ? t.entry + mfe : t.entry - mfe)) stop = t.entry;
    if (o.early && earlyExit(j + 1, mfe, risk).cut) return { r: (L ? c - t.entry : t.entry - c) / risk, min: j + 1, how: "early" };
  }
  const c = (t.path[t.path.length - 1] as P)[3]; return { r: (L ? c - t.entry : t.entry - c) / risk, min: t.path.length, how: "time" };
}
const opt = (t: any, r: { r: number; min: number }) => { const risk = Math.abs(t.entry - t.stop); const ratio = (LOSS.option.ratio as any)[t.symbol];
  return (LOSS.option.delta * r.r * risk * ratio - LOSS.option.thetaPerMin * r.min - LOSS.option.spread) / 1.2; };
const sum = (name: string, rows: { t: any; r: { r: number; min: number } | null }[]) => {
  const k = rows.filter((x) => x.r); const R = k.reduce((a, x) => a + x.r!.r, 0); const w = k.filter((x) => x.r!.r > 0).length;
  const op = k.reduce((a, x) => a + opt(x.t, x.r!), 0);
  console.log(`${name.padEnd(46)} trades ${String(k.length).padStart(3)} wins ${String(w).padStart(2)} hit ${(w / Math.max(1, k.length)).toFixed(3)} ΣR ${R.toFixed(2).padStart(6)} avgOpt ${(op / Math.max(1, k.length) * 100).toFixed(2)}%`);
};
const HO = new Set(["2026-10-09", "2026-10-12"]);
const want = (t: any) => (t.side === "long" ? "bull" : "bear");
const ranked = (t: any) => t.tgtTouches >= 2 || [t.pdh, t.pdl].some((p: number | null) => p != null && Math.abs(p - t.target) <= 0.25);
const ctx = (t: any) => {
  const prior = bars(t.prior, t.t - (t.prior.length - 1) * 60_000);
  const v = velocityRead(prior, t.entry, t.target);
  return { chop: chopRead(prior, t.atr), vel: v, late: lateGuard(t.entry, t.killLevel, t.atr, t.rr >= (RULES.lateEntry.rrMin as any).A),
    opt: optionNetAtT1(t.symbol, t.entry, t.target, v.expMin), both: htfGuard(t.side, t.bias1h, t.bias4h, "A", t.sweep, t.disp).bothOppose };
};
for (const [lbl, set] of [["ALL 9 sessions", T], ["holdout 10/09+10/12", T.filter((t) => HO.has(t.day))]] as const) {
  console.log(`\n== ${lbl} ==`);
  sum("before (engine as-is)", set.map((t) => ({ t, r: { r: t.r, min: t.minutes } })));
  const C = set.map((t) => ({ t, c: ctx(t) }));
  sum("1 htf both-oppose blocked (band < A)", C.map(({ t, c }) => ({ t, r: c.both ? null : { r: t.r, min: t.minutes } })));
  sum("1 htf both-oppose size ×0.5 (band A/A-)", C.map(({ t, c }) => ({ t, r: { r: t.r * (c.both ? LOSS.htf.sizeMult : 1), min: t.minutes } })));
  sum(`2 early exit (${LOSS.early.minR}R in ${LOSS.early.minutes}m)`, set.map((t) => ({ t, r: sim(t, { early: true }) })));
  sum("2b velocity-slow (q −0.03) removed [upper bound]", C.map(({ t, c }) => ({ t, r: c.vel.penalty ? null : { r: t.r, min: t.minutes } })));
  sum("3 buffered stop (R re-based; rr<1 → watch)", set.map((t) => { const s = bufferedStop(t.side, t.entry, t.structural, t.atr);
    const rr = Math.abs(t.target - t.entry) / Math.abs(t.entry - s); return { t: { ...t, stop: s }, r: rr < RULES.rrMin ? null : sim(t, { stop: s }) }; }));
  sum("4 late > 0.5×ATR blocked unless late rule", C.map(({ t, c }) => ({ t, r: c.late.block ? null : { r: t.r, min: t.minutes } })));
  sum("5 chop → watch row", C.map(({ t, c }) => ({ t, r: c.chop.chop ? null : { r: t.r, min: t.minutes } })));
  sum("6a T1 not a ranked draw → watch", set.map((t) => ({ t, r: ranked(t) ? { r: t.r, min: t.minutes } : null })));
  sum("6b breakeven at 75% to T1", set.map((t) => ({ t, r: sim(t, { be: true }) })));
  sum("7 option net at T1 <= 0 → no fire", C.map(({ t, c }) => ({ t, r: c.opt.ok ? { r: t.r, min: t.minutes } : null })));
  sum("ALL (htf block <A, early, late, chop, T1, BE, opt)", C.map(({ t, c }) => ({ t, r: c.both || c.late.block || c.chop.chop || !ranked(t) || !c.opt.ok ? null : sim(t, { early: true, be: true }) })));
  sum("ALL but htf as size cut (A/A-)", C.map(({ t, c }) => { if (c.late.block || c.chop.chop || !ranked(t) || !c.opt.ok) return { t, r: null }; const r = sim(t, { early: true, be: true }); return { t, r: { r: r.r * (c.both ? LOSS.htf.sizeMult : 1), min: r.min } }; }));
  const cnt = (f: (x: any) => boolean) => C.filter(f).length;
  console.log(`flags: htfBoth ${cnt((x) => x.c.both)} late ${cnt((x) => x.c.late.late)} lateBlock ${cnt((x) => x.c.late.block)} chop ${cnt((x) => x.c.chop.chop)} slow ${cnt((x) => x.c.vel.penalty > 0)} notRanked ${cnt((x) => !ranked(x.t))} optNeg ${cnt((x) => !x.c.opt.ok)}`);
}
