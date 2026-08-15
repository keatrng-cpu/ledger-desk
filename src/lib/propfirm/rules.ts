/**
 * Prop-firm rule table.
 *
 * EVERY NUMBER IN THIS FILE IS A CITED FACT, NOT A DEFAULT. These figures
 * decide position size on a real evaluation where touching the threshold ends
 * the account immediately. A plausible-looking guess here is worse than no
 * entry at all, because the panel would size against it with full confidence.
 *
 * The registry is therefore SPARSE ON PURPOSE. An account size or phase that
 * has not been confirmed against the firm's own published rules is simply
 * absent, and `rulesFor` returns null — which `score.ts` treats as "cannot
 * size this account", never as "no constraints apply". Adding a row means
 * citing where the number came from, in the row itself.
 *
 * Rules change. Each row carries `confirmedOn` so a stale row is visible
 * rather than silently trusted; the panel surfaces it.
 */

export type PropPhase = "evaluation" | "funded" | "none";

export interface PropRules {
  firm: string;
  phase: PropPhase;
  /** Account size this row describes, in dollars. */
  sizeUsd: number;
  /** Human label, e.g. "50K Tradovate Intraday Trail". */
  product: string;

  /** Dollars of trailing drawdown from the peak. */
  trailUsd: number;
  /**
   * Does the trail follow INTRADAY equity (unrealized included), or only
   * closed balance?
   *
   * This is the single most consequential field in the table. When true, a
   * winner that runs to +$800 and closes at +$200 has permanently raised the
   * threshold by $800 while banking $200 — the give-back costs real room that
   * never comes back. Scoring must warn about it, because it inverts the
   * normal "let winners run" instinct.
   */
  trailIncludesUnrealized: boolean;
  /**
   * Does the trail ever STOP following the peak? Some products freeze it once
   * the account is up by a set amount. Null = it never stops (worst case for
   * the trader, and the safe assumption only when actually confirmed).
   */
  trailStopsAtProfitUsd: number | null;

  /** Profit above starting balance required to pass. Null on funded rows. */
  profitTargetUsd: number | null;
  /** Balance above starting required before a payout. Null on eval rows. */
  payoutFloorUsd: number | null;

  /** Hard cap on simultaneous contracts (full-size equivalent). */
  maxContracts: number;
  /** Same cap expressed in micros, where the firm states one separately. */
  maxMicroContracts: number | null;

  /** Distinct days that must be traded before passing / withdrawing. */
  minTradingDays: number;
  /**
   * Consistency rule: the largest single day may not exceed this share of
   * total profit. Null when the firm applies none at this phase.
   */
  maxSingleDayShare: number | null;
  /** Hard daily loss limit in dollars, when the firm enforces one. */
  dailyLossLimitUsd: number | null;

  /** Where these numbers came from, and when they were checked. */
  source: string;
  confirmedOn: string;
  /**
   * Anything the source left genuinely ambiguous. Surfaced in the UI —
   * an unresolved rule the owner can check beats a confident wrong number.
   */
  caveats: string[];
}

/**
 * Confirmed rule rows.
 *
 * *** THESE ARE THE POST-2026-03-01 PRODUCTS ONLY. ***
 *
 * Apex retired its entire previous line on 1 March 2026. Accounts bought
 * before that date are "Legacy" and use materially DIFFERENT numbers — a
 * $2,500 trail and a 30% consistency rule on the 50K, versus $2,000 and 50%
 * here. The two cannot be converted in either direction, and encoding the
 * wrong generation is not a rounding error: sizing a current account against
 * the legacy $2,500 trail puts the breaker BELOW the real failure point, so
 * it would fire only after the account was already dead.
 *
 * Legacy rows are deliberately NOT included. If the account predates
 * 2026-03-01, `rulesFor` returns null and the panel refuses to size rather
 * than applying numbers that do not govern it.
 *
 * Verified 2026-08-15 by fetching apextraderfunding.com/help-center directly.
 * (WebFetch 403s on that host; a normal browser User-Agent returns 200.)
 */
