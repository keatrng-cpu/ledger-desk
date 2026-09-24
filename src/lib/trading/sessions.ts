/**
 * NY session / killzone clock — Trading-Automation sessions.py spirit.
 * All times America/New_York.
 */

export type KillzoneId =
  | "asia"
  | "london"
  | "ny_am"
  | "ny_lunch"
  | "ny_pm"
  | "dead";

export interface SessionClock {
  nowEt: string;
  etHour: number;
  etMinute: number;
  weekday: number; // 0=Sun
  isWeekday: boolean;
  killzone: KillzoneId;
  killzoneLabel: string;
  /** Purely the clock: is this hour one of the named killzones? */
  inTradeWindow: boolean;
  nextWindow: string;
  sessionPhase: string;
  /**
   * THE GATE THE DESK ACTUALLY TRADES ON.
   *
   * `inTradeWindow` answers a question about the hour. This answers the
   * question the hour was only ever a proxy for: is there a session here —
   * enough delivery and enough participation that a level gets traded to and
   * a limit fills where it was rested. Inside a killzone the two are the
   * same. Outside one they differ exactly when the tape is doing something,
   * which is the case the clock used to refuse on principle.
   *
   * Set by `session-event.ts applySession()`, which needs bars. A clock built
   * without bars leaves these undefined, and every consumer falls back to
   * `inTradeWindow` — so the old behaviour is the safe default and nothing
   * silently opens a window on a clock that was never measured.
   */
  sessionLive?: boolean;
  sessionSource?: "killzone" | "event" | "none";
  sessionReason?: string;
}

/**
 * Read the session gate off a clock, falling back to the raw window.
 *
 * Every consumer that used to test `clock.inTradeWindow` as a permission
 * should call this instead. The ones that genuinely mean "what hour is it" —
 * chart shading, the HUD's killzone label, the handoff's clock line — should
 * keep using `inTradeWindow`, and the difference between the two is now
 * visible at every call site rather than being one flag doing two jobs.
 */
export function sessionLive(clock: {
  inTradeWindow: boolean;
  sessionLive?: boolean;
}): boolean {
  return clock.sessionLive ?? clock.inTradeWindow;
}

/** ET wall-clock parts of an epoch-ms timestamp (DST-correct via Intl). */
export interface EtWallParts {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
  hour: number; // 0-23
  minute: number;
  second: number;
  weekday: number; // 0=Sun … 6=Sat
}

const ET_PARTS_FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
  weekday: "short",
});

const WEEKDAY_MAP: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

/**
 * Convert an epoch-ms timestamp to America/New_York wall-clock parts.
 * No external deps — Intl handles DST by construction.
 */
export function etWallParts(tMs: number): EtWallParts {
  const parts = ET_PARTS_FMT.formatToParts(new Date(tMs));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const hourRaw = get("hour");
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hour: Number(hourRaw === "24" ? "0" : hourRaw),
    minute: Number(get("minute")),
    second: Number(get("second")),
    weekday: WEEKDAY_MAP[get("weekday")] ?? 0,
  };
}

/**
 * Epoch ms of an ET wall-clock moment ("YYYY-MM-DD" + "HH:MM").
 * Iterative offset search against Intl — converges in ≤2 passes, DST-correct.
 */
export function etWallToEpochMs(dateIso: string, timeEt: string): number {
  const [y, mo, d] = dateIso.split("-").map(Number);
  const [h, mi] = timeEt.split(":").map(Number);
  const target = Date.UTC(y ?? 1970, (mo ?? 1) - 1, d ?? 1, h ?? 0, mi ?? 0);
  let guess = target;
  for (let i = 0; i < 3; i++) {
    const p = etWallParts(guess);
    const wall = Date.UTC(
      p.year,
      p.month - 1,
      p.day,
      p.hour,
      p.minute,
      p.second,
    );
    const diff = target - wall;
    if (diff === 0) break;
    guess += diff;
  }
  return guess;
}

function etParts(d = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const hour = Number(get("hour") === "24" ? "0" : get("hour"));
  const minute = Number(get("minute"));
  const second = Number(get("second"));
  const wdMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  return {
    hour,
    minute,
    second,
    weekday: wdMap[get("weekday")] ?? 0,
    label: `${get("weekday")} ${get("month")}/${get("day")} ${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:${String(second).padStart(2, "0")} ET`,
  };
}

