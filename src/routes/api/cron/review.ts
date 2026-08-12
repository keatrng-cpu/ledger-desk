/**
 * GET /api/cron/review — 16:15 ET forced review of the day (ROADMAP B5).
 *
 * "Forced" is the operative word. The review that gets skipped is the one after
 * a losing day, which is the only one that was ever going to teach anything.
 * Running it on a schedule and writing the row makes skipping it visible: an
 * `alert_log` gap on 2026-08-04 is evidence, where a review you meant to do
 * leaves nothing behind at all.
 *
 * Reports the day's SKIPS as prominently as its closed R. A skip is a decision;
 * a desk that only counts fills measures half its own behaviour.
 *
 * Same route/auth/idempotency contract as ./checklist.ts — see that file's
 * header for the TanStack-vs-Nitro note, the Bearer contract, and the DST
 * reasoning. Dedupe key: `review:<ET date>`.
 *
 * DST: scheduled at BOTH 20:15 UTC (EDT) and 21:15 UTC (EST).
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
import { tradingDayStart } from "@/lib/journal/risk";

/** ET hour this job is meant to run in. */
const TARGET_ET_HOUR = 16;

async function handleReview({
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
      job: "review",
      ran: false,
      skipped: `outside ET window (target ${TARGET_ET_HOUR}:xx ET)`,
      etDay: win.day,
      etTime: win.time,
    };
    return jsonResponse(skipped, 200);
  }

  try {
    // The trading day began at the 18:00 ET reopen the evening before, so this
    // window covers the overnight session as well as today's RTH.
    const dayStart = tradingDayStart(now);
    const day = await windowStats(auth.userId, dayStart, now);

    const l = day.live;
    const p = day.paper;
    const traded = l.closed + p.closed;

    // Skips lead when nothing was traded — "0 trades, 14 skips" is a good day
    // and should not read like a dead one.
    const parts: string[] = [];
    if (l.closed > 0) {
      parts.push(`live ${l.closed} closed ${fmtR(l.sumR)} (${fmtWr(l.wins, l.closed)})`);
    }
    if (p.closed > 0) {
      parts.push(`paper ${p.closed} closed ${fmtR(p.sumR)} (${fmtWr(p.wins, p.closed)})`);
    }
    if (traded === 0) parts.push("no fills");
    parts.push(`${day.skips} skips of ${day.candidates} candidates`);
    if (day.halts > 0) parts.push(`${day.halts} HALT`);
    if (l.open + p.open > 0) parts.push(`${l.open + p.open} still open`);

    const body = `${parts.join(" · ")}. Review the skips before the setups.`;

    const dedupeKey = `review:${win.day}`;
    const result = await sendAlert(auth.userId, {
      kind: "cron_session_review",
      dedupeKey,
      title: `Session review · ${win.day}`,
      body,
      url: "/",
      payload: {
        etTime: win.time,
        windowStart: dayStart.toISOString(),
        windowEnd: now.toISOString(),
        day,
      },
    });

    const out: CronRunResult = {
      ok: true,
      job: "review",
      ran: result.recorded,
      skipped: result.duplicate ? "already ran for this ET day" : undefined,
      etDay: win.day,
      etTime: win.time,
      dedupeKey,
      recorded: result.recorded,
      delivered: result.delivered,
      detail: {
        liveClosed: l.closed,
        liveSumR: l.sumR,
        paperClosed: p.closed,
        paperSumR: p.sumR,
        skips: day.skips,
        candidates: day.candidates,
        halts: day.halts,
        pushDisabledReason: result.pushDisabledReason,
      },
    };
    return jsonResponse(out, 200);
  } catch (err) {
    console.error("[cron] review failed:", err);
    return jsonResponse({ ok: false, error: "Review job failed" }, 500);
  }
}

export const Route = createFileRoute("/api/cron/review")({
  server: {
    handlers: {
      GET: handleReview,
    },
  },
});
