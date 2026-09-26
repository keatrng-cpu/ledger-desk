/**
 * Place it — the replay execution drill.
 *
 * WHAT THE OTHER THREE RINGS NEVER ASK
 * Rings 1-3 ask for a word and a missing layer. The trader's measured weakness
 * is not the word — the first live record called direction 4 for 4 — it is
 * COMPLETING THE ENTRY: resting the limit where the plan named it, putting the
 * stop beyond the raid instead of where it feels comfortable, pricing a target
 * before the click, and not paying the print when price is walking away. A
 * drill that never asks for a price cannot train any of that, so this one asks
 * for the whole order and scores it line by line.
 *
 * PROCESS AND OUTCOME ARE SCORED APART, AND NEVER FOLDED INTO ONE NUMBER
 * Every line of `scoreProcess` is a rule the desk already enforces somewhere
 * else, cited where it lives. Each is pass / fail / not-applicable with a
 * one-line reason. The OUTCOME — the R the trader's own levels made on the
 * hidden bars, beside the R the desk's plan made — is computed under the rule
 * as coded and reported separately, with the sentence that one outcome is
 * noise. A composite would let a lucky runner pay for a stop placed inside the
 * wick, which is exactly the lesson a drill must not teach. So there is no
 * score, no streak and no badge anywhere in this file: gamified feedback
 * measurably raises trading frequency, and overtrading is the failure the
 * whole desk is built to refuse.
 *
 * WHY THE CARD ALONE IS NOT WHAT IS BEING TRAINED
 * The four-year evidence pack says every card at or above the floor, taken as
 * coded, lost about 0.14R, and a stop inside the band is roughly breakeven —
 * the band's value is the losses it refuses. So a correct placement here is
 * not a promise of money. The drill trains EXECUTION OF THE RULE, the part the
 * trader controls, and `evidenceHeadlines()` says the rest out loud.
 *
 * THE RULE AS CODED — one simulator, the same one the evidence pack runs
 * (scripts/build-evidence-pack.mjs `sim`, ported line for line):
 *   a limit rests at the entry and must fill within FILL_BARS closed bars
 *   AFTER the decision bar (the walk starts at decision+1 — no lookahead);
 *   a market ("chase") order fills at the next bar's open; the stop exits with
 *   one tick of slip; T1 must sit ahead of the entry; 50% off at T1, stop to
 *   exact breakeven, runner to T2 (all at T1 when there is no T2 beyond it); a
 *   bar that touches the stop and a target together is a STOP; the fill bar
 *   can stop out but can never also score T1; anything still open HOLD_BARS
 *   bars after the fill closes at that bar's close. A limit that never fills is
 *   0R and is reported as "no fill", never as a loss.
 *
 * PURE. No React, no storage, no clock. The component owns localStorage and
 * hands this module strings; `parseStore` / `recordAttempt` are the only
 * persistence logic and they are plain functions of their input.
 */

import { APLUS_RULES, CONTRACTS } from "@/lib/aplus/config";
import { MAX_RISK_ATR_TRADABLE, MIN_RISK_ATR, type TradePlan } from "@/lib/trading/trade-plan";
import { FILL_WINDOW_BARS, MAX_HOLD_BARS } from "@/lib/trading/shadow-book";
import { readEntry, TIER_ARMED_ATR } from "@/lib/trading/entry-trigger";
import { riskAtrBucket } from "@/lib/trading/evidence";

/* ── The rule as coded ───────────────────────────────────────────────────── */

/** A limit must fill within this many closed bars after the decision (3h on 15m). */
export const FILL_BARS = FILL_WINDOW_BARS;
/** Bars an open trade is held from the fill before it is closed at the close. */
export const HOLD_BARS = MAX_HOLD_BARS;
/** Share banked at T1 — APLUS_RULES.scaleOut.tp1Fraction. */
export const TP1_FRACTION = APLUS_RULES.scaleOut.tp1Fraction;

/** Closed 15m bars the trader sees, the decision bar last. */
export const PAST_BARS = 64;
/**
 * Bars stored AFTER the decision bar — the hidden future.
 *
 * Not a round number on purpose: the rule reaches exactly this far and no
 * further. The latest possible fill is the FILL_BARS-th bar after the
 * decision, and a trade filled there is held HOLD_BARS bars counting the fill
 * bar, so the last bar the rule can ever read is decision + FILL_BARS +
 * HOLD_BARS − 1. A shorter window would close late fills early and quietly
 * change the rule it claims to replay.
 */
export const FUTURE_BARS = FILL_BARS + HOLD_BARS - 1;
/** Index of the decision bar inside a case's `bars`. */
export const DECISION = PAST_BARS - 1;
/** Learning curves and the "fails most" line read this many recent attempts. */
export const CURVE_WINDOW = 20;
/**
 * Every REPEAT_EVERY-th pick is a repetition pick: a case that exercises the
 * rule failed most recently. Alternating, rather than always, so the weak rule
 * comes back often without draining its cases in one sitting.
 */
export const REPEAT_EVERY = 2;

const EPS = 1e-9;

/* ── Shapes ──────────────────────────────────────────────────────────────── */

