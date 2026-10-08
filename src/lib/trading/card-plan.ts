/**
 * One stop, everywhere.
 *
 * THE BUG THIS CLOSES
 * The desk carried two stops for the same trade. The sequence priced one in
 * trade-plan.ts — beyond the raid wick, or beyond the entry array's far edge
 * — and that is the stop every measurement this month was taken on. The
 * scanner card carried another: a PDL/PDH string. The card, the paper book,
 * the Log dialog, the TradeZella simulator and the Claude handoff all read the
 * STRING. So the paper book was trading a different system from the one the
 * evidence describes, and on 2026-09-25 the Log dialog prefilled 123 MES on a
 * short whose "stop" sat 22 points below the entry.
 *
 * WHAT THIS DOES
 * When the sequence has priced a plan for the same book and side as a card,
 * the plan is attached to the card and the card's `invalidation` becomes the
 * plan's stop. Everything downstream already reads those two fields, so they
 * all move together — nothing needed a second code path.
 *
 * WHAT THIS DOES NOT DO
 * It prices nothing. A card with no plan keeps its structural invalidation
 * (now always on the correct side — scanner.ts protectiveInvalidation), and
 * `cardSizeRefusal` says in words why anything that sizes from it should not.
 */

import type { SetupCandidate } from "./scanner";
import type { SmcMasterRead } from "./smc-master";
import { MAX_RISK_ATR_TRADABLE, MIN_RISK_ATR, type PlanLevel, type TradePlan } from "./trade-plan";
import { riskAtrBucket } from "./evidence";
import { drawTargetsForSide, type DrawRead, type LiquidityTarget } from "./draw";

/**
 * ITEM 16 — ONE PLAN OBJECT, READ BY THE CHART, THE CARD AND THE ORDER.
 *
 * Before this, one trade had three first targets and nothing reconciled them:
 *
 *   `c.targets[0]`   scanner.ts — the NEAREST in-direction draw level, which
 *                    on a trending tape is routinely "EQ 24150.00" (the
 *                    equilibrium of the 80-bar box) or "Midnight open".
 *                    chart-markup.ts:136 draws its TP guide from this string.
 *   `c.plan.t1`      the priced plan — `draw.primary`, the HIGHEST-SCORING
 *                    magnet, a different level whenever score and distance
 *                    disagree. The Robinhood ticket and the room size off it.
 *   `book.t1`        smc-master.ts:713 — `cand.targets[0]` again, so the
 *                    sequence's own "Target priced >= 1:1" line could quote a
 *                    price the plan it graded never used.
 *
 * `DeskLevel[]` is now the single derived list, built once in `cardPlanFrom`
 * and ordered raid -> entry -> stop -> partial -> draw -> runner.
 * `attachPlansToCards` writes `c.targets` and `c.draw` FROM that object, so
 * the three readers above can no longer diverge: the chart guide, the card's
 * target line and the ticket are the same numbers by construction.
 *
 * Nothing here prices anything. Every field is derived from a level the tape
 * printed, exactly as trade-plan.ts does, and a level that cannot be derived
 * is null so the chart draws nothing rather than a guess.
 */
export type DeskLevelKind = "raid" | "entry" | "stop" | "partial" | "draw" | "runner";

export interface DeskLevel {
  kind: DeskLevelKind;
  price: number;
  label: string;
}

/** Fixed draw order, so every renderer lists the plan the same way. */
export const DESK_LEVEL_ORDER: readonly DeskLevelKind[] = [
  "raid",
  "entry",
  "stop",
  "partial",
  "draw",
  "runner",
];

/**
 * A liquidity pool the plan points at, carrying WHY it is liquidity.
 *
 * `kind` is draw.ts's own `RawLevel.kind` ("pool" | "external" | "prior" |
 * "weekly" | "session" | "range" | "open"), kept verbatim so the card can say
 * what class of level a target is instead of just naming it.
 */
export interface DeskPool {
  price: number;
  name: string;
  kind: string;
  swept: boolean;
  /** Excursion rate, NOT the first-passage race. Null below draw.ts's base-rate floor. */
  reachProbability: number | null;
}

