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

import { DATABENTO_MONTHLY_USD } from "../trading/rh-income";

/**
 * Databento, the first hurdle. ONE number: this used to be a second literal
 * 199 beside rh-income.ts's, so a price change would have been paid in one
 * place and swept in the other.
 */
export const DATA_RENT_MONTHLY_USD = DATABENTO_MONTHLY_USD;

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

/* ------------------------------------------------------------------ */
/* The log, read back — cadence, the rate ladder, and what it takes    */
/* ------------------------------------------------------------------ */

/** The minimum a logged month carries for these reads. */
export interface LoggedMonth {
  month: string;
  realizedUsd: number;
  verdict: SweepVerdict;
  sweptUsd: number;
  loggedAt: string;
}

const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;

function monthIndex(m: string): number | null {
  const hit = MONTH_RE.exec(m);
  if (!hit) return null;
  return Number(hit[1]) * 12 + (Number(hit[2]) - 1);
}

function monthFromIndex(i: number): string {
  const y = Math.floor(i / 12);
  const m = (i % 12) + 1;
  return `${y}-${String(m).padStart(2, "0")}`;
}

/**
 * May this month be logged? Only a real month that has already ENDED.
 * The "Month is closed" checkbox is the trader's word; this is the check
 * behind it, because logging September on the 26th of September sweeps a
 * mark — the one thing the waterfall exists to refuse.
 */
export function validateSweepMonth(month: string, currentMonth: string): { ok: boolean; why: string } {
  const i = monthIndex(month);
  const now = monthIndex(currentMonth);
  if (i == null) return { ok: false, why: "Month must be YYYY-MM (01–12)." };
  if (now == null) return { ok: false, why: "Could not read the current month." };
  if (i >= now) {
    return {
      ok: false,
      why: `${month} has not closed yet — it is ${currentMonth} in New York. A month is swept once, after it ends.`,
    };
  }
  if (i < (monthIndex("2020-01") ?? 0)) return { ok: false, why: "That month predates this desk." };
  return { ok: true, why: "closed month" };
}

/**
 * The 40% rate is "earned by a clean year". It was an input nothing ever
 * computed, so it could not be reached. Derived here: at least the 20 closed
 * months that earn 30%, AND the most recent twelve logged months are twelve
 * consecutive calendar months, every one of them positive. A losing or
 * missing month resets the streak — the rate is re-earned, not kept.
 */
export function fullRateFromLog(log: LoggedMonth[]): { earned: boolean; cleanStreak: number; line: string } {
  const sorted = [...log]
    .filter((r) => monthIndex(r.month) != null)
    .sort((a, b) => (a.month < b.month ? 1 : -1));
  let streak = 0;
  let expect: number | null = null;
  for (const r of sorted) {
    const i = monthIndex(r.month) as number;
    if (expect != null && i !== expect) break;
    if (!(r.realizedUsd > 0)) break;
    streak++;
    expect = i - 1;
  }
  const earned = log.length >= SWEEP_ESTABLISHED_MIN_MONTHS && streak >= 12;
  return {
    earned,
    cleanStreak: streak,
    line: earned
      ? `Clean year: the last ${streak} logged months are consecutive and positive. 40% is earned — a losing or skipped month takes it back.`
      : `Clean streak ${Math.min(streak, 12)}/12 consecutive positive months${
          log.length < SWEEP_ESTABLISHED_MIN_MONTHS
            ? `, and ${log.length}/${SWEEP_ESTABLISHED_MIN_MONTHS} closed months`
            : ""
        } toward 40%.`,
  };
}

export interface RateLadder {
  rate: number;
  closedMonths: number;
  cleanStreak: number;
  fullRateEarned: boolean;
  line: string;
}

/** Where the rate stands and what the next step needs. Always derived. */
export function rateLadder(log: LoggedMonth[]): RateLadder {
  const full = fullRateFromLog(log);
  const rate = sweepRate(log.length, full.earned);
  const line =
    rate === SWEEP_RATE_NEW
      ? `${Math.round(rate * 100)}% probe rate. ${log.length}/${SWEEP_ESTABLISHED_MIN_MONTHS} closed months logged toward 30%.`
      : rate === SWEEP_RATE_ESTABLISHED
        ? `30% established rate. ${full.line}`
        : `40% full rate. ${full.line}`;
  return { rate, closedMonths: log.length, cleanStreak: full.cleanStreak, fullRateEarned: full.earned, line };
}

