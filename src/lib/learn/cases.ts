/**
 * Real-tape walkthroughs: the desk's own engine, run causally over real bars.
 *
 * WHY THIS REPLACES THE DRAWN FIGURES
 * A seeded generator produces textbook shapes, and textbook shapes are what
 * real tape never gives you: the raid that overshoots by 40 points, the array
 * that gets filled on the wrong side, the entry that never comes. A lesson
 * built on perfect prints teaches recognition of perfection, which is not a
 * skill the market ever tests. So the cases here are found — not drawn — by
 * running the exact assembly the live desk runs (analyzeStructure → SMC tape
 * → scanner → narrative → gradeSmcMaster) over captured history, one bar at a
 * time, with only the bars that had CLOSED at that moment. Where the desk
 * printed TAKE, the numeric plan it printed is simulated forward on the bars
 * that followed. Where it lost, the loss is kept and classified. Nothing is
 * curated toward winners.
 *
 * NO LOOKAHEAD, MECHANICALLY
 * At step i the engine sees `bars.slice(0, i + 1)` and nothing else. The
 * simulator then reads bars i+1 onward. The two never touch the same bar, and
 * `assertCausal` in the builder script re-checks that every case's decision
 * bar precedes every bar it was scored on.
 *
 * INTRABAR TIES GO AGAINST THE TRADE
 * When one 15m bar spans both the stop and a target, the stop is taken. A bar
 * cannot say which printed first, and resolving that in the trade's favour is
 * how a backtest quietly gains ten win-rate points it never earned.
 */

import type { OhlcBar } from "@/lib/market/types";
import { APLUS_RULES } from "@/lib/aplus/config";
import { getSessionClock, isJudasWindow, type SessionClock } from "@/lib/trading/sessions";
import { analyzeStructure, smtDivergenceStack } from "@/lib/trading/structure";
import { buildSmcTape } from "@/lib/trading/smc-board";
import { scanSetups } from "@/lib/trading/scanner";
import { summarizeDetectors } from "@/lib/trading/detectors";
import { buildMarketNarrative } from "@/lib/trading/market-narrative";
import { drawOnLiquidity } from "@/lib/trading/draw";
import { newsRead } from "@/lib/trading/news";
import { gradeSmcMaster, type SmcLayer } from "@/lib/trading/smc-master";
import type { TradePlan } from "@/lib/trading/trade-plan";

export type CaseSymbol = "MNQ" | "ES";
export type CaseOutcome = "win" | "loss" | "scratch" | "unfilled" | "stand";

/**
 * How the trade was entered, in the desk's own vocabulary.
 *
 * "take"  — the desk printed TAKE: every must-layer passed on the closed bar,
 *           including price already inside the array.
 * "armed" — every must-layer passed EXCEPT the retrace, the desk named the
 *           array and printed WAIT ("limit at CE … do not chase"), and a
 *           limit was rested at consequent encroachment as instructed. This
 *           is what a trader following the desk does, and it is how the live
 *           desk — polling every 20s against the live print — actually sees
 *           most entries: intrabar, not on a 15m close.
 */
export type EntryMode = "take" | "armed";
export type LossKind = "level-broke" | "early-entry" | "chop";

export interface CaseStep {
  title: string;
  body: string;
  /** "pass" | "fail" | "wait" | "info" — drives the step's colour. */
  tone: "pass" | "fail" | "wait" | "info";
}

export interface LearnCase {
  id: string;
  symbol: CaseSymbol;
  side: "long" | "short" | null;
  /** Decision bar time (ms) — the last CLOSED bar the desk saw. */
  decisionT: number;
  decisionEt: string;
  word: "TAKE" | "WAIT" | "STAND";
  /** Null for a STAND/near-miss case. */
  entryMode: EntryMode | null;
  confluence: number;
  grade: string;
  outcome: CaseOutcome;
  /** Realised R across the scale-out legs. Null when no trade was taken. */
  r: number | null;
  barsHeld: number;
  exitReason: string;
  lossKind: LossKind | null;
  /** Chart bars: context before the decision, then what followed. */
  bars: OhlcBar[];
  /** Index in `bars` of the decision bar. Everything after it is the future. */
  decisionIndex: number;
  plan: TradePlan | null;
  layers: SmcLayer[];
  missing: string;
  missingDetail: string;
  steps: CaseStep[];
  lesson: string;
  /**
   * For a WAIT/STAND case: what a market order at the decision bar's close
   * would have done, with the stop the model would have used (beyond the
   * raid wick) and T1 at the draw. Simulated on the same bars, ties against
   * the trade. This is the cost of not waiting, measured rather than asserted.
   */
  chase: {
    plan: TradePlan;
    outcome: CaseOutcome;
    r: number | null;
    barsHeld: number;
    exitReason: string;
    lossKind: LossKind | null;
  } | null;
}

/* ── Configuration ──────────────────────────────────────────────────────── */

/** Bars of context the engine needs before it can read structure at all. */
const WARMUP = 160;
/**
 * The live desk never sees more than this many bars (yahoo.ts MAX_BARS), so
 * the replay must not either — a 2,000-bar slice finds swings and pools the
 * live desk would never have known about, and grades a desk that does not
 * exist. Matching the horizon is both faster and more faithful.
 */