/** What a resting order needs, straight off the plan object. */
export interface RestableLevels {
  symbol: string;
  side: "long" | "short";
  entry: number;
  stop: number;
  partial: number | null;
  t1: number | null;
  t2: number | null;
  riskPts: number;
  entryZone: { top: number; bottom: number } | null;
}

/**
 * Kinds that are a LOCATION, never a draw on liquidity (item 1).
 *
 * draw.ts pushes "range" from the 80-bar dealing box (`Range high`, `Range
 * low`, `EQ` — draw.ts:169-173) and "open" from the midnight / 08:30 / 09:30
 * opens (:166-168). None of those is a pool of resting stops: nobody's stop
 * sits at an equilibrium the desk computed from the last twenty hours of
 * bars. smc-master.ts's own comment says so ("The 80-bar window range in
 * structure.ts is a different object — a 20-hour box").
 *
 * They remain in `DrawRead` and still render as context. They may not be T1.
 * `KIND_WEIGHT` in draw.ts is NOT touched — this filters, it does not rescore.
 */
export const LOCATION_KINDS: ReadonlySet<string> = new Set(["range", "open"]);

/** The runner's class: liquidity outside the dealing range. */
export const EXTERNAL_KINDS: ReadonlySet<string> = new Set(["external", "prior", "weekly"]);

/**
 * THE plan object. The card, the chart marks and the Robinhood order all read
 * this and nothing else.
 *
 * Every field added for item 16 is OPTIONAL: `c.plan` is persisted in paper
 * rows and read in ~40 places, so a row written before this change must still
 * load. `levels` is DERIVED in `cardPlanFrom` — never a second source of truth.
 */
export interface CardPlan {
  symbol: string;
  side: "long" | "short";
  entry: number;
  /** The array the limit rests in. */
  entryZone: { top: number; bottom: number } | null;
  stop: number;
  riskPts: number;
  t1: number | null;
  t2: number | null;
  rr1: number | null;
  rr2: number | null;
  /** ATR(14) of the graded series. Null without bars. */
  atr: number | null;
  /** riskPts / atr — the stop band the evidence pack is cut on. */
  riskAtr: number | null;
  riskTooTight: boolean;
  riskTooWide: boolean;
  riskOverCap: boolean;
  /** The raid the stop sits beyond, when there was one. */
  sweep: number | null;
  /** Named draw T1 is, when there is one. */
  drawName: string | null;

