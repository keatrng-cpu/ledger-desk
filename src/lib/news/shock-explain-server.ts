/**
 * Server function for the shock explainer. Takes only the shock's numbers (no free text), re-checks that it is a
 * real, recent, ≥3×ATR candle with no calendar row near it, and returns the cached explanation. One search per
 * shock for everyone (explainShockCached), so a page full of clients cannot multiply the cost.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { effectiveCalendar } from "@/lib/trading/news";
import { explainShockCached, shouldExplain, type ShockExplain } from "./shock-explain";

const input = z.object({
  at: z.number().int().positive(),
  symbol: z.enum(["ES", "NQ", "MNQ", "MES", "SPY", "QQQ"]),
  side: z.enum(["up", "down"]),
  pts: z.number().finite().nonnegative(),
  atrMult: z.number().finite().nonnegative(),
  kind: z.enum(["macro", "nq-led", "es-led", "single"]),
});

const MAX_AGE_MS = 2 * 60 * 60_000;

export const getShockExplain = createServerFn({ method: "POST" })
  .validator((x: unknown) => input.parse(x))
  .handler(async ({ data }): Promise<ShockExplain | null> => {
    const now = Date.now();
    if (data.at > now + 60_000 || now - data.at > MAX_AGE_MS) return null;
    if (!shouldExplain(data, effectiveCalendar(now).rows)) return null;
    return explainShockCached(data);
  });
