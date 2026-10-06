/**
 * Nova's ledger — what an option on a futures plan is worth, before and
 * while the room holds it.
 *
 * THE QUESTION THE DESK DOES NOT ASK
 * The desk prices a futures plan: P(T1 | filled) within 8 hours
 * (hit-odds-model.json). The room buys a 0–1 DTE option on that plan, flat at
 * 11:00 ET, paying the spread twice and theta every minute. A plan can be
 * right and the option still lose: T1 at 14:40 is a win for MNQ and a loss
 * for a call sold at 11:00. So every ticket is priced on three measured paths
 * (time-odds.ts, scripts/measure-option-time.mjs):
 *
 *   T1    T1 prints before the flat — sold at the model BID at T1, at the
 *         measured likely bar
 *   loss  a stop or failed hold before the flat — sold at the BID there, or
 *         at the −20% backstop if the premium gets there first
 *   none  neither — sold at the flat, at the measured mean mark of plans
 *         still open by then
 *
 * EV is the probability-weighted P&L per contract after both crossings.
 * Every input is either measured (the curves, P(T1)) or the room's own model
 * (Black-Scholes r = 0, VIX-scaled IV, the desk's crossing cost) — and the
 * model is the same one the paper book fills and marks on, so the ledger
 * can't promise a price the book would not pay.
 *
 * WHAT THIS IS NOT
 * Not an edge claim. EV here is a REFUSAL rule (no ticket whose priced paths
 * lose money after costs) and a ranking (ATM vs one-out). Whether refusing on
 * it helps is measured forward by the ghost room (lab.ts), not asserted.
 */

import { HIT_ODDS_MODEL, planHitOdds } from "@/lib/trading/hit-odds-model";
import { etWallToEpochMs } from "@/lib/trading/sessions";
import { clockEt } from "./format";
import { ROOM_CLOCK, ROOM_MANDATE } from "./mandate";
import { HALF_SPREAD, blackScholes, ivFor, quoteOption, yearsToExpiry, type OptionType, type StrikeOffset } from "./option-math";
import { BAR_MS, barGrid, windowOdds, type TimeOddsFile, type WindowOdds } from "./time-odds";
import type { HeldLevels, RoomPositionIn, UnderlierTape } from "./orchestrator";

export interface PlanRead {
  side: "long" | "short";
  entry: number;
  stop: number;
  t1: number | null;
  atr: number | null;
  /** The futures symbol (MNQ/ES) — lets the desk model re-price the odds on a tighter stop. */
  symbol?: string;
}

export interface Scenario {
  kind: "t1" | "loss" | "none";
  p: number;
  /** Bars after the fill bar. */
  bar: number;
  atMs: number;
  fut: number;
  etf: number;
  /** Per share, what the option sells for on this path. */
  exitPx: number;
  /** Per contract, dollars, after both crossings. */
  pnlUsd: number;
}

