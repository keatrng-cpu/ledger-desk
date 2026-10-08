/**
 * Robinhood QQQ/SPY options desk.
 *
 * Sleeve is a $1,000 max DEBIT per trade with the loss capped at 15% OF THE
 * DEBIT PAID (trader 2026-09-23). Not the $100k futures book. The old model
 * read the same $1,000 as an account and 15% of it as the ceiling, which
 * sized every ticket at $150 — a sixth of the stated cap.
 * Long debit / debit spread only. Never places RH orders. Debit is an
 * estimate from proxy futures (SPY≈ES/10, QQQ≈NQ/40) — not a chain mid.
 *
 * Prefer QQQ when NQ leads (usual). SPY ATM weeklies are the pricier book;
 * fall back to a 1–3 wide vertical rather than a lottery OTM.
 */

import { isPathFire } from "@/lib/alerts/path-alarm";
import { etfFromFuture } from "@/lib/market/spot-cross";
import type { DeskPayload } from "./build-desk";
import { isJudasWindow, sessionLive} from "./sessions";
import { etDateKey, weekDayFor, type WeekDayKind } from "./week-ahead";
import type { SetupCandidate } from "./scanner";
import {
  evaluateOptionsSwing,
  type OptionSide,
  type SwingUnderlier,
  type SwingSignal,
} from "./options-swing";
import { loadRhSleeve, rhRiskBudgetUsd, rhTicketCapUsd, type RhSleeve } from "./options-sleeve";
// sleeve-sizing.ts is the authority on the new model; this file now actually
// imports it rather than naming it in a comment.
import { CLOCK_WARN, STOP_FRAC_OF_DEBIT, sizeFromStop } from "./sleeve-sizing";
import type { TradePlan } from "./trade-plan";
import { dailyDecayFrac } from "./stop-coherence";
import { RH_WORKING_STOP_PCT, rhWorkingStop, DATABENTO_MONTHLY_USD, RH_WEEKLY_FLOOR_USD, RH_WEEKLY_STRETCH_USD } from "./rh-income";
import { RH_MAX_DEBIT_TOTAL, confidenceFloorFor, contractsAfterEvent } from "@/lib/execution/rh-autofire-gates";
import { gapDirection } from "./gap-direction";
import { monthContractLine } from "./month-contract";

export type RhHorizon = "day" | "swing";
export type RhVerdict = "ARMED" | "WATCH" | "STAND";
export type RhProduct = "single" | "debit_spread";

export type RhStrategyId =
  | "path_continuation"
  | "judas_ifvg_0dte"
  | "smt_lead"
  | "event_second"
  | "htf_swing";

export interface RhTicket {
  underlier: SwingUnderlier;
  side: OptionSide;
  product: RhProduct;
  dteMin: number;
  dteMax: number;
  dteTarget: number;
  deltaMin: number;
  deltaMax: number;
  strikeNote: string;
  contracts: number;
  estDebitEach: number;
  estDebitTotal: number;
  maxLoss: number;
  /**
   * How the contract count was decided.
   *
   * "level" — solved from the futures plan's invalidation distance x delta, so
   *   a tighter stop bought more contracts at the same risk. This is the rule
   *   (trader 2026-09-24); the percentage brake is a backstop behind it.
   * "ceiling" — no priced invalidation yet, so the debit cap decided. Shown
   *   rather than hidden, because a ticket sized this way has not had its real
   *   risk solved for and should be re-sized once the sequence prices a stop.
   */
  sizedFrom: "level" | "ceiling";
  sizeNote: string | null;
  workingStop: number;
  workingStopPct: number;
  cutRule: string;
  riskPctOfSleeve: number;
  hold: string;
  invalidation: string;
  targets: string[];
  robinhood: string;
}

export interface RhStrategyCard {
  id: RhStrategyId;
  name: string;
  horizon: RhHorizon;
  whyHighProb: string;
  verdict: RhVerdict;
  score: number;
  reasons: string[];
  blocks: string[];
  ticket: RhTicket | null;
  proxy: string | null;
  pathBand: string | null;
}

export interface UnderlierQuote {
  underlier: SwingUnderlier;
  proxy: string;
  spotEst: number;
  htf: string;
  dealing: string | null;
  session: string;
  changePct: number;
  role: "lead" | "lag" | "flat";
  ivUsed: number;
  menu: {
    label: string;
    dte: number;
    delta: number;
    single: number;
    spread: number;
    fitsSingle: boolean;
    fitsSpread: boolean;
  }[];
}

export interface OptionsDesk {
  sleeve: RhSleeve;
  maxDebit: number;
  focus: string;
  best: RhStrategyCard | null;
  day: RhStrategyCard[];
  swing: RhStrategyCard[];
  cards: RhStrategyCard[];
  quotes: { spy: UnderlierQuote; qqq: UnderlierQuote };
  primary: SwingUnderlier;
  swingSignal: SwingSignal;
  gates: { id: string; ok: boolean; label: string }[];
}

/** Fixed IV per underlier. Exported so the trading floor's pricer scales VIX by the same QQQ:SPY ratio. */
export const IV = { SPY: 0.17, QQQ: 0.2 } as const;

function underlierOf(symbol: string): SwingUnderlier {
  return symbol.includes("ES") ? "SPY" : "QQQ";
}

/**
 * The futures plan this option is expressing, for the underlier given.
 *
 * SPY expresses the ES book and QQQ the NQ book, so the plan comes from
 * whichever smc-master book maps to that underlier. Null when the sequence
 * has not priced one — which before a completed setup is the normal answer,
 * and the caller then sizes from the ceiling instead and says so.
 */
function planForUnderlier(
  desk: DeskPayload,
  underlier: SwingUnderlier,
): TradePlan | null {
  const m = desk.smcMaster;
  if (!m) return null;
  for (const book of [m.left, m.right]) {
    if (book && underlierOf(book.symbol) === underlier) return book.plan ?? null;
  }
  return null;
}

function proxyPair(desk: DeskPayload) {
  const left = desk.bias.left;
  const right = desk.bias.right;
  const es =
    right.symbol === "ES" || right.symbol === "MES"
      ? right
      : left.symbol === "ES" || left.symbol === "MES"
        ? left
        : right;
  const nq =
    left.symbol === "NQ" || left.symbol === "MNQ"
      ? left
      : right.symbol === "NQ" || right.symbol === "MNQ"
        ? right
        : left;
  const esPx =
    desk.quotes.left.symbol === es.symbol
      ? desk.quotes.left.price
      : desk.quotes.right.symbol === es.symbol
        ? desk.quotes.right.price
        : es.last;
  const nqPx =
    desk.quotes.left.symbol === nq.symbol
      ? desk.quotes.left.price
      : desk.quotes.right.symbol === nq.symbol
        ? desk.quotes.right.price
        : nq.last;
  return { es, nq, esPx, nqPx };
}

function sideFromFutures(side: "long" | "short"): OptionSide {
  return side === "long" ? "call" : "put";
}

function locationFights(side: OptionSide, zone: string | undefined): boolean {
  if (side === "call" && zone === "premium") return true;
  if (side === "put" && zone === "discount") return true;
  return false;
}