export type Side = "long" | "short";
export type Word = "TAKE" | "WAIT" | "STAND";
export type OrderType = "limit" | "market";

/** [minutes since the case's t0, open, high, low, close] — prices at 2dp. */
export type DrillBar = [number, number, number, number, number];

export type ExitKind = "stop" | "be" | "t1" | "t2" | "time";

/** What the desk's own plan did, stored at build time and re-simulated by the verifier. */
export type DeskRecord =
  | { kind: "filled"; R: number; exit: ExitKind; fill: number; out: number; t1: boolean }
  | { kind: "no-fill" }
  | { kind: "invalid"; note: string };

export interface DrillCase {
  /** `${sym}-${i}-${L|S}` — stable across rebuilds of the same capture. */
  id: string;
  sym: "MNQ" | "ES";
  side: Side;
  /** src/data/history-4y.json index of the decision bar (the capture's `i`). */
  i: number;
  /** Decision bar open time, epoch ms — the capture's `t`. */
  t: number;
  /** Open time of bars[0]; bar k opened at t0 + bars[k][0] minutes. */
  t0: number;
  /** The desk's word at the decision bar, as captured. */
  word: Word;
  /** Must-layer ids that FAILED / were WAITING, in the sequence's order. */
  fail: string[];
  wait: string[];
  /** Confluence (Q) and the PATH band string the scanner printed. */
  conf: number;
  band: string;
  /** Killzone id at the decision bar, and its ET wall clock. */
  kz: string;
  etH: number;
  etM: number;
  wd: number;
  /** ATR(14) at the decision bar, as the capture measured it. */
  atr: number;
  /** Close of the decision bar — the print a market order would be paying. */
  px: number;
  /** The desk's plan: CE, stop, T1 (the draw), T2 (the range extreme). */
  e: number;
  s: number;
  t1: number | null;
  t2: number | null;
  /** The entry array [bottom, top], re-derived by re-running the desk. */
  zone: [number, number] | null;
  /** The raid's wick extreme, re-derived the same way. Null = no raid. */
  raid: number | null;
  /** The draw's name ("PDH (external BSL)"). */
  draw: string | null;
  /** Dealing range [low, eq, high]. */
  range: [number, number, number] | null;
  /** The desk's own one-line reason for the blocker, when the re-run agreed. */
  why: string | null;
  bars: DrillBar[];
  desk: DeskRecord;
}

export interface DrillFile {
  builtAt: string;
  source: Record<string, string>;
  rules: {
    fillBars: number;
    holdBars: number;
    tp1Fraction: number;
    pastBars: number;
    futureBars: number;
    tick: number;
  };
  selection: Record<string, unknown>;
  cases: DrillCase[];
}

/* ── Vocabulary ──────────────────────────────────────────────────────────── */

/**
 * The blockers a trader can name, in the order the sequence reads them.
 *
 * Ids are the capture's layer ids and labels are the strings smc-master.ts
 * prints in `missing` — a drill that scored a different vocabulary than the
 * Now tab would train a desk that does not exist. The verifier checks every
 * engine label against the engine's source text. Two entries are not
 * must-layers and say so: the PATH grade, and the ticket's stop-band refusal.
 */
export const BLOCKERS = [
  { id: "dol", label: "Draw on liquidity" },
  { id: "htf", label: "HTF bias + DOL" },
  { id: "sweep", label: "Liquidity sweep" },
  { id: "pd_half", label: "POI in correct half" },
  { id: "ltf", label: "LTF shift + displacement" },
  { id: "time", label: "Kill zone" },
  { id: "target", label: "Target priced ≥ 1:1" },
  { id: "retrace", label: "Retrace into array" },
  { id: "clean", label: "Judas / news" },
  { id: "path", label: "No A+/A/A− PATH" },
  { id: "band", label: `Stop outside ${MIN_RISK_ATR}–${MAX_RISK_ATR_TRADABLE}×ATR — ticket refuses` },
] as const;
export type BlockerId = (typeof BLOCKERS)[number]["id"];

export function blockerLabel(id: string | null | undefined): string {
  if (!id) return "Sequence complete";
  return BLOCKERS.find((b) => b.id === id)?.label ?? id;
}

export type RuleId = "word" | "layer" | "limit-ce" | "no-chase" | "stop-side" | "stop-beyond" | "stop-band" | "t1";

/** The process checklist, in the order a ticket is filled in. */
export const RULES: { id: RuleId; label: string; cite: string }[] = [
  {
    id: "word",
    label: "Word",
    cite: "smc-master.ts — TAKE only when every must-layer passes and PATH is A+/A/A−; entry-ticket.ts refuses to size a stop outside the band",
  },
  {
    id: "layer",
    label: "Blocker named",
    cite: "smc-master.ts `missing` — the first must-layer not passing (a FAIL outranks a WAIT)",
  },
  {
    id: "limit-ce",
    label: "Limit at CE",
    cite: "CLAUDE.md Entry — rest the limit at CE, never pay the print",
  },
  {
    id: "no-chase",
    label: "No chase",
    cite: `entry-trigger.ts — more than ${TIER_ARMED_ATR} ATR from the array is FORMING: look away, the alarm calls you`,
  },
  {
    id: "stop-side",
    label: "Stop side",
    cite: "card-plan.ts — a stop on the wrong side of the entry is not a stop",
  },
  {
    id: "stop-beyond",
    label: "Stop beyond raid",
    cite: "trade-plan.ts — beyond the raid wick; without a raid, beyond the array's far edge",
  },
  {
    id: "stop-band",
    label: `Stop ${MIN_RISK_ATR}–${MAX_RISK_ATR_TRADABLE} ATR`,
    cite: "trade-plan.ts MIN_RISK_ATR / MAX_RISK_ATR_TRADABLE — outside the band loses in both halves and the ticket refuses",
  },
  {
    id: "t1",
    label: `T1 ≥ ${APLUS_RULES.minRr}R`,
    cite: "APLUS_RULES.minRr — T1 ahead of the entry and at least 1R, or there is no trade",
  },
];

