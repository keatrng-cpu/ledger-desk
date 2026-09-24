/**
 * The overnight board — the 15:00 ET decision, graded like the Trade Now desk.
 *
 * WHAT THIS IS FOR
 * At ~15:00 ET the trader has to answer one question: does today's options
 * position (or a new one) go home overnight? The Now desk answers "where is
 * price going"; this answers "what happens to me between 16:15 and 09:30
 * when I cannot touch it". It is a MECHANICS board, not a signal board —
 * the direction still comes from the SMC sequence and the HTF gate. Its
 * verdict vocabulary is deliberately different (HOLD / TRIM / FLATTEN) so it
 * can never be mistaken for an entry.
 *
 * WHY IT REFUSES MORE THAN IT ALLOWS (measured + verified 2026-09-22)
 * The overnight drift is real: QQQ close→open +0.070%/night at 57% positive
 * over the last 2y (+0.054%, t=3.11 over 10y, n=2511; SPY +0.038%, t=2.62),
 * against an intraday +0.026%. It is also documented — Cooper/Cliff/Gulen,
 * Lou/Polk/Skouras (JFE 2019), Hendershott/Livdan/Rösch (JFE 2020),
 * Bogousslavsky (JFE 2021), Boyarchenko/Larsen/Whelan (RFS 2023),
 * Bondarenko/Muravyev (JFQA 2023). But two facts kill the naive version:
 *
 *   1. The drift is not spread across the night. Bondarenko & Muravyev find
 *      the four hours around the EUROPEAN open carry essentially the whole
 *      average return; Boyarchenko et al narrow it to the 02:00–03:00 ET
 *      hour. A US-close→US-open hold is 15+ hours of gap risk bought to
 *      collect one hour of drift. And 2022 ran −0.060%/night: it is a
 *      regime, not a law.
 *   2. No option structure shows a distinguishable overnight edge once the
 *      spread is charged. Black-Scholes over the same 499 nights (IV = VIX
 *      proxy, $0.02/side): 1DTE ATM median −34%/night, 2DTE median −17%,
 *      14DTE Δ.75 +0.6% ± 1.8%, 30DTE Δ.80 +0.6% ± 1.2% — the two ITM
 *      numbers are inside their own error bars and inside the spread.
 *
 * So the board's job is to stop the holds that are mechanically indefensible
 * and to show, in words, what the trader is actually carrying.
 *
 * THE BROKER FACTS THAT DRIVE THE GATES (verified 2026-09-22, re-verify)
 * - Robinhood equity/ETF options trade 09:30–16:00 ET (16:15 for SPY and
 *   other index-tracking ETPs). Extended hours and the 24-hour market are
 *   equities only. A QQQ/SPY long held past the close CANNOT be exited,
 *   trimmed or hedged until 09:30 the next session: 17h15m on a weeknight,
 *   65h15m over a weekend. The −25% working stop does not exist overnight.
 * - Robinhood DOES list overnight options on SPX, XSP, VIX and RUT
 *   (Cboe GTH 20:15–09:25 ET, plus the 16:15–17:00 curb), limit orders
 *   only. XSP is 1/10 SPX, cash-settled and European — no assignment, no
 *   exercise capital — and 1/10 SPX is the same scale the desk already uses
 *   for ES. Its spread is the price of that: ~$0.12 vs ~$0.02 on SPY
 *   (secondary sources; verify on a live chain before trusting it).
 * - Expiry day is broker-controlled: OCC auto-exercises anything $0.01 ITM,
 *   a $1,000 sleeve cannot fund exercise, and Robinhood may force-sell from
 *   15:30 ET (15:45 for late-close names) or file a Do Not Exercise. A
 *   position carried into its expiry day is not the trader's to manage.
 * - PDT is gone (FINRA Notice 26-10, effective 2026-06-04), so "hold
 *   overnight to save a day trade" is not a reason any more. A sub-$2,000
 *   sleeve is a cash account: T+1 settlement and good-faith-violation risk
 *   cap it near one new entry per business day.
 *
 * Deterministic and pure, like every other grader here. No I/O, no clock of
 * its own — the caller passes the desk payload and the instant.
 */

