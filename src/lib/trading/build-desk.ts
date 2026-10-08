import { createServerFn } from "@tanstack/react-start";
import { withBudget } from "@/lib/market/budget";
import {
  DESK_BUDGET_MS,
  DESK_COLD_CAP_MS,
  budgetedLeg,
  isDeskStaleBlocked,
  quoteStatusFromSeries,
  remaining,
  summarizeBudget,
  type BudgetLeg,
  type DeskBudgetRead,
  type LegStatus,
} from "@/lib/market/desk-budget";
import { APLUS_RULES } from "@/lib/aplus/config";
import { RH_EVENT_CONFIDENCE_LIFT, rhPathFloorForBand } from "@/lib/execution/rh-autofire-gates";
import {
  fetchDatabentoBars,
  hasDatabentoKey,
  quoteFromDatabentoSeries,
} from "@/lib/market/databento";
import {
  YAHOO_MAP,
  fetchYahooBars,
  fetchYahooLiveQuote,
  syntheticBars,
  syntheticQuote,
  type YahooInterval,
  type YahooRange,
  fetchYahooSpot,
  type ProxySpot,
} from "@/lib/market/yahoo";
import {
  readLiveTickFresh,
  quoteFromLiveTick,
  quoteFromLiveBar,
  readLiveBars,
  type LiveGatewayTick,
} from "@/lib/market/live-gateway";
import { crossBoth } from "@/lib/market/spot-cross";
import {
  aggregateBars,
  applyQuoteToLastBar,
  closedBars,
  mergeNewerBars,
  pickFreshestQuote,
  priorSessionClose,
  rebaseQuote,
  stampSeriesFromBars,
  stitchLiveSession,
} from "@/lib/market/freshest";
import {
  QUOTE_EXECUTION_MAX_LAG_SEC,
  type IndexSymbol,
  type LiveQuote,
  type SymbolSeries,
  type OhlcBar,
} from "@/lib/market/types";
import { applyLtfReaction } from "./ltf-reaction";
import { namingSweep } from "./raid-pair";
import { getSessionClock, sessionLive, type SessionClock } from "./sessions";
import { applySession } from "./session-event";
import { buildLiveSays, type LiveSays } from "./live-says";
import { buildTfLadder, ladderTags, type TfLadder } from "./tf-ladder";
import { hitOdds } from "./hit-odds";
import { HIT_ODDS_MODEL } from "./hit-odds-model";
import { gradeSmcMaster, type SmcMasterRead } from "./smc-master";
import {
  analyzeStructure,
  referenceLevels,
  smtDivergenceStack,
  type HtfBiasRead,
  type SmtStack,
} from "./structure";
import { buildSmcTape, type SmcTape } from "./smc-board";
import { scanSetups, type ScanResult } from "./scanner";
import { atrOf, drawOnLiquidity, type DrawRead } from "./draw";
import { attachPlansToCards } from "./card-plan";
import { newsRead, type NewsRead } from "./news";
import { summarizeDetectors } from "./detectors";
import { readShock, type ShockRead } from "./shock";
import {
  buildMarketNarrative,
  dualNarrativeSummary,
  type MarketNarrative,
} from "./market-narrative";
import { buildSessionBrief, type SessionBrief } from "./session-brief";
import { overlayWeekAhead, resolveWeekAhead, type WeekAheadRead } from "./week-ahead";
import { overlayMonthAhead, resolveMonthAhead, type MonthAheadRead } from "./month-ahead";

export interface DeskPayload {
  ok: true;
  fetchedAt: string;
  clock: SessionClock;
  left: SymbolSeries;
  right: SymbolSeries;
  quotes: { left: LiveQuote; right: LiveQuote };
  /** Cash SPY/QQQ spots for the Robinhood sleeve. Null = fall back to ES/10, NQ/40 (labelled). */
  proxies: { SPY: ProxySpot | null; QQQ: ProxySpot | null };
  /** Tape circuit breaker — unscheduled catastrophic candle. See shock.ts. */
  shock: ShockRead;
  bias: { left: HtfBiasRead; right: HtfBiasRead };
  scan: ScanResult;
  risk: {
    equity: number;
    riskPct: number;
    riskDollars: number;
    dailyLimitPct: number;
    weeklyLimitPct: number;
    maxSetups: number;
    floor: number;
    micros: boolean;
  };
  levels: {
    symbol: string;
    items: { name: string; price: number; kind: string }[];
  }[];
  news: NewsRead;
  /** Where price is likely drawn, per symbol — empirical, from past sessions. */
  draws: { left: DrawRead; right: DrawRead };
  feed: "databento" | "yahoo" | "synthetic" | "mixed";
  /** 15m / 1H / 4H SMT stack. scan.smt is the highest-TF active crack. */
  smtStack?: SmtStack;
  /** Multi-TF SMC tape — arrays + alerts the scanner and brain both read. */
  smc?: { left: SmcTape; right: SmcTape };
  checklist: { id: string; label: string; ok: boolean; detail: string }[];
  /** Liquidity + confirmation + entry narrative (per book) */
  narrative: { left: MarketNarrative; right: MarketNarrative; summary: string };
  /** Bull/bear paths + no-trade day — priced levels with ET windows. */
  brief?: SessionBrief;
  /** Sunday week-ahead — levels, daily bias, news, PATH filters. */
  weekAhead: WeekAheadRead | null;
  /** Month bias / phases — restamp last Sunday of the prior month. */
  monthAhead: MonthAheadRead | null;
  /** Trade Now "LIVE DATA SAYS { }" — live_gateway tick when 09:00–11:30 ET. */
  liveSays: LiveSays;
  /** Live SMC sequence (priced DOL + sweep polarity + one book). */
  smcMaster: SmcMasterRead;
  /** Key presence only — never the secret. Claude handoff reads this. */
  coach: { xai: boolean; anthropic: boolean };
  /**
   * The series behind the timeframe ladder: daily bars (2y, for the 1d/1w/
   * 1M/1y rungs) and 1m bars (last 8h, for the 1m–10m rungs). The 15m rungs
   * come from `left.bars` / `right.bars`; the 30s rung is built client-side
   * from prints. Empty arrays when the fetch missed its budget.
   */
  mtf: { left: { daily: OhlcBar[]; minute: OhlcBar[] }; right: { daily: OhlcBar[]; minute: OhlcBar[] } };
  /** Top-down read per book, from the series above (no 30s rung server-side). */
  ladder: { left: TfLadder; right: TfLadder };
  /**
   * The wall budget's honest receipt (desk-budget.ts): every upstream leg,
   * how long the build waited on it, and whether it was served fresh, from
   * its TTL cache, from LAST-GOOD (stale, with age) or not at all. `stale`
   * is true when a leg the grades read (structure bars / quotes) was not
   * fresh — the desk then blocks execution and the HUD says why.
   */
  budget: DeskBudgetRead;
  /** Top-level mirror of budget.stale for consumers that only read flags. */
  stale: boolean;
  /** Last thing Grok reported back to this floor. Null until a report is written. */
  grokReport?: import("@/lib/desk/grok-report").GrokReport | null;
}

