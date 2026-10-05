/**
 * Keep the room's paper book and memory backed up server-side.
 *
 *   restoreRoomIfRicher(local)  at startup: adopt the server copy only when it
 *                               carries MORE history than this browser's
 *   backupRoom(snapshot)        after a cycle that changed the book: push,
 *                               at most once a minute; a reset forces it
 *
 * When to push is `mayPush` / `afterPush` (snapshot.ts): a book the server
 * already answered (saved, or refused as poorer) is not re-sent until it
 * changes, and a signed-out desk retries every 10 minutes, not every minute.
 *
 * Never merges (two open devices run the same deterministic room — merging
 * would count every trade twice) and never runs mid-session restores (a
 * book must not change under a running cycle). Failure is quiet and
 * harmless: signed out, no database or offline → "local only" with the
 * reason, and the room keeps running from localStorage exactly as before.
 *
 * Known limit: the richer copy wins, so a reset on one device is undone when
 * another device still running the old book pushes it again. The reset
 * confirm (trading-floor-tab.tsx) says to close the desk elsewhere first.
 */

import type { MindState } from "./agents";
import type { RoomBook } from "./paper-book";
import { afterPush, freshPushMemory, mayPush, rankOf, richer, type PushMemory, type PushOutcome, type RoomSnapshot } from "./snapshot";
import { getRoomSnapshot, putRoomSnapshot } from "./snapshot-server";

export interface BackupState {
  status: "idle" | "ok" | "local";
  /** When the server last confirmed a copy (ISO), if ever this session. */
  at: string | null;
  why: string;
}

let memory: PushMemory = freshPushMemory();
let inflight: Promise<BackupState> | null = null;

const rankKey = (book: RoomBook) => {
  const r = rankOf(book);
  return `${r.history}:${r.lastAt}:${book.positions.length}:${book.cash}`;
};

/** The server functions throw `UnauthorizedError` ("Unauthorized") when signed out (auth/verify.server.ts). */
const isSignedOut = (e: unknown) => /unauthor|\b401\b/i.test(e instanceof Error ? e.message : String(e));

function localOnly(e: unknown): BackupState {
  const msg = e instanceof Error ? e.message : String(e);
  return {
    status: "local",
    at: null,
    why: isSignedOut(e) ? "Local only — sign in to back the room up." : `Local only — the backup did not answer (${msg.slice(0, 100)}).`,
  };
}

/** At startup: the server copy if it is richer than this browser's, else null. */
export async function restoreRoomIfRicher(local: RoomBook): Promise<{ snapshot: RoomSnapshot | null; state: BackupState }> {
  try {
    const r = await getRoomSnapshot();
    if (!r.snapshot || !r.rank) return { snapshot: null, state: { status: "idle", at: null, why: "No server copy yet — the first backup goes up with the room's next cycle." } };
    if (richer(r.rank, rankOf(local))) {
      memory = { ...memory, settledKey: rankKey(r.snapshot.book) };
      return {
        snapshot: r.snapshot,
        state: { status: "ok", at: r.savedAt, why: `Restored the server copy (${r.rank.history} fills and ghosts) — it had more history than this browser.` },
      };
    }
    return { snapshot: null, state: { status: "ok", at: r.savedAt, why: "This browser's room is current." } };
  } catch (e) {
    // Signed out: hold the first push back too, rather than upload a book only to be told to sign in.
    if (isSignedOut(e)) memory = { ...afterPush(memory, "", "signed_out"), lastMs: Date.now() };
    return { snapshot: null, state: localOnly(e) };
  }
}

/**
 * Push the room when `mayPush` allows it (or `force`, after a reset — that
 * one waits for any push in flight and always goes). Returns null when
 * nothing was sent.
 */
export function backupRoom(book: RoomBook, minds: MindState | null, opts: { force?: boolean; nowMs?: number } = {}): Promise<BackupState> | null {
  const now = opts.nowMs ?? Date.now();
  const key = rankKey(book);
  if (!opts.force && (inflight || !mayPush(memory, key, now))) return null;
  memory = { ...memory, lastMs: now };
  const before = inflight;
  const run = async (): Promise<BackupState> => {
    if (before) await before.catch(() => undefined);
    const snapshot: RoomSnapshot = { version: 1, book, minds };
    let outcome: PushOutcome;
    let state: BackupState;
    try {
      const res = await putRoomSnapshot({ data: { snapshot, force: Boolean(opts.force) } });
      outcome = res.saved ? "saved" : "refused";
      state = res.saved ? { status: "ok", at: new Date().toISOString(), why: "Backed up." } : { status: "ok", at: null, why: `Not saved: ${res.why}.` };
    } catch (e) {
      outcome = isSignedOut(e) ? "signed_out" : "failed";
      state = localOnly(e);
    }
    memory = afterPush(memory, key, outcome);
    return state;
  };
  const p: Promise<BackupState> = run().finally(() => {
    if (inflight === p) inflight = null;
  });
  inflight = p;
  return p;
}
