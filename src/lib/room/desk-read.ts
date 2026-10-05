/**
 * The live desk, translated into what the trading floor reads.
 *
 * Two outputs, kept apart on purpose:
 *  - `marketDataFromDesk` builds the trader's input schema (price, RSI, VIX,
 *    trend, volume spike). Those five fields are what the characters TALK
 *    about. None of them is a gate.
 *  - `readDeskForRoom` carries the gates: the options desk's 0–1 DTE day card
 *    (verdict, ticket, the SMC word), the entry tier against the CE, the
 *    clock, the news blackout, and the desk-computed LEVEL exits for the
 *    room's open positions.
 *
 * Everything here is read from desk modules — `evaluateOptionsDesk`,
 * `readEntry`, `failedHold`, `volumeRatio` — and nothing is recomputed in a
 * second way. The room may not have its own opinion of "ready".
 */

import type { DeskPayload } from "@/lib/trading/build-desk";
import type { OptionsDesk, RhStrategyCard } from "@/lib/trading/options-desk";
import { estimateSpot, spotSource } from "@/lib/trading/options-desk";
import { isHighProbPath } from "@/lib/alerts/path-alarm";
import { readEntry } from "@/lib/trading/entry-trigger";
import { EVENT_VOL_MIN, volumeRatio } from "@/lib/trading/session-event";
import { failedHold } from "@/lib/trading/exit-rules";
import { etWallToEpochMs, isJudasWindow } from "@/lib/trading/sessions";
import { NEWS_CALENDAR } from "@/lib/trading/news";
import { compareForBoard } from "@/lib/trading/scanner";
import type { OhlcBar } from "@/lib/market/types";
import type { HtfBiasRead } from "@/lib/trading/structure";
import type { Agenda, AgendaEvent, AgendaSetup } from "./agents";
import type { HeldLevels, RoomDeskRead, RoomEntryRead, RoomExitRead, Trend, UnderlierTape } from "./orchestrator";
import { etDateOf, type OptionType, type Underlier } from "./option-math";

const BAR_MS = 15 * 60_000;

/** Bars whose 15m bucket has closed. A forming candle never counts (tf-ladder.ts, exit-rules.ts). */
export function closedBars(bars: OhlcBar[], nowMs: number, tfMs = BAR_MS): OhlcBar[] {
  let end = bars.length;
  while (end > 0 && bars[end - 1]!.t + tfMs > nowMs) end--;
  return bars.slice(0, end);
}

/** RSI(14), Wilder smoothing, on closes. Null when there are not enough bars. */
export function rsiWilder(closes: number[], period = 14): number | null {
  if (closes.length <= period) return null;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i]! - closes[i - 1]!;
    if (d >= 0) gain += d;
    else loss -= d;
  }
  gain /= period;
  loss /= period;
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i]! - closes[i - 1]!;
    gain = (gain * (period - 1) + Math.max(d, 0)) / period;
    loss = (loss * (period - 1) + Math.max(-d, 0)) / period;
  }
  if (loss === 0) return gain === 0 ? 50 : 100;
  return 100 - 100 / (1 + gain / loss);
}

function trendOf(b: HtfBiasRead | undefined): Trend {
  return b?.topDown === "bull" ? "BULLISH" : b?.topDown === "bear" ? "BEARISH" : "CHOPPY";
}