export interface DeskError {
  ok: false;
  error: string;
}

/**
 * Databento leg of a desk build.
 *
 * HISTORY (measured 2026-09-19, weekend tape): the server function runs in
 * Netlify's streaming mode, and the edge cuts a stream that has been silent
 * for ~30s, returning a 565-byte "Inactivity Timeout" page with a 504. Desk
 * builds were taking 23-33s; the time went into fetchDatabentoBars (45s
 * abort, 422 discovery, a MONTH of 1m CSV). That got a 12s budget.
 *
 * 2026-10-06: still 14.5-21.8s live. Databento is HISTORY here — standard CME
 * entitlements lag hours, and Yahoo/the gateway stitch the live end on top —
 * so re-downloading a month of 1m rows every 20s poll bought nothing. It is
 * now TTL-cached (DATABENTO_TTL_MS) and budgeted by the desk wall budget; a
 * miss serves last-good history (flagged in `budget.legs`) or none at all,
 * and the series' `source` still says which feed the bars came from.
 */
const DATABENTO_TTL_MS = 5 * 60_000;
/** History stays structurally valid for hours; the live end comes from Yahoo/gateway. */
const DATABENTO_MAX_STALE_MS = 6 * 3_600_000;
/** Structure (15m) series: last-good is served for at most one 15m bar. */
const SERIES_MAX_STALE_MS = 15 * 60_000;
/** Quotes/spots: same ceiling as QUOTE_USABLE_SEC — lag is recomputed on serve, so gates stay honest. */
const QUOTE_MAX_STALE_MS = 15 * 60_000;

/**
 * The ladder's extra series. Daily bars move once a day and are cached for
 * ten minutes; 1m bars are cached for 2s so a new closed bar is in the next
 * grade, while two polls in the same breath share one fetch. Both run inside the desk
 * wall budget: a slow fetch serves last-good (flagged stale in
 * `budget.legs`) or an empty series, and the ladder marks the rung "no data"
 * rather than holding the desk.
 */
const DAILY_CACHE_MS = 10 * 60_000;
const DAILY_MAX_STALE_MS = 24 * 3_600_000;
const MINUTE_CACHE_MS = 2_000;
const MINUTE_MAX_STALE_MS = 15 * 60_000;
/** 1m bars shipped per book — 8h covers every LTF rung with room. */
const MINUTE_KEEP = 480;

/**
 * The gateway's 1m bars are one Postgres query away; a slow pooler must not
 * hold the desk build. Past this the closed bars simply stay Yahoo's.
 */
const GATEWAY_BARS_BUDGET_MS = 1_500;
/** 1m bars pulled from the gateway per build: 4h covers the whole window. */
const GATEWAY_BARS_LIMIT = 240;

/** Cached values are handed to code that patches them in place — never share. */
const cloneSeries = (s: SymbolSeries): SymbolSeries => structuredClone(s);
const cloneBars = (b: OhlcBar[]): OhlcBar[] => b.map((x) => ({ ...x }));
/** A last-good quote's lag is its REAL age now, never the age it had when fetched. */
function reageQuote(q: LiveQuote, nowMs = Date.now()): LiveQuote {
  return { ...q, lagSec: Math.max(0, Math.round((nowMs - q.marketTimeMs) / 1000)) };
}
function reageSpot(s: ProxySpot, nowMs = Date.now()): ProxySpot {
  return { ...s, lagSec: Math.max(0, Math.round((nowMs - s.marketTimeMs) / 1000)) };
}

async function loadDaily(symbol: IndexSymbol, t0: number): Promise<{ bars: OhlcBar[]; leg: BudgetLeg }> {
  const r = await budgetedLeg(
    `daily:${symbol}`,
    `daily:${symbol}`,
    async () => (await fetchYahooBars(symbol, "2y", "1d"))?.bars ?? null,
    { waitMs: remaining(t0, DESK_BUDGET_MS), ttlMs: DAILY_CACHE_MS, maxStaleMs: DAILY_MAX_STALE_MS, isGood: (b) => b.length > 0 },
    cloneBars,
  );
  return { bars: r.value ?? [], leg: r.leg };
}

async function loadMinute(symbol: IndexSymbol, t0: number): Promise<{ bars: OhlcBar[]; leg: BudgetLeg }> {
  const r = await budgetedLeg(
    `minute:${symbol}`,
    `minute:${symbol}`,
    async () => {
      // Gateway 1m is the tape when it is streaming. Yahoo is the hole-fill
      // only — a delayed 1m print must not sit under a live book.
      const gw = await withBudget(
        readLiveBars(symbol, GATEWAY_BARS_LIMIT).catch(() => [] as OhlcBar[]),
        GATEWAY_BARS_BUDGET_MS,
        [] as OhlcBar[],
      );
      if (gw.length >= 30) return gw.slice(-MINUTE_KEEP);
      const y = await fetchYahooBars(symbol, "1d", "1m").catch(() => null);
      const yahoo = y?.bars ?? [];
      const out = (gw.length ? mergeNewerBars(yahoo, gw) : yahoo).slice(-MINUTE_KEEP);
      return out.length ? out : null;
    },
    { waitMs: remaining(t0, DESK_BUDGET_MS), ttlMs: MINUTE_CACHE_MS, maxStaleMs: MINUTE_MAX_STALE_MS, isGood: (b) => b.length > 0 },
    cloneBars,
  );
  return { bars: r.value ?? [], leg: r.leg };
}

function minutesOf(interval: YahooInterval): number {
  return interval === "1m" ? 1 : interval === "5m" ? 5 : interval === "15m" ? 15 : interval === "60m" ? 60 : 15;
}