function eventKind(kind: WeekDayKind | undefined): boolean {
  return kind === "nfp" || kind === "event";
}

function afterSecondImpulse(clock: DeskPayload["clock"]): boolean {
  return clock.etHour > 10 || (clock.etHour === 10 && clock.etMinute >= 15);
}

/** One A- or better per index. QQQ follows MNQ, SPY follows ES. The first hit on each side is the card. */
function pathCandidates(desk: DeskPayload): SetupCandidate[] {
  const hits = desk.scan.candidates.filter((c) => isPathFire(c));
  const picked: SetupCandidate[] = [];
  const seen = new Set<string>();
  for (const c of hits) {
    const root = /ES/.test(c.symbol) ? "ES" : "NQ";
    if (seen.has(root)) continue;
    seen.add(root);
    picked.push(c);
  }
  return picked;
}

function pathCandidate(desk: DeskPayload): SetupCandidate | undefined {
  return pathCandidates(desk)[0];
}

function componentsHint(c: SetupCandidate | undefined) {
  const set = new Set(c?.components ?? []);
  return {
    sweep: set.has("sweep_significant"),
    displace: set.has("displacement") || set.has("mss") || set.has("cisd"),
    ifvg: set.has("ifvg"),
  };
}

/** Accept a cash spot when it is fresh enough to price a ticket off. */
const PROXY_SPOT_MAX_LAG_SEC = 900;

/**
 * The ETF NOW, from the LIVE future through the ratio the two had at the ETF's own last print
 * (spot-cross.ts). The futures are the live clock (Databento gateway, sub-second); the ETF print
 * only says what the ratio was. Null when the desk could not align one — the callers fall back.
 */
function crossedSpot(
  underlier: SwingUnderlier,
  esPx: number,
  nqPx: number,
  proxies?: DeskPayload["proxies"],
): { px: number; ratio: number; printAgeSec: number } | null {
  const p = proxies?.[underlier];
  if (!p || p.ratio == null) return null;
  const px = etfFromFuture(p.ratio, underlier === "SPY" ? esPx : nqPx, p.price);
  return px == null ? null : { px, ratio: p.ratio, printAgeSec: p.printAgeSec ?? p.lagSec };
}

/**
 * Cash spot for the underlier. A 1-DTE ATM option costs ~0.4% of the ETF, so a 1% error in the
 * spot is about the whole premium — the spot must be the live one:
 *   1. the live future ÷ the ratio it had at the Yahoo print's own timestamp (`crossedSpot`) —
 *      moves at futures speed between desk builds, correct against the print's basis;
 *   2. the Yahoo SPY/QQQ print itself when it is ≤15 min old and no ratio could be aligned;
 *   3. the fixed ES/10, NQ/40 — only when both are missing. The ratio drifts with the futures
 *      basis (fair value, dividends, the roll): a 1% miss on a 700-handle ETF is 7 points, more
 *      than a 0–2 DTE strike step, so a ticket priced off it can sit on the wrong strike.
 * `spotSource` says which one it was.
 */
export function estimateSpot(
  underlier: SwingUnderlier,
  esPx: number,
  nqPx: number,
  proxies?: DeskPayload["proxies"],
): number {
  const crossed = crossedSpot(underlier, esPx, nqPx, proxies);
  if (crossed) return crossed.px;
  const p = proxies?.[underlier];
  if (p && p.price > 0 && p.lagSec <= PROXY_SPOT_MAX_LAG_SEC) return p.price;
  if (underlier === "SPY") return esPx / 10;
  return nqPx / 40;
}

/** "SPY 764.20 (ES live ÷ 10.012, print 312s)", "SPY 764.20 (Yahoo 4s)" or "SPY ≈ 763.40 (ES/10 est.)" — for the card copy. */
export function spotSource(
  underlier: SwingUnderlier,
  esPx: number,
  nqPx: number,
  proxies?: DeskPayload["proxies"],
): string {
  const crossed = crossedSpot(underlier, esPx, nqPx, proxies);
  if (crossed) {
    return `${underlier} ${crossed.px.toFixed(2)} (${underlier === "SPY" ? "ES" : "NQ"} live ÷ ${crossed.ratio.toFixed(3)}, print ${crossed.printAgeSec}s)`;
  }
  const p = proxies?.[underlier];
  if (p && p.price > 0 && p.lagSec <= PROXY_SPOT_MAX_LAG_SEC) {
    return `${underlier} ${p.price.toFixed(2)} (Yahoo ${p.lagSec}s)`;
  }
  return `${underlier} ≈ ${(underlier === "SPY" ? esPx / 10 : nqPx / 40).toFixed(2)} (${underlier === "SPY" ? "ES/10" : "NQ/40"} est.)`;
}

/**
 * Rough debit per CONTRACT (×100). ATM ~ 0.4 S σ √T; scale by Δ/0.40.
 * 0DTE uses 0.25 day so we do not print $0.
 */
export function estimateDebitContract(
  spot: number,
  dte: number,
  delta: number,
  iv: number,
): number {
  const t = Math.max(dte, 0.25) / 365;
  const perShare = spot * iv * Math.sqrt(t) * 0.4 * (delta / 0.4);
  const dollars = perShare * 100;
  return Math.max(15, Math.round(dollars / 5) * 5);
}

/**
 * Round-trip bid/ask on a one-contract ticket, in dollars.
 *
 * SPY and QQQ options are penny-wide (~$0.01–$0.03). A single long costs two
 * crossings; a vertical costs four, because both legs are crossed on the way
 * in and on the way out. At $0.02 a side that is $4 on a single and $8 on a
 * vertical — which sounds trivial until the debit is $60, at which point the
 * spread is 13% of the position before the market moves. Measured on the
 * 2026-09-21 overnight sim, that fee alone turned every $150-risk vertical
 * negative under every filter tested.
 */
const SPREAD_PER_SIDE_USD = 2;
export function roundTripCost(product: RhProduct): number {
  return product === "debit_spread" ? SPREAD_PER_SIDE_USD * 4 : SPREAD_PER_SIDE_USD * 2;
}

/**
 * The most of a debit the round trip may eat before the structure is too
 * small to be worth trading. A single at $60 pays 7%; a vertical at $60 pays
 * 13% and has to find that back before the thesis has even started.
 */
export const MAX_SPREAD_SHARE = 0.09;

function estimateSpreadContract(spot: number, dte: number, iv: number, widthPts: number): number {
  const buy = estimateDebitContract(spot, dte, 0.4, iv);
  const sell = estimateDebitContract(spot, dte, 0.2, iv);
  const widthCap = widthPts * 100;
  const raw = Math.max(20, buy - sell);
  return Math.min(raw, Math.round(widthCap * 0.5));
}

function roundStrike(spot: number): number {
  return Math.round(spot);
}

function maxContracts(dte: number): number {
  if (dte <= 0) return 1;
  if (dte <= 2) return 2;
  return 2;
}