const HORIZON = 800;
/** Chart context before the decision bar, and future shown after it. */
const CONTEXT_BEFORE = 56;
const CONTEXT_AFTER = 36;
/** A limit that is not filled inside this many bars is not a trade. */
const FILL_WINDOW = 12; // 3h on 15m
/** Open trades are closed at the last close after this many bars. */
const MAX_HOLD = 32; // 8h
/** Same symbol+side re-arms only after this many bars. */
const COOLDOWN = 16; // 4h
/** How far past the stop to look when classifying a loss. */
const LOSS_LOOKAHEAD = 24;

/* ── Helpers ────────────────────────────────────────────────────────────── */

const ET_DAY = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  weekday: "short",
  month: "short",
  day: "numeric",
});
const ET_TIME = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

export function etStamp(t: number): string {
  return `${ET_DAY.format(new Date(t))} · ${ET_TIME.format(new Date(t))} ET`;
}
function etTime(t: number): string {
  return `${ET_TIME.format(new Date(t))} ET`;
}
function etDayKey(t: number): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date(t));
}

function dayChangePct(slice: OhlcBar[]): number {
  const last = slice[slice.length - 1]!;
  const key = etDayKey(last.t);
  for (const b of slice) {
    if (etDayKey(b.t) === key) return b.o > 0 ? ((last.c - b.o) / b.o) * 100 : 0;
  }
  return 0;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const px = (n: number) => n.toFixed(2);

/* ── The desk, assembled at one historical moment ───────────────────────── */

interface Snapshot {
  clock: SessionClock;
  book: ReturnType<typeof gradeSmcMaster>["left"];
  /** Raw numbers the chase counterfactual needs. */
  raid: { wickExtreme: number; side: "buyside" | "sellside" } | null;
  dol: { price: number; name: string; reachProbability: number; side: string } | null;
  range: { high: number; low: number; eq: number } | null;
  lastClose: number;
  confluence: number;
  grade: string;
  side: "long" | "short" | null;
  biasLine: string;
  drawLine: string | null;
  raidLine: string | null;
  shiftLine: string | null;
  arrayLine: string | null;
}

/**
 * Run the live desk's exact assembly on a causal slice.
 *
 * Mirrors build-desk.ts step for step. If the live assembly changes, this
 * must change with it — a walkthrough that grades differently from the desk
 * teaches a desk that does not exist.
 */
function snapshot(symbol: CaseSymbol, peer: CaseSymbol, slice: OhlcBar[], peerSlice: OhlcBar[]): Snapshot {
  const now = slice[slice.length - 1]!;
  const clock = getSessionClock(new Date(now.t));

  const biasL = analyzeStructure(symbol, slice, dayChangePct(slice));
  const biasR = analyzeStructure(peer, peerSlice, dayChangePct(peerSlice));
  const smtStack = smtDivergenceStack(slice, peerSlice);
  const smc = { left: buildSmcTape(slice), right: buildSmcTape(peerSlice) };
  const drawL = drawOnLiquidity(biasL, slice);
  const drawR = drawOnLiquidity(biasR, peerSlice);
  const scan = scanSetups(biasL, biasR, clock, smtStack.primary, slice, peerSlice, smc);
  const detL = summarizeDetectors(slice);
  const detR = summarizeDetectors(peerSlice);
  const dirL: "bull" | "bear" = biasL.topDown === "bear" ? "bear" : "bull";
  const dirR: "bull" | "bear" = biasR.topDown === "bear" ? "bear" : "bull";
  const narrL = buildMarketNarrative(biasL, detL, clock, dirL, slice);
  const narrR = buildMarketNarrative(biasR, detR, clock, dirR, peerSlice);
  const news = newsRead(new Date(now.t));

  const master = gradeSmcMaster({
    clock,
    bias: { left: biasL, right: biasR },
    scan,
    draws: { left: drawL, right: drawR },
    narrative: { left: narrL, right: narrR },
    news,
    smtStack,
    smc,
    quotes: { left: { price: now.c }, right: { price: peerSlice[peerSlice.length - 1]!.c } },
    shockFloorMs: null,
  });

  const book = master.left;
  const cand = scan.candidates.find((c) => c.symbol === symbol) ?? null;

  const zone = biasL.dealing?.zone ?? "unknown";
  const biasLine = `HTF ${biasL.topDown.toUpperCase()} · mid ${biasL.mid} · LTF ${biasL.ltf} · price in ${zone} · confidence ${(biasL.confidence * 100).toFixed(0)}%`;

  const dol = drawL.primary;
  const drawLine = dol
    ? `${dol.name} at ${px(dol.price)} · ${dol.distancePoints.toFixed(1)}pt ${dol.side} · reached in ${(dol.reachProbability * 100).toFixed(0)}% of past sessions`
    : null;

  const raid = detL.sweep.latest;
  const raidLine = raid
    ? `${raid.side} raid at ${etTime(raid.t)} — swept ${px(raid.sweptLevel)}, wick to ${px(raid.wickExtreme)}, closed back inside by ${px(raid.closeBackInside)}`
    : null;

  const disp = detL.displacement.latest;
  // Timing relative to the raid is the whole question for this layer, so it
  // is stated in three cases rather than two. A rejection that swept and
  // displaced in ONE candle is common on 15m and is neither "after" nor
  // "before": the desk's rule needs the displacement on a LATER bar, so it
  // reads as not-yet-confirmed — and the text has to say that, not call it
  // the wrong leg.
  const timing = !disp || !raid
    ? ""
    : disp.index > raid.index
      ? " — after the raid ✓"
      : disp.index === raid.index
        ? " — on the SAME bar as the raid. The desk requires displacement on a later bar to confirm the shift, so this counts as the raid, not yet as the shift"
        : " — BEFORE the raid: this is the leg into the sweep, not the reaction to it";
  const shiftLine = disp
    ? `${disp.direction} displacement at ${etTime(disp.t)} — body ${px(disp.bodySize)}pt, ${disp.ratio.toFixed(1)}× ATR${timing}`
    : null;

  const plan = book.plan;
  const arrayLine = plan?.entryZone
    ? `${plan.entryZone.bottom.toFixed(2)}–${plan.entryZone.top.toFixed(2)} · CE ${plan.entry.toFixed(2)} · price ${px(now.c)} is ${now.c > plan.entryZone.top ? `${px(now.c - plan.entryZone.top)}pt above` : now.c < plan.entryZone.bottom ? `${px(plan.entryZone.bottom - now.c)}pt below` : "INSIDE"}`
    : null;

  return {
    clock,
    book,
    raid: raid ? { wickExtreme: raid.wickExtreme, side: raid.side } : null,
    dol: dol ? { price: dol.price, name: dol.name, reachProbability: dol.reachProbability, side: dol.side } : null,
    range: biasL.dealing ? { high: biasL.dealing.high, low: biasL.dealing.low, eq: biasL.dealing.eq } : null,
    lastClose: now.c,
    confluence: cand?.confluence ?? 0,
    grade: cand ? String(cand.pathBand ?? cand.grade) : "—",
    side: book.side,
    biasLine,
    drawLine,
    raidLine,
    shiftLine,
    arrayLine,
  };
}

/* ── Simulation from the numeric plan ───────────────────────────────────── */

interface SimResult {
  outcome: Exclude<CaseOutcome, "stand">;
  r: number | null;
  barsHeld: number;
  exitReason: string;
  fillIndex: number | null;
  exitIndex: number | null;
  events: string[];
}

/**
 * Walk the future bars against the plan.
 *
 * Entry is a limit at consequent encroachment, filled on the first bar whose
 * range reaches it. Scale-out follows APLUS_RULES exactly: at T1 bank the
 * configured fraction and move the stop to break-even; the runner goes for T2
 * or comes back to BE. A bar that spans both stop and target is a stop.
 */
function simulate(plan: TradePlan, future: OhlcBar[]): SimResult {
  const long = plan.side === "long";
  const entry = plan.entry;
  const stop = plan.stop;
  const risk = plan.riskPts;
  const t1 = plan.t1;
  const t2 = plan.t2;
  const frac = APLUS_RULES.scaleOut.tp1Fraction;
  const events: string[] = [];

  const touches = (b: OhlcBar, level: number, dir: "above" | "below") =>
    dir === "above" ? b.h >= level : b.l <= level;
  const rOf = (exit: number) => (long ? exit - entry : entry - exit) / risk;

  // Fill.
  let fillIndex: number | null = null;
  for (let i = 0; i < Math.min(FILL_WINDOW, future.length); i++) {
    const b = future[i]!;
    // A short's limit sits above price: filled when the bar's high reaches it.
    if (touches(b, entry, long ? "below" : "above")) {
      // If the same bar also runs through the stop, the fill is immediately
      // a loss — that is what an intrabar tie against the trade means.
      fillIndex = i;
      events.push(`Filled at ${px(entry)} on the ${etTime(b.t)} bar`);
      break;
    }
  }
  if (fillIndex == null) {
    return {
      outcome: "unfilled",
      r: null,
      barsHeld: 0,
      exitReason: `Limit at ${px(entry)} never filled inside ${FILL_WINDOW} bars — price did not come back`,
      fillIndex: null,
      exitIndex: null,
      events,
    };
  }

  let stopLevel = stop;
  let remaining = 1;
  let banked = 0; // R × fraction, accumulated
  let t1Hit = false;

  for (let i = fillIndex; i < future.length && i < fillIndex + MAX_HOLD; i++) {
    const b = future[i]!;
    const stopHit = touches(b, stopLevel, long ? "below" : "above");
    const t1Hit_ = !t1Hit && t1 != null && touches(b, t1, long ? "above" : "below");
    const t2Hit = t1Hit && t2 != null && touches(b, t2, long ? "above" : "below");

    // Ties resolve against the trade.
    if (stopHit) {
      const exitR = rOf(stopLevel);
      banked += exitR * remaining;
      const reason = t1Hit
        ? `Runner stopped at break-even on the ${etTime(b.t)} bar`
        : `Stopped at ${px(stopLevel)} on the ${etTime(b.t)} bar (−1R)`;
      events.push(reason);
      return {
        outcome: banked > 0.05 ? "win" : banked < -0.05 ? "loss" : "scratch",
        r: r2(banked),
        barsHeld: i - fillIndex + 1,
        exitReason: reason,
        fillIndex,
        exitIndex: i,
        events,
      };
    }
    if (t1Hit_) {
      t1Hit = true;
      const r1 = rOf(t1!);
      banked += r1 * frac;
      remaining -= frac;
      if (APLUS_RULES.scaleOut.moveStopToBeAfterTp1) stopLevel = entry;
      events.push(
        `T1 ${px(t1!)} hit on the ${etTime(b.t)} bar: +${r1.toFixed(2)}R banked on ${(frac * 100).toFixed(0)}%, stop moved to break-even`,
      );
      if (t2 == null) {
        // No runner target: close the rest here.
        banked += r1 * remaining;
        events.push("No T2 priced — remainder closed at T1");
        return { outcome: banked > 0.05 ? "win" : banked < -0.05 ? "loss" : "scratch", r: r2(banked), barsHeld: i - fillIndex + 1, exitReason: "T1, full close", fillIndex, exitIndex: i, events };
      }
      // Same bar may also reach T2 — checked below on the next iteration's
      // logic; a same-bar T2 is treated conservatively as not yet reached.
      continue;
    }
    if (t2Hit) {
      const r2v = rOf(t2!);
      banked += r2v * remaining;
      events.push(`T2 ${px(t2!)} hit on the ${etTime(b.t)} bar: +${r2v.toFixed(2)}R on the runner`);
      return { outcome: banked > 0.05 ? "win" : banked < -0.05 ? "loss" : "scratch", r: r2(banked), barsHeld: i - fillIndex + 1, exitReason: "T2 hit", fillIndex, exitIndex: i, events };
    }
  }

  // Time stop.
  const lastIdx = Math.min(future.length, fillIndex + MAX_HOLD) - 1;
  const last = future[lastIdx]!;
  const exitR = rOf(last.c);
  banked += exitR * remaining;
  const reason = `Time stop after ${MAX_HOLD} bars — closed at ${px(last.c)} (${exitR >= 0 ? "+" : ""}${exitR.toFixed(2)}R on the open portion)`;
  events.push(reason);
  return {
    outcome: banked > 0.05 ? "win" : banked < -0.05 ? "loss" : "scratch",
    r: r2(banked),
    barsHeld: lastIdx - fillIndex + 1,
    exitReason: reason,
    fillIndex,
    exitIndex: lastIdx,
    events,
  };
}

/**
 * Why did it lose?
 *
 * Two different failures wear the same −1R: the level genuinely broke (price
 * accepted beyond the stop and kept going — the raid was a breakout after
 * all), or the read was right and the timing was wrong (price hit the stop,
 * then went to the target anyway). They have opposite lessons, so the
 * classification is made from what price did AFTER the stop, not from the
 * loss itself.
 */
function classifyLoss(plan: TradePlan, future: OhlcBar[], exitIndex: number): LossKind {
  const long = plan.side === "long";
  const after = future.slice(exitIndex + 1, exitIndex + 1 + LOSS_LOOKAHEAD);
  const beyond = plan.riskPts; // one more R past the stop = acceptance
  let brokeThrough = false;
  let reachedTarget = false;
  for (const b of after) {
    if (long ? b.l <= plan.stop - beyond : b.h >= plan.stop + beyond) brokeThrough = true;
    if (plan.t1 != null && (long ? b.h >= plan.t1 : b.l <= plan.t1)) reachedTarget = true;
  }
  if (brokeThrough && !reachedTarget) return "level-broke";
  if (reachedTarget) return "early-entry";
  return "chop";
}

/**
 * The plan a trader who did not wait would have used: in at the close, stop
 * one tick beyond the raid wick, T1 at the draw. Built directly rather than
 * through buildTradePlan because there is deliberately no array — that is
 * the point of the counterfactual.
 */
function chasePlan(s: Snapshot): TradePlan | null {
  const side = s.book.side;
  if (!side || !s.raid) return null;
  const long = side === "long";
  // A chase only makes sense against a raid of the CORRECT polarity.
  if ((long && s.raid.side !== "sellside") || (!long && s.raid.side !== "buyside")) return null;
  const entry = s.lastClose;
  const stop = long ? s.raid.wickExtreme - 0.25 : s.raid.wickExtreme + 0.25;
  const riskPts = r2(Math.abs(entry - stop));
  if (!(riskPts > 0)) return null;
  const t1 = s.dol && (long ? s.dol.price > entry : s.dol.price < entry) ? r2(s.dol.price) : null;
  const rangeT = s.range ? (long ? s.range.high : s.range.low) : null;
  const t2 =
    rangeT != null && (long ? rangeT > (t1 ?? entry) : rangeT < (t1 ?? entry)) ? r2(rangeT) : null;
  const rr = (t: number | null) => (t == null ? null : r2(Math.abs(t - entry) / riskPts));
  return {
    symbol: s.book.symbol,
    side,
    price: r2(entry),
    entry: r2(entry),
    entryZone: null,
    stop: r2(stop),
    riskPts,
    riskOverCap: false,
    t1,
    t2,
    rr1: rr(t1),
    rr2: rr(t2),
    sweep: { price: r2(s.raid.wickExtreme), t: null },
    range: s.range,
    draw: s.dol ? { price: r2(s.dol.price), name: s.dol.name, reachProbability: s.dol.reachProbability } : null,
    arrays: [],
    levels: [],
  };
}

/**
 * Market-order variant of the simulator: filled at the plan's entry before
 * bar 0 by definition, then the same walk with the same tie rule.
 */
function simulateMarket(plan: TradePlan, future: OhlcBar[]): SimResult {
  const long = plan.side === "long";
  const rOf = (exit: number) => (long ? exit - plan.entry : plan.entry - exit) / plan.riskPts;
  const frac = APLUS_RULES.scaleOut.tp1Fraction;
  let stopLevel = plan.stop;
  let remaining = 1;
  let banked = 0;
  let t1Hit = false;
  const events: string[] = [`Market ${plan.side} filled at ${px(plan.entry)}`];
  // The outcome WORD is decided by realised R alone. An earlier version forced
  // "win" whenever T1 was reached, which labelled a +0.05R full close a win —
  // a target five hundredths of an R away is not a win by any definition
  // this desk uses, and the R:R floor would have refused it anyway.
  const done = (i: number, reason: string): SimResult => ({
    outcome: banked > 0.05 ? "win" : banked < -0.05 ? "loss" : "scratch",
    r: r2(banked),
    barsHeld: i + 1,
    exitReason: reason,
    fillIndex: 0,
    exitIndex: i,
    events,
  });
  for (let i = 0; i < future.length && i < MAX_HOLD; i++) {
    const b = future[i]!;
    const stopHit = long ? b.l <= stopLevel : b.h >= stopLevel;
    const t1Now = !t1Hit && plan.t1 != null && (long ? b.h >= plan.t1 : b.l <= plan.t1);
    const t2Now = t1Hit && plan.t2 != null && (long ? b.h >= plan.t2 : b.l <= plan.t2);
    if (stopHit) {
      banked += rOf(stopLevel) * remaining;
      const reason = t1Hit
        ? `Runner stopped at break-even on the ${etTime(b.t)} bar`
        : `Stopped at ${px(stopLevel)} on the ${etTime(b.t)} bar (−1R)`;
      events.push(reason);
      return done(i, reason);
    }
    if (t1Now) {
      t1Hit = true;
      const r1 = rOf(plan.t1!);
      banked += r1 * frac;
      remaining -= frac;
      if (APLUS_RULES.scaleOut.moveStopToBeAfterTp1) stopLevel = plan.entry;
      events.push(
        `T1 ${px(plan.t1!)} hit on the ${etTime(b.t)} bar: +${r1.toFixed(2)}R banked on ${(frac * 100).toFixed(0)}%, stop to break-even`,
      );
      if (plan.t2 == null) {
        banked += r1 * remaining;
        return done(i, "T1, full close");
      }
      continue;
    }
    if (t2Now) {
      banked += rOf(plan.t2!) * remaining;
      events.push(`T2 ${px(plan.t2!)} hit on the ${etTime(b.t)} bar`);
      return done(i, "T2 hit");
    }
  }
  const lastIdx = Math.min(future.length, MAX_HOLD) - 1;
  const last = future[lastIdx]!;
  banked += rOf(last.c) * remaining;
  const reason = `Time stop after ${MAX_HOLD} bars — closed at ${px(last.c)}`;
  events.push(reason);
  return done(lastIdx, reason);
}

/* ── Steps: precise, from the data ──────────────────────────────────────── */

function buildSteps(
  s: Snapshot,
  sim: SimResult | null,
  lossKind: LossKind | null,
  chase: LearnCase["chase"],
): { steps: CaseStep[]; lesson: string } {
  const steps: CaseStep[] = [];
  const b = s.book;
  const layer = (id: string) =>
    b.layers.find(
      (l) =>
        l.id === id ||
        l.id === ({ dealing: "pd_half", shift: "ltf", draw: "dol" } as Record<string, string>)[id] ||
        l.label.toLowerCase().includes(id),
    );
  const toneOf = (l?: SmcLayer): CaseStep["tone"] =>
    !l ? "info" : l.state === "pass" ? "pass" : l.state === "fail" ? "fail" : "wait";

  steps.push({
    title: "1 · Bias and location",
    body: `${s.biasLine}. ${s.side ? `The book is looking ${s.side}` : "No side yet"}${b.side === "short" ? " — permitted only from premium." : b.side === "long" ? " — permitted only from discount." : "."}`,
    tone: toneOf(layer("dealing")) === "info" ? "info" : toneOf(layer("dealing")),
  });
  steps.push({
    title: "2 · Draw on liquidity",
    body: s.drawLine ?? "No viable draw in the trade's direction — nothing to price a target against.",
    tone: s.drawLine ? toneOf(layer("draw")) : "fail",
  });
  steps.push({
    title: "3 · The raid",
    body: s.raidLine ?? "No recent raid on the tape. Without a sweep there is no sequence — only a direction.",
    tone: s.raidLine ? toneOf(layer("sweep")) : "fail",
  });
  steps.push({
    title: "4 · Displacement / shift",
    body: s.shiftLine ?? "No displacement since the raid. Structure has not shifted; drifting through a level is not a shift.",
    tone: s.shiftLine ? toneOf(layer("shift")) : "wait",
  });
  steps.push({
    title: "5 · The array and the entry",
    body: s.arrayLine
      ? `Fresh same-side array ${s.arrayLine}.`
      : b.missing.toLowerCase().includes("retrace") || b.missing.toLowerCase().includes("array")
        ? `No fresh array to enter from — ${b.missingDetail}`
        : "No entry array priced.",
    tone: s.arrayLine ? toneOf(layer("retrace")) : "wait",
  });

  const armed =
    b.word !== "TAKE" &&
    b.plan != null &&
    b.layers.filter((l) => l.must && l.state !== "pass").every((l) => l.state === "wait" && /retrace/i.test(l.label));

  if (!armed && (b.word !== "TAKE" || !b.plan)) {
    steps.push({
      title: `6 · Verdict: ${b.word}`,
      body: `${b.missing}${b.missingDetail ? ` — ${b.missingDetail}` : ""}. Confluence ${s.confluence.toFixed(2)} (${s.grade}).`,
      tone: b.word === "WAIT" ? "wait" : "fail",
    });
    if (chase) {
      const c = chase;
      const kind =
        c.lossKind === "level-broke"
          ? "the level broke"
          : c.lossKind === "early-entry"
            ? "right read, early entry"
            : c.lossKind === "chop"
              ? "chop"
              : null;
      const belowFloor = c.plan.rr1 != null && c.plan.rr1 < APLUS_RULES.minRr;
      steps.push({
        title: "7 · If you had not waited",
        body: `Market ${c.plan.side} at ${px(c.plan.entry)}, stop ${px(c.plan.stop)} one tick beyond the raid wick (${px(c.plan.riskPts)}pt = 1R)${c.plan.t1 != null ? `, T1 ${px(c.plan.t1)} = ${c.plan.rr1?.toFixed(2)}R` : ", no draw in front to target"}.${
          belowFloor
            ? ` That reward-to-risk is below the ${APLUS_RULES.minRr.toFixed(1)}:1 floor — the entry is so far from the wick that the stop swallows the target, and the R:R gate alone would refuse it.`
            : ""
        } ${c.exitReason}. Result: ${c.outcome.toUpperCase()}${c.r != null ? ` ${c.r >= 0 ? "+" : ""}${c.r.toFixed(2)}R` : ""}${kind ? ` (${kind})` : ""}.`,
        tone: c.outcome === "win" ? "wait" : c.outcome === "loss" ? "fail" : "info",
      });
    }
    const lesson =
      chase && chase.outcome === "loss"
        ? `The desk said ${b.word} because "${b.missing}" was not there. Taking it anyway cost ${chase.r?.toFixed(2)}R on this tape. That is the price of one missing layer — measured, not asserted.`
        : chase && chase.outcome === "win"
          ? `The desk said ${b.word} and the chase would have made ${chase.r?.toFixed(2)}R this time. That is not a reason to chase. A sequence that skips a layer wins sometimes and loses by design, and the wins are exactly what train the habit that produces the losses. Judge the process, not this print.`
          : b.word === "WAIT"
            ? "A WAIT is not a missed trade. It is the sequence naming the layer to watch for next — and the bars that follow show whether it ever arrived."
            : "Standing down on a named missing layer is the process working. Look at what price did next and ask whether the layer that was missing is the reason.";
    return { steps, lesson };
  }

  const p = b.plan!;
  steps.push({
    title: armed ? "6 · The plan — armed, limit resting" : "6 · The plan — TAKE",
    body: `${p.side.toUpperCase()} · limit ${px(p.entry)} inside ${p.entryZone ? `${px(p.entryZone.bottom)}–${px(p.entryZone.top)}` : "the array"} · stop ${px(p.stop)} (${px(p.riskPts)}pt = 1R, beyond the raid wick)${p.t1 != null ? ` · T1 ${px(p.t1)} = ${p.rr1?.toFixed(2)}R` : " · no T1 priced"}${p.t2 != null ? ` · T2 ${px(p.t2)} = ${p.rr2?.toFixed(2)}R` : ""}. Confluence ${s.confluence.toFixed(2)} (${s.grade}). ${
      armed
        ? `The desk printed WAIT — "${b.missingDetail}". Every other layer passed, so the limit is rested at consequent encroachment and price is left to come to it. This is the posture the desk instructs; chasing here is the error the retrace layer exists to prevent.`
        : "The desk printed TAKE: price was already inside the array on the close."
    }`,
    tone: "pass",
  });

  if (!sim) return { steps, lesson: "" };

  steps.push({
    title: "7 · What happened",
    body: sim.events.join(". ") + ".",
    tone: sim.outcome === "win" ? "pass" : sim.outcome === "loss" ? "fail" : "wait",
  });

  let lesson: string;
  switch (sim.outcome) {
    case "win":
      lesson = `+${sim.r?.toFixed(2)}R over ${sim.barsHeld} bars. Every layer was present and in order before the click; the trade was the sequence completing, not a guess that happened to work. Note how much of the R came from the runner after the stop was already at break-even.`;
      break;
    case "loss":
      lesson =
        lossKind === "level-broke"
          ? `${sim.r?.toFixed(2)}R. Price accepted beyond the stop and kept going — in hindsight the raid was a breakout. The read was wrong, and the stop beyond the wick did exactly its job: it made being wrong cost one R instead of a week. This is the loss the model is designed to take.`
          : lossKind === "early-entry"
            ? `${sim.r?.toFixed(2)}R, and then price went to the target anyway. The read was RIGHT — the timing was not. The stop was hit by the ordinary noise of the retrace before the move began. The fix is not a wider stop; it is a later entry, deeper in the array, or waiting for the lower-timeframe confirmation.`
            : `${sim.r?.toFixed(2)}R in chop. Price neither broke the level nor reached the draw — it went nowhere and took the stop on noise. Look at the volatility and time of day: the sequence was complete but the tape had no intent. This is the loss the time-of-day rules exist to reduce.`;
      break;
    case "scratch":
      lesson = `Roughly flat (${sim.r?.toFixed(2)}R). T1 was banked, then the runner came back to break-even. The scale-out rule turned a trade that reversed into a non-event instead of a loss — that is the rule doing exactly what it is for.`;
      break;
    default:
      lesson = `The limit never filled: price displaced and did not return to the array. A correct read with no entry is a normal outcome, and the one that tempts a chase. The desk's answer to "it's leaving without me" is the same as it was before the shift: wait.`;
  }
  return { steps, lesson };
}

/* ── The builder ────────────────────────────────────────────────────────── */

export interface BuildOptions {
  /** Only consider decisions inside the desk's trade window. */
  tradeWindowOnly?: boolean;
  /**
   * Restrict to the NY AM window the trader actually sits (09:45–11:00 ET,
   * per the live session loop). The engine's own trade window also covers
   * London, which is not where this desk's decisions are made.
   */
  nyAmOnly?: boolean;
  /** Near-miss must have at least this many must-layers passing. */
  nearMissMinPass?: number;
  /** Keep WAIT/STAND moments at or above this confluence as near-miss cases. */
  nearMissFloor?: number;
  /** Cap on near-miss cases kept per symbol. */
  maxNearMisses?: number;
}

/**
 * Find every case the engine would have produced on this history.
 *
 * Returns ALL of them — the selection of which to teach from is a separate,
 * visible step (`selectForTeaching`), so the pool can be inspected and the
 * win/loss mix is never hidden inside the builder.
 */
export function buildCases(
  symbol: CaseSymbol,
  bars: OhlcBar[],
  peer: CaseSymbol,
  peerBars: OhlcBar[],
  opts: BuildOptions = {},
): LearnCase[] {
  const tradeWindowOnly = opts.tradeWindowOnly ?? true;
  const nyAmOnly = opts.nyAmOnly ?? true;
  const nearMissFloor = opts.nearMissFloor ?? APLUS_RULES.confluenceFloor;
  const maxNearMisses = opts.maxNearMisses ?? 10;
  const nearMissMinPass = opts.nearMissMinPass ?? 5;

  const cases: LearnCase[] = [];
  const lastEmit = new Map<string, number>();
  let nearMisses = 0;
  const nearMissDays = new Set<string>();
  let peerIdx = 0;

  for (let i = WARMUP; i < bars.length - 1; i++) {
    const now = bars[i]!;
    while (peerIdx < peerBars.length && peerBars[peerIdx]!.t <= now.t) peerIdx++;
    const peerSlice = peerBars.slice(0, peerIdx);
    if (peerSlice.length < WARMUP) continue;

    const clock = getSessionClock(new Date(now.t));
    if (tradeWindowOnly && !clock.inTradeWindow) continue;
    if (isJudasWindow(clock.etHour, clock.etMinute)) continue;
    if (nyAmOnly) {
      const m = clock.etHour * 60 + clock.etMinute;
      if (m < 9 * 60 + 45 || m > 11 * 60) continue;
    }

    const slice = bars.slice(Math.max(0, i + 1 - HORIZON), i + 1);
    const peerWindow = peerSlice.slice(Math.max(0, peerSlice.length - HORIZON));

    const s = snapshot(symbol, peer, slice, peerWindow);
    const b = s.book;
    const key = `${symbol}-${b.side ?? "none"}`;
    const last = lastEmit.get(key);
    if (last != null && i - last < COOLDOWN) continue;

    const isTake = b.word === "TAKE" && b.plan != null;
    // Armed: the only must-layer not passing is the retrace, and it is
    // "wait" (array named, price outside), never "fail".
    const musts = b.layers.filter((l) => l.must);
    const notPassing = musts.filter((l) => l.state !== "pass");
    const isArmed =
      !isTake &&
      b.plan != null &&
      notPassing.length === 1 &&
      notPassing[0]!.state === "wait" &&
      /retrace/i.test(notPassing[0]!.label);
    const entryMode: EntryMode | null = isTake ? "take" : isArmed ? "armed" : null;
    // A near-miss worth teaching from: a side, a real raid on the tape, most
    // of the sequence present, and PATH-grade confluence — i.e. the setups
    // that tempt an entry the desk refused.
    const sweepLayer = musts.find((l) => /sweep/i.test(l.label));
    const isNearMiss =
      !entryMode &&
      b.side != null &&
      s.confluence >= nearMissFloor &&
      b.mustPass >= nearMissMinPass &&
      sweepLayer?.state === "pass";
    if (!entryMode && !isNearMiss) continue;
    // Spread near-misses across the month: at most one per session day, so
    // the teaching set is not the first three days of the file.
    if (isNearMiss) {
      const day = etDayKey(now.t);
      if (nearMisses >= maxNearMisses || nearMissDays.has(day)) continue;
      nearMissDays.add(day);
    }

    lastEmit.set(key, i);
    const future = bars.slice(i + 1);
    const sim = entryMode ? simulate(b.plan!, future) : null;
    const lossKind =
      sim && sim.outcome === "loss" && sim.exitIndex != null ? classifyLoss(b.plan!, future, sim.exitIndex) : null;

    let chase: LearnCase["chase"] = null;
    if (!entryMode) {
      const cp = chasePlan(s);
      if (cp) {
        const csim = simulateMarket(cp, future);
        chase = {
          plan: cp,
          outcome: csim.outcome,
          r: csim.r,
          barsHeld: csim.barsHeld,
          exitReason: csim.exitReason,
          lossKind:
            csim.outcome === "loss" && csim.exitIndex != null ? classifyLoss(cp, future, csim.exitIndex) : null,
        };
      }
    }
    const { steps, lesson } = buildSteps(s, sim, lossKind, chase);

    const from = Math.max(0, i - CONTEXT_BEFORE);
    const to = Math.min(bars.length, i + 1 + CONTEXT_AFTER);

    cases.push({
      id: `${symbol}-${now.t}`,
      symbol,
      side: b.side,
      decisionT: now.t,
      decisionEt: etStamp(now.t),
      word: b.word,
      entryMode,
      confluence: r2(s.confluence),
      grade: s.grade,
      outcome: sim ? sim.outcome : "stand",
      r: sim?.r ?? null,
      barsHeld: sim?.barsHeld ?? 0,
      exitReason: sim?.exitReason ?? `${b.missing}${b.missingDetail ? ` — ${b.missingDetail}` : ""}`,
      lossKind,
      bars: bars.slice(from, to),
      decisionIndex: i - from,
      plan: b.plan,
      layers: b.layers,
      missing: b.missing,
      missingDetail: b.missingDetail,
      steps,
      lesson,
      chase,
    });
    if (isNearMiss) nearMisses++;
  }
  return cases;
}

/**
 * Choose what to teach from, without hiding the mix.
 *
 * Keeps wins and losses in the proportion they occurred (rounded toward
 * showing at least one of each when both exist), the highest-confluence
 * examples of each, plus a few near-misses. A teaching set that is all
 * winners is a marketing set.
 */
export function selectForTeaching(all: LearnCase[], perSymbol = 8): LearnCase[] {
  const out: LearnCase[] = [];
  for (const symbol of ["MNQ", "ES"] as const) {
    const mine = all.filter((c) => c.symbol === symbol);
    const wins = mine.filter((c) => c.outcome === "win").sort((a, b) => b.confluence - a.confluence);
    const losses = mine.filter((c) => c.outcome === "loss").sort((a, b) => b.confluence - a.confluence);
    const other = mine
      .filter((c) => !["win", "loss"].includes(c.outcome))
      .sort((a, b) => {
        const ap = a.layers.filter((l) => l.must && l.state === "pass").length;
        const bp = b.layers.filter((l) => l.must && l.state === "pass").length;
        return bp - ap || b.confluence - a.confluence;
      });
    const taken = wins.length + losses.length;
    const tradeSlots = Math.max(0, perSymbol - 2);
    const winSlots = taken ? Math.round((wins.length / taken) * tradeSlots) : 0;
    const lossSlots = tradeSlots - winSlots;
    out.push(
      ...wins.slice(0, Math.max(wins.length ? 1 : 0, winSlots)),
      ...losses.slice(0, Math.max(losses.length ? 1 : 0, lossSlots)),
      ...other.slice(0, Math.max(2, perSymbol - wins.length - losses.length)),
    );
  }
  return out.sort((a, b) => a.decisionT - b.decisionT);
}

/** Honest tally of the whole pool, for the tab header. */
export function tally(all: LearnCase[]): { takes: number; wins: number; losses: number; scratch: number; unfilled: number; stands: number; sumR: number } {
  const t = { takes: 0, wins: 0, losses: 0, scratch: 0, unfilled: 0, stands: 0, sumR: 0 };
  for (const c of all) {
    if (c.outcome === "stand") t.stands++;
    else {
      t.takes++;
      if (c.outcome === "win") t.wins++;
      else if (c.outcome === "loss") t.losses++;
      else if (c.outcome === "scratch") t.scratch++;
      else t.unfilled++;
      t.sumR += c.r ?? 0;
    }
  }
  t.sumR = r2(t.sumR);
  return t;
}
