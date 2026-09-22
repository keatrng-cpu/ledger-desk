/**
 * The sweep waterfall — how an options dollar becomes a share.
 *
 * WHY THIS FILE EXISTS AND WHY IT IS FIRST
 * Futures PATH is hours. The options sleeve is days. This book is years.
 * Three clocks on one desk, and the way a good options week turns into a
 * forced sale of shares is by letting the fast clock reach the slow book.
 * So the only connection between them is this file: a mechanical, monthly,
 * one-way transfer. Nothing on this tab reads smcMaster.word, the 0.65
 * floor, the Judas window, or a PATH grade. Nothing here can be triggered
 * by a green scanner print.
 *
 * THE WATERFALL, IN ORDER. Each step eats before the next one is served.
 *   1. The month must be CLOSED and POSITIVE. A losing month sweeps zero —
 *      the sleeve is the engine and it gets repaired before anything is
 *      harvested. Open premium is not cash and never enters this number.
 *   2. DATA RENT. Databento is $199/mo. It is the cost of the signal that
 *      produced the profit, so it is paid out of that profit first. Shares
 *      come after the desk is solvent, not before.
 *   3. SLEEVE RESTORATION. If the sleeve is below its working size, the
 *      deficit is refilled next. A sweep that shrinks the engine to feed
 *      the ballast is backwards.
 *   4. Only what survives all three is split, at a rate that has to be
 *      EARNED by closed months rather than chosen by mood.
 *
 * THE NUMBER THIS PRODUCES TODAY, AND WHY IT IS THE POINT
 * On the trader's own live record — +$113 over two weeks, n=4 — the monthly
 * run rate is about $226. Rent is $199. That leaves $27, and at the opening
 * 20% rate the sweep is about $5. Five dollars a month. The first year of
 * this book will look like a joke, and that is the correct result rather
 * than a bug in the policy: the habit is the product, and the arithmetic is
 * telling the truth about where the desk actually stands. (n=4 is not a
 * record. It is four coin flips that landed heads.)
 *
 * It is also telling you something louder. Rent is 88% of gross. `rentDrag`
 * exists so the tab can say that out loud, because at this scale NO
 * allocation decision on this page is worth as much as removing that bill.
 * $199/mo is $2,388/yr — roughly 440x the current monthly sweep, at a
 * probability of 1.0. Picking between VTI and a compounder is rounding
 * error next to it.
 *
 * WHAT THIS FILE WILL NOT DO
 * It will not sweep an open mark, a paper fill, a projection, or a futures
 * P&L. It will not size from account equity. It will not move a dollar back
 * OUT of the share book into the sleeve — the sweep is one-way on purpose,
 * because the whole reason to do it is that it is the part an edge that
 * turns out to be illusory cannot lose.
 */

/** Databento, the first hurdle. Mirrors the desk's stated monthly rent. */
export const DATA_RENT_MONTHLY_USD = 199;

/** The options sleeve's working size — restore to this before sweeping. */
export const SLEEVE_TARGET_USD = 1_000;

/**
 * Sweep rate ladder. The rate is earned by closed months, not chosen.
 * It deliberately mirrors how the desk already gates A+ risk: a probe size
 * until there is an n, then a step up.
 */
export const SWEEP_RATE_NEW = 0.2;
export const SWEEP_RATE_ESTABLISHED = 0.3;
export const SWEEP_RATE_FULL = 0.4;
/** Closed options months needed before the rate steps up from the probe. */
export const SWEEP_ESTABLISHED_MIN_MONTHS = 20;

/**
 * Swept cash parks before it buys. This is not superstition about timing —
 * it is a circuit breaker against "I just won, buy the high", which is the
 * most reliable way a winning month becomes a bad cost basis.
 */
export const SETTLE_DAYS = 3;

/** Above this, the data bill is the story and the allocation is noise. */
export const RENT_DRAG_ALARM = 0.5;

