/**
 * Server fn for TradeZella analysis chat.
 * Deterministic structure mapping — no live order authority.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  analyzeTradezella,
  analysisToMarkdown,
  type TradezellaAnalysis,
} from "./tradezella-analyze";

const inputSchema = z.object({
  message: z.string().max(12000).default(""),
  imageDataUrl: z.string().max(6_000_000).nullable().optional(),
  imageName: z.string().max(200).nullable().optional(),
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
};

export const analyzeTradezellaChat = createServerFn({ method: "POST" })
  .validator((input: unknown) => inputSchema.parse(input ?? {}))
  .handler(async ({ data }): Promise<TradezellaChatResult> => {
    const analysis = analyzeTradezella({
      message: data.message,
      imageDataUrl: data.imageDataUrl,
      imageName: data.imageName,
      deskContext: data.deskContext,
    });
    return {
      analysis,
      markdown: analysisToMarkdown(analysis),
    };
  });
