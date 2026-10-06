/**
 * The Mead Hall's subscribe loop over the real PredictionMarketFeed.
 *
 * Source: `getPredictionMarketFeed` (predict-server.ts) — Kalshi public,
 * read-only, broad (sports / econ / politics / weather / crypto), ranked by
 * setup quality with a mild NFL tie-break. Turned into screen state with the
 * feed module's own `stateFromKalshiResult`. When Kalshi answers with no
 * markets AND the build is DEV, the feed module's `source: "mock"` rows are
 * shown instead (`stateFromBoard(null, …, { allowMock: true })`). Production
 * never shows mock rows.
 *
 * READ-ONLY: polls only while something is subscribed and the page is visible.
 */

import {
  stateFromBoard,
  stateFromKalshiResult,
  type PredictionMarketFeedResult,
  type PredictionMarketFeedState,
} from "@/lib/predict/prediction-market-feed";

export interface MeadFeed {
  getState(): PredictionMarketFeedState;
  subscribe(fn: (s: PredictionMarketFeedState) => void): () => void;
  refresh(): void;
  dispose(): void;
}

export interface MeadFeedOptions {
  load: () => Promise<PredictionMarketFeedResult>;
  every?: number;
  /** Show the feed module's mock rows when Kalshi is empty. Default: Vite DEV only. */
  allowMock?: boolean;
}

const IDLE: PredictionMarketFeedState = { markets: [], topIds: [], featuredId: null, status: "idle", league: "nfl", fetchedAt: null, note: "" };

function devBuild(): boolean {
  try {
    return import.meta.env?.DEV === true;
  } catch {
    return false;
  }
}

/** One adapter read → hall state (exported for tests). */
export function meadStateFrom(result: PredictionMarketFeedResult | null, allowMock: boolean, error?: string): PredictionMarketFeedState {
  if (result && result.markets.length) return stateFromKalshiResult(result);
  if (allowMock) {
    const mock = stateFromBoard(null, "nfl", { allowMock: true });
    const why = error ?? result?.reason ?? "Kalshi returned no open markets";
    return { ...mock, note: `MOCK (DEV only) — ${why}` };
  }
  if (result) return stateFromKalshiResult(result);
  return { ...IDLE, status: "error", fetchedAt: new Date().toISOString(), note: error ?? "Feed unavailable.", reason: error };
}

export function createMeadFeed(opts: MeadFeedOptions): MeadFeed {
  const allowMock = opts.allowMock ?? devBuild();
  const every = opts.every ?? 15_000;
  let state = IDLE;
  const subs = new Set<(s: PredictionMarketFeedState) => void>();
  let timer: ReturnType<typeof setInterval> | null = null;
  let seq = 0;
  let disposed = false;
  const emit = (s: PredictionMarketFeedState) => {
    // One bad poll (rate limit, timeout, an empty answer) must not swap real
    // prices for mock rows or a blank hall: hold the last live read, say it is stale.
    if (state.status === "live" && s.status !== "live" && state.markets.length) {
      s = { ...state, note: `STALE — last live read kept (${s.reason ?? s.note})` };
    }
    state = s;
    for (const fn of subs) fn(s);
  };
  const refresh = () => {
    if (disposed) return;
    const my = ++seq;
    if (state.status === "idle") emit({ ...state, status: "loading" });
    opts
      .load()
      .then((r) => {
        if (!disposed && my === seq) emit(meadStateFrom(r, allowMock));
      })
      .catch((e: unknown) => {
        if (!disposed && my === seq) emit(meadStateFrom(null, allowMock, e instanceof Error ? e.message : String(e)));
      });
  };
  return {
    getState: () => state,
    subscribe(fn) {
      subs.add(fn);
      if (subs.size === 1 && !timer) {
        refresh();
        timer = setInterval(() => {
          if (typeof document === "undefined" || document.visibilityState === "visible") refresh();
        }, every);
      }
      return () => {
        subs.delete(fn);
        if (!subs.size && timer) {
          clearInterval(timer);
          timer = null;
        }
      };
    },
    refresh,
    dispose() {
      disposed = true;
      if (timer) clearInterval(timer);
      timer = null;
      subs.clear();
    },
  };
}
