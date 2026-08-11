import { createServerFn } from "@tanstack/react-start";
import { APLUS_RULES } from "@/lib/aplus/config";
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
  checklist: { id: string; label: string; ok: boolean; detail: string }[];
}

export interface DeskError {
  ok: false;
  error: string;
}

async function load(symbol: IndexSymbol, range: YahooRange, interval: YahooInterval) {
  try {
    const s = await fetchYahooBars(symbol, range, interval);
    if (s) return s;
  } catch {
    /* fallthrough */
  }
  return syntheticBars(symbol);
}

async function quote(symbol: IndexSymbol) {
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
      const [left, right, lq, rq] = await Promise.all([
        load(data.left, "1mo", "15m"),
        load(data.right, "1mo", "15m"),
        quote(data.left),
        quote(data.right),
      ]);

      if (lq.source === "yahoo") {
        left.price = lq.price;
        left.changePct = lq.changePct;
      }
      if (rq.source === "yahoo") {
        right.price = rq.price;
        right.changePct = rq.changePct;
      }

      const biasL = analyzeStructure(left.symbol, left.bars, left.changePct);
      const biasR = analyzeStructure(right.symbol, right.bars, right.changePct);
      // Real SMT: timestamp-aligned swing divergence, not a %-change proxy.
      const divergence = smtDivergence(left.bars, right.bars);

      // Draw on liquidity — which specific level is price likely headed to,
      // scored from PAST sessions' actual remaining-excursion distribution
      // plus current distance/liquidity/bias. Feeds the scanner's targets.
      const drawL = drawOnLiquidity(biasL, left.bars);
      const drawR = drawOnLiquidity(biasR, right.bars);
      const draws = { [left.symbol]: drawL, [right.symbol]: drawR };

      const scan = scanSetups(biasL, biasR, clock, divergence, draws);

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

      // Data-quality gate: a synthetic series or a badly lagged quote makes
      // structure + scanner untrustworthy — nothing is actionable on bad data.
      const seriesLive = left.source === "yahoo" && right.source === "yahoo";
      const maxLagSec = Math.max(lq.lagSec, rq.lagSec);
      const quotesFresh = maxLagSec <= 120;
      const dataQualityOk = seriesLive && quotesFresh;
      if (!dataQualityOk) {
        const reason = seriesLive
          ? `Data quality: lagged feed (worst quote lag ${Math.round(maxLagSec)}s > 120s)`
          : "Data quality: synthetic feed — no live Yahoo data";
        for (const c of scan.candidates) c.actionable = false;
        scan.blocked.push(reason);
        scan.focus = `${reason} — stand down.`;
      }

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
          // TODO: replace with the real risk governor (daily/weekly halts,
          // per-KZ setup counts, equity drawdown) — see INTEGRATION-P1.md.
          // For now this honestly reflects data quality + weekday only.
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
        draws: { left: drawL, right: drawR },
        checklist,
      };
    } catch (e) {
      return {
        ok: false,
        error: e instanceof Error ? e.message : "Desk build failed",
      };
    }
  });