export interface OptionEv {
  measured: boolean;
  curveKey: string | null;
  /** The desk model's 8-hour P(T1 | filled). */
  pT1Model: number;
  window: WindowOdds;
  scenarios: Scenario[];
  /** Per contract, dollars. */
  evUsd: number;
  /** EV per dollar of debit. */
  evPerDollar: number;
  /** Green at T1 by the likely T1 bar — the first question for any option. */
  t1Pays: boolean;
  t1PnlUsd: number;
  /** Round trip, per contract. */
  spreadUsd: number;
  /** Theta to the flat with spot still, per contract. */
  thetaToFlatUsd: number;
  /** The ETF price where the bid at the likely T1 time equals the ask paid. */
  breakevenEtf: number | null;
  /**
   * Where the −20% premium backstop actually sits, as a futures price, and
   * whether it is tighter than the plan's own stop. On a high-gamma contract
   * it usually is: the option's stop is then the binding stop, and the odds
   * are the desk model's odds on THAT stop, not the plan's.
   */
  premiumStop: { fut: number; etf: number; atr: number | null; tighter: boolean; pT1Plan: number } | null;
  /**
   * The same paths weighted by the model's odds AFTER its own out-of-sample
   * calibration (calibratedP) — Sterling's number. Quoted, NOT a gate: it was
   * built because the model is optimistic at p 12–28% (realized 3–5 points
   * under), but requiring it as well did not pick better tickets on four years
   * (−$10.02 a contract, n 22, z −0.64, scripts/measure-room-ev.mjs).
   */
  calibrated: { p: number; pT1: number; pLoss: number; pNone: number; evUsd: number } | null;
  caveats: string[];
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function rrOf(p: PlanRead): number | null {
  if (p.t1 == null) return null;
  const risk = Math.abs(p.entry - p.stop);
  const reward = Math.abs(p.t1 - p.entry);
  return risk > 0 && reward > 0 ? reward / risk : null;
}

export function t1AtrOf(p: PlanRead): number | null {
  if (p.t1 == null || p.atr == null || !(p.atr > 0)) return null;
  return Math.abs(p.t1 - p.entry) / p.atr;
}

/** A futures level, in the ETF it prices, through today's ratio (QQQ ← NQ, SPY ← ES). */
export function etfAt(fut: number, futNow: number, etfNow: number): number {
  return futNow > 0 ? fut * (etfNow / futNow) : etfNow;
}

/** The R distance a path ends at, as a futures price. */
function futAtR(p: PlanRead, r: number): number {
  const risk = Math.abs(p.entry - p.stop);
  return p.side === "long" ? p.entry + r * risk : p.entry - r * risk;
}

/**
 * Where an unresolved plan stands at the flat: where it is NOW plus the
 * measured drift of still-open plans from this bar to the flat — as progress
 * toward T1 (a fraction of entry→T1, so a 1R and a 4R target are not pooled
 * in R), else in R. At entry "now" is the CE and the drift is the whole
 * measured mark. Kept below T1 (an open plan has not touched it) and above
 * the failed-hold close or the current price, whichever is lower.
 */
function noneFut(p: PlanRead, w: WindowOdds, futNow: number): number {
  const risk = Math.abs(p.entry - p.stop);
  if (!(risk > 0)) return futNow;
  const dir = p.side === "long" ? 1 : -1;
  const nowR = (dir * (futNow - p.entry)) / risk;
  const toT1 = p.t1 != null ? Math.abs(p.t1 - p.entry) : null;
  const drift = toT1 != null && w.noneFrac != null && w.nowFrac != null ? ((w.noneFrac - w.nowFrac) * toT1) / risk : w.noneR - w.nowR;
  const hiR = toT1 != null ? toT1 / risk : Infinity;
  const clamped = Math.min(hiR * 0.98, Math.max(Math.min(-0.5, nowR), nowR + drift));
  return p.entry + dir * clamped * risk;
}

/** Bid per share at a spot and an instant — the paper book's sell price. */
function bidAt(spot: number, strike: number, exp: string, type: OptionType, iv: number, atMs: number): number {
  return quoteOption(spot, strike, exp, type, iv, atMs).bid;
}

/** The −20% premium backstop: a path cannot lose more than the room's hard stop. */
function backstopped(exitPx: number, entryPx: number): number {
  const floor = round2(entryPx * (1 + ROOM_MANDATE.hardStopPct / 100));
  return Math.max(exitPx, Math.min(floor, entryPx));
}

export interface PriceArgs {
  plan: PlanRead;
  /** The desk model's 8-hour P(T1 | filled) — or a location-updated one for a held plan. */
  pT1: number;
  type: OptionType;
  strike: number;
  exp: string;
  iv: number;
  /** Per share: the ask paid (or to be paid). */
  entryPx: number;
  futNow: number;
  etfNow: number;
  nowMs: number;
  /** When the fill happened (= nowMs at entry). */
  fillMs: number;
  /** The room's flat for this ticket. */
  flatMs: number;
  /** The measured time profile; defaults to src/data/room-time-odds.json (tests and probes pass their own). */
  curves?: TimeOddsFile;
}

/** Price an option on a plan's three paths. Pure. */
export function priceOptionPlan(a: PriceArgs): OptionEv {
  const caveats: string[] = [];
  const t1Atr = t1AtrOf(a.plan);
  const grid = barGrid(a.fillMs, a.nowMs, a.flatMs);
  const { fromBar, windowBars } = grid;
  // The option's own stop: where −20% of premium sits in the underlying. When it
  // is tighter than the plan's stop it binds first, and a tight stop is worth
  // less — re-price the odds with the desk model on that stop (its measured
  // stop-tight and R:R effects), not on the plan's.
  const ps = premiumStopOf(a);
  let pT1 = a.pT1;
  if (ps?.tighter) {
    pT1 = repricedOdds(a.plan, ps.fut, a.pT1);
    caveats.push(`the −20% premium stop sits at ${ps.fut.toFixed(2)} on the future — tighter than the plan's ${a.plan.stop.toFixed(2)}, so the odds are re-priced on it`);
  }
  const win = windowOdds(pT1, t1Atr, fromBar, windowBars, a.curves);
  if (!win.measured) caveats.push("time profile not measured — the 8-hour odds stand in for the window");
  if (t1Atr == null) caveats.push("no ATR on the plan — the pooled NY AM curve prices it");
  // An event on bar k is priced at that bar's midpoint, never before now or after the flat.
  const at = (bar: number) => Math.min(a.flatMs, Math.max(a.nowMs, grid.midOf(bar)));
  const etf = (fut: number) => etfAt(fut, a.futNow, a.etfNow);
  const pnl = (exitPx: number) => round2((exitPx - a.entryPx) * 100);

  const scenarios: Scenario[] = [];
  if (a.plan.t1 != null) {
    const atMs = at(win.t1Bar);
    const s = etf(a.plan.t1);
    const exitPx = bidAt(s, a.strike, a.exp, a.type, a.iv, atMs);
    scenarios.push({ kind: "t1", p: win.pT1, bar: win.t1Bar, atMs, fut: a.plan.t1, etf: s, exitPx, pnlUsd: pnl(exitPx) });
  }
  {
    const atMs = at(win.lossBar);
    const fut = futAtR(a.plan, win.lossR);
    const s = etf(fut);
    const exitPx = backstopped(bidAt(s, a.strike, a.exp, a.type, a.iv, atMs), a.entryPx);
    scenarios.push({ kind: "loss", p: win.pLoss, bar: win.lossBar, atMs, fut, etf: s, exitPx, pnlUsd: pnl(exitPx) });
  }
  {
    const atMs = a.flatMs;
    const fut = noneFut(a.plan, win, a.futNow);
    const s = etf(fut);
    const exitPx = backstopped(bidAt(s, a.strike, a.exp, a.type, a.iv, atMs), a.entryPx);
    scenarios.push({ kind: "none", p: win.pNone, bar: fromBar + windowBars, atMs, fut, etf: s, exitPx, pnlUsd: pnl(exitPx) });
  }
  const pSum = scenarios.reduce((s, x) => s + x.p, 0) || 1;
  const evUsd = round2(scenarios.reduce((s, x) => s + (x.p / pSum) * x.pnlUsd, 0));
  const t1 = scenarios.find((x) => x.kind === "t1") ?? null;
  // Same exits, re-weighted: the path VALUES do not depend on the odds, only their weights.
  const cal = calibratedP(pT1);
  let calibrated: OptionEv["calibrated"] = null;
  if (cal) {
    const wc = windowOdds(cal.p, t1Atr, fromBar, windowBars, a.curves);
    const v = (k: Scenario["kind"]) => scenarios.find((x) => x.kind === k)?.pnlUsd ?? 0;
    const tot = (t1 ? wc.pT1 : 0) + wc.pLoss + wc.pNone || 1;
    calibrated = {
      p: cal.p,
      pT1: t1 ? wc.pT1 : 0,
      pLoss: wc.pLoss,
      pNone: wc.pNone,
      evUsd: round2(((t1 ? wc.pT1 * v("t1") : 0) + wc.pLoss * v("loss") + wc.pNone * v("none")) / tot),
    };
  }

  const midNow = blackScholes(a.etfNow, a.strike, yearsToExpiry(a.nowMs, a.exp), a.iv, a.type).price;
  const midFlat = blackScholes(a.etfNow, a.strike, yearsToExpiry(a.flatMs, a.exp), a.iv, a.type).price;

  return {
    measured: win.measured,
    curveKey: win.curveKey,
    pT1Model: pT1,
    window: win,
    scenarios,
    evUsd,
    evPerDollar: a.entryPx > 0 ? evUsd / (a.entryPx * 100) : 0,
    t1Pays: Boolean(t1 && t1.pnlUsd > 0),
    t1PnlUsd: t1?.pnlUsd ?? 0,
    spreadUsd: round2(2 * HALF_SPREAD * 100),
    thetaToFlatUsd: round2(Math.max(0, midNow - midFlat) * 100),
    breakevenEtf: t1 ? breakevenSpot(a, t1.atMs) : null,
    premiumStop: ps ? { ...ps, pT1Plan: a.pT1 } : null,
    calibrated,
    caveats,
  };
}

/**
 * The underlying price at which this contract's bid hits the −20% backstop,
 * one bar from now (a bar of theta is already gone by the time a stop runs).
 * Bisection between the entry print and the plan's stop; past the plan's stop
 * it never binds first.
 */
function premiumStopOf(a: PriceArgs): { fut: number; etf: number; atr: number | null; tighter: boolean } | null {
  const floor = round2(a.entryPx * (1 + ROOM_MANDATE.hardStopPct / 100));
  const atMs = Math.min(a.flatMs, a.nowMs + BAR_MS);
  const etfStop = etfAt(a.plan.stop, a.futNow, a.etfNow);
  const bid = (s: number) => bidAt(s, a.strike, a.exp, a.type, a.iv, atMs);
  if (!(a.futNow > 0) || !(a.etfNow > 0)) return null;
  if (bid(etfStop) >= floor) {
    return { fut: a.plan.stop, etf: round2(etfStop), atr: a.plan.atr ? Math.abs(a.plan.entry - a.plan.stop) / a.plan.atr : null, tighter: false };
  }
  let lo = etfStop; // bid below the floor here
  let hi = a.etfNow; // at or above it here (or the contract is already a clock)
  if (bid(hi) < floor) {
    // Theta alone takes it through −20% within a bar: the stop is the entry itself.
    const fut = a.plan.entry;
    return { fut, etf: round2(a.etfNow), atr: 0, tighter: true };
  }
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (bid(mid) < floor) lo = mid;
    else hi = mid;
  }
  const etf = (lo + hi) / 2;
  const fut = etf * (a.futNow / a.etfNow);
  const tighter = a.plan.side === "long" ? fut > a.plan.stop : fut < a.plan.stop;
  return { fut: round2(fut), etf: round2(etf), atr: a.plan.atr ? Math.abs(a.plan.entry - fut) / a.plan.atr : null, tighter };
}