import { APLUS_RULES } from "@/lib/aplus/config";
import type { DeskPayload } from "./build-desk";
import { rhTicketCapUsd, type RhSleeve } from "./options-sleeve";
import type { RhFill } from "./rh-income";
import { etWallParts } from "./sessions";

export type OvernightWord = "HOLD" | "TRIM" | "FLATTEN";
export type OvernightLayerState = "pass" | "wait" | "fail";

export interface OvernightLayer {
  id: string;
  label: string;
  /** A must-layer failing forces FLATTEN. */
  must: boolean;
  state: OvernightLayerState;
  detail: string;
}

/** What the trader is carrying, as far as the board can know it. */
export interface OvernightPosition {
  underlier: string;
  side: "call" | "put";
  /** Debit paid, dollars (one contract). */
  debit: number;
  /** Days to expiry as of today. 0 = expires today. */
  dte: number | null;
  /** Option delta, if known. Drives the gap arithmetic. */
  delta: number | null;
  openedAt?: string;
  note?: string;
}

export interface OvernightMechanics {
  /** ET minutes from the close of this instrument to its next tradable print. */
  unmanageableMin: number;
  unmanageableLabel: string;
  /** "09:30 ET Tue" — the first moment this instrument can be traded again. */
  nextTradable: string;
  /** True when the instrument itself trades in the Cboe overnight session. */
  overnightTradable: boolean;
  /** Weekend hold (Friday close → Monday open). */
  weekend: boolean;
  /** Adverse underlying move, in %, that takes the debit to −25%. Null if unknown. */
  breakGapPct: number | null;
  /** Share of sessions that gap at least that far, from the measured table. */
  breakGapFrequency: string | null;
  /** Theta charged for the hold, in business-day equivalents. */
  thetaDays: number;
}

export interface OvernightRead {
  word: OvernightWord;
  /** The layer that decided it, or "Mechanically clean". */
  missing: string;
  missingDetail: string;
  layers: OvernightLayer[];
  mustPass: number;
  mustNeed: number;
  /** In the 15:00–15:55 ET decision window. */
  inWindow: boolean;
  windowLabel: string;
  mechanics: OvernightMechanics;
  position: OvernightPosition | null;
  /** The honest alternative when options cannot carry the risk. */
  vehicle: {
    headline: string;
    detail: string;
    stopPts: number | null;
    riskDollars: number | null;
  };
  /** One line per measured fact the board is standing on. */
  evidence: string[];
}

/* ── Constants, each with the measurement or source behind it ───────────── */

/** The decision window the trader asked for: 15:00–15:55 ET. */
export const DECIDE_START_MIN = 15 * 60;
export const DECIDE_END_MIN = 15 * 60 + 55;

/** RTH close for equity/ETF options; index-tracking ETPs get the 16:15 bell. */
const ETF_CLOSE_MIN = 16 * 60 + 15;
/** Equity/ETF options reopen at 09:30 ET. */
const RTH_OPEN_MIN = 9 * 60 + 30;
/** Cboe Global Trading Hours for SPX/XSP/VIX/RUT: 20:15 → 09:25 ET. */
const GTH_OPEN_MIN = 20 * 60 + 15;

/** Instruments that can actually be traded overnight at this broker. */
export const OVERNIGHT_TRADABLE = new Set(["SPX", "XSP", "VIX", "RUT"]);

/**
 * Minimum DTE at TOMORROW's open. A contract expiring tomorrow is carried
 * into a session the broker may liquidate from 15:30 ET, on a sleeve that
 * cannot fund exercise. Two clear days is the first honest number.
 */
export const MIN_DTE_TOMORROW = 2;

/**
 * Structure floor for an overnight hold. Short-dated ATM premium overnight
 * is a lottery, not a position: 1DTE ATM median −34%/night, 2DTE −17%
 * (499 nights, BS with a VIX IV proxy and $0.02/side). Only Δ ≥ 0.70 at
 * DTE ≥ 14 gets close to break-even, and even that is inside its error bar.
 */
