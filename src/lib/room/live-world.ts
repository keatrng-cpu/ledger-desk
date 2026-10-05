/**
 * The desk, translated into what the room's talk can see (live-types.ts `TalkWorld`).
 *
 * Everything here is READ from desk modules and never recomputed a second way: the books come from
 * `booksOf`, the entry tier from `readEntry`, the news tier from `tagItem`, the clock from the desk's own
 * `SessionClock`. The one thing this file adds is the print ring — a short memory of the futures prices as
 * they arrived — because the desk keeps closed 1m bars and the talk needs "what did it do in the last
 * minute".
 */

import type { DeskPayload } from "@/lib/trading/build-desk";
import { evidenceHeadlines } from "@/lib/trading/evidence";
import { readEntry } from "@/lib/trading/entry-trigger";
import { isHighProbPath } from "@/lib/alerts/path-alarm";
import { compareForBoard } from "@/lib/trading/scanner";
import { NEWS_CALENDAR } from "@/lib/trading/news";
import { etWallParts, etWallToEpochMs } from "@/lib/trading/sessions";
import { volumeRatio } from "@/lib/trading/session-event";
import { dedupe, impactOf, orderItems, tagItem, type FeedItem } from "@/lib/news/feed";
import { fundProfile } from "@/lib/invest/exposure";
import { ALL_DOSSIERS } from "@/lib/invest/dossiers";
import type { MindState } from "./agents";
import { booksOf, closedBars } from "./desk-read";
import { pushPrint } from "./live-talk";
import type {
  BookRead,
  CalEvent,
  CalRead,
  CardRead,
  LabLite,
  LevelRef,
  MindsRead,
  NewsLite,
  PositionRead,
  TalkWorld,
  TapeBook,
  TapeSample,
  WeekLite,
} from "./live-types";
import type { LabRead } from "./lab";
import { contractName } from "./format";
import { etDateOf, type Underlier } from "./option-math";
import type { Beat } from "./orchestrator";
import { equityOf, type RoomBook } from "./paper-book";

/* ── Clock ─────────────────────────────────────────────────────────────── */

/** CME Globex: Sunday 18:00 ET to Friday 17:00 ET, with a daily halt 17:00–18:00 ET. */
export function globexOpenAt(nowMs: number): boolean {
  const p = etWallParts(nowMs);
  const m = p.hour * 60 + p.minute;
  const d = p.weekday;
  if (d === 6) return false;
  if (d === 0) return m >= 18 * 60;
  if (d === 5) return m < 17 * 60;
  return !(m >= 17 * 60 && m < 18 * 60);
}

/* ── The print ring ────────────────────────────────────────────────────── */

export type Rings = Record<Underlier, TapeSample[]>;

export const emptyRings = (): Rings => ({ QQQ: [], SPY: [] });

/** One print per book, on the time axis the room lives on (when it arrived). Synthetic quotes are not prices. */
export function ringsAfter(rings: Rings, desk: DeskPayload, nowMs: number): Rings {
  if (desk.feed === "synthetic") return rings;
  const books = booksOf(desk);
  const next: Rings = { QQQ: rings.QQQ, SPY: rings.SPY };
  for (const u of ["QQQ", "SPY"] as const) {
    const q = books[u].quote;
    if (q.source === "synthetic") continue;
    next[u] = pushPrint(rings[u], q.fetchedAtMs && q.fetchedAtMs <= nowMs + 5_000 ? q.fetchedAtMs : nowMs, q.price);
  }
  return next;
}

/* ── News ──────────────────────────────────────────────────────────────── */

let qqqMemo: Map<string, number> | null = null;
let dossierMemo: Set<string> | null = null;

