/**
 * The four facts, read once, so every surface says the same thing.
 *
 * WHY THIS EXISTS. The product is ONE option on ONE futures plan: a direction
 * the raid named, a counter-bias note, an array to rest the limit at, and a
 * draw that pays at least 1:1. Before this module the Options tab, the Now
 * board, the brain and Vince each re-derived those four from a different
 * field — the option card read `card.ticket.invalidation` prose, the Now board
 * read `smcMaster.layers`, the floor read the scanner card — so the same tape
 * could print three entry prices and two directions on one screen.
 *
 * NOTHING HERE DETECTS ANYTHING. Every value is read from the detector that
 * already owns it, named in `.ai/locator.md`:
 *
 *   direction      `raid-pair.ts` namingSweep   — the latest raid a later
 *                  displacement actually answered. A newer unanswered tag of
 *                  the other pool does not move the side.
 *   counter-bias   `structure.ts` HtfBiasRead + the card's own
 *                  `htfDisrespected` release. A disrespected higher timeframe
 *                  is a NOTE (bcd0e928), never a stand.
 *   entry          `entry-trigger.ts` readEntry — inside the array, in front
 *                  of it, or through it on the stop side.
 *   target         `trade-plan.ts` TradePlan.rr1 against `APLUS_RULES.minRr`.
 *
 * The four CONDITIONS are the same four facts asked as yes/no, and they are
 * what the option ticket's buy line is predicated on. The debit and the brain
 * are separate requirements and live with the engine that owns them
 * (`options-desk.ts` ticketHolds), not here.
 */

import { APLUS_RULES } from "../aplus/config";
import type { OhlcBar } from "../market/types";
import type { DeskPayload } from "./build-desk";
import type { LiquidityTarget } from "./draw";
import { atrOf } from "./draw";
import { readEntry, type EntryRead } from "./entry-trigger";
import { readLtfReaction, type LtfReaction } from "./ltf-reaction";
import { namingSweep } from "./raid-pair";
import type { SetupCandidate } from "./scanner";
import type { SmcMasterBook } from "./smc-master";
import type { SweepEvent } from "./detectors";

export type BookSide = "long" | "short";

/** Each frame against the trade: with it, spent, or not a bias at all. */
export type CounterRead = "agrees" | "disrespected" | "unread";

export interface FactCondition {
  id: "raid" | "confirm" | "array" | "pays";
  /** Short enough for a chip. */
  label: string;
  ok: boolean;
  /** The live tape behind the answer, with prices. */
  detail: string;
}

export interface FourFacts {
  symbol: string;
  /** Which futures leg of the payload this book is. */
  leg: "left" | "right";
  side: BookSide | null;
  word: SmcMasterBook["word"];
  /** The one line the brain prints for the first must-layer that is not passing. */
  missing: string;
  missingDetail: string;

  direction: {
    /** "Sellside taken at 24180.25 — that arms the long." Never blank. */
    text: string;
    pool: string | null;
    /** The swing extreme that got taken. */
    price: number | null;
    /** The wick beyond it — the stop sits past this. */
    wick: number | null;
    raidSide: "buyside" | "sellside" | null;
    raidT: number | null;
  };

  counter: {
    htf: CounterRead;
    mid: CounterRead;
    /** The card's own formal release (`htfDisrespected`). Lesson 7 grades it. */
    released: boolean;
    /** "discount" / "premium" / "equilibrium — waits" / "no range". */
    half: string;
    text: string;
  };

  entry: {
    px: number | null;
    zone: { top: number; bottom: number } | null;
    /** Price is in the array (plus the retrace pad). */
    inside: boolean;
    /** Price has gone through the array on the STOP side — a buy here is a chase. */
    chase: boolean;
    /** Never a blank number: the words "not at the array" when there is none. */
    text: string;
    read: EntryRead | null;
  };

  target: {
    px: number | null;
    r: number | null;
    pool: string | null;
    /** rr1 >= APLUS_RULES.minRr. False whenever there is no priced target. */
    pays: boolean;
    text: string;
  };

  stop: number | null;
  /** The 1m–5m read, for the confirm condition and the displacement lesson. */
  ltf: LtfReaction;
  four: FactCondition[];
  /** Every one of the four. The buy line needs this AND the debit AND the brain. */
  fourOk: boolean;
}

const UNDERLIER_OF = { QQQ: /N(Q|asdaq)|MNQ/, SPY: /ES|MES/ } as const;

