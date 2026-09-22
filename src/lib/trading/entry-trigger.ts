/**
 * The entry trigger — when to be at the screen, and what the click costs.
 *
 * WHY THIS EXISTS
 * On 2026-09-22 the trader's live record was 4 trades, 4 wins, +$113 over two
 * weeks. The direction call works. What does not work yet is the entry: the
 * desk prices a plan on every poll and then says nothing more, so the moment
 * price actually arrives at that price passes unannounced.
 *
 * A NUMBER THIS FILE USED TO CLAIM, AND WHY IT IS GONE
 * The first version justified all of this with "resting at CE paid +0.35R per
 * card against +0.007R paying the print". That figure is real but it is
 * POOLED, and 58% of the shadow book opens in the London killzone — a window
 * the trader is asleep for. Split by killzone on 38,000 1m Databento bars
 * (scripts/measure-micro-entry.mjs): London refusals returned +0.396R/card
 * resting, NY AM refusals returned −0.181R/card resting and −0.040R/card
 * chasing (n=53 cards, 32 fills). Read correctly that is GOOD news about the
 * gates — in the window the trader actually trades, the cards the sequence
 * refused lose money whichever way you enter them, which is what a working
 * refusal looks like. It is not a measured edge for the entry trigger, so
 * this file no longer claims one.
 *
 * What remains true without any statistics: the plan's price is where the
 * order belongs, and an order resting there cannot be turned into a market
 * click by impatience. That is the reason for the tier and the alarm.
 *
 * So this module turns the plan into three things the trader can act on:
 *
 *   TIER     — is this plan worth watching right now? Measured: an array
 *              more than 1 ATR from price ran −0.027R per card (n=95, and
 *              it only filled 43% of the time) while everything closer ran
 *              +0.444R. Pooled across killzones like everything else here,
 *              so treat it as a way to spend attention rather than a proven
 *              edge. With two trades a week, attention is the scarce
 *              resource; FORMING means look away.
 *   TOUCH    — price has entered the entry zone. This is the alarm.
 *   COST     — what the loss you have not had yet does to the week, priced
 *              before the click rather than discovered after it.
 *
 * Plus the runner's value, because a 4-for-4 record is usually made of exits
 * that were too early, and the measured cost of every early exit is on file.
 *
 * Pure and deterministic. No I/O, no clock of its own.
 */

import { APLUS_RULES } from "@/lib/aplus/config";
import type { TradePlan } from "./trade-plan";
import type { SmcMasterBook } from "./smc-master";
import { MANAGEMENT_EVIDENCE } from "./discretion-memory";

export type EntryTier = "live" | "armed" | "forming" | "gone";

/**
 * Distance bands, in ATR, from price to the near edge of the entry array.
 *
 * The cut points are where the shadow book's own buckets change sign:
 * <0.25 ATR +0.208R/card, 0.25–0.5 +0.469, 0.5–1 +0.565, >1 ATR −0.027.
 * Everything inside 1 ATR is worth resting an order in; past it the card is
 * a plan for later, not a trade for now.
 */
export const TIER_LIVE_ATR = 0.25;
export const TIER_ARMED_ATR = 1;

/**
 * Past this the plan is stale rather than forming: price has walked so far
 * from the array that the sequence which produced it is describing a
 * different market. Nothing is refused on this — it only stops the board
 * from pointing at a level three hours of tape away.
 */
export const TIER_GONE_ATR = 3;

export interface EntryRead {
  tier: EntryTier;
  /** Distance from price to the NEAR edge of the array, in ATR. 0 = inside. */
  awayAtr: number | null;
  /** Same distance in points. */
  awayPts: number | null;
  /** True when the live print is inside the entry zone (± the retrace pad). */
  inZone: boolean;
  /** One line: what to do about this plan right now. */
  action: string;
  /** Why the tier is what it is, in tape terms. */
  detail: string;
}

/**
 * Where a plan sits relative to price, and therefore whether it deserves
 * attention. `atr` comes from the draw read; without it the tier falls back
 * to the array's own height, which is the next best scale on the tape.
 */
