/**
 * The 8:20 CT pre-open check: is the watcher alive and on the desk's rules before the bell?
 * Pure (inputs in, verdict + events out) so it is testable; desk-preopen.mjs does the fetch and the post.
 * Read-only: it looks at /api/desk/watcher and the desk RULES_HASH. It never arms, fires or orders.
 */
import type { DeskEvent } from "./desk-alert";

export const PREOPEN_STALE_S = 180;

/** Chicago wall clock for an instant (DST-correct via Intl). */
export function ctParts(ms: number): { day: string; hour: number; minute: number; weekday: string } {
  const f = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short", hour12: false });
  const p = Object.fromEntries(f.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) % 24, minute: Number(p.minute), weekday: p.weekday };
}

/** Netlify cron runs in UTC at 13:20 and 14:20; exactly one of them is 08:20 CT depending on DST. */
export function isPreopenSlot(ms: number): boolean {
  const c = ctParts(ms);
  return c.hour === 8 && c.minute >= 15 && c.minute <= 30 && !["Sat", "Sun"].includes(c.weekday);
}

export type WatcherFeed = { ok?: boolean; status?: { rules_hash?: string | null; heartbeat?: number; fire_enabled?: boolean } | null; heartbeatAgeS?: number | null; stale?: boolean } | null;

export function evaluatePreopen(feed: WatcherFeed, expectedHash: string, nowMs: number): { ok: boolean; failures: string[]; events: DeskEvent[] } {
  const day = ctParts(nowMs).day;
  const failures: string[] = [];
  const events: DeskEvent[] = [];
  if (!feed || feed.ok === false) failures.push("watcher feed unreachable");
  else if (!feed.status) failures.push("watcher has never reported");
  else {
    const age = feed.heartbeatAgeS ?? null;
    if (age == null || age > PREOPEN_STALE_S) {
      failures.push(`watcher heartbeat ${age == null ? "missing" : `${Math.round(age)}s old`} (max ${PREOPEN_STALE_S}s)`);
      events.push({ type: "watcher_down", heartbeatAgeS: age });
    }
    const got = feed.status.rules_hash ?? null;
    if (got !== expectedHash) {
      failures.push(`rules hash ${got ?? "none"} != desk ${expectedHash}`);
      events.push({ type: "rules_hash_mismatch", expected: expectedHash, got });
    }
  }
  events.push({ type: "preopen_check", ok: failures.length === 0, day, failures });
  return { ok: failures.length === 0, failures, events };
}
