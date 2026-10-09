/**
 * Live SMC sequence grade — one tape, independent layers, no school-stacking.
 *
 * ICT maps a narrative. TJR is sweep → 5m confirm. Blake is IFVG mechanical.
 * This desk prices DOL, demands sweep polarity, dealing-range location, then
 * LTF shift, then the retrace. A single concept is never TAKE.
 */

import { reachTier } from "./entry-trigger";
import { GATE } from "./gate-tuning";
import { APLUS_RULES } from "@/lib/aplus/config";
import { isHighProbPath, isPathFire } from "@/lib/alerts/path-alarm";
import { isJudasWindow, type SessionClock } from "./sessions";
import { readSession } from "./session-event";
import { readJudas, JUDAS_MIN_CONFLUENCE } from "./judas-window";
import { allSeries } from "./chart-timeframes";
import {
  canonInputForCandidate,
  scoreCanonStack,
  type CanonStack,
} from "./smc-canon";
import { buildTradePlan, type TradePlan } from "./trade-plan";
import { planHitOdds } from "./hit-odds-model";

/**
 * What the target is worth, in ONE probability (2026-10-02). This printed the
 * 18-session first-passage race (target-odds.ts) — "T1 22% before the stop" —
 * while the card printed a different number. On 2025–26 cards the four-year
 * geometry model beat the race decisively (log loss 0.537 vs 0.578, paired
 * z = −2.57; scripts/build-hit-odds.mjs), so the race is retired from the
 * headline and the card and this layer now quote the same figure.
 */
function worthLine(plan: TradePlan): string {
  const odds = planHitOdds({
    side: plan.side,
    symbol: plan.symbol,
    entry: plan.entry,
    stop: plan.stop,
    t1: plan.t1,
    atr: plan.riskAtr,
    price: plan.price,
  });
  if (!odds) return plan.worth?.headline ?? "worth unpriced — no session history on this book";
  return `T1 ${Math.round(odds.pT1 * 100)}% if filled (four-year model) · ${odds.expR >= 0 ? "+" : ""}${odds.expR.toFixed(2)}R per fill`;
}
import { applyRunnerPool, drawPoolsForSide, planStopText } from "./card-plan";
import { buildImpulseLeg, isUsableLeg, retracementRatio } from "./fib";
import type { OhlcBar } from "@/lib/market/types";
import type { SmcTape } from "./smc-board";
import type { HtfBiasRead, SmtStack } from "./structure";
import type { DrawRead, LiquidityTarget } from "./draw";
import type { MarketNarrative } from "./market-narrative";
import type { ScanResult, SetupCandidate } from "./scanner";
import type { NewsRead } from "./news";

export type SmcLayerState = "pass" | "wait" | "fail";

export interface SmcLayer {
  id: string;
  label: string;
  must: boolean;
  state: SmcLayerState;
  detail: string;
  price?: number;
}

/**
 * The dealing range the pd_half layer graded against, so the chart tints the
 * same box the verdict used. `source` says which rule produced it.
 */
export interface DealingRead {
  high: number;
  low: number;
  eq: number;
  zone: "premium" | "discount" | "equilibrium";
  source: "window" | "impulse";
  /** Impulse only: 0 = at the leg's extreme, 1 = back at the raid. */
  ratio: number | null;
}

export interface SmcMasterBook {
  symbol: string;
  side: "long" | "short" | null;
  word: "TAKE" | "WAIT" | "STAND";
  /** The range premium/discount was measured on. Null when none exists. */
  dealing: DealingRead | null;
  /** Label of the first must-layer that is not passing (or "Sequence complete"). */
  missing: string;
  /** Why that layer is not passing, in tape terms — the one line a trader needs. */
  missingDetail: string;
  layers: SmcLayer[];
  mustPass: number;
  mustNeed: number;
  canon: CanonStack;
  entry: string;
  invalidation: string;
  t1: string;
  t2: string;
  pathBand: string | null;
  /**
   * The same plan as NUMBERS. `entry`/`invalidation`/`t1`/`t2` above are prose
   * and can only be printed; this can be drawn, measured and checked against
   * the live price. Both are views of one derivation — see trade-plan.ts.
   * Null until the tape has produced enough to price a plan, which before a
   * completed sequence is the normal and correct answer.
   *
   * It also carries `plan.worth` — what the structure is expected to pay, from
   * two first-passage races on this book's own recent sessions. That is the
   * number to render beside the click; every field of it is null below the
   * odds floor rather than a percentage off four sessions.
   */
  plan: TradePlan | null;

  /**
   * ITEM 1 — the POOLS this plan points at, so the card, the chart and the
   * order read the same two levels the target layer graded.
   *
   * `t1` is the next unswept pool in the trade's direction, `t2` the external
   * pool beyond it (`drawPoolsForSide`). `reliable` is `draw.baseRateReliable`,
   * carried so a reach percentage off four sessions is printed as null rather
   * than as a number. Optional: a book with no side or no priced plan has none.
   */
  pools?: {
    t1: LiquidityTarget | null;
    t2: LiquidityTarget | null;
    why: string;
    reliable: boolean;
  } | null;

  /**
   * ITEM 1 — the PARTIAL: equilibrium of the IMPULSE LEG.
   *
   * Null whenever the dealing range is the 80-bar window, because that box's
   * midpoint is a location and taking half off at it is not the rule.
   */
  partial?: number | null;