export interface SweepInputs {
  /** Realized, CLOSED options P&L for the month, net of commissions. */
  realizedMonthUsd: number;
  /** The month is over. A month in progress sweeps nothing. */
  monthClosed: boolean;
  /** Data rent owed for the month. */
  dataRentMonthlyUsd?: number;
  /** Current RH options sleeve equity. */
  sleeveEquityUsd: number;
  /** Working sleeve size to restore to. */
  sleeveTargetUsd?: number;
  /** Closed options months on record — gates the rate. */
  closedMonths: number;
  /** Twelve straight positive months and no sleeve blowup. Earns 40%. */
  fullRateEarned?: boolean;
}

export type SweepVerdict =
  /** Positive, solvent, sleeve whole — a number moves. */
  | "SWEEP"
  /** Month not closed, or flat/negative. Nothing moves. */
  | "HOLD"
  /** Profit exists but the sleeve is under size — it is refilled instead. */
  | "RESTORE"
  /** The month did not cover its own data bill. */
  | "SHORT";

export interface WaterfallStep {
  label: string;
  /** Dollars consumed (negative) or received (positive) at this step. */
  usd: number;
  /** Dollars still in hand after it. */
  leftUsd: number;
  note: string;
}

export interface SweepPlan {
  verdict: SweepVerdict;
  /** The earned rate actually applied. */
  rate: number;
  /** Dollars leaving the sleeve for the share book. One-way. */
  sweepUsd: number;
  /** Dollars staying in / returning to the sleeve. */
  toSleeveUsd: number;
  /** Rent actually covered this month, and what was missing. */
  rentCoveredUsd: number;
  rentShortfallUsd: number;
  /** Dollars redirected to refill the sleeve before any sweep. */
  restoreUsd: number;
  /** rent / realized. At 1.0 the desk worked the month for the vendor. */
  rentDrag: number;
  /** True when the data bill dominates — the tab should say so loudly. */
  rentAlarm: boolean;
  /** The waterfall, priced, in order, for display. */
  steps: WaterfallStep[];
  /** The single sentence the tab prints. */
  note: string;
  /** Earliest the swept cash should be spent. */
  settleDays: number;
}

