/**
 * GET /api/cron/checklist — 09:15 ET premarket checklist (ROADMAP B5).
 *
 * TanStack Start server route (`server.handlers`), NOT a Nitro `server/routes/`
 * file: `vite.config.ts` only registers the Nitro plugin when
 * `command === "build"`, so a Nitro route would 404 in `npm run dev`. Start
 * server routes are compiled by `tanstackStart()` in both dev and build.
 *
 * GET because Vercel Cron issues an HTTP GET to the configured path — there is
 * no method option in `vercel.json`.
 *
 * Auth: `Authorization: Bearer <CRON_SECRET>` (see lib/alerts/cron.ts). Vercel
 * attaches that header automatically when `CRON_SECRET` is set on the project.
 *
 * Idempotent: the work is a single `alert_log` claim keyed
 * `checklist:<ET date>`. Re-invoking it — a Vercel retry, both DST schedules
 * landing in the same ET hour, a manual curl — writes nothing the second time.
 *
 * Writes a row rather than assuming a browser is open. That is the entire point
 * of B5: the checklist has to exist whether or not the tab was open at 09:15.
 *
 * DST: scheduled at BOTH 13:15 UTC (EDT) and 14:15 UTC (EST); the ET-window
 * guard below runs the one that is actually 09:xx ET. See lib/alerts/cron.ts.
 */

import { createFileRoute } from "@tanstack/react-router";
import {
  authorizeCronRequest,
  etWindow,
  isForced,
  jsonResponse,
  type CronRunResult,
} from "@/lib/alerts/cron";
import { fmtR, windowStats } from "@/lib/alerts/cron-stats-server";
import { sendAlert } from "@/lib/alerts/send-server";
import { tradingDayStart, tradingWeekStart } from "@/lib/journal/risk";
import { getSessionClock } from "@/lib/trading/sessions";

/** ET hour this job is meant to run in. */
const TARGET_ET_HOUR = 9;

async function handleChecklist({
  request,
}: {
  request: Request;
}): Promise<Response> {
  const auth = authorizeCronRequest(request);
  if (!auth.ok) return auth.response;

  const now = new Date();
  const win = etWindow(now, TARGET_ET_HOUR);
  const forced = isForced(request);

  if (!win.inWindow && !forced) {
    const skipped: CronRunResult = {
      ok: true,
      job: "checklist",
      ran: false,
      skipped: `outside ET window (target ${TARGET_ET_HOUR}:xx ET)`,
      etDay: win.day,
      etTime: win.time,
    };
    return jsonResponse(skipped, 200);
  }

  try {
    const clock = getSessionClock(now);
    // The session that is about to trade began at yesterday's 18:00 ET reopen.
    const dayStart = tradingDayStart(now);
    const weekStart = tradingWeekStart(now);

    const [overnight, week] = await Promise.all([
      windowStats(auth.userId, dayStart, now),
      windowStats(auth.userId, weekStart, now),
    ]);

    // Carried risk first — it is the only line that can cost money before the
    // open, and the only one a closed tab hides.
    const carried = overnight.live.open + overnight.paper.open;
    const parts = [
      carried > 0
        ? `${carried} position${carried === 1 ? "" : "s"} still OPEN`
        : "flat overnight",
      `week ${fmtR(week.live.sumR)} live`,
      `${week.skips} skips this week`,
      `next: ${clock.nextWindow}`,
    ];

    const body = `${parts.join(" · ")}. HTF bias + PDH/PDL before the 09:30 open.`;

    const result = await sendAlert(auth.userId, {
      kind: "cron_premarket_checklist",
      dedupeKey: `checklist:${win.day}`,
      title: `Premarket checklist · ${win.day}`,
      body,
      url: "/",
      payload: {
        etTime: win.time,
        killzone: clock.killzone,
        nextWindow: clock.nextWindow,
        carriedPositions: carried,
        overnight,
        week,
      },
    });

    const out: CronRunResult = {
      ok: true,
      job: "checklist",
      ran: result.recorded,
      skipped: result.duplicate ? "already ran for this ET day" : undefined,
      etDay: win.day,
      etTime: win.time,
      dedupeKey: `checklist:${win.day}`,
      recorded: result.recorded,
      delivered: result.delivered,
      detail: {
        carriedPositions: carried,
        weekLiveR: week.live.sumR,
        weekSkips: week.skips,
        pushDisabledReason: result.pushDisabledReason,
      },
    };
    return jsonResponse(out, 200);
  } catch (err) {
    // Detail server-side; the caller gets a generic message (no schema or
    // secret leakage — this endpoint is reachable by anyone with the URL).
    console.error("[cron] checklist failed:", err);
    return jsonResponse({ ok: false, error: "Checklist job failed" }, 500);
  }
}

export const Route = createFileRoute("/api/cron/checklist")({
  server: {
    handlers: {
      GET: handleChecklist,
    },
  },
});