export function readEntry(
  plan: TradePlan | null,
  price: number,
  atr: number | null,
): EntryRead | null {
  if (!plan || !plan.entryZone) return null;
  const { top, bottom } = plan.entryZone;
  const height = top - bottom;
  const scale = atr != null && atr > 0 ? atr : height > 0 ? height * 4 : null;
  if (scale == null || !(scale > 0)) return null;

  // The same pad the retrace layer uses, so "inside" means the same thing
  // on this board as it does in the sequence.
  const pad = Math.max(height * 0.25, 0.25);
  const inZone = price >= bottom - pad && price <= top + pad;
  const awayPts = inZone ? 0 : price > top ? price - top : bottom - price;
  const awayAtr = awayPts / scale;

  let tier: EntryTier;
  if (inZone || awayAtr <= TIER_LIVE_ATR) tier = "live";
  else if (awayAtr <= TIER_ARMED_ATR) tier = "armed";
  else if (awayAtr <= TIER_GONE_ATR) tier = "forming";
  else tier = "gone";

  const zoneTxt = `${bottom.toFixed(2)}–${top.toFixed(2)}`;
  const action =
    tier === "live"
      ? inZone
        ? `Price is IN the array — the limit at CE ${plan.entry.toFixed(2)} is live now.`
        : `${awayPts.toFixed(2)}pt from the array — rest the limit at CE ${plan.entry.toFixed(2)} and stop watching the screen.`
      : tier === "armed"
        ? `${awayAtr.toFixed(2)} ATR away — set the alert, do not sit here. The touch is what you are waiting for, not the chart.`
        : tier === "forming"
          ? `${awayAtr.toFixed(2)} ATR away — this is a plan for later. Look away; the alarm will call you.`
          : `${awayAtr.toFixed(2)} ATR away — price has walked off this plan. Wait for the sequence to price a new one.`;

  const detail =
    tier === "forming" || tier === "gone"
      ? `Array ${zoneTxt} is ${awayPts.toFixed(2)}pt (${awayAtr.toFixed(2)} ATR) from ${price.toFixed(2)}. Cards this far out ran −0.03R each and filled 43% of the time; cards inside 1 ATR ran +0.44R.`
      : `Array ${zoneTxt}${inZone ? " — price inside" : ` — ${awayPts.toFixed(2)}pt (${awayAtr.toFixed(2)} ATR) away`}. This is the band that pays: +0.44R per card inside 1 ATR.`;

  return { tier, awayAtr, awayPts, inZone, action, detail };
}

/* ── The touch ───────────────────────────────────────────────────────────── */

/**
 * A plan worth alarming on.
 *
 * NOT the same test as "may I trade this". The alarm fires when everything
 * except price being in the array is already true — that is precisely the
 * moment the trader wants to be called, because it is the only thing left
 * that they cannot make happen by waiting. A card with a FAILED must-layer
 * is never alarmed: nothing about it improves by price arriving.
 */
export function isWatchable(book: SmcMasterBook | null): boolean {
  if (!book?.plan) return false;
  if (book.plan.t1 == null) return false;
  const musts = book.layers.filter((l) => l.must);
  if (musts.some((l) => l.state === "fail")) return false;
  // Every must except the retrace (and the target, which the plan satisfies)
  // must already be passing — otherwise the touch is not the last condition.
  return musts.every((l) => l.id === "retrace" || l.state === "pass");
}

/** Stable per-plan key so one touch alarms once, not once per poll. */
export function touchKey(book: SmcMasterBook, dayKey: string): string {
  const p = book.plan;
  return `ce-${book.symbol}-${book.side}-${dayKey}-${p ? p.entry.toFixed(2) : "none"}`;
}

/* ── What the click costs ────────────────────────────────────────────────── */

export interface LossPreview {
  /** Dollars at risk on the REAL money — the RH sleeve ticket. */
  risk: number;
  /** Dollars at risk on the $100k paper book, for the R arithmetic. */
  paperRisk: number;
  /** Where the week lands if this one loses. Null when nothing is logged. */
  weekAfter: number | null;
  /** Where the week lands if it wins at T1. Null when nothing is logged. */
  weekIfT1: number | null;
  line: string;
}

/**
 * Price the loss before the click.
 *
 * A 4-for-4 record makes the fifth trade the dangerous one: the first loss
 * costs more than its dollars because nothing has prepared for it. Naming
 * the number in advance is what keeps trade five the same size as trade four.
 */