function pickWidth(underlier: SwingUnderlier, dte: number): number {
  if (underlier === "SPY") return dte <= 2 ? 2 : 3;
  return dte <= 2 ? 2 : 4;
}

/**
 * The stop fraction to SIZE against — the worse of the two the desk states.
 *
 * These disagree, in the docs and in the code:
 *   - CLAUDE.md hard rule: "loss capped 15% of the debit paid"
 *     and `sleeve-sizing.ts` STOP_FRAC_OF_DEBIT = 0.15
 *   - CLAUDE.md output contract #6 and the Options tab: "working stop = 25%
 *     of debit", and `rh-income.ts` RH_WORKING_STOP_PCT = 0.25
 *
 * Sizing against 15% while a 25% stop is the one actually worked would put
 * $250 at risk on a $1,000 ticket against a $150 budget — a 67% overshoot,
 * arriving silently, at exactly the moment the ceiling was raised 6.7x.
 *
 * So the ticket is sized against whichever stop loses MORE. Being conservative
 * costs contracts; being wrong here costs the budget. This is deliberately not
 * a resolution of the contradiction — that is the trader's call, and until
 * they make it the desk sizes so that EITHER reading stays inside $150.
 */
export const EFFECTIVE_STOP_FRAC = Math.max(STOP_FRAC_OF_DEBIT, RH_WORKING_STOP_PCT);

/**
 * How many contracts the LOSS BUDGET allows, given the premium brake.
 *
 * WHY THIS EXISTS EVEN THOUGH IT USUALLY EQUALS floor(cap / each)
 * With the brake set at 15% OF THE DEBIT and the budget at 15% OF THE CAP,
 * the two bounds are algebraically identical: risk = n x each x 0.15 <= 150
 * is the same constraint as n x each <= 1000. That equivalence is the whole
 * reason raising the ceiling from $150 to $1,000 does NOT raise risk — it
 * buys 6.7x the delta for the same $150 of loss.
 *
 * But it is an equivalence, not an identity. It breaks the moment the brake
 * fraction and the budget fraction differ — a graded probe, a 25% working
 * stop, any future tuning. Writing the risk bound explicitly means the ticket
 * stays sized by RISK when that happens, instead of silently reverting to
 * "spend the whole ceiling".
 */
export function contractsWithinRisk(each: number, cap: number, riskBudget: number): number {
  if (!(each > 0)) return 0;
  const byDebit = Math.floor(cap / each);
  const lossPerContract = each * EFFECTIVE_STOP_FRAC;
  const byRisk = lossPerContract > 0 ? Math.floor(riskBudget / lossPerContract) : byDebit;
  return Math.max(0, Math.min(byDebit, byRisk));
}

/**
 * Is the premium brake a CLOCK at this DTE?
 *
 * The risk equivalence above rests entirely on the 15% brake being reachable
 * by PRICE. On short expiries it is not: theta alone walks the ticket into
 * the brake regardless of direction, so a "15% stop" on a $1,000 0DTE pile is
 * not a $150 risk — it is $1,000 exposed with a stop that fires on the
 * calendar. CLAUDE.md states the same thing: a 15% brake needs >= 2 DTE for a
 * 4h hold.
 *
 * Sizing to the full ceiling without this check is the one way the new model
 * is more dangerous than the old one, so it is checked here rather than
 * trusted to copy.
 */
export function brakeIsClock(dte: number, holdHours = 4): boolean {
  const decayOverHold = (dailyDecayFrac(dte) * holdHours) / 24;
  return decayOverHold / STOP_FRAC_OF_DEBIT >= CLOCK_WARN;
}

function sizeProduct(
  underlier: SwingUnderlier,
  side: OptionSide,
  spot: number,
  dte: number,
  delta: number,
  iv: number,
  cap: number,
  riskBudget: number,
  plan: TradePlan | null,
): {
  product: RhProduct;
  contracts: number;
  each: number;
  total: number;
  strikeNote: string;
  clock: boolean;
  /** How the size was decided — the trader should be able to see which. */
  sizedFrom: "level" | "ceiling";
  sizeNote: string | null;
} | null {
  const single = estimateDebitContract(spot, dte, delta, iv);
  const nMax = maxContracts(dte);
  const pack = (
    n: number,
    prem: number,
    d: number,
    from: "level" | "ceiling",
    note: string | null,
    clock: boolean,
  ) => {
    const k = roundStrike(spot);
    const steps = d >= 0.35 ? 0 : d >= 0.26 ? 1 : 2;
    const otm = side === "put" ? k - steps : k + steps;
    const where = steps === 0 ? "ATM" : `${steps} OTM`;
    return {
      product: "single" as const,
      contracts: n,
      each: prem,
      total: n * prem,
      strikeNote: `${where} ~${otm} ${side} · est $${(prem / 100).toFixed(2)} (not a chain mid)`,
      clock,
      sizedFrom: from,
      sizeNote: note,
    };
  };
  // SIZE FROM THE LEVEL when the sequence has priced one.
  // ATM first. If that debit does not fit the sleeve, 1 OTM then 2 OTM.
  // A good entry is not stood down because the model ATM was rich, and it is
  // not stood down because one contract's modeled loss is over a small budget.
  if (plan) {
    const tries = [...new Set([delta, 0.3, 0.22])].filter((d) => d >= 0.2);
    for (const d of tries) {
      const prem = estimateDebitContract(spot, dte, d, iv);
      if (!(prem > 0) || prem > cap) continue;
      const sized = sizeFromStop({
        plan,
        delta: d,
        premiumUsd: prem,
        dte,
        riskBudgetUsd: riskBudget,
      });
      const tight = sized.lines[0]?.startsWith("STOP TOO TIGHT") === true;
      if (tight) {
        return pack(
          1,
          prem,
          d,
          "level",
          "One contract. The stop is inside half an ATR, so size is not solved from it. The entry and the target still stand.",
          brakeIsClock(dte),
        );
      }
      if (sized.contracts > 0) {
        const n = Math.min(nMax, sized.contracts);
        const stepped = d < delta - 0.04;
        return pack(
          n,
          prem,
          d,
          "level",
          stepped
            ? `ATM did not fit $${cap}. ${d <= 0.24 ? "2 OTM" : "1 OTM"} does. ${sized.lines[0] ?? ""}`.trim()
            : (sized.lines[0] ?? null),
          sized.clock,
        );
      }
    }
    for (const d of tries) {
      const prem = estimateDebitContract(spot, dte, d, iv);
      if (prem >= 90 && prem <= cap) {
        return pack(
          1,
          prem,
          d,
          "level",
          `One contract at $${prem}. The modeled loss at the stop is over the sleeve budget. The debit fits $${cap}, so the ticket is priced. The stop is still the exit.`,
          brakeIsClock(dte),
        );
      }
    }
    return null;
  }

  // NO PRICED LEVEL — fall back to the ceiling, and say so downstream.
  //
  // When the brake is a clock the ceiling is NOT safe to spend: risk only what
  // can be lost outright, because that is what a decay-driven stop means.
  const clock = brakeIsClock(dte);
  const effCap = clock ? Math.min(cap, riskBudget) : cap;
  // No Math.max(1, …) floor: when the risk check says ZERO contracts, one
  // contract's loss at the brake already exceeds the loss budget, and
  // rounding that up to one printed a $150-250 cut on a "15%" ticket. Fall
  // through to the vertical (and past it to STAND) instead of buying anyway.
  const nSingle = Math.min(nMax, contractsWithinRisk(single, effCap, riskBudget));
  if (single <= effCap && nSingle >= 1) {
    const n = nSingle;
    const k = roundStrike(spot);
    const otm = side === "put" ? k - 1 : k + 1;
    return {
      product: "single",
      contracts: n,
      each: single,
      total: n * single,
      strikeNote: `ATM/~${otm} ${side} · est $${(single / 100).toFixed(2)} (not a chain mid)`,
      clock,
      sizedFrom: "ceiling",
      sizeNote:
        "No priced invalidation yet, so this is sized from the debit ceiling rather than from the level. Re-size once the sequence prices a stop.",
    };
  }
  const width = pickWidth(underlier, dte);
  const spread = estimateSpreadContract(spot, dte, iv, width);
  // A vertical whose four-leg round trip eats more than MAX_SPREAD_SHARE of
  // its own debit is not a cheaper way into the trade, it is a worse one.
  // Returning null here means STAND — which is the honest answer when the
  // sleeve cannot buy a structure that survives its own fees.
  const spreadShare = spread > 0 ? roundTripCost("debit_spread") / spread : 1;
  const nSpread = Math.min(nMax, contractsWithinRisk(spread, effCap, riskBudget));
  if (spread <= effCap && spreadShare <= MAX_SPREAD_SHARE && nSpread >= 1) {
    const n = nSpread;
    const k = roundStrike(spot);
    const longK = side === "put" ? k : k;
    const shortK = side === "put" ? longK - width : longK + width;
    return {
      product: "debit_spread",
      contracts: n,
      each: spread,
      total: n * spread,
      strikeNote: `${longK}/${shortK} ${side} vertical · width $${width} · est $${(spread / 100).toFixed(2)}`,
      clock,
      sizedFrom: "ceiling",
      sizeNote:
        "Vertical sized from the debit ceiling. A spread's loss at the underlying's invalidation is not a single delta times a move, so the level-based solve does not apply to it.",
    };
  }
  return null;
}

