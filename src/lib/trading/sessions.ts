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
  inTradeWindow: boolean;
  nextWindow: string;
  sessionPhase: string;
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
 * First 15 minutes of RTH — Judas / cash-open raid. Not an entry window.
 * 09:30–09:45 America/New_York.
 */
export function isJudasWindow(hour: number, minute: number): boolean {
  const m = hour * 60 + minute;
  return m >= 9 * 60 + 30 && m < 9 * 60 + 45;
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
