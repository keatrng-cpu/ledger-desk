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
import type { OhlcBar } from "@/lib/market/types";
import { detectSweeps, fractalSwings } from "@/lib/trading/detectors";
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

export interface BookMtf {
  symbol: string;
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
    return { symbol: b.symbol, rungs, align: { long: alignFor(rungs, "long"), short: alignFor(rungs, "short") } };
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
  return { books, smt, smtLead: smt[0] ?? null };
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
      rungs: b.rungs.map((r) => ({
        tf: r.tf,
        bias: r.bias,
        structure: r.structure ? `${r.structure.kind} ${r.structure.dir} ${r.structure.ageBars}b` : null,
        sweep: r.sweep ? `${r.sweep.side === "sellside" ? "SSL" : "BSL"} ${r.sweep.level} ${r.sweep.ageBars}b` : null,
        arrays: r.arrays,
      })),
    })),
    smt: ctx.smt,
  };
}

/** 1h/4h bias for one book, for the card (`wire.htf`). Null when unread. */
export function htfBiasOf(ctx: MtfContext | null | undefined, symbol: string) {
  const b = ctx?.books.find((x) => x.symbol === symbol);
  if (!b) return null;
  const r = (tf: string) => b.rungs.find((x) => x.tf === tf)?.bias ?? null;
  return { symbol, bias1h: r("1h"), bias4h: r("4h") };
}
