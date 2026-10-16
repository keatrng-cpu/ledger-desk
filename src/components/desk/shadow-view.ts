/**
 * Display reads for the Shadow panel. No gate, no size, no order.
 *
 * q_v2 is the object already on the card. Rule 1 R is the same walk as
 * scripts/rule1.py `outcome` (stop before 3R, else the 14:55 CT print).
 */
import QV2CFG from "../../../shared/q-v2.json";
import type { QV2 } from "@/lib/trading/q-v2";
import type { Rule1Ticket } from "@/lib/trading/rule1";

const WINDOW_FROM = 510;
const WINDOW_TO = 540;
const SESSION_OPEN = 510;
const OUTCOME_END = 895;

export type Rule1Phase = "window" | "closed" | "hidden" | "absent";

/**
 * Lead-symbol tickets win. If the lead has none, or there is no lead card,
 * the real ticket stays on screen. "No sweep" is only for an empty book.
 * The note names the symbol so a ticket on the other index is not described
 * as a missing sweep.
 */
export function rule1ForLead<T extends { symbol: string }>(
  tickets: T[],
  leadSymbol: string | null | undefined,
): { rows: T[]; note: string | null } {
  const onLead = leadSymbol ? tickets.filter((t) => t.symbol === leadSymbol) : [];
  if (onLead.length) return { rows: onLead, note: null };
  if (!tickets.length) return { rows: [], note: null };
  const symbols = [...new Set(tickets.map((t) => t.symbol))];
  return { rows: tickets, note: `Rule 1 ticket on ${symbols.join(" · ")}` };
}

export type ShadowBar = { t: number; h: number; l: number; c: number };

export function ctParts(ms: number): { min: number; day: string; weekday: number } {
  const p = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hourCycle: "h23",
  }).formatToParts(new Date(ms));
  const g = (t: string) => p.find((x) => x.type === t)!.value;
  const wd: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    min: Number(g("hour")) * 60 + Number(g("minute")),
    day: `${g("year")}-${g("month")}-${g("day")}`,
    weekday: wd[g("weekday")] ?? 0,
  };
}

/**
 * NYSE full-session close, which is the cash open the Rule 1 window sits on.
 * Early closes (the day after Thanksgiving, Christmas Eve when it is not the
 * observed Christmas) still open at 09:30 ET, so they are not in this set.
 * Columbus Day and Veterans Day are not NYSE closes.
 *
 * Dates follow the published table at https://www.nyse.com/markets/hours-calendars
 * (2026–2028, read 2026-10-16). Saturday New Year's is not observed (the 2028
 * footnote). Other Saturday holidays move to Friday; Sunday holidays move to Monday.
 * CME equity-index settlements match the full closes used here for Thanksgiving
 * and Christmas (no settlement 2026-11-26 or 2026-12-25) and are normal on
 * Columbus Day. Globex halt times are published about two weeks ahead
 * (https://www.cmegroup.com/trading-hours.html) and are not copied here.
 */
const closeCache = new Map<number, Set<string>>();

