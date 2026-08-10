/**
 * Server fn for TradeZella / real-data backtest chat.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  analyzeTradezella,
  analysisToMarkdown,
  type TradezellaAnalysis,
} from "./tradezella-analyze";
import {
  isBacktestIntent,
  parseBacktestIntent,
  parseTradezellaCsv,
  runWeekBacktest,
  type DayBacktestRow,
  type WeekBacktestReport,
} from "./session-backtest";

const inputSchema = z.object({
  message: z.string().max(12000).default(""),
  imageDataUrl: z.string().max(6_000_000).nullable().optional(),
  imageName: z.string().max(200).nullable().optional(),
  csvText: z.string().max(500_000).nullable().optional(),
  deskContext: z
    .object({
      htfLeft: z.string().max(500).optional(),
      htfRight: z.string().max(500).optional(),
      killzone: z.string().max(120).optional(),
      smt: z.string().max(500).optional(),
      bestSetup: z.string().max(500).optional(),
    })
    .optional(),
});

export type TradezellaChatResult = {
  analysis: TradezellaAnalysis;
  markdown: string;
  mode: "text" | "week_backtest" | "csv";
  week?: WeekBacktestReport;
  csvSummary?: string;
  days?: DayBacktestRow[];
  queue?: string[];
};

export const analyzeTradezellaChat = createServerFn({ method: "POST" })
  .validator((input: unknown) => inputSchema.parse(input ?? {}))
  .handler(async ({ data }): Promise<TradezellaChatResult> => {
    const msg = data.message || "";

    // CSV import path
    if (data.csvText && data.csvText.includes(",")) {
      const parsed = parseTradezellaCsv(data.csvText);
      const analysis = analyzeTradezella({
        message: `${msg}\n${parsed.summary}\ntrades ${parsed.rows.length}`,
        deskContext: data.deskContext,
      });
      analysis.title = "TradeZella CSV import";
      analysis.summary = parsed.summary;
      analysis.stats.trades = parsed.rows.length;
      const wins = parsed.rows.filter((r) => (r.pnl ?? r.r ?? 0) > 0).length;
      if (parsed.rows.length) {
        analysis.stats.winRate = wins / parsed.rows.length;
      }
      return {
        analysis,
        markdown:
          analysisToMarkdown(analysis) +
          "\n\n### Imported rows (first 30)\n" +
          parsed.rows
            .slice(0, 30)
            .map(
              (r) =>
                `- ${r.date} ${r.symbol} ${r.side} pnl=${r.pnl ?? "—"} R=${r.r ?? "—"}`,
            )
            .join("\n"),
        mode: "csv",
        csvSummary: parsed.summary,
      };
    }

    // Real-data week / day / month backtest
    if (isBacktestIntent(msg)) {
      const window = parseBacktestIntent(msg);
      if (window) {
        const week = await runWeekBacktest(msg, window);
        return {
          analysis: week.analysis,
          markdown: week.markdown,
          mode: "week_backtest",
          week,
          days: week.days,
          queue: week.queue,
        };
      }
      // Recognized as backtest but date not parsed — never silent
      const analysis = analyzeTradezella({
        message: msg,
        deskContext: data.deskContext,
      });
      analysis.title = "Could not parse backtest dates";
      analysis.summary =
        'I heard a backtest request but could not parse the dates. Try: "backtest july 2026", "backtest week of July 14 2026", or "backtest 2026-07-01 to 2026-07-15 MNQ ES".';
      analysis.nextActions = [
        'Example: backtest july 2026 MNQ ES',
        'Example: backtest week of July 14 2026',
        'Example: backtest 2026-07-07 MNQ',
        "Typo years like 20266 are auto-fixed to 2026.",
      ];
      return {
        analysis,
        markdown: analysisToMarkdown(analysis),
        mode: "text",
      };
    }

    const analysis = analyzeTradezella({
      message: msg,
      imageDataUrl: data.imageDataUrl,
      imageName: data.imageName,
      deskContext: data.deskContext,
    });
    return {
      analysis,
      markdown: analysisToMarkdown(analysis),
      mode: "text",
    };
  });
