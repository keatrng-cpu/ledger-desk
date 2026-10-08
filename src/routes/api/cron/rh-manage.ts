/**
 * GET /api/cron/rh-manage — the DESK JOB that closes a live Robinhood option
 * when nobody is watching.
 *
 * WHAT WAS WRONG
 * --------------
 * The cycle could already decide to close (`decideRhCycle` → `runRhDesk`), but
 * every path that actually SENT that close was a passenger on something else:
 *
 *   - the browser poll (`room-engine.ts` → `stepRhDesk`) — dies with the tab,
 *   - `/api/cron/room-step` — runs every minute, but the Robinhood sender sits
 *     at the END of a paper-book pipeline. The sender is never reached when the
 *     desk build fails (503), the feed is synthetic (`feedMayStep`, 200 skipped),
 *     the stored snapshot is not a room book (200 skipped), the room's output
 *     violates its contract (500), the snapshot is oversized (500), the
 *     compare-and-swap loses to a browser write (200 skipped), or anything in
 *     `runRoomCycle` / `applyCycle` throws (500),
 *   - `/api/cron/exec-flatten` — only from 15:30 ET.
 *
 * So a wick that breaks the level at 10:05 with the tab closed had no closer
 * until 15:30 unless the paper book happened to write cleanly that minute. This
 * route is the close path with nothing upstream of it: no paper book, no
 * snapshot, no room cycle, no contract check. It reads the broker, reads the
 * desk, decides, and closes.
 *
 * IT CANNOT OPEN. Four independent layers, any one of which is sufficient:
 *   1. `manager: null` — no live Manager means no AGREE_LIVE ticket exists,
 *   2. `blockNewEntries: true` — `runRhDesk` rewrites a `place` phase to `look`,
 *   3. `closeOnlyTooling` (below) — `review` refuses and `place` THROWS on any
 *      leg that is not `{ side: "sell", position_effect: "close" }`. This layer
 *      lives here, in the caller, so a future edit to rh-dispatch.ts cannot
 *      quietly turn this job into an opener,
 *   4. the arm (`RH_DESK_JOB_CONFIRMED_IN_WRITING` + `RH_DESK_JOB_ENABLED`).
 *
 * WHAT IT CLOSES. Only what this system opened: `sqlLedger` is the desk book,
 * and `runRhDesk` leaves a Robinhood position with no row in it alone. There is
 * no "flatten everything" here — that is `/api/cron/exec-flatten`.
 *
 * STALE OR SYNTHETIC FEED. The desk is passed ONLY when the feed is real and
 * inside `RH_MAX_TAPE_AGE_SEC`. Otherwise `desk: null` is passed, which is a
 * hard refusal to read a level off a price we do not trust: with no desk the
 * futures invalidation and the 15-minute failed-hold cannot fire at all. The
 * exits that still fire are the ones priced on BROKER numbers, which are always
 * current — the −25% premium backstop, the drawdown breaker, and 15:30 ET.
 * This is deliberately not "send nothing on a stale feed": that reading would
 * disable the −25% backstop exactly when the tape is misbehaving.
 *
 * IDEMPOTENCY. Three things stop one wick sending two closes:
 *   - `refIdFor("close:<decisionKey>")` is a STABLE uuid per position, and
 *     rh-mcp passes it to `place_option_order` as `ref_id`, so a resend of the
 *     same close is deduped broker-side,
 *   - a successful close drops the row from the desk book, so the next run has
 *     nothing to close,
 *   - `ledger.claim(now)` — this route takes the one placement slot in
 *     `rh_desk_book` (a single conditional UPDATE, so two instances cannot both
 *     win) before it sends anything, and only when a desk-owned row exists. No
 *     row means nothing to close and the slot is left for an opener.
 *   Plus an in-process guard against the same instance being rung twice.
 *
 * KILL SWITCH. `RH_DESK_JOB_ENABLED` — unset or not exactly "true" and the job
 * does nothing at all. It is read per request, so flipping it in Netlify stops
 * the job on the next minute with no deploy. The Execution card's own kill
 * (`room_exec_state.killed`) is also read and reported; it blocks entries, and
 * by design it does NOT trap a close.
 *
 * OFF BY DEFAULT. `RH_DESK_JOB_CONFIRMED_IN_WRITING` ships `false`. Only a
 * human edits that line. See docs/RH_LIVE_ROUTINE.md for the preconditions.
 *
 * Auth: the house cron contract — `Authorization: Bearer <CRON_SECRET>`, 503
 * when the secret is unset, 401 when it is wrong (`lib/alerts/cron.ts`).
 * `CRON_USER_ID` MUST be the trader's user id: the Robinhood refresh token is a
 * row in `rh_oauth` keyed by user id, and a cron has no session. A wrong id
 * reads no token and sends nothing — the response says which id was used and
 * whether a sign-in was found, so that failure is visible instead of silent.
 * `?force=1` skips the ET clock only; it skips no arm and no gate.
 */

