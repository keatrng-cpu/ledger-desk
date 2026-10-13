/**
 * Multi-timeframe PD arrays (Keaton 2026-10-13): FVG / IFVG / sponsored on
 * 1m 2m 3m 4m 5m (resampled from the 1m tape) and 15m 30m 1h 4h (15m series,
 * resampled). One detector — `detectFvgs` (detectors.ts) — on every rung; the
 * resampler is tf-ladder.ts `resampleMs`. Nothing here is a gate.
 *
 *   sponsored = an FVG whose middle candle body is ≥ 1.5 × ATR (the desk's
 *               existing definition, smc-master.ts).
 *   ifvg      = a gap price CLOSED through (`inverted`), now the other side.
 *   mitigated = fill === "full" (traded through) — an inverted gap is listed
 *               as its ifvg row instead.
 *
 * The 4h rung needs ~56h of history, more than the 1m tape carries, so the
 * HTF rungs come from the 15m series. Resamples are cached by
 * (symbol, tf, first t, last t, length).
 */
import type { OhlcBar } from "@/lib/market/types";
import { detectFvgs, rollingAtr, type FvgResult } from "@/lib/trading/detectors";
import { resampleMs } from "@/lib/trading/tf-ladder";

export type ArrayTf = "1m" | "2m" | "3m" | "4m" | "5m" | "15m" | "30m" | "1h" | "4h";
export const LTF_RUNGS: ArrayTf[] = ["1m", "2m", "3m", "4m", "5m"];
export const HTF_RUNGS: ArrayTf[] = ["15m", "30m", "1h", "4h"];
const MIN: Record<ArrayTf, number> = { "1m": 1, "2m": 2, "3m": 3, "4m": 4, "5m": 5, "15m": 15, "30m": 30, "1h": 60, "4h": 240 };
export const SPONSORED_BODY_ATR = 1.5;
export const MIN_STOP_ATR15 = 0.25;
export const WIRE_ARRAYS_CAP = 30;

export interface ArrayRow {
  tf: ArrayTf;
  kind: "fvg" | "ifvg" | "sponsored";
  dir: "bull" | "bear";
  lo: number;
  hi: number;
  ce: number;
  mitigated: boolean;
  ageBars: number;
  formedAgeBars: number;
  createdT: number;
}

const cache = new Map<string, { bars: OhlcBar[]; gaps: FvgResult[] }>();
const CACHE_MAX = 64;