/** QQQ expresses the NQ book, SPY the ES book. */
export function legForUnderlier(desk: DeskPayload, underlier: "QQQ" | "SPY"): "left" | "right" {
  const re = UNDERLIER_OF[underlier];
  return re.test(desk.left.symbol) ? "left" : "right";
}

/**
 * One frame against one side. Three states and no fourth:
 *
 *   agrees        the frame is on the trade's side, and needs no release.
 *   unread        neutral or unknown. Not a bias, so not a disrespect either
 *                 (htf-invalidation.ts returns NOT_DISRESPECTED on neutral).
 *   disrespected  the frame points the other way. That is a NOTE, never a
 *                 stand (bcd0e928) — whether the desk has ALSO granted the
 *                 formal release is `counter.released`, read off the card's
 *                 own `htfDisrespected`, and it is lesson 7 that grades it.
 */
function counterOf(bias: string | null | undefined, side: BookSide | null): CounterRead {
  if (!side) return "unread";
  if (bias !== "bull" && bias !== "bear") return "unread";
  return bias === (side === "long" ? "bull" : "bear") ? "agrees" : "disrespected";
}

/** The pool the raid took, named from the book's own liquidity map. */
function poolName(desk: DeskPayload, leg: "left" | "right", sweep: SweepEvent | null): string | null {
  const liq = desk.narrative[leg].liquidity;
  if (!sweep) return liq.lastSweepLabel ?? null;
  const list = sweep.side === "buyside" ? liq.bsl : liq.ssl;
  let best: { label: string; d: number } | null = null;
  for (const l of list) {
    const d = Math.abs(l.price - sweep.sweptLevel);
    if (!best || d < best.d) best = { label: l.label, d };
  }
  // A pool more than a point away from the swing the detector swept is a
  // different level, so it is not named rather than named wrongly.
  if (best && best.d <= Math.max(1, Math.abs(sweep.sweptLevel) * 0.0005)) return best.label;
  return liq.lastSweepLabel ?? null;
}

function candidateFor(desk: DeskPayload, symbol: string, side: BookSide | null): SetupCandidate | null {
  if (!side) return null;
  return desk.scan.candidates.find((c) => c.symbol === symbol && c.side === side) ?? null;
}

/**
 * The four facts for one futures book.
 *
 * `leg` picks which half of the payload; the smc-master book, the scanner
 * card, the bars and the live print all come from that same leg, so a fact
 * can never be read off one symbol and printed beside another's price.
 */
