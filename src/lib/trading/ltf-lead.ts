/**
 * 1m–5m entries the way PB, TJR, and ICT take them, on both indexes at once.
 *
 * PB takes the highest inverse in the leg, and five minutes is the top.
 * TJR enters the retrace into the gap that inverse leaves, not the raid.
 * ICT bias is the unswept high-value pool: PDH, PDL, the session extreme,
 * equal highs and lows. A pool that already traded is manipulation, not the draw.
 *
 * The 1, 2, 3, 4, and 5 minute are the entry only.
 * Every slower rung, on both indexes, is the bias. They are read together.
 * A higher-timeframe ladder against the trade stands it down.
 */

import type { OhlcBar } from "@/lib/market/types";
import { aggregateBars } from "@/lib/market/freshest";
import type { LiquidityTarget } from "./draw";
import type { PbRead } from "./pb-entries";

const RUNGS = [5, 4, 3, 2, 1] as const;
export type Rung = (typeof RUNGS)[number];

export interface LtfLead {
  known: boolean;
  inverse: boolean;
  rung: Rung | null;
  leader: "NQ" | "ES" | "both" | "neither";
  thisLeads: boolean;
  /** Unswept pool in the trade's direction, a swept pool, or a pool that fights the side. */
  bias: "with" | "against" | "swept" | "none";
  line: string;
}

function symbolOf(raw: string): "NQ" | "ES" {
  return /ES/.test(raw) ? "ES" : "NQ";
}

/** Latest close that inverted a gap in `side`, if it is still in the last eight bars. */
function inverseAt(bars: OhlcBar[], side: "long" | "short"): number | null {
  const w = bars.slice(-48);
  if (w.length < 8) return null;
  const gaps: { far: number; i: number }[] = [];
  let at: number | null = null;
  for (let i = 2; i < w.length; i++) {
    const a = w[i - 2]!;
    const mid = w[i - 1]!;
    const c = w[i]!;
    if (side === "long" && a.l > c.h && mid.c < mid.o) gaps.push({ far: a.l, i });
    if (side === "short" && a.h < c.l && mid.c > mid.o) gaps.push({ far: a.h, i });
    for (const g of gaps) {
      if (g.i >= i) continue;
      const through = side === "long" ? c.c > g.far : c.c < g.far;
      if (through) at = c.t;
    }
  }
  if (at == null) return null;
  return at >= w[w.length - 8]!.t ? at : null;
}

function bestRung(minute: OhlcBar[], side: "long" | "short"): { rung: Rung; at: number } | null {
  for (const rung of RUNGS) {
    const bars = rung === 1 ? minute : aggregateBars(minute, rung);
    const at = inverseAt(bars, side);
    if (at != null) return { rung, at };
  }
  return null;
}

function liquidity(draw: LiquidityTarget | null, side: "long" | "short"): LtfLead["bias"] {
  if (!draw) return "none";
  if (draw.swept) return "swept";
  const withSide = side === "long" ? draw.side === "above" : draw.side === "below";
  return withSide ? "with" : "against";
}

export function readLtfLead(input: {
  symbol: string;
  side: "long" | "short";
  minute: OhlcBar[];
  otherSymbol: string;
  otherMinute: OhlcBar[];
  draw: LiquidityTarget | null;
  otherDraw: LiquidityTarget | null;
  /** Higher timeframes on this index. Direction is read from the top down. */
  mineLadder?: { symbol: string; strip: string; htf: "bull" | "bear" | "neutral" } | null;
  otherLadder?: { symbol: string; strip: string; htf: "bull" | "bear" | "neutral" } | null;
}): LtfLead {
  const me = symbolOf(input.symbol);
  const other = symbolOf(input.otherSymbol);
  if (input.minute.length < 10 && !input.mineLadder && !input.otherLadder) {
    return { known: false, inverse: false, rung: null, leader: "neither", thisLeads: true, bias: "none", line: "" };
  }
  const mine = input.minute.length >= 10 ? bestRung(input.minute, input.side) : null;
  const theirs = input.otherMinute.length >= 10 ? bestRung(input.otherMinute, input.side) : null;
  let leader: LtfLead["leader"] = "neither";
  if (mine && theirs) {
    if (mine.rung !== theirs.rung) leader = mine.rung > theirs.rung ? me : other;
    else leader = mine.at === theirs.at ? "both" : mine.at < theirs.at ? me : other;
  } else if (mine) leader = me;
  else if (theirs) leader = other;

  const biasPool = liquidity(input.draw, input.side);
  const mineHtf = input.mineLadder?.htf ?? "neutral";
  const htfAgainst = (mineHtf === "bull" && input.side === "short") || (mineHtf === "bear" && input.side === "long");
  const bias = htfAgainst ? "against" : biasPool;
  const strips = [input.mineLadder, input.otherLadder]
    .filter((l): l is NonNullable<typeof l> => !!l?.strip)
    .map((l) => `${l.symbol} ${l.strip} ${l.htf}`)
    .join(". ");
  const context = strips
    ? `Both indexes, every rung: ${strips}. The 1m to 5m is only the entry.`
    : "Both indexes. The 1m to 5m is only the entry.";
  const pool = input.draw ? `${input.draw.name} ${input.draw.price.toFixed(2)}` : "no high-value pool";
  const poolSay =
    bias === "with"
      ? `${pool} is unswept in the direction. That pool is the draw.`
      : bias === "against"
        ? htfAgainst
          ? `Higher timeframes on this index read against the ${input.side}. The ladder stands it down. The 1m to 5m does not override that.`
          : `${pool} is unswept the other way. That pool is the bias. Do not fade it.`
        : bias === "swept"
          ? `${pool} already traded. That was the manipulation, not the target.`
          : "No high-value pool is marked.";
  const rungSay = mine ? `${mine.rung}m inverse, the highest in the leg.` : "No 1m to 5m inverse on this index.";
  const leadSay =
    leader === "both"
      ? "NQ and ES inverted together."
      : leader === "neither"
        ? "Neither index has the inverse."
        : leader === me
          ? `${me} led. ${other} has not.`
          : `${leader} led. This index is the laggard.`;
  const thisLeads = leader === me || leader === "both" || leader === "neither";
  return {
    known: true,
    inverse: mine != null,
    rung: mine?.rung ?? null,
    leader,
    thisLeads,
    bias,
    line: `${context} ${rungSay} ${leadSay} ${poolSay}`,
  };
}

/** The minute read outranks a 15m label. A spent draw and an accepted break still stand down. */
export function applyLtf(seq: PbRead, ltf: LtfLead | null): PbRead {
  if (!ltf?.known) return seq;
  if (seq.label === "DRAW SPENT" || seq.label === "STAND DOWN · ACCEPTED") return seq;
  if (!ltf.thisLeads && ltf.leader !== "neither") {
    return { sequence: "wait", label: `STAND DOWN · ${ltf.leader} LEADS`, act: ltf.line, enter: false };
  }
  if (ltf.bias === "against") {
    return { sequence: "wait", label: "BIAS · LIQUIDITY", act: ltf.line, enter: false };
  }
  if (ltf.inverse && ltf.thisLeads && ltf.leader !== "neither") {
    return { sequence: "inverse_after_sweep", label: `ENTER · ${ltf.rung}m`, act: ltf.line, enter: true };
  }
  if (ltf.inverse) {
    return { sequence: "inverse_after_sweep", label: `ANTICIPATION · ${ltf.rung}m`, act: ltf.line, enter: false };
  }
  return seq;
}