import { createFileRoute } from "@tanstack/react-router";
import type { CronRunResult } from "@/lib/alerts/cron";
import type { RhOrder } from "@/lib/execution/rh-cycle";
import type { RhReview, RhTooling } from "@/lib/execution/rh-tools";
import type { RhCycleDesk } from "@/lib/room/manager-live-loop";

/**
 * The human switch. A deploy never flips this; a person edits this line after
 * the preconditions in docs/RH_LIVE_ROUTINE.md are all true. Setting
 * RH_DESK_JOB_ENABLED=true alone is not enough, and editing this alone is not
 * enough either.
 */
export const RH_DESK_JOB_CONFIRMED_IN_WRITING = false;

/** The managed window, ET minutes. 15:30 (the flatten) is inside it. */
export const RH_MANAGE_OPEN_MIN = 9 * 60 + 30;
export const RH_MANAGE_LAST_MIN = 16 * 60;

/** Tape age past which a level is not read. Mirrors the entry gate's number. */
export const RH_MANAGE_MAX_LAG_SEC = 30;

export interface RhManageGate {
  ok: boolean;
  why: string;
}

/** Both switches, read per request. Neither alone arms the job. */
export function rhManageArmed(env: Record<string, string | undefined>): RhManageGate {
  if (!RH_DESK_JOB_CONFIRMED_IN_WRITING) {
    return { ok: false, why: "RH_DESK_JOB_CONFIRMED_IN_WRITING is false — a human has not switched the desk job on." };
  }
  if ((env.RH_DESK_JOB_ENABLED ?? "").trim() !== "true") {
    return { ok: false, why: "RH_DESK_JOB_ENABLED is not true — the kill switch is on." };
  }
  return { ok: true, why: "The desk job is armed." };
}

/**
 * Inside the managed session. Weekends never. `forced` skips the clock for a
 * manual run and nothing else.
 */
export function rhManageDue(args: { etMin: number; weekday: number; forced: boolean }): RhManageGate {
  if (args.weekday === 0 || args.weekday === 6) return { ok: false, why: "weekend" };
  if (args.forced) return { ok: true, why: "forced" };
  if (!Number.isFinite(args.etMin)) return { ok: false, why: "no ET clock" };
  if (args.etMin < RH_MANAGE_OPEN_MIN) return { ok: false, why: "before 09:30 ET" };
  if (args.etMin >= RH_MANAGE_LAST_MIN) return { ok: false, why: "after 16:00 ET" };
  return { ok: true, why: "options session" };
}

/**
 * Whether a level may be read off this desk. Synthetic is never a price; a late
 * print is not an execution clock. Failing this does not stop the run — it
 * drops the desk, so only broker-priced exits remain.
 */