interface BarsRead {
  series: SymbolSeries;
  /** Composite status of the structure bars (core leg `bars:SYM`). */
  status: LegStatus;
  legs: BudgetLeg[];
  /** Epoch ms the structure series was originally fetched (cache / last-good stamp). */
  fetchedAtMs: number | null;
}

async function load(
  symbol: IndexSymbol,
  range: YahooRange,
  interval: YahooInterval,
  t0: number,
): Promise<BarsRead> {
  const minutes = minutesOf(interval);
  const tStart = Date.now();
  const waitMs = remaining(t0, DESK_BUDGET_MS);

  // Databento and Yahoo are independent sources that get STITCHED, so they
  // are fetched concurrently — each inside the same wall budget.
  // Include dataset in the key so flipping DATABENTO_DATASET cannot reuse
  // another feed's last-good bars under the same symbol/window.
  const databentoDataset = process.env.DATABENTO_DATASET || "GLBX.MDP3";
  const databento = hasDatabentoKey()
    ? budgetedLeg(
        `databento:${symbol}`,
        `databento:${symbol}:${range}:${minutes}:${databentoDataset}`,
        () =>
          fetchDatabentoBars(
            symbol,
            range === "3mo" ? "3mo" : range === "1mo" ? "1mo" : range === "5d" ? "5d" : "1d",
            minutes,
          ),
        { waitMs, ttlMs: DATABENTO_TTL_MS, maxStaleMs: DATABENTO_MAX_STALE_MS, isGood: (s) => s.bars.length >= 30 },
        cloneSeries,
      )
    : Promise.resolve(null);
  // Yahoo is the fallback for the live end. It is not started when Databento
  // history is already in hand and the gateway is streaming bars.
  const fetchYahoo = () =>
    budgetedLeg(
      `yahoo:${symbol}`,
      `yahoo:${symbol}:${range}:${interval}`,
      () => fetchYahooBars(symbol, range, interval),
      {
        waitMs,
        coldWaitMs: remaining(t0, DESK_COLD_CAP_MS),
        maxStaleMs: SERIES_MAX_STALE_MS,
        isGood: (s) => s.bars.length >= 10,
      },
      cloneSeries,
    );
  // The gateway's own closed 1m bars, when it is streaming (09:00–11:30 ET).
  // Yahoo's bars run ~10 minutes behind the print and Databento historical
  // 15–20; inside the live window the last two or three 15m bars of the
  // desk were therefore always partial or missing, and a raid or
  // displacement on them was graded ten minutes after it happened. The
  // reader returns [] whenever the newest bar is older than BAR_FRESH_MS,
  // so a dead gateway costs nothing and changes nothing.
  const gateway = withBudget(
    readLiveBars(symbol, GATEWAY_BARS_LIMIT).catch(() => [] as OhlcBar[]),
    GATEWAY_BARS_BUDGET_MS,
    [] as OhlcBar[],
  );

  const [dbR, gw] = await Promise.all([databento, gateway]);
  const historical = dbR?.value && dbR.value.bars.length >= 30 ? dbR.value : null;
  // Yahoo is the fallback. A live gateway on a full Databento history is the print.
  const yR =
    historical && gw.length
      ? {
          value: null as SymbolSeries | null,
          leg: {
            id: `yahoo:${symbol}`,
            status: "fresh" as LegStatus,
            ms: 0,
            ageSec: 0,
            note: "skipped — gateway bars on databento",
          },
          fetchedAtMs: null as number | null,
        }
      : await fetchYahoo();
  const legs: BudgetLeg[] = [yR.leg];
  if (dbR) legs.push(dbR.leg);
  const live = yR.value;

  // The structure series is as fresh as its live end. Yahoo owns that end;
  // with no Yahoo the series is Databento history (whatever its status).
  const status: LegStatus = live ? yR.leg.status : dbR?.value ? dbR.leg.status : "missing";
  const composite: BudgetLeg = {
    id: `bars:${symbol}`,
    status,
    ms: Date.now() - tStart,
    ageSec: live ? yR.leg.ageSec : dbR?.value ? dbR.leg.ageSec : null,
    ...(status === "stale" || status === "missing" ? { note: live ? yR.leg.note : dbR?.leg.note ?? yR.leg.note } : {}),
  };
  legs.unshift(composite);
  // Original fetch time of the series we are serving (yahoo live end, else databento).
  const seriesFetchedAtMs: number | null = live ? yR.fetchedAtMs : (dbR?.fetchedAtMs ?? null);

  const stitched = stitchLiveSession(historical, live);
  if (!stitched) return { series: syntheticBars(symbol), status: "missing", legs, fetchedAtMs: null };
  const flag = (s: SymbolSeries): SymbolSeries => (status === "stale" ? { ...s, stale: true } : s);
  if (!gw.length) return { series: flag(stitched), status, legs, fetchedAtMs: seriesFetchedAtMs };

  // Overlay the gateway's buckets at and after the stitched series' last bar
  // — the only bars that can be stale — and label the series live when the
  // newest bar came from the socket.
  const rolled = aggregateBars(gw, minutes);
  const merged = mergeNewerBars(stitched.bars, rolled);
  const newestGw = rolled[rolled.length - 1]!.t;
  const newestBase = stitched.bars[stitched.bars.length - 1]!.t;
  const series = stampSeriesFromBars(
    { ...stitched, source: newestGw >= newestBase ? "live_gateway" : stitched.source },
    merged,
  );
  // Fresh socket bars on top of a stale base: the live end IS fresh again.
  if (newestGw >= newestBase && status === "stale") {
    composite.status = "fresh";
    composite.note = "gateway bars over last-good base";
    return { series, status: "fresh", legs, fetchedAtMs: Date.now() };
  }
  return { series: flag(series), status, legs, fetchedAtMs: seriesFetchedAtMs };
}

/** The network half of a quote — started at t0 beside the bars, composed after. */
interface QuoteInputs {
  tick: LiveGatewayTick | null;
  yahoo: { value: LiveQuote | null; leg: BudgetLeg };
}

async function quoteInputs(symbol: IndexSymbol, t0: number): Promise<QuoteInputs> {
  const tick = await readLiveTickFresh(symbol).catch(() => null);
  if (tick) {
    return {
      tick,
      yahoo: {
        value: null,
        leg: { id: `yahooQuote:${symbol}`, status: "fresh", ms: 0, ageSec: 0, note: "skipped — gateway tick" },
      },
    };
  }
  const yahoo = await budgetedLeg(
    `yahooQuote:${symbol}`,
    `yahooQuote:${symbol}`,
    () => fetchYahooLiveQuote(symbol),
    { waitMs: remaining(t0, DESK_BUDGET_MS), maxStaleMs: QUOTE_MAX_STALE_MS },
  );
  const yq = yahoo.value
    ? yahoo.leg.status === "stale"
      ? { ...reageQuote(yahoo.value), stale: true }
      : yahoo.value
    : null;
  return { tick, yahoo: { value: yq, leg: yahoo.leg } };
}