export function ruleLabel(id: RuleId): string {
  return RULES.find((r) => r.id === id)?.label ?? id;
}

/* ── The trader's call ───────────────────────────────────────────────────── */

export interface OrderInput {
  type: OrderType;
  /** Limit price. Null for a market order. */
  limit: number | null;
  stop: number;
  t1: number;
  t2: number | null;
}

export interface DrillCall {
  word: Word;
  /** Blocker named on a WAIT / STAND. */
  layer: BlockerId | null;
  /** The order, only on TAKE. */
  order: OrderInput | null;
}

export type ItemStatus = "pass" | "fail" | "na";

export interface ProcessItem {
  id: RuleId;
  status: ItemStatus;
  reason: string;
}

/* ── Helpers ─────────────────────────────────────────────────────────────── */

export function tickOf(sym: string): number {
  return (CONTRACTS as Record<string, { tick: number }>)[sym]?.tick ?? 0.25;
}

const f2 = (n: number) => n.toFixed(2);
const fr = (n: number) => `${n >= 0 ? "+" : "−"}${Math.abs(n).toFixed(2)}R`;

/** A case's bars as objects, for the simulator. */
export function caseBars(c: Pick<DrillCase, "bars">): SimBar[] {
  return c.bars.map(([, o, h, l, cl]) => ({ o, h, l, c: cl }));
}

/** Epoch ms a case bar opened at. */
export function barTime(c: Pick<DrillCase, "t0" | "bars">, k: number): number {
  const b = c.bars[k];
  return b ? c.t0 + b[0] * 60_000 : c.t0;
}

/**
 * The level the stop has to sit beyond: the raid wick if it is the further of
 * the two, else the array's far edge — trade-plan.ts's own derivation, without
 * its pad. Null only when neither could be re-derived.
 */
export function invalidationExtreme(
  c: Pick<DrillCase, "side" | "zone" | "raid">,
): { price: number; what: "raid" | "array edge" } | null {
  const long = c.side === "long";
  const edge = c.zone ? (long ? c.zone[0] : c.zone[1]) : null;
  if (c.raid == null && edge == null) return null;
  if (c.raid == null) return { price: edge!, what: "array edge" };
  if (edge == null) return { price: c.raid, what: "raid" };
  const raidFurther = long ? c.raid <= edge : c.raid >= edge;
  return raidFurther ? { price: c.raid, what: "raid" } : { price: edge, what: "array edge" };
}

/**
 * Can this plan be placed inside the rules at all?
 *
 * The tightest legal stop is one tick beyond the invalidation extreme, pushed
 * out to the 0.5 ATR floor if that is tighter, on the tick grid. If even that
 * stop is wider than the 1.5 ATR ceiling, or it leaves the desk's T1 under
 * 1R, no placement satisfies every rule — which is exactly the plan the entry
 * ticket answers with DO NOT SIZE.
 */
export function placeable(
  c: Pick<DrillCase, "sym" | "side" | "zone" | "raid" | "e" | "atr" | "t1">,
): { ok: boolean; stop: number | null; why: string } {
  const x = invalidationExtreme(c);
  if (!x || !(c.atr > 0)) return { ok: false, stop: null, why: "the raid and array could not be derived" };
  const tick = tickOf(c.sym);
  const long = c.side === "long";
  const beyond = long ? x.price - tick : x.price + tick;
  const floor = long ? c.e - MIN_RISK_ATR * c.atr : c.e + MIN_RISK_ATR * c.atr;
  const raw = long ? Math.min(beyond, floor) : Math.max(beyond, floor);
  const stop = long ? Math.floor(raw / tick + EPS) * tick : Math.ceil(raw / tick - EPS) * tick;
  const risk = Math.abs(c.e - stop);
  const ratio = risk / c.atr;
  if (risk > MAX_RISK_ATR_TRADABLE * c.atr + EPS) {
    return {
      ok: false,
      stop,
      why: `the tightest stop beyond the ${x.what} (${f2(stop)}) is ${ratio.toFixed(2)}×ATR — past the ${MAX_RISK_ATR_TRADABLE}×ATR band`,
    };
  }
  if (c.t1 == null || Math.abs(c.t1 - c.e) < APLUS_RULES.minRr * risk - EPS) {
    return {
      ok: false,
      stop,
      why: `a stop the band allows (${f2(stop)}) leaves T1 under ${APLUS_RULES.minRr}R`,
    };
  }
  return { ok: true, stop, why: `a stop at ${f2(stop)} is beyond the ${x.what} and ${ratio.toFixed(2)}×ATR` };
}

