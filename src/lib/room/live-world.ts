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
import { isPathFire } from "@/lib/alerts/path-alarm";
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
  GoalLite,
  InvestLite,
  LabLite,
  LevelRef,
  MindsRead,
  NewsLite,
  PositionRead,
  RndLite,
  ScanCardLite,
  SeatsLite,
  TalkWorld,
  TapeBook,
  TapeSample,
  WeekLite,
} from "./live-types";
import { contractsFor } from "./goal";
import { ROOM_MANDATE } from "./mandate";
import type { Race } from "./race";
import type { LabRead } from "./lab";
import { contractName } from "./format";
import { freshnessOf } from "./data-fresh";
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

/** 15m ATR in futures points and futures points per ETF point, per underlier (the same crossover the tape books use). */
export function atrOf(desk: DeskPayload): Record<Underlier, { atr: number | null; perEtfPt: number }> {
  const one = (u: Underlier) => {
    const b = booksOf(desk)[u];
    const ratio = desk.proxies[u]?.ratio;
    const nominal = NOMINAL_PER_ETF_PT[u];
    return {
      atr: b.draw.atr > 0 ? b.draw.atr : null,
      perEtfPt: ratio != null && Number.isFinite(ratio) && Math.abs(ratio / nominal - 1) <= 0.08 ? ratio : nominal,
    };
  };
  return { QQQ: one("QQQ"), SPY: one("SPY") };
}