/** The desk model's odds for the same plan on a tighter stop; the random-walk ratio when the model can't see it. */
function repricedOdds(plan: PlanRead, stop: number, pPlan: number): number {
  if (plan.t1 == null) return pPlan;
  const model = plan.symbol && plan.atr ? planHitOdds({ side: plan.side, symbol: plan.symbol, entry: plan.entry, stop, t1: plan.t1, atr: plan.atr, price: plan.entry }) : null;
  if (model) return Math.min(pPlan, model.pT1);
  const rr = (s: number) => Math.abs(plan.t1! - plan.entry) / Math.max(1e-9, Math.abs(plan.entry - s));
  return Math.min(pPlan, pPlan * ((1 / (1 + rr(stop))) / (1 / (1 + rr(plan.stop)))));
}

/** Bisection on spot: where the bid at `atMs` equals the ask paid. */
function breakevenSpot(a: PriceArgs, atMs: number): number | null {
  const up = a.type === "CALL";
  let lo = a.etfNow * (up ? 1 : 0.9);
  let hi = a.etfNow * (up ? 1.1 : 1);
  const f = (s: number) => bidAt(s, a.strike, a.exp, a.type, a.iv, atMs) - a.entryPx;
  // Calls gain with spot, puts lose with it: orient the bracket so f(lo) < 0 < f(hi).
  if (!up) [lo, hi] = [hi, lo];
  if (f(lo) > 0) return round2(a.etfNow);
  if (f(hi) < 0) return null;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (f(mid) < 0) lo = mid;
    else hi = mid;
  }
  return round2((lo + hi) / 2);
}

