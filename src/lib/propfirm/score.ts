/**
 * Prop-firm trade scoring — a CONSTRAINT layer, not a second confluence score.
 *
 * The scanner already answered "is this a good setup?" Nothing here re-opens
 * that question, and nothing here can promote a setup the engine graded as
 * skip. This module answers a different one: **can this particular account
 * afford this particular trade right now, and at what size?**
 *
 * WHY THE OBJECTIVE IS GENUINELY DIFFERENT FROM DISCRETIONARY SIZING.
 *
 * A normal book risks a fixed fraction of equity, so the binding constraint is
 * a percentage. An evaluation account's binding constraint is the distance to
 * a hard threshold that ENDS the account on touch — and that distance shrinks
 * every time a new peak prints, without ever recovering. So:
 *
 *   - Size is capped by remaining trail ROOM, not by equity. Two accounts with
 *     identical balances can afford wildly different size depending on where
 *     their peak sits.
 *   - Near the profit target you size DOWN, not up. Once the remaining
 *     distance is small, the only way to fail is to give room back; a smaller
 *     position passes just as surely and risks less.
 *   - On an intraday-trail product, LETTING A WINNER GIVE BACK IS EXPENSIVE in
 *     a way it never is elsewhere: unrealized peaks move the threshold
 *     permanently. `rules.trailIncludesUnrealized` drives an explicit warning
 *     because it inverts the usual "let it run" instinct.
 *   - A consistency rule can make a WINNING day harmful, by pushing one day's
 *     share of total profit past the cap and locking out a payout.
 *
 * FAIL-CLOSED. Unknown rules, unknown room, or stale hand-entered state all
 * produce `eligible: false` with a stated reason. This never guesses a size.
 *
 * PURE. No I/O, no storage, no clock beyond an injected `now` — so the whole
 * decision surface is testable from a table of inputs.
 */

import { CONTRACTS, type ContractKey } from "@/lib/aplus/config";
import type { PropRules } from "./rules";
import type { PropAccountState, PropAccountDerived } from "./account";

/**
 * Most of the remaining trail room a single trade may put at risk.
 *
 * Not a firm rule — a house limit, and the one genuinely tunable number here.
 * At 20% a trade can be wrong five times in a row before the account is gone,
 * which is the point: the trail is a hard floor, so surviving a normal losing
 * streak has to be arithmetically guaranteed rather than hoped for.
 */
export const MAX_ROOM_FRACTION_PER_TRADE = 0.2;

/**
 * Below this many dollars of room, stop trading rather than trickle out.
 * Expressed as a fraction of the product's own trail so it scales with size.
 */
export const MIN_ROOM_FRACTION_TO_TRADE = 0.15;

/** Hand-entered state older than this is not trusted to size against. */
export const MAX_STATE_AGE_HOURS = 24;

export interface PropTradeInput {
  /** Resolved contract (MES/MNQ), never the display label. */
  symbol: string;
  /** |entry - stop| in points. */
  riskPts: number;
  /** Contracts the discretionary engine would take. Prop size never exceeds it. */
  discretionaryContracts: number;
  /** Planned reward:risk at the first target, for the to-target maths. */
  rMultiple?: number | null;
}

export interface PropVerdict {
  /** May this account take this trade at all? */
  eligible: boolean;
  /** Permitted size. 0 whenever `eligible` is false. */
  contracts: number;
  /** Which constraint actually set the size. */
  limitedBy:
    | "trail-room"
    | "max-contracts"
    | "discretionary"
    | "target-proximity"
    | "none";
  /** Hard refusals. Non-empty means do not take this trade. */
  blockers: string[];
  /** Real cautions that do not block. */
  warnings: string[];
  /** Dollars at risk at the permitted size. */
  riskUsd: number;
  /** Share of remaining room this trade puts at risk. */
  roomAtRiskShare: number | null;
  /** Wins at this R still needed to reach the goal. Null when unknown. */
  winsToGoal: number | null;
  /** One-line plain reading for the panel. */
  note: string;
}

function refuse(reason: string, extra: string[] = []): PropVerdict {
  return {
    eligible: false,
    contracts: 0,
    limitedBy: "none",
    blockers: [reason, ...extra],
    warnings: [],
    riskUsd: 0,
    roomAtRiskShare: null,
    winsToGoal: null,
    note: reason,
  };
}

