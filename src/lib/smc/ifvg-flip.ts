/**
 * iFVG FLIP (Keaton, live 10/15 13:02-13:05 CT lesson; shared rules `fastChain.ifvgAgainst` + `ifvgFlip`).
 *
 * 1. ifvgAgainst (hard gate, desk + watcher): a long is blocked while a 5m/15m BULL FVG on its side is being inverted
 *    (a closed bar within maxAgeBars closed below its bottom = bearish iFVG; or the live price is already through the
 *    bottom of a bull FVG formed within formedMaxAgeBars = the forming bar is inverting it). Mirrored for shorts.
 * 2. ifvgFlipOf (card generator): the same inversion arms the OTHER side — entry at the iFVG CE retest (edge kept),
 *    stop beyond the iFVG's far edge + stopAtr x ATR(rung), T1/T2 the next real pools beyond the entry (>= minRr).
 *    Closed bars only (rung()). No pool, no plan: nothing is invented.
 */
import RULES from "../../../shared/desk-rules.json";
import type { OhlcBar } from "@/lib/market/types";
import { rollingAtr } from "@/lib/trading/detectors";
import { rung, type ArrayTf } from "./mtf-arrays";

type Side = "long" | "short";
export interface IfvgAgainstRules { mode: string; tfs: string[]; maxAgeBars: number; formingThrough: boolean; formedMaxAgeBars: number }
export interface IfvgFlipRules { mode: string; tfs: ArrayTf[]; maxAgeBars: number; stopAtr: number; minRr: number; dispBodyAtr: number }
const FC = (RULES as unknown as { fastChain: { ifvgAgainst: IfvgAgainstRules; ifvgFlip: IfvgFlipRules } }).fastChain;
export const IFVG_AGAINST = FC.ifvgAgainst;
export const IFVG_FLIP = FC.ifvgFlip;
export interface WireArray { tf: string; kind: string; dir: string; lo: number; hi: number; ageBars: number; formedAgeBars?: number; failed?: boolean; mitigated?: boolean; symbol?: string }

/** [blocked, why] for a card side given the wire arrays (filter to the card's symbol first) and the live price. */
export function ifvgAgainst(arrays: WireArray[], side: Side, px: number | null | undefined, r: IfvgAgainstRules = IFVG_AGAINST): [boolean, string] {
  if (r.mode !== "live") return [false, "ifvgAgainst off"];
  const mine = side === "long" ? "bull" : "bear"; const flipped = side === "long" ? "bear" : "bull";
  for (const a of arrays) {
    if (!r.tfs.includes(a.tf)) continue;
    if (a.kind === "ifvg" && a.dir === flipped && a.failed !== true && a.ageBars <= r.maxAgeBars)
      return [true, `${a.tf} ${mine} FVG ${a.lo}-${a.hi} inverted ${a.ageBars} bar(s) ago (closed through) - no ${side}`];
    if (r.formingThrough && px != null && (a.kind === "fvg" || a.kind === "sponsored") && a.dir === mine && a.mitigated !== true && (a.formedAgeBars ?? a.ageBars) <= r.formedMaxAgeBars
      && (side === "long" ? px < a.lo : px > a.hi))
      return [true, `${a.tf} ${mine} FVG ${a.lo}-${a.hi} being inverted: price ${px} ${side === "long" ? "below its bottom" : "above its top"} on the forming bar - no ${side}`];
  }
  return [false, `no ${r.tfs.join("/")} ${mine} FVG being inverted`];
}

export interface Pool { name: string; price: number }
export interface IfvgFlip {
  side: Side; tf: ArrayTf; gap: { lo: number; hi: number; ce: number; invertedT: number; ageBars: number };
  entry: number; entryEdge: number; stop: number; dispAtr: number;
  t1: Pool | null; t2: Pool | null; rr1: number | null; why: string;
}
/** The side an inverted gap ARMS: a bull FVG closed through its bottom arms a short (and vice versa). */
export function ifvgFlipOf(i: { symbol: string; side: Side; minute: OhlcBar[] | null | undefined; closed15: OhlcBar[]; targets: Pool[]; nowMs: number; rules?: IfvgFlipRules }): IfvgFlip | null {
  const r = i.rules ?? IFVG_FLIP;
  if (r.mode !== "live" && r.mode !== "shadow") return null;
  let best: IfvgFlip | null = null;
  for (const tf of r.tfs) {
    const { bars, gaps } = tf === "15m" || tf === "30m" || tf === "1h" || tf === "4h" ? rung(i.symbol, i.closed15, tf, i.nowMs) : i.minute?.length ? rung(i.symbol, i.minute, tf, i.nowMs) : { bars: [], gaps: [] };
    if (!bars.length) continue;
    const atr = rollingAtr(bars); const last = bars.length - 1;
    const want = i.side === "short" ? "bull" : "bear";   // the gap that, inverted, arms this side
    for (const g of gaps) {
      if (g.kind !== want || !g.inverted || g.invertedIndex == null || g.inversionFailed) continue;
      const age = last - g.invertedIndex;
      if (age > r.maxAgeBars) continue;
      const a = atr[g.invertedIndex] ?? NaN; if (!Number.isFinite(a) || a <= 0) continue;
      const b = bars[g.invertedIndex]!; const dispAtr = +(Math.abs(b.c - b.o) / a).toFixed(2);
      const ce = +((g.top + g.bottom) / 2).toFixed(2);
      const S = i.side === "short";
      const stop = +(S ? g.top + r.stopAtr * a : g.bottom - r.stopAtr * a).toFixed(2);
      const risk = Math.abs(ce - stop); if (risk <= 0) continue;
      const ahead = i.targets.filter((p) => (S ? p.price < ce : p.price > ce) && Math.abs(p.price - ce) / risk >= r.minRr).sort((x, y) => (S ? y.price - x.price : x.price - y.price));
      const t1 = ahead[0] ?? null; const t2 = ahead[1] ?? null;
      const cand: IfvgFlip = { side: i.side, tf, gap: { lo: g.bottom, hi: g.top, ce, invertedT: g.invertedT!, ageBars: age }, entry: ce, entryEdge: S ? g.bottom : g.top, stop, dispAtr,
        t1, t2, rr1: t1 ? +(Math.abs(t1.price - ce) / risk).toFixed(2) : null,
        why: `${tf} ${want} FVG ${g.bottom}-${g.top} inverted ${age} bar(s) ago (body ${dispAtr}xATR) - ${i.side} at the iFVG retest`};
      if (!best || (best.t1 == null && cand.t1 != null) || (cand.t1 != null && (tf === "15m" && best.tf !== "15m"))) best = cand;
    }
  }
  return best;
}