function rhLine(t: {
  underlier: SwingUnderlier;
  side: OptionSide;
  product: RhProduct;
  contracts: number;
  total: number;
  each: number;
  strikeNote: string;
  dte: number;
}): string {
  const verb = t.product === "debit_spread" ? "DEBIT SPREAD" : "BUY TO OPEN";
  return `Robinhood: ${verb} ${t.contracts} ${t.underlier} ${t.side.toUpperCase()} · DTE ${t.dte} · ${t.strikeNote} · pay ~$${t.total} ($${t.each}/ea) · cut −${Math.round(RH_WORKING_STOP_PCT * 100)}% ($${rhWorkingStop(t.total)}) · defined max = debit. No naked short. Do not average.`;
}

function toTicket(
  underlier: SwingUnderlier,
  side: OptionSide,
  spot: number,
  dte: number,
  deltaLo: number,
  deltaHi: number,
  iv: number,
  cap: number,
  sleeve: RhSleeve,
  hold: string,
  invalidation: string,
  targets: string[],
  /** The futures plan this option expresses. Null = size from the ceiling. */
  plan: TradePlan | null = null,
): RhTicket | null {
  const sized = sizeProduct(
    underlier,
    side,
    spot,
    dte,
    (deltaLo + deltaHi) / 2,
    iv,
    cap,
    rhRiskBudgetUsd(sleeve),
    plan,
  );
  if (!sized) return null;
  const workingStop = rhWorkingStop(sized.total);
  return {
    underlier,
    side,
    product: sized.product,
    dteMin: dte,
    dteMax: dte,
    dteTarget: dte,
    deltaMin: deltaLo,
    deltaMax: deltaHi,
    strikeNote: sized.strikeNote,
    contracts: sized.contracts,
    estDebitEach: sized.each,
    estDebitTotal: sized.total,
    sizedFrom: sized.sizedFrom,
    sizeNote: sized.sizeNote,
    maxLoss: sized.total,
    workingStop,
    workingStopPct: RH_WORKING_STOP_PCT,
    cutRule: `Sell when futures invalidates OR debit −${Math.round(RH_WORKING_STOP_PCT * 100)}% ($${workingStop}), whichever first. Never 1/3. Never hold to $0.`,
    riskPctOfSleeve: sized.total / sleeve.equity,
    hold,
    invalidation,
    targets,
    robinhood: rhLine({
      underlier,
      side,
      product: sized.product,
      contracts: sized.contracts,
      total: sized.total,
      each: sized.each,
      strikeNote: sized.strikeNote,
      dte,
    }),
  };
}

function underlierSheet(
  underlier: SwingUnderlier,
  proxy: ReturnType<typeof proxyPair>["es"],
  spot: number,
  role: UnderlierQuote["role"],
  cap: number,
): UnderlierQuote {
  const iv = IV[underlier];
  const rows: { label: string; dte: number; delta: number }[] = [
    { label: "0DTE 0.40Δ", dte: 0, delta: 0.4 },
    { label: "1–2 DTE 0.40Δ", dte: 1, delta: 0.4 },
    { label: "5 DTE 0.35Δ", dte: 5, delta: 0.35 },
    { label: "10 DTE 0.35Δ", dte: 10, delta: 0.35 },
    { label: "28 DTE 0.40Δ", dte: 28, delta: 0.4 },
  ];
  return {
    underlier,
    proxy: proxy.symbol,
    spotEst: spot,
    htf: `${proxy.topDown} (${Math.round((proxy.confidence ?? 0) * 100)}%)`,
    dealing: proxy.dealing?.zone ?? null,
    session: proxy.sessionStance,
    changePct: proxy.changePct,
    role,
    ivUsed: iv,
    menu: rows.map((r) => {
      const single = estimateDebitContract(spot, r.dte, r.delta, iv);
      const spread = estimateSpreadContract(spot, r.dte, iv, pickWidth(underlier, r.dte));
      // Gate refuses above RH_MAX_DEBIT_TOTAL ($550). Fit the green "1-lot"
      // cell to the envelope, not the sleeve's $1,000 sizer cap.
      const gateCap = Math.min(cap, RH_MAX_DEBIT_TOTAL);
      return {
        label: r.label,
        dte: r.dte,
        delta: r.delta,
        single,
        spread,
        fitsSingle: single <= gateCap,
        fitsSpread: spread <= gateCap,
      };
    }),
  };
}