function quote(
  symbol: IndexSymbol,
  series: SymbolSeries | null,
  seriesStatus: LegStatus,
  inputs: QuoteInputs,
  seriesFetchedAtMs: number | null = null,
): { quote: LiveQuote; leg: BudgetLeg } {
  // One baseline for every source — see priorSessionClose (freshest.ts) for
  // why series.previousClose (the chart window's) is not a day's close.
  const sessionPrev = series?.bars.length ? priorSessionClose(series.bars) : null;
  const previousClose = sessionPrev ?? series?.previousClose ?? series?.bars.at(-1)?.c ?? 0;
  const yahooSym = series?.yahoo ?? YAHOO_MAP[symbol].yahoo;
  const id = `quote:${symbol}`;

  if (inputs.tick) {
    return {
      quote: quoteFromLiveTick(inputs.tick, yahooSym, previousClose || inputs.tick.price),
      leg: { id, status: "fresh", ms: 0, ageSec: Math.round(inputs.tick.ageMs / 1000), note: "gateway tick" },
    };
  }

  const lastBar = series?.bars.at(-1);
  if (series?.source === "live_gateway" && lastBar) {
    const barQ = quoteFromLiveBar(symbol, lastBar, yahooSym, previousClose || lastBar.c);
    if (barQ.lagSec <= 90) {
      return {
        quote: rebaseQuote(barQ, sessionPrev),
        leg: { id, status: "fresh", ms: 0, ageSec: barQ.lagSec, note: "gateway bar" },
      };
    }
  }

  const yahooQ = inputs.yahoo.value;
  const db =
    series?.source === "databento" && series.bars.length
      ? quoteFromDatabentoSeries(series, seriesFetchedAtMs ?? undefined)
      : null;

  const picked = pickFreshestQuote(yahooQ, db);
  if (!picked || picked.source === "synthetic") {
    // No measured print anywhere. The synthetic constant below is what the
    // desk's existing branch reads as "stand down" — it is never a price.
    return {
      quote: picked ?? syntheticQuote(symbol),
      leg: { id, status: "missing", ms: inputs.yahoo.leg.ms, ageSec: null, note: inputs.yahoo.leg.note ?? "no live print" },
    };
  }
  const fromYahoo = picked === yahooQ;
  // Match series status semantics: cached → cached (not silently fresh).
  const status: LegStatus = fromYahoo
    ? inputs.yahoo.leg.status
    : quoteStatusFromSeries(seriesStatus);
  const q = rebaseQuote(picked, sessionPrev);
  const seriesAgeSec =
    seriesFetchedAtMs != null ? Math.round((Date.now() - seriesFetchedAtMs) / 1000) : null;
  return {
    quote: status === "stale" ? { ...q, stale: true } : q,
    leg: {
      id,
      status,
      ms: inputs.yahoo.leg.ms,
      ageSec: fromYahoo ? inputs.yahoo.leg.ageSec : seriesAgeSec,
      note: fromYahoo ? inputs.yahoo.leg.note : "from databento series",
    },
  };
}

async function loadSpot(ticker: "SPY" | "QQQ", t0: number): Promise<{ spot: ProxySpot | null; leg: BudgetLeg }> {
  const r = await budgetedLeg(`spot:${ticker}`, `spot:${ticker}`, () => fetchYahooSpot(ticker), {
    waitMs: remaining(t0, DESK_BUDGET_MS),
    maxStaleMs: QUOTE_MAX_STALE_MS,
  });
  return { spot: r.value && r.leg.status === "stale" ? reageSpot(r.value) : r.value, leg: r.leg };
}


// levelsFrom() was replaced by structure.referenceLevels(), which adds PWH/PWL
// and the midnight / 8:30 / 9:30 ET opens on top of the same row shape.

export const fetchTradingDesk = createServerFn({ method: "POST" })
  .validator((input: { left?: IndexSymbol; right?: IndexSymbol }) => {
    const left = (input?.left ?? "MNQ") as IndexSymbol;
    const right = (input?.right ?? "ES") as IndexSymbol;
    return { left, right };
  })
  .handler(async ({ data }): Promise<DeskPayload | DeskError> => {
    const desk = await buildTradingDesk(data);
    if (!desk.ok) return desk;
    try {
      const { getSql } = await import("@/lib/db");
      const { readGrokReport } = await import("@/lib/desk/grok-report");
      desk.grokReport = await readGrokReport(await getSql());
    } catch {
      desk.grokReport = null;
    }
    return desk;
  });

/**
 * The desk build itself, as a plain function so scripts can exercise the
 * wall budget outside the Start runtime (scripts/smoke-desk-budget.mjs).
 * The server function above is the only production caller.
 */
