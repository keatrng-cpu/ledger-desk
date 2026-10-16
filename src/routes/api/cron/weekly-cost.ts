/**
 * GET /api/cron/weekly-cost — Sunday 18:30 ET weekly cost summary (Edgewonk Edge Finder style).
 *
 * Reads the week's closed LIVE fills, runs the existing discipline.ts scorecard and analytics.ts report over them,
 * prices the leaks (src/lib/journal/weekly-cost.ts), and lets Grok narrate those measured numbers only — a narration
 * carrying any other number is dropped for the deterministic lines. No badges, no streaks, no score. Nothing here
 * feeds a gate, a size or the PATH bands.
 *
 * Same auth/force/idempotency contract as ./weekly.ts. Dedupe key: `weekly-cost:<ET date of the Sunday>`.
 * DST: 22:30 and 23:30 UTC Sunday; the ET-hour guard keeps the 18:xx ET one.
 */
import { createFileRoute } from "@tanstack/react-router";
import { authorizeCronRequest, etWindow, isForced, jsonResponse, type CronRunResult } from "@/lib/alerts/cron";
import { sendAlert } from "@/lib/alerts/send-server";
import { getSql } from "@/lib/db";
import { tradingWeekStart } from "@/lib/journal/risk";
import { disciplineScorecard, type DisciplineRow } from "@/lib/journal/discipline";
import { buildAnalytics } from "@/lib/journal/analytics";
import { readClosed } from "@/lib/journal/analytics-server";
import { APLUS_RULES } from "@/lib/aplus/config";
import { buildWeeklyCost, narrateWeeklyCost } from "@/lib/journal/weekly-cost";

const TARGET_ET_HOUR = 18;
const TARGET_ET_WEEKDAY = 0;

type DRow = { status: "open" | "closed"; pnl: number | null; r: number | null; mistakes: unknown; override: boolean | null; desk_word: string | null; state_rating: number | null };

async function handleWeeklyCost({ request }: { request: Request }): Promise<Response> {
  const auth = authorizeCronRequest(request);
  if (!auth.ok) return auth.response;
  const now = new Date();
  const win = etWindow(now, TARGET_ET_HOUR, TARGET_ET_WEEKDAY);
  if (!win.inWindow && !isForced(request)) {
    return jsonResponse({ ok: true, job: "weekly-cost", ran: false, skipped: `outside ET window (target Sun ${TARGET_ET_HOUR}:xx ET)`, etDay: win.day, etTime: win.time } satisfies CronRunResult, 200);
  }
  try {
    const weekStart = tradingWeekStart(new Date(now.getTime() - 24 * 60 * 60 * 1000));
    const sql = await getSql();
    const [rows, trades] = await Promise.all([
      sql.query<DRow>(
        `select status, pnl, r, mistakes, override, desk_word, state_rating
           from desk_trades
          where user_id = $1 and mode = 'live' and status = 'closed'
            and closed_at >= $2::timestamptz and closed_at < $3::timestamptz`,
        [auth.userId, weekStart.toISOString(), now.toISOString()],
      ),
      readClosed(sql, auth.userId, "live", weekStart.toISOString()),
    ]);
    const drows: DisciplineRow[] = rows.map((r) => ({
      status: r.status,
      pnl: r.pnl,
      r: r.r,
      mistakes: Array.isArray(r.mistakes) ? (r.mistakes as unknown[]).filter((x): x is string => typeof x === "string") : null,
      override: r.override,
      deskWord: r.desk_word,
      stateRating: r.state_rating,
    }));
    const card = disciplineScorecard(drows);
    const report = trades.length ? buildAnalytics(trades, "live", APLUS_RULES.accountEquity) : null;
    const cost = buildWeeklyCost(weekStart.toISOString().slice(0, 10), card, report);
    const story = await narrateWeeklyCost(cost);

    const dedupeKey = `weekly-cost:${win.day}`;
    const result = await sendAlert(auth.userId, {
      kind: "cron_weekly_review",
      dedupeKey,
      title: `Week's costs · ${win.day}`,
      body: story.text,
      url: "/",
      payload: { weekStart: cost.weekStart, facts: cost.facts, lines: cost.lines, byModel: story.byModel, rejected: story.rejected },
    });
    return jsonResponse(
      {
        ok: true,
        job: "weekly-cost",
        ran: result.recorded,
        skipped: result.duplicate ? "already ran for this week" : undefined,
        etDay: win.day,
        etTime: win.time,
        dedupeKey,
        recorded: result.recorded,
        delivered: result.delivered,
        detail: { closed: cost.closed, facts: cost.facts.length, thin: cost.thin, narratedByModel: story.byModel, narrationRejected: story.rejected },
      } satisfies CronRunResult,
      200,
    );
  } catch (err) {
    console.error("[cron] weekly-cost failed:", err);
    return jsonResponse({ ok: false, error: "Weekly cost job failed" }, 500);
  }
}

export const Route = createFileRoute("/api/cron/weekly-cost")({
  server: { handlers: { GET: handleWeeklyCost } },
});
