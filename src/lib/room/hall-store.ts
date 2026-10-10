/**
 * The Mead Hall's prediction board, held where the Floor's talk and the Floor tab's own feed can both reach it.
 *
 * A tiny plain module store (no zustand, no React): the latest board the signal engine produced, when it arrived, whether a failed pull
 * kept the last one, and the sports scanner's rows and the paper records that came with it. Two writers, one reader:
 *
 *   - the Floor tab's own view-bound feed (about every 45 s while the tab is visible) calls `setHall` with the board it read;
 *   - the room engine's background poll (every ten minutes, never while the cash session is open) calls `setHall` too, through
 *     `hall-read.ts` (the only module that touches the network or localStorage);
 *   - `hallLiteNow` is what the talk world reads: a small, speakable slice (hall-lite.ts), aged to the moment it is asked.
 *
 * A write that carries only some fields keeps the others (the Floor tab's feed publishes a board without the scanner's rows; the rows
 * from the last poll stay, and hall-lite ignores them once they are older than the engine's model window). A write with an older board
 * than the one held is ignored — two feeds racing never move the hall backwards.
 *
 * Presentation only: nothing here reaches a gate, a size or a broker.
 */

import type { SignalBoard } from "@/lib/predict/signal-engine";
import type { ScanRow } from "@/lib/predict/scanner";
import type { HallLite, HallRecordLite } from "./live-types";
import { hallLiteFrom } from "./hall-lite";

export type HallStatus = "idle" | "loading" | "live" | "empty" | "error";

export interface HallFeed {
  board: SignalBoard | null;
  /** When this state was published (ms epoch). */
  at: number;
  status: HallStatus;
  /** A failed or empty pull kept the last live board. */
  held: boolean;
  error: string | null;
  /** The sports scanner's rows that came with the board (the model inputs behind "edge"), and when they were read (ISO). */
  scan: ScanRow[] | null;
  scanAsOf: string | null;
  /** The go ledger, the journal and the paper book, read in the browser. */
  record: HallRecordLite | null;
}

export type HallPatch = Partial<HallFeed>;

const EMPTY: HallFeed = { board: null, at: 0, status: "idle", held: false, error: null, scan: null, scanAsOf: null, record: null };

let state: HallFeed = EMPTY;
const subs = new Set<(s: HallFeed) => void>();
/** One cached Lite, so the talk's once-a-second look does not rebuild it. */
let cache: { key: string; lite: HallLite | null } | null = null;

export const getHall = (): HallFeed => state;

const boardMs = (b: SignalBoard | null): number => (b ? Date.parse(b.asOf) || 0 : 0);

/**
 * Publish. Only the fields given change. A board older than the one held is refused (its other fields are still taken), and a
 * patch with no board, or a null one (a feed that has not read anything yet), never clears the board that is held: say the feed failed with
 * `held: true` and an `error`, or call `resetHall()` to forget it.
 */
export function setHall(next: HallPatch): HallFeed {
  const prev = state;
  const merged: HallFeed = { ...prev, ...next };
  if (next.board && prev.board && boardMs(next.board) < boardMs(prev.board)) merged.board = prev.board;
  if (next.board == null) merged.board = prev.board;
  if (next.at === undefined) merged.at = Date.now();
  state = merged;
  cache = null;
  for (const fn of subs) {
    try {
      fn(state);
    } catch {
      /* a listener must never break the writer */
    }
  }
  return state;
}

export function subscribeHall(fn: (s: HallFeed) => void): () => void {
  subs.add(fn);
  return () => {
    subs.delete(fn);
  };
}

/** Back to nothing (tests, and a trader who signs out). */
export function resetHall(): void {
  state = EMPTY;
  cache = null;
  for (const fn of subs) fn(state);
}

/**
 * The talk's view of the hall at `nowMs`, or null when nothing has been read. Cached per ten seconds so a once-a-second look is cheap;
 * the age inside is therefore accurate to ten seconds, which is far finer than anything the talk says about it.
 */
export function hallLiteNow(nowMs: number): HallLite | null {
  const s = state;
  if (!s.board) return null;
  const key = `${s.at}|${s.board.asOf}|${s.scanAsOf ?? ""}|${Math.floor(nowMs / 10_000)}`;
  if (cache && cache.key === key) return cache.lite;
  const lite = hallLiteFrom({ board: s.board, nowMs, scan: s.scan, scanAsOf: s.scanAsOf, held: s.held, record: s.record });
  cache = { key, lite };
  return lite;
}
