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
