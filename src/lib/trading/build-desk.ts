import { createServerFn } from "@tanstack/react-start";
import { APLUS_RULES } from "@/lib/aplus/config";
import {
  fetchDatabentoBars,
  hasDatabentoKey,
  quoteFromDatabentoSeries,
} from "@/lib/market/databento";
import {
  fetchYahooBars,
  fetchYahooLiveQuote,
  syntheticBars,
  syntheticQuote,
  type YahooInterval,
  type YahooRange,
} from "@/lib/market/yahoo";
import type { IndexSymbol, LiveQuote, SymbolSeries } from "@/lib/market/types";
import { getSessionClock, type SessionClock } from "./sessions";
import {
  analyzeStructure,
  referenceLevels,
  smtDivergence,
  type HtfBiasRead,
} from "./structure";
import { scanSetups, type ScanResult } from "./scanner";
import { drawOnLiquidity, type DrawRead } from "./draw";
import { newsRead, type NewsRead } from "./news";
import { summarizeDetectors } from "./detectors";
import {
  buildMarketNarrative,
  dualNarrativeSummary,
  type MarketNarrative,
} from "./market-narrative";

export interface DeskPayload {
  ok: true;
  fetchedAt: string;
  clock: SessionClock;
  left: SymbolSeries;
  right: SymbolSeries;
  quotes: { left: LiveQuote; right: LiveQuote };
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
  checklist: { id: string; label: string; ok: boolean; detail: string }[];
  /** Liquidity + confirmation + entry narrative (per book) */
  narrative: { left: MarketNarrative; right: MarketNarrative; summary: string };
}

export interface DeskError {
  ok: false;
  error: string;
}

async function load(
  symbol: IndexSymbol,
  range: YahooRange,
  interval: YahooInterval,
): Promise<SymbolSeries> {
  if (hasDatabentoKey()) {
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
    try {
      const db = await fetchDatabentoBars(
        symbol,
        range === "3mo"
          ? "3mo"
          : range === "1mo"
            ? "1mo"
            : range === "5d"
              ? "5d"
              : "1d",
        minutes,
      );
      if (db && db.bars.length >= 30) return db;
    } catch {
      /* fallthrough */
    }
  }
  try {
    const s = await fetchYahooBars(symbol, range, interval);
    if (s) return s;
  } catch {
    /* fallthrough */
  }
  return syntheticBars(symbol);
}