/** Headlines tagged the way the News tab tags them (feed.ts), newest first, tier 3 kept so it can be marked seen. */
export function newsLiteFrom(items: FeedItem[]): NewsLite[] {
  qqqMemo ??= new Map(fundProfile("QQQ")?.holdings ?? []);
  dossierMemo ??= new Set(ALL_DOSSIERS.filter((d) => d.kind === "company").map((d) => d.ticker));
  const qqq = qqqMemo;
  const w = (t: string) => (t === "GOOGL" ? (qqq.get("GOOGL") ?? 0) + (qqq.get("GOOG") ?? 0) : (qqq.get(t) ?? 0));
  return orderItems(dedupe(items.map((i) => tagItem(i, w, dossierMemo!))))
    .map((t) => ({
      id: t.id,
      title: t.title,
      source: t.source,
      publishedMs: t.published ? Date.parse(t.published) || null : null,
      tier: t.tier,
      why: t.why,
      impact: impactOf(t, w),
      tickers: t.tickers,
      topics: t.topics as string[],
      primary: t.primary,
    }))
    .sort((a, b) => (b.publishedMs ?? 0) - (a.publishedMs ?? 0))
    .slice(0, 80);
}

/* ── Pieces ────────────────────────────────────────────────────────────── */

const isPool = (kind: string, name: string): boolean =>
  kind === "prior" || kind === "weekly" || kind === "range" ? name !== "EQ" : kind.includes(":");

function levelsFor(desk: DeskPayload, symbol: string): LevelRef[] {
  const items = desk.levels.find((l) => l.symbol === symbol)?.items ?? [];
  return items.filter((i) => Number.isFinite(i.price)).map((i) => ({ name: i.name, price: i.price, kind: i.kind, pool: isPool(i.kind, i.name) }));
}

const NOMINAL_PER_ETF_PT: Record<Underlier, number> = { QQQ: 40, SPY: 10 };

function tapeBook(desk: DeskPayload, u: Underlier, ring: TapeSample[], nowMs: number): TapeBook | null {
  const b = booksOf(desk)[u];
  const q = b.quote;
  if (!q || !Number.isFinite(q.price) || q.price <= 0) return null;
  const sym = b.series.symbol;
  const ratio = desk.proxies[u]?.ratio;
  const nominal = NOMINAL_PER_ETF_PT[u];
  const perEtfPt = ratio != null && Number.isFinite(ratio) && Math.abs(ratio / nominal - 1) <= 0.08 ? ratio : nominal;
  const closed15 = closedBars(b.series.bars ?? [], nowMs);
  const vol = closed15.length > 1 ? volumeRatio(closed15, closed15.length - 1) : 0;
  const prim = b.draw.primary;
  return {
    u,
    sym,
    say: u === "QQQ" ? "NQ" : "ES",
    px: q.price,
    prevClose: Number.isFinite(q.previousClose) && q.previousClose > 0 ? q.previousClose : null,
    changePct: Number.isFinite(q.changePct) ? q.changePct : null,
    dayHigh: q.dayHigh ?? null,
    dayLow: q.dayLow ?? null,
    atr: b.draw.atr > 0 ? b.draw.atr : null,
    samples: ring,
    levels: levelsFor(desk, sym),
    perEtfPt,
    htf: b.bias.topDown === "bull" ? "bull" : b.bias.topDown === "bear" ? "bear" : "none",
    smcWord: b.smc?.word ?? null,
    smcMissing: b.smc?.missing ?? null,
    draw: prim ? { name: prim.name, price: prim.price } : null,
    rangeUsedPct: Number.isFinite(b.draw.sessionRangeUsedPct) ? b.draw.sessionRangeUsedPct : null,
    volRatio: vol > 0 ? vol : null,
  };
}

function feedOf(desk: DeskPayload): TalkWorld["feed"] {
  const qs = [desk.quotes.left, desk.quotes.right].filter((q) => q && Number.isFinite(q.price));
  if (!qs.length) return { kind: "none", lagSec: null };
  if (desk.feed === "synthetic" || qs.every((q) => q.source === "synthetic")) return { kind: "synthetic", lagSec: null };
  const lags = qs.map((q) => q.lagSec).filter((x) => Number.isFinite(x));
  const lagSec = lags.length ? Math.min(...lags) : null;
  const gw = qs.every((q) => q.source === "live_gateway");
  if (gw) return { kind: "live_gateway", lagSec };
  const src = qs.find((q) => q.source !== "live_gateway")?.source;
  return { kind: src === "databento" ? "databento" : "yahoo", lagSec };
}

