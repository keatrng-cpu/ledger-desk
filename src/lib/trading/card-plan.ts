/**
 * One stop, everywhere.
 *
 * THE BUG THIS CLOSES
 * The desk carried two stops for the same trade. The sequence priced one in
 * trade-plan.ts — beyond the raid wick, or beyond the entry array's far edge
 * — and that is the stop every measurement this month was taken on. The
 * scanner card carried another: a PDL/PDH string. The card, the paper book,
 * the Log dialog, the TradeZella simulator and the Claude handoff all read the
 * STRING. So the paper book was trading a different system from the one the
 * evidence describes, and on 2026-09-25 the Log dialog prefilled 123 MES on a
 * short whose "stop" sat 22 points below the entry.
 *
 * WHAT THIS DOES
 * When the sequence has priced a plan for the same book and side as a card,
 * the plan is attached to the card and the card's `invalidation` becomes the
 * plan's stop. Everything downstream already reads those two fields, so they
 * all move together — nothing needed a second code path.
 *
 * WHAT THIS DOES NOT DO
 * It prices nothing. A card with no plan keeps its structural invalidation
 * (now always on the correct side — scanner.ts protectiveInvalidation), and
 * `cardSizeRefusal` says in words why anything that sizes from it should not.
 */

import type { SetupCandidate } from "./scanner";
import type { SmcMasterRead } from "./smc-master";
import { MAX_RISK_ATR_TRADABLE, MIN_RISK_ATR, type TradePlan } from "./trade-plan";
import { riskAtrBucket } from "./evidence";

