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
import { analyzeStructure, type HtfBiasRead } from "./structure";
import { scanSetups, type ScanResult } from "./scanner";

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

function levelsFrom(read: HtfBiasRead) {
  const items: { name: string; price: number; kind: string }[] = [];
  if (read.pdh != null)
    items.push({ name: "PDH", price: read.pdh, kind: "prior" });
  if (read.pdl != null)
    items.push({ name: "PDL", price: read.pdl, kind: "prior" });
  if (read.dayOpen != null)
    items.push({ name: "Day open", price: read.dayOpen, kind: "open" });
  if (read.dealing) {
    items.push({ name: "Range high", price: read.dealing.high, kind: "range" });
    items.push({ name: "EQ", price: read.dealing.eq, kind: "range" });
    items.push({ name: "Range low", price: read.dealing.low, kind: "range" });
  }
  for (const l of read.liquidity.slice(0, 4)) {
    items.push({
      name: l.label,
      price: l.price,
      kind: l.side,
    });
  }
  return items.sort((a, b) => b.price - a.price);
}

export const fetchTradingDesk = createServerFn({ method: "POST" })
  .validator((input: { left?: IndexSymbol; right?: IndexSymbol }) => {
    const left = (input?.left ?? "MNQ") as IndexSymbol;
    const right = (input?.right ?? "ES") as IndexSymbol;
    return { left, right };
  })
  .handler(async ({ data }): Promise<DeskPayload | DeskError> => {
    try {
      const clock = getSessionClock();
      // 5d 15m for structure + liquidity; solid mid-context
      const [left, right, lq, rq] = await Promise.all([
        load(data.left, "5d", "15m"),
        load(data.right, "5d", "15m"),
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
      const scan = scanSetups(biasL, biasR, clock);

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
          { symbol: left.symbol, items: levelsFrom(biasL) },
          { symbol: right.symbol, items: levelsFrom(biasR) },
        ],
        checklist,
      };
    } catch (e) {
      return {
        ok: false,
        error: e instanceof Error ? e.message : "Desk build failed",
      };
    }
  });