async function quote(
  symbol: IndexSymbol,
  series?: SymbolSeries | null,
): Promise<LiveQuote> {
  if (series?.source === "databento" && series.bars.length) {
    return quoteFromDatabentoSeries(series);
  }
  try {
    const q = await fetchYahooLiveQuote(symbol);
    if (q) return q;
  } catch {
    /* */
  }
  return syntheticQuote(symbol);
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
      const clock = getSessionClock();
      // 1mo 15m: 5d left the prior trading week only partially covered, so
      // PWH/PWL (prior completed week, Sun 18:00 → Fri 17:00 ET) was wrong.
      // Yahoo caps 15m history around 60d; bars are trimmed to MAX_BARS.
      const [left, right] = await Promise.all([
        load(data.left, "1mo", "15m"),
        load(data.right, "1mo", "15m"),
      ]);
      const [lq, rq] = await Promise.all([
        quote(data.left, left),
        quote(data.right, right),
      ]);

      if (lq.source === "yahoo" || lq.source === "databento") {
        left.price = lq.price;
        left.changePct = lq.changePct;
      }
      if (rq.source === "yahoo" || rq.source === "databento") {
        right.price = rq.price;
        right.changePct = rq.changePct;
      }

      const biasL = analyzeStructure(left.symbol, left.bars, left.changePct);
      const biasR = analyzeStructure(right.symbol, right.bars, right.changePct);
      // Real SMT: timestamp-aligned swing divergence, not a %-change proxy.
      const divergence = smtDivergence(left.bars, right.bars);
      // Draw on liquidity — which specific level price is empirically likely
      // to reach, from past sessions' remaining-excursion distribution plus
      // current distance / liquidity / bias. scanSetups computes its own from
      // the bars it already receives; these carry it into the desk payload.
      const drawL = drawOnLiquidity(biasL, left.bars);
      const drawR = drawOnLiquidity(biasR, right.bars);

      const scan = scanSetups(biasL, biasR, clock, divergence, left.bars, right.bars);
      const detL = summarizeDetectors(left.bars);
      const detR = summarizeDetectors(right.bars);
      const dirL: "bull" | "bear" =
        biasL.topDown === "bear" ? "bear" : "bull";
      const dirR: "bull" | "bear" =
        biasR.topDown === "bear" ? "bear" : "bull";
      const narrL = buildMarketNarrative(biasL, detL, clock, dirL, left.bars);
      const narrR = buildMarketNarrative(biasR, detR, clock, dirR, right.bars);
      const narrative = {
        left: narrL,
        right: narrR,
        summary: dualNarrativeSummary(narrL, narrR),
      };

      // News gate: a scheduled high-impact release inside the risk window kills
      // actionability the same way bad data does — the engine skips these too.
      const news = newsRead(new Date());
      if (news.verdict === "blackout") {
        for (const c of scan.candidates) c.actionable = false;
        scan.blocked.push(`News blackout: ${news.reason}`);
        scan.focus = `News blackout — ${news.reason} Stand down.`;
      } else if (news.verdict === "caution") {
        scan.blocked.push(`News caution: ${news.reason}`);
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
      const liveSource = (s: string) => s === "yahoo" || s === "databento";
      const seriesLive = liveSource(left.source) && liveSource(right.source);
      const maxLagSec = Math.max(lq.lagSec, rq.lagSec);

      /**
       * Fresh enough to price a fill against. Yahoo free will essentially
       * never clear this, which is the honest read: Yahoo is a structure
       * feed, not an execution feed. Databento historical windows lag by
       * hours on standard CME entitlements and are likewise structure-only.
       */
      const QUOTE_EXECUTION_SEC = 120;
      /**
       * Beyond this the quote is too old to even sanity-check a level
       * against, so the whole read is untrustworthy. One 15m bar.
       */
      const QUOTE_USABLE_SEC = 900;
      const usableLimit =
        left.source === "databento" || right.source === "databento"
          ? 14 * 3600
          : QUOTE_USABLE_SEC;

      const quoteExecutionGrade = maxLagSec <= QUOTE_EXECUTION_SEC;
      const quoteUsable = maxLagSec <= usableLimit;
      /**
       * Can the STRUCTURE be believed? Real bars from a real source, and a
       * quote recent enough to verify those levels against. Deliberately
       * independent of `quoteExecutionGrade` — that is the whole point of
       * the split, and `snapshots` keys its own `dataQualityOk` off the
       * "Data quality" prefix, which now only appears for these two hard
       * failures rather than for a merely slow tape.
       */
      const structureTrustworthy = seriesLive && quoteUsable;

      if (!seriesLive) {
        // No real bars at all — nothing here is analysis, let alone a trade.
        const reason = "Data quality: synthetic feed — no Databento/Yahoo data";
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
        left.source === right.source
          ? (left.source as DeskPayload["feed"])
          : "mixed";

      const checklist = [
        {
          id: "session",
          label: "Session / killzone",
          ok: clock.inTradeWindow,
          detail: clock.killzoneLabel,
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
          ok: seriesLive,
          detail: hasDatabentoKey()
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

      return {
        ok: true,
        fetchedAt: new Date().toISOString(),
        clock,
        left,
        right,
        quotes: { left: lq, right: rq },
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
        checklist,
        narrative,
      };
    } catch (e) {
      return {
        ok: false,
        error: e instanceof Error ? e.message : "Desk build failed",
      };
    }
  });
