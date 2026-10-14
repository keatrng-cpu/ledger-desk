/** Builds wire.deskSeq from the desk payload (shadow; see seq/rules.ts). Never throws into the card. */
import type { DeskPayload } from "@/lib/trading/build-desk";
import type { ArrayRow } from "../mtf-arrays";
import { brainBooks, ticketWord, type BrainBooks, type TicketWord } from "./brain-books";
import type { Side } from "./rules";

type Cand = DeskPayload["scan"]["candidates"][number];
const UNDERLIER_BOOK: Record<string, string> = { QQQ: "MNQ", SPY: "ES", NQ: "MNQ", MNQ: "MNQ", ES: "ES", MES: "ES" };

export interface DeskSeqWire {
  v: 1;
  brainBooks: BrainBooks;
  /** The per-book word for the top card (desk ticket) and for the Floor ticket (its underlier's book). */
  ticket: TicketWord | null;
  floor: TicketWord | null;
  /** Short human rows for the watcher's shadow:seq:* log. */
  rows: { rule: string; would: string }[];
}

export interface SeqInputs {
  desk: DeskPayload;
  top: Cand | null;
  rows: (ArrayRow & { symbol: string })[];
  legacyBrain: { symbol: string; side: Side | null; word: string } | null;
  floorTicket: { underlier?: string | null; side?: string | null } | null;
}

export function buildDeskSeq(i: SeqInputs): DeskSeqWire {
  const sm = i.desk.smcMaster;
  const bb = brainBooks([sm?.left ?? null, sm?.right ?? null].map((b) => (b ? { symbol: b.symbol, side: b.side, word: b.word, missing: b.missing } : null)));
  const ticket = i.top ? ticketWord(bb, { symbol: i.top.symbol, side: i.top.side as Side }, i.legacyBrain) : null;
  const fb = i.floorTicket?.underlier ? UNDERLIER_BOOK[String(i.floorTicket.underlier).toUpperCase()] ?? null : null;
  const fs: Side | null = i.floorTicket?.side === "put" || i.floorTicket?.side === "short" ? "short" : i.floorTicket?.side === "call" || i.floorTicket?.side === "long" ? "long" : null;
  const floor = fb && fs ? ticketWord(bb, { symbol: fb, side: fs }, i.legacyBrain) : null;
  const base = { v: 1 as const, brainBooks: bb, ticket, floor };
  return { ...base, rows: seqRows(base) };
}

export function seqRows(w: Omit<DeskSeqWire, "rows">): { rule: string; would: string }[] {
  const rows: { rule: string; would: string }[] = [];
  for (const [who, t] of [["desk", w.ticket], ["floor", w.floor]] as const) {
    if (!t) continue;
    if (t.wouldUnblock) rows.push({ rule: "brainBooks", would: `${who} ${t.book} ${t.side}: legacy brain ${t.legacy.word} graded ${t.legacy.symbol} — per-book word TAKE, would not block` });
    else if (t.otherBookBlock) rows.push({ rule: "brainBooks", would: `${who} ${t.book} ${t.side}: legacy brain ${t.legacy.word} graded ${t.legacy.symbol} — per-book word ${t.word}, caution only` });
    if (t.wouldBlock) rows.push({ rule: "brainBooks", would: `${who} ${t.book} ${t.side}: legacy brain agreed via ${t.legacy.symbol}; this book says ${t.word} — would refuse` });
  }
  return rows;
}
