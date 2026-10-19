/**
 * ONE MULTI-TIMEFRAME CONTEXT (Keaton 2026-10-13) for the scanner, the brain
 * and the Floor: 1m 2m 3m 4m 5m (from the 1m tape) and 15m 30m 1h 4h (from
 * the 15m series), both books. Built once per desk build; every rung reuses
 * the cached resample from mtf-arrays.ts `rung`.
 *
 * Per rung: structure (last BOS / CHoCH on closed swings), arrays (live
 * FVG / IFVG / sponsored counts), latest real sweep, bias, and SMT against
 * the other book. Alignment per side: HTF bias (1h, 4h), MTF setup (15m,
 * 30m sweep or BOS for the side), LTF trigger (1–5m CHoCH/BOS for the side
 * or a continuation stack). Score = parts / 3. A read, never a gate.
 */
import RULES from "../../../shared/desk-rules.json";
import { bucketEnd, bucketStart } from "@/lib/market/minute-gaps";
import type { OhlcBar } from "@/lib/market/types";
import { detectSweeps, fractalSwings, rollingAtr } from "@/lib/trading/detectors";
import { HTF_RUNGS, LTF_RUNGS, mtfArrays, rung, type ArrayTf } from "./mtf-arrays";

export type Dir = "bull" | "bear";
export const ALL_RUNGS: ArrayTf[] = [...LTF_RUNGS, ...HTF_RUNGS];
const SWING_K = 2;
const SWEEP_RECENT = 24;
export const MTF_ARRAY_MAX_AGE = 30;

export interface RungRead {
  tf: ArrayTf;
  bars: number;
  bias: Dir | "neutral";
  structure: { kind: "BOS" | "CHoCH"; dir: Dir; ageBars: number } | null;
  sweep: { side: "buyside" | "sellside"; level: number; ageBars: number } | null;
  arrays: { fvg: number; ifvg: number; sponsored: number };
}

export interface SmtRead {
  tf: ArrayTf;
  kind: "bearish" | "bullish";
  /** The book that made the new extreme. */
  leader: string;
  /** The book that FAILED it — the reversal trade (ICT): short it on bearish, long it on bullish. */
  failing: string;
  ageBars: number;
}

export interface LtfReversal {
  /** The side this reversal invalidates. */
  against: "long" | "short";
  why: string[];
  /** Time the kill printed (ms). */
  killT: number;
  /** The opposing array's far edge the rebuild must close back through. */
  level: number;
  /** Temporary kill: set once sweep → displacement → inversion-back prints. Card is capped A- then. */
  rearmed: { t: number; why: string } | null;
  /**
   * smcUnity shadow read (F1/F7, audit 2026-10-14). `failedOnly`: every piece of
   * evidence is an iFVG that already closed back through its origin side — the
   * kill has no live evidence. `killTInv`: the kill anchored on the inversion
   * time. Changes nothing unless smcUnity.ifvgFail.mode is "live" (then a
   * failed-only kill is never emitted).
   */
  smc?: { failedOnly: boolean; failed: string[]; killTInv: number | null };
  /**
   * Fix A (Keaton 10/14 09:55 ET, MNQ short vetoed by a bull IFVG price had already closed back below):
   * every piece of kill evidence was invalidated on CLOSED bars across the 1m–4h ladder
   * (`killClearedOf`). kill.clear.mode live → also sets `rearmed` (capped A-); shadow → reported only.
   */
  killCleared?: { t: number; why: string } | null;
  /** Standing rule (no single-TF rule), SHADOW: rungs 1m–4h holding a fresh opposing IFVG (≤ IFVG5_MAX_AGE own bars). Kill would need ≥ 2. */
  killMtf?: { rungs: string[]; wouldKill: boolean };
}
export interface BookMtf {
  symbol: string;
  /** Keaton 10:33 ET case: a fresh 5m IFVG against a side, or a 1m
   *  displacement against it right after a rejection wick at a high/low. */
  ltfReversal: LtfReversal | null;
  /** Every side's kill (with its re-arm state) — a re-armed side stays capped A-. */
  ltfReversals: LtfReversal[];
  /** shadow (ltfArm.allTfKills.mode shadow): the kills an all-rung (1m-4h) read would print. Never acted on. */
  ltfReversalsAllTfShadow?: LtfReversal[];
  rungs: RungRead[];
  align: { long: Alignment; short: Alignment };
}
export interface Alignment {
  htf: boolean;
  mtf: boolean;
  ltf: boolean;
  score: number;
}
export interface MtfContext {
  books: BookMtf[];
  smt: SmtRead[];
  /** Fastest SMT read (smallest tf), or null. */
  smtLead: SmtRead | null;
  /** Weighted vote behind `smtLead` (AUDIT R2-2). */
  smtVote?: { bullish: number; bearish: number; margin: number };
}