export interface CardPlan {
  entry: number;
  stop: number;
  riskPts: number;
  t1: number | null;
  t2: number | null;
  rr1: number | null;
  rr2: number | null;
  /** ATR(14) of the graded series. Null without bars. */
  atr: number | null;
  /** riskPts / atr — the stop band the evidence pack is cut on. */
  riskAtr: number | null;
  riskTooTight: boolean;
  riskTooWide: boolean;
  riskOverCap: boolean;
  /** The raid the stop sits beyond, when there was one. */
  sweep: number | null;
  /** Named draw T1 is, when there is one. */
  drawName: string | null;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** The stop, in the words a card prints. */
export function planStopText(plan: Pick<TradePlan, "stop" | "sweep">): string {
  return `Stop ${plan.stop.toFixed(2)} — beyond ${
    plan.sweep ? `the raid ${plan.sweep.price.toFixed(2)}` : "the entry array's far edge"
  }`;
}

export function cardPlanFrom(plan: TradePlan): CardPlan {
  const atr = plan.riskAtr != null && plan.riskAtr > 0 ? plan.riskAtr : null;
  return {
    entry: plan.entry,
    stop: plan.stop,
    riskPts: plan.riskPts,
    t1: plan.t1,
    t2: plan.t2,
    rr1: plan.rr1,
    rr2: plan.rr2,
    atr,
    riskAtr: atr ? r2(plan.riskPts / atr) : null,
    riskTooTight: plan.riskTooTight,
    riskTooWide: plan.riskTooWide,
    riskOverCap: plan.riskOverCap,
    sweep: plan.sweep?.price ?? null,
    drawName: plan.draw?.name ?? null,
  };
}

/**
 * Attach each book's priced plan to the card it was priced for.
 *
 * Mutates the candidates in place — the scan object is shared by reference
 * through the payload, and every reader of `c.invalidation` should see the
 * plan's stop without being taught a new field. Returns how many attached.
 *
 * `atrBySymbol` stamps ATR on EVERY card, planned or not, so a card whose stop
 * is structural can still be measured against the band.
 */
export function attachPlansToCards(
  cands: SetupCandidate[],
  master: Pick<SmcMasterRead, "left" | "right">,
  atrBySymbol?: Record<string, number | null | undefined>,
): number {
  let attached = 0;
  for (const c of cands) {
    const atr = atrBySymbol?.[c.symbol];
    if (atr != null && Number.isFinite(atr) && atr > 0) c.atr = atr;
    const book = [master.left, master.right].find(
      (b) => b && b.symbol === c.symbol && b.side === c.side && b.plan,
    );
    if (!book?.plan) continue;
    c.plan = cardPlanFrom(book.plan);
    if (c.plan.atr == null && c.atr) {
      c.plan.atr = c.atr;
      c.plan.riskAtr = r2(c.plan.riskPts / c.atr);
    }
    c.invalidation = planStopText(book.plan);
    c.stopSource = "plan";
    attached++;
  }
  return attached;
}

/** Parse the first price out of a level string ("Above PDH 7783.50 / sweep"). */
function firstNum(s: string | undefined | null): number | null {
  if (!s) return null;
  const m = s.replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
  const n = m ? Number(m[0]) : NaN;
  return Number.isFinite(n) ? n : null;
}

export interface CardRisk {
  entry: number | null;
  stop: number | null;
  riskPts: number | null;
  riskAtr: number | null;
  source: "plan" | "structure" | "none";
}

/** The card's risk geometry, from the plan when there is one. */
export function cardRisk(
  c: Pick<SetupCandidate, "plan" | "stopSource" | "entryPx" | "invalidation" | "atr" | "side">,
): CardRisk {
  if (c.plan) {
    return {
      entry: c.plan.entry,
      stop: c.plan.stop,
      riskPts: c.plan.riskPts,
      riskAtr: c.plan.riskAtr,
      source: "plan",
    };
  }
  const entry = c.entryPx ?? null;
  const stop = c.stopSource === "none" ? null : firstNum(c.invalidation);
  if (entry == null || stop == null) {
    return { entry, stop, riskPts: null, riskAtr: null, source: c.stopSource ?? "none" };
  }
  const inverted = c.side === "long" ? stop >= entry : stop <= entry;
  const riskPts = inverted ? null : Math.abs(entry - stop);
  return {
    entry,
    stop: inverted ? null : stop,
    riskPts,
    riskAtr: riskPts != null && c.atr ? r2(riskPts / c.atr) : null,
    source: inverted ? "none" : "structure",
  };
}

const signedR = (x: number | null | undefined) =>
  x == null ? "" : ` — measured ${x >= 0 ? "+" : "−"}${Math.abs(x).toFixed(2)}R/card`;

/**
 * Why anything that SIZES from this card should refuse — or null.
 *
 * Same conditions, same words, wherever a size is produced: the entry ticket,
 * the paper book, the Log dialog. The measured cost is read from the evidence
 * pack, so a re-measure moves every message at once instead of leaving a
 * number frozen in a string literal.
 */
export function cardSizeRefusal(
  c: Pick<SetupCandidate, "plan" | "stopSource" | "entryPx" | "invalidation" | "atr" | "side">,
): string | null {
  const risk = cardRisk(c);
  if (risk.stop == null || risk.riskPts == null) {
    return c.stopSource === "none" || risk.source === "none"
      ? "No stop on the correct side of the entry — nothing to size from"
      : "No numeric stop on this card — nothing to size from";
  }
  if (!(risk.riskPts > 0)) return "Zero-width stop — nothing to size from";
  if (c.plan?.riskOverCap) return "Stop is wider than this symbol's cap — a landmark, not a stop";
  if (risk.riskAtr != null) {
    if (risk.riskAtr < MIN_RISK_ATR) {
      return `Stop is ${risk.riskAtr.toFixed(2)}×ATR, inside the ${MIN_RISK_ATR}×ATR floor${signedR(riskAtrBucket(risk.riskAtr)?.exp)}`;
    }
    if (risk.riskAtr > MAX_RISK_ATR_TRADABLE) {
      return `Stop is ${risk.riskAtr.toFixed(2)}×ATR, beyond the ${MAX_RISK_ATR_TRADABLE}×ATR band${signedR(riskAtrBucket(risk.riskAtr)?.exp)}`;
    }
  }
  return null;
}