  /**
   * ITEM 10 — the pick, and whether it was a COMPLETE sequence.
   *
   * `candidateComplete` false means the board is showing the nearest card, not
   * a tradable one; the word is then WAIT at best.
   */
  candidateComplete?: boolean;
  /** Which parts of the complete sequence this pick is missing. */
  candidateMissing?: string[];
}

export interface SmcMasterRead {
  left: SmcMasterBook;
  right: SmcMasterBook;
  oneBook: SmcMasterBook | null;
  thesis: string;
  vsSchools: string;
}

export interface SmcMasterInput {
  clock: SessionClock;
  bias: { left: HtfBiasRead; right: HtfBiasRead };
  scan: ScanResult;
  draws: { left: DrawRead; right: DrawRead };
  narrative: { left: MarketNarrative; right: MarketNarrative };
  news: NewsRead;
  smtStack?: SmtStack;
  smc?: { left: SmcTape; right: SmcTape };
  /** Live prints — the retrace layer is a fact about WHERE price is now. */
  quotes?: { left: { price: number }; right: { price: number } };
  /**
   * The bars each book was read from. Needed only for the impulse-leg
   * dealing range (GATE.dealingRange === "impulse"); build-desk passes its
   * series, which carry `bars`, through the spread.
   */
  left?: { bars: OhlcBar[]; minute?: OhlcBar[] };
  right?: { bars: OhlcBar[]; minute?: OhlcBar[] };
  /** Post-shock: arrays/sweeps before this ms don't count (fresh sequence only). */
  shockFloorMs?: number | null;
}

function factorState(
  pass: boolean,
  must: boolean,
  waiting: boolean,
): SmcLayerState {
  if (pass) return "pass";
  if (!must || waiting) return "wait";
  return "fail";
}

/**
 * ITEM 10 — THE COMPLETE SEQUENCE, PART BY PART.
 *
 * The board sorted by `confluence`, and that number does not predict the first
 * target (four years: Q 0.85+ went the card's way 46.3% vs 53.6% at 0.65–0.70
 * — anti-predictive on direction). So a card with a MISSING must could sit on
 * top of a complete one purely by carrying more structure.
 *
 * These five are the sequence as the desk states it, each read off the card
 * the scanner already built — no new detection, no new threshold:
 *
 *   raid         `sweep_significant` — a wick through the pool that closed
 *                back inside, filtered to this side's polarity in scanner.ts.
 *   displacement `displacement` — `pairedDisplacement`, a LATER close inside
 *                the mechanical window answering that raid.
 *   array        `entryPx != null` — the scanner prices CE only from the gap
 *                that displacement left (`born ?? flipped`). An older gap
 *                leaves `entryPx` null, so this is "the array from THAT
 *                displacement" and not "some array exists".
 *   mtf          `mid_bias` — a missing or neutral middle frame is not
 *                agreement, so its absence is a gap.
 *   window       `killzoneOk` — `sessionLive`, the killzone or a measured
 *                delivery+participation bar.
 */
export const SEQUENCE_PARTS = ["raid", "displacement", "array", "mtf", "window"] as const;
export type SequencePart = (typeof SEQUENCE_PARTS)[number];

export function sequenceGaps(c: SetupCandidate): SequencePart[] {
  const has = (k: string) => c.components.includes(k as never);
  const out: SequencePart[] = [];
  if (!has("sweep_significant") && !has("mechanical_model")) out.push("raid");
  if (!has("displacement")) out.push("displacement");
  if (c.entryPx == null) out.push("array");
  if (!has("mid_bias")) out.push("mtf");
  if (!c.killzoneOk) out.push("window");
  return out;
}

/** True only when every part of the sequence is on the card. */
export function sequenceComplete(c: SetupCandidate): boolean {
  return sequenceGaps(c).length === 0;
}

/**
 * The book's cards, ordered so a COMPLETE sequence always outranks an
 * incomplete one.
 *
 * Order: HTF-allowed side first (CLAUDE.md makes `topDown` absolute, and the
 * 2026-09-25 board put a refused counter-trend short above an allowed long
 * purely on band), then the raid's side when `GATE.sideFromRaid` names one,
 * then COMPLETENESS, then the PATH grade, and only then the fit — which is the
 * last tiebreak because it is not monotone in outcome.
 *
 * Exported so the verifier can order a hand-built book without going through
 * the whole desk.
 */
export function eligibleCandidates(
  scan: ScanResult,
  bias: Pick<HtfBiasRead, "symbol" | "topDown">,
  narrative: MarketNarrative,
): SetupCandidate[] {
  const book = scan.candidates.filter((c) => c.symbol === bias.symbol);
  const need = bias.topDown === "bull" ? "long" : bias.topDown === "bear" ? "short" : null;
  const swept = narrative.liquidity.lastSweep;
  const raidSide = swept === "ssl" ? "long" : swept === "bsl" ? "short" : null;
  const rank = (c: SetupCandidate) => {
    // A released counter-bias card (disrespect + distribution) counts as
    // aligned — that is the one documented exception to the absolute gate.
    const aligned = need == null || c.side === need || c.htfDisrespected === true;
    return [
      c.htfOk ? 1 : 0,
      aligned ? 1 : 0,
      GATE.sideFromRaid && raidSide != null && c.side === raidSide ? 1 : 0,
      sequenceComplete(c) ? 1 : 0,
      isHighProbPath(c) ? 2 : isPathFire(c) ? 1 : 0,
    ];
  };
  return [...book].sort((a, b) => {
    const ra = rank(a);
    const rb = rank(b);
    for (let i = 0; i < ra.length; i++) {
      if (ra[i] !== rb[i]) return rb[i]! - ra[i]!;
    }
    return b.confluence - a.confluence;
  });
}