/**
 * The waterfall run backwards: what a month must REALIZE for the sweep to be
 * a given size. sweep = (realized − rent − restore) × rate, so
 * realized = rent + restore + sweep / rate. Arithmetic, not a target.
 */
export function realizedNeededFor(
  targetSweepUsd: number,
  rate: number,
  restoreUsd = 0,
  rent = DATA_RENT_MONTHLY_USD,
): number {
  if (!(rate > 0) || !(targetSweepUsd >= 0)) return Number.POSITIVE_INFINITY;
  return round2(rent + Math.max(0, restoreUsd) + targetSweepUsd / rate);
}

/**
 * Contributions only. ZERO return assumed, on purpose: a projection with a
 * return in it is a historical average wearing a forecast's clothes, which
 * trading.md forbids. This answers only "how many dollars does the habit
 * move", which is the thing the trader controls.
 */
export function contributionPath(
  monthlyUsd: number,
  years: number,
): { months: number; totalUsd: number; line: string } {
  const months = Math.max(0, Math.round(years * 12));
  const totalUsd = round2(Math.max(0, monthlyUsd) * months);
  return {
    months,
    totalUsd,
    line: `$${round2(monthlyUsd).toFixed(2)}/month for ${years} year${years === 1 ? "" : "s"} is $${totalUsd.toLocaleString("en-US", { maximumFractionDigits: 0 })} contributed — before any return, which this tab does not project.`,
  };
}

/**
 * The months the habit skipped: every closed month between the first one
 * logged and the one that just ended that has no record. The store's whole
 * purpose is to answer "did I do this every month" truthfully a year from
 * now, and a gap is the answer it exists to give.
 */
export function missedMonths(log: LoggedMonth[], currentMonth: string): string[] {
  const idx = log.map((r) => monthIndex(r.month)).filter((i): i is number => i != null);
  const now = monthIndex(currentMonth);
  if (!idx.length || now == null) return [];
  const have = new Set(idx);
  const out: string[] = [];
  for (let i = Math.min(...idx); i < now; i++) if (!have.has(i)) out.push(monthFromIndex(i));
  return out;
}

export interface DeployQueue {
  sweptUsd: number;
  /** Dollars recorded as bought with swept cash. */
  deployedUsd: number;
  /** Swept but not yet bought. */
  waitingUsd: number;
  /** The newest sweep's park date — no buy before it. */
  parkedUntil: string | null;
  line: string;
}

/**
 * Swept dollars versus swept dollars actually spent. The sweep log and the
 * share book were two unconnected ledgers, so a month could be logged and
 * never bought and nothing would notice.
 */
export function deployQueue(
  sweeps: { sweptUsd: number; loggedAt: string }[],
  sweepFundedBuysUsd: number,
  now: number,
): DeployQueue {
  const sweptUsd = round2(sweeps.reduce((s, r) => s + (Number.isFinite(r.sweptUsd) ? r.sweptUsd : 0), 0));
  const deployedUsd = round2(Math.max(0, sweepFundedBuysUsd));
  const waitingUsd = round2(Math.max(0, sweptUsd - deployedUsd));
  const latest = [...sweeps]
    .filter((r) => r.sweptUsd > 0)
    .sort((a, b) => (a.loggedAt < b.loggedAt ? 1 : -1))[0];
  let parkedUntil: string | null = null;
  if (latest) {
    const t = Date.parse(latest.loggedAt) + SETTLE_DAYS * 86_400_000;
    if (Number.isFinite(t) && t > now) parkedUntil = new Date(t).toISOString().slice(0, 10);
  }
  const over = round2(deployedUsd - sweptUsd);
  const line =
    sweptUsd === 0
      ? "Nothing swept yet — there is nothing to deploy."
      : waitingUsd > 0
        ? `$${waitingUsd.toFixed(2)} swept and not yet bought${parkedUntil ? `; parked until ${parkedUntil}` : ""}.`
        : over > 0
          ? `Sweep-funded buys exceed the sweep by $${over.toFixed(2)} — either a buy was tagged "sweep" that was new money, or a month is missing from the log.`
          : "Every swept dollar is deployed.";
  return { sweptUsd, deployedUsd, waitingUsd, parkedUntil, line };
}