export async function buildTradingDesk(data: { left: IndexSymbol; right: IndexSymbol }): Promise<DeskPayload | DeskError> {
  try {
    const clock0 = getSessionClock();
    // ONE wall budget for every upstream (desk-budget.ts). Everything
    // starts here, at t0, in parallel — the quotes no longer wait for the
    // bars to land first. A leg that misses the budget serves last-good
    // (flagged stale) or nothing; the build never waits past the budget
    // except for structure bars on a cold instance (DESK_COLD_CAP_MS).
    const t0 = Date.now();
    // 1mo 15m: 5d left the prior trading week only partially covered, so
    // PWH/PWL (prior completed week, Sun 18:00 → Fri 17:00 ET) was wrong.
    // Yahoo caps 15m history around 60d; bars are trimmed to MAX_BARS.
    const [lb, rb, dL, dR, mL, mR, lqIn, rqIn, spy, qqq] = await Promise.all([
      load(data.left, "1mo", "15m", t0),
      load(data.right, "1mo", "15m", t0),
      loadDaily(data.left, t0),
      loadDaily(data.right, t0),
      loadMinute(data.left, t0),
      loadMinute(data.right, t0),
      quoteInputs(data.left, t0),
      quoteInputs(data.right, t0),
      loadSpot("SPY", t0),
      loadSpot("QQQ", t0),
    ]);
    const left = lb.series;
    const right = rb.series;
    const [dailyL, dailyR, minuteL, minuteR] = [dL.bars, dR.bars, mL.bars, mR.bars];
    const lqR = quote(data.left, left, lb.status, lqIn, lb.fetchedAtMs);
    const rqR = quote(data.right, right, rb.status, rqIn, rb.fetchedAtMs);
    const lq = lqR.quote;
    const rq = rqR.quote;
    const spySpot = spy.spot;
    const qqqSpot = qqq.spot;
    const budget = summarizeBudget(
      [
        ...lb.legs,
        ...rb.legs,
        lqR.leg,
        rqR.leg,
        lqIn.yahoo.leg,
        rqIn.yahoo.leg,
        dL.leg,
        dR.leg,
        mL.leg,
        mR.leg,
        spy.leg,
        qqq.leg,
      ],
      [`bars:${data.left}`, `bars:${data.right}`, `quote:${data.left}`, `quote:${data.right}`],
      t0,
    );
    if (budget.tripped) {
      console.info(`[desk-budget] ${budget.elapsedMs}ms · ${budget.legs.filter((l) => l.status === "stale" || l.status === "missing").map((l) => `${l.id}=${l.status}${l.note ? `(${l.note})` : ""}`).join(" ")}`);
    }

    if (lq.source === "yahoo" || lq.source === "databento" || lq.source === "live_gateway") {
      left.price = lq.price;
      left.changePct = lq.changePct;
      left.marketTimeMs = lq.marketTimeMs;
      left.marketTimeIso = lq.marketTimeIso;
      const patched = applyQuoteToLastBar(left.bars, lq, left.interval);
      if (patched !== left.bars) {
        const next = stampSeriesFromBars(left, patched);
        left.bars = next.bars;
        left.count = next.count;
        left.last = next.last;
      }
    }
    if (rq.source === "yahoo" || rq.source === "databento" || rq.source === "live_gateway") {
      right.price = rq.price;
      right.changePct = rq.changePct;
      right.marketTimeMs = rq.marketTimeMs;
      right.marketTimeIso = rq.marketTimeIso;
      const patched = applyQuoteToLastBar(right.bars, rq, right.interval);
      if (patched !== right.bars) {
        const next = stampSeriesFromBars(right, patched);
        right.bars = next.bars;
        right.count = next.count;
        right.last = next.last;
      }
    }

    /**
     * A SYNTHETIC QUOTE IS NOT A PRICE.
     *
     * When every source fails, `quote()` falls back to `syntheticQuote()`:
     * a constant out of YAHOO_MAP, stamped `lagSec: 0` and
     * `marketTimeMs: now`. Every freshness gate on this desk keys on
     * `lagSec`, never on `source` — so the one number nobody measured
     * arrived looking fresher than anything real. Execution grade passed,
     * "Risk model armed" printed green, the shock detector compared live
     * bars against a constant, the options sleeve was priced off it, and
     * auto-paper would have booked a fill at a hardcoded number into the
     * very sample that gates the A+ unlock. The HUD did show a synthetic
     * badge; not one gate read it.
     *
     * Hence: the SOURCE decides, not the lag, and a synthetic quote stands
     * the desk down in the same branch as a dead series.
     */
    const liveSource = (s: string) =>
      s === "yahoo" || s === "databento" || s === "live_gateway";
    const seriesLive = liveSource(left.source) && liveSource(right.source);
    const quotesLive = liveSource(lq.source) && liveSource(rq.source);

    // Real SMT: timestamp-aligned swing divergence, not a %-change proxy.
    // SMT and the SMC tape are CONFIRMATIONS, not price location: they run
    // on closed bars only. A forming bar can print a transient HH on NQ
    // before ES prints its own (fake SMT), and a partial candle can read as
    // a displacement / MSS that never closes that way.
    const closedL = closedBars(left.bars, left.interval, left.marketTimeMs ?? Date.now());
    const closedR = closedBars(right.bars, right.interval, right.marketTimeMs ?? Date.now());
    // Structure was the one engine still grading the patched bar, so a
    // single tick under a swing low at 10:07 printed a BOS and vetoed every
    // long on the board until 10:15 put price back above it. It now grades
    // the closed prefix and reports the forming bar's break as
    // `bias.*.reversalAlert` — seen a bar early, authorising nothing.
    /**
     * The session gate, stamped once from CLOSED bars.
     *
     * Closed, not `left.bars`, for the same reason structure grades the
     * closed prefix: a forming candle's range grows through the fifteen
     * minutes, so reading the shock off it would flip the gate open
     * mid-bar and shut again on the close — the desk would announce a
     * session that never printed. `applySession` takes both books because
     * this flag answers "is the desk awake"; the two places where the
     * answer decides money (smc-master, path-alarm) each re-read it
     * against their own book.
     */
    const clock = applySession(clock0, closedL, closedR);

    const biasL = analyzeStructure(left.symbol, left.bars, left.changePct, { closed: closedL });
    const biasR = analyzeStructure(right.symbol, right.bars, right.changePct, { closed: closedR });
    const smtStack = smtDivergenceStack(closedL, closedR);
    const divergence = smtStack.primary;
    const smc = {
      left: buildSmcTape(closedL),
      right: buildSmcTape(closedR),
    };
    // The freshest quote, not the last closed bar — otherwise the draw's
    // side, distance and therefore its reach percentage describe a moment
    // that has passed. card-freshness.ts explains what that looked like.
    const drawL = drawOnLiquidity(biasL, left.bars, left.price);
    const drawR = drawOnLiquidity(biasR, right.bars, right.price);

    const scan = scanSetups(
      biasL,
      biasR,
      clock,
      divergence,
      left.bars,
      right.bars,
      smc,
      { left: minuteL, right: minuteR },
    );
    // Detectors only ever see CLOSED bars. The forming bar (patched with the
    // live print above) is for price location, never for "displacement" or
    // "closed back inside" — those are facts about a bar that has finished.
    const detL = summarizeDetectors(closedL);
    const detR = summarizeDetectors(closedR);
    // 2026-09-23: the narrative bakes sweep polarity and displacement
    // direction into ONE value per book, and smc-master grades the sweep and
    // ltf layers against it. Deriving that direction from topDown alone
    // meant that whenever GATE.sideFromRaid selected the other side — which
    // the path diagnostic showed happens on ~300 of ~450 trade-window bars,
    // because in a bear HTF the sweeps are SSL raids that arm LONGS — those
    // two must-layers were graded against the OPPOSITE trade's confirmation
    // and failed on data that described a different setup. sweep was the
    // first blocker on 245 bars.
    //
    // The raid is the fact; the bias is the opinion. When a raid exists the
    // narrative is now built for the side that raid arms, so the layers
    // grade the trade the sequence is actually considering. An SSL raid arms
    // a long, a BSL raid arms a short.
    const raidDir = (bars: OhlcBar[]): "bull" | "bear" | null => {
      const named = namingSweep(bars);
      if (!named) return null;
      return named.side === "sellside" ? "bull" : "bear";
    };
    const dirL: "bull" | "bear" =
      raidDir(closedL) ?? (biasL.topDown === "bear" ? "bear" : "bull");
    const dirR: "bull" | "bear" =
      raidDir(closedR) ?? (biasR.topDown === "bear" ? "bear" : "bull");
    const narrL = applyLtfReaction(
      buildMarketNarrative(biasL, detL, clock, dirL, left.bars),
      minuteL,
      dirL,
    );
    const narrR = applyLtfReaction(
      buildMarketNarrative(biasR, detR, clock, dirR, right.bars),
      minuteR,
      dirR,
    );
    const narrative = {
      left: narrL,
      right: narrR,
      summary: dualNarrativeSummary(narrL, narrR),
    };

    // Tape circuit breaker BEFORE the scheduled-news gate: an unscheduled
    // shock (tweet, leak, headline) has no calendar entry, so it must be
    // caught from price. When locked it overrides the verdict to blackout,
    // which the whole desk (TAKE / auto-paper / alarm / options) already
    // refuses on. Uses the same closed bars the detectors ran on.
    // The live-move leg gets `null` rather than a synthetic quote: the gap
    // between real bars and a hardcoded constant is thousands of points, so
    // feeding it here manufactures a catastrophic candle that never traded.
    // readShock takes a null quote and falls back to the closed bars alone.
    const nowMs = Date.now();
    const newsBase = newsRead(new Date());
    const nearPrint = newsBase.nextEvent != null && Math.abs(newsBase.nextEvent.minutesAway) <= 90;
    const shock = readShock(
      { symbol: left.symbol, closedBars: closedL, quote: quotesLive ? { price: lq.price, marketTimeMs: lq.marketTimeMs } : null },
      { symbol: right.symbol, closedBars: closedR, quote: quotesLive ? { price: rq.price, marketTimeMs: rq.marketTimeMs } : null },
      nowMs,
      nearPrint ? newsBase.nextEvent!.name : null,
    );

    // News gate: a scheduled high-impact release inside the risk window kills
    // actionability the same way bad data does — the engine skips these too.
    const news: NewsRead =
      shock.active
        ? {
            ...newsBase,
            verdict: "blackout",
            reason: `${shock.line} · ${Math.ceil((shock.lockUntilMs! - nowMs) / 60_000)}m — impulse is the news. B+ and higher still trade if the new sequence clears a higher bar, at a smaller size.`,
          }
        : newsBase;
    // News and a shock raise the confidence bar and cut size. They do not
    // take B+ and higher off the book when the bias and the score are there.
    const event = news.verdict === "blackout" || news.verdict === "caution" || shock.tail;
    if (event) {
      let live = 0;
      for (const c of scan.candidates) {
        const band = String(c.pathBand || c.grade);
        const floor = rhPathFloorForBand(band);
        const need = floor == null ? Number.POSITIVE_INFINITY : Math.round((floor + RH_EVENT_CONFIDENCE_LIFT) * 100) / 100;
        if (floor != null && c.confluence >= need) {
          live += 1;
          c.reasons = [...c.reasons, `news/shock bar ${need.toFixed(2)} cleared — size cut, still a ticket`];
        } else if (c.actionable) {
          c.actionable = false;
          c.reasons = [...c.reasons, `news/shock bar ${Number.isFinite(need) ? need.toFixed(2) : "—"} not cleared`];
        }
      }
      const why = shock.active || shock.tail ? shock.line : news.reason;
      if (live === 0) {
        scan.blocked.push(`News/shock — no B+ or higher cleared the raised bar · ${why}`);
        scan.focus = `News/shock raised the bar. Nothing at B+ or higher cleared it. ${why}`;
      } else {
        scan.blocked.push(`News/shock — ${live} card${live === 1 ? "" : "s"} still live, size cut · ${why}`);
      }
    }

    // Research rule: sweep alone is never an entry
    for (const c of scan.candidates) {
      const n = c.symbol === left.symbol ? narrL : narrR;
      if (n.confirmation === "sweep_only" && c.actionable) {
        c.actionable = false;
        c.reasons = [
          ...c.reasons,
          "veto: sweep without confirmation (displacement+MSS)",
        ];
      }
      // Prefer models that match narrative story (tag only — no score stack)
      if (n.preferredStrategies.length && c.strategyPrimary) {
        const pref = n.preferredStrategies.includes(
          c.strategyPrimary as never,
        );
        if (pref) {
          c.reasons = [
            ...c.reasons,
            `narrative fit: ${n.class} ↔ ${c.strategyPrimary}`,
          ];
        }
      }
    }

    /**
     * DATA QUALITY — two independent questions, not one.
     *
     * This used to be a single gate: any quote lag over 120s set
     * `actionable = false` on EVERY candidate and overwrote the focus line
     * with "stand down". That conflated two facts that fail separately:
     *
     *   1. Is the STRUCTURE valid? (bars) — a 15m bar that closed ten
     *      minutes ago is still a perfectly valid 15m bar. HTF bias,
     *      sweeps, FVGs, OTE and the whole canon stack do not degrade
     *      because the last tick is stale.
     *   2. Can I PRICE A FILL right now? (quote) — this genuinely needs a
     *      current print.
     *
     * And the threshold could never be met: Yahoo's free futures feed lags
     * ~600s BY DESIGN, so a 120s limit meant the desk vetoed itself on
     * every poll, permanently, while the analysis underneath was fine.
     * That is a threshold set for a feed we do not have.
     *
     * Now graded. Structure keeps working when the tape is slow; only
     * execution-grade claims require an execution-grade quote — and the
     * desk says which of the two is missing instead of "stand down".
     */
    const maxLagSec = Math.max(lq.lagSec, rq.lagSec);

    /**
     * Fresh enough to price a fill against. Yahoo free will essentially
     * never clear this, which is the honest read: Yahoo is a structure
     * feed, not an execution feed. Databento historical windows lag by
     * hours on standard CME entitlements and are likewise structure-only.
     */
    const QUOTE_EXECUTION_SEC = QUOTE_EXECUTION_MAX_LAG_SEC;
    /**
     * Beyond this the quote is too old to even sanity-check a level
     * against, so the whole read is untrustworthy. One 15m bar.
     */
    const QUOTE_USABLE_SEC = 900;
    const usableLimit =
      left.source === "databento" || right.source === "databento"
        ? 14 * 3600
        : QUOTE_USABLE_SEC;

    // `quotesLive` leads both tests: a lag of zero on a number nobody
    // measured is not freshness, and both of these are read as freshness.
    const quoteExecutionGrade = quotesLive && maxLagSec <= QUOTE_EXECUTION_SEC;
    const quoteUsable = quotesLive && maxLagSec <= usableLimit;
    /**
     * Can the STRUCTURE be believed? Real bars from a real source, and a
     * real quote recent enough to verify those levels against. Deliberately
     * independent of `quoteExecutionGrade` — that is the whole point of
     * the split, and `snapshots` keys its own `dataQualityOk` off the
     * "Data quality" prefix, which now only appears for these two hard
     * failures rather than for a merely slow tape.
     */
    const structureTrustworthy = seriesLive && quoteUsable;

    if (!seriesLive || !quotesLive) {
      // One branch on purpose. No real bars and a hardcoded quote are the
      // same failure: nothing below this line describes the market, so
      // nothing below it is analysis, let alone a trade.
      const reason = !seriesLive
        ? "Data quality: synthetic feed — no Databento/Yahoo data"
        : "Data quality: synthetic quote — no live print; the price is a constant";
      for (const c of scan.candidates) c.actionable = false;
      scan.blocked.push(reason);
      scan.focus = `${reason} — stand down.`;
    } else if (!quoteUsable) {
      // Real bars, but the tape is so stale the structure cannot be
      // trusted against current price either. Still a full stand-down.
      const reason = `Data quality: feed stale (${Math.round(maxLagSec)}s > ${usableLimit}s) — structure unverifiable`;
      for (const c of scan.candidates) c.actionable = false;
      scan.blocked.push(reason);
      scan.focus = `${reason} — stand down.`;
    } else if (!quoteExecutionGrade) {
      /**
       * DEGRADED, not dead. Bars are real and recent enough for the
       * structure to be true, but the quote is not execution-grade — so
       * the setups stay scored, visible and reviewable, and only the
       * claim "you can fill this right now at this price" is withdrawn.
       *
       * `actionable` still drops, because it specifically gates entry and
       * firing at a price you cannot verify is how a paper sample gets
       * quietly corrupted. What changes is that this no longer masquerades
       * as a dead desk: the focus line keeps the real read, and the block
       * names the ONE thing that is wrong.
       */
      for (const c of scan.candidates) c.actionable = false;
      scan.blocked.push(
        `Execution blocked: quote ${Math.round(maxLagSec)}s old (> ${QUOTE_EXECUTION_SEC}s) — ${left.source} is a structure feed, not an execution feed. Analysis below is valid.`,
      );
    }

    /**
     * STALE DESK (budget tripped on a core leg). The structure bars or the
     * quote are LAST-GOOD values, not this build's — real numbers, but not
     * now's. Analysis stays on screen with its age; nothing may fire on it.
     * "Data quality" prefix on purpose: snapshots key dataQualityOk off it.
     * A missing core leg is already handled above (synthetic → stand down).
     */
    // Fail-closed: missing/undefined stale is treated as blocked (stale !== false).
    if (isDeskStaleBlocked(budget.stale) && seriesLive && quotesLive) {
      for (const c of scan.candidates) c.actionable = false;
      scan.blocked.push(`Data quality: ${budget.line || "stale flag missing"} — execution blocked until a fresh build`);
    }

    const feed: DeskPayload["feed"] =
      left.source === right.source &&
      (left.source === "yahoo" ||
        left.source === "databento" ||
        left.source === "synthetic")
        ? left.source
        : "mixed";


    const checklist = [
      {
        id: "session",
        label: "Session / killzone",
        ok: sessionLive(clock),
        detail: clock.sessionReason ?? clock.killzoneLabel,
      },
      {
        id: "htf",
        label: "HTF bias aligned",
        ok: biasL.topDown !== "neutral" || biasR.topDown !== "neutral",
        detail: `${left.symbol} ${biasL.topDown} · ${right.symbol} ${biasR.topDown}`,
      },
      {
        id: "smt",
        label: "SMT / relative",
        ok: scan.smt.edge !== "none",
        detail: scan.smt.note,
      },
      {
        id: "setup",
        label: "Actionable setup ≥ floor",
        ok: scan.candidates.some((c) => c.actionable),
        detail: scan.focus,
      },
      {
        id: "liquidity",
        label: "Liquidity / confirmation",
        ok:
          narrL.confirmation === "armed_entry" ||
          narrR.confirmation === "armed_entry" ||
          narrL.confirmation === "confirmed" ||
          narrR.confirmation === "confirmed",
        detail: narrative.summary,
      },
      {
        id: "feed",
        label: "Market feed",
        // Bars AND quote. The row a human reads to answer "is any of this
        // real?" must fail when either half is made up.
        ok: seriesLive && quotesLive && !isDeskStaleBlocked(budget.stale),
        detail: isDeskStaleBlocked(budget.stale)
          ? budget.line || "stale flag missing"
          : !quotesLive
          ? "Synthetic quote — no live print from gateway / Yahoo / Databento"
          : hasDatabentoKey()
            ? `Databento preferred (${feed}) · GLBX.MDP3 continuous`
            : "Yahoo only — set DATABENTO_API_KEY for CME",
      },
      {
        id: "risk",
        label: "Risk model armed",
        // Structure being valid is what arms the risk model; a stale quote
        // blocks the FILL, not the analysis, and now says which it is.
        ok: structureTrustworthy && quoteExecutionGrade && clock.isWeekday,
        detail: !structureTrustworthy
          ? "Structure unverifiable — stand down"
          : !quoteExecutionGrade
            ? `Structure valid · execution blocked (quote ${Math.round(maxLagSec)}s old)`
            : !clock.isWeekday
              ? "Weekend — risk not armed"
              : `${APLUS_RULES.riskPct * 100}% · max ${APLUS_RULES.maxSetupsPerSession}/KZ · micros`,
      },
    ];

    // The ETF spots the options desk prices a ticket on, crossed with the LIVE futures
    // (spot-cross.ts, 2026-10-05): the Yahoo print only says what futures ÷ ETF was at its own
    // instant; the gateway's future is the clock, so `estimateSpot` divides the NOW future by
    // that ratio and the spot moves at futures speed between builds. A synthetic quote is not a
    // price and crosses nothing; a delayed Yahoo future never calibrates a live print.
    const proxies = crossBoth(
      {
        left: { symbol: left.symbol, quote: lq, minute: minuteL },
        right: { symbol: right.symbol, quote: rq, minute: minuteR },
      },
      { SPY: spySpot, QQQ: qqqSpot },
      Date.now(),
      liveSource,
    );

    const payload = {
      ok: true as const,
      fetchedAt: new Date().toISOString(),
      clock,
      left,
      right,
      quotes: { left: lq, right: rq },
      proxies,
      shock,
      bias: { left: biasL, right: biasR },
      scan,
      risk: {
        equity: APLUS_RULES.accountEquity,
        riskPct: APLUS_RULES.riskPct,
        riskDollars: APLUS_RULES.accountEquity * APLUS_RULES.riskPct,
        dailyLimitPct: APLUS_RULES.dailyLossLimitPct,
        weeklyLimitPct: APLUS_RULES.weeklyLossLimitPct,
        maxSetups: APLUS_RULES.maxSetupsPerSession,
        floor: APLUS_RULES.confluenceFloor,
        micros: APLUS_RULES.useMicros,
      },
      levels: [
        { symbol: left.symbol, items: referenceLevels(biasL) },
        { symbol: right.symbol, items: referenceLevels(biasR) },
      ],
      news,
      draws: { left: drawL, right: drawR },
      feed,
      smtStack,
      smc,
      checklist,
      narrative,
      brief: buildSessionBrief({
        clock,
        bias: { left: biasL, right: biasR },
        scan,
        news,
        draws: { left: drawL, right: drawR },
        feed,
        narrative,
        smtStack,
      }),
      weekAhead: overlayWeekAhead(resolveWeekAhead(), [
        { symbol: left.symbol, bars: left.bars },
        { symbol: right.symbol, bars: right.bars },
      ]),
      monthAhead: overlayMonthAhead(resolveMonthAhead(), [
        { symbol: left.symbol, bars: left.bars },
        { symbol: right.symbol, bars: right.bars },
      ]),
    };
    // The minute series goes IN, not just out to the ladder. The Judas
    // window is one 15m candle, so without the 1m/2m/3m rungs the sequence
    // cannot separate the open's raid from the reaction to it and
    // judas-window.ts correctly refuses to release. Passing it here is what
    // makes the release possible at all — and only while the gateway is up,
    // since a 10-minute-lagged feed cannot resolve a 15-minute window.
    const smcMaster = gradeSmcMaster({
      ...payload,
      left: { ...payload.left, minute: minuteL },
      right: { ...payload.right, minute: minuteR },
      shockFloorMs: shock.active || shock.tail ? shock.freshFloorMs : null,
    });
    // One stop, everywhere (card-plan.ts): the card a book priced a plan
    // for now carries that plan, and its invalidation becomes the plan's
    // stop — so the ticket, the paper book and the Log dialog size off the
    // number the evidence was measured on, not a PDL/PDH string.
    attachPlansToCards(payload.scan.candidates, smcMaster, {
      [left.symbol]: left.bars?.length > 20 ? atrOf(left.bars, 14) : null,
      [right.symbol]: right.bars?.length > 20 ? atrOf(right.bars, 14) : null,
    });
    const mtf = {
      left: { daily: dailyL, minute: minuteL },
      right: { daily: dailyR, minute: minuteR },
    };
    const ladderNow = Date.now();
    const ladder = {
      left: buildTfLadder({ symbol: left.symbol, daily: dailyL, m15: left.bars, m1: minuteL, nowMs: ladderNow, engineTopDown: biasL.topDown }),
      right: buildTfLadder({ symbol: right.symbol, daily: dailyR, m15: right.bars, m1: minuteR, nowMs: ladderNow, engineTopDown: biasR.topDown }),
    };
    // THE CARD'S SCORE (2026-10-02): P(T1 | filled) from the four-year model
    // (hit-odds.ts, scripts/build-hit-odds.mjs). Computed here because it is
    // the first point where the plan, the ladder, the live price and the
    // scanner's pattern/SMT reads all exist together. Read-only — no gate,
    // no size; the 0.65 floor and the bands still run on the fit.
    for (const c of payload.scan.candidates) {
      const isLeft = c.symbol === left.symbol;
      const p = c.plan;
      const book = [smcMaster.left, smcMaster.right].find((b) => b && b.symbol === c.symbol && b.side === c.side);
      c.hitOdds = p
        ? hitOdds(
            {
              side: c.side === "short" ? "short" : "long",
              symbol: c.symbol,
              entry: p.entry,
              stop: p.stop,
              t1: p.t1,
              atr: p.atr ?? c.atr ?? null,
              price: (isLeft ? payload.quotes.left : payload.quotes.right)?.price ?? null,
              tags: ladderTags(isLeft ? ladder.left : ladder.right, c.side === "short" ? "short" : "long"),
              inducement: c.patterns?.inducement ?? null,
              mitigation: c.patterns?.mitigation ?? null,
              smt: c.smtLevel ?? null,
              killzone: clock.killzone,
              weekday: clock.weekday,
              fit: c.confluence,
              raceP: book?.plan?.worth?.pT1First ?? null,
            },
            HIT_ODDS_MODEL,
          )
        : null;
    }
    const coach = {
      xai: Boolean(process.env.XAI_API_KEY?.trim()),
      anthropic: Boolean(process.env.ANTHROPIC_API_KEY?.trim()),
    };
    // Re-stamp the receipt at the very end so elapsedMs covers the CPU half too.
    const budgetOut: DeskBudgetRead = { ...budget, elapsedMs: Date.now() - t0 };
    return {
      ...payload,
      smcMaster,
      coach,
      mtf,
      ladder,
      budget: budgetOut,
      stale: budgetOut.stale,
      liveSays: buildLiveSays({ ...payload, smcMaster, coach, mtf, ladder, budget: budgetOut, stale: budgetOut.stale }),
    };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Desk build failed",
    };
  }
}