/** The two futures books, mapped to the ETF each one prices (QQQ ← NQ, SPY ← ES). */
export function booksOf(desk: DeskPayload) {
  const isNq = (s: string) => s === "NQ" || s === "MNQ";
  const nqLeft = isNq(desk.left.symbol);
  const nq = {
    minute: (nqLeft ? desk.mtf?.left?.minute : desk.mtf?.right?.minute) ?? [],
    series: nqLeft ? desk.left : desk.right,
    quote: nqLeft ? desk.quotes.left : desk.quotes.right,
    bias: nqLeft ? desk.bias.left : desk.bias.right,
    draw: nqLeft ? desk.draws.left : desk.draws.right,
    smc: nqLeft ? desk.smcMaster.left : desk.smcMaster.right,
  };
  const es = {
    minute: (nqLeft ? desk.mtf?.right?.minute : desk.mtf?.left?.minute) ?? [],
    series: nqLeft ? desk.right : desk.left,
    quote: nqLeft ? desk.quotes.right : desk.quotes.left,
    bias: nqLeft ? desk.bias.right : desk.bias.left,
    draw: nqLeft ? desk.draws.right : desk.draws.left,
    smc: nqLeft ? desk.smcMaster.right : desk.smcMaster.left,
  };
  return { QQQ: nq, SPY: es } as const;
}

export interface TapeMeta {
  rsiTf: string;
  rsiFrom: Record<Underlier, string>;
  rsiKnown: Record<Underlier, boolean>;
  vixKnown: boolean;
  volRatio: Record<Underlier, number>;
}

/** The trader's `market_data` block, from the live desk. */
export function marketDataFromDesk(
  desk: DeskPayload,
  vix: number | null,
  nowMs: number,
): { market: Record<Underlier, UnderlierTape>; meta: TapeMeta } {
  const books = booksOf(desk);
  const esPx = books.SPY.quote.price;
  const nqPx = books.QQQ.quote.price;
  const out = {} as Record<Underlier, UnderlierTape>;
  const meta: TapeMeta = {
    rsiTf: "15m",
    rsiFrom: { SPY: books.SPY.series.symbol, QQQ: books.QQQ.series.symbol },
    rsiKnown: { SPY: false, QQQ: false },
    vixKnown: vix != null && vix > 0,
    volRatio: { SPY: 0, QQQ: 0 },
  };
  for (const u of ["SPY", "QQQ"] as const) {
    const b = books[u];
    const closed = closedBars(b.series.bars ?? [], nowMs);
    // RSI is scale-free, so the future's 15m closes stand in for the ETF's.
    const rsi = rsiWilder(closed.map((x) => x.c));
    const ratio = closed.length ? volumeRatio(closed, closed.length - 1) : 0;
    meta.rsiKnown[u] = rsi != null;
    meta.volRatio[u] = ratio;
    out[u] = {
      price: Math.round(estimateSpot(u, esPx, nqPx, desk.proxies) * 100) / 100,
      // 50 = "no reading", flagged in meta and never used as a gate.
      rsi: rsi != null ? Math.round(rsi * 10) / 10 : 50,
      vix: vix != null && vix > 0 ? vix : 0,
      trend: trendOf(b.bias),
      volume_spike: ratio >= EVENT_VOL_MIN,
    };
  }
  return { market: out, meta };
}

/** What a room position must carry for the desk to price its level exits. */
export interface ExitWatch {
  id: string;
  trimmed: boolean;
  openedAt: number;
  fut: { symbol: string; side: "long" | "short"; entry: number; stop: number; t1: number | null; t2: number | null } | null;
  /** What the desk priced the plan at when the room filled: P(T1 | filled) and the ATR it was measured in. */
  quant?: { pT1: number; atr: number | null } | null;
}

function underlierOfSymbol(sym: string): Underlier {
  return sym.includes("ES") ? "SPY" : "QQQ";
}