export function feedOf(desk: DeskPayload): TalkWorld["feed"] {
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
    verdict: c.actionable && isPathFire(c) ? "ARMED" : "WATCH",
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

/** The scanner board, as the war room's TV shows it: the desk's graded candidates in board order, each with its plan and entry tier. */
export function scannerCards(desk: DeskPayload, limit = 6): ScanCardLite[] {
  return [...desk.scan.candidates]
    .filter((c) => c.pathBand)
    .sort(compareForBoard)
    .slice(0, limit)
    .map((c) => {
      const u: Underlier = c.symbol.includes("ES") ? "SPY" : "QQQ";
      const b = booksOf(desk)[u];
      const plan = b.smc.plan && b.smc.plan.side === c.side ? b.smc.plan : null;
      const read = plan ? readEntry(plan, b.quote.price, b.draw.atr || null) : null;
      return {
        key: `${c.symbol}:${c.side}:${c.pathBand}:${c.id}`,
        name: `${c.pathBand} ${c.symbol} ${c.side}`,
        symbol: c.symbol,
        strategy: c.completeStrategy || c.strategyPrimary || null,
        verdict: c.actionable && isPathFire(c) ? "ARMED" : SETUP_BANDS.has(String(c.pathBand ?? "")) ? "WATCH" : "STAND",
        band: c.pathBand ? String(c.pathBand) : null,
        u,
        side: c.side === "short" ? "short" : "long",
        tier: read?.tier ?? null,
        awayPts: read?.awayPts ?? null,
        pT1: c.hitOdds?.pT1 ?? null,
        expR: c.hitOdds?.expR ?? null,
        entry: plan?.entry ?? null,
        stop: plan?.stop ?? null,
        t1: plan?.t1 ?? null,
        block: c.missing?.[0] ?? null,
      } satisfies ScanCardLite;
    });
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

export function labLite(lab: LabRead | null): LabLite | null {
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

/* ── The race ──────────────────────────────────────────────────────────── */

/** The goal's plan, in the shape the talk reads. Every number here was computed by goal.ts / seats.ts. */
export function goalLite(r: Race | null, vix: number | null): GoalLite | null {
  if (!r?.view || !r.league || !r.seats) return null;
  const v = r.view;
  const read = v.read;
  const g = read.spec;
  // The best of the five that can trade at all: an approach whose size buys no contract has odds of nothing and is not "the best".
  const pool = v.table.filter((row) => row.out.contractsNow >= 1);
  const best = (pool.length ? pool : v.table).reduce((m, row) => (row.out.pTarget > m.out.pTarget || (row.out.pTarget === m.out.pTarget && row.out.expectedEnd > m.out.expectedEnd) ? row : m), (pool.length ? pool : v.table)[0]!);
  const who = r.ladderFor?.underlier ?? "QQQ";
  const type = r.ladderFor?.type ?? "CALL";
  const nameOf = (x: { strike: number }) => `${who} ${x.strike}${type === "CALL" ? "C" : "P"}`;
  const rungs = v.ladder;
  const withOdds = (rungs ?? []).filter((x) => x.out != null && x.contracts >= 1);
  const bestRung = withOdds.length ? withOdds.reduce((m, x) => (x.out!.pTarget > m.out!.pTarget ? x : m), withOdds[0]!) : null;
  const room = (rungs ?? []).filter((x) => x.rung.steps <= 1).sort((a, b) => a.rung.askUsd - b.rung.askUsd)[0] ?? null;
  const roomContracts = contractsFor(read.equity, v.ctx.contractUsd, g.capFrac, v.ctx.maxDebitUsd);
  const stopShare = roomContracts >= 1 && read.equity > 0 ? (roomContracts * v.ctx.contractUsd * v.ctx.model.lossPct) / read.equity : null;
  return {
    start: g.start,
    startDate: g.startDate,
    target: g.target,
    floor: read.floor,
    floorFrac: g.floorFrac,
    status: read.status,
    day: read.clock.day,
    of: read.clock.of,
    daysLeft: read.clock.daysLeft,
    entriesOver: read.clock.entriesOver,
    equity: read.equity,
    leader: r.league.leader,
    multipleNeeded: read.multipleNeeded,
    perSessionNeeded: read.perSessionNeeded,
    pathToday: read.pathToday,
    paceLabel: read.pace?.label ?? null,
    paceUsd: read.pace?.vsPathUsd ?? null,
    lambda: v.ctx.lambda,
    expectedTickets: v.expectedTickets,
    tradeBudget: v.ctx.tradeBudget,
    pTarget: best.out.pTarget,
    pTargetBy: best.def.owner,
    pFloor: best.out.pFloor,
    pNoTrade: best.out.pNoTrade,
    pNoCard: Math.exp(-v.ctx.lambda * Math.max(0, read.clock.daysLeft)),
    expectedEnd: best.out.expectedEnd,
    needed: { pStar: v.needed.pStar, pWin: v.needed.pWin, lambdaMultiple: v.needed.lambdaMultiple, winPct: v.needed.winPct },
    winsNeed: v.winsNeed,
    measured: { pWin: v.ctx.model.pWin, winPct: v.ctx.model.winPct, lossPct: v.ctx.model.lossPct, meanPct: v.ctx.model.meanPct, n: v.ctx.model.n },
    collisions: v.collisions.map((c) => ({ id: c.id, severity: c.severity, title: c.title, detail: c.detail, decision: c.decision, ask: c.ask })),
    ladder: {
      n: rungs?.length ?? 0,
      cheapestUsd: rungs?.length ? Math.min(...rungs.map((x) => x.rung.askUsd)) : null,
      richestUsd: rungs?.length ? Math.max(...rungs.map((x) => x.rung.askUsd)) : null,
      priced: r.priced,
      best: bestRung ? { name: nameOf(bestRung.rung), askUsd: bestRung.rung.askUsd, delta: bestRung.rung.delta, contracts: bestRung.contracts, pTarget: bestRung.out!.pTarget, evPerDollar: bestRung.rung.priced?.evPerDollar ?? null } : null,
      room: room ? { name: nameOf(room.rung), askUsd: room.rung.askUsd, contracts: room.contracts } : null,
    },
    plan: { needTodayUsd: v.plan.needTodayUsd, maxLossUsd: v.plan.maxLossUsd, contracts: v.plan.contracts, debitUsd: v.plan.debitUsd, perAtrUsd: v.plan.perAtrUsd, atrsNeeded: v.plan.atrsNeeded },
    capFrac: g.capFrac,
    roomCapFrac: ROOM_MANDATE.maxCashFracPerTrade,
    minDelta: g.minDelta,
    minAskUsd: g.minAskUsd,
    approaches: v.table.map((row) => ({ owner: row.def.owner, pTarget: row.out.pTarget, contractsNow: row.out.contractsNow })),
    path: read.ladder.map((x) => ({ date: x.date, equity: x.equity })),
    stopShare,
    vix,
  };
}

export function seatsLite(r: Race | null): SeatsLite | null {
  if (!r?.seats || !r.league) return null;
  return {
    rows: r.league.rows.map((x) => ({ id: x.id, name: x.name, owner: x.owner, equity: x.equity, pnl: x.pnl, open: x.open, taken: x.taken, declined: x.declined, status: x.status })),
    leader: r.league.leader,
    events: r.seats.events.slice(0, 16).map((e) => ({ id: e.id, at: e.at, kind: e.kind, seat: e.seat, usd: e.usd, qty: e.qty, debit: e.debit, contract: e.contract, gate: e.gate, why: e.why, equity: e.equity, members: e.members, planKey: e.planKey, n: e.n })),
    sessions: r.league.sessions,
    touches: r.league.touches,
    syndicates: { n: r.league.syndicates.n, closed: r.league.syndicates.closed, usd: r.league.syndicates.usd },
  };
}

export function rndLite(r: Race | null): RndLite | null {
  if (!r?.rnd) return null;
  return { experiments: r.rnd.experiments.map((e) => ({ id: e.id, owner: e.owner, title: e.title, status: e.status, n: e.n, nNeeded: e.nNeeded, read: e.read, proposal: e.proposal })) };
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
  /** The goal, the seats and the R&D board, computed once per desk build (race.ts). */
  race?: Race | null;
  /** The investment office's read of the Invest tab and the research file (invest-office.ts). */
  invest?: InvestLite | null;
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
    goal: goalLite(i.race ?? null, i.pulse.vix),
    seats: seatsLite(i.race ?? null),
    rnd: rndLite(i.race ?? null),
    invest: i.invest ?? null,
    fresh: freshnessOf(etDateOf(nowMs)),
    evidence: evidenceHeadlines(),
    busyUntil: i.busyUntil,
  };
}