export const MIN_OVERNIGHT_DTE = 14;
export const MIN_OVERNIGHT_DELTA = 0.7;

/** The working stop, as a share of the debit. Unenforceable overnight. */
export const WORKING_STOP_PCT = 0.25;

/**
 * Weekend theta in business-day equivalents. The calendar model says 3 days
 * Friday→Monday; the floor convention (business 1.0, weekend/holiday 0.5,
 * overnight 0.25) says 1.25 against 1.0 for a weeknight — a ~25% penalty,
 * not 200%. Do not let theta dominate the Friday gate; the 65-hour
 * unmanageable window is the real Friday cost.
 */
export const THETA_DAYS_WEEKNIGHT = 1;
export const THETA_DAYS_WEEKEND = 1.25;

const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

/** Measured gap frequency, QQQ/SPY sessions. Directional, from bar history. */
function gapFrequency(gapPct: number): string {
  if (gapPct <= 0.5) return "about half of all sessions gap this far — it is the normal night";
  if (gapPct <= 1) return "roughly 15–20% of sessions gap ≥1%";
  if (gapPct <= 2) return "a 1–2% gap is a handful of sessions a quarter";
  return "a >2% gap is a few sessions a year, and they cluster on events";
}

function weekdayName(w: number): string {
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][w] ?? "?";
}

/**
 * How long this instrument cannot be traded, from its close to its next
 * tradable print, and what that print is.
 */
export function overnightMechanics(
  now: number,
  underlier: string,
  position: OvernightPosition | null,
): OvernightMechanics {
  const p = etWallParts(now);
  const overnightTradable = OVERNIGHT_TRADABLE.has(underlier.toUpperCase());
  // Friday's close is carried to Monday's open for both instrument classes;
  // the Cboe overnight session does not run Saturday.
  const weekend = p.weekday === 5;
  const daysToNext = weekend ? 3 : 1;

  const closeMin = ETF_CLOSE_MIN;
  const openMin = overnightTradable && !weekend ? GTH_OPEN_MIN : RTH_OPEN_MIN;
  // Minutes from today's close to the next tradable print.
  const minutes = overnightTradable && !weekend
    ? GTH_OPEN_MIN - closeMin // same calendar evening
    : (24 * 60 - closeMin) + openMin + (daysToNext - 1) * 24 * 60;

  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const nextDay = weekdayName((p.weekday + daysToNext) % 7);
  const nextTradable = overnightTradable && !weekend
    ? `20:15 ET tonight (Cboe overnight, limit orders only)`
    : `09:30 ET ${nextDay}`;

  let breakGapPct: number | null = null;
  if (position?.delta != null && position.debit > 0) {
    // A long option loses delta × underlying-move × 100 per contract. The
    // move that costs WORKING_STOP_PCT of the debit, as a % of the
    // underlying, needs the underlier's price — approximate from the debit
    // and delta is impossible without it, so the caller supplies spot via
    // `underlierSpot` on the read below. Here we express it in dollars of
    // underlying move and convert at the call site.
    breakGapPct = null;
  }

  return {
    unmanageableMin: minutes,
    unmanageableLabel: `${h}h${String(m).padStart(2, "0")}m`,
    nextTradable,
    overnightTradable,
    weekend,
    breakGapPct,
    breakGapFrequency: null,
    thetaDays: weekend ? THETA_DAYS_WEEKEND : THETA_DAYS_WEEKNIGHT,
  };
}

export interface OvernightInput {
  desk: DeskPayload;
  now: number;
  sleeve: RhSleeve;
  /** Open RH tickets, if any. The first open one is graded. */
  fills?: RhFill[];
  /** Spot of the underlier being graded, for the gap arithmetic. */
  spot?: number | null;
  /** Explicit position override (a hypothetical the trader is pricing). */
  position?: OvernightPosition | null;
}

