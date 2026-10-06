/**
 * Mead Hall ← PM signal board (the analyzer's hall feed).
 *
 * Source: `getPredictionSignals` (predict-server.ts) → SignalBoard → the signal
 * engine's own `hallLayout(board)`:
 *   jumbotron  = #1 ranked MarketSignal  (featuredId)
 *   rune board = the next 5               (topIds)
 *   crowd      = CrowdRead from REAL price velocity only (never random)
 *
 * Every number on a hall screen is copied from a MarketSignal field; nothing
 * here computes a price, a probability or an edge. A missing field shows "—".
 * READ-ONLY / PAPER ONLY: no order path, no broker import.
 */

import type { MarketHallView, PredictionMarket, PredictionMarketFeedState, SetupGrade } from "@/lib/predict/prediction-market-feed";
import { hallLayout, type CrowdRead, type HallLayout, type MarketSignal, type SignalBoard, type SignalGrade } from "@/lib/predict/signal-engine";

export interface HallFeedState {
  /** What MeadScene / the hall screens draw. */
  hall: PredictionMarketFeedState;
  layout: HallLayout | null;
  board: SignalBoard | null;
  /** Hall-ordered signals: jumbotron, rune board, then the rest of the ranked board. */
  ordered: MarketSignal[];
  status: "idle" | "loading" | "live" | "empty" | "error";
  /** True when a failed / empty poll kept the last live board. */
  held: boolean;
  error: string | null;
}

const pctTxt = (x: number | null | undefined, d = 1) => (x == null ? "—" : `${(x * 100).toFixed(d)}%`);
const signedC = (x: number | null | undefined) => (x == null ? "—" : `${x >= 0 ? "+" : "−"}${Math.abs(x * 100).toFixed(1)}¢`);

/** Scanner-grade slot (type only — screens show `hall.grade`). F has no scanner letter. */
const SETUP: Record<SignalGrade, SetupGrade> = { A: "A", B: "B", C: "C", D: "D", F: "D" };

/** Hall lines for one signal (strings over real fields only). */
export function hallViewFor(s: MarketSignal): MarketHallView {
  const move = s.move.sinceOpen == null ? "move —" : `move ${signedC(s.move.sinceOpen)} since open`;
  const edge = s.edge.status === "edge" ? `edge ${signedC(s.edge.netPerContract)} ${s.edge.side.toUpperCase()}` : "no edge read";
  return {
    grade: s.grade,
    line: `YES needs ${pctTxt(s.implied.feeAdjustedYes)} after fees   ·   spread ${s.spread.cents == null ? "—" : `${s.spread.cents}¢`}   ·   ${move}   ·   settles ${s.settlement.words}`,
    sub: `needs ${pctTxt(s.implied.feeAdjustedYes, 0)} · ${s.liquidity.word} · ${edge}`,
  };
}

/** MarketSignal → the PredictionMarket row shape the existing mead screens draw. */
export function signalToHallMarket(s: MarketSignal): PredictionMarket {
  const edge = s.edge.status === "edge" ? s.edge.netPerContract : null;
  // Mood lighting only (MeadScene reads gates.word): GO/LIMIT need a REAL edge read.
  const word = s.edge.status === "edge" && s.grade === "A" ? "GO" : s.edge.status === "edge" && s.grade === "B" ? "LIMIT" : "STAND";
  const up = s.reasons.filter((r) => r.effect === "up").length;
  const graded = s.reasons.filter((r) => r.effect !== "info").length;
  const missing = s.reasons.filter((r) => r.effect === "cap" || r.effect === "down").map((r) => r.text);
  return {
    id: s.id,
    event: s.event,
    outcome: s.outcome,
    yesPrice: s.prices.yesAsk,
    noPrice: s.prices.noAsk,
    winChance: s.implied.mid,
    edge,
    setupGrade: SETUP[s.grade],
    gates: { word, passed: up, total: graded, missing: missing.length ? missing.join(" · ") : null },
    source: s.source,
    asOf: s.freshness.asOf,
    stale: s.freshness.stale,
    staleReason: s.freshness.staleReason,
    priceBasis: s.freshness.priceBasis,
    expiry: s.settlement.settleAt,
    volume: s.liquidity.volume24h,
    hall: hallViewFor(s),
  };
}

export const IDLE_HALL: PredictionMarketFeedState = {
  markets: [],
  topIds: [],
  featuredId: null,
  status: "idle",
  league: "nfl",
  fetchedAt: null,
  note: "Pouring the first round…",
};