function structureOf(bars: OhlcBar[]): RungRead["structure"] {
  const n = bars.length;
  if (n < 2 * SWING_K + 3) return null;
  const sw = fractalSwings(bars, SWING_K).filter((s) => s.index + SWING_K < n);
  let lastBreak: { dir: Dir; i: number } | null = null;
  let prev: Dir | null = null;
  let kind: "BOS" | "CHoCH" = "BOS";
  for (let i = 1; i < n; i++) {
    const c = bars[i]!.c;
    const hi = [...sw].reverse().find((s) => s.kind === "high" && s.index + SWING_K < i);
    const lo = [...sw].reverse().find((s) => s.kind === "low" && s.index + SWING_K < i);
    let dir: Dir | null = null;
    if (hi && c > hi.price && bars[i - 1]!.c <= hi.price) dir = "bull";
    else if (lo && c < lo.price && bars[i - 1]!.c >= lo.price) dir = "bear";
    if (dir) {
      kind = prev && prev !== dir ? "CHoCH" : "BOS";
      prev = dir;
      lastBreak = { dir, i };
    }
  }
  return lastBreak ? { kind, dir: lastBreak.dir, ageBars: n - 1 - lastBreak.i } : null;
}

function rungRead(symbol: string, tf: ArrayTf, src: OhlcBar[]): RungRead {
  const { bars } = rung(symbol, src, tf);
  const st = structureOf(bars);
  const sws = detectSweeps(bars).filter((s) => s.closeBackInside > 0);
  const last = sws[sws.length - 1];
  const sweep = last && bars.length - 1 - last.index <= SWEEP_RECENT ? { side: last.side, level: last.sweptLevel, ageBars: bars.length - 1 - last.index } : null;
  return {
    tf,
    bars: bars.length,
    bias: st ? st.dir : "neutral",
    structure: st,
    sweep,
    arrays: { fvg: 0, ifvg: 0, sponsored: 0 },
  };
}

/** Last confirmed swing high/low pair on a rung, for SMT. */
function lastTwo(bars: OhlcBar[], kind: "high" | "low") {
  const sw = fractalSwings(bars, SWING_K).filter((s) => s.kind === kind && s.index + SWING_K < bars.length);
  return sw.slice(-2);
}

function smtOn(tf: ArrayTf, a: { symbol: string; bars: OhlcBar[] }, b: { symbol: string; bars: OhlcBar[] }): SmtRead | null {
  const ah = lastTwo(a.bars, "high"), bh = lastTwo(b.bars, "high");
  const al = lastTwo(a.bars, "low"), bl = lastTwo(b.bars, "low");
  const age = (x: { index: number }[], bars: OhlcBar[]) => bars.length - 1 - x[x.length - 1]!.index;
  if (ah.length === 2 && bh.length === 2) {
    const aHH = ah[1]!.price > ah[0]!.price, bHH = bh[1]!.price > bh[0]!.price;
    if (aHH !== bHH)
      return { tf, kind: "bearish", leader: aHH ? a.symbol : b.symbol, failing: aHH ? b.symbol : a.symbol, ageBars: Math.min(age(ah, a.bars), age(bh, b.bars)) };
  }
  if (al.length === 2 && bl.length === 2) {
    const aLL = al[1]!.price < al[0]!.price, bLL = bl[1]!.price < bl[0]!.price;
    if (aLL !== bLL)
      return { tf, kind: "bullish", leader: aLL ? a.symbol : b.symbol, failing: aLL ? b.symbol : a.symbol, ageBars: Math.min(age(al, a.bars), age(bl, b.bars)) };
  }
  return null;
}

function alignFor(rungs: RungRead[], side: "long" | "short"): Alignment {
  const want: Dir = side === "long" ? "bull" : "bear";
  const pool = side === "long" ? "sellside" : "buyside";
  const by = (tf: ArrayTf) => rungs.find((r) => r.tf === tf);
  const htfVotes = (["1h", "4h"] as ArrayTf[]).map((t) => by(t)?.bias).filter((b) => b && b !== "neutral");
  const htf = htfVotes.length > 0 && htfVotes.every((b) => b === want);
  const mtf = (["15m", "30m"] as ArrayTf[]).some((t) => {
    const r = by(t);
    return Boolean(r && (r.sweep?.side === pool || r.structure?.dir === want));
  });
  const ltf = LTF_RUNGS.some((t) => {
    const r = by(t);
    return Boolean(r?.structure && r.structure.dir === want && r.structure.ageBars <= 10);
  });
  const score = +((Number(htf) + Number(mtf) + Number(ltf)) / 3).toFixed(2);
  return { htf, mtf, ltf, score };
}