/**
 * The answer the drill scores against.
 *
 * A WAIT or STAND is the captured word, and its blocker is the first must-layer
 * that was not passing — a FAIL outranks a WAIT, exactly as smc-master picks
 * `missing`; with nothing failing or waiting the word was the PATH grade.
 *
 * A captured TAKE is the answer only when the plan can be placed inside the
 * band. The capture predates the band, and today's desk prints DO NOT SIZE on
 * a plan it cannot place (entry-ticket.ts) — a drill that marked the trader
 * wrong for refusing that ticket would train the one habit the band exists to
 * remove. So an unplaceable TAKE is scored as STAND, blocker `band`, and the
 * reveal says the sequence printed TAKE.
 */
export function expectedAction(
  c: Pick<DrillCase, "sym" | "side" | "zone" | "raid" | "e" | "atr" | "t1" | "word" | "fail" | "wait">,
): { word: Word; blocker: BlockerId | null; note: string } {
  if (c.word === "TAKE") {
    const p = placeable(c);
    return p.ok
      ? { word: "TAKE", blocker: null, note: `every must-layer passed, and ${p.why}` }
      : {
          word: "STAND",
          blocker: "band",
          note: `the sequence printed TAKE, but ${p.why} — the entry ticket prints DO NOT SIZE`,
        };
  }
  const id = (c.fail[0] ?? c.wait[0] ?? "path") as BlockerId;
  return { word: c.word, blocker: id, note: `the first layer not passing was ${blockerLabel(id)}` };
}

/* ── The process checklist ───────────────────────────────────────────────── */

function entryRef(c: Pick<DrillCase, "px">, o: OrderInput): number {
  return o.type === "limit" && o.limit != null ? o.limit : c.px;
}

/**
 * Score the call, item by item. Pure: the same case and call always produce
 * the same list, so an attempt stored months ago re-reads identically.
 */
