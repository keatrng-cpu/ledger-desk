/**
 * GET /api/cron/news-calendar — WS-CAL, weekdays 08:00 ET (before the 08:30 prints and the 09:30 open).
 *
 * Fetches the BLS and BEA release calendars and the Fed FOMC page, validates them the way the bundled
 * src/data/news-calendar.json is validated, diffs them against the file, and has Grok (web search) cross-check
 * the next high-impact rows against the agency pages — logged only.
 *
 * The rows reach the ±15m blackout (setLiveCalendar) ONLY when NEWS_LIVE_CALENDAR is on. Default OFF: the bundled
 * file stays the calendar of record and this job is a daily audit of it. Any fetch/parse/validation failure leaves
 * the bundled file in charge either way. docs/NEWS_LIVE_CALENDAR.md has the decision notes.
 *
 * DST: scheduled at 12:00 and 13:00 UTC; the ET-hour guard keeps the one that is 08:xx ET. Same auth/force contract
 * as ./checklist.ts.
 */
import { createFileRoute } from "@tanstack/react-router";
import { authorizeCronRequest, etWindow, isForced, jsonResponse, type CronRunResult } from "@/lib/alerts/cron";
import { runLiveCalendar } from "@/lib/news/calendar-live";

const TARGET_ET_HOUR = 8;

async function handleNewsCalendar({ request }: { request: Request }): Promise<Response> {
  const auth = authorizeCronRequest(request);
  if (!auth.ok) return auth.response;
  const now = new Date();
  const win = etWindow(now, TARGET_ET_HOUR);
  const wd = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" })).getDay();
  if ((!win.inWindow || wd === 0 || wd === 6) && !isForced(request)) {
    return jsonResponse(
      { ok: true, job: "news-calendar", ran: false, skipped: `outside ET window (target weekdays ${TARGET_ET_HOUR}:xx ET)`, etDay: win.day, etTime: win.time } satisfies CronRunResult,
      200,
    );
  }
  try {
    const run = await runLiveCalendar();
    console.log(
      "[cron] news-calendar",
      JSON.stringify({
        ok: run.ok,
        inCharge: run.inCharge,
        flagOn: run.flagOn,
        sources: run.sources,
        problems: run.problems,
        onlyLive: run.diff?.onlyLive.length ?? null,
        onlyBundledHigh: run.diff?.onlyBundledHigh.length ?? null,
        grokDisagreements: run.crossCheck?.disagreements ?? null,
        grokError: run.crossCheck?.error ?? null,
      }),
    );
    const out: CronRunResult = {
      ok: true,
      job: "news-calendar",
      ran: true,
      etDay: win.day,
      etTime: win.time,
      detail: {
        validated: run.ok,
        inCharge: run.inCharge,
        flagOn: run.flagOn,
        applied: run.applied,
        sources: run.sources,
        problems: run.problems,
        rows: run.rows.length,
        diff: run.diff,
        crossCheck: run.crossCheck,
      },
    };
    return jsonResponse(out, 200);
  } catch (err) {
    console.error("[cron] news-calendar failed:", err);
    return jsonResponse({ ok: false, error: "News calendar job failed — bundled calendar in charge" }, 500);
  }
}

export const Route = createFileRoute("/api/cron/news-calendar")({
  server: { handlers: { GET: handleNewsCalendar } },
});
