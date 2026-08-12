/**
 * Shared machinery for the scheduled jobs in `src/routes/api/cron/*`.
 *
 * WHY THIS LIVES UNDER alerts/: a cron run and an alert are the same object in
 * this desk — a fact recorded once, idempotently, in `alert_log`, that may or
 * may not also reach a phone. Splitting them would mean two idempotency
 * mechanisms. (File ownership for this phase is also scoped to
 * `src/lib/alerts/*`; if a `src/lib/cron/` ever appears, move this verbatim.)
 *
 * ── AUTH ─────────────────────────────────────────────────────────────────
 * Identical contract and identical failure modes to `src/lib/bridge/
 * auth-server.ts`:
 *
 *   Authorization: Bearer <CRON_SECRET>
 *
 *   - `CRON_SECRET` unset/blank  -> 503. There is no "open" mode; a missing
 *     secret disables the schedule rather than dropping the gate. Otherwise a
 *     forgotten env var in a new environment would silently expose endpoints
 *     that write rows and send notifications.
 *   - Wrong / missing / malformed header -> 401, generic message. The supplied
 *     value is never echoed and the response never says which part failed.
 *   - Comparison is constant-time over SHA-256 digests, so neither length nor
 *     a shared prefix leaks through timing.
 *
 * This is exactly what Vercel Cron sends: setting `CRON_SECRET` on the project
 * makes Vercel attach `Authorization: Bearer <value>` to every invocation.
 *
 * ── DST: THE HONEST VERSION ──────────────────────────────────────────────
 * Vercel Cron schedules are **UTC and do not shift with daylight saving**.
 * There is no timezone field. So a single UTC expression cannot mean "09:15
 * America/New_York" all year — it is 09:15 ET for ~8 months and 08:15 ET for
 * the other ~4.
 *
 * Rather than pick a season to be wrong in, each job is scheduled TWICE — once
 * at its EDT-correct UTC time and once at its EST-correct UTC time — and every
 * handler checks the actual ET wall clock via `etWindow()` before doing any
 * work. Exactly one of the two lands in the target ET hour on any given day;
 * the other returns 200 `{ ran: false, skipped: "outside ET window" }` having
 * touched nothing. `alert_log`'s unique key is the second line of defence: even
 * if both somehow passed, only one row is ever written.
 *
 * The guard is hour-granular on purpose. Vercel's Hobby plan invokes a cron
 * anywhere within the scheduled HOUR (±59 min), so a minute-granular window
 * would drop most Hobby invocations. The consequence is honest and worth
 * stating: on Hobby the 09:15 ET checklist may actually arrive as late as
 * 09:59 ET — after the 09:30 open. On Pro it lands within the minute.
 */

import { createHash, timingSafeEqual } from "node:crypto";
import { jsonResponse } from "@/lib/bridge/auth-server";
import { etDateParts } from "@/lib/journal/risk";

export { jsonResponse };

function envValue(name: string): string | undefined {
  const raw = typeof process !== "undefined" ? process.env[name] : undefined;
  return raw && raw.trim() ? raw.trim() : undefined;
}

/** The configured shared secret, or undefined when unset/blank. */
export function cronSecret(): string | undefined {
  return envValue("CRON_SECRET");
}

/**
 * User id the scheduled jobs write rows against. A cron has no session, so it
 * cannot use `authMiddleware`; this mirrors how the engine bridge attributes
 * its headless writes. Falls back to the bridge's user, then to the repo-wide
 * preview user, so a single-user desk needs no extra configuration.
 */
export function cronUserId(): string {
  return envValue("CRON_USER_ID") ?? envValue("ENGINE_BRIDGE_USER_ID") ?? "dev-user";
}

/** Length-independent constant-time equality (compares SHA-256 digests). */
function secureEquals(a: string, b: string): boolean {
  const da = createHash("sha256").update(a, "utf8").digest();
  const db = createHash("sha256").update(b, "utf8").digest();
  return timingSafeEqual(da, db);
}

export type CronAuthResult =
  | { ok: true; userId: string }
  | { ok: false; response: Response };

/**
 * Authorize an inbound cron request. Returns the user id to write against, or
 * a ready Response (503 unconfigured / 401 rejected) to return verbatim.
 */
export function authorizeCronRequest(request: Request): CronAuthResult {
  const expected = cronSecret();
  if (!expected) {
    return {
      ok: false,
      response: jsonResponse({ ok: false, error: "Cron unavailable" }, 503),
    };
  }

  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  const presented = match?.[1]?.trim() ?? "";
  // Always run the compare (even for an empty presented value) so the rejected
  // path costs the same regardless of how the header was malformed.
  const authorized = secureEquals(presented, expected) && presented.length > 0;
  if (!authorized) {
    return {
      ok: false,
      response: jsonResponse({ ok: false, error: "Unauthorized" }, 401, {
        "www-authenticate": "Bearer",
      }),
    };
  }

  return { ok: true, userId: cronUserId() };
}

/* ------------------------------------------------------------------ */
/* ET scheduling window                                               */
/* ------------------------------------------------------------------ */

export interface EtWindow {
  /** True when the ET wall clock is inside the job's intended hour (and day). */
  inWindow: boolean;
  /** ET calendar date, YYYY-MM-DD — the natural once-per-day dedupe grain. */
  day: string;
  /** ET wall clock, HH:MM. */
  time: string;
  /** 0=Sun … 6=Sat, ET calendar. */
  weekday: number;
}

const pad2 = (n: number) => String(n).padStart(2, "0");

/**
 * Where the ET wall clock is right now relative to a job's target hour.
 *
 * @param targetHour ET hour the job is meant to run in (0-23).
 * @param weekday    Restrict to one ET weekday (0=Sun). Omit for any day.
 */
export function etWindow(
  now: Date,
  targetHour: number,
  weekday?: number,
): EtWindow {
  const p = etDateParts(now);
  const hour = Math.floor(p.minutes / 60);
  const minute = p.minutes % 60;
  return {
    inWindow:
      hour === targetHour && (weekday == null || p.weekday === weekday),
    day: `${p.year}-${pad2(p.month)}-${pad2(p.day)}`,
    time: `${pad2(hour)}:${pad2(minute)}`,
    weekday: p.weekday,
  };
}

/**
 * Should this invocation skip the ET-window check? Only ever true for an
 * ALREADY-AUTHENTICATED request (call it after `authorizeCronRequest`), so it
 * is a testing affordance, not a bypass: `curl -H "Authorization: Bearer …"
 * '…/api/cron/review?force=1'`. Idempotency still applies — a forced run on a
 * day the job already ran writes nothing.
 */
export function isForced(request: Request): boolean {
  const v = new URL(request.url).searchParams.get("force");
  return v === "1" || v === "true";
}

/** Uniform response shape for every scheduled job. */
export interface CronRunResult {
  ok: true;
  job: string;
  /** False when the ET-window guard or the idempotency key stopped the work. */
  ran: boolean;
  skipped?: string;
  etDay: string;
  etTime: string;
  /** Present when the job recorded (or would have recorded) an alert. */
  dedupeKey?: string;
  recorded?: boolean;
  delivered?: number;
  detail?: Record<string, unknown>;
}