export function buildMtfContext(
  left: { symbol: string; minute: OhlcBar[] | null | undefined; bars15: OhlcBar[] },
  right: { symbol: string; minute: OhlcBar[] | null | undefined; bars15: OhlcBar[] },
): MtfContext {
  const book = (b: typeof left): BookMtf => {
    const rungs: RungRead[] = [];
    for (const tf of ALL_RUNGS) {
      const src = LTF_RUNGS.includes(tf) ? b.minute : b.bars15;
      if (!src?.length) continue;
      rungs.push(rungRead(b.symbol, tf, src));
    }
    for (const row of mtfArrays(b.symbol, b.minute, b.bars15)) {
      // AUDIT F9: count live, recent arrays only (the 15m rung counted 270+
      // inverted gaps from the whole history — noise, not context).
      if (row.mitigated || row.ageBars > MTF_ARRAY_MAX_AGE) continue;
      const r = rungs.find((x) => x.tf === row.tf);
      if (r) r.arrays[row.kind] += 1;
    }
    const rows = mtfArrays(b.symbol, b.minute, b.bars15);
    // All-timeframe kills (ltfArm.allTfKills.mode, own setting since Release Watch #52): live → kills read every rung (strict union with
    // the 5m read); shadow (default) → 5m as before, all-rung read kept for the record. ltfArm.mode no longer flips this.
    const allTf = (RULES as unknown as { ltfArm?: { allTfKills?: { mode?: string } } }).ltfArm?.allTfKills?.mode === "live";
    // Accuracy Review #52 (2026-10-17): the all-rung read may only ADD kills. The 5m read keeps its exact kills, re-arm
    // and governing read (alignment flip, both-sides-null rule); a side is free only when BOTH reads leave it free, so the
    // all-rung read can neither ease a re-arm (newest-kill clock) nor drop a kill through the both-sides rule.
    const revs5 = ltfReversalsOf(rows, b.minute, false);
    const revs = allTf ? strictKillUnion(revs5, ltfReversalsOf(rows, b.minute, true)) : revs5;
    const rev = ltfReversalOf(rows, b.minute, false);
    const revsAllTfShadow = allTf ? undefined : ltfReversalsOf(rows, b.minute, true);
    const align = { long: alignFor(rungs, "long"), short: alignFor(rungs, "short") };
    if (rev && !rev.rearmed) {
      // LTF weight flips to the other side.
      const other = rev.against === "long" ? "short" : "long";
      const re = (a: Alignment, ltf: boolean): Alignment => ({ ...a, ltf, score: +((Number(a.htf) + Number(a.mtf) + Number(ltf)) / 3).toFixed(2) });
      align[rev.against] = re(align[rev.against], false);
      align[other] = re(align[other], true);
    }
    return { symbol: b.symbol, rungs, align, ltfReversal: rev, ltfReversals: revs, ltfReversalsAllTfShadow: revsAllTfShadow };
  };
  const books = [book(left), book(right)];
  const smt: SmtRead[] = [];
  for (const tf of ALL_RUNGS) {
    const srcL = LTF_RUNGS.includes(tf) ? left.minute : left.bars15;
    const srcR = LTF_RUNGS.includes(tf) ? right.minute : right.bars15;
    if (!srcL?.length || !srcR?.length) continue;
    const s = smtOn(tf, { symbol: left.symbol, bars: rung(left.symbol, srcL, tf).bars }, { symbol: right.symbol, bars: rung(right.symbol, srcR, tf).bars });
    if (s) smt.push(s);
  }
  const w = weightedSmt(smt);
  return { books, smt, smtLead: w.lead, smtVote: w.vote };
}

/** SMT fix 2: the failing book's continuation (its long on bearish SMT, its short on bullish) caps at B. */
export function smtFightsContinuation(ctx: MtfContext | null | undefined, symbol: string, side: "long" | "short"): SmtRead | null {
  const s = ctx?.smtLead;
  if (!s || s.failing !== symbol) return null;
  if (s.kind === "bearish" && side === "long") return s;
  if (s.kind === "bullish" && side === "short") return s;
  return null;
}