export const EMPTY_FEED: HallFeedState = { hall: IDLE_HALL, layout: null, board: null, ordered: [], status: "idle", held: false, error: null };

/** One SignalBoard → hall state via hallLayout (pure; exported for tests). */
export function hallStateFromBoard(board: SignalBoard): { hall: PredictionMarketFeedState; layout: HallLayout; ordered: MarketSignal[] } {
  const layout = hallLayout(board);
  const head = [layout.jumbotron, ...layout.runeBoard].filter((s): s is MarketSignal => s != null);
  const headIds = new Set(head.map((s) => s.id));
  // board.signals is already ranked by the engine; keep that order for the tail.
  const ordered = [...head, ...board.signals.filter((s) => !headIds.has(s.id))];
  const empty = !ordered.length;
  const note = [
    board.stale ? "STALE read" : null,
    board.deadlineExceeded ? "partial (deadline)" : null,
    board.skipped?.length ? `skipped ${board.skipped.join(", ")}` : null,
    board.reason ?? null,
    `crowd: ${layout.crowd.reason}`,
  ]
    .filter(Boolean)
    .join(" · ");
  return {
    layout,
    ordered,
    hall: {
      markets: ordered.map(signalToHallMarket),
      featuredId: layout.jumbotron?.id ?? null,
      topIds: layout.runeBoard.map((s) => s.id),
      status: empty ? "empty" : "live",
      league: "nfl",
      fetchedAt: board.asOf,
      note,
      source: board.source,
      label: board.label,
      reason: board.reason,
      stale: board.stale,
    },
  };
}

/** Fold one poll result into the running state (holds the last live board on a bad poll). */
export function nextHallState(prev: HallFeedState, board: SignalBoard | null, error?: string): HallFeedState {
  const ok = board != null && board.signals.length > 0;
  if (!ok && prev.status === "live" && prev.board) {
    const why = error ?? board?.reason ?? "empty read";
    return { ...prev, held: true, error: why, hall: { ...prev.hall, note: `STALE — last live board kept (${why})`, stale: true } };
  }
  if (board) {
    const { hall, layout, ordered } = hallStateFromBoard(board);
    return { hall, layout, ordered, board, status: ok ? "live" : "empty", held: false, error: error ?? null };
  }
  const why = error ?? "Signal board unavailable.";
  return {
    ...EMPTY_FEED,
    status: "error",
    error: why,
    hall: { ...IDLE_HALL, status: "error", fetchedAt: new Date().toISOString(), note: why, reason: why },
  };
}

export interface SignalHallFeed {
  getState(): HallFeedState;
  subscribe(fn: (s: HallFeedState) => void): () => void;
  refresh(): void;
  dispose(): void;
}

/** Poll loop over getPredictionSignals — only while subscribed and the page is visible. */
export function createSignalHallFeed(opts: { load: () => Promise<SignalBoard>; every?: number }): SignalHallFeed {
  const every = opts.every ?? 30_000;
  let state = EMPTY_FEED;
  const subs = new Set<(s: HallFeedState) => void>();
  let timer: ReturnType<typeof setInterval> | null = null;
  let seq = 0;
  let disposed = false;
  const emit = (s: HallFeedState) => {
    state = s;
    for (const fn of subs) fn(s);
  };
  const refresh = () => {
    if (disposed) return;
    const my = ++seq;
    if (state.status === "idle") emit({ ...state, status: "loading", hall: { ...state.hall, status: "loading" } });
    opts
      .load()
      .then((b) => {
        if (!disposed && my === seq) emit(nextHallState(state, b));
      })
      .catch((e: unknown) => {
        if (!disposed && my === seq) emit(nextHallState(state, null, e instanceof Error ? e.message : String(e)));
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

/**
 * CrowdRead → crowd reaction (the hall's only reaction trigger in the analyzer).
 * Real velocity only: quiet / restless (mixed) reads and no-data reads stay silent.
 */
export function reactionForCrowd(c: CrowdRead): "cheer" | "groan" | "hail" | null {
  if (c.energy == null || c.basedOn === 0) return null;
  if (c.mood === "surging") return c.energy >= 0.6 ? "hail" : "cheer";
  if (c.mood === "sliding") return "groan";
  return null;
}

/** Crowd chip text for the analyzer header. */
export function crowdLabel(c: CrowdRead | null | undefined): string {
  if (!c) return "crowd —";
  return c.energy == null ? `crowd quiet · ${c.reason}` : `crowd ${c.mood} · energy ${Math.round(c.energy * 100)}% · ${c.reason}`;
}