export function scoreProcess(c: DrillCase, call: DrillCall): ProcessItem[] {
  const exp = expectedAction(c);
  const long = c.side === "long";
  const tick = tickOf(c.sym);
  const items: ProcessItem[] = [];
  const push = (id: RuleId, status: ItemStatus, reason: string) => items.push({ id, status, reason });

  // 1. The word.
  if (call.word === exp.word) {
    push("word", "pass", `${exp.word} — ${exp.note}.`);
  } else {
    push("word", "fail", `You said ${call.word}; the desk's answer was ${exp.word} — ${exp.note}.`);
  }

  // 2. The blocker, on a WAIT / STAND.
  if (exp.word === "TAKE") {
    push("layer", "na", "The desk had no blocker to name.");
  } else if (call.word === "TAKE") {
    push("layer", "fail", `You placed an order; the blocker to name was ${blockerLabel(exp.blocker)}.`);
  } else if (call.layer === exp.blocker) {
    push("layer", "pass", `${blockerLabel(exp.blocker)} — the first layer the desk found not passing.`);
  } else {
    push(
      "layer",
      "fail",
      `You named ${call.layer ? blockerLabel(call.layer) : "nothing"}; the desk's first non-passing layer was ${blockerLabel(exp.blocker)}.`,
    );
  }

  const o = call.word === "TAKE" ? call.order : null;
  if (!o) {
    const why = "No order placed.";
    for (const id of ["limit-ce", "no-chase", "stop-side", "stop-beyond", "stop-band", "t1"] as RuleId[]) {
      push(id, "na", why);
    }
    return items;
  }

  // 3. The entry rests at CE.
  if (o.type === "market") {
    push("limit-ce", "fail", `Market order — the entry rule is a limit resting at CE ${f2(c.e)}.`);
  } else if (o.limit == null || !Number.isFinite(o.limit)) {
    push("limit-ce", "fail", "No limit price.");
  } else {
    const d = Math.abs(o.limit - c.e);
    push(
      "limit-ce",
      d <= tick + EPS ? "pass" : "fail",
      d <= tick + EPS
        ? `Limit ${f2(o.limit)} is ${f2(d)}pt from CE ${f2(c.e)} — inside one tick.`
        : `Limit ${f2(o.limit)} is ${f2(d)}pt from CE ${f2(c.e)} — the rule is CE, within one tick (${tick}).`,
    );
  }

  // 4. Do not pay the print. Read with the desk's own tier (entry-trigger.ts),
  //    so "far" means what the alarm means by it — distance to the array's
  //    NEAR edge, and a plan price has already gone past is spent, not near.
  if (o.type === "limit") {
    push("no-chase", "na", "Resting limit — nothing paid at the print.");
  } else {
    const plan = c.zone
      ? ({ side: c.side, entry: c.e, stop: c.s, entryZone: { bottom: c.zone[0], top: c.zone[1] } } as unknown as TradePlan)
      : null;
    const read = plan ? readEntry(plan, c.px, c.atr) : null;
    const away = read?.awayAtr ?? Math.abs(c.px - c.e) / c.atr;
    const ok = read ? !read.behind && away <= TIER_ARMED_ATR + EPS : away <= TIER_ARMED_ATR + EPS;
    push(
      "no-chase",
      ok ? "pass" : "fail",
      ok
        ? `Price was ${away.toFixed(2)} ATR from the array — inside the ${TIER_ARMED_ATR} ATR the rule allows.`
        : read?.behind
          ? `Price ${f2(c.px)} was already past CE on the stop side — the plan was spent, not an entry.`
          : `Market order with price ${away.toFixed(2)} ATR from the array — FORMING: look away, the alarm calls you.`,
    );
  }

  // 5. The stop is on the protective side of the entry.
  const ref = entryRef(c, o);
  const sideOk = long ? o.stop < ref : o.stop > ref;
  push(
    "stop-side",
    sideOk ? "pass" : "fail",
    sideOk
      ? `Stop ${f2(o.stop)} is ${long ? "below" : "above"} the entry ${f2(ref)}.`
      : `A ${c.side}'s stop must sit ${long ? "below" : "above"} its entry — ${f2(o.stop)} vs ${f2(ref)} is not a stop.`,
  );

  // 6. Beyond the raid wick (or the array's far edge).
  const x = invalidationExtreme(c);
  if (!x) {
    push("stop-beyond", "na", "The raid and the array could not be re-derived for this case.");
  } else {
    const beyond = long ? o.stop < x.price - EPS : o.stop > x.price + EPS;
    push(
      "stop-beyond",
      beyond ? "pass" : "fail",
      beyond
        ? `Stop ${f2(o.stop)} is ${f2(Math.abs(o.stop - x.price))}pt beyond the ${x.what} ${f2(x.price)}.`
        : `Stop ${f2(o.stop)} sits inside the ${x.what} ${f2(x.price)} — the market already showed it trades there.`,
    );
  }

  // 7. Inside the measured band.
  const risk = Math.abs(ref - o.stop);
  const ratio = c.atr > 0 ? risk / c.atr : Infinity;
  if (!sideOk) {
    push("stop-band", "fail", "No risk to measure — the stop is on the wrong side.");
  } else {
    const tight = risk < MIN_RISK_ATR * c.atr - EPS;
    const wide = risk > MAX_RISK_ATR_TRADABLE * c.atr + EPS;
    const b = riskAtrBucket(ratio);
    const cost = b?.exp != null ? ` — measured ${fr(b.exp)}/card over ${b.n}${b.verdict === "negative" ? ", losing in both halves" : ""}` : "";
    push(
      "stop-band",
      tight || wide ? "fail" : "pass",
      tight
        ? `Risk ${f2(risk)}pt is ${ratio.toFixed(2)}×ATR — under the ${MIN_RISK_ATR}×ATR floor${cost}.`
        : wide
          ? `Risk ${f2(risk)}pt is ${ratio.toFixed(2)}×ATR — beyond the ${MAX_RISK_ATR_TRADABLE}×ATR band${cost}.`
          : `Risk ${f2(risk)}pt is ${ratio.toFixed(2)}×ATR — inside the band.`,
    );
  }

  // 8. T1 ahead and at least minRr.
  const ahead = long ? o.t1 > ref : o.t1 < ref;
  if (!ahead) {
    push("t1", "fail", `T1 ${f2(o.t1)} is not ahead of the entry ${f2(ref)} — no target, no trade.`);
  } else if (!sideOk || !(risk > 0)) {
    push("t1", "fail", "T1 cannot be priced in R without a stop on the correct side.");
  } else {
    const rr = Math.abs(o.t1 - ref) / risk;
    push(
      "t1",
      rr >= APLUS_RULES.minRr - EPS ? "pass" : "fail",
      rr >= APLUS_RULES.minRr - EPS
        ? `T1 ${f2(o.t1)} is ${rr.toFixed(2)}R.`
        : `T1 ${f2(o.t1)} is ${rr.toFixed(2)}R — under the ${APLUS_RULES.minRr}R floor: no target, no trade.`,
    );
  }
  return items;
}

/* ── The simulator ───────────────────────────────────────────────────────── */

export interface SimBar {
  o: number;
  h: number;
  l: number;
  c: number;
}

export interface SimOrder {
  side: Side;
  type: OrderType;
  /** Limit price; ignored for a market order, which fills at the next open. */
  entry: number | null;
  stop: number;
  t1: number | null;
  t2: number | null;
  tick: number;
}

export type SimResult =
  | {
      kind: "filled";
      R: number;
      exit: ExitKind;
      /** Bar indices of the fill and of the final exit. */
      fill: number;
      out: number;
      /** Fill price, and the price the LAST piece left at (slip included). */
      entry: number;
      exitPx: number;
      t1: boolean;
    }
  | { kind: "no-fill" }
  | { kind: "invalid"; note: string };

/**
 * The rule as coded, bar by bar. `decision` is the index of the decision bar;
 * nothing at or before it is read after the fill search starts at decision+1.
 */