/** The wire block. Compact: per book per rung, and the SMT list. */
export function wireMtf(ctx: MtfContext) {
  return {
    books: ctx.books.map((b) => ({
      symbol: b.symbol,
      align: b.align,
      ltfReversal: b.ltfReversal,
      ltfReversals: b.ltfReversals,
      rungs: b.rungs.map((r) => ({
        tf: r.tf,
        bias: r.bias,
        structure: r.structure ? `${r.structure.kind} ${r.structure.dir} ${r.structure.ageBars}b` : null,
        sweep: r.sweep ? `${r.sweep.side === "sellside" ? "SSL" : "BSL"} ${r.sweep.level} ${r.sweep.ageBars}b` : null,
        arrays: r.arrays,
      })),
    })),
    smt: ctx.smt,
    smtLead: ctx.smtLead,
    smtVote: ctx.smtVote ?? null,
  };
}

/** 1h/4h bias for one book, for the card (`wire.htf`). Null when unread. */
export function htfBiasOf(ctx: MtfContext | null | undefined, symbol: string) {
  const b = ctx?.books.find((x) => x.symbol === symbol);
  if (!b) return null;
  const r = (tf: string) => b.rungs.find((x) => x.tf === tf)?.bias ?? null;
  return { symbol, bias1h: r("1h"), bias4h: r("4h") };
}

const SMCU = ((RULES as unknown) as { smcUnity?: Record<string, { mode?: string }> }).smcUnity ?? {};
const BOTH_KILLS_LIVE = SMCU.bothKills?.mode === "live";
export let IFVG5_MAX_AGE = RULES.kill.ifvg5MaxAge; // kill-tune 2026-10-13: 4 vs 6 ≈ same precision (0.507 vs 0.503); 6 kept — 4 misses the 10:33 ES replay
export let REJECT_WICK_FRAC = RULES.kill.rejectWickFrac;
export let DISP1_ATR = RULES.kill.disp1Atr; // kill-tune: 1.25 → 1.0 (0.481 → 0.507; still kills the 10:33 ES replay)
export const DISP_LEG_BARS = 3;
/** Replay tuning only (scripts/kill-tune.mts); the live desk never calls this. */
export function setKillParams(p: { ifvg5MaxAge?: number; rejectWickFrac?: number; disp1Atr?: number }) {
  if (p.ifvg5MaxAge != null) IFVG5_MAX_AGE = p.ifvg5MaxAge;
  if (p.rejectWickFrac != null) REJECT_WICK_FRAC = p.rejectWickFrac;
  if (p.disp1Atr != null) DISP1_ATR = p.disp1Atr;
}
export const REJECT_LOOKBACK = 10;
export const EXTREME_LOOKBACK = 10;

type Side = "long" | "short";
interface Kill { side: Side; t: number; level: number; why: string; failed?: boolean; tInv?: number | null }
export type { Kill as LtfKill };

/**
 * LTF reversal against a side (Keaton 2026-10-13 10:33 ET). Triggers, CLOSED bars:
 *  A. a 5m IFVG whose new direction opposes the side, ≤ 6 bars old;
 *  B. 1m rejection wick (≥ 50% of range) at the 10-bar high (low), then within
 *     10 bars a body ≥ 1×ATR1m closing beyond the wick bar's far end.
 * TEMPORARY: the killed side re-arms on sweep → displacement → inversion back
 * (see `rearmAfter`); then the card is capped at A-.
 */