function shrinkTicket(t: RhTicket, n: number, note: string): RhTicket {
  const contracts = Math.max(1, Math.floor(n));
  if (t.contracts <= contracts) {
    return { ...t, sizeNote: [t.sizeNote, note].filter(Boolean).join(" · ") };
  }
  const total = Math.round(contracts * t.estDebitEach);
  const workingStop = rhWorkingStop(total);
  return {
    ...t,
    contracts,
    estDebitTotal: total,
    maxLoss: total,
    workingStop,
    riskPctOfSleeve: t.estDebitTotal > 0 ? (t.riskPctOfSleeve * total) / t.estDebitTotal : t.riskPctOfSleeve,
    sizeNote: note,
    robinhood: rhLine({
      underlier: t.underlier,
      side: t.side,
      product: t.product,
      contracts,
      total,
      each: t.estDebitEach,
      strikeNote: t.strikeNote,
      dte: t.dteTarget,
    }),
  };
}

function pathContinuation(desk: DeskPayload, sleeve: RhSleeve, cap: number, forced?: SetupCandidate): RhStrategyCard {
  const blocks: string[] = [];
  const reasons: string[] = [];
  const clock = desk.clock;
  const day = desk.weekAhead?.today ?? weekDayFor(etDateKey());
  const c = forced ?? pathCandidate(desk);
  const { es, nq, esPx, nqPx } = proxyPair(desk);

  if (!clock.isWeekday) blocks.push("Weekend");
  if (day?.kind === "holiday") blocks.push("Cash holiday");
  const eventOn =
    desk.news?.verdict === "blackout" ||
    desk.news?.verdict === "caution" ||
    Boolean(desk.shock?.active) ||
    Boolean(desk.shock?.tail);
  const mins = clock.etHour * 60 + clock.etMinute;
  const clockOn =
    clock.killzone !== "ny_am" ||
    mins >= 11 * 60 ||
    (eventKind(day?.kind) && !afterSecondImpulse(clock));
  const calendarOn = day?.kind === "range_build" || day?.kind === "a_plus_only";
  const pressured = eventOn || clockOn || calendarOn;
  if (!c) blocks.push("No A+/A/A− PATH"); // label kept stable for drills; B+ is accepted above

  if (c) {
    const band = String(c.pathBand || c.grade);
    reasons.push(`${c.symbol} ${c.side} PATH ${band} Q ${c.confluence.toFixed(2)}`);
    reasons.push(c.completeStrategy || c.strategyPrimary);
    if (pressured) {
      const need = confidenceFloorFor(band, true) ?? 1;
      const why = eventOn ? "News" : clockOn ? "Clock" : "Day card";
      reasons.push(
        c.confluence < need
          ? `${why} wants Q ${need.toFixed(2)} (have ${c.confluence.toFixed(2)}). Size is cut. The chart still calls the trade.`
          : `${why} is noted. Bar ${need.toFixed(2)} cleared. Size is cut. The chart calls it.`,
      );
    }
    const series = /ES/.test(c.symbol) === /ES/.test(desk.left.symbol) ? desk.left.bars : desk.right.bars;
    const gaps = gapDirection(series ?? []);
    reasons.push(gaps.line);
    reasons.push(monthContractLine(2000));
    const want = c.side === "long" ? "long" : "short";
    if (gaps.side != null && gaps.side !== want) {
      blocks.push("Direction disagrees — the one-hour and four-hour gaps are not this side");
    } else if (gaps.side == null && !c.htfOk) {
      blocks.push("Direction disagrees — the one-hour and four-hour gaps are not this side");
    }
    reasons.push("Internal or external is a note, not a filter. The 15-minute grade is the permission. The entry is the 1-minute or 5-minute inverse, or the hold.");
    const proxy = c.symbol.includes("ES") ? es : nq;
    if (locationFights(sideFromFutures(c.side), proxy.dealing?.zone)) {
      reasons.push(`Dealing ${proxy.dealing?.zone} fights ${c.side}. Size is cut. The chart still calls it.`);
    }
    if (day?.kind === "range_build" || day?.kind === "a_plus_only") {
      reasons.push(`${day.kind === "range_build" ? "Monday range" : "Week card"} cuts size. It does not ban ${band}.`);
    }
    const seq =
      c.symbol === desk.smcMaster.left.symbol
        ? desk.smcMaster.left
        : desk.smcMaster.right;
    if (seq.word !== "TAKE") {
      reasons.push(`SMC ${seq.word}: ${seq.missing}. Size is cut. A missing layer does not take the path off.`);
    } else {
      reasons.push(`SMC TAKE ${seq.mustPass}/${seq.mustNeed}`);
    }
  }

  const armed = blocks.length === 0 && Boolean(c);
  const watch = Boolean(c) && blocks.every((b) => /NY AM|Judas|Event window|range-build|SMC WAIT/.test(b));
  const verdict: RhVerdict = armed ? "ARMED" : watch ? "WATCH" : "STAND";
  const side = c ? sideFromFutures(c.side) : "put";
  const underlier = c ? underlierOf(c.symbol) : "QQQ";
  const spot = estimateSpot(underlier, esPx, nqPx, desk.proxies);
  let ticket =
    c && verdict !== "STAND"
      ? toTicket(
          underlier,
          side,
          spot,
          1,
          0.35,
          0.45,
          IV[underlier],
          cap,
          sleeve,
          "Sized off the chart. Clock and news only cut size.",
          c.invalidation || "Futures PATH invalidates or HTF flips",
          [
            `Working stop $${rhWorkingStop(cap)} / −${Math.round(RH_WORKING_STOP_PCT * 100)}% of debit — not 1/3, not full`,
            "Trim 50% at one-to-one. The draw stays open — one-to-one is a partial, not the flatten.",
            "A close past the sweep stop ends it. The clock does not.",
          ],
          // Size from the LEVEL: the futures plan this option expresses.
          planForUnderlier(desk, underlier),
        )
      : null;
  if (ticket && c && pressured) {
    const n = contractsAfterEvent(c.confluence, String(c.pathBand || c.grade), true);
    if (n >= 1 && n < ticket.contracts) ticket = shrinkTicket(ticket, n, "Clock/news size cut");
  }
  if (c && verdict !== "STAND" && !ticket) {
    blocks.push(`Nothing from ATM to 2 OTM fits $${cap}. No ticket to send.`);
  }

  return {
    id: "path_continuation",
    name: c ? `PATH ${c.symbol} ${c.side}` : "PATH continuation 1–2 DTE",
    horizon: "day",
    whyHighProb:
      `Same A+/A/A− PATH as Trade Now. 1–2 DTE so 0DTE pin does not own you. Size from the invalidation, then cap the ticket at $${cap} — the 15% brake is the backstop, not the plan.`,
    verdict: verdict === "STAND" ? "STAND" : ticket ? verdict : "WATCH",
    score: c?.confluence ?? 0,
    reasons,
    blocks,
    pathBand: c ? String(c.pathBand || c.grade) : null,
    proxy: c?.symbol ?? null,
    ticket,
  };
}

