/**
 * IPO watch — new listings, and the pre-written rule for when one may even
 * be researched for the book.
 *
 * WHY A RULE AND NOT A PICK
 * A new listing arrives with the loudest story it will ever have and the
 * least evidence it will ever have: no public-company quarters, insiders
 * locked up and waiting to sell, and a first-day "pop" that goes to the
 * people allocated shares at the offer price — not to a retail buyer at the
 * open. The research on long-run IPO returns (ipo-watch.json `evidence`) is
 * why this book never buys the story. It waits until the facts exist, then
 * runs the SAME gate as every other company: a dossier, a verified operator,
 * a kill rule, captured fundamentals, and the price-vs-record comparison.
 *
 * THE RULE (pre-registered — written before any particular IPO)
 *   1. Not at the offer and not in the first trading days.
 *   2. Not before the lock-up expires (the prospectus date, else 180 days).
 *   3. Not before four quarterly reports as a public company (~1 year).
 *   4. Then it is a normal research candidate — dossier or nothing.
 * Funds, ETF share classes, SPACs and units are not companies and are
 * filtered out of the watch.
 */

import data from "../../data/ipo-watch.json";

export interface IpoEvidence {
  id: string;
  claim: string;
  source: string;
  url: string;
}

export interface UpcomingIpo {
  company: string;
  ticker: string | null;
  exchange: string | null;
  expected: string | null;
  status: string;
  priceRange: string | null;
  url: string | null;
}

export interface PricedIpo {
  company: string;
  ticker: string;
  exchange: string | null;
  pricedOn: string;
  offerPrice: number | null;
  firstDayClose: number | null;
  lockupExpires: string | null;
  url: string | null;
}

interface IpoDoc {
  capturedAt: string;
  sources: string[];
  note: string;
  evidence: IpoEvidence[];
  upcoming: UpcomingIpo[];
  priced: PricedIpo[];
}

const DOC = data as unknown as IpoDoc;

export const LOCKUP_DAYS_DEFAULT = 180;
/** Four quarterly reports as a public company, roughly. */
export const TRACK_RECORD_DAYS = 365;

export function ipoCapturedAt(): string {
  return DOC.capturedAt;
}
export function ipoEvidence(): IpoEvidence[] {
  return DOC.evidence;
}
export function ipoSources(): string[] {
  return DOC.sources;
}

/** Share classes, funds and blank-check companies are not operating businesses. */
export function isOperatingCompany(name: string): boolean {
  return !/\b(etf|fund|funds|trust|investment dimensions|acquisition corp|acquisition co|capital acquisition|spac|units?)\b/i.test(name);
}

function addDays(date: string, n: number): string {
  return new Date(Date.parse(`${date}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

export type IpoStage = "upcoming" | "lockup" | "track-record" | "research";

export interface IpoRead {
  stage: IpoStage;
  /** First date the book may open a dossier on it. */
  eligibleFrom: string | null;
  lockupEnds: string | null;
  line: string;
}

/** Where a priced IPO stands against the rule, as of `today`. */
export function ipoRead(ipo: PricedIpo, today: string): IpoRead {
  const lockupEnds = ipo.lockupExpires ?? addDays(ipo.pricedOn, LOCKUP_DAYS_DEFAULT);
  const trackFrom = addDays(ipo.pricedOn, TRACK_RECORD_DAYS);
  const eligibleFrom = lockupEnds > trackFrom ? lockupEnds : trackFrom;
  const pop = ipo.offerPrice && ipo.firstDayClose ? ipo.firstDayClose / ipo.offerPrice - 1 : null;
  const popLine = pop != null ? ` First day ${pop >= 0 ? "+" : ""}${(pop * 100).toFixed(0)}% vs the $${ipo.offerPrice} offer — that went to the allocation, not to a buyer at the open.` : "";
  if (today < lockupEnds) {
    return {
      stage: "lockup",
      eligibleFrom,
      lockupEnds,
      line: `Lock-up ${ipo.lockupExpires ? "ends" : "ends ~"} ${lockupEnds}${ipo.lockupExpires ? "" : " (180-day default; the prospectus sets the real date)"} — insiders can sell from then. Not researchable before ${eligibleFrom}.${popLine}`,
    };
  }
  if (today < trackFrom) {
    return {
      stage: "track-record",
      eligibleFrom,
      lockupEnds,
      line: `Lock-up has passed; still short of four public quarters. Researchable from ${eligibleFrom}.${popLine}`,
    };
  }
  return {
    stage: "research",
    eligibleFrom,
    lockupEnds,
    line: `Past the lock-up and a year of public reports — it may be researched like any company: dossier, verified operator, kill rule, price vs record. Not a buy by itself.${popLine}`,
  };
}

export function upcomingIpos(today: string): UpcomingIpo[] {
  return DOC.upcoming
    .filter((u) => isOperatingCompany(u.company))
    .filter((u) => !u.expected || u.expected >= addDays(today, -3))
    .sort((a, b) => (a.expected ?? "9999").localeCompare(b.expected ?? "9999"));
}

export function pricedIpos(today: string): (PricedIpo & { read: IpoRead })[] {
  return DOC.priced
    .filter((p) => isOperatingCompany(p.company))
    .map((p) => ({ ...p, read: ipoRead(p, today) }))
    .sort((a, b) => (a.pricedOn < b.pricedOn ? 1 : -1));
}