const RUNG_MIN: Record<string, number> = { "1m": 1, "2m": 2, "3m": 3, "4m": 4, "5m": 5, "15m": 15, "30m": 30, "1h": 60, "4h": 240 };
export function ltfReversalsOf(
  rows: { tf: string; kind: string; dir: "bull" | "bear"; ageBars: number; mitigated: boolean; lo?: number; hi?: number; failed?: boolean; invertedT?: number | null }[],
  minute: OhlcBar[] | null | undefined,
  /** ltfArm all-timeframe rule: IFVG kills on every rung 1m-4h, age in minutes (ifvg5MaxAge x 5m). Default: 5m only (today). */
  allTfs = false,
): LtfReversal[] {
  const m = (minute ?? []).slice(0, -1); // drop the forming bar
  const lastT = m.length ? m[m.length - 1].t : Date.now();
  const kills: Kill[] = [];
  for (const r of rows) {
    const tfMin = RUNG_MIN[r.tf];
    if (tfMin == null || r.kind !== "ifvg" || r.mitigated) continue;
    if (allTfs ? r.ageBars * tfMin > IFVG5_MAX_AGE * 5 : r.tf !== "5m" || r.ageBars > IFVG5_MAX_AGE) continue;
    const side: Side = r.dir === "bear" ? "long" : "short";
    const level = side === "long" ? (r.hi ?? NaN) : (r.lo ?? NaN);
    const failed = r.failed === true;
    kills.push({ side, t: lastT - r.ageBars * tfMin * 60e3, level, why: `${r.tf} IFVG ${r.dir} (${r.ageBars}b) against the ${side}`, failed, tInv: r.invertedT ?? null });
  }
  const atrs = m.length ? rollingAtr(m) : [];
  const n = m.length;
  if (n > EXTREME_LOOKBACK + 2) {
    for (let i = Math.max(EXTREME_LOOKBACK, n - 3 * REJECT_LOOKBACK); i < n - 1; i++) {
      const w = m[i];
      const rng = w.h - w.l;
      if (!(rng > 0)) continue;
      const prior = m.slice(i - EXTREME_LOOKBACK, i);
      const hi = Math.max(...prior.map((x) => x.h));
      const lo = Math.min(...prior.map((x) => x.l));
      const upper = (w.h - Math.max(w.o, w.c)) / rng;
      const lower = (Math.min(w.o, w.c) - w.l) / rng;
      // The displacement is a LEG: up to DISP_LEG_BARS consecutive bodies in
      // one direction starting within REJECT_LOOKBACK bars of the wick, net
      // ≥ DISP1_ATR × ATR1m, closing beyond the wick bar's far end AND beyond
      // the bar that built into the extreme (replay 10:27–10:29 ET: a 0.67
      // wick at the 30-bar high, then 7852.50 → 7850.00 = 1.3×ATR).
      let done = false;
      for (let s0 = i + 1; s0 < Math.min(n, i + 1 + REJECT_LOOKBACK) && !done; s0++) {
        for (const dn of [true, false]) {
          if (dn ? !(w.h >= hi && upper >= REJECT_WICK_FRAC) : !(w.l <= lo && lower >= REJECT_WICK_FRAC)) continue;
          for (let j = s0; j < Math.min(n, s0 + DISP_LEG_BARS); j++) {
            const d = m[j];
            if (dn ? d.c > d.o : d.c < d.o) break;
            const atr = atrs[j];
            if (!(atr > 0)) break;
            const leg = dn ? m[s0].o - d.c : d.c - m[s0].o;
            const base = m[i - 1];
            const through = dn ? d.c < w.l && d.c < base.l : d.c > w.h && d.c > base.h;
            // A close back beyond the wick's extreme voids the read (no fade).
            const voided = m.slice(j + 1).some((x) => (dn ? x.c > w.h : x.c < w.l));
            if (leg >= DISP1_ATR * atr && through && !voided) {
              kills.push({
                side: dn ? "long" : "short",
                t: d.t,
                level: m[s0].o,
                why: `1m rejection wick at the ${dn ? "high" : "low"} ${dn ? w.h : w.l} then a ${(leg / atr).toFixed(1)}×ATR ${dn ? "down" : "up"} displacement`,
              });
              done = true;
              break;
            }
          }
          if (done) break;
        }
      }
    }
  }
  const out: LtfReversal[] = [];
  for (const side of ["long", "short"] as Side[]) {
    const ks = kills.filter((x) => x.side === side).sort((p, q) => q.t - p.t);
    if (!ks.length) continue;
    const levels = ks.map((x) => x.level).filter((x) => Number.isFinite(x));
    // The rebuild must reclaim the FARTHEST opposing edge of the evidence.
    const level = levels.length ? (side === "long" ? Math.max(...levels) : Math.min(...levels)) : NaN;
    const failedKs = ks.filter((x) => x.failed);
    const smc = {
      failedOnly: failedKs.length === ks.length,
      failed: failedKs.map((x) => `${x.why} [failed]`),
      killTInv: ks.reduce<number | null>((a, x) => (x.tInv != null && (a == null || x.tInv > a) ? x.tInv : a), null),
    };
    const cleared = killClearedOf(m, side, ks);
    const rearmed = rearmAfter(m, atrs, side, ks[0].t, level) ?? killVoided(m, side, ks[0].t, level) ?? (KILL_CLEAR.mode === "live" ? cleared : null);
    out.push({ against: side, why: [...new Set(ks.map((x) => x.why))].slice(0, 3), killT: ks[0].t, level, rearmed, killCleared: cleared, smc, killMtf: killMtfOf(rows, side) });
  }
  return out;
}