function judasIfvg0dte(desk: DeskPayload, sleeve: RhSleeve, cap: number): RhStrategyCard {
  const blocks: string[] = [];
  const reasons: string[] = [];
  const clock = desk.clock;
  const day = desk.weekAhead?.today ?? weekDayFor(etDateKey());
  const c = pathCandidate(desk);
  const hint = componentsHint(c);
  const band = c ? String(c.pathBand || c.grade) : null;
  const { esPx, nqPx } = proxyPair(desk);

  if (!clock.isWeekday) blocks.push("Weekend");
  if (day?.kind === "holiday") blocks.push("Cash holiday");
  if (isJudasWindow(clock.etHour, clock.etMinute)) reasons.push("Judas open — size stays 1. The chart still calls it.");
  if (clock.killzone !== "ny_am") reasons.push(`Outside NY AM (${clock.killzoneLabel}) — size stays 1.`);
  if (clock.etHour < 9 || (clock.etHour === 9 && clock.etMinute < 45)) reasons.push("Before 9:45 — 0DTE size stays 1.");
  if (desk.news?.verdict === "blackout" || desk.news?.verdict === "caution" || desk.shock?.active || desk.shock?.tail) {
    reasons.push("News or shock — 0DTE size stays 1. Not a ban.");
  }
  if (eventKind(day?.kind) && !afterSecondImpulse(clock)) reasons.push("Event window — size stays 1, chart still calls it.");
  if (day?.kind === "nfp") reasons.push("NFP — 0DTE size stays 1.");
  if (!c) blocks.push("No A+/A/A− PATH"); // label kept stable for drills; B+ is accepted above
  if (band && !["A+", "A", "A-", "A−", "B+"].includes(band)) blocks.push(`0DTE needs B+ or higher (have ${band})`);
  if (c && !hint.displace) reasons.push("15m displacement not tagged. The 1m or 5m inverse is the entry. The grade is the permission.");
  if (c && !hint.ifvg && !hint.sweep) reasons.push("Sweep or IFVG not on the 15m tag. External and internal both stay eligible. Size stays 1.");

  const liveBand = band === "A+" || band === "A" || band === "A-" || band === "A−" || band === "B+";
  if (c && liveBand) {
    reasons.push(`${c.symbol} ${c.side} ${band} Q ${c.confluence.toFixed(2)}`);
    if (hint.sweep) reasons.push("Sweep tagged");
    if (hint.displace) reasons.push("Displacement / MSS tagged");
    if (hint.ifvg) reasons.push("IFVG tagged");
    reasons.push("1 contract — 0DTE.");
    const seq =
      c.symbol === desk.smcMaster.left.symbol
        ? desk.smcMaster.left
        : desk.smcMaster.right;
    if (seq.word !== "TAKE") {
      reasons.push(`SMC ${seq.word}: ${seq.missing}. Size stays 1. It does not take the path off.`);
    }
  }

  const armed = blocks.length === 0 && Boolean(c) && liveBand;
  const watch = Boolean(c) && liveBand && blocks.every((b) => /Judas|9:45|NY AM|News|shock|NFP|Event/.test(b));
  const verdict: RhVerdict = armed ? "ARMED" : watch ? "WATCH" : "STAND";
  const side = c ? sideFromFutures(c.side) : "put";
  const underlier = c ? underlierOf(c.symbol) : "QQQ";
  const spot = estimateSpot(underlier, esPx, nqPx, desk.proxies);
  const ticket =
    c && verdict !== "STAND"
      ? toTicket(
          underlier,
          side,
          spot,
          0,
          0.35,
          0.5,
          IV[underlier],
          cap,
          sleeve,
          "Minutes. Flat 11:00 ET. No overnight 0DTE.",
          "Failed displacement or reclaim of the raid extreme",
          ["Working stop −25% of debit or failed displacement", "Flat rest at structure or 11:00"],
          // Size from the LEVEL: the futures plan this option expresses.
          planForUnderlier(desk, underlier),
        )
      : null;

  return {
    id: "judas_ifvg_0dte",
    name: "Judas → IFVG 0DTE",
    horizon: "day",
    whyHighProb:
      `A+ after 9:45 with raid + MSS/IFVG only. Ticket ceiling $${cap}; the loss budget is 15% of what you actually pay.`,
    verdict: verdict === "STAND" ? "STAND" : ticket ? verdict : "WATCH",
    score: liveBand ? c?.confluence ?? 0 : 0,
    reasons,
    blocks,
    pathBand: band,
    proxy: c?.symbol ?? null,
    ticket,
  };
}

function smtLead(desk: DeskPayload, sleeve: RhSleeve, cap: number): RhStrategyCard {
  const blocks: string[] = [];
  const reasons: string[] = [];
  const { es, nq, esPx, nqPx } = proxyPair(desk);
  const smt = desk.scan.smt;
  const stack = desk.smtStack?.primary;
  const clock = desk.clock;
  const day = desk.weekAhead?.today ?? weekDayFor(etDateKey());

  const bearish = smt?.state === "bearish_smt" || stack?.kind === "bearish";
  const bullish = smt?.state === "bullish_smt" || stack?.kind === "bullish";

  if (!clock.isWeekday) blocks.push("Weekend");
  if (desk.news?.verdict === "blackout" || desk.news?.verdict === "caution") reasons.push("News is on — SMT size is cut. The divergence still calls it.");
  if (day?.kind === "holiday") blocks.push("Cash holiday");
  if (!bearish && !bullish) blocks.push("No active SMT (need HH vs LH or LL vs HL)");

  let underlier: SwingUnderlier = "QQQ";
  let proxySym = nq.symbol;
  let side: OptionSide = "put";

  if (bearish) {
    side = "put";
    const nqWeaker = (nq.changePct ?? 0) < (es.changePct ?? 0);
    underlier = nqWeaker || nq.topDown === "bear" ? "QQQ" : "SPY";
    proxySym = underlier === "QQQ" ? nq.symbol : es.symbol;
    reasons.push(smt?.note || stack?.note || "Bearish SMT");
    reasons.push(
      `${nq.symbol} ${nq.changePct?.toFixed(2)}% vs ${es.symbol} ${es.changePct?.toFixed(2)}%`,
    );
    if (nq.topDown === "bull" && es.topDown === "bull") {
      blocks.push("Both HTF still bull — SMT fade only, not a swing debit");
    }
    if (underlier === "QQQ" && locationFights("put", nq.dealing?.zone)) {
      blocks.push(`NQ dealing ${nq.dealing?.zone} — wait premium for puts`);
    }
    reasons.push(
      underlier === "QQQ"
        ? `QQQ is the cheaper book on a $${cap} cap when NQ leads weakness`
        : "ES held relative — SPY put only if QQQ already took the high",
    );
  } else if (bullish) {
    side = "call";
    const nqStronger = (nq.changePct ?? 0) > (es.changePct ?? 0);
    underlier = nqStronger || nq.topDown === "bull" ? "QQQ" : "SPY";
    proxySym = underlier === "QQQ" ? nq.symbol : es.symbol;
    reasons.push(smt?.note || stack?.note || "Bullish SMT");
    if (nq.topDown === "bear" && es.topDown === "bear") {
      blocks.push("Both HTF bear — no SMT call");
    }
    if (locationFights("call", (underlier === "QQQ" ? nq : es).dealing?.zone)) {
      blocks.push("Call into premium — wait discount");
    }
  }

  const path = pathCandidate(desk);
  if (path) {
    const pathSide = sideFromFutures(path.side);
    if (pathSide === side) {
      reasons.push(`PATH agrees ${path.symbol} ${path.side} ${path.pathBand || path.grade}`);
    } else if (path.actionable) {
      blocks.push(`PATH fights SMT (${path.symbol} ${path.side})`);
    }
  }

  const score =
    (bearish || bullish ? 0.62 : 0) +
    (nq.topDown === "bear" && bearish ? 0.08 : 0) +
    (path && sideFromFutures(path.side) === side ? 0.06 : 0);

  const sessionOk =
    clock.killzone === "ny_am" || clock.killzone === "ny_pm" || sessionLive(clock);
  const armed = blocks.length === 0 && (bearish || bullish) && sessionOk;
  const watch = (bearish || bullish) && blocks.length <= 1;
  const verdict: RhVerdict = armed ? "ARMED" : watch ? "WATCH" : "STAND";
  const spot = estimateSpot(underlier, esPx, nqPx, desk.proxies);
  const ticket =
    verdict !== "STAND"
      ? toTicket(
          underlier,
          side,
          spot,
          5,
          0.3,
          0.4,
          IV[underlier],
          cap,
          sleeve,
          "2–5 sessions. Out if SMT resolves (both books take the same extreme).",
          side === "put"
            ? "Both books reclaim the sweep high = out. ES taking a high NQ refuses is still valid."
            : "Both books fail the hold low = out",
          ["Trim 50% at +50% of debit", "Do not buy SPY and QQQ together"],
          // Size from the LEVEL: the futures plan this option expresses.
          planForUnderlier(desk, underlier),
        )
      : null;

  if (verdict !== "STAND" && !ticket) {
    blocks.push(`5 DTE ${underlier} too rich for $${cap} — would need a lottery Δ, skip`);
  }

  return {
    id: "smt_lead",
    name: "SMT lead 3–7 DTE",
    horizon: "swing",
    whyHighProb:
      `NQ vs ES is this desk's cleanest tell. QQQ usually wins the $${cap} cap vs SPY ATM.`,
    verdict: verdict === "STAND" ? "STAND" : ticket ? verdict : "WATCH",
    score,
    reasons,
    blocks,
    pathBand: path ? String(path.pathBand || path.grade) : null,
    proxy: proxySym,
    ticket,
  };
}

