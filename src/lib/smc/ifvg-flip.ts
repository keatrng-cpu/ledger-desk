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
export interface IfvgAgainstRules { mode: string; tfs: string[]; maxAgeBars: number; formingThrough: boolean; formedMaxAgeBars: number;
  /** post-mortem 13:02 F1: 1m close through a same-side gap formed <= formedMaxMin, within throughMaxMin, not reclaimed -> hard on hardBands. */
  close1m?: { mode: string; formedMaxMin: number; throughMaxMin: number; hardBands: string[] };
  /** Keaton 13:26 CT read-priority: >= minGaps same-side 5m gaps closed through on 1m -> any band blocked + the desk flips (ifvgFlipOf). */
  readPriority?: { mode: string; tf: string; minGaps: number } }
export interface IfvgFlipRules { mode: string; tfs: ArrayTf[]; maxAgeBars: number; stopAtr: number; minRr: number; dispBodyAtr: number }
const FC = (RULES as unknown as { fastChain: { ifvgAgainst: IfvgAgainstRules; ifvgFlip: IfvgFlipRules } }).fastChain;
export const IFVG_AGAINST = FC.ifvgAgainst;
export const IFVG_FLIP = FC.ifvgFlip;
export interface WireArray { tf: string; kind: string; dir: string; lo: number; hi: number; ageBars: number; formedAgeBars?: number; failed?: boolean; mitigated?: boolean; symbol?: string; through1mAgeMin?: number | null; reclaimed1m?: boolean }
const TFMIN: Record<string, number> = { "5m": 5, "15m": 15 };
/** Same-side gaps closed through on 1m (fresh, not reclaimed) - twin of watcher fastchain.through_1m. */
export function through1mGaps(arrays: WireArray[], side: Side, r: IfvgAgainstRules = IFVG_AGAINST, tf?: string): WireArray[] {
  const c = r.close1m; if (!c || c.mode !== "live") return [];
  const mine = side === "long" ? "bull" : "bear";
  return arrays.filter((a) => (tf ? a.tf === tf : TFMIN[a.tf] != null) && (a.kind === "fvg" || a.kind === "sponsored") && a.dir === mine && a.through1mAgeMin != null
    && a.through1mAgeMin <= c.throughMaxMin && a.reclaimed1m !== true && (a.formedAgeBars ?? a.ageBars) * (TFMIN[a.tf] ?? 99) <= c.formedMaxMin);
}
/** Read-priority: >= minGaps same-side 5m gaps closed through on 1m = the read has flipped against `side`. */
export function readFlipped(arrays: WireArray[], side: Side, r: IfvgAgainstRules = IFVG_AGAINST): boolean {
  const p = r.readPriority; return !!p && p.mode === "live" && through1mGaps(arrays, side, r, p.tf).length >= p.minGaps;
}