/**
 * 13:07 CT bull surge: ES/MNQ longs stayed killed (C) by 12:56 CT bear IFVGs after price had
 * closed back above the IFVG far edge — the opposing array was already inverted back. A kill is
 * VOID (treated like a re-arm: capped A-) once kill.voidCloses5m closed 5m bars settle beyond its
 * level in the killed side's favour, or once it is older than kill.maxAgeMin. Shared rules.
 */
export function killVoided(m: OhlcBar[], side: Side, killT: number, level: number): { t: number; why: string } | null {
  if (!m.length) return null;
  const lastT = m[m.length - 1]!.t;
  const b5: { t: number; c: number }[] = [];
  for (const b of m) { if (b.t <= killT) continue; const k = Math.floor(b.t / 300_000) * 300_000; const L = b5[b5.length - 1]; if (L && L.t === k) L.c = b.c; else b5.push({ t: k, c: b.c }); }
  const closed = b5.filter((x) => x.t + 300_000 <= lastT + 60_000);
  if (Number.isFinite(level)) {
    const n = RULES.kill.voidCloses5m; let run = 0;
    for (const x of closed) {
      run = (side === "long" ? x.c > level : x.c < level) ? run + 1 : 0;
      if (run >= n) return { t: x.t, why: `kill void: ${n} closed 5m bars ${side === "long" ? "above" : "below"} the kill level ${level}` };
    }
  }
  if (lastT - killT > RULES.kill.maxAgeMin * 60_000) return { t: lastT, why: `kill aged out (> ${RULES.kill.maxAgeMin} min)` };
  return null;
}

/** Shadow multi-TF kill read: every rung, not the 5m alone. */
export function killMtfOf(rows: Parameters<typeof ltfReversalsOf>[0], side: Side): { rungs: string[]; wouldKill: boolean } {
  const opp = side === "long" ? "bear" : "bull";
  const rungs = [...new Set(rows.filter((r) => r.kind === "ifvg" && !r.mitigated && r.dir === opp && r.ageBars <= IFVG5_MAX_AGE).map((r) => r.tf))];
  return { rungs, wouldKill: rungs.length >= 2 };
}

/** Fix A rules (shared/desk-rules.json kill.clear). */
export const KILL_CLEAR = (RULES.kill as { clear?: { mode?: string; rungs?: string[]; minRungs?: number } }).clear ?? {};
const CLEAR_RUNGS_MIN: Record<string, number> = { "1m": 1, "2m": 2, "3m": 3, "4m": 4, "5m": 5, "15m": 15, "30m": 30, "1h": 60, "4h": 240 };

/**
 * Fix A — stale kills clear. One piece of evidence (5m IFVG edge, or the 1m displacement origin) is
 * INVALIDATED when price closes back beyond its level in the killed side's favour (bull IFVG vs a
 * short: close < lo; bear IFVG vs a long: close > hi; reversal level reclaimed) — on CLOSED bars of
 * every timeframe together, not one rung: per rung in kill.clear.rungs (1m…4h) the latest closed bar
 * after the kill must sit beyond the level; ≥ kill.clear.minRungs rungs AND a majority of the rungs
 * with a closed bar since the kill must agree, slowest ≥ 2m, so a lone 1m print never clears.
 * The side clears only when EVERY piece of its evidence is invalidated. Returns the `killCleared` reason.
 */
