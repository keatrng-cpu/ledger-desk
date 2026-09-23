/**
 * Where a fact came from — the difference between knowing and remembering.
 *
 * THE PROBLEM THIS SOLVES
 * The dossier gate already refuses a BLANK field. It cannot tell the
 * difference between a field somebody verified against a proxy statement
 * and a field somebody typed from memory, and those are not the same thing
 * at all. Every governance fact in dossiers.ts today is the second kind:
 * asserted, plausible, unsourced. That was honest when a human wrote them
 * knowing they were provisional. It stops being honest the moment a
 * language model can write into the same field, because then a confident
 * sentence and a checked fact become indistinguishable forever.
 *
 * So evidence gets a level, and the level is visible:
 *
 *   VERIFIED  — a URL is attached. The URL is the evidence. Anyone can open
 *               it and disagree.
 *   ASSERTED  — stated by a person or a model, no source. Usable, flagged,
 *               and never allowed to look like the first kind.
 *   BLANK     — missing. Already blocks the buy.
 *
 * WHY THIS IS NOT SIMPLY "REQUIRE A SOURCE FOR EVERYTHING"
 * Requiring VERIFIED today would block all nine researched companies at
 * once and make the tab useless, which is how safety rails get deleted.
 * `canAdd` therefore still accepts ASSERTED — the existing behaviour — while
 * `strictGate` refuses it, `unsourced()` lists exactly what needs a link,
 * and the panel shows the level on every card. The ratchet only turns one
 * way: facts move from ASSERTED to VERIFIED as sources get attached, never
 * back.
 *
 * THE RULE FOR MODEL-SUPPLIED FACTS, WHICH IS THE WHOLE POINT
 * A model may PROPOSE a fact and must attach a citation. The citation, not
 * the model, is what promotes the fact to VERIFIED — and only after a human
 * has opened it. Nothing in kill-watch.ts or grok-research.ts writes to a
 * dossier. They return links. A person moves the fact. This keeps the
 * desk's standing rule intact: the coach narrates, it never gates.
 */

import type { Dossier } from "./universe";
import { ALL_DOSSIERS } from "./dossiers";

export type EvidenceLevel = "verified" | "asserted" | "blank";

export interface SourcedFact {
  value: string;
  /** Primary source. A proxy statement, 10-K, or the company's own IR page. */
  url: string | null;
  /** When someone actually opened that URL. */
  checkedAt: string | null;
}

/**
 * Sources attached so far, keyed by `TICKER.field`. Kept as a separate map
 * rather than inline in dossiers.ts so that attaching a citation is a small,
 * reviewable diff instead of an edit to a 400-line research file.
 *
 * The first verification pass (2026-09-22) checked six of nine operators
 * against SEC EDGAR and CORRECTED ONE: this book had Apple's CEO as Tim Cook
 * with the succession described as a pending question, when John Ternus had
 * in fact been CEO since 2026-09-01. That error survived being written down,
 * reviewed and committed, and was caught only by opening a filing — which is
 * the entire argument for this file existing.
 */
export const SOURCES: Record<string, SourcedFact> = {
  // Verified 2026-09-22 against SEC EDGAR. Each URL is the exact document
  // read, not a search page. A signed Section 302 certification on a 10-Q is
  // the strongest available evidence of who holds the office TODAY: it is
  // signed by the principal executive officer under penalty of perjury and
  // is filed quarterly, so it goes stale far more slowly than a proxy.
  "ETN.governance.ceo": {
    value: "Paulo Ruiz",
    url: "https://www.sec.gov/Archives/edgar/data/1551182/000155118226000030/etn06302026ex311.htm",
    checkedAt: "2026-09-22",
  },
  "CEG.governance.ceo": {
    value: "Joseph Dominguez",
    url: "https://www.sec.gov/Archives/edgar/data/1868275/000186827526000104/ceg-20260630x10qxexh311.htm",
    checkedAt: "2026-09-22",
  },
  "V.governance.ceo": {
    value: "Ryan McInerney",
    url: "https://www.sec.gov/Archives/edgar/data/1403161/000140316126000104/vex31163026.htm",
    checkedAt: "2026-09-22",
  },
  "MSFT.governance.ceo": {
    value: "Satya Nadella",
    url: "https://www.sec.gov/Archives/edgar/data/789019/000119312526323660/msft-ex31_1.htm",
    checkedAt: "2026-09-22",
  },
  "GOOGL.governance.ceo": {
    value: "Sundar Pichai",
    url: "https://www.sec.gov/Archives/edgar/data/1652044/000165204426000071/googexhibit3101q22026.htm",
    checkedAt: "2026-09-22",
  },
  // The correction. A Form 3 is the officer's own sworn Section 16 filing and
  // exists only because the role actually commenced — stronger than any
  // announcement, and it is what settles this one.
  "NVDA.governance.ceo": {
    value: "Jen-Hsun Huang",
    url: "https://www.sec.gov/Archives/edgar/data/1045810/000104581026000075/nvda2027q2ex311.htm",
    checkedAt: "2026-09-22",
  },
  "COST.governance.ceo": {
    value: "Ron M. Vachris",
    url: "https://www.sec.gov/Archives/edgar/data/909832/000090983226000051/costex31110q51026.htm",
    checkedAt: "2026-09-22",
  },
  "LLY.governance.ceo": {
    value: "David A. Ricks",
    url: "https://www.sec.gov/Archives/edgar/data/59478/000005947826000081/lly-06302026x10qxexhibit311.htm",
    checkedAt: "2026-09-22",
  },
  "AAPL.governance.ceo": {
    value: "John Ternus",
    url: "https://www.sec.gov/Archives/edgar/data/320193/000114036126035325/ef20081427_8ka.htm",
    checkedAt: "2026-09-22",
  },
};

