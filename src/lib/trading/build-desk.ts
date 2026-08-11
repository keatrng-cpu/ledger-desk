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

      // Live = databento or yahoo. Databento historical lag can be larger than
      // Yahoo free-print lag; allow 6h for DB bars, 120s for Yahoo.
      const liveSource = (s: string) => s === "yahoo" || s === "databento";
      const seriesLive = liveSource(left.source) && liveSource(right.source);
      const maxLagSec = Math.max(lq.lagSec, rq.lagSec);
      // Historical license windows lag live by ~8–12h on free/standard CME
      // entitlements — do not treat that as a dead feed (Yahoo free lag is still 120s).
      const lagLimit =
        left.source === "databento" || right.source === "databento"
          ? 14 * 3600
          : 120;
      const quotesFresh = maxLagSec <= lagLimit;
      const dataQualityOk = seriesLive && quotesFresh;
      if (!dataQualityOk) {
        const reason = seriesLive
          ? `Data quality: lagged feed (worst lag ${Math.round(maxLagSec)}s > ${lagLimit}s)`
          : "Data quality: synthetic feed — no Databento/Yahoo data";
        for (const c of scan.candidates) c.actionable = false;
        scan.blocked.push(reason);
        scan.focus = `${reason} — stand down.`;
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
          ok: dataQualityOk && clock.isWeekday,
          detail: !dataQualityOk
            ? "Data quality gate failed — stand down"
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