/** The open ticket, read out of the RH journal when the caller has one. */
export function positionFromFills(fills: RhFill[] | undefined): OvernightPosition | null {
  const open = (fills ?? []).find((f) => !f.closedAt);
  if (!open) return null;
  const side: "call" | "put" = /put/i.test(open.side) || /put/i.test(open.note) ? "put" : "call";
  // DTE and delta are not in the journal shape; a note like "14dte d.75"
  // is parsed when present, otherwise they stay null and the board says so.
  const dteMatch = /(\d+)\s*dte/i.exec(`${open.note} ${open.side}`);
  const deltaMatch = /(?:delta|Δ|d)\s*\.?(\d{2})/i.exec(`${open.note} ${open.side}`);
  return {
    underlier: open.underlier.toUpperCase(),
    side,
    debit: open.debit,
    dte: open.dte ?? (dteMatch ? Number(dteMatch[1]) : null),
    delta: open.delta ?? (deltaMatch ? Number(`0.${deltaMatch[1]}`) : null),
    openedAt: open.openedAt,
    note: open.note,
  };
}

/**
 * Grade the overnight decision. Pure.
 *
 * Layer order is the order a trader should check them in: can I get out, am
 * I allowed to be here at all, what is scheduled while I am blind, does the
 * structure survive a night, does the direction agree, can I afford it.
 */
