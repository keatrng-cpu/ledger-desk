/**
 * Keep the room's paper book and memory backed up server-side.
 *
 *   restoreRoomIfRicher(local)  at startup: adopt the server copy only when it
 *                               carries MORE history than this browser's
 *   backupRoom(snapshot)        after a cycle that changed the book: push,
 *                               at most once a minute; a reset forces it
 *
 * Never merges (two open devices run the same deterministic room — merging
 * would count every trade twice) and never runs mid-session restores (a
 * book must not change under a running cycle). Failure is quiet and
 * harmless: signed out, no database or offline → "local only" with the
 * reason, and the room keeps running from localStorage exactly as before.
 */

import type { MindState } from "./agents";
import type { RoomBook } from "./paper-book";
import { rankOf, richer, type RoomSnapshot } from "./snapshot";
import { getRoomSnapshot, putRoomSnapshot } from "./snapshot-server";

export interface BackupState {
  status: "idle" | "ok" | "local";
  /** When the server last confirmed a copy (ISO), if ever this session. */
  at: string | null;
  why: string;
}

const MIN_GAP_MS = 60_000;
let lastPushMs = 0;
let lastPushedRank = "";
let inflight: Promise<BackupState> | null = null;

const rankKey = (book: RoomBook) => {
  const r = rankOf(book);
  return `${r.history}:${r.lastAt}:${book.positions.length}:${book.cash}`;
};

function localOnly(e: unknown): BackupState {
  const msg = e instanceof Error ? e.message : String(e);
  const signedOut = /unauthor|401|sign/i.test(msg);
  return {
    status: "local",
    at: null,
    why: signedOut ? "Local only — sign in to back the room up." : `Local only — the backup did not answer (${msg.slice(0, 100)}).`,
  };
}

/** At startup: the server copy if it is richer than this browser's, else null. */
export async function restoreRoomIfRicher(local: RoomBook): Promise<{ snapshot: RoomSnapshot | null; state: BackupState }> {
  try {
    const r = await getRoomSnapshot();
    if (!r.snapshot || !r.rank) return { snapshot: null, state: { status: "idle", at: null, why: "No server copy yet — the first backup is on the next trade." } };
    if (richer(r.rank, rankOf(local))) {
      lastPushedRank = rankKey(r.snapshot.book);
      return {
        snapshot: r.snapshot,
        state: { status: "ok", at: r.savedAt, why: `Restored the server copy (${r.rank.history} fills and ghosts) — it had more history than this browser.` },
      };
    }
    return { snapshot: null, state: { status: "ok", at: r.savedAt, why: "This browser's room is current." } };
  } catch (e) {
    return { snapshot: null, state: localOnly(e) };
  }
}

/**
 * Push the room if it changed since the last push and a minute has passed
 * (or `force`, after a reset — that one waits for any push in flight and
 * always goes). Returns null when nothing was sent.
 */
export function backupRoom(book: RoomBook, minds: MindState | null, opts: { force?: boolean; nowMs?: number } = {}): Promise<BackupState> | null {
  const now = opts.nowMs ?? Date.now();
  const key = rankKey(book);
  if (!opts.force && (inflight || key === lastPushedRank || now - lastPushMs < MIN_GAP_MS)) return null;
  lastPushMs = now;
  const before = inflight;
  const run = async (): Promise<BackupState> => {
    if (before) await before.catch(() => undefined);
    const snapshot: RoomSnapshot = { version: 1, book, minds };
    try {
      const res = await putRoomSnapshot({ data: { snapshot, force: Boolean(opts.force) } });
      if (res.saved) lastPushedRank = key;
      return res.saved ? { status: "ok", at: new Date().toISOString(), why: "Backed up." } : { status: "ok", at: null, why: `Not saved: ${res.why}.` };
    } catch (e) {
      return localOnly(e);
    }
  };
  const p: Promise<BackupState> = run().finally(() => {
    if (inflight === p) inflight = null;
  });
  inflight = p;
  return p;
}