export const PROP_RULES: PropRules[] = [
  {
    firm: "Apex",
    phase: "evaluation",
    sizeUsd: 50_000,
    product: "50K Intraday Trailing — Tradovate (post-2026-03-01)",

    trailUsd: 2_000,
    // "Peak Balance includes both realized and unrealized gains." Moves up
    // only, never down, never resets daily.
    trailIncludesUnrealized: true,
    // Tradovate evaluations specifically: "the Intraday Trailing Drawdown
    // continues to trail indefinitely with the Peak Balance and does not stop
    // at a fixed level." (Rithmic evals DO lock, at $53,000 — different
    // product, deliberately not encoded here.)
    trailStopsAtProfitUsd: null,

    profitTargetUsd: 3_000,
    payoutFloorUsd: null,

    // 6 standard / 60 micro, combined across ALL open positions and
    // instruments. Fixed — does not scale with balance.
    maxContracts: 6,
    maxMicroContracts: 60,

    // Zero. An Apex evaluation can be passed in a single day.
    minTradingDays: 0,
    // Explicitly "Not Applied" during the evaluation.
    maxSingleDayShare: null,
    // "There is no DLL for Intraday Drawdown Evaluations." (EOD evals have
    // one; this is not an EOD product.)
    dailyLossLimitUsd: null,

    source:
      "https://apextraderfunding.com/help-center/intraday-trailing-drawdown-accounts/intraday-trailing-drawdown-explained/ + /help-center/evaluation-accounts-ea/intraday-trailing-drawdown-evaluations/ + /help-center/additional-helpful-items/position-sizing-evaluation/",
    confirmedOn: "2026-08-15",
    caveats: [
      "Apex's Prohibited Activities page states 'No Automation or Algorithm Usage allowed' with NO evaluation carve-out. Treat this panel as sizing guidance for MANUAL execution.",
      "Must be flat before 4:59 PM ET — holding through the close forfeits the account and its balances.",
      "Hedging is prohibited entirely, including across accounts and correlated instruments (NQ vs ES counts).",
      "No published numeric hold-time or scalping threshold, but 'small profit target vs disproportionately large risk' is a stated violation (their example: 5-tick TP against a 150-tick stop).",
      "Access is 30 calendar days with no resets and no extensions.",
    ],
  },
  {
    firm: "Apex",
    phase: "funded",
    sizeUsd: 50_000,
    product: "50K Intraday Performance Account (post-2026-03-01)",

    trailUsd: 2_000,
    trailIncludesUnrealized: true,
    // Unlike the Tradovate eval, a PA's threshold DOES stop: it locks at
    // Starting Balance + $100 ($50,100) once peak equity reaches $52,100,
    // and is fixed forever after.
    trailStopsAtProfitUsd: 2_100,

    profitTargetUsd: null,
    // Safety net is $52,100 (start + drawdown + $100) and the minimum payout
    // request is $500 on top, so $52,600 is the first actionable balance.
    // The higher, actionable number is used so "to payout" is not optimistic.
    payoutFloorUsd: 2_600,

    // PAs are capped lower than the eval, and gated further by scaling tier.
    maxContracts: 4,
    maxMicroContracts: 40,

    // 5 qualifying days, each with >= $200 net profit. Need not be consecutive.
    minTradingDays: 5,
    // 50% of net profit since the last approved payout. NOT the legacy 30%.
    maxSingleDayShare: 0.5,
    // Tier-based ($1,000 / $1,000 / $2,000 / $3,000 by profit level), and
    // Apex's own two pages disagree at the L4 boundary. The LOWEST tier is
    // encoded deliberately: under-allowing a trade is recoverable, breaching
    // a daily loss limit is not.
    dailyLossLimitUsd: 1_000,

    source:
      "https://apextraderfunding.com/help-center/intraday-trailing-drawdown-accounts/intraday-trailing-drawdown-payouts/ + /help-center/additional-helpful-items/50-consistency-requirement/ + /help-center/additional-helpful-items/scaling-levels-pa-explained/",
    confirmedOn: "2026-08-15",
    caveats: [
      "Automation is prohibited on funded accounts — this panel is sizing guidance for manual execution only.",
      "Daily loss limit is TIER-BASED and rises with profit; the most conservative tier ($1,000) is encoded. Your real DLL may be higher.",
      "Apex's own pages conflict on the Level 4 boundary ($5,999 vs $6,000 of profit) — a one-dollar gap where the DLL is either $2,000 or $3,000.",
      "Consistency failure hides the payout button; it does not fail the account. Small green days repair it, another large day does not.",
      "Max 6 payouts per PA, then the account closes. Caps: $1,500 / $2,000 / $2,500 / $2,500 / $3,000 / $3,000.",
      "PA closes if you do not record 2 days of >= $50 net profit within any 30 consecutive calendar days.",
    ],
  },
];

export function rulesFor(
  firm: string,
  phase: PropPhase,
  sizeUsd: number,
): PropRules | null {
  if (phase === "none") return null;
  return (
    PROP_RULES.find(
      (r) =>
        r.firm.toLowerCase() === firm.toLowerCase() &&
        r.phase === phase &&
        r.sizeUsd === sizeUsd,
    ) ?? null
  );
}

/** Every firm with at least one confirmed row. */
export function knownFirms(): string[] {
  return [...new Set(PROP_RULES.map((r) => r.firm))];
}

/** Confirmed sizes for a firm+phase, for populating a picker honestly. */
export function knownSizes(firm: string, phase: PropPhase): number[] {
  return PROP_RULES.filter(
    (r) => r.firm.toLowerCase() === firm.toLowerCase() && r.phase === phase,
  ).map((r) => r.sizeUsd);
}
