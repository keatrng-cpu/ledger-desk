/** Builds wire.deskSeq from the desk payload (shadow; see seq/rules.ts). Never throws into the card. */
import type { DeskPayload } from "@/lib/trading/build-desk";
import type { ArrayRow } from "../mtf-arrays";
import { brainBooks, ticketWord, type BrainBooks, type TicketWord } from "./brain-books";
import type { Side } from "./rules";
import { closedByFeed, feedClockRead } from "../smc-unity";
import { pdLegRead, type PdLegRead } from "./pd-leg";
import type { OhlcBar } from "@/lib/market/types";
import { premarketMapCached, type PremarketMap } from "./premarket-map";
import { amdRead, type AmdRead } from "./amd-state";
import { continuationRead, type ContRead } from "./continuation";
import { scenarios, rerankOnOpen, type ScenarioRead } from "./scenarios";
import { respectRead, type RespectRead } from "./respect";
import { buildLadderWire } from "./ladder-wire";
import type { LadderWire } from "./ladder";
import { intradayTicket, rungEval, ETF_OF, type IntradayTicket, type RungRead } from "./intraday-exec";

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
  /** F1: the premarket map per book (frozen at 09:25 ET). */
  map: Record<string, PremarketMap>;
  /** F4: AMD state machine per book (09:30–11:00 ET, closed bars). */
  amd: Record<string, AmdRead>;
  /** F9: continuation (rolled T1 / re-anchored entry) per book. */
  continuation: Record<string, ContRead>;
  /** F2/F7 scenario cards with odds; F3 respect ledger (per book). */
  scenarios: Record<string, ScenarioRead>;
  respect: Record<string, RespectRead>;
  /** F10: 0DTE intraday ticket for the live AMD/continuation setup per book + close-vs-wick per rung. */
  intraday: Record<string, { ticket: IntradayTicket | null; rungs: RungRead }>;
  /** Two-sided ladder (bull + bear entries, real stops, full HTF target ladder, calibrated odds, flip line). Display-only. */
  ladder: LadderWire | null;
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
  const map: Record<string, PremarketMap> = {};
  for (const side of ["left", "right"] as const) {
    const sym = i.desk[side].symbol;
    const b = bookOf(sym);
    const deskLevels = (i.desk.levels.find((l) => l.symbol === sym)?.items ?? []).map((x) => ({ name: x.name, price: x.price }));
    if (b.feedNowMs != null) map[sym] = premarketMapCached({ symbol: sym, minute: b.closed1m, bars15: (i.desk[side].bars ?? []) as OhlcBar[], deskLevels, nowMs: b.feedNowMs });
  }
  const amd: Record<string, AmdRead> = {};
  for (const side of ["left", "right"] as const) {
    const sym = i.desk[side].symbol;
    const b = bookOf(sym);
    if (b.feedNowMs != null) amd[sym] = amdRead(sym, map[sym] ?? null, b.closed1m, b.feedNowMs, { gapped: (i.desk.minuteFeed?.gaps ?? []).some((g) => g.symbol === sym && g.blocking) });
  }
  const continuation: Record<string, ContRead> = {};
  for (const side of ["left", "right"] as const) {
    const sym = i.desk[side].symbol;
    const b = bookOf(sym);
    if (b.feedNowMs != null) continuation[sym] = continuationRead(sym, map[sym] ?? null, b.closed1m, b.feedNowMs, amd[sym] ?? null);
  }
  const intraday: Record<string, { ticket: IntradayTicket | null; rungs: RungRead }> = {};
  for (const side of ["left", "right"] as const) {
    const sym = i.desk[side].symbol;
    const b = bookOf(sym);
    if (b.feedNowMs == null) continue;
    const live = amd[sym]?.live;
    const q = (side === "left" ? i.desk.quotes.left : i.desk.quotes.right) as { price: number | null; marketTimeMs?: number | null };
    const etf = ETF_OF[sym] as "QQQ" | "SPY" | undefined;
    const px = etf ? (i.desk.proxies?.[etf] ?? null) : null;
    const tk = live && live.entry != null && (live.stage === "ARMED" || live.stage === "ENTERED")
      ? intradayTicket({ book: sym, side: live.side, nowMs: b.feedNowMs, entry: live.entry, fut: { price: q.price, marketTimeMs: q.marketTimeMs ?? null }, etfQuote: px ? { price: px.price, marketTimeMs: px.marketTimeMs } : null, strikeSource: "chain" })
      : null;
    intraday[sym] = { ticket: tk, rungs: rungEval(b.closed1m, b.feedNowMs, map[sym]?.arrays ?? []) };
  }
  const scen: Record<string, ScenarioRead> = {}, respect: Record<string, RespectRead> = {};
  for (const side of ["left", "right"] as const) {
    const sym = i.desk[side].symbol; const b = bookOf(sym);
    scen[sym] = scenarios(map[sym] ?? null);
    if (b.feedNowMs != null) scen[sym] = rerankOnOpen(scen[sym], map[sym] ?? null, b.closed1m, b.feedNowMs);
    if (b.feedNowMs != null) respect[sym] = respectRead(sym, map[sym] ?? null, b.closed1m, b.feedNowMs);
  }
  const ladder = (i.desk as { twoSided?: LadderWire | null }).twoSided ?? buildLadderWire(i.desk);
  const base = { v: 1 as const, brainBooks: bb, ticket, floor, pdLeg, map, amd, continuation, intraday, scenarios: scen, respect, ladder };
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
  for (const m of Object.values(w.map)) {
    if (m.frozen && m.amd.expectManip) rows.push({ rule: "premarketMap", would: `${m.symbol} map @09:25: HTF ${m.biasStack.htf}/MTF ${m.biasStack.mtf}/LTF ${m.biasStack.ltf}, ${m.zone ?? "?"} of ${m.range?.lo}–${m.range?.hi} (EQ ${m.range?.eq}); expect the ${m.amd.expectManip} raid; ${m.arrays.length} arrays, ${m.pools.length} pools` });
  }
  for (const m of Object.values(w.map)) {
    const live = m.pools.filter((p) => !p.used), used = m.pools.filter((p) => p.used);
    if (live.length || used.length) rows.push({ rule: "eqPools", would: `${m.symbol} EQH/EQL unswept: ${live.map((p) => `${p.name ?? p.tf} ${p.price}`).join(", ") || "none"}; used (swept): ${used.length}` });
  }
  for (const sc of Object.values(w.scenarios ?? {})) if (sc.ranked.length) rows.push({ rule: "scenarios", would: `${sc.symbol} scripts: ${sc.ranked.slice(0, 2).map((x) => `${x.id} ${Math.round(x.prior * 100)}% (sweep ${x.trigger?.name ?? "?"} → ${x.draws[0]?.name ?? "?"})`).join(" / ")}` });
  for (const r of Object.values(w.respect ?? {})) if (r.tiers.all.stronger) rows.push({ rule: "respect", would: `${r.symbol} respect net ${r.tiers.all.net} → ${r.tiers.all.stronger} stronger (LTF ${r.tiers.ltf.net}, MTF ${r.tiers.mtf.net}, HTF ${r.tiers.htf.net})` });
  for (const a of Object.values(w.amd)) {
    const s = a.live;
    if (!s) continue;
    if (s.stage === "ARMED") rows.push({ rule: "amd", would: `${a.symbol} ${s.side} ARMED: ${s.raid?.name} raided, ${s.confirm?.why}; entry ${s.entry} (${s.entryWhy}), stop ${s.stop}, T1 ${s.t1?.name} ${s.t1?.price} (${s.t1?.r}R)` });
    else if (s.stage === "ENTERED") rows.push({ rule: "amd", would: `${a.symbol} ${s.side} ENTER at ${s.entry}, stop ${s.stop}, T1 ${s.t1?.name} ${s.t1?.price} — the desk would fire here (shadow)` });
    else if (s.stage === "MANIP" || s.stage === "CONFIRM") rows.push({ rule: "amd", would: `${a.symbol} ${s.side} ${s.stage}: ${s.log.at(-1)?.why}` });
  }
  for (const c of Object.values(w.continuation ?? {})) {
    for (const sd of ["short", "long"] as const) if (c.rolledT1[sd]) rows.push({ rule: "continuation", would: `${c.symbol} ${sd} T1 rolled to ${c.rolledT1[sd]!.name} ${c.rolledT1[sd]!.price} (regime ${c.regime})` });
    const a = c.setups.at(-1);
    if (a && (a.stage === "ARMED" || a.stage === "ENTERED")) rows.push({ rule: "continuation", would: `${c.symbol} ${a.side} continuation ${a.stage} at ${a.entry} (${a.entryWhy}), stop ${a.stop}, T1 ${a.t1.name} ${a.t1.price} (${a.t1.r}R) — not a second entry` });
  }
  for (const [sym, x] of Object.entries(w.intraday ?? {})) {
    if (x.ticket) rows.push({ rule: "intradayExec", would: x.ticket.refused ? `${sym} ${x.ticket.side} intraday ticket refused: ${x.ticket.refused}` : `${sym} ${x.ticket.side} → ${x.ticket.etf} ${x.ticket.dte}DTE ${x.ticket.strike} ${x.ticket.right} at live cross ${x.ticket.crossRatio}` });
    if (x.rungs.stale) rows.push({ rule: "intradayExec", would: `${sym} minute series stale (${x.rungs.minuteAgeS ?? "?"}s) — LTF decisions refused` });
    const ev = x.rungs.rungs.flatMap((r) => r.events.filter((e) => e.event === "sweep" || e.event === "fail").map((e) => `${r.tf} ${e.event} ${e.array}`));
    if (ev.length) rows.push({ rule: "intradayExec", would: `${sym} closed-rung reads: ${ev.slice(0, 4).join("; ")}` });
  }
  for (const r of w.ladder?.rows ?? []) rows.push({ rule: "ladder", would: r });
  const p = w.pdLeg;
  if (p?.flipsLegacy) rows.push({ rule: "pdLeg", would: `${p.side} POI ${p.poi} is ${p.atPoi!.zone} (${p.atPoi!.ratio}) of the leg ${p.leg!.lo}–${p.leg!.hi} — legacy pd_half fails at price, the leg read passes` });
  else if (p?.noEdge) rows.push({ rule: "pdLeg", would: `${p.side} POI ${p.poi} sits on the leg EQ ${p.leg!.eq} — no edge` });
  return rows;
}
