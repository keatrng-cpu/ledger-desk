/**
 * News / econ-calendar gate — deterministic, ET-correct via Intl.
 * Blackout ±15 min around high-impact releases; caution ±60 min high /
 * ±15 min medium. Calendar lives in src/data/news-calendar.json (see
 * src/data/news-calendar.md for how it is sourced and maintained).
 */

import rawCalendar from "@/data/news-calendar.json";
import { etWallParts, etWallToEpochMs } from "./sessions";

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
  nextEvent: {
    name: string;
    timeEt: string;
    minutesAway: number;
    /** Calendar date (YYYY-MM-DD) — needed for a stable per-event alert key. */
    date: string;
    impact: "high" | "medium";
  } | null;
  /**
   * The last date the calendar covers, and how many days ahead of now that
   * is. With no event in range this read says "clear" — which past the end
   * of the calendar means "the blackout is switched off", not "nothing is
   * scheduled". The ±15m gate goes blind the day after the last stamped
   * release, silently.
   */
  calendarEnds: string | null;
  coverageDays: number | null;
  /** Coverage under COVERAGE_MIN_DAYS — the reason says so. */
  calendarThin: boolean;
  /**
   * The calendar does not SPAN this ET date, so its silence about today is an
   * absence of data. Inside a release slot that is a blackout, not "clear".
   */
  calendarBlind: boolean;
  /** The recurring ET release slot now sits inside, or null. */
  releaseSlotEt: string | null;
  /** Where the rows that answered this read came from. */
  calendarSource: "live" | "bundled" | "given";
}

/** Below this many days of calendar ahead, "clear" is not trustworthy. */
export const COVERAGE_MIN_DAYS = 3;

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

/** A time has to have printed a high-impact release this many times to count as a slot. */
export const SLOT_MIN_SIGHTINGS = 2;

/**
 * The ET minutes US high-impact macro data actually prints at, counted off the
 * bundled calendar's OWN rows rather than typed in from memory: a `timeEt` that
 * has carried a high-impact release at least SLOT_MIN_SIGHTINGS times.
 *
 * On the committed file (2026-08-12 → 2026-11-25, 74 rows) that is 08:15 (ADP),
 * 08:30 (CPI / PPI / PCE / claims / payrolls), 10:00 (ISM, sentiment, JOLTS),
 * 14:00 (FOMC statement) and 14:30 (the presser) — 43 of the 44 high-impact
 * rows. It is recomputed from the file, so a restamp that moves a slot moves
 * this with it.
 */
export function releaseSlots(calendar: NewsEvent[] = NEWS_CALENDAR): string[] {
  const seen = new Map<string, number>();
  for (const e of calendar) {
    if (e.impact !== "high") continue;
    seen.set(e.timeEt, (seen.get(e.timeEt) ?? 0) + 1);
  }
  return [...seen.entries()]
    .filter(([, n]) => n >= SLOT_MIN_SIGHTINGS)
    .map(([t]) => t)
    .sort();
}

export const RELEASE_SLOTS_ET: string[] = releaseSlots();

/**
 * The recurring release slot `now` is inside (±BLACKOUT_HIGH_MIN), or null.
 * Weekends print nothing, so Saturday and Sunday are never a slot.
 */
export function releaseSlotNow(now: Date, slots: string[] = RELEASE_SLOTS_ET): string | null {
  const p = etWallParts(now.getTime());
  if (p.weekday === 0 || p.weekday === 6) return null;
  const mins = p.hour * 60 + p.minute;
  let best: string | null = null;
  let bestAway = Number.POSITIVE_INFINITY;
  for (const slot of slots) {
    const [h, m] = slot.split(":").map(Number);
    if (!Number.isFinite(h) || !Number.isFinite(m)) continue;
    const away = Math.abs(mins - (h! * 60 + m!));
    // 08:15 and 08:30 overlap, so name the nearer one rather than whichever sorts first.
    if (away <= BLACKOUT_HIGH_MIN && away < bestAway) {
      best = slot;
      bestAway = away;
    }
  }
  return best;
}