export function fourFacts(desk: DeskPayload, leg: "left" | "right"): FourFacts {
  const book = leg === "left" ? desk.smcMaster.left : desk.smcMaster.right;
  const series = leg === "left" ? desk.left : desk.right;
  const bars: OhlcBar[] = series.bars ?? [];
  const minute: OhlcBar[] = (leg === "left" ? desk.mtf.left.minute : desk.mtf.right.minute) ?? [];
  const price = leg === "left" ? desk.quotes.left.price : desk.quotes.right.price;
  const bias = leg === "left" ? desk.bias.left : desk.bias.right;
  const side = book.side;
  const cand = candidateFor(desk, book.symbol, side);
  const plan = book.plan;

  // DIRECTION — the raid that names the trade, not the newest tag.
  const raid = namingSweep(bars);
  const armsSide: BookSide | null = raid ? (raid.side === "sellside" ? "long" : "short") : null;
  const pool = poolName(desk, leg, raid);
  const directionText = !raid
    ? "No raid has been answered yet — nothing arms a side."
    : `${raid.side === "buyside" ? "Buyside" : "Sellside"} taken at ${raid.sweptLevel.toFixed(2)}${pool ? ` (${pool})` : ""} — that arms the ${armsSide}.`;

  // COUNTER-BIAS — a note, never a stand.
  const released = Boolean(cand?.htfDisrespected);
  const htf = counterOf(bias.topDown, side);
  const mid = counterOf(bias.mid, side);
  const half = book.dealing
    ? book.dealing.zone === "equilibrium"
      ? "equilibrium — no half, so it waits"
      : book.dealing.zone
    : "no dealing range";
  const counterText =
    htf === "agrees" && mid === "agrees"
      ? `Higher timeframe ${bias.topDown} and the middle frame both agree. Half: ${half}.`
      : `Higher timeframe ${htf}${bias.topDown === "bull" || bias.topDown === "bear" ? ` (${bias.topDown})` : ""}, middle frame ${mid}${htf === "disrespected" ? released ? " — the desk released this side" : " — no release printed yet" : ""}. A disrespected frame is a note, not a stand. Half: ${half}.`;

  // ENTRY — the array the displacement left, or the words.
  const atr = cand?.atr ?? (bars.length ? atrOf(bars) : null);
  const entryRead = readEntry(plan, price, atr);
  const zone = plan?.entryZone ?? null;
  const px = plan?.entry ?? cand?.entryPx ?? null;
  const inside = entryRead?.inZone === true;
  const chase = entryRead?.behind === true;
  const entryText =
    px == null
      ? "not at the array"
      : entryRead == null
        // The array has a price but no priced plan behind it, so there is no
        // zone and no stop — "inside" and "in front" are not yet answerable,
        // and claiming either would be a number nobody measured.
        ? `The array prices at ${px.toFixed(2)}, but no plan is priced yet, so inside or in front cannot be read.`
        : inside
          ? `Price ${price.toFixed(2)} is in the array — rest the limit at ${px.toFixed(2)}.`
          : chase
            ? `Price ${price.toFixed(2)} is through ${px.toFixed(2)} on the stop side. A buy here is a chase.`
            : `Limit rests at ${px.toFixed(2)}. Price ${price.toFixed(2)} is still in front of it.`;

  // TARGET — the next unswept pool and its R from that entry.
  const t1Pool: LiquidityTarget | null = book.pools?.t1 ?? cand?.draw ?? null;
  const rr1 = plan?.rr1 ?? null;
  const pays = rr1 != null && rr1 >= APLUS_RULES.minRr;
  const targetText =
    plan?.t1 == null
      ? "No unswept pool priced in front of this entry — no target."
      : rr1 == null
        ? `T1 ${plan.t1.toFixed(2)}${t1Pool ? ` (${t1Pool.name})` : ""} — R is unpriced without a stop.`
        : pays
          ? `T1 ${plan.t1.toFixed(2)}${t1Pool ? ` (${t1Pool.name})` : ""} · ${rr1.toFixed(2)}R from ${plan.entry.toFixed(2)}.`
          : `T1 ${plan.t1.toFixed(2)} is only ${rr1.toFixed(2)}R — under the ${APLUS_RULES.minRr.toFixed(1)}:1 floor, so the target fails and there is no buy line.`;

  // CONFIRM — the 1m–5m close through the gap the raid left.
  const dir = side === "long" ? "bull" : "bear";
  const ltf = readLtfReaction(minute, dir, raid?.t ?? desk.narrative[leg].liquidity.lastSweepT ?? null);

  const four: FactCondition[] = [
    {
      id: "raid",
      label: "Raid named the side",
      ok: Boolean(raid && armsSide && armsSide === side),
      detail: !raid
        ? "No raid with a close back inside has been answered by a later displacement."
        : armsSide !== side
          ? `The answered raid was ${raid.side} at ${raid.sweptLevel.toFixed(2)}, which arms the ${armsSide}. This book is ${side ?? "flat"}.`
          : directionText,
    },
    {
      id: "confirm",
      label: "1–5m close confirmed it",
      ok: ltf.confirmed,
      detail: ltf.reason,
    },
    {
      id: "array",
      label: "Price is inside the array",
      ok: inside,
      detail: px == null ? "Displacement left no array. No ticket." : entryText,
    },
    {
      id: "pays",
      label: `Target pays ${APLUS_RULES.minRr.toFixed(1)}:1`,
      ok: pays,
      detail: targetText,
    },
  ];

  return {
    symbol: book.symbol,
    leg,
    side,
    word: book.word,
    missing: book.missing,
    missingDetail: book.missingDetail,
    direction: {
      text: directionText,
      pool,
      price: raid?.sweptLevel ?? null,
      wick: raid?.wickExtreme ?? null,
      raidSide: raid?.side ?? null,
      raidT: raid?.t ?? null,
    },
    counter: { htf, mid, released, half, text: counterText },
    entry: { px, zone, inside, chase, text: entryText, read: entryRead },
    target: { px: plan?.t1 ?? null, r: rr1, pool: t1Pool?.name ?? null, pays, text: targetText },
    stop: plan?.stop ?? null,
    ltf,
    four,
    fourOk: four.every((c) => c.ok),
  };
}

/** Both books, left first, for the Now board. */
export function bothFacts(desk: DeskPayload): FourFacts[] {
  return [fourFacts(desk, "left"), fourFacts(desk, "right")];
}

/** The book the option expresses. */
export function factsForUnderlier(desk: DeskPayload, underlier: "QQQ" | "SPY"): FourFacts {
  return fourFacts(desk, legForUnderlier(desk, underlier));
}