function cardEntry(desk: DeskPayload, card: RhStrategyCard): RoomEntryRead {
  const books = booksOf(desk);
  // The same candidate the options desk's day cards read: the first PATH
  // A+/A/A− on the scan (`isHighProbPath`, path-alarm.ts).
  const c = desk.scan.candidates.find((x) => isHighProbPath(x));
  const underlier: Underlier = card.ticket?.underlier ?? (c ? underlierOfSymbol(c.symbol) : "QQQ");
  const book = books[underlier];
  const futSide: "long" | "short" = c?.side === "short" ? "short" : c ? "long" : book.bias.topDown === "bear" ? "short" : "long";
  const type: OptionType = card.ticket ? (card.ticket.side === "put" ? "PUT" : "CALL") : futSide === "short" ? "PUT" : "CALL";
  const dte: 0 | 1 = card.id === "judas_ifvg_0dte" ? 0 : 1;
  const plan = book.smc.plan;
  const read = plan ? readEntry(plan, book.quote.price, book.draw.atr || null) : null;
  return {
    card: card.id === "judas_ifvg_0dte" ? "judas_ifvg_0dte" : "path_continuation",
    name: card.name,
    verdict: card.verdict,
    blocks: card.blocks,
    underlier,
    type,
    dte,
    band: card.pathBand,
    confluence: c?.confluence ?? 0,
    futSymbol: book.series.symbol,
    futSide,
    smcWord: book.smc.word,
    smcMissing: book.smc.missing,
    deskContracts: card.ticket?.contracts ?? null,
    sizedFrom: card.ticket?.sizedFrom ?? null,
    // The desk ticket's own delta band; without a ticket, the band its card
    // would have asked for (options-desk.ts toTicket calls).
    deltaMin: card.ticket?.deltaMin ?? 0.35,
    deltaMax: card.ticket?.deltaMax ?? (dte === 0 ? 0.5 : 0.45),
    plan: plan ? { entry: plan.entry, stop: plan.stop, t1: plan.t1, t2: plan.t2, rr1: plan.rr1 } : null,
    tier: read?.tier ?? null,
    awayPts: read?.awayPts ?? null,
    pT1: c?.hitOdds?.pT1 ?? null,
    expR: c?.hitOdds?.expR ?? null,
    pFill: c?.hitOdds?.pFill ?? null,
    patterns: c?.patterns ?? null,
    // The ATR the model measured T1 in, recovered from its own geometry so the
    // room's time curve buckets the plan exactly as hit-odds did.
    atr: plan?.t1 != null && c?.hitOdds?.geometry.t1Atr ? Math.abs(plan.t1 - plan.entry) / c.hitOdds.geometry.t1Atr : null,
    strategy: c ? c.completeStrategy || c.strategyPrimary || null : null,
    drivers: (c?.hitOdds?.drivers ?? []).slice(0, 3).map((d) => ({ label: d.label, pts: d.pts, reliable: d.reliable })),
  };
}

/** Where each open position's futures plan stands right now. */
export function computeHeld(
  watch: ExitWatch[],
  futures: Record<Underlier, { symbol: string; price: number }>,
): Record<string, HeldLevels> {
  const out: Record<string, HeldLevels> = {};
  for (const w of watch) {
    if (!w.fut) continue;
    const u = underlierOfSymbol(w.fut.symbol);
    out[w.id] = {
      symbol: w.fut.symbol,
      side: w.fut.side,
      stop: w.fut.stop,
      t1: w.fut.t1,
      t2: w.fut.t2,
      price: futures[u].price,
      entry: w.fut.entry,
      atr: w.quant?.atr ?? null,
      pT1: w.quant?.pT1 ?? null,
      openedAt: w.openedAt,
    };
  }
  return out;
}

const SETUP_BANDS = new Set(["A+", "A", "A-", "A−", "B+"]);

/**
 * The director's agenda: the next release, the one that just printed (with
 * the desk's stamped actual and what the futures did in the first 15
 * minutes), and the best B+ to A+ card on the scan.
 */
