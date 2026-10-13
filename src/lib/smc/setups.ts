/**
 * Fixes 32, 33, 35–39: setup detectors on CLOSED bars. Each returns null
 * when the pattern is not there — nothing is guessed. Pure; tested in
 * scripts/setups.test.mjs.
 */
import type { OhlcBar } from "@/lib/market/types";
import { fractalSwings } from "@/lib/trading/detectors";
import type { ArrayRow } from "./mtf-arrays";

type Side = "long" | "short";
export type Regime = "trend" | "reversal" | "range";

/** Fix 32: turtle soup — a 5m wick beyond a level that closes back inside. */
export function turtleSoup(bars5: OhlcBar[], levels: { name: string; price: number }[], maxAge = 6): { side: Side; level: number; name: string; ageBars: number } | null {
  const n = bars5.length;
  for (let i = n - 1; i >= Math.max(0, n - maxAge); i--) {
    const b = bars5[i]!;
    for (const lv of levels) {
      // was the level intact before this bar? (no earlier close beyond it in the lookback)
      const prior = bars5.slice(Math.max(0, i - 12), i);
      if (b.h > lv.price && b.c < lv.price && prior.every((p) => p.c < lv.price)) return { side: "short", level: lv.price, name: lv.name, ageBars: n - 1 - i };
      if (b.l < lv.price && b.c > lv.price && prior.every((p) => p.c > lv.price)) return { side: "long", level: lv.price, name: lv.name, ageBars: n - 1 - i };
    }
  }
  return null;
}

/** Fix 35: BOS break-and-retest on 5m — close through the last swing, then a retest that holds. */
export function bosRetest(bars5: OhlcBar[], atr: number, side: Side): { level: number; retestAge: number } | null {
  if (!(atr > 0) || bars5.length < 10) return null;
  const sw = fractalSwings(bars5, 2).filter((s) => s.kind === (side === "long" ? "high" : "low"));
  const tol = 0.15 * atr;
  for (let k = sw.length - 1; k >= 0; k--) {
    const s = sw[k]!;
    const brk = bars5.findIndex((b, i) => i > s.index + 2 && (side === "long" ? b.c > s.price : b.c < s.price));
    if (brk < 0) continue;
    for (let i = bars5.length - 1; i > brk; i--) {
      const b = bars5[i]!;
      const touched = side === "long" ? b.l <= s.price + tol : b.h >= s.price - tol;
      const held = side === "long" ? b.c > s.price : b.c < s.price;
      if (touched && held && bars5.slice(brk, i + 1).every((x) => (side === "long" ? x.c > s.price - tol : x.c < s.price + tol))) {
        return { level: s.price, retestAge: bars5.length - 1 - i };
      }
    }
    return null; // newest broken swing never retested
  }
  return null;
}

/** Fix 37: legs (BOS in the side's direction on 5m swings) since the last opposite break. */
export function legCount(bars5: OhlcBar[], side: Side): number {
  const sw = fractalSwings(bars5, 2);
  let legs = 0;
  let ref: number | null = null;
  for (const s of sw) {
    if (side === "long" && s.kind === "high") { if (ref != null && s.price > ref) legs++; ref = s.price; }
    if (side === "short" && s.kind === "low") { if (ref != null && s.price < ref) legs++; ref = s.price; }
    // an opposite break resets the count
    if (side === "long" && s.kind === "low" && legs && sw.some((o) => o.kind === "low" && o.index < s.index && o.price > s.price)) legs = 0;
    if (side === "short" && s.kind === "high" && legs && sw.some((o) => o.kind === "high" && o.index < s.index && o.price < s.price)) legs = 0;
  }
  return legs;
}

/** Fix 38: a sponsored gap that was retested and held (no close through its far edge). */
export function sponsoredHold(rows: ArrayRow[], minute: OhlcBar[], side: Side): ArrayRow | null {
  const dir = side === "long" ? "bull" : "bear";
  for (const g of rows.filter((r) => r.kind === "sponsored" && r.dir === dir && !r.mitigated).sort((a, b) => a.ageBars - b.ageBars)) {
    const after = minute.filter((b) => b.t > g.createdT);
    const touched = after.some((b) => (side === "long" ? b.l <= g.hi : b.h >= g.lo));
    const broke = after.some((b) => (side === "long" ? b.c < g.lo : b.c > g.hi));
    if (touched && !broke) return g;
  }
  return null;
}

/**
 * Fix 33/36: after a CHoCH on `tf`, the FIRST side-direction IFVG is the
 * reversal entry; the SECOND same-direction FVG/IFVG is the add-on.
 */
export function reversalEntries(rows: ArrayRow[], side: Side, chochAgeBars: number, tf: string): { first: ArrayRow | null; second: ArrayRow | null } {
  const dir = side === "long" ? "bull" : "bear";
  const after = rows
    .filter((r) => r.tf === tf && r.dir === dir && !r.mitigated && r.ageBars <= chochAgeBars)
    .sort((a, b) => b.ageBars - a.ageBars); // oldest first = first after the CHoCH
  const first = after.find((r) => r.kind === "ifvg") ?? null;
  const second = after.filter((r) => r !== first)[0] ?? null;
  return { first, second };
}

/** Fix 39: one regime label per card; setups grade only where they fit. */
export function regimeOf(c: { setupRegime?: string | null; chop?: boolean | null }): Regime {
  if (c.setupRegime === "reversal") return "reversal";
  if (c.chop) return "range";
  return "trend";
}
export const SETUP_FITS: Record<string, Regime[]> = {
  turtleSoup: ["range", "reversal"],
  bosRetest: ["trend"],
  sponsoredHold: ["trend"],
  reversalEntry: ["reversal"],
  continuation: ["trend"],
};
export const fits = (setup: keyof typeof SETUP_FITS, r: Regime) => SETUP_FITS[setup]!.includes(r);