export function rung(symbol: string, src0: OhlcBar[], tf: ArrayTf, nowMs = Date.now()): { bars: OhlcBar[]; gaps: FvgResult[] } {
  // Accuracy 2: CLOSED bars only. The source's own forming bar is dropped,
  // and so is a resampled bucket that has not finished (a 5m bar built from
  // 3 closed minutes is not a 5m close).
  const srcMs = (LTF_RUNGS as readonly string[]).includes(tf) ? 60_000 : 900_000;
  const src = src0.length && src0[src0.length - 1]!.t + srcMs > nowMs ? src0.slice(0, -1) : src0;
  if (!src.length) return { bars: [], gaps: [] };
  const key = `${symbol}:${tf}:${src[0]!.t}:${src[src.length - 1]!.t}:${src.length}:${src[src.length - 1]!.c}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const ms = MIN[tf] * 60_000;
  const lastEnd = src[src.length - 1]!.t + srcMs;
  const rs = tf === "1m" || tf === "15m" ? src : resampleMs(src, ms);
  const bars = rs.length && rs[rs.length - 1]!.t + ms > lastEnd ? rs.slice(0, -1) : rs;
  const out = { bars, gaps: detectFvgs(bars) };
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!);
  cache.set(key, out);
  return out;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

function rowsFor(tf: ArrayTf, bars: OhlcBar[], gaps: FvgResult[]): ArrayRow[] {
  const last = bars.length - 1;
  return gaps.map((g) => {
    const inv = g.inverted;
    const dir: "bull" | "bear" = inv ? (g.kind === "bull" ? "bear" : "bull") : g.kind;
    const kind: ArrayRow["kind"] = inv ? "ifvg" : g.middleBodyAtrRatio >= SPONSORED_BODY_ATR ? "sponsored" : "fvg";
    return {
      tf,
      kind,
      dir,
      lo: r2(g.bottom),
      hi: r2(g.top),
      ce: r2((g.top + g.bottom) / 2),
      mitigated: !inv && g.fill === "full",
      // IFVG age counts from the INVERSION (the close through), not from when
      // the gap formed (AUDIT R2-1). `formedAgeBars` keeps the creation age.
      ageBars: inv && g.invertedIndex != null ? last - g.invertedIndex : last - g.createdIndex,
      formedAgeBars: last - g.createdIndex,
      createdT: g.createdT,
    };
  });
}

/** Every rung's arrays for one book. `minute` = 1m tape, `bars15` = the 15m series. */
export function mtfArrays(symbol: string, minute: OhlcBar[] | null | undefined, bars15: OhlcBar[] | null | undefined): ArrayRow[] {
  const out: ArrayRow[] = [];
  for (const tf of LTF_RUNGS) {
    if (!minute?.length) break;
    const r = rung(symbol, minute, tf);
    out.push(...rowsFor(tf, r.bars, r.gaps));
  }
  for (const tf of HTF_RUNGS) {
    if (!bars15?.length) break;
    const r = rung(symbol, bars15, tf);
    out.push(...rowsFor(tf, r.bars, r.gaps));
  }
  return out;
}

/** The wire list: live (unmitigated) first, then newest, capped. */
export function wireArrays(rows: ArrayRow[], cap = WIRE_ARRAYS_CAP): Omit<ArrayRow, "createdT">[] {
  return [...rows]
    .sort((a, b) => Number(a.mitigated) - Number(b.mitigated) || b.createdT - a.createdT)
    .slice(0, cap)
    .map(({ createdT: _t, ...r }) => r);
}

export interface ContinuationArray {
  tf: ArrayTf;
  dir: "bull" | "bear";
  count: number;
  entry: number;
  stop: number;
  originPx: number;
  minStopApplied: boolean;
}

/**
 * CONTINUATION ARRAY: ≥2 stacked same-direction FVGs on one LTF rung (1–5m),
 * all formed after the raid, none inverted or fully filled, and no opposite
 * gap printed between them (one displacement leg). Entry = CE of the most
 * recent gap. Stop = beyond the stack's origin (the low/high of the first
 * gap's first candle), at least MIN_STOP_ATR15 × ATR15 from the entry.
 * Smallest rung that has a stack wins (tightest leg).
 */
export function continuationArray(
  symbol: string,
  minute: OhlcBar[] | null | undefined,
  dir: "bull" | "bear",
  raidT: number | null,
  atr15: number | null,
): ContinuationArray | null {
  if (!minute?.length || raidT == null) return null;
  for (const tf of LTF_RUNGS) {
    const { bars, gaps } = rung(symbol, minute, tf);
    const after = gaps.filter((g) => g.createdT > raidT).sort((a, b) => a.createdIndex - b.createdIndex);
    // the latest run of same-direction gaps with no opposite gap in between
    let run: FvgResult[] = [];
    for (const g of after) {
      if (g.kind === dir) run.push(g);
      else run = [];
    }
    const live = run.filter((g) => !g.inverted && g.fill !== "full");
    if (live.length < 2 || live.length !== run.length) continue;
    const first = run[0]!;
    const lastGap = run[run.length - 1]!;
    const a = bars[first.createdIndex - 2];
    if (!a) continue;
    const entry = r2((lastGap.top + lastGap.bottom) / 2);
    const originPx = dir === "bull" ? a.l : a.h;
    let stop = originPx;
    const minDist = atr15 != null && Number.isFinite(atr15) ? MIN_STOP_ATR15 * atr15 : 0;
    let minStopApplied = false;
    if (Math.abs(entry - stop) < minDist) {
      stop = dir === "bull" ? entry - minDist : entry + minDist;
      minStopApplied = true;
    }
    return { tf, dir, count: run.length, entry, stop: r2(stop), originPx: r2(originPx), minStopApplied };
  }
  return null;
}

/** ATR of the 15m series at its last bar, or null. */
export function atr15Of(bars15: OhlcBar[] | null | undefined): number | null {
  if (!bars15?.length) return null;
  const a = rollingAtr(bars15);
  const v = a[a.length - 1];
  return v != null && Number.isFinite(v) ? v : null;
}
