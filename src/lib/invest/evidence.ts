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
 * Empty today, and that is the accurate state: nothing here has been checked
 * against a primary source in this session.
 */
export const SOURCES: Record<string, SourcedFact> = {};

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
