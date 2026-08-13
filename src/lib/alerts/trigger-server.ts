/**
 * Session-authenticated triggers for the 4 real-time B4 alerts plus the 3 B5
 * scheduled jobs, all client-callable.
 *
 * WHY THIS FILE EXISTS. `send-server.ts`'s `sendAlert` + builders, and
 * `cron.ts`'s scheduled-job logic, were complete and correctly tested but had
 * ZERO callers anywhere in the app (2026-08-12 audit) — the four alerts were
 * never invoked from the trading code that would raise them, and the
 * scheduled jobs only had an HTTP entry point gated behind `CRON_SECRET`,
 * which nothing was configured to call (Netlify's scheduled-functions plugin
 * is commented out — no Pro plan). This file is both fixes:
 *
 *   1. The 4 real-time alerts get authenticated server fns a client poll can
 *      call directly (setup armed, position flattened, news blackout — halt
 *      hit is wired directly in journal/server.ts's openTrade instead, since
 *      that path is already fully server-side and needs no round trip).
 *   2. The 3 scheduled jobs get a session-authenticated equivalent of the
 *      existing CRON_SECRET-gated HTTP routes (src/routes/api/cron/*.ts,
 *      left untouched — they still work if Netlify Pro/Vercel cron is ever
 *      wired up later). `checkScheduledJobs` is called from the desk's
 *      existing 30s poll: each job checks its own ET window FIRST (cheap,
 *      no I/O) and only queries the database when inside it, so the added
 *      load during the other ~23 hours of the day is zero. This is honestly
 *      a WEAKER guarantee than a real cron: it only fires if a browser tab
 *      is open at some point during the target ET hour, not at a precise
 *      minute. Stated plainly rather than pretended around.
 *
 * All four builders' dedupe keys already make repeat calls safe (see
 * send-server.ts) — every function here is fire-and-forget from the caller's
 * perspective and never throws.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { authMiddleware } from "@/lib/auth/middleware";
import {
  sendAlert,
  setupArmedAlert,
  positionFlattenedAlert,
  newsBlackoutAlert,
} from "./send-server";
import { fmtR, fmtWr, windowStats } from "./cron-stats-server";
import { etWindow } from "./cron";
import { tradingDayStart, tradingWeekStart } from "@/lib/journal/risk";

/* ------------------------------------------------------------------ */
/* Real-time alerts (B4)                                              */
/* ------------------------------------------------------------------ */

const setupArmedInput = z.object({
  symbol: z.string().min(1).max(20),
  side: z.enum(["long", "short"]),
  candidateId: z.string().min(1).max(120),
  grade: z.string().nullable().optional(),
  confluence: z.number().nullable().optional(),
  killzone: z.string().nullable().optional(),
});

/** Called from the desk poll when the top candidate is actionable. */
export const raiseSetupArmedAlert = createServerFn({ method: "POST" })
  .validator((input: unknown) => setupArmedInput.parse(input))
  .middleware([authMiddleware])
  .handler(async ({ data, context }) => {
    return sendAlert(context.userId, setupArmedAlert(data));
  });

const positionFlattenedInput = z.object({
  tradeId: z.string().min(1).max(120),
  symbol: z.string().min(1).max(20),
  side: z.enum(["long", "short"]),
  reason: z.string().min(1).max(200),
  r: z.number().nullable().optional(),
});

/** Called from the desk poll when the paper auto-manager closes a position. */
export const raisePositionFlattenedAlert = createServerFn({ method: "POST" })
  .validator((input: unknown) => positionFlattenedInput.parse(input))
  .middleware([authMiddleware])
  .handler(async ({ data, context }) => {
    return sendAlert(context.userId, positionFlattenedAlert(data));
  });

const newsBlackoutInput = z.object({
  startsAt: z.string().min(1),
  event: z.string().min(1).max(120),
  impact: z.string().nullable().optional(),
});

/** Called from the desk poll when desk.news reports a high-impact event ~15m out. */
export const raiseNewsBlackoutAlert = createServerFn({ method: "POST" })
  .validator((input: unknown) => newsBlackoutInput.parse(input))
  .middleware([authMiddleware])
  .handler(async ({ data, context }) => {
    return sendAlert(context.userId, newsBlackoutAlert(data));
  });

/* ------------------------------------------------------------------ */
/* Scheduled jobs (B5), session-authenticated equivalent              */
/* ------------------------------------------------------------------ */

export interface SessionJobResult {
  job: "checklist" | "review" | "weekly";
  ran: boolean;
  skipped?: string;
  delivered?: number;
}

/** ET hours each job targets — mirrors src/routes/api/cron/*.ts exactly. */
const CHECKLIST_HOUR = 9;
const REVIEW_HOUR = 16;
const WEEKLY_HOUR = 18;
const WEEKLY_WEEKDAY = 0; // Sunday