export function agendaFromDesk(desk: DeskPayload, nowMs: number): Agenda {
  const books = booksOf(desk);
  const today = etDateOf(nowMs);
  const n = desk.news.nextEvent;
  const next: AgendaEvent | null = n
    ? { name: n.name, date: n.date, timeEt: n.timeEt, impact: n.impact, minutes: n.minutesAway }
    : null;

  let last: AgendaEvent | null = null;
  const released = NEWS_CALENDAR.filter((e) => e.date === today)
    .map((e) => ({ e, at: etWallToEpochMs(e.date, e.timeEt) }))
    .filter((x) => x.at <= nowMs)
    .sort((a, b) => b.at - a.at)[0];
  if (released) {
    const { e, at } = released;
    const stamped = (desk.weekAhead?.today?.news ?? []).find(
      (x) => x.timeEt === e.timeEt && (x.name.split(" ")[0] ?? "") === (e.name.split(" ")[0] ?? ""),
    );
    last = {
      name: e.name,
      date: e.date,
      timeEt: e.timeEt,
      impact: e.impact,
      minutes: Math.floor((nowMs - at) / 60_000),
      actual: stamped?.actual ?? null,
      vs: stamped?.vs ?? null,
      move: releaseMove(books.QQQ.minute, books.QQQ.series.symbol, at, nowMs),
    };
  }

  const c = [...desk.scan.candidates]
    .filter((x) => SETUP_BANDS.has(String(x.pathBand ?? "")))
    .sort(compareForBoard)[0];
  const setup: AgendaSetup | null = c
    ? {
        key: `${c.symbol}:${c.side}:${c.pathBand}:${c.id}`,
        band: String(c.pathBand),
        symbol: c.symbol,
        side: c.side,
        confluence: c.confluence,
        strategy: c.completeStrategy || c.strategyPrimary,
        pT1: c.hitOdds?.pT1 ?? null,
        expR: c.hitOdds?.expR ?? null,
        actionable: c.actionable,
        missing: c.missing?.[0] ?? null,
      }
    : null;
  return { next, last, setup };
}

/** The futures move from the release minute to +15m (or to now), on closed 1m bars. */
function releaseMove(minute: OhlcBar[], symbol: string, atMs: number, nowMs: number): AgendaEvent["move"] {
  const start = minute.find((b) => b.t >= atMs && b.t < atMs + 60_000);
  if (!start) return null;
  const endAt = Math.min(atMs + 15 * 60_000, nowMs);
  const closed = minute.filter((b) => b.t >= atMs && b.t + 60_000 <= endAt);
  const last = closed[closed.length - 1];
  if (!last || last === start) return null;
  const mins = Math.round((last.t + 60_000 - atMs) / 60_000);
  return {
    symbol,
    from: start.o,
    to: last.c,
    pct: Math.round(((last.c - start.o) / start.o) * 10_000) / 100,
    window: `first ${mins} minutes`,
  };
}

/** ARMED with a ticket first, then WATCH, then STAND; 1 DTE wins a tie (the day default). */
function pickDayCard(od: OptionsDesk): RhStrategyCard | null {
  const rank = (c: RhStrategyCard) => (c.verdict === "ARMED" && c.ticket ? 0 : c.verdict === "WATCH" ? 1 : 2);
  const day = od.day.filter((c) => c.id === "path_continuation" || c.id === "judas_ifvg_0dte");
  return (
    [...day].sort(
      (a, b) => rank(a) - rank(b) || b.score - a.score || (a.id === "path_continuation" ? -1 : 1),
    )[0] ?? null
  );
}

/**
 * The desk's exits for the room's open positions: the futures plan's
 * invalidation (level), the 15m failed-hold close (exit-rules.ts, before the
 * trim only), T2 for the runner, and T1 for an untrimmed position. Shared by the live desk and the drill so
 * the two can never exit on different rules.
 */
