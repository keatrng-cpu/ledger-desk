/**
 * Per-source status for the news chip: was BLS / BEA / Fed fetched and validated live, or is the desk on the file?
 * Uses this instance's last cron run when there is one; otherwise one fresh run (no Grok call), cached 6 h for
 * every client. Display only — runLiveCalendar applies rows only under NEWS_LIVE_CALENDAR, same as the cron.
 */
import { createServerFn } from "@tanstack/react-start";
import { lastLiveCalendarRun, liveCalendarFlagOn, runLiveCalendar, type LiveCalendarRun } from "./calendar-live";

export interface CalendarSources {
  at: string | null;
  flagOn: boolean;
  /** "live" = rows the desk's blackout actually reads came from the agencies; "file" = bundled news-calendar.json. */
  inCharge: "live" | "file";
  sources: { id: "BLS" | "BEA" | "Fed"; status: "live" | "file"; why: string | null }[];
}

const CACHE_MS = 6 * 60 * 60_000;
let cache: { at: number; run: LiveCalendarRun } | null = null;
let inflight: Promise<LiveCalendarRun> | null = null;

export function toSources(run: LiveCalendarRun | null, flagOn: boolean): CalendarSources {
  const s = (id: "BLS" | "BEA" | "Fed", k: "bls" | "bea" | "fed") => {
    const r = run?.sources[k];
    // A source counts as live only if it answered AND the whole run validated (a partial run is not used).
    return { id, status: r?.ok && run?.ok ? ("live" as const) : ("file" as const), why: !run ? "not checked yet" : r?.ok ? (run.ok ? null : run.problems[0] ?? "run failed") : r?.error ?? "failed" };
  };
  return { at: run?.at ?? null, flagOn, inCharge: run?.applied ? "live" : "file", sources: [s("BLS", "bls"), s("BEA", "bea"), s("Fed", "fed")] };
}

export const getCalendarSources = createServerFn({ method: "GET" }).handler(async (): Promise<CalendarSources> => {
  const flagOn = liveCalendarFlagOn();
  const last = lastLiveCalendarRun();
  if (last && Date.now() - Date.parse(last.at) < CACHE_MS) return toSources(last, flagOn);
  if (cache && Date.now() - cache.at < CACHE_MS) return toSources(cache.run, flagOn);
  if (!inflight) {
    inflight = runLiveCalendar({ crossCheck: async () => ({ ok: false, checked: [], disagreements: [], sources: [], error: "not run for the chip" }) })
      .then((run) => {
        cache = { at: Date.now(), run };
        return run;
      })
      .finally(() => {
        inflight = null;
      });
  }
  return toSources(await inflight, flagOn);
});