export function deskTrusted(args: { feed: string | null | undefined; lagSec: number | null }): RhManageGate {
  if (!args.feed) return { ok: false, why: "no desk feed" };
  if (args.feed === "synthetic") return { ok: false, why: "synthetic feed is not a price" };
  const lag = args.lagSec;
  if (lag == null || !Number.isFinite(lag)) return { ok: false, why: "tape age unknown" };
  if (lag > RH_MANAGE_MAX_LAG_SEC) return { ok: false, why: `tape ${Math.round(lag)}s old (> ${RH_MANAGE_MAX_LAG_SEC}s)` };
  return { ok: true, why: `${args.feed}, ${Math.round(lag)}s` };
}

/** A sell-to-close on every leg, and nothing else. An empty order is not one. */
export function isCloseOnlyOrder(order: Pick<RhOrder, "legs">): boolean {
  const legs = order?.legs;
  if (!Array.isArray(legs) || legs.length === 0) return false;
  return legs.every((l) => l?.side === "sell" && l?.position_effect === "close");
}

export const CLOSE_ONLY_REFUSAL = "The desk job may only close. This order opens.";

/**
 * The send boundary this route owns. `review` refuses an opening order with a
 * blocking alert; `place` throws. Every read passes through untouched.
 */
export function closeOnlyTooling(inner: RhTooling): RhTooling {
  return {
    readAccount: () => inner.readAccount(),
    dayPnlPct: () => inner.dayPnlPct(),
    positions: () => inner.positions(),
    quote: (id) => inner.quote(id),
    findOption: (q) => inner.findOption(q),
    async review(order): Promise<RhReview> {
      if (!isCloseOnlyOrder(order)) return { ok: false, blocking: true, alerts: [CLOSE_ONLY_REFUSAL] };
      return inner.review(order);
    },
    async place(order, refId): Promise<{ id: string }> {
      if (!isCloseOnlyOrder(order)) throw new Error(CLOSE_ONLY_REFUSAL);
      return inner.place(order, refId);
    },
  };
}

/** One run per instance at a time. A scheduler that double-rings does not double-send. */
let inFlight: Promise<Response> | null = null;

