/**
 * The schedule, read three ways — the part of "news" that is known in advance.
 *
 * Most of what moves an index on a given day is on a calendar weeks ahead:
 * the release times the desk already blacks out, and the earnings of the
 * handful of companies that ARE the index. This file turns the two committed
 * calendars (news-calendar.json — official agency dates; earnings-calendar.json
 * — Alpha Vantage) into one timeline and says, per event, what it means on
 * each clock. The implications are MECHANICS (blackout windows, an option's
 * premium carrying an event, the kill rule deciding a holding) — never a
 * forecast of direction.
 */

import calendar from "../../data/news-calendar.json";
import earnings from "../../data/earnings-calendar.json";
import { fundProfile } from "../invest/exposure";
import { ALL_DOSSIERS } from "../invest/dossiers";

export interface CalEvent {
  date: string;
  timeEt: string;
  name: string;
  impact: "high" | "medium";
}

interface EarningsDoc {
  capturedAt: string;
  source: string;
  note: string;
  columns: string[];
  rows: [string, string, string, string, number | null, string | null][];
}

const CAL = calendar as CalEvent[];
const EARN = earnings as unknown as EarningsDoc;

export const BLACKOUT_MIN = 15;

export function earningsCapturedAt(): string {
  return EARN.capturedAt;
}

export function calendarEnds(): string | null {
  return CAL.length ? CAL.map((e) => e.date).sort().at(-1) ?? null : null;
}

export type EventKind = "macro-high" | "macro-medium" | "fomc" | "earnings";

export interface Implication {
  day: string;
  swing: string;
  invest: string;
}

export interface TimelineEvent {
  date: string;
  /** "HH:MM" ET, or "pre-market" / "after close" / "time not stated" for earnings. */
  when: string;
  name: string;
  kind: EventKind;
  ticker?: string;
  /** Weight inside QQQ — how much of the options sleeve's index this company is. */
  qqqWeight?: number;
  dossier?: boolean;
  implication: Implication;
}

function addMinutes(hhmm: string, m: number): string {
  const [h, mi] = hhmm.split(":").map(Number);
  const t = h * 60 + mi + m;
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
}

/** What one scheduled release means on each clock. Mechanics only. */
export function macroImplication(e: CalEvent): Implication {
  const win = `${addMinutes(e.timeEt, -BLACKOUT_MIN)}–${addMinutes(e.timeEt, BLACKOUT_MIN)} ET`;
  if (/FOMC Rate Decision/i.test(e.name)) {
    return {
      day: `Two scheduled shocks: the 14:00 statement and the 14:30 press conference. Blackout ${win} covers the statement; treat the press conference the same.`,
      swing: "Every option held through Fed day carries the decision in its premium; implied volatility usually drops once it is out.",
      invest: "The rate path moves the 10-year — the hurdle every valuation on the Invest tab is judged against. Nothing to trade.",
    };
  }
  if (/FOMC Press/i.test(e.name)) {
    return {
      day: `Second Fed shock of the day at ${e.timeEt}. The blackout applies again.`,
      swing: "Same event as the decision — already in the premium.",
      invest: "Nothing to do.",
    };
  }
  if (/FOMC Minutes/i.test(e.name)) {
    return {
      day: `14:00 ET, blackout ${win}. Usually smaller than a decision, but it moves rates.`,
      swing: "Small event for an option's premium; note it if you hold through 14:00.",
      invest: "Nothing to do.",
    };
  }
  if (e.impact === "high") {
    return {
      day: `Blackout ${win}. The first minutes can gap through a stop; the desk's shock lock applies after the print.`,
      swing: `An option held through ${e.timeEt} ET pays for this print in its premium; implied volatility usually falls once the number is out.`,
      invest: "Nothing to do — a years book does not trade a print.",
    };
  }
  return {
    day: `Caution window around ${e.timeEt} ET — a medium-impact release.`,
    swing: "Rarely material to an option's premium on its own.",
    invest: "Nothing to do.",
  };
}