export function simulateOrder(bars: SimBar[], decision: number, o: SimOrder): SimResult {
  const long = o.side === "long";
  let fi: number | null = null;
  let E: number;
  if (o.type === "market") {
    const next = bars[decision + 1];
    if (!next) return { kind: "invalid", note: "No bar after the decision to fill on." };
    fi = decision + 1;
    E = next.o;
  } else {
    if (o.entry == null || !Number.isFinite(o.entry)) return { kind: "invalid", note: "No limit price." };
    E = o.entry;
  }
  // Geometry the rule refuses before any bar is read. A stop on the wrong side
  // of the fill cannot be placed at a broker at all; for a market order that
  // happens when the next bar opens through it.
  if (!Number.isFinite(o.stop) || (long ? !(o.stop < E) : !(o.stop > E))) {
    return {
      kind: "invalid",
      note:
        o.type === "market"
          ? `The next bar opened at ${f2(E)}, through the stop ${f2(o.stop)} — the stop could not be placed.`
          : `Stop ${f2(o.stop)} is on the wrong side of the entry ${f2(E)} — a broker would refuse it.`,
    };
  }
  if (o.t1 == null || !Number.isFinite(o.t1) || (long ? o.t1 <= E : o.t1 >= E)) {
    return { kind: "invalid", note: "T1 is not ahead of the entry — not a trade under the rule." };
  }
  const t1 = o.t1;
  const risk = Math.abs(E - o.stop);
  const t2 = o.t2 != null && Number.isFinite(o.t2) && (long ? o.t2 > t1 : o.t2 < t1) ? o.t2 : null;

  if (o.type === "limit") {
    for (let k = 1; k <= FILL_BARS && decision + k < bars.length; k++) {
      const b = bars[decision + k]!;
      if (long ? b.l <= E : b.h >= E) {
        fi = decision + k;
        break;
      }
    }
    if (fi == null) return { kind: "no-fill" };
  }
  const start = fi!;

  let stop = o.stop;
  let rem = 1;
  let banked = 0;
  let t1Done = false;
  const rOf = (p: number) => (long ? p - E : E - p) / risk;
  for (let k = start; k < bars.length && k < start + HOLD_BARS; k++) {
    const b = bars[k]!;
    // Ties against the trade: the stop is read first, every bar.
    if (long ? b.l <= stop : b.h >= stop) {
      const px = long ? stop - o.tick : stop + o.tick;
      banked += rOf(px) * rem;
      return { kind: "filled", R: banked, exit: t1Done ? "be" : "stop", fill: start, out: k, entry: E, exitPx: px, t1: t1Done };
    }
    // The fill bar can stop the trade out but never also pay a target: the
    // order of the prints inside it is unknown.
    if (k === start) continue;
    if (!t1Done && (long ? b.h >= t1 : b.l <= t1)) {
      t1Done = true;
      if (t2 == null) {
        banked += rOf(t1) * rem;
        return { kind: "filled", R: banked, exit: "t1", fill: start, out: k, entry: E, exitPx: t1, t1: true };
      }
      banked += rOf(t1) * TP1_FRACTION;
      rem -= TP1_FRACTION;
      stop = E;
      continue;
    }
    if (t1Done && t2 != null && (long ? b.h >= t2 : b.l <= t2)) {
      banked += rOf(t2) * rem;
      return { kind: "filled", R: banked, exit: "t2", fill: start, out: k, entry: E, exitPx: t2, t1: true };
    }
  }
  const li = Math.min(bars.length, start + HOLD_BARS) - 1;
  banked += rOf(bars[li]!.c) * rem;
  return { kind: "filled", R: banked, exit: "time", fill: start, out: li, entry: E, exitPx: bars[li]!.c, t1: t1Done };
}

/** R rounded the way the file stores it. */
export const roundR = (r: number) => Math.round(r * 10_000) / 10_000;

/** The desk's plan, taken as coded: a limit at CE with the plan's stop and targets. */
export function deskOrder(c: Pick<DrillCase, "sym" | "side" | "e" | "s" | "t1" | "t2">): SimOrder {
  return { side: c.side, type: "limit", entry: c.e, stop: c.s, t1: c.t1, t2: c.t2, tick: tickOf(c.sym) };
}

export function toDeskRecord(r: SimResult): DeskRecord {
  if (r.kind === "filled") return { kind: "filled", R: roundR(r.R), exit: r.exit, fill: r.fill, out: r.out, t1: r.t1 };
  if (r.kind === "no-fill") return { kind: "no-fill" };
  return { kind: "invalid", note: r.note };
}

/** The trader's order, as the simulator reads it. */
export function traderOrder(c: Pick<DrillCase, "sym" | "side">, o: OrderInput): SimOrder {
  return {
    side: c.side,
    type: o.type,
    entry: o.type === "limit" ? o.limit : null,
    stop: o.stop,
    t1: o.t1,
    t2: o.t2,
    tick: tickOf(c.sym),
  };
}

export type OutcomeKind = "filled" | "no-fill" | "invalid" | "flat";

export interface Outcome {
  kind: OutcomeKind;
  /** R of the trade; 0 for flat or no fill; null when the order could not exist. */
  R: number | null;
  text: string;
  sim: SimResult | null;
}