export function killClearedOf(m: OhlcBar[], side: Side, kills: Kill[]): { t: number; why: string } | null {
  if (!m.length || !kills.length) return null;
  const rungs = (KILL_CLEAR.rungs ?? ["1m", "2m", "3m", "4m", "5m", "15m", "30m", "1h", "4h"]).filter((r) => CLEAR_RUNGS_MIN[r]);
  const need = Math.max(1, KILL_CLEAR.minRungs ?? 3);
  const lastEnd = m[m.length - 1]!.t + 60_000;
  const closedOn = (tfMin: number) => {
    const ms = tfMin * 60_000;
    const out: { t: number; c: number }[] = [];
    for (const b of m) { const k = bucketStart(b.t, ms); const L = out[out.length - 1]; if (L && L.t === k) L.c = b.c; else out.push({ t: k, c: b.c }); }
    return out.filter((x) => bucketEnd(x.t, ms) <= lastEnd); // 4h: Globex anchor, 14:00 bucket ends 17:00 ET (fix 2026-10-19)
  };
  const series = rungs.map((r) => ({ r, min: CLEAR_RUNGS_MIN[r]!, bars: closedOn(CLEAR_RUNGS_MIN[r]!) }));
  let tMax = 0;
  const notes: string[] = [];
  for (const k of kills) {
    if (!Number.isFinite(k.level)) return null;
    const beyond = (c: number) => (side === "long" ? c > k.level : c < k.level);
    const agree: string[] = [];
    let seen = 0, slowest = 0, tk = 0;
    for (const s of series) {
      const after = s.bars.filter((x) => x.t >= k.t);
      if (!after.length) continue;
      seen++;
      const last = after[after.length - 1]!;
      if (beyond(last.c)) { agree.push(s.r); slowest = Math.max(slowest, s.min); tk = Math.max(tk, bucketEnd(last.t, s.min * 60_000)); }
    }
    // ≥ minRungs rungs AND a majority of the rungs that closed since the kill, slowest ≥ 2m.
    if (agree.length < need || agree.length * 2 <= seen || slowest < 2) return null;
    tMax = Math.max(tMax, tk);
    notes.push(`${k.why.split(" against")[0]} @ ${k.level} (${agree.join("/")} closed ${side === "long" ? "above" : "below"})`);
  }
  return { t: tMax, why: `killCleared: evidence invalidated on closed bars — ${notes.join("; ")}` };
}

/**
 * Strict union of the 5m kill read and the all-rung kill read, per side. A side is killed if EITHER read has a live
 * (un-rearmed) kill; it is re-armed only when every read that has a kill re-armed it. The 5m entry wins when it is live
 * (unchanged evidence and level); otherwise a live all-rung entry is used (marked `allTf`). Never looser than `base`.
 */
export function strictKillUnion(base: LtfReversal[], extra: LtfReversal[]): LtfReversal[] {
  const out: LtfReversal[] = [];
  for (const side of ["long", "short"] as Side[]) {
    const a = base.find((r) => r.against === side) ?? null;
    const x = extra.find((r) => r.against === side) ?? null;
    if (a && !a.rearmed) out.push(a);
    else if (x && !x.rearmed) out.push({ ...x, why: [...x.why, "all-rung kill (ltfArm live)"].slice(0, 4) });
    else if (a ?? x) out.push((a ?? x)!);
  }
  return out;
}

/** The governing read: the newest live (un-rearmed) kill; else the newest re-armed one. */
export function ltfReversalOf(
  rows: Parameters<typeof ltfReversalsOf>[0],
  minute: OhlcBar[] | null | undefined,
  allTfs = false,
): LtfReversal | null {
  const all = ltfReversalsOf(rows, minute, allTfs);
  const live = all.filter((r) => !r.rearmed).sort((a, b) => b.killT - a.killT);
  // Two live kills on opposite sides = no clean read. (smcUnity.bothKills live:
  // the newest is returned here and both stay on `ltfReversals` — audit F12.)
  if (live.length === 2 && !BOTH_KILLS_LIVE) return null;
  return live[0] ?? all.sort((a, b) => b.killT - a.killT)[0] ?? null;
}

/**
 * Re-arm (Keaton): for a long, after the kill —
 *  1. a sell-side sweep: a 1m bar trades below every low since the kill and
 *     CLOSES back above that low;
 *  2. then a real displacement up: body ≥ 1×ATR1m;
 *  3. that displacement (or a later close) is back through the opposing
 *     array's far edge (`level`) — the bearish IFVG/FVG inverted back.
 * Mirror for shorts. Returns null until all three print in order.
 */
export function rearmAfter(m: OhlcBar[], atrs: number[], side: Side, killT: number, level: number): { t: number; why: string } | null {
  if (!Number.isFinite(level)) return null;
  const start = m.findIndex((b) => b.t > killT);
  if (start < 0) return null;
  const long = side === "long";
  let ext = long ? m[start].l : m[start].h;
  let swept = -1;
  for (let i = start + 1; i < m.length; i++) {
    const b = m[i];
    if (swept < 0) {
      if (long ? b.l < ext && b.c > ext : b.h > ext && b.c < ext) { swept = i; continue; }
      ext = long ? Math.min(ext, b.l) : Math.max(ext, b.h);
      continue;
    }
    const atr = atrs[i];
    const body = long ? b.c - b.o : b.o - b.c;
    if (atr > 0 && body >= DISP1_ATR * atr && (long ? b.c > level : b.c < level)) {
      return { t: b.t, why: `${long ? "SSL" : "BSL"} sweep → ${(body / atr).toFixed(1)}×ATR ${long ? "up" : "down"} displacement → closed back through ${level}` };
    }
  }
  return null;
}