/** The rate this record has earned. Never an argument, always derived. */
export function sweepRate(closedMonths: number, fullRateEarned = false): number {
  if (fullRateEarned) return SWEEP_RATE_FULL;
  if (closedMonths >= SWEEP_ESTABLISHED_MIN_MONTHS) return SWEEP_RATE_ESTABLISHED;
  return SWEEP_RATE_NEW;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Price the month. Pure — same inputs, same plan, no clock, no market.
 */
export function planSweep(input: SweepInputs): SweepPlan {
  const rent = input.dataRentMonthlyUsd ?? DATA_RENT_MONTHLY_USD;
  const target = input.sleeveTargetUsd ?? SLEEVE_TARGET_USD;
  const realized = Number.isFinite(input.realizedMonthUsd) ? input.realizedMonthUsd : 0;
  const rate = sweepRate(input.closedMonths, input.fullRateEarned);
  const rentDrag = realized > 0 ? rent / realized : Number.POSITIVE_INFINITY;
  const steps: WaterfallStep[] = [];

  const base = {
    rate,
    rentDrag,
    rentAlarm: realized > 0 && rentDrag >= RENT_DRAG_ALARM,
    settleDays: SETTLE_DAYS,
  };

  if (!input.monthClosed) {
    return {
      ...base,
      verdict: "HOLD",
      sweepUsd: 0,
      toSleeveUsd: 0,
      rentCoveredUsd: 0,
      rentShortfallUsd: rent,
      restoreUsd: 0,
      steps,
      note: "Month still open — nothing is swept from a mark. The sweep prices once, after the close.",
    };
  }

  if (realized <= 0) {
    return {
      ...base,
      verdict: "HOLD",
      sweepUsd: 0,
      toSleeveUsd: 0,
      rentCoveredUsd: 0,
      rentShortfallUsd: rent,
      restoreUsd: 0,
      steps: [
        { label: "Realized options P&L", usd: realized, leftUsd: realized, note: "flat or negative" },
      ],
      note:
        realized < 0
          ? `Losing month (${round2(realized)}). No sweep — the sleeve is the engine and it gets repaired first.`
          : "Flat month. No sweep.",
    };
  }

  let left = realized;
  steps.push({
    label: "Realized options P&L",
    usd: realized,
    leftUsd: left,
    note: "closed trades only — open premium is not cash",
  });

  // 2 — data rent.
  const rentCovered = Math.min(rent, left);
  left -= rentCovered;
  const rentShortfall = round2(rent - rentCovered);
  steps.push({
    label: "Databento rent",
    usd: -rentCovered,
    leftUsd: round2(left),
    note: rentShortfall > 0 ? `${rentShortfall} still owed` : "covered",
  });

  if (rentShortfall > 0) {
    return {
      ...base,
      verdict: "SHORT",
      sweepUsd: 0,
      toSleeveUsd: 0,
      rentCoveredUsd: round2(rentCovered),
      rentShortfallUsd: rentShortfall,
      restoreUsd: 0,
      steps,
      note: `The month earned ${round2(realized)} against a ${rent} data bill — ${rentShortfall} short. Nothing becomes shares until the signal pays for itself.`,
    };
  }

  // 3 — sleeve restoration.
  const deficit = Math.max(0, target - input.sleeveEquityUsd);
  const restore = Math.min(deficit, left);
  left -= restore;
  if (deficit > 0) {
    steps.push({
      label: "Sleeve restoration",
      usd: -restore,
      leftUsd: round2(left),
      note: `sleeve ${round2(input.sleeveEquityUsd)} to target ${target}`,
    });
  }

  if (left <= 0) {
    return {
      ...base,
      verdict: "RESTORE",
      sweepUsd: 0,
      toSleeveUsd: round2(restore),
      rentCoveredUsd: round2(rentCovered),
      rentShortfallUsd: 0,
      restoreUsd: round2(restore),
      steps,
      note: `Rent cleared, but the whole remainder refills the sleeve (${round2(restore)}). A sweep that shrinks the engine to feed the ballast is backwards.`,
    };
  }

  // 4 — the split.
  const sweep = round2(left * rate);
  const keep = round2(left - sweep);
  steps.push({
    label: `Sweep to shares (${Math.round(rate * 100)}%)`,
    usd: -sweep,
    leftUsd: keep,
    note: "one-way — this never comes back to the sleeve",
  });
  steps.push({ label: "Stays in the sleeve", usd: keep, leftUsd: 0, note: "grows the engine" });

  return {
    ...base,
    verdict: "SWEEP",
    sweepUsd: sweep,
    toSleeveUsd: round2(keep + restore),
    rentCoveredUsd: round2(rentCovered),
    rentShortfallUsd: 0,
    restoreUsd: round2(restore),
    steps,
    note: `${round2(realized)} realized, ${rent} rent${restore > 0 ? `, ${round2(restore)} restore` : ""}, ${sweep} to shares at the earned ${Math.round(rate * 100)}%. Parks ${SETTLE_DAYS} days before it buys.`,
  };
}

/**
 * What the rent actually costs, priced against the sweep it displaces.
 * This is the highest-expected-value line on the tab and it is not an
 * allocation decision: cancelling a $199/mo bill is a certain $2,388/yr,
 * where every share on this page is a probabilistic one.
 */
export function rentVsSweep(plan: SweepPlan, rent = DATA_RENT_MONTHLY_USD) {
  const annualRent = rent * 12;
  const annualSweep = round2(plan.sweepUsd * 12);
  const multiple = annualSweep > 0 ? Math.round(annualRent / annualSweep) : Number.POSITIVE_INFINITY;
  return {
    annualRent,
    annualSweep,
    /** How many years of sweeping one year of rent is worth. */
    multiple,
    line:
      annualSweep > 0
        ? `One year of data rent ($${annualRent}) is ${multiple}x one year of sweeping at the current rate ($${annualSweep}). Removing the bill is worth more than every allocation choice on this page combined, at probability 1.0.`
        : `One year of data rent is $${annualRent}. The current sweep rate is $0/yr. The bill is the entire problem.`,
  };
}
