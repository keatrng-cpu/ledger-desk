/**
 * Reading an `InvestLite` — pure, and free of the research file, so the talk engine and the voices depend on types only.
 * (invest-office.ts builds the InvestLite and is the one module that loads the dated research JSON.)
 */

import { CATALYST_MAX_AGE_DAYS, hash32, type FirmOps, type FirmReviewId, type InvestCatalyst, type InvestFirm, type InvestLite, type InvestThemeLite, type InvestTier, type WatchKind } from "./live-types";

export type WatchHit = { key: string; label: string; kind: WatchKind };

/** How many of each research tier have a vehicle in the book. */
export function tierCoverage(inv: InvestLite): { tier: InvestTier; themes: number; covered: number }[] {
  return (["safe", "mid", "high"] as InvestTier[]).map((tier) => {
    const ts = inv.themes.filter((t) => t.tier === tier);
    return { tier, themes: ts.length, covered: ts.filter((t) => t.held.length > 0).length };
  });
}

/** The day's theme: the same ET date always picks the same one; `offset` walks the rotation for a second look later in the day. */
export function themeOfTheDay(inv: InvestLite, offset = 0): InvestThemeLite | null {
  if (!inv.themes.length) return null;
  return inv.themes[(hash32(inv.dayKey) + offset) % inv.themes.length] ?? null;
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The first watched name a headline mentions, or null. Tickers must match as whole upper-case words; names as lower-case words. Held beats theme beats a name on the long board beats a competitor. */
export function watchHit(inv: InvestLite, title: string, tickers: string[]): WatchHit | null {
  const lower = title.toLowerCase();
  const up = new Set(tickers.map((t) => t.toUpperCase()));
  let best: WatchHit | null = null;
  const rank = { held: 0, theme: 1, board: 2, competitor: 3 } as const;
  for (const [key, v] of Object.entries(inv.watch)) {
    const isTicker = key === key.toUpperCase() && !/\s/.test(key);
    const hit = isTicker ? up.has(key) || new RegExp(`(^|[^A-Za-z])${esc(key)}([^A-Za-z]|$)`).test(title) : new RegExp(`(^|[^a-z])${esc(key)}([^a-z]|$)`).test(lower);
    if (hit && (!best || rank[v.kind] < rank[best.kind])) best = { key, label: v.label, kind: v.kind };
  }
  return best;
}

/**
 * The day's two theme looks, in minutes after ET midnight: after the live window on a weekday, mid-morning and mid-afternoon
 * on a weekend. The talk engine fires them and the TVs show the same theme — both read this one function.
 */
export const investLooks = (weekday: boolean): [number, number] => (weekday ? [12 * 60 + 30, 14 * 60 + 30] : [10 * 60 + 30, 15 * 60]);

/** Which look is current at this ET minute: 0 = the day's first theme, 1 = the second look. */
export const lookAt = (etMin: number, weekday: boolean): 0 | 1 => (etMin >= investLooks(weekday)[1] ? 1 : 0);

export interface AgendaItem {
  kind: "waiting" | "rebalance" | "drift" | "small";
  usd?: number;
}

/** What the board has in front of it. The voice and the TV both read this — one list, two renderings. */
export function boardAgenda(inv: InvestLite): AgendaItem[] {
  const out: AgendaItem[] = [];
  if (inv.funnel.waitingUsd > 0) out.push({ kind: "waiting", usd: inv.funnel.waitingUsd });
  if (inv.book.rebalanceDue) out.push({ kind: "rebalance" });
  else if (inv.book.beyondBand > 0) out.push({ kind: "drift" });
  if (inv.book.positions > 0 && inv.book.belowMeaningful) out.push({ kind: "small" });
  return out;
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const utcNoon = (d: string): number => Date.parse(`${d}T12:00:00Z`);

/** Whole calendar days from `a` to `b` (YYYY-MM-DD, both), negative when `b` is earlier. */
export const daysBetween = (a: string, b: string): number => Math.round((utcNoon(b) - utcNoon(a)) / 86_400_000);

/** The calendar day as a person says it: today, tomorrow, a weekday inside the week, otherwise "Tuesday 13 October". */
export function dayPhrase(date: string, today: string): string {
  const n = daysBetween(today, date);
  const wd = WEEKDAYS[new Date(utcNoon(date)).getUTCDay()]!;
  if (n === 0) return "today";
  if (n === 1) return "tomorrow";
  if (n > 1 && n < 7) return wd;
  const m = Number(date.slice(5, 7));
  return `${wd} ${Number(date.slice(8, 10))} ${MONTHS[m - 1] ?? date.slice(5, 7)}`;
}

/** When in the day a report lands, as the calendar states it. */
export const whenPhrase = (when: "pre-market" | "after close" | "time not stated"): string => (when === "pre-market" ? "before the open" : when === "after close" ? "after the close" : "(time not stated)");

/**
 * The reports the office may speak of or draw: the list, unless the calendar it was read from is more than `CATALYST_MAX_AGE_DAYS` old,
 * when it is empty. The talk and the board TV both read this one function.
 */
export const freshCatalysts = (inv: InvestLite): InvestCatalyst[] => (daysBetween(inv.catalystsAsOf, inv.dayKey) <= CATALYST_MAX_AGE_DAYS ? inv.catalysts : []);

/** The calendar's date plus `n` days. */
export const plusDays = (date: string, n: number): string => new Date(utcNoon(date) + n * 86_400_000).toISOString().slice(0, 10);

/** A prose field as whole sentences — the Invest tab's own words, cut where it ended a thought. */
export function sentences(text: string): string[] {
  const t = text.replace(/\s+/g, " ").trim();
  if (!t) return [];
  return t.split(/(?<=[.!?])\s+(?=[A-Z"“(`])/);
}

/** The first whole sentence of a prose field. */
export function firstSentence(text: string): string {
  return sentences(text)[0] ?? "";
}

/** As many whole sentences as fit in `n` characters; if even the first does not fit, the first cut at a word. Nothing is cut mid-thought when a thought fits. */
export function sentencesWithin(text: string, n: number): string {
  const ss = sentences(text);
  if (!ss.length) return "";
  let out = "";
  for (const s of ss) {
    const next = out ? `${out} ${s}` : s;
    if (next.length > n) break;
    out = next;
  }
  if (out) return out;
  const first = ss[0]!;
  const cut = first.slice(0, n);
  const sp = cut.lastIndexOf(" ");
  return `${cut.slice(0, sp > n * 0.6 ? sp : n).replace(/[\s,;:.\-–—]+$/, "")}…`;
}

/** A calendar date as a person says it — "25 September", with the year only when it is not this one: "5 May 2027". */
export function dateSay(date: string, today: string): string {
  const m = Number(date.slice(5, 7));
  const base = `${Number(date.slice(8, 10))} ${MONTHS[m - 1] ?? date.slice(5, 7)}`;
  return date.slice(0, 4) === today.slice(0, 4) ? base : `${base} ${date.slice(0, 4)}`;
}

/** A month key "2026-08" as "August 2026". */
export function monthSay(month: string): string {
  const m = Number(month.slice(5, 7));
  return `${MONTHS[m - 1] ?? month.slice(5, 7)} ${month.slice(0, 4)}`;
}

/* ── The firm's week ───────────────────────────────────────────────────────
 * One standing review per topic, on a fixed weekday, so the firm has a rhythm without flooding the room. The talk engine fires them
 * (live-talk.ts) and the board TV draws the same list — one function, two renderings.
 */

export const FIRM_REVIEW_NAME: Record<FirmReviewId, string> = {
  memo: "a company memo",
  macro: "the rates backdrop",
  risk: "look-through and caps",
  compliance: "the restricted list",
  ops: "the ledger's health",
  diligence: "the kill rules",
  tax: "tax lots",
  funding: "the funding waterfall",
  board: "the funnel and the long board",
  policy: "the policy's evidence",
  fresh: "the data's age",
};

export interface FirmDay {
  weekday: string;
  title: string;
  reviews: FirmReviewId[];
}

const FIRM_WEEK: Record<number, { title: string; reviews: FirmReviewId[] }> = {
  1: { title: "Investment committee", reviews: ["memo", "macro"] },
  2: { title: "Risk committee and compliance", reviews: ["risk", "compliance"] },
  3: { title: "Operations and due diligence", reviews: ["ops", "diligence"] },
  4: { title: "Tax and funding", reviews: ["tax", "funding"] },
  5: { title: "The board", reviews: ["board", "policy"] },
};

/** The standing reviews of an ET date. A weekend has none (the data-age review is not on a weekday: it speaks when something is old). */
export function firmDay(dayKey: string): FirmDay {
  const d = new Date(utcNoon(dayKey)).getUTCDay();
  const row = FIRM_WEEK[d];
  return { weekday: WEEKDAYS[d]!, title: row?.title ?? "No standing review", reviews: row?.reviews ?? [] };
}

/** Monday to Friday, for the board TV's week. */
export const firmWeek = (): FirmDay[] => [1, 2, 3, 4, 5].map((d) => ({ weekday: WEEKDAYS[d]!, title: FIRM_WEEK[d]!.title, reviews: FIRM_WEEK[d]!.reviews }));

/**
 * The ledger's health in one line, for the chair's page: clean, or what is wrong. The ops review speaks the same fields one by one;
 * this is the summary the page draws (verify-invest-office.mjs ties each number in it to the field it came from).
 */
export function opsHealth(ops: FirmOps | null | undefined): { ok: boolean; text: string } {
  if (!ops) return { ok: false, text: "ledger not read" };
  const bad: string[] = [];
  if (ops.problemCount) bad.push(`${ops.problemCount} could not be applied`);
  if (ops.missedCount) bad.push(`${ops.missedCount} ${ops.missedCount === 1 ? "month" : "months"} missing`);
  if (ops.overSpendUsd > 0) bad.push("sweep over-spent");
  if (bad.length) return { ok: false, text: bad.join(" · ") };
  return { ok: true, text: `clean · ${ops.entries} ${ops.entries === 1 ? "entry" : "entries"}${ops.voidCount ? ` · ${ops.voidCount} voided` : ""}` };
}

export interface MacroRead {
  vix: number | null;
  liveTenPct: number;
  riskFreePct: number;
  riskFreeAsOf: string;
  /** Today's ten-year minus the one the dossiers were written against, in points. */
  deltaPts: number;
  /** The memo name's forward (else trailing) earnings yield as a percent, and its spread against the old and the live ten-year, in points. */
  name: { ticker: string; eyPct: number; basis: "forward" | "trailing"; spreadThenPts: number; spreadNowPts: number } | null;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** The live pulse next to the ten-year the Invest tab judges every multiple against. Arithmetic on two dated numbers; never a call. */
export function macroRead(firm: InvestFirm | null | undefined, pulse: { vix: number | null; tenYear: number | null }): MacroRead | null {
  if (!firm || pulse.tenYear == null || !Number.isFinite(pulse.tenYear)) return null;
  const m = firm.memo;
  const ey = m?.earningsYield != null && m.earningsYieldBasis ? m.earningsYield * 100 : null;
  return {
    vix: pulse.vix != null && Number.isFinite(pulse.vix) ? pulse.vix : null,
    liveTenPct: pulse.tenYear,
    riskFreePct: firm.macro.riskFreePct,
    riskFreeAsOf: firm.macro.riskFreeAsOf,
    deltaPts: r2(pulse.tenYear - firm.macro.riskFreePct),
    name: m && ey != null && m.earningsYieldBasis ? { ticker: m.ticker, eyPct: ey, basis: m.earningsYieldBasis, spreadThenPts: m.spreadPts ?? r2(ey - firm.macro.riskFreePct), spreadNowPts: r2(ey - pulse.tenYear) } : null,
  };
}
