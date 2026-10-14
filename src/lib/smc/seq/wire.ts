/** Builds wire.deskSeq from the desk payload (shadow; see seq/rules.ts). Never throws into the card. */
import type { DeskPayload } from "@/lib/trading/build-desk";
import type { ArrayRow } from "../mtf-arrays";
import { brainBooks, ticketWord, type BrainBooks, type TicketWord } from "./brain-books";
import type { Side } from "./rules";
import { closedByFeed, feedClockRead } from "../smc-unity";
import { pdLegRead, type PdLegRead } from "./pd-leg";
import type { OhlcBar } from "@/lib/market/types";

type Cand = DeskPayload["scan"]["candidates"][number];
const UNDERLIER_BOOK: Record<string, string> = { QQQ: "MNQ", SPY: "ES", NQ: "MNQ", MNQ: "MNQ", ES: "ES", MES: "ES" };

export interface DeskSeqWire {
  v: 1;
  brainBooks: BrainBooks;
  /** The per-book word for the top card (desk ticket) and for the Floor ticket (its underlier's book). */
  ticket: TicketWord | null;
  floor: TicketWord | null;
  /** F6: premium/discount at the top card's POI inside the dealing leg + EQ stack. */
  pdLeg: PdLegRead | null;
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
  const bookOf = (sym: string) => {
    const isL = sym === i.desk.left.symbol;
    const minute = ((isL ? i.desk.mtf?.left.minute : i.desk.mtf?.right.minute) ?? []) as OhlcBar[];
    const q = (isL ? i.desk.quotes.left : i.desk.quotes.right) as { price: number | null; marketTimeMs?: number | null };
    const fc = feedClockRead(minute, q.marketTimeMs ?? null);
    return { isL, minute, closed1m: closedByFeed(minute, 60_000, fc.feedNowMs), feedNowMs: fc.feedNowMs, price: q.price };
  };
  let pdLeg: PdLegRead | null = null;
  if (i.top) {
    const b = bookOf(i.top.symbol);
    const mb = i.top.symbol === sm?.left?.symbol ? sm.left : i.top.symbol === sm?.right?.symbol ? sm.right : null;
    const poi = (i.top as { entryPx?: number | null }).entryPx ?? (i.top.plan as { entry?: number | null } | null | undefined)?.entry ?? null;
    pdLeg = pdLegRead({ side: i.top.side as Side, poi, price: b.price, closed1m: b.closed1m, feedNowMs: b.feedNowMs, legacyFail: mb?.missing === "POI in correct half" });
  }
  const base = { v: 1 as const, brainBooks: bb, ticket, floor, pdLeg };
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
  const p = w.pdLeg;
  if (p?.flipsLegacy) rows.push({ rule: "pdLeg", would: `${p.side} POI ${p.poi} is ${p.atPoi!.zone} (${p.atPoi!.ratio}) of the leg ${p.leg!.lo}–${p.leg!.hi} — legacy pd_half fails at price, the leg read passes` });
  else if (p?.noEdge) rows.push({ rule: "pdLeg", would: `${p.side} POI ${p.poi} sits on the leg EQ ${p.leg!.eq} — no edge` });
  return rows;
}
