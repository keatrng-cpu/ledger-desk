import { createServerFn } from "@tanstack/react-start";
import { withBudget } from "@/lib/market/budget";
import { APLUS_RULES } from "@/lib/aplus/config";
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
import { readLiveTickFresh, quoteFromLiveTick, readLiveBars } from "@/lib/market/live-gateway";
import {
  aggregateBars,
  applyQuoteToLastBar,
  closedBars,
  mergeNewerBars,
  pickFreshestQuote,
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
import { getSessionClock, sessionLive, type SessionClock } from "./sessions";
import { applySession } from "./session-event";
import { buildLiveSays, type LiveSays } from "./live-says";
import { buildTfLadder, type TfLadder } from "./tf-ladder";
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
}

export interface DeskError {
  ok: false;
  error: string;
}

/**
 * Hard ceiling on the Databento leg of a desk build, in ms.
 *
 * WHY THIS EXISTS (measured 2026-09-19, weekend tape)
 * The server function runs in Netlify's streaming mode, and the edge cuts a
 * stream that has been silent for ~30s, returning a 565-byte "Inactivity
 * Timeout" page with a 504. Desk builds were taking 23-33s — straddling that
 * line — so roughly every other poll died, and the desk printed the edge's
 * raw HTML in its error banner. The time went into fetchDatabentoBars: a
 * 45s per-request abort, a 422 discovery round-trip, and chunked history
 * loads, all run BEFORE Yahoo was even started.
 *
 * Databento is the better source (real CME bars, fewer gaps) and Yahoo is a
 * sufficient one for structure. A slow Databento must therefore degrade the
 * desk to Yahoo, never take it down. The series carries its `source`, so the
 * degradation is visible on the HUD rather than silent.
 *
 * Budget chosen so the whole build lands comfortably under the 20s poll
 * cadence: ~12s here, Yahoo's own 15s abort in parallel, quotes after.
 */
const DATABENTO_BUDGET_MS = 12_000;

/**
 * The ladder's extra series. Daily bars move once a day and are cached for
 * ten minutes; 1m bars are cached for 20s (one poll) so a burst of polls
 * does not fan out into a burst of Yahoo calls. Both are budgeted: a slow
 * fetch returns the cached or empty series and the ladder marks the rung
 * "no data" rather than holding the desk.
 */
const DAILY_CACHE_MS = 10 * 60_000;
const MINUTE_CACHE_MS = 20_000;
const LADDER_BUDGET_MS = 6_000;
/** 1m bars shipped per book — 8h covers every LTF rung with room. */
const MINUTE_KEEP = 480;
const seriesCache = new Map<string, { at: number; bars: OhlcBar[] }>();

async function loadCached(key: string, ttlMs: number, fetcher: () => Promise<OhlcBar[]>): Promise<OhlcBar[]> {
  const hit = seriesCache.get(key);
  const now = Date.now();
  if (hit && now - hit.at < ttlMs) return hit.bars;
  const bars = await withBudget(fetcher().catch(() => [] as OhlcBar[]), LADDER_BUDGET_MS, [] as OhlcBar[]);
  if (bars.length) seriesCache.set(key, { at: now, bars });
  return bars.length ? bars : (hit?.bars ?? []);
}

function loadDaily(symbol: IndexSymbol): Promise<OhlcBar[]> {
  return loadCached(`daily:${symbol}`, DAILY_CACHE_MS, async () => (await fetchYahooBars(symbol, "2y", "1d"))?.bars ?? []);
}

function loadMinute(symbol: IndexSymbol): Promise<OhlcBar[]> {
  return loadCached(`minute:${symbol}`, MINUTE_CACHE_MS, async () => {
    const yahoo = (await fetchYahooBars(symbol, "1d", "1m"))?.bars ?? [];
    // Inside the live window the gateway's 1m bars are the fresher closed
    // bars; overlay them from the Yahoo series' last bar forward.
    const gw = await withBudget(readLiveBars(symbol, 240).catch(() => [] as OhlcBar[]), GATEWAY_BARS_BUDGET_MS, [] as OhlcBar[]);
    return (gw.length ? mergeNewerBars(yahoo, gw) : yahoo).slice(-MINUTE_KEEP);
  });
}