function pickCandidate(
  scan: ScanResult,
  bias: HtfBiasRead,
  narrative: MarketNarrative,
): SetupCandidate | undefined {
  // ITEM 10: completeness decides the pick. A higher fit with a missing must
  // LOSES to a complete sequence; when nothing is complete the nearest card is
  // still named (refusing to name any card is worse than naming a weak one)
  // but `candidateComplete` is false on the book and the word cannot be TAKE.
  // `eligibleCandidates` orders the WHOLE book, so the only empty case is a
  // book with no cards at all. The old cascade (raid side -> aligned+PATH ->
  // aligned -> PATH -> best score) is now the first four keys of that sort,
  // with COMPLETENESS inserted ahead of the band — which is item 10.
  return eligibleCandidates(scan, bias, narrative)[0];
}

/**
 * Premium / discount measured on the post-raid impulse leg.
 *
 * ICT's dealing range for an entry is the leg the displacement made away from
 * the sweep: raid extreme → impulse extreme. Discount (for a long) is the
 * lower half of THAT leg, and OTE its 62–79%. The 80-bar window range in
 * structure.ts is a different object — a 20-hour box — and in a trend it
 * calls every pullback "premium", which is why pd_half failed on ~75-80% of
 * trade-window bars in the 2026-09-21 replay. Null when there is no raid of
 * the trade's polarity to anchor on; the caller then uses the window.
 */
function impulseDealing(
  bars: OhlcBar[] | undefined,
  side: "long" | "short" | null,
  narrative: MarketNarrative,
  price: number | null,
): DealingRead | null {
  if (!bars?.length || !side) return null;
  const lq = narrative.liquidity;
  const want = side === "long" ? "ssl" : "bsl";
  if (lq.lastSweep !== want || lq.lastSweepT == null || lq.lastSweepExtreme == null) return null;
  let idx = -1;
  for (let i = bars.length - 1; i >= 0; i--) {
    if (bars[i]!.t <= lq.lastSweepT) {
      idx = i;
      break;
    }
  }
  if (idx < 0) return null;
  const leg = buildImpulseLeg(bars, side === "long" ? "bull" : "bear", {
    originPrice: lq.lastSweepExtreme,
    originIndex: idx,
    lookback: Math.max(2, bars.length - idx),
  });
  if (!isUsableLeg(leg)) return null;
  const ratio = price != null ? retracementRatio(leg, price) : null;
  const high = Math.max(leg.from, leg.to);
  const low = Math.min(leg.from, leg.to);
  // 0 = at the impulse extreme (no retrace yet), 1 = back at the raid. Past
  // 1 the raid extreme is broken and the leg's premise is gone — that is
  // the wrong half by definition, not a deeper discount.
  let zone: DealingRead["zone"];
  if (ratio == null) zone = "equilibrium";
  else if (ratio > 1) zone = side === "long" ? "premium" : "discount";
  else if (ratio >= 0.55) zone = side === "long" ? "discount" : "premium";
  else if (ratio <= 0.45) zone = side === "long" ? "premium" : "discount";
  else zone = "equilibrium";
  return { high, low, eq: (high + low) / 2, zone, source: "impulse", ratio };
}