/* ── Choosing the contract ──────────────────────────────────────────────── */

export interface ContractChoice {
  offset: StrikeOffset;
  strike: number;
  ask: number;
  delta: number;
  ev: OptionEv | null;
}

/**
 * Of the strikes the desk's delta band allows, the one with the most EV per
 * dollar of debit — the cap is in dollars, so that is the one that turns the
 * same budget into the most expected P&L. Nothing positive → the best of the
 * negatives comes back, and the EV gate refuses it.
 */
export function chooseContract(cands: ContractChoice[]): ContractChoice | null {
  const priced = cands.filter((c) => c.ev != null);
  if (!priced.length) return null;
  return [...priced].sort((x, y) => y.ev!.evPerDollar - x.ev!.evPerDollar || (x.offset === "ATM" ? -1 : 1))[0]!;
}

/* ── Holding: is the rest of the path still worth the theta? ────────────── */

/**
 * The plan's odds NOW, from where price stands between the stop and T1.
 * Gambler's ruin gives the geometry (a driftless walk from here reaches T1
 * before the stop with probability (here − stop)/(T1 − stop)); the desk
 * model's odds ratio over that same geometry at entry carries the setup's
 * measured quality forward. At the entry price this returns the entry pT1.
 */
export function pT1Now(plan: PlanRead, pT1Entry: number, futNow: number): number {
  const rr = rrOf(plan);
  if (rr == null || plan.t1 == null) return pT1Entry;
  const clamp = (x: number) => Math.min(0.98, Math.max(0.02, x));
  const rwEntry = clamp(1 / (1 + rr));
  const span = plan.t1 - plan.stop;
  const rwNow = clamp(span !== 0 ? (futNow - plan.stop) / span : rwEntry);
  const pe = clamp(pT1Entry);
  const oddsRatio = pe / (1 - pe) / (rwEntry / (1 - rwEntry));
  const odds = oddsRatio * (rwNow / (1 - rwNow));
  return odds / (1 + odds);
}

