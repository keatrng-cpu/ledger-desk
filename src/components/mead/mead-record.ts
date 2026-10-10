/**
 * The record the Skald's Ledger shows, in the engine's own words (browser only — the ledgers live in this device's storage).
 *
 *   GO ledger    — go-ledger.ts goStats().line   (every scanner GO, settled from the final score; "noise" under 30 settled)
 *   paper book   — paper-scorer.ts scorePaper().verdict   ("too few to read" until enough tickets have settled)
 *   journal      — journal.ts readJournal().line   (the trader's own fills by entry price)
 *
 * Nothing here is computed: each line is a sentence one of those modules already wrote. Paper only; no order path.
 */

import { goStats } from "@/lib/predict/go-ledger";
import { readJournal } from "@/lib/predict/journal";
import { scorePaper } from "@/lib/predict/paper-scorer";
import { loadPaper } from "@/lib/predict/pm-paper-store";
import type { HallExtras } from "./mead-screens";

export function readHallRecord(): NonNullable<HallExtras["record"]> | null {
  if (typeof window === "undefined") return null;
  try {
    const go = goStats();
    const paper = scorePaper(loadPaper());
    const journal = readJournal();
    return {
      go: go.line,
      paper: paper.verdict,
      journal: journal.line,
      read: paper.overall.read === "ok" ? "The paper record can be read." : `Paper record: ${paper.overall.read}.`,
    };
  } catch {
    return null;
  }
}