function ymd(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function nthWeekday(year: number, month: number, weekday: number, n: number): number {
  const first = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  return 1 + ((weekday - first + 7) % 7) + (n - 1) * 7;
}

function lastWeekday(year: number, month: number, weekday: number): number {
  const last = new Date(Date.UTC(year, month, 0));
  return last.getUTCDate() - ((last.getUTCDay() - weekday + 7) % 7);
}

/** Gregorian Computus. Month is 3 or 4. */
function easterSunday(year: number): { month: number; day: number } {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return { month, day };
}

function observedFixed(year: number, month: number, day: number, saturday: "friday" | "none"): string | null {
  const dt = new Date(Date.UTC(year, month - 1, day));
  const wd = dt.getUTCDay();
  if (wd === 6) {
    if (saturday === "none") return null;
    dt.setUTCDate(dt.getUTCDate() - 1);
  } else if (wd === 0) dt.setUTCDate(dt.getUTCDate() + 1);
  return ymd(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

function closesFor(year: number): Set<string> {
  const out = new Set<string>();
  const add = (day: string | null) => {
    if (day) out.add(day);
  };
  add(observedFixed(year, 1, 1, "none"));
  out.add(ymd(year, 1, nthWeekday(year, 1, 1, 3)));
  out.add(ymd(year, 2, nthWeekday(year, 2, 1, 3)));
  const easter = easterSunday(year);
  const goodFriday = new Date(Date.UTC(year, easter.month - 1, easter.day));
  goodFriday.setUTCDate(goodFriday.getUTCDate() - 2);
  out.add(ymd(goodFriday.getUTCFullYear(), goodFriday.getUTCMonth() + 1, goodFriday.getUTCDate()));
  out.add(ymd(year, 5, lastWeekday(year, 5, 1)));
  add(observedFixed(year, 6, 19, "friday"));
  add(observedFixed(year, 7, 4, "friday"));
  out.add(ymd(year, 9, nthWeekday(year, 9, 1, 1)));
  out.add(ymd(year, 11, nthWeekday(year, 11, 4, 4)));
  add(observedFixed(year, 12, 25, "friday"));
  return out;
}

export function cashHoliday(day: string): boolean {
  const year = Number(day.slice(0, 4));
  if (!Number.isInteger(year) || year < 1970) return false;
  let set = closeCache.get(year);
  if (!set) {
    set = closesFor(year);
    closeCache.set(year, set);
  }
  return set.has(day);
}

/** The next weekday after `day` that is not a cash holiday. That day's 08:30 CT is the next Rule 1 session open. */
export function nextWeekday(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  let t = Date.UTC(y!, (m ?? 1) - 1, d ?? 1, 18, 0, 0);
  for (let i = 0; i < 12; i++) {
    t += 86_400_000;
    const p = ctParts(t);
    if (p.weekday >= 1 && p.weekday <= 5 && !cashHoliday(p.day)) return p.day;
  }
  return day;
}

/**
 * window — 08:30–09:00 CT on the ticket's day.
 * closed — after 09:00 CT, until the next weekday 08:30 CT.
 * hidden — that next session has opened.
 * absent — no ticket.
 */
export function rule1Phase(nowMs: number, ticketAt: number | null | undefined): Rule1Phase {
  if (ticketAt == null || !Number.isFinite(ticketAt)) return "absent";
  const now = ctParts(nowMs);
  const tk = ctParts(ticketAt);
  const openDay = nextWeekday(tk.day);
  if (now.day > openDay || (now.day === openDay && now.min >= SESSION_OPEN)) return "hidden";
  if (tk.day === now.day && now.min >= WINDOW_FROM && now.min < WINDOW_TO) return "window";
  if (now.day > tk.day || (now.day === tk.day && now.min >= WINDOW_TO)) return "closed";
  return "window";
}

/** q_v2 already attached on the card. Null when the desk did not compute one. */
export function readCardQV2(card: unknown): QV2 | null {
  if (!card || typeof card !== "object") return null;
  const raw = (card as { q_v2?: unknown }).q_v2;
  if (!raw || typeof raw !== "object") return null;
  const q = raw as Partial<QV2>;
  if (typeof q.q !== "number" || !Number.isFinite(q.q)) return null;
  if (typeof q.band !== "string" || !q.band) return null;
  return {
    q: q.q,
    band: q.band,
    deltas: Array.isArray(q.deltas) ? q.deltas : [],
    mode: typeof q.mode === "string" ? q.mode : "shadow",
    version: typeof q.version === "number" ? q.version : 0,
    vetoed: q.vetoed === true,
  };
}

const BANDS = ["C", "B", "B+", "A-", "A", "A+"];
const normBand = (b: string) => (b === "A−" ? "A-" : b);

/** One delta: the v2 band against the live band. */
export function bandRelation(live: string, v2: string): "agree" | "raise" | "lower" {
  const a = BANDS.indexOf(normBand(live));
  const b = BANDS.indexOf(normBand(v2));
  if (a < 0 || b < 0 || a === b) return "agree";
  return b > a ? "raise" : "lower";
}

/** The single q_v2 delta: shadow q minus the live fit. Both are on the 0–1 scale. */
export function qv2Delta(liveQ: number, shadowQ: number): number | null {
  if (!Number.isFinite(liveQ) || !Number.isFinite(shadowQ)) return null;
  return shadowQ - liveQ;
}

/** shared/q-v2.json factorCap. Display clamp for a factor row, not a new weight. */
export const FACTOR_CAP = QV2CFG.factorCap;

/**
 * Factor rows draw inside ±factorCap. `base:` is the anchored level itself
 * (the q), not a factor, so clamping it would print a different number than
 * the one q_v2 stored.
 */
export function displayDelta(source: string, delta: number): number {
  if (!Number.isFinite(delta)) return delta;
  if (source.startsWith("base:")) return delta;
  return Math.max(-FACTOR_CAP, Math.min(FACTOR_CAP, delta));
}

export type ShadowOutcome = { r: number | null; exit: "stop" | "target" | "time" | "open" | "nodata" };

/**
 * Shadow R for one Rule 1 ticket. Same bar walk as scripts/rule1.py outcome:
 * market fill at `at`, stop before the 3R target, otherwise the print at 14:55 CT.
 */
export function rule1ShadowOutcome(
  ticket: Pick<Rule1Ticket, "side" | "at" | "entry" | "stop" | "riskPts" | "target">,
  bars: ShadowBar[] | null | undefined,
): ShadowOutcome {
  const s = ticket.side === "long" ? 1 : -1;
  const { entry: e, stop: st, riskPts: risk, target } = ticket;
  if (!(risk > 0) || !Number.isFinite(e) || !Number.isFinite(st)) return { r: null, exit: "nodata" };
  const day = ctParts(ticket.at).day;
  const path = (bars ?? []).filter((b) => b.t >= ticket.at && ctParts(b.t).day === day && ctParts(b.t).min < OUTCOME_END);
  if (!path.length) return { r: null, exit: "nodata" };
  for (const b of path) {
    const lo = s > 0 ? b.l : -b.h;
    const hi = s > 0 ? b.h : -b.l;
    if (lo <= s * st) return { r: -1, exit: "stop" };
    if (Number.isFinite(target) && hi >= s * target) return { r: Math.round((s * (target - e)) / risk * 1000) / 1000, exit: "target" };
  }
  const last = path[path.length - 1]!;
  const minute = ctParts(last.t).min;
  return {
    r: Math.round((s * (last.c - e)) / risk * 1000) / 1000,
    exit: minute >= OUTCOME_END - 1 ? "time" : "open",
  };
}

export type ShadowLine = { id: string; label: string; value: string };

const px = (n: number) => n.toFixed(2);
const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

/** Clock already on the ticket, Chicago. */
export function shadowClock(ms: number): string | null {
  if (!finite(ms)) return null;
  const s = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(ms));
  return `${s} CT`;
}

/** Sweep, displacement, entry, stop, 3R, runner — each only when the ticket carries it. */
export function rule1Lines(ticket: Rule1Ticket): ShadowLine[] {
  const lines: ShadowLine[] = [];
  if (ticket.swept && finite(ticket.level)) lines.push({ id: "sweep", label: "Sweep", value: `${ticket.swept} ${px(ticket.level)}` });
  const disp: string[] = [];
  const clock = shadowClock(ticket.dispAt);
  if (clock) disp.push(clock);
  if (finite(ticket.bodyAtr)) disp.push(`${ticket.bodyAtr.toFixed(2)}×`);
  if (ticket.bonus) disp.push("bonus");
  if (disp.length) lines.push({ id: "displacement", label: "Displacement", value: disp.join(" · ") });
  if (finite(ticket.entry)) lines.push({ id: "entry", label: "Entry", value: px(ticket.entry) });
  if (finite(ticket.stop)) lines.push({ id: "stop", label: "Stop", value: px(ticket.stop) });
  if (finite(ticket.target)) lines.push({ id: "target", label: "3R target", value: px(ticket.target) });
  if (finite(ticket.runner)) lines.push({ id: "runner", label: "Runner", value: px(ticket.runner) });
  if (finite(ticket.riskPts)) lines.push({ id: "risk", label: "Risk", value: `${px(ticket.riskPts)} pt` });
  return lines;
}

export type LevelTone = "stop" | "entry" | "target" | "target-soft" | "plain";
export type LevelRow = { id: string; label: string; price: string; r: string | null; tone: LevelTone };

/** Signed R from the ticket's own entry, stop distance, and side. */
function rMultiple(ticket: Rule1Ticket, price: number): string | null {
  if (!(ticket.riskPts > 0) || !finite(ticket.entry)) return null;
  const s = ticket.side === "long" ? 1 : -1;
  const r = (s * (price - ticket.entry)) / ticket.riskPts;
  const sign = r >= 0 ? "+" : "−";
  return `${sign}${Math.abs(r).toFixed(1)}R`;
}

/** Label | price | R for the Rule 1 ticket. A row is omitted when its price is not on the ticket. */
export function rule1Rows(ticket: Rule1Ticket): LevelRow[] {
  const rows: LevelRow[] = [];
  if (ticket.swept && finite(ticket.level)) {
    rows.push({ id: "sweep", label: "Sweep", price: px(ticket.level), r: ticket.swept, tone: "plain" });
  }
  const clock = shadowClock(ticket.dispAt);
  const mult = finite(ticket.bodyAtr) ? `${ticket.bodyAtr.toFixed(2)}×` : null;
  if (clock || mult || ticket.bonus) {
    rows.push({
      id: "displacement",
      label: "Displacement",
      price: clock ?? "",
      r: [mult, ticket.bonus ? "bonus" : null].filter(Boolean).join(" · ") || null,
      tone: "plain",
    });
  }
  if (finite(ticket.entry)) rows.push({ id: "entry", label: "Entry", price: px(ticket.entry), r: "CE", tone: "entry" });
  if (finite(ticket.stop)) rows.push({ id: "stop", label: "Stop", price: px(ticket.stop), r: rMultiple(ticket, ticket.stop), tone: "stop" });
  if (finite(ticket.target)) rows.push({ id: "target", label: "3R", price: px(ticket.target), r: rMultiple(ticket, ticket.target), tone: "target" });
  if (finite(ticket.runner)) rows.push({ id: "runner", label: "Runner", price: px(ticket.runner), r: finite(ticket.runnerR) ? rMultiple(ticket, ticket.runner) : null, tone: "target-soft" });
  if (finite(ticket.riskPts)) rows.push({ id: "risk", label: "Risk", price: px(ticket.riskPts), r: "pt", tone: "plain" });
  return rows;
}

export function optionLine(ticket: Rule1Ticket): string | null {
  const o = ticket.option;
  if (!o || !finite(o.strike) || !o.underlier) return null;
  const right = o.right === "call" ? "C" : "P";
  return `${o.contracts}× ${o.underlier} ${o.strike}${right} δ${o.delta} ${o.dte}DTE`;
}