function gradeBook(
  bias: HtfBiasRead,
  draw: DrawRead,
  narrative: MarketNarrative,
  scan: ScanResult,
  clock: SessionClock,
  news: NewsRead,
  smtOn: boolean,
  tape: SmcTape | undefined,
  price: number | null,
  shockFloorMs: number | null,
  bars: OhlcBar[] | undefined,
  minute: OhlcBar[] | undefined,
): SmcMasterBook {
  const cand = pickCandidate(scan, bias, narrative);
  const side = cand?.side ?? null;

  // The range premium/discount is graded on. Impulse leg when the knob says
  // so AND a raid of this side's polarity exists to anchor it; the 80-bar
  // window otherwise (and always under the original rule set).
  const windowDealing: DealingRead | null = bias.dealing
    ? {
        high: bias.dealing.high,
        low: bias.dealing.low,
        eq: bias.dealing.eq,
        zone: bias.dealing.zone,
        source: "window",
        ratio: null,
      }
    : null;
  const dealing =
    (GATE.dealingRange === "impulse" ? impulseDealing(bars, side, narrative, price) : null) ??
    windowDealing;

  /**
   * THE SESSION LAYER, ASKED OF THE TAPE.
   *
   * Was `clock.inTradeWindow` alone, which made the hour a hard veto: outside
   * the window the `time` must-layer could never pass, so TAKE was impossible
   * regardless of what price did. That refused the highest-participation bars
   * of the week — the 08:32 release, the 14:10 headline, the overnight gap
   * that runs the prior high — on the grounds that a clock said so.
   *
   * `readSession` keeps the killzone as the ordinary path and adds ONE other
   * way in: a bar that clears a measured delivery AND participation bar. It
   * is one layer of nine; the sweep, the dealing-range half, the LTF shift,
   * the priced target and the retrace are all still in front of it, and Judas
   * and the news blackout are checked below and cannot be satisfied here.
   */
  const session = readSession(bars ?? [], clock);

  /**
   * THE JUDAS WINDOW, AS A SETUP RATHER THAN A LOCKED DOOR.
   *
   * `rungs` is every timeframe the desk can honestly build from the two real
   * series it holds — 1m/2m/3m/5m from the minute feed, 15m/1h/4h from the
   * engine's own. It is built here, once, so the sequence and the chart are
   * looking at the same objects rather than two aggregations that can drift.
   *
   * The Judas read needs the sub-15m rungs specifically: 09:30-09:45 ET is a
   * single 15m candle, so on the graded series the raid and the reaction to
   * the raid are the same bar. It fails closed without them.
   */
  const rungs = allSeries(bars ?? [], minute ?? []);
  const judasRead = readJudas(rungs, clock, side);

  /**
   * ITEM 11 — SMT TRADES THE INDEX THAT INVERTED FIRST.
   *
   * `smtLevel.led` is `thisLed` from smt-level.ts: true when THIS book made
   * the divergence's new extreme. The laggard is not a second setup on the
   * same divergence, so it does not earn the optional SMT factor. `null` is
   * "no divergence read" and behaves exactly as today — absence of evidence is
   * not a refusal.
   */
  const smtLed = cand?.smtLevel?.led ?? null;
  const canon = scoreCanonStack(
    cand
      ? {
          ...canonInputForCandidate(cand, bias, narrative, clock),
          dealingZone: dealing?.zone ?? null,
          inKillzone: session.live,
          killzoneLabel: session.reason,
          smtLed,
        }
      : {
          side,
          htf: bias.topDown,
          mtf: bias.mid,
          dealingZone: dealing?.zone ?? null,
          swept: narrative.liquidity.lastSweep,
          confirmation: narrative.confirmation,
          inKillzone: session.live,
          killzoneLabel: session.reason,
          smt: smtOn,
          components: [],
          strategy: null,
          smtLed,
        },
  );

  // WAS: `isJudasWindow(...)` alone — an unconditional refusal for the whole
  // fifteen minutes. The trader's call (2026-09-24): the Judas swing is a
  // MODEL, not a hazard, so the window blocks only until the manipulation has
  // demonstrably finished. `judas-window.ts` grants that release solely when
  // a raid printed on a sub-15m rung, closed back inside, and a LATER bar
  // displaced against it — and only for the side that failed raid points at.
  // No sub-15m tape, no release. See JUDAS_MIN_CONFLUENCE below for the grade
  // it additionally has to carry.
  const judas = judasRead.blocked;
  const retestReady =
    narrative.liquidity.lastSweep !== "none" &&
    (narrative.confirmation === "armed_entry" || narrative.confirmation === "confirmed");
  const newsBlk = news.verdict === "blackout" && !retestReady;
  const dol = draw.primary;
  const dolAgrees =
    !!dol &&
    ((side === "short" && dol.side === "below") ||
      (side === "long" && dol.side === "above"));

  const layers: SmcLayer[] = canon.factors.map((f) => {
    const waiting =
      (f.id === "sweep" && narrative.liquidity.lastSweep === "none") ||
      (f.id === "ltf" &&
        (narrative.confirmation === "sweep_only" ||
          narrative.confirmation === "none")) ||
      // 2026-09-23: pd_half was HARD-FAILING. It fails on 75-80% of
      // trade-window bars and is also the single most REVERSIBLE state on
      // the board — premium becomes discount by price simply moving. A
      // mislabelled FAIL sets the word to STAND, tells the trader the
      // session is dead, and makes shouldMarkUp refuse to draw the chart,
      // for a condition a ten-minute retrace would have satisfied. Same
      // for dol when a magnet exists but currently sits behind the trade.
      (f.id === "pd_half" && dealing != null) ||
      // A quiet out-of-window tape is WAITING, not failing: the next bar can
      // deliver, and a hard FAIL would set the word to STAND and stop the
      // chart being drawn for a condition that reverses in fifteen minutes.
      (f.id === "time" && !session.live);
    // The desk card and the floor are built from this same tape. A fighting
    // middle frame is the brain's note. It is not a second veto the scanner
    // already chose not to apply, or the floor stands while the brain does not.
    const deskCleared = Boolean(cand?.actionable);
    const mtfNote = f.id === "mtf";
    return {
      id: f.id,
      label: f.label,
      must: mtfNote ? false : f.must,
      state: factorState(f.pass, mtfNote ? false : f.must, waiting),
      detail:
        mtfNote && !f.pass && deskCleared
          ? `${f.detail} Desk card cleared this side. Middle frame is a note, not a stand.`
          : f.detail,
    };
  });

  layers.unshift({
    id: "dol",
    label: "Draw on liquidity",
    must: true,
    state: !dol ? "wait" : dolAgrees ? "pass" : "fail",
    // The percentage here is the EXCURSION rate — what fraction of prior
    // sessions ever travelled this far from this point — and the stop is not
    // in it. That is the right number for "is this magnet in reach at all",
    // and the wrong one for "will this trade get paid"; the race that answers
    // the second lives on the plan (trade-plan.ts, PlanWorth). Labelled
    // "touch" so the two are never read as the same claim, and carrying its
    // sample count, because a rate off four sessions can only be 0/25/50/75/
    // 100 and otherwise renders exactly like one off forty.
    detail: dol
      ? `${dol.name} ${dol.price.toFixed(2)} · ${(dol.reachProbability * 100).toFixed(0)}% touch over ${draw.sessionsSampled} sessions${draw.baseRateReliable ? "" : " (below the base-rate floor)"} · ${dol.side}`
      : "No magnet yet",
    price: dol?.price,
  });

  const shiftPrinted =
    narrative.confirmation === "confirmed" ||
    narrative.confirmation === "sweep_displace" ||
    narrative.confirmation === "armed_entry";

  // The array the retrace goes INTO: same side as the trade, still fresh, and
  // formed after the raid (an array from before the sweep is the leg into
  // liquidity, not the reversal's footprint). Nearest to price wins.
  const want: "bull" | "bear" | null =
    side === "long" ? "bull" : side === "short" ? "bear" : null;
  const raidT = narrative.liquidity.lastSweepT;
  // After a shock, the array must have formed AFTER the shock too — a
  // pre-shock FVG is a relic of the old regime, not a retrace target.
  const floorT = Math.max(raidT ?? 0, shockFloorMs ?? 0) || null;
  const candidates = want
    ? (tape?.arrays ?? []).filter(
        (a) =>
          a.side === want &&
          // "sponsored" is an FVG whose middle candle is >= 1.5x ATR — the
          // SAME threshold as GATE.displacementK. Omitting it meant the array
          // created by a qualifying displacement was renamed out of the pool
          // that needs it: the stronger the displacement, the more certain the
          // exclusion. A sponsored gap is an FVG with a strength tag, not a
          // different object.
          (a.kind === "ifvg" ||
            a.kind === "fvg" ||
            a.kind === "sponsored" ||
            a.kind === "ob") &&
          (a.state === "fresh" || a.state === "partial") &&
          (floorT == null || a.t >= floorT),
      )
    : [];
  const fresh =
    price != null
      ? [...candidates].sort(
          (a, b) => Math.abs(a.mid - price) - Math.abs(b.mid - price),
        )[0]
      : candidates[0];
  const mss = want
    ? tape?.alerts.find(
        (a) =>
          a.side === want && (a.kind === "mss" || a.kind === "displacement"),
      )
    : undefined;

  // RETRACE = price is IN the array now (± a quarter of its height). Before
  // 2026-09-16 this layer passed on narrative "armed_entry", which only meant
  // "a sweep, a shift and SOME array exist" — true at the top of the impulse,
  // i.e. exactly the print the desk says never to chase.
  let retraceState: SmcLayerState = "wait";
  let retraceDetail: string;
  if (!shiftPrinted) {
    retraceDetail = "No retrace until LTF shift exists";
  } else if (!fresh) {
    retraceDetail = "Shift printed — no fresh FVG/IFVG/OB on this side after the raid yet";
  } else if (price == null) {
    retraceDetail = `${fresh.kind.toUpperCase()} ${fresh.bottom.toFixed(2)}–${fresh.top.toFixed(2)} — no live print to place you`;
  } else {
    const pad = Math.max((fresh.top - fresh.bottom) * GATE.retracePad, 0.25);
    const inside = price >= fresh.bottom - pad && price <= fresh.top + pad;
    if (inside) {
      retraceState = "pass";
      retraceDetail = `In ${fresh.tf} ${fresh.kind.toUpperCase()} ${fresh.bottom.toFixed(2)}–${fresh.top.toFixed(2)} · limit at CE ${fresh.mid.toFixed(2)}`;
    } else {
      const away = price > fresh.top ? price - fresh.top : fresh.bottom - price;
      const dir = price > fresh.top ? "above" : "below";
      retraceDetail = `${fresh.kind.toUpperCase()} ${fresh.bottom.toFixed(2)}–${fresh.top.toFixed(2)} is ${away.toFixed(2)}pt ${dir} price — wait for it, do not chase ${price.toFixed(2)}`;
    }
  }
  // An inverted 5m gap plus displacement IS the entry. CE is only the midpoint
  // of that gap. A mitigation block is a failed second push — a different
  // object — and this setup does not wait to tag one.
  const inverted = cand?.reasons.some((r) => /ifvg \(inverted\)/i.test(r)) ?? false;
  const displaced = Boolean(
    mss || cand?.components.includes("displacement") || cand?.components.includes("mss"),
  );
  if (inverted && displaced && fresh && price != null && retraceState !== "pass") {
    const pad = Math.max((fresh.top - fresh.bottom) * 0.25, 0.25);
    const atTheClose = price >= fresh.bottom - pad && price <= fresh.top + pad;
    if (atTheClose) {
      retraceState = "pass";
      retraceDetail = `5m IFVG inverted and displaced — that close is the entry. CE ${fresh.mid.toFixed(2)} is the midpoint of the gap, not a second level. This is not a mitigation block.`;
    } else {
      const ran = side === "short" ? price < fresh.bottom : price > fresh.top;
      if (ran)
        retraceDetail = `Displacement already left the array. Do not chase ${price.toFixed(2)}. Next entry is the pullback into ${fresh.bottom.toFixed(2)}–${fresh.top.toFixed(2)}, limit at CE ${fresh.mid.toFixed(2)}.`;
    }
  }
  /**
   * ITEM 1 — THE TARGET IS A POOL, NOT A LOCATION.
   *
   * `dol` is `draw.primary`: the highest-SCORING magnet, where the score mixes
   * excursion rate, kind weight and HTF alignment. On a trending tape that is
   * routinely the equilibrium of the 80-bar box — a level this file's own
   * comment above calls "a different object ... a 20-hour box". Nobody's stop
   * rests at an equilibrium the desk computed. `drawPoolsForSide` instead takes
   * the next UNSWEPT pool in the trade's direction ahead of CE, then the
   * external pool beyond it.
   *
   * GATED BEHIND THE OLD PRECONDITION ON PURPOSE. `dolAgrees` still has to be
   * true before any target is priced, exactly as before, so this can only ever
   * REMOVE a target (an EQ that used to qualify no longer does), never create
   * one. A pool sitting ahead of CE while the primary magnet points the other
   * way would be a NEW take: an unmeasured loosening, deliberately not taken.
   * That is the obvious next question for the trader.
   */
  const entryCE = fresh?.mid ?? null;
  const pools = dolAgrees
    ? drawPoolsForSide(draw, side, entryCE)
    : {
        t1: null as LiquidityTarget | null,
        t2: null as LiquidityTarget | null,
        why: dol
          ? `${dol.name} ${dol.price.toFixed(2)} sits behind the ${side ?? "trade"} — the draw does not agree, so no target is priced.`
          : "No magnet yet — nothing to price.",
      };
  /**
   * The PARTIAL: equilibrium of the IMPULSE LEG only.
   *
   * `dealing.source === "impulse"` is the leg the displacement made away from
   * the raid, and its midpoint is a place to take half off. When the dealing
   * read fell back to the 80-bar window there is no impulse leg, and that box's
   * EQ is not a partial either — null, and the chart draws nothing.
   */
  const partial = dealing?.source === "impulse" ? dealing.eq : null;
  // The numeric plan, priced from the SAME objects the layers were graded
  // from: `fresh` is the array the retrace layer selected, `pools.t1` the pool
  // it priced, the sweep extreme the raid it demanded. Built here, before the
  // target layer, because that layer is a fact about the plan.
  const planRaw = buildTradePlan({
    symbol: bias.symbol,
    side,
    price: price ?? 0,
    entryArray: fresh ?? null,
    sweepExtreme: narrative.liquidity.lastSweepExtreme,
    sweepT: narrative.liquidity.lastSweepT,
    dol: pools.t1,
    range: dealing ? { high: dealing.high, low: dealing.low, eq: dealing.eq } : null,
    arrays: tape?.arrays ?? [],
    // The same bars every other layer was graded on, so the target odds are
    // this instrument on this timeframe. Without them the plan still prices
    // entry, stop and R — it simply carries no odds rather than borrowing
    // someone else's history.
    bars,
  });
  // T2 is the EXTERNAL POOL, not the dealing range's own edge. `buildTradePlan`
  // takes only `range` for T2 (trade-plan.ts — not this agent's file), so the
  // runner is re-pointed here: one field, on the one object everything reads.
  const plan = planRaw ? applyRunnerPool(planRaw, pools.t2) : null;

  // TARGET PRICED ≥ 1:1. The trade must have somewhere to go before it has
  // somewhere to enter. Measured 2026-09-21 on two months of refusals
  // (shadow book): plans with NO priced T1 were the worst trades in the
  // book — the desk's own limit −0.24R/t at 23% WR (n=52), a chase −0.10R/t
  // at 35% (n=78) — while every band of priced T1 was positive. The R:R
  // floor is the hard rule (APLUS_RULES.minRr); below it the same tape paid
  // +0.11R/t on the limit and 0.00R on the chase, so the floor costs little
  // and is the rule. WAIT, not fail: a draw can form ahead of the array on
  // the next bars.
  let targetState: SmcLayerState = "wait";
  let targetDetail: string;
  if (!fresh) {
    targetDetail = "Needs the entry array first — then a draw ≥ 1R ahead of it";
  } else if (!plan) {
    targetDetail = "No live print to price the plan from";
  } else if (plan.t1 == null) {
    targetDetail = dol
      ? `No draw ahead of CE ${plan.entry.toFixed(2)} — ${dol.name} ${dol.price.toFixed(2)} sits ${side === "long" ? "below" : "above"} the entry. No target, no trade.`
      : `No draw priced ahead of CE ${plan.entry.toFixed(2)} — no target, no trade.`;
  } else if (plan.rr1 != null && plan.rr1 < APLUS_RULES.minRr) {
    targetDetail = `T1 ${plan.draw?.name ?? "draw"} ${plan.t1.toFixed(2)} is ${plan.rr1.toFixed(2)}R from CE ${plan.entry.toFixed(2)} (stop ${plan.stop.toFixed(2)}, ${plan.riskPts.toFixed(2)}pt) — below the ${APLUS_RULES.minRr.toFixed(1)}:1 floor`;
  } else {
    targetState = "pass";
    // The draw's MEASURED reach rate, not just its price. Shadow book
    // 2026-09-22, limit leg: draws reached in >80% of past sessions ran
    // +0.34R/card at 39% WR and filled 66% of the time; 60–80% ran flat
    // (0.00R, 22% WR); under 60% ran −0.21R at 14% WR and filled 35%.
    // Monotone in expectancy, win rate and fill rate — so the target is
    // labelled, not gated (the bottom bucket is only n=20).
    const reach = reachTier(plan.draw?.reachProbability);
    // `reachTier` takes a bare number and cannot know how many sessions are
    // behind it, so the SAMPLE COUNT is attached here by the caller that does
    // know. Until its signature carries an n of its own, a 100% off four
    // sessions and an 85% off forty arrive at it identically.
    const reachTxt = `draw touch ${reach.tier} over ${draw.sessionsSampled} sessions (${reach.note})`;
    // And what the whole structure is worth, which is the number the click is
    // actually made against. Not a gate: the hard rule is the minRr floor
    // above, and this is labelled for the same reason the reach tier is —
    // it is a frequency from a small sample of recent sessions, not a
    // forecast. `headline` is null-safe and says "unpriced" below the floor.
    targetDetail =
      `T1 ${plan.draw?.name ?? "draw"} ${plan.t1.toFixed(2)} · ${plan.rr1?.toFixed(2) ?? "?"}R` +
      `${plan.t2 != null ? ` · T2 ${plan.t2.toFixed(2)} ${plan.rr2?.toFixed(2) ?? "?"}R` : ""}` +
      ` · risk ${plan.riskPts.toFixed(2)}pt` +
      ` · ${worthLine(plan)}` +
      ` · ${reachTxt}`;
  }
  layers.push({
    id: "target",
    label: "Target priced ≥ 1:1",
    must: true,
    state: targetState,
    detail: targetDetail,
    price: plan?.t1 ?? undefined,
  });

  layers.push({
    id: "retrace",
    label: "Retrace into array",
    must: true,
    state: retraceState,
    detail: retraceDetail,
    price: fresh?.mid,
  });

  layers.push({
    id: "array",
    label: "Live PD array",
    must: false,
    state: fresh ? "pass" : "wait",
    detail: fresh
      ? `${fresh.tf} ${fresh.kind} ${fresh.label}${mss ? ` · ${mss.kind}` : ""}`
      : "No fresh FVG/IFVG/OB on this side",
    price: fresh?.mid,
  });

  // Judas is the open. It is not a stand. A card the desk already graded can
  // be placed inside 09:30–09:45. The raid and the later close stay on the
  // card. News blackout stays a fail: that is the print, not the window.
  const judasUndergrade = false;

  layers.push({
    id: "clean",
    label: "Judas / news",
    must: true,
    state: newsBlk ? "fail" : "pass",
    detail: newsBlk
      ? `${news.reason || "News spike"}. No retest yet — do not chase the print.`
      : news.verdict === "blackout" && retestReady
        ? "The print was the raid. The retest is the trade."
        : judasRead.inWindow
          ? `${judasRead.reason} The window does not block the ticket.`
          : "Tape is tradable",
  });

  const musts = layers.filter((l) => l.must);
  const htfPass = layers.some((l) => l.id === "htf" && l.state === "pass");
  // PATH bar = A+/A/A- (>= 0.65) or B+ (>= 0.60, its own config band) —
  // Keaton 2026-10-06: B+ is a live PATH grade, so the sequence may say TAKE on it.
  const pathOk = isPathFire(cand);
  /**
   * ITEM 13 — pd_half IS NOT IGNORABLE. The draw still is.
   *
   * A high fit AT EQUILIBRIUM is exactly the location the model refuses: the
   * dealing range has a midpoint, longs come from the discount half and shorts
   * from the premium half, and a card sitting on the midpoint has no half. The
   * old clause let a 0.80+ fit walk past a FAILED `pd_half` on a live PATH,
   * which is the one place the fit must not buy a pass.
   *
   * SCOPE, NOT VALUE: the 0.8 literal is unchanged; only which layers it
   * reaches. `dol` keeps the pass — a magnet currently sitting behind the trade
   * is a size note and reverses on the next bars.
   *
   * Direction of error is safe: TAKE -> WAIT/STAND only, never the reverse.
   * Cost is frequency on a desk already at 23 TAKEs in 5,049 four-year cards.
   * Note `pd_half` only reaches `fail` when `dealing == null` (the waiting
   * clause above forces `wait` whenever a dealing range exists), i.e. when
   * there is no location read at all — so the practical effect is that a card
   * with NO range cannot be taken on fit alone.
   */
  const ignorable = (l: { id: string; state: string }) =>
    pathOk && htfPass && (cand?.confluence ?? 0) >= 0.8 && l.id === "dol" && l.state === "fail";
  const mustPass = musts.filter((l) => l.state === "pass" || ignorable(l)).length;
  const mustNeed = musts.length;
  const mustFail = musts.find((l) => l.state === "fail" && !ignorable(l));
  const mustWait = musts.find((l) => l.state === "wait");

  // Armed: every must-layer passes except the retrace, which is WAITING with
  // a named fresh array (price outside it, not missing). With
  // GATE.armedIsTake that is a TAKE whose entry is a limit at consequent
  // encroachment — the plan below already carries the price. Without it the
  // word stays WAIT until a closed bar prints inside the array.
  const retraceLayer = musts.find((l) => l.id === "retrace");
  const armed =
    GATE.armedIsTake &&
    !mustFail &&
    retraceLayer?.state === "wait" &&
    fresh != null &&
    musts.every((l) => l.id === "retrace" || l.state === "pass" || ignorable(l));

  /**
   * ITEM 10 — AN INCOMPLETE SEQUENCE IS WAIT, NOT THE BEST INCOMPLETE.
   *
   * `pickCandidate` now puts a complete sequence on top, but when NOTHING on
   * the book is complete it still names the nearest card so the chart has
   * something to draw. The word must not follow that card to a TAKE: the raid,
   * the paired displacement, the array that displacement left, the middle
   * frame and the window are the sequence, and a card missing one of them is
   * not a trade however high its fit.
   *
   * Only ever downgrades TAKE -> WAIT. STAND is left alone, because a STAND
   * already carries a named failing must and that is the more useful sentence.
   */
  const candGaps = cand ? sequenceGaps(cand) : null;
  const candComplete = candGaps != null && candGaps.length === 0;

  let word: SmcMasterBook["word"] = "STAND";
  if (mustFail) word = "STAND";
  else if (armed && pathOk) word = "TAKE";
  else if (mustWait || !pathOk) word = "WAIT";
  else if (mustPass === mustNeed && pathOk) word = "TAKE";
  if (word === "TAKE" && !candComplete) word = "WAIT";

  const blocker = mustFail ?? (armed ? null : mustWait) ?? null;
  const incompleteLabel =
    word === "WAIT" && !candComplete && candGaps?.length
      ? `Sequence incomplete — no ${candGaps.join(", no ")}`
      : null;
  const missing =
    blocker?.label ??
    incompleteLabel ??
    (!pathOk ? "No A+/A/A− PATH" : armed ? "Armed — limit at CE" : "Sequence complete");
  const missingDetail =
    blocker?.detail ??
    (incompleteLabel && cand
      ? `${cand.symbol} ${cand.side} fit ${cand.confluence.toFixed(2)} is the nearest card on this book, not a complete one. Missing: ${candGaps!.join(", ")}. A higher fit does not replace a missing part of the sequence.`
      : null) ??
    (!pathOk
      ? cand
        ? `${cand.symbol} ${cand.side} grades ${String(cand.pathBand || cand.grade)} Q ${cand.confluence.toFixed(2)} — below the PATH bar`
        : "No candidate on this book"
      : armed && retraceLayer
        // The armed TAKE's instruction IS the retrace detail: the array and
        // the CE price. "All must-layers pass" would hide the fact that the
        // entry is a resting limit, not a market order.
        ? retraceLayer.detail
        : "All must-layers pass");

  return {
    symbol: bias.symbol,
    side,
    word,
    dealing,
    missing,
    missingDetail,
    layers,
    mustPass,
    mustNeed,
    canon,
    entry:
      cand?.entryZone ??
      (fresh
        ? `${fresh.kind.toUpperCase()} ${fresh.bottom.toFixed(2)}–${fresh.top.toFixed(2)}`
        : "await array"),
    // The plan's stop when there is a plan — the prose and the numbers are
    // two views of one derivation, and the handoff reads the prose.
    invalidation: plan ? planStopText(plan) : (cand?.invalidation ?? "Beyond the sweep extreme"),
    /**
     * ITEM 16 — the prose quotes THE PLAN, not the scanner's target string.
     *
     * This read `cand.targets[0]`, which is the nearest in-direction draw level
     * — a different number from the `plan.t1` the target layer directly above
     * graded and the ticket sizes from. The card's own prose could therefore
     * name "EQ 24150.00" while the order rested for a pool 60 points away.
     * The scanner's string is now only the fallback for a book with no plan.
     */
    t1:
      plan?.t1 != null
        ? `${pools.t1?.name ?? plan.draw?.name ?? "draw"} ${plan.t1.toFixed(2)}${plan.rr1 != null ? ` · ${plan.rr1.toFixed(2)}R` : ""}`
        : (cand?.targets[0] ?? (dol ? `${dol.name} ${dol.price.toFixed(2)}` : "IRL")),
    t2:
      plan?.t2 != null
        ? `${pools.t2?.name ?? "external"} ${plan.t2.toFixed(2)}${plan.rr2 != null ? ` · ${plan.rr2.toFixed(2)}R` : ""}`
        : (cand?.targets[1] ?? "ERL runner"),
    pathBand: cand ? String(cand.pathBand || cand.grade) : null,
    // The same plan the target layer graded — one object, so the drawing
    // cannot disagree with the grade.
    plan,
    pools: { ...pools, reliable: draw.baseRateReliable },
    partial,
    candidateComplete: candComplete,
    candidateMissing: candGaps ?? [],
  };
}

