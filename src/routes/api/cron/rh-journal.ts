/**
 * GET /api/cron/rh-journal — keep the live-trade journal current on its own.
 *
 * Every minute of the options session the Netlify ringer calls this; it pulls
 * the latest Robinhood option fills, FIFO-builds round-trips, binds each to the
 * card that suggested it, and upserts rh_fill_journal (reconcileRhFills). So the
 * Review panel and the by-band/killzone learning rollup stay fresh without the
 * trader pressing "Reconcile now".
 *
 * READ-ONLY vs Robinhood. reconcileRhFills only ever calls get_option_orders /
 * get_pnl_trade_history / get_portfolio through tooling.raw — it has no path to
 * review() or place(). This job cannot open, close, or cancel anything.
 *
 * Auth: the house cron contract — Authorization: Bearer <CRON_SECRET>; 503 when
 * unset, 401 when wrong. CRON_USER_ID MUST be the trader's user id: the RH
 * refresh token is a row in rh_oauth keyed by user id and a cron has no session.
 * ?force=1 skips the ET-session clock only.
 */
import { createFileRoute } from "@tanstack/react-router";
import type { CronRunResult } from "@/lib/alerts/cron";

/** The options session, ET minutes — matches the ringer window (13–21 UTC). */
const SESSION_OPEN_MIN = 9 * 60 + 30;
const SESSION_LAST_MIN = 16 * 60;

/** One run per instance at a time; a double-ring does not double-reconcile. */
let inFlight: Promise<Response> | null = null;

async function run({ request }: { request: Request }): Promise<Response> {
  const { authorizeCronRequest, etWindow, isForced, jsonResponse } = await import("@/lib/alerts/cron");
  const auth = authorizeCronRequest(request);
  if (!auth.ok) return auth.response;

  const now = new Date();
  const win = etWindow(now, 0);
  const base = { ok: true as const, job: "rh-journal", etDay: win.day, etTime: win.time };

  // Cheap timing gate (the ringer already bounds hours; this covers weekends and
  // a manual off-hours ring without ?force). Reconcile is harmless any time, so
  // this only avoids needless broker reads.
  const { etWallParts } = await import("@/lib/trading/sessions");
  const wall = etWallParts(now.getTime());
  const etMin = wall.hour * 60 + wall.minute;
  const forced = isForced(request);
  const weekend = wall.weekday === 0 || wall.weekday === 6;
  if (!forced && (weekend || etMin < SESSION_OPEN_MIN || etMin >= SESSION_LAST_MIN + 15)) {
    return jsonResponse({ ...base, ran: false, skipped: weekend ? "weekend" : "outside options session" } satisfies CronRunResult, 200);
  }

  try {
    const { getSql } = await import("@/lib/db");
    const { reconcileRhFills } = await import("@/lib/journal/rh-reconcile");
    const sql = await getSql();
    const result = await reconcileRhFills(sql, auth.userId);
    if (!result.ok) {
      return jsonResponse({ ...base, ran: false, skipped: result.reason ?? "reconcile could not run", detail: { userId: auth.userId } } satisfies CronRunResult, 200);
    }
    return jsonResponse(
      {
        ...base,
        ran: true,
        detail: { userId: auth.userId, trips: result.trips, closed: result.closed, bound: result.bound, realizedTotal: result.realizedTotal },
      } satisfies CronRunResult,
      200,
    );
  } catch (err) {
    console.error("[cron] rh-journal failed:", err);
    return jsonResponse({ ok: false, error: "Journal reconcile failed" }, 500);
  }
}

async function handle(ctx: { request: Request }): Promise<Response> {
  if (inFlight) {
    const { authorizeCronRequest, etWindow, jsonResponse } = await import("@/lib/alerts/cron");
    const auth = authorizeCronRequest(ctx.request);
    if (!auth.ok) return auth.response;
    const win = etWindow(new Date(), 0);
    return jsonResponse({ ok: true, job: "rh-journal", ran: false, skipped: "a run is already in flight", etDay: win.day, etTime: win.time } satisfies CronRunResult, 200);
  }
  const p = run(ctx);
  inFlight = p;
  try {
    return await p;
  } finally {
    inFlight = null;
  }
}

export const Route = createFileRoute("/api/cron/rh-journal")({
  server: { handlers: { GET: handle } },
});