/**
 * A governance fact that a NEWER document contradicts an OLDER one on.
 *
 * Kept separate and printed loudly because of what turned up on the first
 * verification pass: Constellation's most recent proxy statement (DEF 14A,
 * filed 2026-03-19) says under Board Governance that the CEO and Board Chair
 * roles are separate. That stopped being true on 2026-08-04, when the board
 * elected the sitting CEO as chair. Reading the newest PROXY — the document
 * this tab originally said would settle governance questions — returns the
 * wrong answer. Only the 8-K has it.
 *
 * The lesson generalises: for "who holds this office right now", filing
 * RECENCY beats filing TYPE. An 8-K Item 5.02 or a signed 10-Q certification
 * is fresher evidence than an annual proxy, and a proxy is a snapshot of the
 * date it was filed rather than a standing description.
 */
export const STALENESS_TRAPS = [
  {
    ticker: "AAPL",
    stale:
      "This desk's own dossier, and Apple's DEF 14A (2026-01-08) and 10-Q (2026-07-31): Tim Cook, Chief Executive Officer.",
    current:
      "8-K/A filed 2026-09-01 and Ternus' own Form 3: John Ternus became CEO effective 2026-09-01; Cook became Executive Chair.",
    url: "https://www.sec.gov/Archives/edgar/data/320193/000114036126035325/ef20081427_8ka.htm",
    lesson:
      "A fact can be true for fifteen years and then stop. The dossier asserted Cook from memory and was wrong for three weeks without anything in the system noticing.",
  },
  {
    ticker: "CEG",
    stale: "DEF 14A filed 2026-03-19: 'Chief Executive Officer and Board Chair roles are separate.'",
    current:
      "8-K filed 2026-08-05: Lawless retired as Chair 2026-08-04 and the board elected Dominguez, the sitting CEO, to chair it.",
    url: "https://www.sec.gov/Archives/edgar/data/1868275/000186827526000089/ceg-20260804.htm",
    lesson: "For who-holds-the-office, recency beats document type. The newest proxy can be the wrong answer.",
  },
] as const;

export function evidenceFor(ticker: string, field: string): EvidenceLevel {
  const key = `${ticker}.${field}`;
  const s = SOURCES[key];
  if (s?.url && s.checkedAt) return "verified";
  const d = ALL_DOSSIERS.find((x) => x.ticker === ticker);
  if (!d) return "blank";
  if (field === "governance.ceo") return d.governance.ceo.trim() ? "asserted" : "blank";
  return "asserted";
}

/** A company whose operator has never been checked against a filing. */
export interface Unsourced {
  ticker: string;
  field: string;
  current: string;
  /** What document would settle it. */
  wouldSettle: string;
}

/**
 * Everything a person should go check. This list is the honest backlog of
 * the research, and it should be printed rather than buried.
 */
export function unsourced(): Unsourced[] {
  const out: Unsourced[] = [];
  for (const d of ALL_DOSSIERS) {
    if (d.kind !== "company") continue;
    if (evidenceFor(d.ticker, "governance.ceo") !== "verified") {
      out.push({
        ticker: d.ticker,
        field: "governance.ceo",
        current: d.governance.ceo || "(blank)",
        wouldSettle: `${d.ticker} DEF 14A proxy statement, or the company's own leadership page`,
      });
    }
  }
  return out;
}

export interface StrictGate {
  canAdd: boolean;
  reason: string;
}

/**
 * The gate a mature version of this book would run. Not wired to the buy
 * path yet — it would refuse everything today — but exposed so the tab can
 * show how far the research actually is from where it should be.
 */
export function strictGate(d: Dossier): StrictGate {
  if (d.kind === "fund") return { canAdd: true, reason: "Fund — no operator to verify." };
  const level = evidenceFor(d.ticker, "governance.ceo");
  if (level === "verified") return { canAdd: true, reason: "Operator verified against a primary source." };
  return {
    canAdd: false,
    reason:
      level === "blank"
        ? "No operator recorded."
        : `Operator "${d.governance.ceo}" is asserted, not verified — no primary source attached.`,
  };
}

/** How sourced the book is overall. One number worth watching go up. */
export function evidenceSummary() {
  const companies = ALL_DOSSIERS.filter((d) => d.kind === "company");
  const verified = companies.filter((d) => evidenceFor(d.ticker, "governance.ceo") === "verified").length;
  return {
    companies: companies.length,
    verified,
    unsourced: unsourced().length,
    line:
      verified === companies.length
        ? `All ${companies.length} operators verified against primary sources.`
        : `${verified} of ${companies.length} operators verified. ${companies.length - verified} are asserted from memory and should not be treated as checked.`,
  };
}