export function gradeSmcMaster(desk: SmcMasterInput): SmcMasterRead {
  const smtOn =
    desk.scan.smt.edge !== "none" || Boolean(desk.smtStack?.primary.active);
  const left = gradeBook(
    desk.bias.left,
    desk.draws.left,
    desk.narrative.left,
    desk.scan,
    desk.clock,
    desk.news,
    smtOn,
    desk.smc?.left,
    desk.quotes?.left.price ?? null,
    desk.shockFloorMs ?? null,
    desk.left?.bars,
    desk.left?.minute,
  );
  const right = gradeBook(
    desk.bias.right,
    desk.draws.right,
    desk.narrative.right,
    desk.scan,
    desk.clock,
    desk.news,
    smtOn,
    desk.smc?.right,
    desk.quotes?.right.price ?? null,
    desk.shockFloorMs ?? null,
    desk.right?.bars,
    desk.right?.minute,
  );

  const ranked = [left, right].sort((a, b) => {
    const rank = (w: SmcMasterBook["word"]) =>
      w === "TAKE" ? 2 : w === "WAIT" ? 1 : 0;
    if (rank(a.word) !== rank(b.word)) return rank(b.word) - rank(a.word);
    return b.mustPass - a.mustPass;
  });
  const oneBook = ranked[0] ?? null;

  const vsSchools =
    "ICT narrates; we price DOL. TJR is sweep→5m confirm — we add dealing-range + retrace + one book. Blake IFVG without the raid is B+. Sequence or STAND.";

  const thesis = oneBook
    ? `${oneBook.word} ${oneBook.symbol} ${oneBook.side ?? ""} · ${oneBook.mustPass}/${oneBook.mustNeed} · ${oneBook.missing}`.trim()
    : "STAND — map DOL and wait.";

  return { left, right, oneBook, thesis, vsSchools };
}