  /** The raid wick itself, with its time. The stop sits just beyond this. */
  raid?: { price: number; t: number | null } | null;
  /**
   * The PARTIAL — equilibrium of the IMPULSE LEG (item 1).
   *
   * The leg the displacement made away from the raid has a midpoint, and that
   * is a place to take half off. The equilibrium of the 80-bar box is NOT:
   * different object, different meaning, and it is what used to win T1.
   * Null when the plan has no impulse range behind it.
   */
  partial?: number | null;
  /** What T1 IS — the pool, not a price with no provenance. */
  drawPool?: DeskPool | null;
  /** What T2 IS — external liquidity beyond T1. */
  runnerPool?: DeskPool | null;
  /** Derived, ordered raid -> entry -> stop -> partial -> draw -> runner. */
  levels?: DeskLevel[];
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** A draw level as the plan object carries it. */
export function poolFrom(t: LiquidityTarget | null | undefined, reliable: boolean): DeskPool | null {
  if (!t || !Number.isFinite(t.price)) return null;
  return {
    price: r2(t.price),
    name: t.name,
    kind: t.kind,
    swept: t.swept,
    reachProbability: reliable ? t.reachProbability : null,
  };
}

/**
 * ITEM 1 — WHAT T1 AND T2 ACTUALLY ARE.
 *
 * The draw is the opposing liquidity the raid pointed at. So:
 *
 *   T1  the next UNSWEPT pool in the trade's direction, ahead of the ENTRY
 *       (not merely ahead of price — a level behind CE is not a target).
 *       Locations are excluded outright. Nearest first, because the first
 *       target is the near one; `draw.primary`'s score mixes reach, kind
 *       weight and HTF alignment, which ranks magnets and does not order
 *       them along the path.
 *   T2  the external pool beyond T1 — the runner's class.
 *
 * Swept pools are the FALLBACK, not the pick: price beyond a level has
 * already taken those stops, and draw.ts prices that at 0.4x weight itself.
 * A swept pool is still liquidity, so it is used when nothing unswept sits
 * ahead, and `why` says which case this was.
 *
 * MEASURED COST, STATED NOT HIDDEN: this moves T1 FARTHER on average (a pool
 * sits outside the box whose midpoint used to win). The repo measured "T1 >= 2R
 * filter is WORSE (-0.18R vs -0.105R) — farther first targets are reached less
 * often" (CLAUDE.md Scale row) and M0's strongest reliable effect is farther
 * T1 in R at -12.8 pts per sd (hit-odds). This is a CORRECTNESS fix — a card
 * must not print three first targets, and an equilibrium is not liquidity —
 * and it is expected to cost expectancy. See the stale-headline note on
 * `cardPlanFrom`.
 *
 * Limitation, by construction: `drawTargetsForSide` reads `[primary,
 * ...alternates]` and draw.ts keeps only 5 alternates, so at most 6 levels per
 * side are visible here. A seventh pool cannot be chosen because DrawRead
 * never carried it; that is draw.ts's window, not a rule of this function.
 */
export function drawPoolsForSide(
  draw: Pick<DrawRead, "primary" | "alternates" | "baseRateReliable">,
  side: "long" | "short" | null,
  entry: number | null,
): { t1: LiquidityTarget | null; t2: LiquidityTarget | null; why: string } {
  if (!side) return { t1: null, t2: null, why: "No side — nothing to point at." };
  const all = drawTargetsForSide(draw as DrawRead, side);
  const long = side === "long";
  const ahead = (p: number) =>
    entry == null || !Number.isFinite(entry) ? true : long ? p > entry : p < entry;
  const pools = all.filter((t) => !LOCATION_KINDS.has(t.kind) && ahead(t.price));
  if (!pools.length) {
    const why = all.length
      ? "Every level ahead of the entry is a location (range / open), not liquidity — no target."
      : "No level in the trade's direction — no target.";
    return { t1: null, t2: null, why };
  }

  const unswept = pools.filter((t) => !t.swept);
  const t1 = unswept[0] ?? pools[0]!;
  const beyondT1 = (p: number) => (long ? p > t1.price : p < t1.price);
  const externals = pools.filter((t) => EXTERNAL_KINDS.has(t.kind) && beyondT1(t.price));
  const t2 = externals.find((t) => !t.swept) ?? externals[0] ?? null;

  const why =
    `T1 ${t1.name} ${t1.price.toFixed(2)} — the next ${t1.swept ? "pool (already swept; nothing unswept sits ahead)" : "unswept pool"} ` +
    `in the ${side}'s direction` +
    (t2
      ? ` · T2 ${t2.name} ${t2.price.toFixed(2)}, external liquidity beyond it`
      : " · no external pool beyond T1 — runner unpriced");
  return { t1, t2, why };
}

/**
 * Re-point a priced plan's RUNNER at external liquidity.
 *
 * `buildTradePlan` takes only `range` for T2 and sets `t2` to that range's
 * extreme in the trade's direction — which under `GATE.dealingRange ===
 * "impulse"` is the post-raid impulse extreme, i.e. where price came FROM,
 * and under the window rule is the 80-bar box edge. Neither is a pool.
 *
 * Pure: returns a new plan. `range` is left alone on purpose — the chart
 * still shades premium/discount from it and `plan.range.eq` is still the
 * impulse equilibrium the PARTIAL is taken at.
 *
 * NEEDED IN A FILE THIS AGENT DOES NOT OWN: the clean form of this is a
 * `runner` input on `BuildPlanInput` (trade-plan.ts). Until that lands this
 * corrects the one field after the fact, so the plan object every reader sees
 * carries the pool rather than the box edge.
 */
export function applyRunnerPool(
  plan: TradePlan,
  runner: LiquidityTarget | null | undefined,
): TradePlan {
  if (!runner || !Number.isFinite(runner.price)) return plan;
  const long = plan.side === "long";
  const ref = plan.t1 ?? plan.entry;
  if (long ? !(runner.price > ref) : !(runner.price < ref)) return plan;
  const t2 = r2(runner.price);
  const rr2 = plan.riskPts > 0 ? r2(Math.abs(t2 - plan.entry) / plan.riskPts) : null;
  const levels: PlanLevel[] = [
    ...plan.levels.filter((l) => l.kind !== "t2"),
    { kind: "t2", price: t2, label: `T2 ${runner.name}` },
  ];
  return { ...plan, t2, rr2, levels };
}

/** The stop, in the words a card prints. */
export function planStopText(plan: Pick<TradePlan, "stop" | "sweep">): string {
  return `Stop ${plan.stop.toFixed(2)} — beyond ${
    plan.sweep ? `the raid ${plan.sweep.price.toFixed(2)}` : "the entry array's far edge"
  }`;
}

/**
 * The ordered level list every renderer draws from.
 *
 * DERIVED, and that is the whole point: there is no setter, so a mark on the
 * chart cannot be a different number from the one in the order. A level that
 * was never priced is simply absent — the chart draws nothing rather than a
 * plausible line at a price no code computed.
 */
export function deskLevelsOf(
  p: Pick<CardPlan, "side" | "entry" | "stop" | "t1" | "t2" | "raid" | "partial" | "drawPool" | "runnerPool" | "drawName">,
): DeskLevel[] {
  const out: DeskLevel[] = [];
  const raid = p.raid?.price;
  if (raid != null && Number.isFinite(raid)) out.push({ kind: "raid", price: r2(raid), label: "raid wick" });
  out.push({ kind: "entry", price: r2(p.entry), label: "CE — rest the limit" });
  out.push({ kind: "stop", price: r2(p.stop), label: "stop — beyond the raid" });
  if (p.partial != null && Number.isFinite(p.partial)) {
    out.push({ kind: "partial", price: r2(p.partial), label: "partial — impulse EQ" });
  }
  if (p.t1 != null && Number.isFinite(p.t1)) {
    out.push({ kind: "draw", price: r2(p.t1), label: `T1 ${p.drawPool?.name ?? p.drawName ?? "draw"}` });
  }
  if (p.t2 != null && Number.isFinite(p.t2)) {
    out.push({ kind: "runner", price: r2(p.t2), label: `T2 ${p.runnerPool?.name ?? "external"}` });
  }
  const rank = (k: DeskLevelKind) => DESK_LEVEL_ORDER.indexOf(k);
  return out.sort((a, b) => rank(a.kind) - rank(b.kind));
}

export interface CardPlanExtras {
  /** EQ of the IMPULSE LEG. Never the 80-bar box. */
  partial?: number | null;
  drawPool?: DeskPool | null;
  runnerPool?: DeskPool | null;
}

/**
 * STALE HEADLINE WARNING (item 1 consequence, do not delete this comment).
 *
 * `scripts/capture-signals.mjs` records `t1: book.plan.t1` and
 * `scripts/build-hit-odds.mjs` fits M0 on "T1 distance in R + stop band".
 * Item 1 moves T1 from the highest-scoring magnet (often the 80-bar box EQ,
 * which sits close) to the next unswept pool, which is systematically
 * FARTHER in R. So `src/data/hit-odds-model.json` — and therefore the card's
 * headline P(T1) and its E[R] per fill — is calibrated on a target rule that
 * no longer exists. It will read OPTIMISTIC, because the model's strongest
 * reliable effect is "farther T1 in R, -12.8 pts per sd".
 *
 * The re-fit (`npx tsx scripts/build-hit-odds.mjs`, then
 * `scripts/build-evidence-pack.mjs`) is a LATER wave and was deliberately not
 * run here. Until it runs, the headline probability is stale.
 */
export function cardPlanFrom(plan: TradePlan, extras?: CardPlanExtras): CardPlan {
  const atr = plan.riskAtr != null && plan.riskAtr > 0 ? plan.riskAtr : null;
  const base: CardPlan = {
    symbol: plan.symbol,
    side: plan.side,
    entry: plan.entry,
    entryZone: plan.entryZone,
    stop: plan.stop,
    riskPts: plan.riskPts,
    t1: plan.t1,
    t2: plan.t2,
    rr1: plan.rr1,
    rr2: plan.rr2,
    atr,
    riskAtr: atr ? r2(plan.riskPts / atr) : null,
    riskTooTight: plan.riskTooTight,
    riskTooWide: plan.riskTooWide,
    riskOverCap: plan.riskOverCap,
    sweep: plan.sweep?.price ?? null,
    drawName: extras?.drawPool?.name ?? plan.draw?.name ?? null,
    raid: plan.sweep ? { price: plan.sweep.price, t: plan.sweep.t } : null,
    partial: extras?.partial ?? null,
    drawPool: extras?.drawPool ?? null,
    runnerPool: extras?.runnerPool ?? null,
  };
  return { ...base, levels: deskLevelsOf(base) };
}

/**
 * The card's target strings, written FROM the plan object.
 *
 * THE PRICE LEADS, AND THAT IS NOT A STYLE CHOICE. Four readers parse a target
 * by pulling the FIRST number out of the string — `paper-manager.ts` (which
 * prices a paper fill's TP off it), `simulate-path-trade.ts`, `card-plan.ts`
 * `firstNum` and the handoff. A pool is routinely named "EQH x3" or "PDH +2",
 * so any text with a name — or a bare "T1" — in front of the price hands those
 * parsers a touch count or a 1 as the target price.
 *
 * Caught by `scripts/verify-smc-master.mjs`'s real-engine block, which read
 * `1` off "T1 EQH x3 11804.50" on live four-year tape. Keep the price first.
 */
export function planTargetText(p: CardPlan): string[] {
  const out: string[] = [];
  const pct = (x: number | null | undefined) =>
    x == null ? "" : ` · ${(x * 100).toFixed(0)}% touch`;
  if (p.t1 != null) {
    out.push(
      `${p.t1.toFixed(2)} · T1 ${p.drawPool?.name ?? p.drawName ?? "draw"}${
        p.rr1 != null ? ` · ${p.rr1.toFixed(2)}R` : ""
      }${pct(p.drawPool?.reachProbability)}`,
    );
  }
  if (p.t2 != null) {
    out.push(
      `${p.t2.toFixed(2)} · T2 ${p.runnerPool?.name ?? "external"}${
        p.rr2 != null ? ` · ${p.rr2.toFixed(2)}R` : ""
      }${pct(p.runnerPool?.reachProbability)}`,
    );
  }
  if (p.partial != null) out.push(`${p.partial.toFixed(2)} · partial at the impulse EQ`);
  return out;
}

/**
 * Attach each book's priced plan to the card it was priced for.
 *
 * Mutates the candidates in place — the scan object is shared by reference
 * through the payload, and every reader of `c.invalidation` should see the
 * plan's stop without being taught a new field. Returns how many attached.
 *
 * `atrBySymbol` stamps ATR on EVERY card, planned or not, so a card whose stop
 * is structural can still be measured against the band.
 *
 * SIDE EFFECTS, WIDENED BY ITEM 16 — this used to write `invalidation` +
 * `plan`; it now also writes `targets` and `draw`, FROM the same plan object.
 *
 * HARD ORDERING CONTRACT: this must run AFTER `scanSetups` (build-desk.ts:670)
 * and after `gradeSmcMaster` (:1054), because it deliberately overwrites the
 * target strings the scanner wrote. Move or re-run the scanner's target block
 * later in the pipeline and the overwrite is silently discarded and the
 * three-first-targets bug returns. `scripts/verify-card-plan.mjs` asserts
 * `firstNum(c.targets[0]) === c.plan.t1` for exactly this reason.
 */
export function attachPlansToCards(
  cands: SetupCandidate[],
  master: Pick<SmcMasterRead, "left" | "right">,
  atrBySymbol?: Record<string, number | null | undefined>,
): number {
  let attached = 0;
  for (const c of cands) {
    const atr = atrBySymbol?.[c.symbol];
    if (atr != null && Number.isFinite(atr) && atr > 0) c.atr = atr;
    const book = [master.left, master.right].find(
      (b) => b && b.symbol === c.symbol && b.side === c.side && b.plan,
    );
    if (!book?.plan) continue;
    const reliable = book.pools?.reliable ?? false;
    c.plan = cardPlanFrom(book.plan, {
      partial: book.partial ?? null,
      drawPool: poolFrom(book.pools?.t1, reliable),
      runnerPool: poolFrom(book.pools?.t2, reliable),
    });
    if (c.plan.atr == null && c.atr) {
      c.plan.atr = c.atr;
      c.plan.riskAtr = r2(c.plan.riskPts / c.atr);
    }
    c.invalidation = planStopText(book.plan);
    c.stopSource = "plan";
    // The card's targets and its draw are now VIEWS of the plan, so the chart
    // guide (chart-markup.ts), the board line and the ticket read one number.
    const text = planTargetText(c.plan);
    if (text.length) c.targets = text;
    if (book.pools?.t1) c.draw = book.pools.t1;
    attached++;
  }
  return attached;
}

/**
 * What `restLimit` needs from a card: the plan's own numbers, or null when
 * the card has no priced plan (nothing to rest — a structural invalidation
 * is not a stop the evidence measured).
 */
export function restableFromCard(c: Pick<SetupCandidate, "plan">): RestableLevels | null {
  const p = c.plan;
  if (!p) return null;
  return {
    symbol: p.symbol,
    side: p.side,
    entry: p.entry,
    stop: p.stop,
    partial: p.partial ?? null,
    t1: p.t1,
    t2: p.t2,
    riskPts: p.riskPts,
    entryZone: p.entryZone,
  };
}

/**
 * A card carrying a RESTING ORDER's levels instead of its current plan.
 *
 * The fill books what the order promised — its limit, stop and targets — even
 * if the card has been re-graded since the order rested. Band flags are
 * recomputed against the card's ATR so a fill can never dodge the refusal.
 */
export function withOrderLevels<C extends SetupCandidate>(
  c: C,
  o: { symbol: string; side: "long" | "short"; limit: number; stop: number; t1: number | null; t2: number | null; riskPts: number; zone: { top: number; bottom: number } | null },
): C {
  const atr = c.plan?.atr ?? c.atr ?? null;
  const riskAtr = atr && atr > 0 ? r2(o.riskPts / atr) : null;
  const plan: CardPlan = {
    symbol: o.symbol,
    side: o.side,
    entry: o.limit,
    entryZone: o.zone,
    stop: o.stop,
    riskPts: o.riskPts,
    t1: o.t1,
    t2: o.t2,
    rr1: o.t1 != null ? r2(Math.abs(o.t1 - o.limit) / o.riskPts) : null,
    rr2: o.t2 != null ? r2(Math.abs(o.t2 - o.limit) / o.riskPts) : null,
    atr,
    riskAtr,
    riskTooTight: riskAtr != null && riskAtr < MIN_RISK_ATR,
    riskTooWide: riskAtr != null && riskAtr > MAX_RISK_ATR_TRADABLE,
    riskOverCap: c.plan?.riskOverCap ?? false,
    sweep: c.plan?.sweep ?? null,
    drawName: c.plan?.drawName ?? null,
    // The RAID and the pool provenance belong to the card's read, not to the
    // order's levels — the order promised a limit, a stop and two targets, and
    // those are the four numbers above. The partial is deliberately dropped:
    // a resting order never promised one.
    raid: c.plan?.raid ?? null,
    partial: null,
    drawPool: c.plan?.drawPool ?? null,
    runnerPool: c.plan?.runnerPool ?? null,
  };
  return {
    ...c,
    plan: { ...plan, levels: deskLevelsOf(plan) },
    stopSource: "plan",
    invalidation: `Stop ${o.stop.toFixed(2)} — the resting order's stop`,
  };
}

/** Parse the first price out of a level string ("Above PDH 7783.50 / sweep"). */
export function firstNum(s: string | undefined | null): number | null {
  if (!s) return null;
  const m = s.replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
  const n = m ? Number(m[0]) : NaN;
  return Number.isFinite(n) ? n : null;
}

export interface CardRisk {
  entry: number | null;
  stop: number | null;
  riskPts: number | null;
  riskAtr: number | null;
  source: "plan" | "structure" | "none";
}

/** The card's risk geometry, from the plan when there is one. */
export function cardRisk(
  c: Pick<SetupCandidate, "plan" | "stopSource" | "entryPx" | "invalidation" | "atr" | "side">,
): CardRisk {
  if (c.plan) {
    return {
      entry: c.plan.entry,
      stop: c.plan.stop,
      riskPts: c.plan.riskPts,
      riskAtr: c.plan.riskAtr,
      source: "plan",
    };
  }
  const entry = c.entryPx ?? null;
  const stop = c.stopSource === "none" ? null : firstNum(c.invalidation);
  if (entry == null || stop == null) {
    return { entry, stop, riskPts: null, riskAtr: null, source: c.stopSource ?? "none" };
  }
  const inverted = c.side === "long" ? stop >= entry : stop <= entry;
  const riskPts = inverted ? null : Math.abs(entry - stop);
  return {
    entry,
    stop: inverted ? null : stop,
    riskPts,
    riskAtr: riskPts != null && c.atr ? r2(riskPts / c.atr) : null,
    source: inverted ? "none" : "structure",
  };
}

const signedR = (x: number | null | undefined) =>
  x == null ? "" : ` — measured ${x >= 0 ? "+" : "−"}${Math.abs(x).toFixed(2)}R/card`;

/**
 * Why anything that SIZES from this card should refuse — or null.
 *
 * Same conditions, same words, wherever a size is produced: the entry ticket,
 * the paper book, the Log dialog. The measured cost is read from the evidence
 * pack, so a re-measure moves every message at once instead of leaving a
 * number frozen in a string literal.
 */
export function cardSizeRefusal(
  c: Pick<SetupCandidate, "plan" | "stopSource" | "entryPx" | "invalidation" | "atr" | "side">,
): string | null {
  const risk = cardRisk(c);
  // A stop wider than the cap is repriced off the sweep in buildPaperLevels.
  // It is not a stand-down. A stop inside the 0.5×ATR floor still is.
  if (c.plan?.riskOverCap) return null;
  if (risk.source === "none" && c.plan) return null;
  if (risk.stop == null || risk.riskPts == null) {
    return c.stopSource === "none" || risk.source === "none"
      ? "No stop on the correct side of the entry — nothing to size from"
      : "No numeric stop on this card — nothing to size from";
  }
  if (!(risk.riskPts > 0)) return "Zero-width stop — nothing to size from";
  if (risk.riskAtr != null && risk.riskAtr < MIN_RISK_ATR) {
    return `Stop is ${risk.riskAtr.toFixed(2)}×ATR, inside the ${MIN_RISK_ATR}×ATR floor${signedR(riskAtrBucket(risk.riskAtr)?.exp)}`;
  }
  if (risk.riskAtr != null && risk.riskAtr > MAX_RISK_ATR_TRADABLE && !c.plan?.riskOverCap) {
    return `Stop is ${risk.riskAtr.toFixed(2)}×ATR, beyond the ${MAX_RISK_ATR_TRADABLE}×ATR band${signedR(riskAtrBucket(risk.riskAtr)?.exp)}`;
  }
  return null;
}