/** [blocked, why] for a card side given the wire arrays (filter to the card's symbol first) and the live price. */
export function ifvgAgainst(arrays: WireArray[], side: Side, px: number | null | undefined, r: IfvgAgainstRules = IFVG_AGAINST, band: string | null = null): [boolean, string] {
  if (r.mode !== "live") return [false, "ifvgAgainst off"];
  const mine = side === "long" ? "bull" : "bear"; const flipped = side === "long" ? "bear" : "bull";
  if (readFlipped(arrays, side, r)) return [true, `read flipped: ${r.readPriority!.minGaps}+ ${r.readPriority!.tf} ${mine} FVGs closed through on 1m - no ${side} (any band)`];
  const t1m = through1mGaps(arrays, side, r)[0];
  if (t1m && (band == null || (r.close1m!.hardBands).includes(band))) return [true, `${t1m.tf} ${mine} FVG ${t1m.lo}-${t1m.hi} closed through on 1m ${t1m.through1mAgeMin}m ago, not reclaimed - no ${side}${band ? ` (${band})` : ""}`];
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
export function ifvgFlipOf(i: { symbol: string; side: Side; minute: OhlcBar[] | null | undefined; closed15: OhlcBar[]; targets: Pool[]; nowMs: number; rules?: IfvgFlipRules; arrays?: WireArray[] }): IfvgFlip | null {
  const r = i.rules ?? IFVG_FLIP;
  if (r.mode !== "live" && r.mode !== "shadow") return null;
  let best: IfvgFlip | null = null;
  // Keaton 13:26 CT read-priority: 2+ opposite-polarity 5m gaps closed through on 1m arm THIS side in the same poll (before the 5m close).
  const opp: Side = i.side === "short" ? "long" : "short";
  if (i.arrays && readFlipped(i.arrays, opp)) {
    const gs = through1mGaps(i.arrays, opp, IFVG_AGAINST, IFVG_AGAINST.readPriority!.tf); const S = i.side === "short";
    const g = [...gs].sort((x, y) => (S ? x.hi - y.hi : y.lo - x.lo))[0]!;   // nearest to price: lowest bull gap for a short
    const far = S ? Math.max(...gs.map((x) => x.hi)) : Math.min(...gs.map((x) => x.lo));
    const five = i.minute?.length ? rung(i.symbol, i.minute, "5m", i.nowMs).bars : []; const a = five.length ? rollingAtr(five)[five.length - 1] ?? NaN : NaN;
    if (Number.isFinite(a) && a > 0) {
      const ce = +((g.lo + g.hi) / 2).toFixed(2); const stop = +(S ? far + r.stopAtr * a : far - r.stopAtr * a).toFixed(2); const risk = Math.abs(ce - stop);
      const ahead = i.targets.filter((p) => (S ? p.price < ce : p.price > ce) && Math.abs(p.price - ce) / risk >= r.minRr).sort((x, y) => (S ? y.price - x.price : x.price - y.price));
      const t1 = ahead[0] ?? null;
      best = { side: i.side, tf: "5m", gap: { lo: g.lo, hi: g.hi, ce, invertedT: i.nowMs, ageBars: 0 }, entry: ce, entryEdge: S ? g.lo : g.hi, stop, dispAtr: 0, t1, t2: ahead[1] ?? null,
        rr1: t1 ? +(Math.abs(t1.price - ce) / risk).toFixed(2) : null, why: `read flipped: ${gs.length} 5m ${S ? "bull" : "bear"} FVGs closed through on 1m - ${i.side} at the gap CE retest, stop beyond ${far}` };
    }
  }
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

/**
 * Scanner pool list for flip target selection (10/15 13:03 CT: the read-priority short armed with no T1 because only
 * the session H/L were fed in). Adds, from CLOSED 1m/5m bars within lookbackMin, real unswept liquidity only:
 *  - swing highs/lows (1m and 5m pivots, ties allowed, nothing beyond them traded since),
 *  - EQH/EQL: >= 2 unswept pivots within tol (max(0.5, 0.1 x ATR5m)) -> the outermost price of the cluster,
 *  - opposite FVGs: unmitigated, not closed through, 5m/15m gaps against the trade (bull gap below a short -> its top;
 *    bear gap above a long -> its bottom).
 * Code constants only (no desk-rules.json key) so rulesHash is unchanged. Nothing is invented: no pivot, no pool.
 */
export function scannerPools(i: { symbol: string; side?: Side; minute: OhlcBar[] | null | undefined; nowMs: number; arrays?: WireArray[]; lookbackMin?: number }): Pool[] {
  const mn = (i.minute ?? []).filter((b) => b.t + 60_000 <= i.nowMs && b.t >= i.nowMs - (i.lookbackMin ?? 390) * 60_000);
  if (mn.length < 5) return [];
  const five = rung(i.symbol, i.minute!, "5m", i.nowMs).bars;
  const a5 = five.length ? rollingAtr(five)[five.length - 1] ?? NaN : NaN;
  const tol = Math.max(0.5, Number.isFinite(a5) ? 0.1 * a5 : 0);
  const out: Pool[] = [];
  const lows: { p: number; t: number }[] = []; const highs: { p: number; t: number }[] = [];
  const pivots = (bars: OhlcBar[], tf: string) => {
    for (let k = 1; k < bars.length - 1; k++) {
      const b = bars[k]!, p = bars[k - 1]!, n = bars[k + 1]!;
      const end = b.t + (tf === "5m" ? 300_000 : 60_000);
      const later = mn.filter((x) => x.t >= end);
      if (b.l <= p.l && b.l <= n.l && b.l < Math.max(p.l, n.l) && !later.some((x) => x.l < b.l)) { lows.push({ p: b.l, t: b.t }); out.push({ name: `${tf} swing low`, price: b.l }); }
      if (b.h >= p.h && b.h >= n.h && b.h > Math.min(p.h, n.h) && !later.some((x) => x.h > b.h)) { highs.push({ p: b.h, t: b.t }); out.push({ name: `${tf} swing high`, price: b.h }); }
    }
  };
  pivots(mn, "1m");
  pivots(five.filter((b) => b.t >= mn[0]!.t), "5m");
  const eq = (xs: { p: number; t: number }[], low: boolean) => {
    const s = [...xs].sort((x, y) => x.p - y.p); const used = new Set<number>();
    for (let k = 0; k < s.length; k++) {
      if (used.has(k)) continue;
      const cl = s.filter((x, j) => j >= k && x.p - s[k]!.p <= tol);
      const ts = new Set(cl.map((x) => x.t));
      if (ts.size >= 2) { cl.forEach((_, j) => used.add(k + j)); out.push({ name: low ? "EQL" : "EQH", price: low ? Math.min(...cl.map((x) => x.p)) : Math.max(...cl.map((x) => x.p)) }); }
    }
  };
  eq(lows, true); eq(highs, false);
  for (const a of i.arrays ?? []) {
    if ((a.tf !== "5m" && a.tf !== "15m") || (a.kind !== "fvg" && a.kind !== "sponsored") || a.mitigated === true || a.through1mAgeMin != null) continue;
    out.push(a.dir === "bull" ? { name: `${a.tf} bull FVG top`, price: a.hi } : { name: `${a.tf} bear FVG bottom`, price: a.lo });
  }
  // one pool per price; EQH/EQL outrank a plain swing at the same price
  const rank = (n: string) => (/^EQ[HL]$/.test(n) ? 0 : /swing/.test(n) ? 1 : 2);
  const by = new Map<string, Pool>();
  for (const p of out.sort((x, y) => rank(x.name) - rank(y.name))) { const k = p.price.toFixed(2); if (!by.has(k)) by.set(k, p); }
  // a short draws on sell-side (lows, EQL, bull FVG tops); a long on buy-side - a swing high is not a short's target
  const sell = (n: string) => /low|EQL|bull FVG/.test(n);
  return [...by.values()].filter((p) => i.side == null || (i.side === "short" ? sell(p.name) : !sell(p.name)));
}
/** Flip targets = the session/draw targets + scannerPools, deduped by price (first name wins). */
export function flipTargets(base: Pool[], extra: Pool[]): Pool[] {
  const by = new Map<string, Pool>();
  for (const p of [...extra.filter((x) => /^EQ[HL]$/.test(x.name)), ...base, ...extra]) { const k = p.price.toFixed(2); if (!by.has(k)) by.set(k, p); }
  return [...by.values()];
}