/**
 * The gateway's 1m bars are one Postgres query away; a slow pooler must not
 * hold the desk build. Past this the closed bars simply stay Yahoo's.
 */
const GATEWAY_BARS_BUDGET_MS = 1_500;
/** 1m bars pulled from the gateway per build: 4h covers the whole window. */
const GATEWAY_BARS_LIMIT = 240;

async function load(
  symbol: IndexSymbol,
  range: YahooRange,
  interval: YahooInterval,
): Promise<SymbolSeries> {
  const minutes =
    interval === "1m"
      ? 1
      : interval === "5m"
        ? 5
        : interval === "15m"
          ? 15
          : interval === "60m"
            ? 60
            : 15;

  // Databento and Yahoo are independent sources that get STITCHED, so they
  // are fetched concurrently. They used to run back to back — Databento's
  // full timeout, then Yahoo's — which is how the critical path reached 30s.
  const databento = hasDatabentoKey()
    ? withBudget(
        fetchDatabentoBars(
          symbol,
          range === "3mo" ? "3mo" : range === "1mo" ? "1mo" : range === "5d" ? "5d" : "1d",
          minutes,
        ).catch(() => null),
        DATABENTO_BUDGET_MS,
        null,
      )
    : Promise.resolve(null);
  const yahoo = fetchYahooBars(symbol, range, interval).catch(() => null);
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

  const [db, live, gw] = await Promise.all([databento, yahoo, gateway]);
  const historical = db && db.bars.length >= 30 ? db : null;

  const stitched = stitchLiveSession(historical, live);
  if (!stitched) return syntheticBars(symbol);
  if (!gw.length) return stitched;

  // Overlay the gateway's buckets at and after the stitched series' last bar
  // — the only bars that can be stale — and label the series live when the
  // newest bar came from the socket.
  const rolled = aggregateBars(gw, minutes);
  const merged = mergeNewerBars(stitched.bars, rolled);
  const newestGw = rolled[rolled.length - 1]!.t;
  const newestBase = stitched.bars[stitched.bars.length - 1]!.t;
  return stampSeriesFromBars(
    { ...stitched, source: newestGw >= newestBase ? "live_gateway" : stitched.source },
    merged,
  );
}

