/**
 * How old the committed data is — the one module that binds the snapshots' dates and the source-check report to a day.
 *
 * Pure: the day comes in as an argument (an ET date), nothing here reads a clock. The desk audit (audit.ts) turns the result into
 * findings, so the five say "the earnings calendar is three weeks old" from a date the file carries, not from a feeling.
 */

import report from "@/data/source-check-report.json";
import { calendarEnds, earningsCapturedAt } from "@/lib/news/schedule";
import { RESEARCH } from "./invest-themes";
import type { DataFreshness } from "./live-types";

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** The source-check report if it has the shape `check-research-sources.mjs --write` leaves, else null (never throws). */
export function readSourceReport(r: unknown): DataFreshness["sourceCheck"] {
  const x = r as { checkedAt?: unknown; facts?: unknown; findings?: unknown; researchAsOf?: unknown } | null;
  if (!x || typeof x !== "object") return null;
  if (typeof x.checkedAt !== "string" || !ISO.test(x.checkedAt)) return null;
  if (typeof x.facts !== "number" || !Number.isFinite(x.facts) || x.facts < 0) return null;
  if (!Array.isArray(x.findings)) return null;
  return { checkedAt: x.checkedAt, facts: x.facts, findings: x.findings.length, researchAsOf: typeof x.researchAsOf === "string" && ISO.test(x.researchAsOf) ? x.researchAsOf : null };
}

export function freshnessOf(today: string): DataFreshness {
  return {
    today,
    earningsAsOf: earningsCapturedAt(),
    researchAsOf: RESEARCH.asOf,
    macroCalendarEnds: calendarEnds(),
    sourceCheck: readSourceReport(report),
  };
}