function calendarRead(desk: DeskPayload, nowMs: number): CalRead {
  const today = etDateOf(nowMs);
  const tomorrow = etDateOf(nowMs + 36 * 3_600_000);
  const events: CalEvent[] = NEWS_CALENDAR.filter((e) => e.date === today || e.date === tomorrow)
    .map((e) => ({ name: e.name, date: e.date, timeEt: e.timeEt, atMs: etWallToEpochMs(e.date, e.timeEt), impact: e.impact }))
    .sort((a, b) => a.atMs - b.atMs);
  const prints: CalRead["prints"] = {};
  const stamped = desk.weekAhead?.today?.news ?? [];
  for (const e of events) {
    const hit = stamped.find((x) => x.timeEt === e.timeEt && (x.name.split(" ")[0] ?? "") === (e.name.split(" ")[0] ?? ""));
    if (hit) prints[`${e.date}|${e.timeEt}|${e.name}`] = { actual: hit.actual, vs: hit.vs, note: hit.note };
  }
  return { events, prints };
}

const SETUP_BANDS = new Set(["A+", "A", "A-", "A−", "B+"]);

function cardRead(desk: DeskPayload): CardRead | null {
  const c = [...desk.scan.candidates].filter((x) => SETUP_BANDS.has(String(x.pathBand ?? ""))).sort(compareForBoard)[0];
  if (!c) return null;
  const u: Underlier = c.symbol.includes("ES") ? "SPY" : "QQQ";
  const b = booksOf(desk)[u];
  const plan = b.smc.plan && b.smc.plan.side === c.side ? b.smc.plan : null;
  const read = plan ? readEntry(plan, b.quote.price, b.draw.atr || null) : null;
  return {
    key: `${c.symbol}:${c.side}:${c.pathBand}:${c.id}`,
    name: `${c.pathBand} ${c.symbol} ${c.side}`,
    verdict: c.actionable && isHighProbPath(c) ? "ARMED" : "WATCH",
    u,
    type: c.side === "short" ? "PUT" : "CALL",
    band: c.pathBand ? String(c.pathBand) : null,
    tier: read?.tier ?? null,
    awayPts: read?.awayPts ?? null,
    futSymbol: c.symbol,
    futSide: c.side === "short" ? "short" : "long",
    entry: plan?.entry ?? null,
    stop: plan?.stop ?? null,
    t1: plan?.t1 ?? null,
    pT1: c.hitOdds?.pT1 ?? null,
    expR: c.hitOdds?.expR ?? null,
    block: c.missing?.[0] ?? null,
    strategy: c.completeStrategy || c.strategyPrimary || null,
  };
}

export function bookRead(book: RoomBook, nowMs: number): BookRead {
  const today = etDateOf(nowMs);
  const closedToday = book.closed.filter((c) => etDateOf(c.closedAt) === today);
  const positions: PositionRead[] = book.positions.map((p) => ({
    id: p.id,
    name: contractName(p.ticker, p.strike, p.type, p.exp),
    u: p.ticker,
    type: p.type,
    contracts: p.contracts,
    pnlPct: p.pnlPct,
    trimmed: p.trimmed,
    openedAt: p.openedAt,
    plan: p.fut ? { symbol: p.fut.symbol, side: p.fut.side, entry: p.fut.entry, stop: p.fut.stop, t1: p.fut.t1, t2: p.fut.t2 } : null,
  }));
  return {
    positions,
    dayPnl: Math.round((equityOf(book) - book.counters.dayStartEquity) * 100) / 100,
    equity: equityOf(book),
    closedToday: closedToday.length,
    winsToday: closedToday.filter((c) => c.pnlUsd > 0).length,
    consecLosses: book.counters.consecLosses,
    monthEntries: book.counters.monthEntries,
  };
}

