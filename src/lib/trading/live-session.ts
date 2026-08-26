/**
 * NY AM ritual — local CDT clock the trader actually sits in.
 * 08:20 CDT = 09:20 ET pre-open brief
 * 08:30–09:00 CDT = 09:30–10:00 ET cash-open pulse (user pings every 2–5m)
 * PATH alarm (path-alarm.ts) is the machine; this is the human+Grok loop.
 */

import { etWallParts } from "./sessions";

export const SESSION_TZ_LOCAL = "America/Chicago";
export const SESSION_TZ_NY = "America/New_York";

export interface RitualWindow {
  id: "premarket" | "judas" | "pulse" | "prime" | "off";
  label: string;
  local: string;
  et: string;
  grokMode: string;
}

function partsIn(tz: string, now = new Date()) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    weekday: "short",
  });
  const p = fmt.formatToParts(now);
  const get = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  const hour = Number(get("hour") === "24" ? "0" : get("hour"));
  const minute = Number(get("minute"));
  return { hour, minute, weekday: get("weekday"), m: hour * 60 + minute };
}

export function ritualWindow(now = new Date()): RitualWindow {
  const cdt = partsIn(SESSION_TZ_LOCAL, now);
  const ny = etWallParts(now.getTime());
  const m = cdt.m;

  if (cdt.weekday === "Sat" || cdt.weekday === "Sun") {
    return {
      id: "off",
      label: "Weekend",
      local: `${String(cdt.hour).padStart(2, "0")}:${String(cdt.minute).padStart(2, "0")} CDT`,
      et: `${String(ny.hour).padStart(2, "0")}:${String(ny.minute).padStart(2, "0")} ET`,
      grokMode: "Journal / replay only.",
    };
  }

  // 08:00–08:29 CDT (09:00–09:29 ET) — premarket
  if (m >= 8 * 60 && m < 8 * 60 + 30) {
    return {
      id: "premarket",
      label: "Premarket brief",
      local: "08:20 CDT target",
      et: "09:20 ET",
      grokMode:
        "Full brief: HTF bias, dealing range, SSL/BSL with prices, news, SMT, one-book, what Judas must raid.",
    };
  }
  // 08:30–08:44 CDT = 09:30–09:44 ET Judas
  if (m >= 8 * 60 + 30 && m < 8 * 60 + 45) {
    return {
      id: "judas",
      label: "Judas — stand",
      local: "08:30–08:44 CDT",
      et: "09:30–09:44 ET",
      grokMode: "No entries. Name the raid (BSL vs SSL) and whether displacement is real.",
    };
  }
  // 08:45–09:00 CDT = 09:45–10:00 ET pulse
  if (m >= 8 * 60 + 45 && m < 9 * 60) {
    return {
      id: "pulse",
      label: "Open pulse",
      local: "08:45–09:00 CDT",
      et: "09:45–10:00 ET",
      grokMode:
        "2–5 min grade: TAKE / STAND. PATH only A+/A/A-. One book. RR ≥ 1. Name entry, SL, T1.",
    };
  }
  // 09:00–10:00 CDT = 10:00–11:00 ET prime NY AM remainder
  if (m >= 9 * 60 && m < 10 * 60) {
    return {
      id: "prime",
      label: "NY AM remainder",
      local: "09:00–10:00 CDT",
      et: "10:00–11:00 ET",
      grokMode: "A+ only after 10:00 ET unless already in a managed trade.",
    };
  }
  return {
    id: "off",
    label: "Outside NY AM",
    local: `${String(cdt.hour).padStart(2, "0")}:${String(cdt.minute).padStart(2, "0")} CDT`,
    et: `${String(ny.hour).padStart(2, "0")}:${String(ny.minute).padStart(2, "0")} ET`,
    grokMode: "No new PATH. Journal, manage, or stand.",
  };
}

/** What Grok must produce on every live ping. */
export const LIVE_PULSE_CONTRACT = [
  "Verdict first: TAKE / STAND / MANAGE (one word).",
  "Book: MNQ or ES — never both same bias.",
  "HTF bias + draw on liquidity (price).",
  "What liquidity just got taken (SSL/BSL, IRL vs ERL) + time.",
  "Displacement real? MSS/CISD? IFVG? SMT vs the other index?",
  "If TAKE: grade, strategy (mechanical/TJR/SMT), entry, SL, T1 (≥1R), T2, invalidation.",
  "If STAND: the one missing confluence, in one line.",
  "Do not look at future bars. Yahoo is ~10m delayed — say lag.",
].join(" ");