const EXIT_TEXT: Record<ExitKind, string> = {
  stop: "stopped",
  be: "T1 banked, runner stopped at breakeven",
  t1: "all out at T1",
  t2: "T1 banked, runner reached T2",
  time: "closed on time",
};

function outcomeOf(sim: SimResult): Outcome {
  if (sim.kind === "no-fill") {
    return { kind: "no-fill", R: 0, text: `No fill — the limit was not touched inside ${FILL_BARS} bars. 0R, not a loss.`, sim };
  }
  if (sim.kind === "invalid") return { kind: "invalid", R: null, text: sim.note, sim };
  return { kind: "filled", R: roundR(sim.R), text: `${fr(sim.R)} — ${EXIT_TEXT[sim.exit]}.`, sim };
}

/** What the trader's own levels made on the hidden bars. */
export function traderOutcome(c: DrillCase, call: DrillCall): Outcome {
  if (call.word !== "TAKE" || !call.order) {
    return { kind: "flat", R: 0, text: "No order — flat. 0R.", sim: null };
  }
  return outcomeOf(simulateOrder(caseBars(c), DECISION, traderOrder(c, call.order)));
}

/** What the desk's plan made, taken as coded (for a WAIT/STAND: taken anyway). */
export function deskOutcome(c: DrillCase): Outcome {
  return outcomeOf(simulateOrder(caseBars(c), DECISION, deskOrder(c)));
}

/* ── Attempts, curves, and the next case ─────────────────────────────────── */

export interface DrillAttempt {
  caseId: string;
  /** Epoch ms of the commit — the first and only attempt at this case. */
  at: number;
  openedAt: number;
  secondsToDecide: number;
  call: DrillCall;
  items: ProcessItem[];
  yourR: number | null;
  yourKind: OutcomeKind;
  deskR: number | null;
  deskKind: OutcomeKind;
}

export interface DrillStore {
  v: 1;
  attempts: DrillAttempt[];
  /** The case on screen and when it opened, so a reload keeps the clock running. */
  open: { caseId: string; openedAt: number } | null;
}

export const STORE_KEY = "ledger-replay-drill-v1";

export function emptyStore(): DrillStore {
  return { v: 1, attempts: [], open: null };
}

const WORDS: readonly Word[] = ["TAKE", "WAIT", "STAND"];
const STATUSES: readonly ItemStatus[] = ["pass", "fail", "na"];
const RULE_IDS = new Set<string>(RULES.map((r) => r.id));

function validAttempt(a: unknown): a is DrillAttempt {
  if (!a || typeof a !== "object") return false;
  const x = a as Partial<DrillAttempt>;
  return (
    typeof x.caseId === "string" &&
    typeof x.at === "number" &&
    typeof x.secondsToDecide === "number" &&
    !!x.call &&
    WORDS.includes(x.call.word as Word) &&
    Array.isArray(x.items) &&
    x.items.every((i) => i && RULE_IDS.has(i.id) && STATUSES.includes(i.status))
  );
}

/**
 * Parse whatever localStorage held. Anything malformed is dropped rather than
 * trusted, and a second attempt at a case already attempted is dropped too —
 * the first answer is the answer.
 */
export function parseStore(raw: string | null | undefined): DrillStore {
  if (!raw) return emptyStore();
  try {
    const j = JSON.parse(raw) as Partial<DrillStore>;
    if (!j || j.v !== 1 || !Array.isArray(j.attempts)) return emptyStore();
    const seen = new Set<string>();
    const attempts = j.attempts.filter((a): a is DrillAttempt => {
      if (!validAttempt(a) || seen.has(a.caseId)) return false;
      seen.add(a.caseId);
      return true;
    });
    const open =
      j.open && typeof j.open.caseId === "string" && typeof j.open.openedAt === "number" && !seen.has(j.open.caseId)
        ? { caseId: j.open.caseId, openedAt: j.open.openedAt }
        : null;
    return { v: 1, attempts, open };
  } catch {
    return emptyStore();
  }
}

/** Append an attempt. A case already attempted is refused — no retries. */
export function recordAttempt(store: DrillStore, a: DrillAttempt): DrillStore {
  if (store.attempts.some((x) => x.caseId === a.caseId)) return store;
  return { v: 1, attempts: [...store.attempts, a], open: store.open?.caseId === a.caseId ? null : store.open };
}

/** Build the attempt record for a committed call. */
export function makeAttempt(c: DrillCase, call: DrillCall, openedAt: number, at: number): DrillAttempt {
  const items = scoreProcess(c, call);
  const you = traderOutcome(c, call);
  const desk = deskOutcome(c);
  return {
    caseId: c.id,
    at,
    openedAt,
    secondsToDecide: Math.max(0, Math.round((at - openedAt) / 100) / 10),
    call,
    items,
    yourR: you.R,
    yourKind: you.kind,
    deskR: desk.R,
    deskKind: desk.kind,
  };
}

export interface RuleCurve {
  id: RuleId;
  /** Applicable outcomes, oldest first, over the last CURVE_WINDOW attempts. */
  marks: ("pass" | "fail")[];
  pass: number;
  n: number;
}