export function computeExits(
  watch: ExitWatch[],
  futures: Record<Underlier, { symbol: string; price: number }>,
  bars15: Record<Underlier, OhlcBar[]>,
  nowMs: number,
): Record<string, RoomExitRead> {
  const exits: Record<string, RoomExitRead> = {};
  for (const w of watch) {
    if (!w.fut) continue;
    const u = underlierOfSymbol(w.fut.symbol);
    const price = futures[u].price;
    const long = w.fut.side === "long";
    if (long ? price <= w.fut.stop : price >= w.fut.stop) {
      exits[w.id] = { kind: "level", why: `${w.fut.symbol} ${price.toFixed(2)} is through the plan's invalidation ${w.fut.stop.toFixed(2)}` };
      continue;
    }
    if (!w.trimmed) {
      const fh = failedHold({ side: w.fut.side, entry: w.fut.entry, stop: w.fut.stop, openedAt: w.openedAt, nowMs, bars15: bars15[u] });
      if (fh.triggered && fh.bar) {
        exits[w.id] = {
          kind: "failed_hold",
          why: `a 15m close at ${fh.bar.c.toFixed(2)} went through ${fh.level.toFixed(2)} — the entry array failed`,
        };
        continue;
      }
    }
    if (w.fut.t2 != null && (long ? price >= w.fut.t2 : price <= w.fut.t2)) {
      exits[w.id] = { kind: "t2", why: `${w.fut.symbol} reached T2 ${w.fut.t2.toFixed(2)}` };
      continue;
    }
    // T1 trims an untrimmed position (exits.ts levelTrim): the desk's measured rule.
    if (!w.trimmed && w.fut.t1 != null && (long ? price >= w.fut.t1 : price <= w.fut.t1)) {
      exits[w.id] = { kind: "t1", why: `${w.fut.symbol} ${price.toFixed(2)} reached T1 ${w.fut.t1.toFixed(2)}` };
    }
  }
  return exits;
}

/** The gates, the clock, and the level exits — the room's `ctx.desk`. */
export function readDeskForRoom(
  desk: DeskPayload,
  od: OptionsDesk,
  watch: ExitWatch[],
  nowMs: number,
  tenYear: number | null,
): RoomDeskRead {
  const books = booksOf(desk);
  const esPx = books.SPY.quote.price;
  const nqPx = books.QQQ.quote.price;
  const card = pickDayCard(od);

  const exits = computeExits(
    watch,
    { QQQ: { symbol: books.QQQ.series.symbol, price: nqPx }, SPY: { symbol: books.SPY.series.symbol, price: esPx } },
    { QQQ: books.QQQ.series.bars ?? [], SPY: books.SPY.series.bars ?? [] },
    nowMs,
  );

  const next = desk.news.nextEvent;
  const lags = [desk.quotes.left.lagSec, desk.quotes.right.lagSec].filter((x) => Number.isFinite(x));
  return {
    isWeekday: desk.clock.isWeekday,
    holiday: desk.weekAhead?.today?.kind === "holiday",
    killzone: desk.clock.killzone,
    killzoneLabel: desk.clock.killzoneLabel,
    nextWindow: desk.clock.nextWindow,
    judas: isJudasWindow(desk.clock.etHour, desk.clock.etMinute),
    news: {
      blackout: desk.news.verdict === "blackout",
      reason: desk.news.reason,
      next: next ? { name: next.name, timeEt: next.timeEt, minutesAway: next.minutesAway } : null,
    },
    shock: desk.shock?.active || desk.shock?.tail ? desk.shock.line : null,
    htf: { QQQ: books.QQQ.bias.topDown, SPY: books.SPY.bias.topDown },
    futures: {
      QQQ: { symbol: books.QQQ.series.symbol, price: nqPx },
      SPY: { symbol: books.SPY.series.symbol, price: esPx },
    },
    feed: `${desk.feed}${lags.length ? ` ${Math.min(...lags)}s` : ""}`,
    lagSec: lags.length ? Math.min(...lags) : null,
    spotSource: { SPY: spotSource("SPY", esPx, nqPx, desk.proxies), QQQ: spotSource("QQQ", esPx, nqPx, desk.proxies) },
    tenYear,
    weekKind: desk.weekAhead?.today?.kind ?? null,
    weekTrade: desk.weekAhead?.today?.trade ?? null,
    entry: card ? cardEntry(desk, card) : null,
    exits,
    held: computeHeld(watch, {
      QQQ: { symbol: books.QQQ.series.symbol, price: nqPx },
      SPY: { symbol: books.SPY.series.symbol, price: esPx },
    }),
    agenda: agendaFromDesk(desk, nowMs),
  };
}