export function previewLoss(input: {
  /** The RH sleeve's max debit — the money that actually moves. */
  sleeveRisk: number;
  /** The paper book's risk for the same card, for context. */
  paperRisk: number;
  /** Realised week P&L from the sleeve journal, or null when nothing is logged. */
  weekPnl: number | null;
  rr1: number | null;
  /** Trades logged this week — 0 means the week figure is unknown, not flat. */
  logged: number;
}): LossPreview {
  const { sleeveRisk, paperRisk, weekPnl, rr1, logged } = input;
  const known = weekPnl != null && logged > 0;
  const weekAfter = known ? weekPnl - sleeveRisk : null;
  const weekIfT1 = known
    ? weekPnl + sleeveRisk * (rr1 ?? 1) * APLUS_RULES.scaleOut.tp1Fraction
    : null;
  const money = (n: number) => `${n < 0 ? "−" : "+"}$${Math.abs(Math.round(n)).toLocaleString("en-US")}`;
  const head = `If this one loses: −$${Math.round(sleeveRisk)} on the sleeve (paper book −$${Math.round(paperRisk)}).`;
  const body = known
    ? ` Week goes ${money(weekPnl)} → ${money(weekAfter!)}. If it reaches T1: ${money(weekIfT1!)}.`
    : ` The week is unlogged, so the desk cannot tell you what it does to the run — log the fills and this line becomes real.`;
  return {
    risk: sleeveRisk,
    paperRisk,
    weekAfter,
    weekIfT1,
    line: `${head}${body} Both are survivable; only one of them is a surprise.`,
  };
}

/* ── The runner ──────────────────────────────────────────────────────────── */

export interface RunnerRead {
  /** R already banked at T1. */
  banked: number;
  /** R the runner is worth if it reaches T2. */
  ifT2: number;
  /** R if the runner comes back to break-even. */
  ifBe: number;
  line: string;
}

/**
 * What the open runner is worth, against the measured cost of closing it.
 *
 * The temptation on a 4-for-4 book is to take the rest off at T1 and keep
 * the streak. The measurement says every version of that loses: banking the
 * whole position at +1R cost −0.42R per trade, trailing −0.30R, moving to
 * break-even early −0.07R, against +0.50R for the plan left alone. The
 * runner is where the R:R ≥ 1 rule actually gets paid.
 */
export function readRunner(plan: TradePlan | null, t1Hit: boolean): RunnerRead | null {
  if (!plan || plan.t1 == null) return null;
  const frac = APLUS_RULES.scaleOut.tp1Fraction;
  const rr1 = plan.rr1 ?? 1;
  const rr2 = plan.rr2 ?? rr1 * 2;
  const banked = t1Hit ? rr1 * frac : 0;
  const ifT2 = banked + rr2 * (t1Hit ? 1 - frac : 1);
  const ifBe = t1Hit ? banked : 0;
  const worst = MANAGEMENT_EVIDENCE.rows.reduce((a, r) => (r.costR < a.costR ? r : a), MANAGEMENT_EVIDENCE.rows[0]!);
  return {
    banked,
    ifT2,
    ifBe,
    line: t1Hit
      ? `T1 banked ${banked.toFixed(2)}R. The runner is worth ${ifT2.toFixed(2)}R at T2 and ${ifBe.toFixed(2)}R if it comes back to break-even — you cannot lose from here. Closing it early is the trade that measured ${worst.costR.toFixed(2)}R/trade.`
      : `Plan carries ${rr1.toFixed(2)}R to T1 and ${rr2.toFixed(2)}R to T2. Half comes off at T1 and the stop goes to break-even — that combination measured +${MANAGEMENT_EVIDENCE.baseline.toFixed(2)}R/trade. Every early-protection variant measured worse.`,
  };
}

/* ── Target quality ──────────────────────────────────────────────────────── */

export type ReachTier = "clean" | "thin" | "unlikely";

/**
 * How good the target is, by the draw's own measured reach rate.
 *
 * Shadow book, limit leg, 2026-09-22: draws that were reached in >80% of
 * past sessions ran +0.34R per card at 39% WR and filled 66% of the time;
 * 60–80% ran flat (0.00R, 22% WR); under 60% ran −0.21R at 14% WR and
 * filled only 35%. Monotone in expectancy, win rate AND fill rate, which is
 * what a real effect looks like rather than a noise bucket.
 *
 * Not a gate — the bottom bucket is n=20. It is a label on the target, so a
 * thin draw is known to be thin before the trade rather than after it.
 */
export const REACH_CLEAN = 0.8;
export const REACH_THIN = 0.6;

export function reachTier(reachProbability: number | null | undefined): {
  tier: ReachTier;
  note: string;
} {
  const r = reachProbability ?? null;
  if (r == null) return { tier: "thin", note: "reach unmeasured" };
  if (r >= REACH_CLEAN) {
    return { tier: "clean", note: `${(r * 100).toFixed(0)}% of past sessions reached it — the band that ran +0.34R/card` };
  }
  if (r >= REACH_THIN) {
    return { tier: "thin", note: `${(r * 100).toFixed(0)}% reach — the flat band (0.00R/card, 22% WR). The target is real but do not count on it` };
  }
  return { tier: "unlikely", note: `${(r * 100).toFixed(0)}% reach — the losing band (−0.21R/card, 14% WR, filled 35%). Treat T1 as optimistic` };
}