export function resolveKillzone(hour: number, minute: number): {
  id: KillzoneId;
  label: string;
  inTradeWindow: boolean;
  nextWindow: string;
  sessionPhase: string;
} {
  const m = hour * 60 + minute;
  // ET minutes
  if (m >= 19 * 60 || m < 2 * 60)
    return {
      id: "asia",
      label: "Asia range",
      inTradeWindow: false,
      nextWindow: "London 3:00 ET",
      sessionPhase: "Overnight build",
    };
  if (m >= 2 * 60 && m < 5 * 60)
    return {
      id: "london",
      label: "London open",
      inTradeWindow: true,
      nextWindow: "NY AM 9:30 ET",
      sessionPhase: "London expansion",
    };
  if (m >= 5 * 60 && m < 8 * 60 + 30)
    return {
      id: "london",
      label: "London / pre-NY",
      inTradeWindow: true,
      nextWindow: "NY AM 9:30 ET",
      sessionPhase: "London continuation",
    };
  if (m >= 8 * 60 + 30 && m < 11 * 60)
    return {
      id: "ny_am",
      label: "NY AM killzone",
      inTradeWindow: true,
      nextWindow: "Lunch 11:00 ET",
      sessionPhase: "Primary A+ window",
    };
  if (m >= 11 * 60 && m < 13 * 60 + 30)
    return {
      id: "ny_lunch",
      label: "NY lunch / mid",
      inTradeWindow: false,
      nextWindow: "NY PM 13:30 ET",
      sessionPhase: "Selectivity high — often skip",
    };
  if (m >= 13 * 60 + 30 && m < 16 * 60)
    return {
      id: "ny_pm",
      label: "NY PM killzone",
      inTradeWindow: true,
      nextWindow: "Close 16:00 ET",
      sessionPhase: "Secondary window",
    };
  return {
    id: "dead",
    label: "Post-close / dead zone",
    inTradeWindow: false,
    nextWindow: "Asia 19:00 ET",
    sessionPhase: "Journal & plan only",
  };
}

/**
 * First 15 minutes of RTH — Judas / cash-open raid.
 * 09:30–09:45 America/New_York.
 * Name the raid. The clock is not a must-fail: a complete A+ sequence
 * still TAKEs. News blackout remains the only time-adjacent veto.
 */
export function isJudasWindow(hour: number, minute: number): boolean {
  const m = hour * 60 + minute;
  return m >= 9 * 60 + 30 && m < 9 * 60 + 45;
}

/**
 * NY AM live-ingest window — 09:00–11:30 America/New_York, weekdays.
 * Matches gateway/databento_live_gateway.py NY_AM_START / NY_AM_END. Widened
 * from 09:20–11:00 on 2026-09-21 so the pre-open tape and the A+ tail are
 * live, not ten minutes late. The 08:30 news candle is NOT live; the desk
 * reads it from Databento historical / Yahoo.
 */
// 08:15 so the gateway is already connected when the 08:30 ET release
// prints — see the window comment in gateway/databento_live_gateway.py.
// These two must stay in step or the desk will claim live data it does not
// have, which is worse than knowing it is lagged.
export const NY_AM_LIVE_START_MIN = 8 * 60 + 15;
export const NY_AM_LIVE_END_MIN = 11 * 60 + 30;
export const NY_AM_LIVE_LABEL = "08:15–11:30 ET";

export function isNyAmLiveWindow(
  hour: number,
  minute: number,
  weekday: number,
): boolean {
  if (weekday < 1 || weekday > 5) return false;
  const m = hour * 60 + minute;
  return m >= NY_AM_LIVE_START_MIN && m < NY_AM_LIVE_END_MIN;
}

export function getSessionClock(now = new Date()): SessionClock {
  const p = etParts(now);
  const kz = resolveKillzone(p.hour, p.minute);
  return {
    nowEt: p.label,
    etHour: p.hour,
    etMinute: p.minute,
    weekday: p.weekday,
    isWeekday: p.weekday >= 1 && p.weekday <= 5,
    killzone: kz.id,
    killzoneLabel: kz.label,
    inTradeWindow: kz.inTradeWindow && p.weekday >= 1 && p.weekday <= 5,
    nextWindow: kz.nextWindow,
    sessionPhase: kz.sessionPhase,
  };
}
