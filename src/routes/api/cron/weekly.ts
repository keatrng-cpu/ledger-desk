/**
 * GET /api/cron/weekly — Sunday 18:00 ET week close (ROADMAP B5).
 *
 * Runs at the CME weekly reopen, so the window it reports is the week that just
 * finished: previous Sunday 18:00 ET -> now. ROADMAP B5 also wants this slot to
 * kick a week-backtest -> brain update; that is deliberately NOT done here.
 * `session-backtest` is a heavy, network-dependent job and wiring it into a
 * 10-second serverless invocation would make the ONE scheduled job that
 * produces the weekly evidence the flakiest thing in the repo. This endpoint
 * records the measured week from the database — which is the part that must
 * never be missed — and INTEGRATION-C.md names the backtest hook as the
 * follow-up.
 *
 * Same route/auth/idempotency contract as ./checklist.ts. Dedupe key:
 * `weekly:<ET date of the Sunday>`.
 *
 * DST: scheduled at BOTH 22:00 UTC (EDT) and 23:00 UTC (EST) on Sunday. Both
 * land on an ET Sunday, so the weekday guard is safe either way.
 */

import { createFileRoute } from "@tanstack/react-router";
import {
  authorizeCronRequest,
  etWindow,
  isForced,
  jsonResponse,
  type CronRunResult,
} from "@/lib/alerts/cron";
import { fmtR, fmtWr, windowStats } from "@/lib/alerts/cron-stats-server";
import { sendAlert } from "@/lib/alerts/send-server";
import { tradingWeekStart } from "@/lib/journal/risk";

/** ET hour and weekday (0=Sun) this job is meant to run in. */
const TARGET_ET_HOUR = 18;
const TARGET_ET_WEEKDAY = 0;

/** Sample size below which a win rate is noise, not a measurement. */
const MIN_MEANINGFUL_N = 30;

async function handleWeekly({
  request,
}: {
  request: Request;
}): Promise<Response> {
  const auth = authorizeCronRequest(request);
  if (!auth.ok) return auth.response;

  const now = new Date();
  const win = etWindow(now, TARGET_ET_HOUR, TARGET_ET_WEEKDAY);
  const forced = isForced(request);

  if (!win.inWindow && !forced) {
    const skipped: CronRunResult = {
      ok: true,
      job: "weekly",
      ran: false,
      skipped: `outside ET window (target Sun ${TARGET_ET_HOUR}:xx ET)`,
      etDay: win.day,
      etTime: win.time,
    };
    return jsonResponse(skipped, 200);
  }

  try {
    // At 18:0x ET Sunday the new trading week has just begun, so
    // `tradingWeekStart(now)` would be a few minutes ago and the report would
    // be empty. Anchor 24h back (Saturday), whose week start is the Sunday
    // that opened the week now closing.
    const weekStart = tradingWeekStart(new Date(now.getTime() - 24 * 60 * 60 * 1000));
    const week = await windowStats(auth.userId, weekStart, now);

    const l = week.live;
    const p = week.paper;
    const parts: string[] = [];
    parts.push(
      l.closed > 0
        ? `live ${l.closed} closed ${fmtR(l.sumR)} (${fmtWr(l.wins, l.closed)})`
        : "live: no fills",
    );
    if (p.closed > 0) {
      parts.push(`paper ${p.closed} closed ${fmtR(p.sumR)} (${fmtWr(p.wins, p.closed)})`);
    }
    parts.push(`${week.skips} skips of ${week.candidates} candidates`);

    // Sample-size honesty, matching the analytics panel: a week's win rate on
    // n<30 is directional at best, and saying so in the notification is the
    // only place it can't be scrolled past.
    const n = l.closed + p.closed;
    const caveat =
      n < MIN_MEANINGFUL_N
        ? ` n=${n} of ${MIN_MEANINGFUL_N} — directional only.`
        : "";

    const dedupeKey = `weekly:${win.day}`;
    const result = await sendAlert(auth.userId, {
      kind: "cron_weekly_review",
      dedupeKey,
      title: `Week closed · ${win.day}`,
      body: `${parts.join(" · ")}.${caveat}`,
      url: "/",
      payload: {
        etTime: win.time,
        windowStart: weekStart.toISOString(),
        windowEnd: now.toISOString(),
        week,
      },
    });

    const out: CronRunResult = {
      ok: true,
      job: "weekly",
      ran: result.recorded,
      skipped: result.duplicate ? "already ran for this week" : undefined,
      etDay: win.day,
      etTime: win.time,
      dedupeKey,
      recorded: result.recorded,
      delivered: result.delivered,
      detail: {
        windowStart: weekStart.toISOString(),
        liveClosed: l.closed,
        liveSumR: l.sumR,
        paperClosed: p.closed,
        paperSumR: p.sumR,
        skips: week.skips,
        sampleN: n,
        meaningful: n >= MIN_MEANINGFUL_N,
        pushDisabledReason: result.pushDisabledReason,
      },
    };
    return jsonResponse(out, 200);
  } catch (err) {
    console.error("[cron] weekly failed:", err);
    return jsonResponse({ ok: false, error: "Weekly job failed" }, 500);
  }
}

export const Route = createFileRoute("/api/cron/weekly")({
  server: {
    handlers: {
      GET: handleWeekly,
    },
  },
});
