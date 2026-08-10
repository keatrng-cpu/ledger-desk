/**
 * News / econ-calendar gate — deterministic, ET-correct via Intl.
 * Blackout ±15 min around high-impact releases; caution ±60 min high /
 * ±15 min medium. Calendar lives in src/data/news-calendar.json (see
 * src/data/news-calendar.md for how it is sourced and maintained).
 */

import rawCalendar from "@/data/news-calendar.json";
import { etWallToEpochMs } from "./sessions";

export interface NewsEvent {
  /** ET calendar date, "YYYY-MM-DD". */
  date: string;
  /** ET wall-clock release time, 24h "HH:MM". */
  timeEt: string;
  name: string;
  impact: "high" | "medium";
}

export type NewsVerdict = "blackout" | "caution" | "clear";

export interface NewsRead {
  verdict: NewsVerdict;
  reason: string;
  nextEvent: { name: string; timeEt: string; minutesAway: number } | null;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;

function isNewsEvent(x: unknown): x is NewsEvent {
  if (typeof x !== "object" || x === null) return false;
  const e = x as Record<string, unknown>;
  return (
    typeof e.date === "string" &&
    DATE_RE.test(e.date) &&
    typeof e.timeEt === "string" &&
    TIME_RE.test(e.timeEt) &&
    typeof e.name === "string" &&
    e.name.length > 0 &&
    (e.impact === "high" || e.impact === "medium")
  );
}

/** Bundled calendar, runtime-validated so a bad edit degrades to "clear". */
export const NEWS_CALENDAR: NewsEvent[] = (
  Array.isArray(rawCalendar) ? rawCalendar : []
).filter(isNewsEvent);

const BLACKOUT_HIGH_MIN = 15;
const CAUTION_HIGH_MIN = 60;
const CAUTION_MEDIUM_MIN = 15;

/**
 * Deterministic news gate.
 * - blackout: high-impact event within ±15 min
 * - caution:  high within ±60 min, or medium within ±15 min
 * - clear:    otherwise
 * nextEvent is the nearest upcoming calendar entry (minutesAway ≥ 0).
 */
export function newsRead(
  now: Date,
  calendar: NewsEvent[] = NEWS_CALENDAR,
): NewsRead {
  const nowMs = now.getTime();

  let verdict: NewsVerdict = "clear";
  let reason = "No scheduled high-impact release inside the risk window.";
  let trigger: { event: NewsEvent; minutesAway: number } | null = null;
  let next: { event: NewsEvent; minutesAway: number } | null = null;

  for (const event of calendar) {
    const eventMs = etWallToEpochMs(event.date, event.timeEt);
    const minutesAway = Math.round((eventMs - nowMs) / 60_000);
    const abs = Math.abs(minutesAway);

    if (minutesAway >= 0 && (!next || minutesAway < next.minutesAway)) {
      next = { event, minutesAway };
    }

    const isBlackout = event.impact === "high" && abs <= BLACKOUT_HIGH_MIN;
    const isCaution =
      (event.impact === "high" && abs <= CAUTION_HIGH_MIN) ||
      (event.impact === "medium" && abs <= CAUTION_MEDIUM_MIN);

    if (isBlackout) {
      if (verdict !== "blackout" || (trigger && abs < Math.abs(trigger.minutesAway))) {
        verdict = "blackout";
        trigger = { event, minutesAway };
      }
    } else if (isCaution && verdict !== "blackout") {
      if (verdict !== "caution" || (trigger && abs < Math.abs(trigger.minutesAway))) {
        verdict = "caution";
        trigger = { event, minutesAway };
      }
    }
  }

  if (trigger) {
    const { event, minutesAway } = trigger;
    const when =
      minutesAway > 0
        ? `in ${minutesAway} min`
        : minutesAway < 0
          ? `${-minutesAway} min ago`
          : "now";
    reason =
      verdict === "blackout"
        ? `${event.name} ${event.timeEt} ET ${when} — stand down, no entries through the release.`
        : `${event.name} ${event.timeEt} ET ${when} — reduce size / widen expectations.`;
  }

  return {
    verdict,
    reason,
    nextEvent: next
      ? {
          name: next.event.name,
          timeEt: next.event.timeEt,
          minutesAway: next.minutesAway,
        }
      : null,
  };
}