function eventSecond(desk: DeskPayload, sleeve: RhSleeve, cap: number): RhStrategyCard {
  const blocks: string[] = [];
  const reasons: string[] = [];
  const clock = desk.clock;
  const day = desk.weekAhead?.today ?? weekDayFor(etDateKey());
  const c = pathCandidate(desk);
  const { esPx, nqPx } = proxyPair(desk);

  if (!eventKind(day?.kind) && day?.kind !== "two_way" && day?.kind !== "a_plus_only") {
    blocks.push(`Not an event-style day (${day?.kind ?? "no week card"})`);
  }
  if (!afterSecondImpulse(clock)) reasons.push("Before 10:15 — size cut. The chart still calls it.");
  if (desk.news?.verdict === "blackout" || desk.news?.verdict === "caution") reasons.push(desk.news?.reason || "News on — size cut, not a ban.");
  if (!c) blocks.push("Need PATH after the print");
  if (c && day?.kind === "a_plus_only") reasons.push("Week card cuts size. It does not ban the path.");
  if (c) {
    reasons.push(`${c.symbol} ${c.side} ${c.pathBand || c.grade} after the window`);
    if (day?.trade) reasons.push(day.trade);
  }

  const armed = blocks.length === 0 && Boolean(c);
  const watch = eventKind(day?.kind) || day?.kind === "two_way" || day?.kind === "a_plus_only";
  const verdict: RhVerdict = armed ? "ARMED" : watch && !armed ? "WATCH" : "STAND";
  const side = c ? sideFromFutures(c.side) : "put";
  const underlier = c ? underlierOf(c.symbol) : "QQQ";
  const spot = estimateSpot(underlier, esPx, nqPx, desk.proxies);
  const ticket =
    c && verdict !== "STAND"
      ? toTicket(
          underlier,
          side,
          spot,
          7,
          0.3,
          0.4,
          IV[underlier],
          cap,
          sleeve,
          "1–4 sessions. Flatten before the NEXT high-impact print.",
          c.invalidation || "HTF flip or failed second impulse",
          ["Trim 50% at +50–80%", `Spread first when 7 DTE ATM runs past $${cap}`],
          // Size from the LEVEL: the futures plan this option expresses.
          planForUnderlier(desk, underlier),
        )
      : null;

  return {
    id: "event_second",
    name: "Event second impulse 7–14 DTE",
    horizon: "swing",
    whyHighProb:
      "Week card names the raid. Debit the second impulse after 10:15. Usually a vertical on this sleeve.",
    verdict: verdict === "STAND" ? "STAND" : ticket ? verdict : "WATCH",
    score: armed ? c?.confluence ?? 0 : watch ? 0.45 : 0,
    reasons,
    blocks,
    pathBand: c ? String(c.pathBand || c.grade) : null,
    proxy: c?.symbol ?? null,
    ticket,
  };
}

function htfSwingCard(
  swing: SwingSignal,
  desk: DeskPayload,
  sleeve: RhSleeve,
  cap: number,
): RhStrategyCard {
  const { esPx, nqPx } = proxyPair(desk);
  const verdict: RhVerdict =
    swing.verdict === "ARMED_CALL" || swing.verdict === "ARMED_PUT"
      ? "ARMED"
      : swing.verdict === "WATCH"
        ? "WATCH"
        : "STAND";
  const plan = swing.plan;
  const side = plan?.side ?? "put";
  const underlier = plan?.underlier ?? "QQQ";
  const spot = estimateSpot(underlier, esPx, nqPx, desk.proxies);
  const extraBlocks = [...swing.blocks];
  if (desk.monthAhead?.phase?.id === "labor" && verdict === "ARMED") {
    extraBlocks.push("Labor / NFP week — do not pay 21–45 DTE into Friday");
  }
  const laborWatch = extraBlocks.some((b) => /Labor/.test(b));
  const ticket =
    plan && verdict !== "STAND" && !laborWatch
      ? toTicket(
          underlier,
          side,
          spot,
          21,
          0.3,
          0.4,
          IV[underlier],
          cap,
          sleeve,
          `${plan.holdSessionsMin}–${plan.holdSessionsMax} sessions`,
          plan.invalidation,
          [
            ...plan.targets,
            `ATM 21–45 DTE may not fit $${cap} — expect a vertical or STAND`,
          ],
          // Size from the LEVEL: the futures plan this option expresses.
          planForUnderlier(desk, underlier),
        )
      : null;

  return {
    id: "htf_swing",
    name: "HTF swing 21–45 DTE",
    horizon: "swing",
    whyHighProb:
      `HTF absolute + correct half. On a $${cap} cap a naked 40Δ is reachable where it was not before — size it from the invalidation, not from the cap.`,
    verdict: laborWatch ? "WATCH" : verdict === "STAND" ? "STAND" : ticket ? verdict : "WATCH",
    score: swing.confidence,
    reasons: [...swing.reasons],
    blocks: extraBlocks,
    pathBand: null,
    proxy: swing.proxySymbol,
    ticket,
  };
}

