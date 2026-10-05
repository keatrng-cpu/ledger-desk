/**
 * Whether the headless paper step may run, and the one write it is allowed.
 *
 * The step is the room's own paper book. It is not a broker, and it does not
 * set SERVER_RUNNER_BUILT — that flag stays false until a closed-tab paper
 * close has been observed. Nothing here is an edge.
 *
 * The write compares-and-swaps the saved_at that was read. It is not
 * SNAPSHOT_UPSERT_SQL: that statement writes whenever history is equal, and a
 * runner that stamped last_at from the clock would lock the browser out.
 * last_at here is rankOf's newest close, not now.
 */

import { EXEC_LIMITS } from "./exec/limits";
import { optionsOpen } from "./lab";

export function paperStepDue(nowMs: number, forced = false): { due: boolean; why: string } {
  if (forced) return { due: true, why: "forced" };
  if (!optionsOpen(nowMs)) return { due: false, why: "outside the options session" };
  return { due: true, why: "options session" };
}

/**
 * A browser that saved the book inside the executor lease still owns the step.
 * Two devices must not both count the same ticket. A saved_at in the future
 * (clock skew) is still held.
 */
export function browserHoldsLease(savedAtMs: number | null, nowMs: number): boolean {
  if (savedAtMs == null || !Number.isFinite(savedAtMs)) return false;
  const age = nowMs - savedAtMs;
  if (age < 0) return true;
  return age < EXEC_LIMITS.leaseSec * 1000;
}

/** Epoch ms from a driver value. The route reads extract(epoch) so this stays a number. */
export function savedAtMsOf(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === "bigint") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  if (v instanceof Date) {
    const n = v.getTime();
    return Number.isFinite(n) ? n : null;
  }
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim()) {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

/**
 * A synthetic desk is not a price: do not step, do not persist.
 * Yahoo and a late print still step, so an exit can fire. Entries already
 * fail fresh_tape. This is not a new exit veto.
 */
export function feedMayStep(feed: string): { step: boolean; why: string } {
  if (feed === "synthetic") return { step: false, why: "synthetic feed is not a price" };
  return { step: true, why: feed };
}

/** The order the route uses. Window, then the lease, then the feed. */
export function decidePaperStep(a: {
  nowMs: number;
  forced: boolean;
  savedAtMs: number | null;
  feed: string | null;
}): { act: "skip" | "step"; why: string } {
  const due = paperStepDue(a.nowMs, a.forced);
  if (!due.due) return { act: "skip", why: due.why };
  if (browserHoldsLease(a.savedAtMs, a.nowMs)) return { act: "skip", why: "browser holds the lease" };
  if (!a.feed) return { act: "skip", why: "no desk" };
  const feed = feedMayStep(a.feed);
  if (!feed.step) return { act: "skip", why: feed.why };
  return { act: "step", why: "options session" };
}

/**
 * Microsecond token, not a JS Date. node-pg's Date drops microseconds, and
 * `saved_at = $date` would then miss the row it just read.
 * $1 user id.
 */
export const PAPER_STEP_READ_SQL = `select body,
  (extract(epoch from saved_at) * 1000)::bigint as saved_ms,
  to_char(saved_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI:SS.US') as saved_at
from room_snapshot where user_id = $1 limit 1`;

/**
 * $1 user, $2 body json, $3 history, $4 last_at (rankOf, not now),
 * $5 the saved_at token from PAPER_STEP_READ_SQL.
 * Zero rows means someone else wrote. Do not retry in the same call.
 */
export const PAPER_STEP_CAS_SQL = `update room_snapshot
  set body = $2::jsonb, history = $3, last_at = $4, saved_at = now()
  where user_id = $1
    and to_char(saved_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI:SS.US') = $5
  returning user_id`;

/**
 * Cold start only: there was no row. on conflict do nothing — a browser that
 * inserted while we stepped keeps its copy. A richer browser push still wins
 * later through SNAPSHOT_UPSERT_SQL; this statement never force-replaces.
 */
export const PAPER_STEP_INSERT_SQL = `insert into room_snapshot (user_id, body, history, last_at, saved_at)
  values ($1, $2::jsonb, $3, $4, now())
on conflict (user_id) do nothing
returning user_id`;
