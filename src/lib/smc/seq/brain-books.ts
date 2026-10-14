/**
 * Fix 5 — the brain grades per book. Floor, master and the watcher's grok_agree read the word for the
 * TICKET's book and side, not the top card's. A STAND on a DIFFERENT symbol is a caution, not a block
 * (Accuracy #2: the same symbol on the opposite side is the opposite-brain refusal and is never weakened).
 */
import { seqMode, type Mode, type Side } from "./rules";

export type BrainWord = "TAKE" | "WAIT" | "STAND" | "UNGRADED";
export interface BookGrade { symbol: string; side: Side | null; word: string; missing?: string | null }
export interface BrainBooks {
  mode: Mode;
  /** words[symbol][side] — UNGRADED when the brain has no read for that book/side. */
  words: Record<string, Record<Side, BrainWord>>;
  missing: Record<string, string | null>;
}
export interface TicketWord {
  mode: Mode;
  book: string | null;
  side: Side | null;
  /** The word the per-book brain gives THIS ticket. */
  word: BrainWord;
  /** What the legacy one-book brain said and about which book. */
  legacy: { word: string | null; symbol: string | null; side: Side | null };
  /** Legacy refused because it graded another symbol; per-book does not refuse. */
  otherBookBlock: boolean;
  wouldUnblock: boolean;
  wouldBlock: boolean;
}

const W = (w: string | null | undefined): BrainWord => (w === "TAKE" || w === "WAIT" || w === "STAND" ? w : "UNGRADED");

export function brainBooks(books: (BookGrade | null | undefined)[]): BrainBooks {
  const words: BrainBooks["words"] = {};
  const missing: BrainBooks["missing"] = {};
  for (const b of books) {
    if (!b?.symbol) continue;
    const w = (words[b.symbol] ??= { long: "UNGRADED", short: "UNGRADED" });
    if (b.side) w[b.side] = W(b.word);
    missing[b.symbol] = b.missing ?? null;
  }
  return { mode: seqMode("brainBooks"), words, missing };
}

export function ticketWord(
  bb: BrainBooks,
  ticket: { symbol: string | null; side: Side | null },
  legacy: { symbol?: string | null; side?: string | null; word?: string | null } | null | undefined,
): TicketWord {
  const ls = legacy?.side === "long" || legacy?.side === "short" ? legacy.side : null;
  const word: BrainWord = ticket.symbol && ticket.side ? bb.words[ticket.symbol]?.[ticket.side] ?? "UNGRADED" : "UNGRADED";
  const otherSymbol = Boolean(legacy?.symbol && ticket.symbol && legacy.symbol !== ticket.symbol);
  const legacyRefuses = !legacy?.word || legacy.word === "STAND" || legacy.word === "WAIT" || (ls != null && ls !== ticket.side && !otherSymbol);
  const otherBookBlock = otherSymbol && legacyRefuses;
  return {
    mode: bb.mode,
    book: ticket.symbol,
    side: ticket.side,
    word,
    legacy: { word: legacy?.word ?? null, symbol: legacy?.symbol ?? null, side: ls },
    otherBookBlock,
    // only a different-symbol refusal can be lifted, and only when the ticket's own book says TAKE
    wouldUnblock: otherBookBlock && word === "TAKE",
    // the legacy brain agreed only because it graded another book; the ticket's own book refuses
    wouldBlock: otherSymbol && !legacyRefuses && (word === "STAND" || word === "WAIT"),
  };
}
