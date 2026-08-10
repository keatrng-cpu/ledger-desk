import { createServerFn } from "@tanstack/react-start";
import type {
  DualIndexError,
  DualIndexPayload,
  IndexSymbol,
  LiveQuotesPayload,
} from "./types";
import {
  alignedReturnPairs,
  buildComparisonNote,
  fetchYahooBars,
  fetchYahooLiveQuote,
  pearsonCorr,
  syntheticBars,
  syntheticQuote,
  type YahooInterval,
  type YahooRange,
} from "./yahoo";

export type DualRangeKey = "1d" | "5d" | "1mo" | "3mo";

const RANGE_MAP: Record<
  DualRangeKey,
  { range: YahooRange; interval: YahooInterval }
> = {
  // 1m bars for session — freshest Yahoo continuous tape we can get free
  "1d": { range: "1d", interval: "1m" },
  "5d": { range: "5d", interval: "5m" },
  "1mo": { range: "1mo", interval: "60m" },
  "3mo": { range: "3mo", interval: "1d" },
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
  try {
    const live = await fetchYahooBars(symbol, range, interval);
    if (live) return live;
  } catch {
    /* fall through */
  }
  return syntheticBars(symbol);
}

async function loadQuote(symbol: IndexSymbol) {
  try {
    const q = await fetchYahooLiveQuote(symbol);
    if (q) return q;
  } catch {
    /* fall through */
  }
  return syntheticQuote(symbol);
}

/** Full dual series + initial live quotes (heavier). */
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
      const [left, right, leftQ, rightQ] = await Promise.all([
        loadSymbol(data.left, cfg.range, cfg.interval),
        loadSymbol(data.right, cfg.range, cfg.interval),
        loadQuote(data.left),
        loadQuote(data.right),
      ]);

      // Prefer live quote prints for header price / session change
      if (leftQ.source === "yahoo") {
        left.price = leftQ.price;
        left.changePct = leftQ.changePct;
        left.marketTimeMs = leftQ.marketTimeMs;
        left.marketTimeIso = leftQ.marketTimeIso;
        left.previousClose = leftQ.previousClose;
      }
      if (rightQ.source === "yahoo") {
        right.price = rightQ.price;
        right.changePct = rightQ.changePct;
        right.marketTimeMs = rightQ.marketTimeMs;
        right.marketTimeIso = rightQ.marketTimeIso;
        right.previousClose = rightQ.previousClose;
      }

      const pairs = alignedReturnPairs(left.bars, right.bars);
      const corr = pearsonCorr(pairs.left, pairs.right);

      return {
        ok: true,
        range: data.rangeKey,
        interval: cfg.interval,
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

/**
 * Lightweight second-precision poll — only last prints + lag.
 * Call every 1–2s from the client while the dual desk is visible.
 */
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
        loadQuote(data.left),
        loadQuote(data.right),
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