async function quote(
  symbol: IndexSymbol,
  series?: SymbolSeries | null,
): Promise<LiveQuote> {
  const previousClose = series?.previousClose ?? series?.bars.at(-1)?.c ?? 0;
  const yahooSym = series?.yahoo ?? YAHOO_MAP[symbol].yahoo;

  const gatewayTick = await readLiveTickFresh(symbol);
  if (gatewayTick) {
    return quoteFromLiveTick(
      gatewayTick,
      yahooSym,
      previousClose || gatewayTick.price,
    );
  }

  const yahooQ = await fetchYahooLiveQuote(symbol).catch(() => null);
  const db =
    series?.source === "databento" && series.bars.length
      ? quoteFromDatabentoSeries(series)
      : null;

  return pickFreshestQuote(yahooQ, db) ?? syntheticQuote(symbol);
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
    try {
      const clock0 = getSessionClock();
      // 1mo 15m: 5d left the prior trading week only partially covered, so
      // PWH/PWL (prior completed week, Sun 18:00 → Fri 17:00 ET) was wrong.
      // Yahoo caps 15m history around 60d; bars are trimmed to MAX_BARS.
      const [left, right, dailyL, dailyR, minuteL, minuteR] = await Promise.all([
        load(data.left, "1mo", "15m"),
        load(data.right, "1mo", "15m"),
        loadDaily(data.left),
        loadDaily(data.right),
        loadMinute(data.left),
        loadMinute(data.right),
      ]);
      const [lq0, rq0, spySpot, qqqSpot] = await Promise.all([
        quote(data.left, left),
        quote(data.right, right),
        fetchYahooSpot("SPY"),
        fetchYahooSpot("QQQ"),
      ]);
      let lq = lq0;
      let rq = rq0;

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
      const raidDir = (
        b: typeof biasL,
        d: typeof detL,
      ): "bull" | "bear" | null => {
        const probe = buildMarketNarrative(b, d, clock, "bull");
        const swept = probe.liquidity.lastSweep;
        return swept === "ssl" ? "bull" : swept === "bsl" ? "bear" : null;
      };
      const dirL: "bull" | "bear" =
        raidDir(biasL, detL) ?? (biasL.topDown === "bear" ? "bear" : "bull");
      const dirR: "bull" | "bear" =
        raidDir(biasR, detR) ?? (biasR.topDown === "bear" ? "bear" : "bull");
      const narrL = buildMarketNarrative(biasL, detL, clock, dirL, left.bars);
      const narrR = buildMarketNarrative(biasR, detR, clock, dirR, right.bars);
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
      const shock = readShock(
        { symbol: left.symbol, closedBars: closedL, quote: quotesLive ? { price: lq.price, marketTimeMs: lq.marketTimeMs } : null },
        { symbol: right.symbol, closedBars: closedR, quote: quotesLive ? { price: rq.price, marketTimeMs: rq.marketTimeMs } : null },
        nowMs,
      );

      // News gate: a scheduled high-impact release inside the risk window kills
      // actionability the same way bad data does — the engine skips these too.
      const newsBase = newsRead(new Date());
      const news: NewsRead =
        shock.active
          ? {
              ...newsBase,
              verdict: "blackout",
              reason: `${shock.line} · ${Math.ceil((shock.lockUntilMs! - nowMs) / 60_000)}m lock — impulse is the news, not the model`,
            }
          : newsBase;
      if (news.verdict === "blackout") {
        for (const c of scan.candidates) c.actionable = false;
        scan.blocked.push(`News blackout: ${news.reason}`);
        scan.focus = `News blackout — ${news.reason} Stand down.`;
      } else if (news.verdict === "caution") {
        scan.blocked.push(`News caution: ${news.reason}`);
      }

      // Post-shock tail: lock lifted but the tape is still repricing. A+ only,
      // and every card must build a NEW sequence after the shock (the SMC
      // array/sweep floor is applied in smc-master via desk.shock.freshFloorMs).
      if (shock.tail) {
        for (const c of scan.candidates) {
          const band = String(c.pathBand || c.grade);
          if (band !== "A+" && c.actionable) {
            c.actionable = false;
            c.reasons = [...c.reasons, `post-shock tail (${Math.ceil((shock.tailUntilMs! - nowMs) / 60_000)}m) — A+ only`];
          }
        }
        scan.blocked.push(`Post-shock tail — A+ only · ${shock.line}`);
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
          ok: seriesLive && quotesLive,
          detail: !quotesLive
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

      const payload = {
        ok: true as const,
        fetchedAt: new Date().toISOString(),
        clock,
        left,
        right,
        quotes: { left: lq, right: rq },
        proxies: { SPY: spySpot, QQQ: qqqSpot },
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
      const coach = {
        xai: Boolean(process.env.XAI_API_KEY?.trim()),
        anthropic: Boolean(process.env.ANTHROPIC_API_KEY?.trim()),
      };
      return {
        ...payload,
        smcMaster,
        coach,
        mtf,
        ladder,
        liveSays: buildLiveSays({ ...payload, smcMaster, coach, mtf, ladder }),
      };
    } catch (e) {
      return {
        ok: false,
        error: e instanceof Error ? e.message : "Desk build failed",
      };
    }
  });