export interface HoldRead {
  /** Probability-weighted exit price per share if the room keeps holding. */
  holdPx: number;
  bidNow: number;
  /** Per contract: holding minus selling now. Negative = the theta stop's case. */
  edgeUsd: number;
  pT1Now: number;
  ev: OptionEv;
}

export function holdValue(a: Omit<PriceArgs, "pT1"> & { pT1Entry: number }): HoldRead {
  const p = pT1Now(a.plan, a.pT1Entry, a.futNow);
  const ev = priceOptionPlan({ ...a, pT1: p });
  const bidNow = quoteOption(a.etfNow, a.strike, a.exp, a.type, a.iv, a.nowMs).bid;
  const pSum = ev.scenarios.reduce((s, x) => s + x.p, 0) || 1;
  const holdPx = ev.scenarios.reduce((s, x) => s + (x.p / pSum) * x.exitPx, 0);
  return { holdPx: round2(holdPx), bidNow, edgeUsd: round2((holdPx - bidNow) * 100), pT1Now: p, ev };
}

/**
 * holdValue for one open position, from the desk's held levels: the plan,
 * P(T1) at the fill and the fill time ride along with the position. Day
 * tickets price to the 11:00 flat; a 1 DTE runner allowed past it, to 15:30.
 * Null when the plan cannot be priced (no plan, no odds, no futures print).
 */
export function holdReadFor(
  p: RoomPositionIn,
  h: HeldLevels | undefined,
  tape: UnderlierTape,
  etDate: string,
  nowMs: number,
): HoldRead | null {
  if (!h || h.entry == null || h.pT1 == null || h.openedAt == null || !(h.price > 0) || !(tape.price > 0)) return null;
  const flatMs = Math.max(etWallToEpochMs(etDate, clockEt(ROOM_CLOCK.flattenAllMin)), nowMs);
  const iv = ivFor(p.ticker, tape.vix);
  const entryPx = p.entry_px ?? quoteOption(tape.price, p.strike, p.exp, p.type, iv, nowMs).bid / Math.max(1e-6, 1 + p.pnl_percent / 100);
  return holdValue({
    plan: { side: h.side, entry: h.entry, stop: h.stop, t1: h.t1, atr: h.atr ?? null, symbol: h.symbol },
    pT1Entry: h.pT1,
    type: p.type,
    strike: p.strike,
    exp: p.exp,
    iv,
    entryPx,
    futNow: h.price,
    etfNow: tape.price,
    nowMs,
    fillMs: h.openedAt,
    flatMs,
  });
}

/* ── After the exit: where the money came from ──────────────────────────── */

export interface Attribution {
  /** Dollars, all contracts. Sums to the trade's P&L within rounding. */
  price: number;
  vol: number;
  time: number;
  spread: number;
  total: number;
}

