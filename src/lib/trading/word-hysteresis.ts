/**
 * Word hysteresis — a printed TAKE does not flicker.
 *
 * WHY
 * The retrace layer is a fact about the live print: inside the array (± a
 * quarter of its height) it passes, a tick outside it waits. Price sits ON
 * that edge for minutes at a time, so the desk's word toggled TAKE / WAIT on
 * consecutive 20-second polls while nothing about the setup had changed.
 * Every toggle is a decision the trader is asked to re-make, and the alarm,
 * the green frame and the shadow book all reacted to each one. That is the
 * flicker that shreds nerves without adding information.
 *
 * THE RULE
 * Once a book prints TAKE, hold it while ALL of these stay true:
 *   - no must-layer has FAILED (a fail is a STAND, immediately);
 *   - the only non-passing must-layer is the retrace itself (the sequence
 *     is otherwise intact — same side, same plan entry);
 *   - the print is within HOLD_BAND array-heights of the array's edge (it
 *     stepped out, it did not leave);
 *   - the hold is younger than HOLD_MS.
 * A held TAKE says so in `missing` / `missingDetail`, keeps the retrace
 * layer's own state untouched (so auto-paper — which books only when the
 * retrace PASSES on the live print — still waits for the touch), and ends
 * the moment any condition breaks.
 *
 * Client-side and pure over its own small state: the server function is
 * stateless per poll and cannot remember the previous word.
 */

import type { DeskPayload } from "./build-desk";
import type { SmcMasterBook, SmcMasterRead } from "./smc-master";

/** How long a TAKE is held through the edge, ms. Two 15m bars. */
export const HOLD_MS = 30 * 60_000;
/** How far outside the array the print may step, in array heights. */
export const HOLD_BAND = 0.5;

interface Hold {
  since: number;
  side: "long" | "short";
  entry: number;
}

export interface HysteresisState {
  holds: Map<string, Hold>;
}

export function createHysteresisState(): HysteresisState {
  return { holds: new Map() };
}

function outsideByHeights(book: SmcMasterBook, price: number): number | null {
  const zone = book.plan?.entryZone;
  if (!zone) return null;
  const h = zone.top - zone.bottom;
  if (!(h > 0)) return null;
  if (price >= zone.bottom && price <= zone.top) return 0;
  return (price > zone.top ? price - zone.top : zone.bottom - price) / h;
}

function stabilizeBook(book: SmcMasterBook, price: number, now: number, state: HysteresisState): SmcMasterBook {
  const key = book.symbol;
  const hold = state.holds.get(key);

  if (book.word === "TAKE") {
    // A fresh TAKE (re)starts the hold on this plan.
    if (book.side && book.plan) state.holds.set(key, { since: now, side: book.side, entry: book.plan.entry });
    return book;
  }
  if (!hold) return book;

  const musts = book.layers.filter((l) => l.must);
  const failed = musts.some((l) => l.state === "fail");
  const onlyRetraceWaits = musts.every((l) => l.state === "pass" || l.id === "retrace");
  const samePlan = book.side === hold.side && book.plan != null && Math.abs(book.plan.entry - hold.entry) < 1e-6;
  const away = outsideByHeights(book, price);
  const inBand = away != null && away <= HOLD_BAND;
  const young = now - hold.since <= HOLD_MS;

  if (failed || !onlyRetraceWaits || !samePlan || !inBand || !young) {
    state.holds.delete(key);
    return book;
  }

  const zone = book.plan!.entryZone!;
  const pts = price > zone.top ? price - zone.top : zone.bottom - price;
  const leftMin = Math.max(0, Math.round((HOLD_MS - (now - hold.since)) / 60_000));
  return {
    ...book,
    word: "TAKE",
    missing: "TAKE held — limit at CE",
    missingDetail: `Print ${price.toFixed(2)} is ${pts.toFixed(2)}pt outside the array (${(away! * 100).toFixed(0)}% of its height) — still the same setup. Limit rests at CE ${book.plan!.entry.toFixed(2)}, stop ${book.plan!.stop.toFixed(2)}. Hold expires in ${leftMin} min unless a layer fails.`,
  };
}

/** Apply the hold to both books and re-link `oneBook`. Mutates `state`. */
export function applyWordHysteresis(desk: DeskPayload, state: HysteresisState, now = Date.now()): DeskPayload {
  const m = desk.smcMaster;
  if (!m) return desk;
  const left = stabilizeBook(m.left, desk.quotes.left.price, now, state);
  const right = stabilizeBook(m.right, desk.quotes.right.price, now, state);
  if (left === m.left && right === m.right) return desk;
  const oneBook = m.oneBook ? (m.oneBook.symbol === left.symbol ? left : right) : null;
  const held = [left, right].filter((b) => b.missing === "TAKE held — limit at CE");
  const thesis = held.length
    ? `${held.map((b) => `${b.symbol} TAKE held (${b.side})`).join(" · ")} — ${m.thesis}`
    : m.thesis;
  const smcMaster: SmcMasterRead = { ...m, left, right, oneBook, thesis };
  return { ...desk, smcMaster };
}
