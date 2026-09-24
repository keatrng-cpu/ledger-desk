/**
 * The hand-logged real trades, read.
 *
 * `src/data/trade-log.json` has been WRITTEN by `scripts/log-trade.mjs` since
 * the sleeve went live and READ by nothing — so every lesson the trader typed
 * after a fill went into a file the desk never opened. `setup-memory.ts` is
 * the other half of that: 69 passing tests, also imported by nothing. This
 * module is the join.
 *
 * WHAT IT DOES NOT DO
 * It does not invent the fields the log lacks. `fingerprint` needs a model and
 * a killzone; the log carries neither for most rows, so they stay null and the
 * shape key says "unknown" rather than guessing one. A fabricated model tag
 * would group unrelated trades under one lesson, which is worse than no
 * lesson — and with n=1 there is no lesson either way.
 *
 * MIN_N_FOR_LESSON is 8. Today the log holds one trade. The panel this feeds
 * will therefore say "not enough" for some weeks, which is the correct output
 * and the reason to wire it now rather than when the number looks good: a
 * statistic that only appears once it is flattering is not a statistic.
 */

import raw from "../../data/trade-log.json";
import {
  summarise,
  overrideScorecard,
  type LayerRow,
  type OverrideRecord,
  type OverrideSummary,
  type RefusingLayer,
} from "./override-log";
import {
  disciplineRead,
  fingerprint,
  recallShapes,
  shapeLabel,
  type DisciplineRead,
  type SetupRecord,
  type ShapeRecord,
} from "./setup-memory";