export function evaluateOptionsDesk(
  desk: DeskPayload,
  sleeve: RhSleeve = loadRhSleeve(),
): OptionsDesk {
  // The DEBIT ceiling: `cap` decides `single <= cap` and how many contracts
  // `floor(cap / single)` buys. It was $150, so every ticket was sized at a
  // sixth of the trader's stated $1,000 cap and most ATM rows read "too
  // rich". Clamp to RH_MAX_DEBIT_TOTAL so the sizer never builds a ticket the
  // RH $550 gate refuses (e.g. a 5 DTE ~$575 single under a $1,000 sleeve).
  // The loss cap is a separate number — see rhRiskBudgetUsd.
  const cap = Math.min(rhTicketCapUsd(sleeve), RH_MAX_DEBIT_TOTAL);
  const swingSignal = evaluateOptionsSwing(desk);
  const { es, nq, esPx, nqPx } = proxyPair(desk);
  const nqWeaker = (nq.changePct ?? 0) < (es.changePct ?? 0) - 0.05;
  const nqStronger = (nq.changePct ?? 0) > (es.changePct ?? 0) + 0.05;
  const qqqRole: UnderlierQuote["role"] = nqWeaker ? "lead" : nqStronger ? "lead" : "flat";
  const spyRole: UnderlierQuote["role"] = nqWeaker ? "lag" : nqStronger ? "lag" : "flat";

  const quotes = {
    spy: underlierSheet("SPY", es, estimateSpot("SPY", esPx, nqPx, desk.proxies), spyRole, cap),
    qqq: underlierSheet("QQQ", nq, estimateSpot("QQQ", esPx, nqPx, desk.proxies), qqqRole, cap),
  };

  const both = pathCandidates(desk);
  const pathCards = both.length > 0 ? both.map((c) => pathContinuation(desk, sleeve, cap, c)) : [pathContinuation(desk, sleeve, cap)];
  const path = both[0];
  const primary: SwingUnderlier = path
    ? underlierOf(path.symbol)
    : nq.topDown === "bear" || nqWeaker
      ? "QQQ"
      : "SPY";

  const cards = [
    ...pathCards,
    judasIfvg0dte(desk, sleeve, cap),
    smtLead(desk, sleeve, cap),
    eventSecond(desk, sleeve, cap),
    htfSwingCard(swingSignal, desk, sleeve, cap),
  ];

  const dayBest = cards.filter((c) => c.horizon === "day" && c.verdict === "ARMED" && c.ticket).sort((a, b) => b.score - a.score)[0] ?? null;
  const swingBest = cards.filter((c) => c.horizon === "swing" && c.verdict === "ARMED" && c.ticket).sort((a, b) => b.score - a.score)[0] ?? null;
  // The session sequence wins. A swing card does not take the fill away from a day setup that is already armed.
  const best = dayBest ?? swingBest;
  const day = cards.filter((c) => c.horizon === "day");
  const swing = cards.filter((c) => c.horizon === "swing");

  const clock = desk.clock;
  const dayPlan = desk.weekAhead?.today;
  const gates = [
    { id: "news", ok: true, label: desk.news?.verdict === "clear" || !desk.news?.verdict ? "News clear" : `News ${desk.news.verdict} — size cut, chart decides` },
    {
      id: "judas",
      ok: true,
      label: isJudasWindow(clock.etHour, clock.etMinute) ? "Judas — size cut, chart decides" : "Outside Judas 9:30–9:45",
    },
    {
      id: "htf",
      ok: desk.bias.left.topDown !== "neutral" || desk.bias.right.topDown !== "neutral",
      label: "HTF not neutral",
    },
    { id: "path", ok: Boolean(path), label: path ? `PATH ${path.pathBand || path.grade} ${path.symbol} ${path.side}` : "No PATH card" },
    {
      id: "week",
      ok: dayPlan?.kind !== "holiday",
      label: dayPlan ? `Week card ${dayPlan.kind}` : "No week card",
    },
    {
      id: "smc",
      ok: true,
      label:
        desk.smcMaster.oneBook?.word === "STAND"
          ? "SMC stand — size cut, the path stays"
          : desk.smcMaster.thesis,
    },
    {
      id: "sleeve",
      ok: cap >= 50,
      label: `Ticket ≤ $${cap.toLocaleString()} debit · loss budget ${(sleeve.riskPct * 100).toFixed(0)}% of the debit (≤ $${Math.round(cap * sleeve.riskPct)}) · exit on the level, −${Math.round(RH_WORKING_STOP_PCT * 100)}% is the backstop`,
    },
  ];

  const watch = cards.find((c) => c.verdict === "WATCH");
  const focus = best?.ticket
    ? `RH ${best.ticket.product === "debit_spread" ? "SPREAD" : "BUY"} ${best.ticket.contracts} ${best.ticket.underlier} ${best.ticket.side.toUpperCase()} · ${best.name} · pay ~$${best.ticket.estDebitTotal} · max loss $${best.ticket.maxLoss}`
    : watch
      ? `WATCH — ${watch.name}: ${watch.blocks[0] ?? "timing"}`
      : `STAND RH — ${cards.find((c) => c.blocks[0])?.blocks[0] ?? "no high-prob ticket"}`;

  return {
    sleeve,
    maxDebit: cap,
    focus,
    best,
    day,
    swing,
    cards,
    quotes,
    primary,
    swingSignal,
    gates,
  };
}

export function optionsDeskPlaybook(): string[] {
  return [
    `Ticket ceiling $${RH_MAX_DEBIT_TOTAL} of DEBIT; the loss is capped at 15% of what you actually pay. Size from the LEVEL: contracts = loss budget / (underlying move to the futures invalidation × delta × 100) — a tighter invalidation buys more contracts at the same risk. Exit on that level; the −25% working stop is the disaster backstop, not the plan.`,
    `Databento rent $${DATABENTO_MONTHLY_USD}/mo ≈ $${RH_WEEKLY_FLOOR_USD}/week. One clean PATH covers the bill. $${RH_WEEKLY_STRETCH_USD}/week is a stretch after n≥20 A+ WR≥65% — never a reason to take a B+.`,
    "QQQ ← NQ · SPY ← ES. Never both the same day. QQQ usually fits the cap; SPY ATM weeklies need a vertical.",
    "Live grade is the SMC sequence (DOL → sweep polarity → dealing-range → LTF shift → retrace). ICT/TJR/PB are schools inside it, not extra confluence to stack.",
    "Day default: 1–2 DTE PATH continuation. 0DTE is A+ after 9:45 with SMC TAKE, 1 contract.",
    "SMT lead 3–7 DTE when NQ and ES disagree. Event days: first impulse is the sweep; debit the second after 10:15.",
    "Trim 50% at +40–60% of debit, stop to BE. Time-stop day tickets 11:00 ET. Never average. Separate from the $100k futures paper book.",
  ];
}
