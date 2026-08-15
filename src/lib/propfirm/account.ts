/**
 * Prop-firm account state — the numbers the desk cannot fetch.
 *
 * WHY THIS IS HAND-ENTERED AND NOT READ FROM AN API. Prop firms routinely
 * disable personal API keys on both evaluation and funded Tradovate accounts
 * (checked 2026-08-15 against Tradovate's own community forum). The desk
 * therefore has no authenticated read of balance, peak or day count, and
 * inventing them is not an option — every number in this module comes from
 * the owner typing what their prop dashboard actually says, with the time it
 * was entered recorded alongside it.
 *
 * STALENESS IS PART OF THE DATA. `updatedAt` exists so the panel can say "you
 * told me this 3 days ago" rather than presenting a stale balance as current.
 * A trailing threshold computed from a stale peak is worse than no threshold
 * at all, because it looks authoritative. `stateAgeHours` is what the UI
 * should gate on.
 *
 * ONE ACCOUNT AT A TIME, BY DESIGN. The 5 sibling Apex evaluations
 * (APEX-644704-01..05) are separate accounts with separate trails, but they
 * are traded from the same setups. The panel scores the setup against ONE
 * account's constraints — the tightest one — rather than pretending to track
 * five hand-entered balances that would immediately drift out of date.
 */

import type { PropRules, PropPhase } from "./rules";

const KEY = "ledger-propfirm-account-v1";

export interface DailyResult {
  /** ET trading day, YYYY-MM-DD. */
  day: string;
  /** Realized P&L for that day, in dollars. Negative for a losing day. */
  pnlUsd: number;
}

export interface PropAccountState {
  /** Which rule set applies. Drives target, trail and payout maths. */
  phase: PropPhase;
  /** Account size in dollars, e.g. 50_000. Selects the rule row. */
  sizeUsd: number;
  /**
   * Current account balance from the prop dashboard. For an intraday-trail
   * product this should be the CLOSED balance; unrealized is handled
   * separately because it moves the threshold without being spendable.
   */
  balanceUsd: number;
  /**
   * Highest balance the account has EVER reached, as the prop firm measures
   * it. On an intraday-trail product this includes unrealized peaks — see
   * rules.ts's `trailIncludesUnrealized`, which is exactly why a giving-back
   * runner is more expensive here than in a normal account.
   */
  peakUsd: number;
  /** Distinct days traded so far — drives the minimum-days requirement. */
  daysTraded: number;
  /**
   * Realized results per day, most recent last. Feeds the consistency rule
   * (no single day may be too large a share of total profit) and the
   * daily-loss check. Kept short — only the current evaluation matters.
   */
  history: DailyResult[];
  /** ms epoch when the owner last confirmed these numbers. */
  updatedAt: number;
}

export function emptyPropAccount(): PropAccountState {
  return {
    phase: "none",
    sizeUsd: 50_000,
    balanceUsd: 0,
    peakUsd: 0,
    daysTraded: 0,
    history: [],
    updatedAt: 0,
  };
}

export function loadPropAccount(): PropAccountState {
  if (typeof window === "undefined") return emptyPropAccount();
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return emptyPropAccount();
    const parsed = JSON.parse(raw) as Partial<PropAccountState>;
    const base = emptyPropAccount();
    return {
      ...base,
      ...parsed,
      history: Array.isArray(parsed.history) ? parsed.history : [],
    };
  } catch {
    return emptyPropAccount();
  }
}

export function savePropAccount(state: PropAccountState): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      KEY,
      JSON.stringify({ ...state, updatedAt: Date.now() }),
    );
    window.dispatchEvent(new Event("ledger-propfirm"));
  } catch {
    /* quota — the panel keeps working off the in-memory copy */
  }
}

/** Hours since the owner last confirmed these numbers. Infinity if never. */
export function stateAgeHours(state: PropAccountState, now = Date.now()): number {
  if (!state.updatedAt) return Infinity;
  return (now - state.updatedAt) / 3_600_000;
}

/**
 * Derived account geometry. Every field here is arithmetic over the
 * hand-entered state plus the rule row — no measurement, no estimate.
 */
export interface PropAccountDerived {
  /** peak - trail. Touching this fails the account. */
  thresholdUsd: number | null;
  /** balance - threshold. THE binding number for sizing. */
  roomUsd: number | null;
  /** Dollars still needed to pass (eval) or to reach the payout floor (PA). */
  toGoUsd: number | null;
  /** Total profit so far, balance - starting size. Negative when down. */
  profitUsd: number;
  /** Largest single winning day, for the consistency rule. */
  bestDayUsd: number;
  /**
   * Share of total profit sitting in the single best day. The consistency
   * rule caps this. Null when there is no profit to divide.
   */
  bestDayShare: number | null;
  /** Days still required before a payout / pass is possible. Never negative. */
  daysRemaining: number;
}

export function derivePropAccount(
  state: PropAccountState,
  rules: PropRules | null,
): PropAccountDerived {
  const profitUsd = state.balanceUsd - state.sizeUsd;
  const wins = state.history.filter((d) => d.pnlUsd > 0);
  const bestDayUsd = wins.length ? Math.max(...wins.map((d) => d.pnlUsd)) : 0;
  const bestDayShare =
    profitUsd > 0 && bestDayUsd > 0 ? bestDayUsd / profitUsd : null;

  if (!rules) {
    return {
      thresholdUsd: null,
      roomUsd: null,
      toGoUsd: null,
      profitUsd,
      bestDayUsd,
      bestDayShare,
      daysRemaining: 0,
    };
  }

  const thresholdUsd = state.peakUsd > 0 ? state.peakUsd - rules.trailUsd : null;
  const roomUsd = thresholdUsd == null ? null : state.balanceUsd - thresholdUsd;
  const goal =
    rules.phase === "evaluation" ? rules.profitTargetUsd : rules.payoutFloorUsd;
  const toGoUsd =
    goal == null ? null : Math.max(0, state.sizeUsd + goal - state.balanceUsd);

  return {
    thresholdUsd,
    roomUsd,
    toGoUsd,
    profitUsd,
    bestDayUsd,
    bestDayShare,
    daysRemaining: Math.max(0, rules.minTradingDays - state.daysTraded),
  };
}