/**
 * The P&L of a closed option, split in a fixed order: the spot move (delta
 * and gamma, at the entry clock and IV), the IV change, the clock, and the
 * two crossings. Sequential decomposition — the order is stated because it
 * changes the split, never the total.
 */
export function attribute(args: {
  type: OptionType;
  strike: number;
  exp: string;
  contracts: number;
  spot0: number;
  iv0: number;
  t0Ms: number;
  spot1: number;
  iv1: number;
  t1Ms: number;
  entryPx: number;
  exitPx: number;
}): Attribution {
  const bs = (s: number, iv: number, ms: number) => blackScholes(s, args.strike, yearsToExpiry(ms, args.exp), iv, args.type).price;
  const m00 = bs(args.spot0, args.iv0, args.t0Ms);
  const m10 = bs(args.spot1, args.iv0, args.t0Ms);
  const m11 = bs(args.spot1, args.iv1, args.t0Ms);
  const m111 = bs(args.spot1, args.iv1, args.t1Ms);
  const k = 100 * args.contracts;
  const total = round2((args.exitPx - args.entryPx) * k);
  const price = round2((m10 - m00) * k);
  const vol = round2((m11 - m10) * k);
  const time = round2((m111 - m11) * k);
  // Whatever the model mids do not explain is the crossing (and the penny grid).
  const spread = round2(total - price - vol - time);
  return { price, vol, time, spread, total };
}

/**
 * The model's P(T1) mapped through its own out-of-sample calibration
 * (hit-odds-model.json, 2025–26 deciles): adjacent deciles pooled until the
 * realized rate never falls as the prediction rises (pool-adjacent-violators),
 * then interpolated. Not a new model and not fitted here — the desk's own
 * held-out table, read monotonically. Null without the table.
 */
export function calibratedP(p: number): { p: number; n: number } | null {
  const v = HIT_ODDS_MODEL.validation as unknown as { calibration?: { deciles?: { n: number; meanP: number; hitRate: number }[] } };
  const ds = [...(v.calibration?.deciles ?? [])].filter((d) => d.n > 0).sort((a, b) => a.meanP - b.meanP);
  if (ds.length < 2 || !Number.isFinite(p)) return null;
  const blocks: { sp: number; sh: number; n: number }[] = [];
  for (const d of ds) {
    blocks.push({ sp: d.meanP * d.n, sh: d.hitRate * d.n, n: d.n });
    while (blocks.length >= 2) {
      const b = blocks[blocks.length - 1]!;
      const a = blocks[blocks.length - 2]!;
      if (a.sh / a.n <= b.sh / b.n) break;
      blocks.splice(blocks.length - 2, 2, { sp: a.sp + b.sp, sh: a.sh + b.sh, n: a.n + b.n });
    }
  }
  const pts = blocks.map((b) => ({ x: b.sp / b.n, y: b.sh / b.n, n: b.n }));
  const first = pts[0]!;
  const last = pts[pts.length - 1]!;
  const q = Math.min(0.99, Math.max(0.01, p));
  if (q <= first.x) return { p: Math.max(0.005, q * (first.y / Math.max(1e-9, first.x))), n: first.n };
  if (q >= last.x) return { p: Math.min(0.995, last.y + ((q - last.x) * (1 - last.y)) / Math.max(1e-9, 1 - last.x)), n: last.n };
  for (let i = 1; i < pts.length; i++) {
    const lo = pts[i - 1]!;
    const hi = pts[i]!;
    if (q <= hi.x) {
      const t = (q - lo.x) / Math.max(1e-9, hi.x - lo.x);
      return { p: lo.y + t * (hi.y - lo.y), n: lo.n + hi.n };
    }
  }
  return { p: last.y, n: last.n };
}

/** The OOS realized T1 rate of the model decile a probability falls in — Sterling's number. */
export function realizedForDecile(p: number): { meanP: number; hitRate: number; n: number } | null {
  const v = HIT_ODDS_MODEL.validation as unknown as { calibration?: { deciles?: { n: number; meanP: number; hitRate: number }[] } };
  const ds = v.calibration?.deciles ?? [];
  if (!ds.length) return null;
  let best = ds[0]!;
  for (const d of ds) if (Math.abs(d.meanP - p) < Math.abs(best.meanP - p)) best = d;
  return best;
}