/**
 * One learning curve per rule — the sequence of pass/fail over the recent
 * attempts where the rule applied. Deliberately not averaged across rules:
 * "Stop band 2 of 7" and "Word 18 of 20" are two different problems, and a
 * blended 80% would hide the one that costs money.
 */
export function ruleCurves(attempts: DrillAttempt[], window = CURVE_WINDOW): RuleCurve[] {
  const recent = [...attempts].sort((a, b) => a.at - b.at).slice(-window);
  return RULES.map((r) => {
    const marks: ("pass" | "fail")[] = [];
    for (const a of recent) {
      const it = a.items.find((i) => i.id === r.id);
      if (it && it.status !== "na") marks.push(it.status);
    }
    return { id: r.id, marks, pass: marks.filter((m) => m === "pass").length, n: marks.length };
  });
}

export function medianSeconds(attempts: DrillAttempt[], window = CURVE_WINDOW): number | null {
  const xs = [...attempts]
    .sort((a, b) => a.at - b.at)
    .slice(-window)
    .map((a) => a.secondsToDecide)
    .filter((s) => Number.isFinite(s))
    .sort((a, b) => a - b);
  if (!xs.length) return null;
  const m = Math.floor(xs.length / 2);
  return xs.length % 2 ? xs[m]! : (xs[m - 1]! + xs[m]!) / 2;
}

/** The rule failed most over the recent window, with its count. Ties go to checklist order. */
export function weakestRule(attempts: DrillAttempt[], window = CURVE_WINDOW): { id: RuleId; fails: number } | null {
  let best: { id: RuleId; fails: number } | null = null;
  for (const cur of ruleCurves(attempts, window)) {
    const fails = cur.n - cur.pass;
    if (fails > 0 && (!best || fails > best.fails)) best = { id: cur.id, fails };
  }
  return best;
}

/**
 * What a case exercises, as tags the repetition pick can match. Computed from
 * the case alone, so a case's tags never depend on who is drilling it.
 */
export function caseTags(c: DrillCase): Set<string> {
  const exp = expectedAction(c);
  const tags = new Set<string>([`word:${exp.word}`]);
  if (exp.blocker) tags.add(`layer:${exp.blocker}`);
  if (exp.word === "TAKE") tags.add("place");
  const x = invalidationExtreme(c);
  if (x?.what === "raid") tags.add("raid");
  const deskRisk = Math.abs(c.e - c.s);
  if (c.atr > 0 && (deskRisk < MIN_RISK_ATR * c.atr || deskRisk > MAX_RISK_ATR_TRADABLE * c.atr)) tags.add("band");
  if (c.t1 == null || Math.abs(c.t1 - c.e) < 1.5 * deskRisk) tags.add("target");
  const plan = c.zone
    ? ({ side: c.side, entry: c.e, stop: c.s, entryZone: { bottom: c.zone[0], top: c.zone[1] } } as unknown as TradePlan)
    : null;
  const read = plan ? readEntry(plan, c.px, c.atr) : null;
  if (read && (read.behind || (read.awayAtr ?? 0) > TIER_ARMED_ATR)) tags.add("chase");
  return tags;
}

/**
 * Which tag a failed rule sends the trader back to. For the word and the
 * blocker the tag carries WHICH answer was missed, read from the failed
 * attempts themselves: a trader who keeps taking WAIT cards needs WAIT cards,
 * not more TAKEs.
 */
function tagForRule(id: RuleId, attempts: DrillAttempt[], byId: Map<string, DrillCase>): string[] {
  if (id === "word" || id === "layer") {
    const counts = new Map<string, number>();
    for (const a of [...attempts].sort((x, y) => x.at - y.at).slice(-CURVE_WINDOW)) {
      if (a.items.find((i) => i.id === id)?.status !== "fail") continue;
      const c = byId.get(a.caseId);
      if (!c) continue;
      const exp = expectedAction(c);
      const tag = id === "word" ? `word:${exp.word}` : `layer:${exp.blocker}`;
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
    return [...counts].sort((a, b) => b[1] - a[1]).map(([t]) => t);
  }
  if (id === "no-chase") return ["chase"];
  if (id === "stop-beyond") return ["raid"];
  if (id === "stop-band") return ["band"];
  if (id === "t1") return ["target"];
  return ["place"];
}

/**
 * The next case: never one already attempted, always the same answer for the
 * same history. Base order is the file's (a seeded shuffle); every
 * REPEAT_EVERY-th pick goes back to the rule failed most recently and takes
 * the first unattempted case that exercises it — spaced repetition by rule,
 * not by case, because a case can only be answered once.
 */
export function nextCaseId(cases: DrillCase[], attempts: DrillAttempt[]): string | null {
  const done = new Set(attempts.map((a) => a.caseId));
  const open = cases.filter((c) => !done.has(c.id));
  if (!open.length) return null;
  const weak = weakestRule(attempts);
  if (weak && attempts.length % REPEAT_EVERY === REPEAT_EVERY - 1) {
    const byId = new Map(cases.map((c) => [c.id, c] as const));
    for (const tag of tagForRule(weak.id, attempts, byId)) {
      const hit = open.find((c) => caseTags(c).has(tag));
      if (hit) return hit.id;
    }
  }
  return open[0]!.id;
}