async function runChecklist(userId: string, now: Date): Promise<SessionJobResult> {
  const win = etWindow(now, CHECKLIST_HOUR);
  if (!win.inWindow) return { job: "checklist", ran: false, skipped: "outside ET window" };

  const dayStart = tradingDayStart(now);
  const weekStart = tradingWeekStart(now);
  const [overnight, week] = await Promise.all([
    windowStats(userId, dayStart, now),
    windowStats(userId, weekStart, now),
  ]);
  const carried = overnight.live.open + overnight.paper.open;
  const body = [
    carried > 0 ? `${carried} position${carried === 1 ? "" : "s"} still OPEN` : "flat overnight",
    `week ${fmtR(week.live.sumR)} live`,
    `${week.skips} skips this week`,
  ].join(" · ");

  const result = await sendAlert(userId, {
    kind: "cron_premarket_checklist",
    dedupeKey: `checklist:${win.day}`,
    title: `Premarket checklist · ${win.day}`,
    body: `${body}. HTF bias + PDH/PDL before the 09:30 open.`,
    url: "/",
    payload: { etTime: win.time, carriedPositions: carried, overnight, week },
  });
  return {
    job: "checklist",
    ran: result.recorded,
    skipped: result.duplicate ? "already ran today" : undefined,
    delivered: result.delivered,
  };
}

async function runReview(userId: string, now: Date): Promise<SessionJobResult> {
  const win = etWindow(now, REVIEW_HOUR);
  if (!win.inWindow) return { job: "review", ran: false, skipped: "outside ET window" };

  const dayStart = tradingDayStart(now);
  const day = await windowStats(userId, dayStart, now);
  const l = day.live;
  const p = day.paper;
  const traded = l.closed + p.closed;
  const parts: string[] = [];
  if (l.closed > 0) parts.push(`live ${l.closed} closed ${fmtR(l.sumR)} (${fmtWr(l.wins, l.closed)})`);
  if (p.closed > 0) parts.push(`paper ${p.closed} closed ${fmtR(p.sumR)} (${fmtWr(p.wins, p.closed)})`);
  if (traded === 0) parts.push("no fills");
  parts.push(`${day.skips} skips of ${day.candidates} candidates`);
  if (day.halts > 0) parts.push(`${day.halts} HALT`);

  const result = await sendAlert(userId, {
    kind: "cron_session_review",
    dedupeKey: `review:${win.day}`,
    title: `Session review · ${win.day}`,
    body: `${parts.join(" · ")}. Review the skips before the setups.`,
    url: "/",
    payload: { etTime: win.time, day },
  });
  return {
    job: "review",
    ran: result.recorded,
    skipped: result.duplicate ? "already ran today" : undefined,
    delivered: result.delivered,
  };
}

const WEEKLY_MIN_N = 30;

async function runWeekly(userId: string, now: Date): Promise<SessionJobResult> {
  const win = etWindow(now, WEEKLY_HOUR, WEEKLY_WEEKDAY);
  if (!win.inWindow) return { job: "weekly", ran: false, skipped: "outside ET window" };

  const weekStart = tradingWeekStart(new Date(now.getTime() - 24 * 60 * 60 * 1000));
  const week = await windowStats(userId, weekStart, now);
  const l = week.live;
  const p = week.paper;
  const parts: string[] = [
    l.closed > 0 ? `live ${l.closed} closed ${fmtR(l.sumR)} (${fmtWr(l.wins, l.closed)})` : "live: no fills",
  ];
  if (p.closed > 0) parts.push(`paper ${p.closed} closed ${fmtR(p.sumR)} (${fmtWr(p.wins, p.closed)})`);
  parts.push(`${week.skips} skips of ${week.candidates} candidates`);
  const n = l.closed + p.closed;
  const caveat = n < WEEKLY_MIN_N ? ` n=${n} of ${WEEKLY_MIN_N} — directional only.` : "";

  const result = await sendAlert(userId, {
    kind: "cron_weekly_review",
    dedupeKey: `weekly:${win.day}`,
    title: `Week closed · ${win.day}`,
    body: `${parts.join(" · ")}.${caveat}`,
    url: "/",
    payload: { etTime: win.time, week },
  });
  return {
    job: "weekly",
    ran: result.recorded,
    skipped: result.duplicate ? "already ran this week" : undefined,
    delivered: result.delivered,
  };
}

/**
 * Check + (idempotently) raise all 3 scheduled jobs, in ONE server fn so the
 * poll loop makes one round trip instead of three. Each job's own ET-window
 * check runs first — the common case (23 of 24 hours) does zero database
 * work for that job.
 */
export const checkScheduledJobs = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<SessionJobResult[]> => {
    const now = new Date();
    return Promise.all([
      runChecklist(context.userId, now),
      runReview(context.userId, now),
      runWeekly(context.userId, now),
    ]);
  });
