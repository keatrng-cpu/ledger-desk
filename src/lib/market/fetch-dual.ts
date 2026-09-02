import { createServerFn } from "@tanstack/react-start";
import type {
  DualIndexError,
  DualIndexPayload,
  IndexSymbol,
  LiveQuotesPayload,
} from "./types";
import {
  fetchDatabentoBars,
  hasDatabentoKey,
} from "./databento";
import { readLiveTickFresh, quoteFromLiveTick } from "./live-gateway";
import { pickFreshestQuote, stitchLiveSession } from "./freshest";
import {
  alignedReturnPairs,
  buildComparisonNote,
  YAHOO_MAP,
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
  minutes: number,
) {
  let historical: Awaited<ReturnType<typeof fetchDatabentoBars>> = null;
  if (hasDatabentoKey()) {
    try {
      const db = await fetchDatabentoBars(
        symbol,
        range === "3mo" ? "3mo" : range === "1mo" ? "1mo" : range === "5d" ? "5d" : "1d",
        minutes >= 1440 ? 60 : minutes,
      );
      if (db && db.bars.length >= 20) historical = db;
    } catch {
      /* fall through */
    }
  }
  let live = null;
  try {
    live = await fetchYahooBars(symbol, range, interval);
  } catch {
    /* fall through */
  }
  return stitchLiveSession(historical, live) ?? syntheticBars(symbol);
}

async function loadQuote(symbol: IndexSymbol, previousClose?: number) {
  // Gateway first. If a live tick is already in Postgres, skip Yahoo —
  // waiting on the delayed chart is what made Trade Now feel frozen, and
  // hammering Yahoo while the gateway is up is how you get rate-limited
  // for free. No extra Databento spend.
  const tick = await readLiveTickFresh(symbol);
  if (tick) {
    return quoteFromLiveTick(
      tick,
      YAHOO_MAP[symbol].yahoo,
      previousClose || tick.price,
    );
  }
  const yahoo = await fetchYahooLiveQuote(symbol).catch(() => null);
  return pickFreshestQuote(yahoo) ?? syntheticQuote(symbol);
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
        loadSymbol(data.left, cfg.range, cfg.interval, cfg.minutes),
        loadSymbol(data.right, cfg.range, cfg.interval, cfg.minutes),
      ]);

      const [leftQ, rightQ] = await Promise.all([
        loadQuote(data.left, left.previousClose ?? undefined),
        loadQuote(data.right, right.previousClose ?? undefined),
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


      const pairs = alignedReturnPairs(left.bars, right.bars);
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
