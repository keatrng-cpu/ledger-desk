import { createServerFn } from "@tanstack/react-start";
import type {
  DualIndexError,
  DualIndexPayload,
  IndexSymbol,
  LiveQuotesPayload,
} from "./types";
import { loadLiveQuote, loadStructureSeries } from "./live-ladder";
import { priorSessionClose, rebaseQuote } from "./freshest";
import {
  alignedReturnPairs,
  buildComparisonNote,
  pearsonCorr,
  type YahooInterval,
  type YahooRange,
} from "./yahoo";


export type DualRangeKey = "1d" | "5d" | "1mo" | "3mo";

const RANGE_MAP: Record<
  DualRangeKey,
  { range: YahooRange; interval: YahooInterval; minutes: number }
> = {
  "1d": { range: "1d", interval: "1m", minutes: 1 },
  "5d": { range: "5d", interval: "5m", minutes: 5 },
  "1mo": { range: "1mo", interval: "60m", minutes: 60 },
  "3mo": { range: "3mo", interval: "1d", minutes: 60 * 24 },
};

const VALID_RANGE = new Set<DualRangeKey>(["1d", "5d", "1mo", "3mo"]);
const VALID_SYM = new Set<IndexSymbol>(["MNQ", "ES", "NQ"]);

function parsePair(input: {
  rangeKey?: DualRangeKey;
  left?: IndexSymbol;
  right?: IndexSymbol;
}) {
  const rangeKey = (
    input?.rangeKey && VALID_RANGE.has(input.rangeKey) ? input.rangeKey : "5d"
  ) as DualRangeKey;
  const left = (
    input?.left && VALID_SYM.has(input.left) ? input.left : "MNQ"
  ) as IndexSymbol;
  let right = (
    input?.right && VALID_SYM.has(input.right) ? input.right : "ES"
  ) as IndexSymbol;
  if (right === left) {
    right = left === "ES" ? "MNQ" : "ES";
  }
  return { rangeKey, left, right };
}

async function loadSymbol(
  symbol: IndexSymbol,
  range: YahooRange,
  interval: YahooInterval,
) {
  return loadStructureSeries(symbol, range, interval, 20);
}


export const fetchDualIndexes = createServerFn({ method: "POST" })
  .validator((input: {
    rangeKey?: DualRangeKey;
    left?: IndexSymbol;
    right?: IndexSymbol;
  }) => parsePair(input))
  .handler(async ({ data }): Promise<DualIndexPayload | DualIndexError> => {
    const cfg = RANGE_MAP[data.rangeKey] ?? RANGE_MAP["5d"];
    const fetchedAtMs = Date.now();
    try {
      const [left, right] = await Promise.all([
        loadSymbol(data.left, cfg.range, cfg.interval),
        loadSymbol(data.right, cfg.range, cfg.interval),
      ]);

      const [leftQ, rightQ] = await Promise.all([
        loadLiveQuote(data.left, left).then((q) =>
          rebaseQuote(q, priorSessionClose(left.bars) ?? left.previousClose),
        ),
        loadLiveQuote(data.right, right).then((q) =>
          rebaseQuote(q, priorSessionClose(right.bars) ?? right.previousClose),
        ),
      ]);

      if (leftQ.source !== "synthetic") {
        left.price = leftQ.price;
        left.changePct = leftQ.changePct;
        left.marketTimeMs = leftQ.marketTimeMs;
        left.marketTimeIso = leftQ.marketTimeIso;
        left.previousClose = leftQ.previousClose;
      }
      if (rightQ.source !== "synthetic") {
        right.price = rightQ.price;
        right.changePct = rightQ.changePct;
        right.marketTimeMs = rightQ.marketTimeMs;
        right.marketTimeIso = rightQ.marketTimeIso;
        right.previousClose = rightQ.previousClose;
      }


      const pairs = alignedReturnPairs(left.bars, right.bars, {
        nowMs: fetchedAtMs,
        barMs: cfg.minutes * 60_000,
      });
      const corr = pearsonCorr(pairs.left, pairs.right);

      return {
        ok: true,
        range: data.rangeKey,
        interval: left.interval || cfg.interval,
        fetchedAt: new Date(fetchedAtMs).toISOString(),
        fetchedAtMs,
        left,
        right,
        quotes: { left: leftQ, right: rightQ },
        comparison: {
          corr,
          leftRet: left.changePct,
          rightRet: right.changePct,
          spreadRet: left.changePct - right.changePct,
          note: buildComparisonNote(left, right, corr),
        },
      };
    } catch (e) {
      return {
        ok: false,
        error: e instanceof Error ? e.message : "Failed to load dual indexes",
      };
    }
  });

export const fetchLiveQuotes = createServerFn({ method: "POST" })
  .validator((input: { left?: IndexSymbol; right?: IndexSymbol }) => {
    const left = (
      input?.left && VALID_SYM.has(input.left) ? input.left : "MNQ"
    ) as IndexSymbol;
    let right = (
      input?.right && VALID_SYM.has(input.right) ? input.right : "ES"
    ) as IndexSymbol;
    if (right === left) right = left === "ES" ? "MNQ" : "ES";
    return { left, right };
  })
  .handler(async ({ data }): Promise<LiveQuotesPayload | DualIndexError> => {
    const fetchedAtMs = Date.now();
    try {
      const [left, right] = await Promise.all([
        loadLiveQuote(data.left),
        loadLiveQuote(data.right),
      ]);
      return {
        ok: true,
        fetchedAt: new Date(fetchedAtMs).toISOString(),
        fetchedAtMs,
        left,
        right,
      };
    } catch (e) {
      return {
        ok: false,
        error: e instanceof Error ? e.message : "Quote poll failed",
      };
    }
  });