/** Timeframe weights for the SMT vote: slower reads carry more. */
export const SMT_TF_WEIGHT: Record<string, number> = { "1m": 1, "2m": 1, "3m": 1.5, "4m": 1.5, "5m": 2, "15m": 3, "30m": 3, "1h": 4, "4h": 4 };
/** The winning kind must carry ≥ this share of the total weight. */
export const SMT_LEAD_SHARE = 0.6;
/** A read older than this many of its own bars is half weight. */
export const SMT_FRESH_BARS = 6;

/**
 * AUDIT R2-2: the SMT lead is a weighted vote across timeframes, not the
 * fastest (1m) read — live 10:28 ET had 1m bullish, 2m/3m bearish and
 * 5m/30m/4h bullish at once. The winning kind needs ≥ 60% of the weight; the
 * lead returned is that kind's FASTEST read (the trigger) whose leader/failing
 * pair matches the majority pair. No majority → null (no SMT cap, no override).
 */
export function weightedSmt(smt: SmtRead[]): { lead: SmtRead | null; vote: { bullish: number; bearish: number; margin: number } } {
  const wt = (r: SmtRead) => (SMT_TF_WEIGHT[r.tf] ?? 1) * (r.ageBars > SMT_FRESH_BARS ? 0.5 : 1);
  let bull = 0, bear = 0;
  for (const r of smt) (r.kind === "bullish" ? (bull += wt(r)) : (bear += wt(r)));
  const tot = bull + bear;
  const vote = { bullish: +bull.toFixed(2), bearish: +bear.toFixed(2), margin: tot ? +(Math.abs(bull - bear) / tot).toFixed(2) : 0 };
  if (!tot) return { lead: null, vote };
  const kind = bull >= bear ? "bullish" : "bearish";
  if ((kind === "bullish" ? bull : bear) / tot < SMT_LEAD_SHARE) return { lead: null, vote };
  const same = smt.filter((r) => r.kind === kind);
  const pairW = new Map<string, number>();
  for (const r of same) pairW.set(r.leader, (pairW.get(r.leader) ?? 0) + wt(r));
  const leader = [...pairW.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  return { lead: same.find((r) => r.leader === leader) ?? null, vote };
}

export interface ReversalSetup {
  side: "long" | "short";
  /** Fix 26: HTF (15m/30m/1h) sweep + LTF CHoCH the other way → release, cap A-. */
  htfRelease: boolean;
  /** Fix 27: how many of 1m–5m broke structure this way within 10 bars. */
  ltfBreaks: number;
  why: string[];
}
export const HTF_SWEEP_MAX_AGE = 3;
export const LTF_BREAK_MAX_AGE = 10;
export const LTF_BREAKS_FOR_REVERSAL = 4;

/** Fix 26/27 for one book. */
export function reversalSetupOf(b: BookMtf | null | undefined): ReversalSetup[] {
  if (!b) return [];
  const out: ReversalSetup[] = [];
  for (const side of ["long", "short"] as const) {
    const want: Dir = side === "long" ? "bull" : "bear";
    const pool = side === "long" ? "sellside" : "buyside";
    const ltf = b.rungs.filter((r) => LTF_RUNGS.includes(r.tf));
    const breaks = ltf.filter((r) => r.structure && r.structure.dir === want && r.structure.ageBars <= LTF_BREAK_MAX_AGE);
    const choch = breaks.some((r) => r.structure!.kind === "CHoCH");
    const htfSweep = b.rungs.find((r) => (r.tf === "15m" || r.tf === "30m" || r.tf === "1h") && r.sweep?.side === pool && r.sweep.ageBars <= HTF_SWEEP_MAX_AGE);
    const htfRelease = Boolean(htfSweep && choch);
    const why: string[] = [];
    if (htfRelease) why.push(`${htfSweep!.tf} ${pool === "buyside" ? "BSL" : "SSL"} sweep ${htfSweep!.sweep!.level} + LTF CHoCH ${want} — HTF released for the ${side} (cap A-)`);
    if (breaks.length >= LTF_BREAKS_FOR_REVERSAL) why.push(`${breaks.length}/${ltf.length} of 1m–5m broke ${want} within ${LTF_BREAK_MAX_AGE} bars`);
    if (why.length) out.push({ side, htfRelease, ltfBreaks: breaks.length, why });
  }
  return out;
}