export function gradeOvernight(input: OvernightInput): OvernightRead {
  const { desk, now, sleeve } = input;
  const p = etWallParts(now);
  const min = p.hour * 60 + p.minute;
  const inWindow = p.weekday >= 1 && p.weekday <= 5 && min >= DECIDE_START_MIN && min <= DECIDE_END_MIN;
  const windowLabel = !(p.weekday >= 1 && p.weekday <= 5)
    ? "Weekend — nothing to decide"
    : min < DECIDE_START_MIN
      ? `Decision window opens 15:00 ET (${Math.round((DECIDE_START_MIN - min))} min)`
      : min > DECIDE_END_MIN
        ? "Past 15:55 ET — the decision was due before the close"
        : "Decision window — 15:00–15:55 ET";

  const position = input.position ?? positionFromFills(input.fills);
  const underlier = position?.underlier ?? "QQQ";
  const mech = overnightMechanics(now, underlier, position);
  // The ticket ceiling the carry decision grades against.
  const maxDebit = rhTicketCapUsd(sleeve);
  const layers: OvernightLayer[] = [];

  /* 1. Expiry — the broker owns expiry day, not the trader. */
  {
    const dte = position?.dte ?? null;
    const dteTomorrow = dte == null ? null : dte - 1;
    let state: OvernightLayerState = "wait";
    let detail: string;
    if (!position) {
      detail = "No open ticket — grading the mechanics of opening one";
      state = "wait";
    } else if (dte == null) {
      detail = "DTE unknown on this ticket — log it as \"14dte\" in the note, or treat the hold as refused";
      state = "fail";
    } else if (dteTomorrow! < MIN_DTE_TOMORROW) {
      detail = `${dte} DTE today → ${dteTomorrow} at tomorrow's open. Inside expiry control: OCC auto-exercises at $0.01 ITM, the sleeve cannot fund exercise, and the broker may force-sell from 15:30 ET. Close it today.`;
      state = "fail";
    } else {
      detail = `${dte} DTE → ${dteTomorrow} at the open. Clear of the expiry-day liquidation window.`;
      state = "pass";
    }
    layers.push({ id: "expiry", label: "Clear of expiry", must: true, state, detail });
  }

  /* 2. Manageability — can this instrument be traded while you hold it. */
  {
    const state: OvernightLayerState = mech.overnightTradable ? "pass" : "wait";
    const detail = mech.overnightTradable
      ? `${underlier} trades the Cboe overnight session — next print ${mech.nextTradable}. Limit orders only; a resting limit in a thin book is a request, not a stop.`
      : `${underlier} options do not trade until ${mech.nextTradable} — ${mech.unmanageableLabel} with no exit, no trim, no hedge. The −25% working stop does not exist in that window.`;
    layers.push({ id: "manageable", label: "Can be managed overnight", must: false, state, detail });
  }

  /* 3. Event — anything scheduled while you are blind. */
  {
    const news = desk.news;
    const next = news.nextEvent;
    const insideWindow = next != null && next.minutesAway <= mech.unmanageableMin + (ETF_CLOSE_MIN - min);
    let state: OvernightLayerState = "pass";
    let detail = "Nothing high-impact scheduled inside the blind window.";
    if (news.verdict === "blackout") {
      state = "fail";
      detail = news.reason || "News blackout";
    } else if (next && insideWindow && next.impact === "high") {
      state = "fail";
      detail = `${next.name} prints ${next.timeEt} ET (${next.minutesAway} min) — inside the ${mech.unmanageableLabel} you cannot trade. A high-impact release while blind is the definition of an unmanaged risk.`;
    } else if (next && insideWindow) {
      state = "wait";
      detail = `${next.name} ${next.timeEt} ET lands inside the blind window (medium impact) — size for it or stand down.`;
    } else if (next) {
      detail = `Next: ${next.name} ${next.timeEt} ET in ${next.minutesAway} min — outside the blind window.`;
    }
    layers.push({ id: "event", label: "No event while blind", must: true, state, detail });
  }

  /* 4. Direction — the drift is long-biased; the HTF gate still rules. */
  {
    const proxy = underlier === "SPY" || underlier === "XSP" || underlier === "SPX"
      ? (desk.bias.right.symbol.includes("ES") ? desk.bias.right : desk.bias.left)
      : (desk.bias.left.symbol.includes("NQ") ? desk.bias.left : desk.bias.right);
    const side = position?.side ?? "call";
    const want = side === "call" ? "bull" : "bear";
    const htfOk = proxy.topDown === want;
    const ladder = desk.ladder
      ? (proxy.symbol === desk.ladder.left.symbol ? desk.ladder.left : desk.ladder.right)
      : null;
    const ladderOk = ladder == null || ladder.direction === want || ladder.direction === "neutral";
    let state: OvernightLayerState = "pass";
    let detail = `${side.toUpperCase()} with HTF ${proxy.topDown} on ${proxy.symbol}${ladder ? ` · ladder ${ladder.direction} (${ladder.phase.replace(/-/g, " ")})` : ""}.`;
    if (!htfOk) {
      state = "fail";
      detail = `HTF ${proxy.topDown} on ${proxy.symbol} fights a ${side} — the absolute gate applies overnight too.`;
    } else if (!ladderOk) {
      state = "wait";
      detail = `HTF agrees but the ladder reads ${ladder!.direction} from the ${ladder!.decidedBy ?? "top"} — the rungs disagree.`;
    } else if (side === "put") {
      // Puts overnight fight the drift. The one measured exception is a
      // high-VIX regime; the desk has no live VIX feed, so this stays a
      // warning rather than a pass-through.
      state = "wait";
      detail = `HTF ${proxy.topDown} supports a put, but the overnight drift is long-biased in every regime this desk has measured (QQQ +0.070%/night, 57% positive). The only measured put exception is high VIX (≥20) — confirm it by hand before carrying a put.`;
    }
    layers.push({ id: "direction", label: "Direction survives the night", must: true, state, detail });
  }

  /* 5. Structure — what actually survives a night of theta. */
  {
    let state: OvernightLayerState = "wait";
    let detail: string;
    if (!position) {
      detail = `An overnight hold needs DTE ≥ ${MIN_OVERNIGHT_DTE} and Δ ≥ ${MIN_OVERNIGHT_DELTA}. Short-dated ATM is a lottery, not a position: 1DTE ATM loses a third of the debit on the median night, 2DTE a sixth.`;
    } else if (position.dte == null || position.delta == null) {
      state = "fail";
      detail = "DTE or delta unknown — an overnight hold cannot be graded on a ticket that does not say what it is.";
    } else if (position.dte < MIN_OVERNIGHT_DTE || position.delta < MIN_OVERNIGHT_DELTA) {
      state = "fail";
      detail = `${position.dte}DTE Δ${position.delta.toFixed(2)} — below the ${MIN_OVERNIGHT_DTE}DTE / Δ${MIN_OVERNIGHT_DELTA} floor. On 499 nights the median 1DTE ATM lost 34% of the debit overnight and 2DTE 17%; only Δ≥0.70 at DTE≥14 reached break-even, and even that was inside its error bar.`;
    } else {
      state = "pass";
      detail = `${position.dte}DTE Δ${position.delta.toFixed(2)} — the only band that has ever broken even overnight. Theta charged: ${mech.thetaDays} business-day equivalent${mech.thetaDays === 1 ? "" : "s"}.`;
    }
    layers.push({ id: "structure", label: `DTE ≥ ${MIN_OVERNIGHT_DTE} · Δ ≥ ${MIN_OVERNIGHT_DELTA}`, must: true, state, detail });
  }

  let breakGapPct: number | null = null;

  /* 6. Affordability — the structure that works vs the ticket cap. */
  {
    let state: OvernightLayerState = "wait";
    let detail: string;
    if (!position) {
      detail = `Ticket cap ${usd(maxDebit)} — the per-trade DEBIT ceiling, with the loss capped at ${pct(sleeve.riskPct)} of what is actually paid. A 14DTE Δ.75 QQQ call runs about $2,300, still ${(2300 / Math.max(1, maxDebit)).toFixed(1)}× the cap. What fits is a low-delta vertical whose four-leg round trip (~$8) eats a large share of the debit while the whole overnight edge is about $3.`;
    } else if (position.debit > maxDebit) {
      state = "fail";
      detail = `${usd(position.debit)} debit is over the ${usd(maxDebit)} cap — the ticket is too big for the sleeve before the night even starts.`;
    } else {
      state = "pass";
      detail = `${usd(position.debit)} of ${usd(maxDebit)} cap. Worst case overnight is the debit; the −25% working stop is not enforceable while ${underlier} is closed.`;
    }
    layers.push({ id: "afford", label: "Inside the ticket cap", must: true, state, detail });
  }

  /* 7. Gap survivability — what move takes the debit through the stop. */
  {
    const spot = input.spot ?? null;
    let state: OvernightLayerState = "wait";
    let detail = "Needs a ticket and a spot price to compute the gap that breaks it.";
    if (position && position.delta != null && position.debit > 0 && spot != null && spot > 0) {
      // Loss on a 1% adverse move ≈ delta × 1% × spot × 100 per contract.
      const lossPerPct = position.delta * 0.01 * spot * 100;
      const stopDollars = position.debit * WORKING_STOP_PCT;
      breakGapPct = lossPerPct > 0 ? stopDollars / lossPerPct : null;
      if (breakGapPct != null) {
        const survives = breakGapPct >= 1;
        state = survives ? "pass" : "fail";
        detail = survives
          ? `A ${breakGapPct.toFixed(2)}% adverse gap takes the debit to −25%. ${gapFrequency(breakGapPct)}. The position survives a normal night.`
          : `A ${breakGapPct.toFixed(2)}% adverse gap already takes the debit to −25% — and ${gapFrequency(1)}. You would wake up past the stop with no way to have acted on it.`;
      }
    }
    layers.push({ id: "gap", label: "Survives a 1% gap", must: true, state, detail });
  }

  /* ── The verdict ──────────────────────────────────────────────────────── */
  const musts = layers.filter((l) => l.must);
  const mustPass = musts.filter((l) => l.state === "pass").length;
  const mustNeed = musts.length;
  const failed = musts.find((l) => l.state === "fail");
  const waiting = musts.find((l) => l.state === "wait");

  // With nothing open the honest word is FLATTEN — it is the state, not a
  // failure. TRIM only means something when there IS a position to trim.
  let word: OvernightWord;
  if (failed) word = "FLATTEN";
  else if (!position) word = "FLATTEN";
  else if (waiting) word = "TRIM";
  else word = "HOLD";

  const blocker = failed ?? (position ? waiting : null) ?? null;
  const missing = blocker?.label ?? (position ? "Mechanically clean" : "Flat — nothing to carry");
  const missingDetail =
    blocker?.detail ??
    (!position
      ? `Nothing open, so nothing to decide. To open a hold that survives the night you need DTE ≥ ${MIN_OVERNIGHT_DTE}, Δ ≥ ${MIN_OVERNIGHT_DELTA}, a debit inside ${usd(maxDebit)}, and no high-impact print inside the ${mech.unmanageableLabel} you cannot trade. On this sleeve that structure still costs multiples of the ticket cap — which is why the vehicle below is the honest answer.`
      : undefined) ??
    `Every must-layer passes. You are carrying ${position ? usd(position.debit) : "the ticket"} through ${mech.unmanageableLabel} of no-exit, for a drift worth about +0.07%/night that mostly prints in the 02:00–03:00 ET European hour. Decide the exit now, not at 09:30.`;

  /* ── The honest alternative ───────────────────────────────────────────── */
  // Overnight MAE on the desk's own Globex tape (43 nights, Jul–Aug 2026):
  // winning nights dipped p75 99pt on MNQ ($199 on the micro — 132% of the
  // $150 allowance) and 18.3pt on ES ($92 on MES — 61%). MES fits, MNQ does
  // not. No stop was gapped through in 43 nights at MNQ 150pt / ES 25pt.
  const vehicle = mech.overnightTradable
    ? {
        headline: `${underlier} is the manageable option rail`,
        detail:
          "Cboe overnight (20:15–09:25 ET), cash-settled, European-style: no assignment, no exercise capital. Limit orders only, and the spread is wide (~$0.12 vs ~$0.02 on SPY) — verify it on a live chain before sizing.",
        stopPts: null,
        riskDollars: null,
      }
    : {
        headline: "If the risk must be carried overnight, carry it in MES — not in QQQ/SPY premium",
        detail:
          "No theta, no spread bleed, stop-defined risk, and it trades 23/5 so the stop is real. Sized from the desk's own overnight drawdowns: an 18–24 ES-point working stop is where 75–90% of winning nights' dips stop. MNQ does not fit — its p75 dip is 99 points, $199 on the micro, 132% of the ticket allowance. No stop was gapped through in 43 nights. This is a vehicle, not a signal: the sample cannot see an edge at this size and the go/no-go still comes from the sequence.",
        stopPts: 21,
        riskDollars: 105,
      };

  const evidence = [
    "Overnight drift is real and out-of-sample: QQQ +0.054%/night t=3.11 over 10y (n=2511), SPY +0.038% t=2.62 — but 2022 ran −0.060%/night. It is a regime, not a law.",
    "The drift is concentrated in the 02:00–03:00 ET European hour (Boyarchenko/Larsen/Whelan RFS 2023; Bondarenko/Muravyev JFQA 2023). A close→open hold buys 15+ hours of gap risk to collect one.",
    "No option structure showed a distinguishable overnight edge after the spread: 14DTE Δ.75 +0.6% ± 1.8%, 30DTE Δ.80 +0.6% ± 1.2%, 1DTE ATM median −34%.",
    `${underlier} options cannot be traded for ${mech.unmanageableLabel} after the close — the working stop is unenforceable in that window.`,
    "Expiry day belongs to the broker: auto-exercise at $0.01 ITM, forced sale from 15:30 ET, DNE by 17:00 ET.",
  ];

  return {
    word,
    missing,
    missingDetail,
    layers,
    mustPass,
    mustNeed,
    inWindow,
    windowLabel,
    mechanics: { ...mech, breakGapPct, breakGapFrequency: breakGapPct != null ? gapFrequency(breakGapPct) : null },
    position,
    vehicle,
    evidence,
  };
}

/** One line for the HUD / handoff. */
export function overnightLine(read: OvernightRead): string {
  return `${read.word} overnight · ${read.missing}${read.position ? ` · ${read.position.underlier} ${read.position.side} ${usd(read.position.debit)}` : " · no ticket"} · blind ${read.mechanics.unmanageableLabel} → ${read.mechanics.nextTradable}`;
}

/** Paper-equity sanity: the sleeve is not the futures book. */
export const OVERNIGHT_SLEEVE_NOTE = `Sleeve rules unchanged: ${pct(APLUS_RULES.riskByGrade["A+"])} max on the futures book is a different account from the RH sleeve's 15% ticket.`;