async function run({ request }: { request: Request }): Promise<Response> {
  const { authorizeCronRequest, etWindow, isForced, jsonResponse } = await import("@/lib/alerts/cron");
  const auth = authorizeCronRequest(request);
  if (!auth.ok) return auth.response;

  const now = new Date();
  const win = etWindow(now, 0);
  const base = { ok: true as const, job: "rh-manage", etDay: win.day, etTime: win.time };

  const armed = rhManageArmed(process.env as Record<string, string | undefined>);
  if (!armed.ok) return jsonResponse({ ...base, ran: false, skipped: armed.why } satisfies CronRunResult, 200);

  const { etWallParts } = await import("@/lib/trading/sessions");
  const wall = etWallParts(now.getTime());
  const due = rhManageDue({ etMin: wall.hour * 60 + wall.minute, weekday: wall.weekday, forced: isForced(request) });
  if (!due.ok) return jsonResponse({ ...base, ran: false, skipped: due.why } satisfies CronRunResult, 200);

  try {
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();

    const { sqlLedger } = await import("@/lib/execution/rh-ledger");
    const ledger = sqlLedger(sql);
    const rows = await ledger.list();
    if (!rows.length) {
      return jsonResponse(
        { ...base, ran: false, skipped: "nothing this desk opened is on", detail: { userId: auth.userId, rows: 0 } } satisfies CronRunResult,
        200,
      );
    }

    const { readOauth } = await import("@/lib/execution/rh-oauth");
    const linked = (await readOauth(sql, auth.userId).catch(() => null)) != null;

    const { toolingForDesk } = await import("@/lib/execution/rh-mcp");
    const inner = await toolingForDesk(sql, auth.userId);
    if (!inner) {
      return jsonResponse(
        {
          ...base,
          ran: false,
          skipped: "no Robinhood session for this user id — nothing was sent",
          detail: { userId: auth.userId, linked, rows: rows.length },
        } satisfies CronRunResult,
        200,
      );
    }

    // The desk is read for the level and the 15-minute close only. A failure
    // here is not a reason to leave a position unmanaged: the premium backstop,
    // the drawdown breaker and 15:30 are all priced on broker numbers.
    let feed: string | null = null;
    let lagSec: number | null = null;
    let deskArg: RhCycleDesk | null = null;
    let trust: RhManageGate = { ok: false, why: "desk not read" };
    try {
      const { fetchTradingDesk } = await import("@/lib/trading/build-desk");
      const res = await fetchTradingDesk({ data: { left: "MNQ", right: "ES" } });
      if (res.ok) {
        feed = res.feed;
        lagSec = Math.max(res.quotes.left.lagSec, res.quotes.right.lagSec);
        trust = deskTrusted({ feed, lagSec });
        if (trust.ok) deskArg = res;
      } else {
        trust = { ok: false, why: "desk build failed" };
      }
    } catch (err) {
      console.error("[cron] rh-manage desk read failed:", err);
      trust = { ok: false, why: "desk read threw" };
    }

    let killed = false;
    try {
      const { PgExecStore } = await import("@/lib/room/exec/exec-sql");
      killed = (await new PgExecStore((t, p) => sql.query(t, p), auth.userId).state()).killed === true;
    } catch {
      // Unreadable kill state blocks entries. This job never opens, so it only
      // gets reported.
      killed = true;
    }

    // One closer per placement slot, across instances. Only reached because a
    // desk-owned row exists, so an opener is not waiting on this.
    const nowMs = Date.now();
    const claimed = await ledger.claim(nowMs);
    if (!claimed) {
      return jsonResponse(
        {
          ...base,
          ran: false,
          skipped: "another placement holds the slot — nothing was sent",
          detail: { userId: auth.userId, linked, rows: rows.length, feed, lagSec, desk: trust.why, killed },
        } satisfies CronRunResult,
        200,
      );
    }

    const { runRhDesk } = await import("@/lib/execution/rh-dispatch");
    const out = await runRhDesk({
      desk: deskArg,
      manager: null,
      nowMs,
      tooling: closeOnlyTooling(inner),
      ledger,
      blockNewEntries: true,
    });

    if (out.sent && out.cycle.phase !== "close") {
      // Cannot happen (four layers). If it ever does, it is the loudest line in the log.
      console.error("[cron] rh-manage sent a non-close phase:", out.cycle.phase);
    }

    return jsonResponse(
      {
        ...base,
        ran: true,
        detail: {
          userId: auth.userId,
          linked,
          rows: rows.length,
          feed,
          lagSec,
          desk: trust.why,
          levelsRead: trust.ok,
          killed,
          phase: out.cycle.phase,
          sent: out.sent,
          why: out.why,
          orderId: out.orderId,
        },
      } satisfies CronRunResult,
      200,
    );
  } catch (err) {
    console.error("[cron] rh-manage failed:", err);
    return jsonResponse({ ok: false, error: "Desk job failed" }, 500);
  }
}

async function handle(ctx: { request: Request }): Promise<Response> {
  if (inFlight) {
    const { authorizeCronRequest, etWindow, jsonResponse } = await import("@/lib/alerts/cron");
    const auth = authorizeCronRequest(ctx.request);
    if (!auth.ok) return auth.response;
    const win = etWindow(new Date(), 0);
    return jsonResponse(
      { ok: true, job: "rh-manage", ran: false, skipped: "a run is already in flight", etDay: win.day, etTime: win.time } satisfies CronRunResult,
      200,
    );
  }
  const p = run(ctx);
  inFlight = p;
  try {
    return await p;
  } finally {
    inFlight = null;
  }
}

export const Route = createFileRoute("/api/cron/rh-manage")({
  server: {
    handlers: {
      GET: handle,
    },
  },
});