/** "YYYY-MM-DD" for an instant, in ET — the calendar's own date space. */
export function etDateOf(now: Date): string {
  const p = etWallParts(now.getTime());
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/**
 * Has the calendar RUN OUT by this ET date? That is the blind case.
 *
 * A file that runs to November can be silent about a Tuesday in October, and
 * that silence is a fact: the agencies publish a schedule, and a day with no
 * row on it is a day with no release. Past the last stamped row there is no
 * schedule at all, so the same silence is a missing file.
 *
 * A date BEFORE the first row is deliberately NOT blind. It is indistinguishable
 * from a replay — `capture-signals.mjs`, the shadow replay and the four-year
 * measurement scripts all call `newsRead` with historical bar timestamps — and
 * failing closed there would silently rewrite four years of measured evidence
 * with blackouts that were never in it. A future-only stamp is caught by
 * `calendarThin`/`coverageDays` and by audit.ts (`macro_empty`, `macro_ended`).
 * An EMPTY calendar is blind: there is nothing to be silent with.
 */
export function calendarExhausted(calendar: NewsEvent[], dateIso: string): boolean {
  let hi: string | null = null;
  for (const e of calendar) if (hi == null || e.date > hi) hi = e.date;
  if (hi == null) return true;
  return dateIso > hi;
}

/** A live calendar older than this is not read; the file is used and the slots fail closed. */
export const LIVE_CALENDAR_MAX_AGE_MIN = 24 * 60;

let liveRows: NewsEvent[] = [];
let liveAtMs = 0;

/**
 * Hand the desk a calendar fetched from a live source (the official agency
 * schedules — see the note at the bottom of this file for what that costs).
 * Rows are validated exactly like the bundled ones, so a malformed payload
 * leaves the file in charge instead of blanking the gate. Returns the rows
 * kept.
 */
export function setLiveCalendar(rows: unknown, fetchedAtMs: number): NewsEvent[] {
  const kept = (Array.isArray(rows) ? rows : []).filter(isNewsEvent);
  if (!kept.length) return liveRows;
  liveRows = kept;
  liveAtMs = fetchedAtMs;
  return liveRows;
}

/** Drop any live calendar — the file is the calendar again. */
export function clearLiveCalendar(): void {
  liveRows = [];
  liveAtMs = 0;
}

export interface LiveCalendarState {
  rows: NewsEvent[];
  fetchedAtMs: number;
  ageMin: number | null;
  fresh: boolean;
}

export function liveCalendarState(nowMs: number): LiveCalendarState {
  const ageMin = liveRows.length ? Math.floor((nowMs - liveAtMs) / 60_000) : null;
  return {
    rows: liveRows,
    fetchedAtMs: liveAtMs,
    ageMin,
    fresh: ageMin != null && ageMin >= 0 && ageMin <= LIVE_CALENDAR_MAX_AGE_MIN,
  };
}

/**
 * The rows a read should use: a fresh live calendar merged over the file
 * (same date+time+name is one event; live wins on impact), else the file.
 */
export function effectiveCalendar(nowMs: number): { rows: NewsEvent[]; source: "live" | "bundled" } {
  const live = liveCalendarState(nowMs);
  if (!live.fresh) return { rows: NEWS_CALENDAR, source: "bundled" };
  const key = (e: NewsEvent) => `${e.date} ${e.timeEt} ${e.name}`;
  const byKey = new Map<string, NewsEvent>();
  for (const e of NEWS_CALENDAR) byKey.set(key(e), e);
  for (const e of live.rows) byKey.set(key(e), e);
  return { rows: [...byKey.values()], source: "live" };
}

/**
 * Deterministic news gate.
 * - blackout: high-impact event within ±15 min
 * - caution:  high within ±60 min, or medium within ±15 min
 * - clear:    otherwise
 * nextEvent is the nearest upcoming calendar entry (minutesAway ≥ 0).
 */
export function newsRead(
  now: Date,
  given?: NewsEvent[],
): NewsRead {
  const nowMs = now.getTime();
  const resolved = given ? { rows: given, source: "given" as const } : effectiveCalendar(nowMs);
  const calendar = resolved.rows;

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

  // Calendar coverage. Deliberately does NOT change the verdict (every gate
  // keys on it); it says, in the reason and on the chip, that a "clear" past
  // the calendar's end is an absence of data rather than an absence of news.
  const lastDate = calendar.reduce<string | null>((m, e) => (m == null || e.date > m ? e.date : m), null);
  const coverageDays =
    lastDate != null ? Math.floor((etWallToEpochMs(lastDate, "23:59") - nowMs) / 86_400_000) : null;
  const calendarThin = coverageDays == null || coverageDays < COVERAGE_MIN_DAYS;
  if (calendarThin && verdict === "clear") {
    reason = `${reason} CALENDAR ENDS ${lastDate ?? "—"}: releases after that date are invisible to the ±15m blackout — restamp src/data/news-calendar.json from BLS/BEA/ISM/Census/Fed.`;
  }

  // FAIL CLOSED. A "clear" past the last stamped row is not a reading, it is a
  // missing file: the ±15m blackout has nothing to compare the minute against.
  // Inside one of the recurring high-impact slots that minute is a release the
  // desk cannot see, so the book stands down instead of arming on an absence of
  // data. A calendar that still covers the date keeps its old meaning — a day
  // with no row on a published schedule is a day with no release. Blocking every
  // 08:30 and 10:00 slot on a CURRENT file would shut 09:45–10:15 most mornings,
  // which is the window the desk trades, with no evidence a release was there.
  const todayEt = etDateOf(now);
  const calendarBlind = calendarExhausted(calendar, todayEt);
  const releaseSlotEt = releaseSlotNow(now);
  if (calendarBlind && releaseSlotEt && verdict !== "blackout") {
    verdict = "blackout";
    reason =
      `CALENDAR BLIND for ${todayEt} (rows ${lastDate == null ? "none" : `end ${lastDate}`}) and it is ` +
      `${releaseSlotEt} ET — a recurring high-impact release slot. A release here would be invisible to the ` +
      `±15m blackout, so the book stands down. Restamp src/data/news-calendar.json from BLS/BEA/ISM/Census/Fed.`;
  }

  return {
    verdict,
    reason,
    calendarEnds: lastDate,
    coverageDays,
    calendarThin,
    calendarBlind,
    releaseSlotEt,
    calendarSource: resolved.source,
    nextEvent: next
      ? {
          name: next.event.name,
          timeEt: next.event.timeEt,
          minutesAway: next.minutesAway,
          date: next.event.date,
          impact: next.event.impact,
        }
      : null,
  };
}

/**
 * A LIVE source for this calendar — what it would need and what it costs.
 *
 * `setLiveCalendar(rows, fetchedAtMs)` is the whole seam: something that runs
 * before 09:30 ET fetches the day's releases and hands them over, and the next
 * `newsRead` uses them. Nothing in this file fetches, so the module stays pure
 * and the poll loop stays deterministic.
 *
 * Not wired, because none of these is in the repo today and a figure has to come
 * from a page with a date, never from a model:
 *   - BLS, BEA, Census, ISM and the Fed each publish their own release
 *     schedule (BLS and BEA machine-readable, ISM and the Fed as HTML). Free,
 *     no key — but five fetchers and five parsers, and a parser that quietly
 *     changes shape is the same hole this item is about, so every row would
 *     have to be checked by machine against the page the way
 *     scripts/check-research-sources.mjs checks the research figures.
 *   - Bigdata.com's economic calendar (already named in CLAUDE.md for the
 *     four-year release times) is one call with exact times; it needs that
 *     connector's entitlement, which this repo has no price for.
 *   - A commercial calendar feed (Trading Economics, FMP and the like) is one
 *     call, roughly $50–$100/mo at the cheapest tier that includes the
 *     economic calendar. Against $199/mo of Databento rent that is not a small
 *     line, and the desk's own measurement (CLAUDE.md, News row) says release
 *     DIRECTION has no edge — the only thing bought here is the blackout's
 *     timing.
 *
 * Until one is wired, the fail-closed path above is the gate: a calendar that
 * does not span today stands the book down inside the recurring release slots.
 */
