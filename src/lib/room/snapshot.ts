/**
 * The room's backup, as data: what a snapshot holds, how "rich" it is, and
 * the one rule for which copy wins. Pure — shared by the server functions
 * (snapshot-server.ts) and the browser sync (snapshot-sync.ts).
 *
 * The room runs in every open browser, so two devices hold two copies of the
 * same deterministic decisions. They are never merged (that would count each
 * trade twice). The copy with more history wins, and only at startup.
 */

import type { MindState } from "./agents";
import type { RoomBook } from "./paper-book";

export interface RoomSnapshot {
  version: 1;
  book: RoomBook;
  minds: MindState | null;
}

/** How much a book has lived: fills and ghosts only ever grow; the newest closed item breaks ties. */
export interface SnapshotRank {
  history: number;
  lastAt: number;
}

export function rankOf(book: RoomBook): SnapshotRank {
  const lab = book.lab;
  const lastClosed = book.closed.reduce((m, c) => Math.max(m, Number(c.closedAt) || 0), 0);
  const lastGhost = (lab?.ghosts ?? []).reduce((m, g) => Math.max(m, g.closed?.at ?? 0), 0);
  return {
    history: (Number(book.seq) || 0) + (Number(lab?.seq) || 0),
    lastAt: Math.max(lastClosed, lastGhost),
  };
}

/** True when `a` carries strictly more history than `b`. */
export function richer(a: SnapshotRank, b: SnapshotRank): boolean {
  return a.history > b.history || (a.history === b.history && a.lastAt > b.lastAt);
}

/** The same shape check the server runs before it stores anything. */
export function isSnapshot(x: unknown): x is RoomSnapshot {
  if (!x || typeof x !== "object") return false;
  const s = x as Partial<RoomSnapshot>;
  const b = s.book as Partial<RoomBook> | undefined;
  return (
    s.version === 1 &&
    !!b &&
    b.version === 1 &&
    typeof b.cash === "number" &&
    Number.isFinite(b.cash) &&
    typeof b.startCash === "number" &&
    Array.isArray(b.positions) &&
    Array.isArray(b.closed) &&
    Array.isArray(b.events) &&
    !!b.counters &&
    typeof b.counters === "object" &&
    (s.minds == null || (typeof s.minds === "object" && (s.minds as { version?: number }).version === 1))
  );
}

/** Snapshots above this are refused — a runaway book, not a trader's history. */
export const MAX_SNAPSHOT_BYTES = 2_000_000;

/**
 * The one write. $1 user, $2 body (json text), $3 history, $4 last_at,
 * $5 force. A poorer copy never overwrites a richer one — a new phone whose
 * startup restore failed must not wipe weeks of ghost-room evidence — and
 * only an explicit reset (force) replaces a richer copy. Equal rank writes
 * (marks moved, nothing closed). Here, not in the server file, so
 * scripts/verify-room-snapshot.mjs runs the exact statement on PGLite.
 */
export const SNAPSHOT_UPSERT_SQL = `insert into room_snapshot (user_id, body, history, last_at, saved_at)
  values ($1, $2::jsonb, $3, $4, now())
on conflict (user_id) do update
  set body = excluded.body, history = excluded.history, last_at = excluded.last_at, saved_at = now()
  where $5::boolean
     or room_snapshot.history < excluded.history
     or (room_snapshot.history = excluded.history and room_snapshot.last_at <= excluded.last_at)
returning user_id`;