export function scorePropTrade(params: {
  trade: PropTradeInput;
  rules: PropRules | null;
  state: PropAccountState;
  derived: PropAccountDerived;
  /** Hours since the owner confirmed the state. */
  stateAgeHours: number;
}): PropVerdict {
  const { trade, rules, state, derived, stateAgeHours } = params;

  // ---- Hard preconditions. Each one is a reason a size cannot be computed,
  // not a risk preference, so each refuses outright.
  if (!rules) {
    return refuse(
      `No confirmed rule set for this account (${state.phase}, $${state.sizeUsd.toLocaleString()}). Add a cited row to propfirm/rules.ts before sizing against it.`,
    );
  }
  if (state.phase === "none") {
    return refuse("No prop account phase selected.");
  }
  if (!(state.balanceUsd > 0) || !(state.peakUsd > 0)) {
    return refuse("Enter the account balance and peak from your prop dashboard first.");
  }
  if (state.peakUsd < state.balanceUsd) {
    return refuse(
      "Peak is below balance — one of the two is mistyped. Refusing to size against an impossible state.",
    );
  }
  if (stateAgeHours > MAX_STATE_AGE_HOURS) {
    const age = Number.isFinite(stateAgeHours)
      ? `${Math.round(stateAgeHours)}h old`
      : "never entered";
    return refuse(
      `Account figures are ${age}. A threshold computed from a stale peak looks authoritative and is not — re-enter balance and peak before sizing.`,
    );
  }

  const roomUsd = derived.roomUsd;
  if (roomUsd == null) {
    return refuse("Cannot compute trail room from the entered figures.");
  }
  if (roomUsd <= 0) {
    return refuse(
      `Balance is at or below the trailing threshold ($${derived.thresholdUsd?.toFixed(0)}). This account is already failed or on the line.`,
    );
  }

  const minRoom = rules.trailUsd * MIN_ROOM_FRACTION_TO_TRADE;
  if (roomUsd < minRoom) {
    return refuse(
      `Only $${roomUsd.toFixed(0)} of trail room left (below the $${minRoom.toFixed(0)} floor). Too thin to trade — one normal loss ends it.`,
    );
  }

  // ---- Sizing. Take the MOST restrictive of every applicable cap.
  const key = (trade.symbol in CONTRACTS ? trade.symbol : "MNQ") as ContractKey;
  const pv = CONTRACTS[key].pointValue;
  const riskPts = Math.max(trade.riskPts, 0.25);
  const perContractRisk = riskPts * pv;
  if (!(perContractRisk > 0)) {
    return refuse("Trade has no measurable risk per contract.");
  }

  const warnings: string[] = [];

  // Cap 1 — trail room. The prop-specific one.
  const roomBudget = roomUsd * MAX_ROOM_FRACTION_PER_TRADE;
  const byRoom = Math.floor(roomBudget / perContractRisk);

  // Cap 2 — the firm's contract limit.
  const contractCap =
    key.startsWith("M") && rules.maxMicroContracts != null
      ? rules.maxMicroContracts
      : rules.maxContracts;

  // Cap 3 — never size ABOVE what the setup itself earned. The prop layer
  // only ever removes size; promoting a B setup because there is room would
  // be the engine's job, and the engine already declined.
  const byDiscretionary = Math.max(0, trade.discretionaryContracts);

  // Cap 4 — target proximity. Once the remaining distance is small, a
  // smaller position passes just as surely and risks strictly less. Only
  // applies when an R is known and the goal is genuinely close.
  let byTarget = Infinity;
  const toGo = derived.toGoUsd;
  const r = trade.rMultiple ?? null;
  if (toGo != null && toGo > 0 && r != null && r > 0) {
    const needed = Math.ceil(toGo / (perContractRisk * r));
    if (needed > 0 && needed < byRoom) {
      byTarget = needed;
      warnings.push(
        `Sized to finish, not to maximise: ${needed} contract${needed === 1 ? "" : "s"} at ${r.toFixed(1)}R covers the $${toGo.toFixed(0)} still needed.`,
      );
    }
  }

  const contracts = Math.max(
    0,
    Math.min(byRoom, contractCap, byDiscretionary, byTarget),
  );

  if (contracts < 1) {
    const tightest =
      byRoom < 1
        ? `trail room allows $${roomBudget.toFixed(0)} of risk but one contract risks $${perContractRisk.toFixed(0)}`
        : byDiscretionary < 1
          ? "the setup itself did not earn a position"
          : "the firm's contract cap";
    return refuse(`Cannot take even one contract — ${tightest}.`);
  }

  const limitedBy: PropVerdict["limitedBy"] =
    contracts === byTarget && byTarget !== Infinity
      ? "target-proximity"
      : contracts === byRoom
        ? "trail-room"
        : contracts === contractCap
          ? "max-contracts"
          : contracts === byDiscretionary
            ? "discretionary"
            : "none";

  const riskUsd = contracts * perContractRisk;
  const roomAtRiskShare = riskUsd / roomUsd;

  // ---- Warnings that do not block but change how the trade is managed.

  if (rules.trailIncludesUnrealized) {
    warnings.push(
      "Intraday trail: unrealized peaks move the threshold permanently. A runner that goes +$800 and closes +$200 costs $600 of room you never get back — bank into strength rather than letting it round-trip.",
    );
  }

  if (rules.trailStopsAtProfitUsd == null) {
    warnings.push(
      "Trail never stops following the peak on this product — room does not rebuild by sitting on profit.",
    );
  }

  // Consistency rule — a winning day can be actively harmful here.
  if (rules.maxSingleDayShare != null && derived.profitUsd > 0) {
    const cap = rules.maxSingleDayShare;
    const projectedBest = Math.max(derived.bestDayUsd, riskUsd * (r ?? 1));
    const projectedProfit = derived.profitUsd + riskUsd * (r ?? 1);
    const projectedShare =
      projectedProfit > 0 ? projectedBest / projectedProfit : null;
    if (derived.bestDayShare != null && derived.bestDayShare > cap) {
      warnings.push(
        `Consistency rule already breached: best day is ${(derived.bestDayShare * 100).toFixed(0)}% of profit (cap ${(cap * 100).toFixed(0)}%). More small green days fix this; another big one does not.`,
      );
    } else if (projectedShare != null && projectedShare > cap) {
      warnings.push(
        `A full win here would push one day to ${(projectedShare * 100).toFixed(0)}% of total profit, past the ${(cap * 100).toFixed(0)}% consistency cap — winning too fast delays the payout.`,
      );
    }
  }

  // Daily loss limit — the trade must fit inside what is left of today.
  if (rules.dailyLossLimitUsd != null) {
    const today = state.history[state.history.length - 1];
    const lostToday = today && today.pnlUsd < 0 ? Math.abs(today.pnlUsd) : 0;
    const leftToday = rules.dailyLossLimitUsd - lostToday;
    if (riskUsd > leftToday) {
      return refuse(
        `Risk $${riskUsd.toFixed(0)} exceeds what is left of today's $${rules.dailyLossLimitUsd} loss limit ($${leftToday.toFixed(0)}).`,
      );
    }
  }

  if (derived.daysRemaining > 0) {
    warnings.push(
      `${derived.daysRemaining} more trading day${derived.daysRemaining === 1 ? "" : "s"} required before this account can ${rules.phase === "evaluation" ? "pass" : "pay out"} — hitting the number early does not shorten it.`,
    );
  }

  if (roomAtRiskShare > MAX_ROOM_FRACTION_PER_TRADE * 0.99) {
    warnings.push(
      `This trade puts ${(roomAtRiskShare * 100).toFixed(0)}% of remaining room at risk — the house ceiling.`,
    );
  }

  const winsToGoal =
    toGo != null && toGo > 0 && r != null && r > 0
      ? Math.ceil(toGo / (contracts * perContractRisk * r))
      : null;

  const goalWord = rules.phase === "evaluation" ? "to pass" : "to the payout floor";
  const note =
    toGo != null && toGo > 0
      ? `${contracts} × ${key} · risk $${riskUsd.toFixed(0)} of $${roomUsd.toFixed(0)} room · $${toGo.toFixed(0)} ${goalWord}${winsToGoal ? ` (~${winsToGoal} win${winsToGoal === 1 ? "" : "s"})` : ""}`
      : `${contracts} × ${key} · risk $${riskUsd.toFixed(0)} of $${roomUsd.toFixed(0)} room`;

  return {
    eligible: true,
    contracts,
    limitedBy,
    blockers: [],
    warnings,
    riskUsd,
    roomAtRiskShare,
    winsToGoal,
    note,
  };
}