function mindsRead(m: MindState | null): MindsRead | null {
  if (!m) return null;
  return {
    needs: m.needs,
    rank: m.rank,
    rel: m.rel,
    memories: m.memories.slice(0, 12).map((x) => ({ who: x.who, against: x.against ?? null, clock: x.clock, kind: x.kind, text: x.text, outcome: x.outcome?.verdict ?? null })),
  };
}

function labLite(lab: LabRead | null): LabLite | null {
  if (!lab) return null;
  return {
    refusals: lab.refusals,
    twins: { n: lab.twins.n, deltaUsd: lab.twins.deltaUsd },
    calibration: lab.calibration ? { n: lab.calibration.n, meanP: lab.calibration.meanP, hitRate: lab.calibration.hitRate, brier: lab.calibration.brier } : null,
    track: Object.fromEntries(Object.entries(lab.track).map(([k, v]) => [k, { n: v.n, brier: v.brier }])) as LabLite["track"],
  };
}

function weekRead(desk: DeskPayload): WeekLite | null {
  const wa = desk.weekAhead;
  if (!wa) return null;
  const day = (d: NonNullable<typeof wa.today>) => ({
    date: d.date,
    kind: String(d.kind),
    trade: d.trade,
    skipIf: d.skipIf,
    pathNote: d.pathNote,
    dailyBias: d.dailyBias,
    news: d.news.map((n) => ({ timeEt: n.timeEt, name: n.name, impact: n.impact, note: n.note })),
  });
  return {
    today: wa.today ? day(wa.today) : null,
    next: wa.next ? { ...day(wa.next), weekday: wa.next.weekday } : null,
    headline: wa.plan.headline ?? null,
  };
}

/* ── The world ─────────────────────────────────────────────────────────── */

export interface WorldInput {
  desk: DeskPayload;
  nowMs: number;
  rings: Rings;
  pulse: { vix: number | null; tenYear: number | null; at: number | null };
  news: NewsLite[];
  book: RoomBook;
  beat: Beat | null;
  minds: MindState | null;
  lab: LabRead | null;
  busyUntil: number;
}

export function worldFromDesk(i: WorldInput): TalkWorld {
  const { desk, nowMs } = i;
  const p = etWallParts(nowMs);
  const etMin = p.hour * 60 + p.minute;
  const holiday = desk.weekAhead?.today?.kind === "holiday";
  const isWeekday = p.weekday >= 1 && p.weekday <= 5;
  return {
    nowMs,
    clock: {
      nowMs,
      etDate: etDateOf(nowMs),
      etMin,
      weekday: p.weekday,
      isWeekday,
      holiday,
      optionsOpen: isWeekday && !holiday && etMin >= 9 * 60 + 30 && etMin < 16 * 60,
      globexOpen: globexOpenAt(nowMs),
      killzone: desk.clock.killzone,
      killzoneLabel: desk.clock.killzoneLabel,
      judas: etMin >= 9 * 60 + 30 && etMin < 9 * 60 + 45,
      blackout: desk.news.verdict === "blackout",
      blackoutReason: desk.news.verdict === "blackout" ? desk.news.reason : null,
    },
    feed: feedOf(desk),
    books: { QQQ: tapeBook(desk, "QQQ", i.rings.QQQ, nowMs), SPY: tapeBook(desk, "SPY", i.rings.SPY, nowMs) },
    pulse: i.pulse,
    news: i.news,
    cal: calendarRead(desk, nowMs),
    book: bookRead(i.book, nowMs),
    card: cardRead(desk),
    beat: i.beat,
    minds: mindsRead(i.minds),
    lab: labLite(i.lab),
    week: weekRead(desk),
    evidence: evidenceHeadlines(),
    busyUntil: i.busyUntil,
  };
}