interface LoggedTrade {
  id: string;
  date: string;
  time_et?: string | null;
  symbol: string;
  side: string;
  model?: string | null;
  killzone?: string | null;
  expectation?: Partial<SetupRecord["expectation"]> | null;
  outcome?: Partial<NonNullable<SetupRecord["outcome"]>> | null;
  note?: string | null;
  notePreRegistered?: boolean | null;
  followedPlan?: boolean | null;
  violations?: string[] | null;
  /** Override evidence, added to the logger 2026-09-24. */
  missing?: string[] | null;
  deskWord?: string | null;
  ladderAgreed?: boolean | null;
  book?: string | null;
  pnl?: number | null;
  r?: number | null;
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/**
 * Adapt one logged row to a `SetupRecord`.
 *
 * Returns null for a row with no usable expectation: a record whose entry and
 * stop are unknown cannot be attributed, and a half-record in the statistics
 * is indistinguishable from a real one once it is aggregated.
 */
function toRecord(t: LoggedTrade): SetupRecord | null {
  const side = t.side === "short" ? "short" : t.side === "long" ? "long" : null;
  if (!side) return null;

  const entry = num(t.expectation?.entry);
  const stop = num(t.expectation?.stop);
  if (entry == null || stop == null) return null;

  const model = t.model ?? null;
  const killzone = t.killzone ?? null;

  const o = t.outcome;
  const outcome: SetupRecord["outcome"] =
    o && typeof o.filled === "boolean"
      ? {
          filled: o.filled,
          mfePts: num(o.mfePts) ?? 0,
          maePts: num(o.maePts) ?? 0,
          hitT1: o.hitT1 === true,
          hitT2: o.hitT2 === true,
          hitStop: o.hitStop === true,
          resultR: num(o.resultR) ?? 0,
          drawTradedLater:
            typeof o.drawTradedLater === "boolean" ? o.drawTradedLater : null,
        }
      : null;

  // `drawKind`, `missing` and `reachTier` are part of the shape key and the
  // log records none of them. They stay null/empty rather than being guessed:
  // the key's job is to group the SAME kind of trade, and a fabricated draw
  // kind would merge trades that were never alike.
  const shapeInput: {
    model: string | null;
    side: "long" | "short";
    killzone: string | null;
    drawKind: string | null;
    missing: string[];
  } = {
    model,
    side,
    killzone,
    drawKind: null,
    missing: [],
  };
  const fp = fingerprint({ ...shapeInput, reachTier: null });

  return {
    id: t.id,
    at: t.time_et ? `${t.date}T${t.time_et}` : t.date,
    symbol: t.symbol,
    side,
    fingerprint: fp,
    shape: shapeLabel(shapeInput),
    model,
    killzone,
    // The log does not record the sequence's word at the time of the click.
    // "TAKE" is NOT assumed: these were discretionary clicks, and several were
    // taken on a scanner score while the sequence said STAND. That distinction
    // is the whole point of the shadow book, so it is not erased here.
    word: "STAND",
    missingAtEntry: [],
    expectation: {
      entry,
      stop,
      t1: num(t.expectation?.t1),
      t2: num(t.expectation?.t2),
      rr1: num(t.expectation?.rr1),
      reachT1: num(t.expectation?.reachT1),
      reachT2: num(t.expectation?.reachT2),
      expR: num(t.expectation?.expR),
    },
    outcome,
    note: t.note ?? null,
    notePreRegistered: t.notePreRegistered === true,
    followedPlan: typeof t.followedPlan === "boolean" ? t.followedPlan : null,
    violations: Array.isArray(t.violations) ? t.violations : [],
  };
}

export function loggedRecords(): SetupRecord[] {
  const trades = (raw as { trades?: LoggedTrade[] }).trades ?? [];
  return trades.map(toRecord).filter((r): r is SetupRecord => r != null);
}

const LAYERS: RefusingLayer[] = [
  "dol", "sweep", "pd_half", "ltf", "target", "retrace",
  "htf", "judas", "news", "one_book",
];

/**
 * The logged trades as OVERRIDES — trades taken while the desk was not
 * saying TAKE.
 *
 * A row with no `missing` list is skipped rather than counted with an empty
 * one: an override attributed to no layer is evidence about nothing, and
 * including it would inflate `n` on the summary while teaching the scorecard
 * nothing. That distinction is the whole value of this ledger.
 */
export function overrideRecords(): OverrideRecord[] {
  const trades = (raw as { trades?: LoggedTrade[] }).trades ?? [];
  const out: OverrideRecord[] = [];
  for (const t of trades) {
    const side = t.side === "short" ? "short" : t.side === "long" ? "long" : null;
    if (!side) continue;
    const word = (t.deskWord ?? "").toUpperCase();
    // Only a trade the desk did NOT green-light is an override.
    if (word !== "STAND" && word !== "WAIT" && word !== "MANAGE") continue;
    const missing = (t.missing ?? []).filter((m): m is RefusingLayer =>
      LAYERS.includes(m as RefusingLayer),
    );
    if (!missing.length) continue;
    out.push({
      id: t.id,
      at: t.time_et ? `${t.date}T${t.time_et}` : t.date,
      symbol: t.symbol,
      side,
      book: t.book === "futures" ? "futures" : "options",
      missing,
      deskWord: word as OverrideRecord["deskWord"],
      grade: null,
      resultR: num(t.r),
      resultUsd: num(t.pnl),
      reason: t.note ?? "",
      ladderAgreed: typeof t.ladderAgreed === "boolean" ? t.ladderAgreed : null,
    });
  }
  return out;
}

export interface TradeLogRead {
  records: SetupRecord[];
  /** How many rows were logged but could not be used, and why it matters. */
  skipped: number;
  discipline: DisciplineRead;
  shapes: ShapeRecord[];
  /** Trades taken against a STAND/WAIT, and which gate each one skipped. */
  overrides: OverrideSummary;
  overrideLayers: LayerRow[];
  /** Logged rows that ARE overrides but recorded no layer, so teach nothing. */
  overridesUnattributed: number;
}

/**
 * The whole read, for the Book tab.
 *
 * `discipline` measures the TRADER (were the rules followed) and `shapes`
 * measures the SETUPS, with non-compliant records excluded from the latter by
 * `recallShapes`. Keeping them apart is the point: a losing run caused by
 * skipping the stop is not evidence against the setup.
 */
export function readTradeLog(): TradeLogRead {
  const trades = (raw as { trades?: LoggedTrade[] }).trades ?? [];
  const records = loggedRecords();
  const overrides = overrideRecords();
  const wasOverride = trades.filter((t) => {
    const w = (t.deskWord ?? "").toUpperCase();
    return w === "STAND" || w === "WAIT" || w === "MANAGE";
  }).length;
  return {
    records,
    skipped: trades.length - records.length,
    discipline: disciplineRead(records),
    shapes: recallShapes(records),
    overrides: summarise(overrides),
    overrideLayers: overrideScorecard(overrides),
    overridesUnattributed: Math.max(0, wasOverride - overrides.length),
  };
}