export function earningsImplication(ticker: string, when: string, w: number, dossier: boolean): Implication {
  const pct = `${(w * 100).toFixed(1)}%`;
  const gapAt = when === "pre-market" ? "at that morning's open" : when === "after close" ? "at the NEXT morning's open" : "around the report";
  return {
    day:
      w >= 0.02
        ? `${ticker} is ${pct} of QQQ — its report moves NQ ${gapAt}. The overnight gap is an unpriced risk for any futures position carried into it.`
        : `${ticker} reports; small for the index (${pct} of QQQ).`,
    swing:
      w > 0
        ? `A QQQ option held over the report carries it (${pct} of the index). A single-stock option's implied volatility typically collapses after the number.`
        : "Not in QQQ — only matters to an option on this name.",
    invest: dossier
      ? `In the research book: read the report against the pre-written kill rule, not the one-day price reaction.`
      : "Not a researched name.",
  };
}

/** Every calendar event and heavyweight report between two dates (inclusive). */
export function timeline(from: string, to: string, opts: { minQqqWeight?: number } = {}): TimelineEvent[] {
  const qqq = new Map(fundProfile("QQQ")?.holdings ?? []);
  const dossiers = new Set(ALL_DOSSIERS.filter((d) => d.kind === "company").map((d) => d.ticker));
  const minW = opts.minQqqWeight ?? 0.01;
  const out: TimelineEvent[] = [];
  for (const e of CAL) {
    if (e.date < from || e.date > to) continue;
    out.push({
      date: e.date,
      when: e.timeEt,
      name: e.name,
      kind: /FOMC/i.test(e.name) ? "fomc" : e.impact === "high" ? "macro-high" : "macro-medium",
      implication: macroImplication(e),
    });
  }
  for (const [sym, name, date, , , tod] of EARN.rows) {
    if (date < from || date > to) continue;
    // Alphabet reports once for both share classes; GOOGL's line carries both weights.
    if (sym === "GOOG") continue;
    const w = qqq.get(sym) ?? 0;
    const dossier = dossiers.has(sym);
    if (w < minW && !dossier) continue;
    const when = tod === "pre-market" ? "pre-market" : tod === "post-market" ? "after close" : "time not stated";
    out.push({
      date,
      when,
      name: `${name} earnings`,
      kind: "earnings",
      ticker: sym,
      qqqWeight: sym === "GOOGL" ? w + (qqq.get("GOOG") ?? 0) : w,
      dossier,
      implication: earningsImplication(sym, when, sym === "GOOGL" ? w + (qqq.get("GOOG") ?? 0) : w, dossier),
    });
  }
  const rank = (e: TimelineEvent) => (/^\d\d:\d\d$/.test(e.when) ? e.when : e.when === "pre-market" ? "07:00" : e.when === "after close" ? "16:05" : "23:59");
  return out.sort((a, b) => (a.date !== b.date ? (a.date < b.date ? -1 : 1) : rank(a) < rank(b) ? -1 : 1));
}

export interface Density {
  from: string;
  to: string;
  high: number;
  heavyweights: string[];
  line: string;
}

/**
 * How many scheduled shocks sit inside a window — the arithmetic behind
 * "is this a clean week to hold a 1–2 DTE option or a futures swing".
 */
export function eventDensity(from: string, to: string): Density {
  const tl = timeline(from, to, { minQqqWeight: 0.02 });
  const high = tl.filter((e) => e.kind === "macro-high" || e.kind === "fomc").length;
  const heavy = tl.filter((e) => e.kind === "earnings" && (e.qqqWeight ?? 0) >= 0.02).map((e) => e.ticker as string);
  return {
    from,
    to,
    high,
    heavyweights: heavy,
    line:
      high + heavy.length === 0
        ? `No high-impact release and no QQQ heavyweight report between ${from} and ${to}.`
        : `${high} high-impact release${high === 1 ? "" : "s"}${heavy.length ? ` and ${heavy.length} QQQ heavyweight report${heavy.length === 1 ? "" : "s"} (${heavy.join(", ")})` : ""} between ${from} and ${to}.`,
  };
}

/** The calendar's own honesty line: where it ends, and whether that is soon. */
export function coverageLine(today: string): string {
  const end = calendarEnds();
  if (!end) return "No release calendar loaded — every blackout is blind.";
  const days = Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  return days < 7
    ? `The official release calendar ends ${end} — ${days} day${days === 1 ? "" : "s"} out. After that the blackout is blind until it is restamped.`
    : `Official release calendar runs to ${end} (${days} days). Earnings dates are Alpha Vantage's as of ${EARN.capturedAt}; dates more than ~2 weeks out are provisional until the company confirms.`;
}
