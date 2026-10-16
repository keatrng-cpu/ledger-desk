/**
 * GET /api/cron/actuals — weekdays 08:45 ET, fifteen minutes after the 08:30 prints.
 *
 * For every CPI / PPI / NFP / GDP / PCE row on today's bundled calendar that week-prints.json does not carry yet,
 * computes the official actual from the BLS API (BEA API with BEA_API_KEY) — numbers by code, never a model — and
 * logs/returns it as a ready-to-stamp row. A serverless function cannot write the committed data file, so the stamp
 * itself is `npx tsx scripts/stamp-actuals.mjs --date <today> --write` (docs/NEWS_LIVE_CALENDAR.md §2).
 * Narration only: nothing here reaches a gate, a score or a size.
 *
 * DST: 12:45 and 13:45 UTC; the ET-hour guard keeps the 08:xx ET one.
 */
import { createFileRoute } from "@tanstack/react-router";
import { authorizeCronRequest, etWindow, isForced, jsonResponse, type CronRunResult } from "@/lib/alerts/cron";
import { NEWS_CALENDAR } from "@/lib/trading/news";
import rawPrints from "@/data/week-prints.json";
import { alreadyStamped, computeActual, kindOf, refMatches, type WeekPrint } from "@/lib/news/actuals";

const TARGET_ET_HOUR = 8;

async function handleActuals({ request }: { request: Request }): Promise<Response> {
  const auth = authorizeCronRequest(request);
  if (!auth.ok) return auth.response;
  const now = new Date();
  const win = etWindow(now, TARGET_ET_HOUR);
  if (!win.inWindow && !isForced(request)) {
    return jsonResponse({ ok: true, job: "actuals", ran: false, skipped: `outside ET window (target weekdays ${TARGET_ET_HOUR}:xx ET)`, etDay: win.day, etTime: win.time } satisfies CronRunResult, 200);
  }
  const prints = (Array.isArray(rawPrints) ? rawPrints : []) as WeekPrint[];
  const rows = NEWS_CALENDAR.filter((e) => e.date === win.day && kindOf(e.name) && !alreadyStamped(prints, e.date, e.name));
  const ready: { name: string; actual: string; vs: string }[] = [];
  const failed: { name: string; why: string }[] = [];
  for (const r of rows) {
    try {
      const c = await computeActual(kindOf(r.name)!, Number(win.day.slice(0, 4)));
      if (!c) throw new Error("no usable observation");
      if (!refMatches(r.name, c)) throw new Error("agency series not updated for this month yet");
      ready.push({ name: r.name, actual: c.actual, vs: c.vs });
    } catch (e) {
      failed.push({ name: r.name, why: String(e instanceof Error ? e.message : e).slice(0, 120) });
    }
  }
  console.log("[cron] actuals", JSON.stringify({ day: win.day, ready, failed }));
  return jsonResponse({ ok: true, job: "actuals", ran: true, etDay: win.day, etTime: win.time, detail: { ready, failed, stamp: `npx tsx scripts/stamp-actuals.mjs --date ${win.day} --write` } } satisfies CronRunResult, 200);
}

export const Route = createFileRoute("/api/cron/actuals")({
  server: { handlers: { GET: handleActuals } },
});
