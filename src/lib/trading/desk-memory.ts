/**
 * Persistent desk memory (browser localStorage).
 * Backtest fills feed strategy/band/side rates the veteran brain uses live.
 */

import {
  loadAtlas,
  mergeAtlas,
  saveAtlas,
  type AtlasEdge,
  type AtlasNode,
  type DeskAtlas,
} from "@/lib/room/desk-atlas";

export type MemoryKind =
  | "backtest"
  | "journal"
  | "live_setup"
  | "paper"
  | "paper_open"
  | "discretion"
  | "note"
  | "session";

export interface MemoryItem {
  id: string;
  kind: MemoryKind;
  ts: number;
  title: string;
  summary: string;
  tags: string[];
  payload?: Record<string, unknown>;
}

export interface RateBucket {
  n: number;
  wins: number;
  sumR: number;
}

export interface BacktestFillRecord {
  date: string;
  symbol: string;
  side: string;
  strategy: string;
  band: string;
  grade: string;
  score: number;
  r: number;
  usd: number;
  exit: string;
  windowLabel: string;
}

export interface DeskMemoryState {
  version: 2;
  items: MemoryItem[];
  pins: string[];
  book: {
    equity: number;
    /** High-water mark for drawdown */
    peakEquity: number;
    startEquity: number;
    pathTaken: number;
    pathWins: number;
    pathLosses: number;
    sumR: number;
    sumUsd: number;
    lastBacktestLabel?: string;
    lastBacktestPath?: number;
    lastBacktestWr?: number | null;
    lastBacktestSumR?: number | null;
    lastBacktestSumUsd?: number | null;
    /** Live paper (one-click book) — separate from BT seed but feeds same rates */
    paperTaken?: number;
    paperWins?: number;
    paperLosses?: number;
    paperSumR?: number;
    paperSumUsd?: number;
    lastPaperLabel?: string;
    lastPaperR?: number | null;
    lastPaperUsd?: number | null;
    openPaperCount?: number;
    updatedAt: number;
  };
  /** Rolling rates from backtests (and optional live) */
  rates: {
    byStrategy: Record<string, RateBucket>;
    byBand: Record<string, RateBucket>;
    bySide: Record<string, RateBucket>;
    bySymbol: Record<string, RateBucket>;
    gold: RateBucket;
    /** Last N fills for brain recall */
    recentFills: BacktestFillRecord[];
  };
  /**
   * Which draws this desk has already traded into, by `poolId`. The atlas is
   * the brain's copy of this (one node per pool, linked to `smc:draw`); the
   * atlas keeps only 40 unpinned nodes, so this ledger is the durable one and
   * `poolTaken` falls back to it.
   */
  pools?: Record<string, PoolRecord>;
}

/** One draw, and whether it has already been taken. */
export interface PoolRecord {
  /** `pool:<symbol>:<slug>` — the id the atlas node carries too. */
  id: string;
  symbol: string;
  /** The pool as the card named it: "PDH", "London low", "Asia high". */
  pool: string;
  price: number;
  /** True once price actually traded through it. */
  taken: boolean;
  /** ET date of the session that took it, or last looked at it. */
  date: string;
  /** The trade that targeted it: side and how it ended. */
  by: string;
  updatedAt: number;
}

const KEY = "ledger.desk.memory.v2";
const KEY_V1 = "ledger.desk.memory.v1";
const MAX_ITEMS = 120;
const MAX_FILLS = 200;

export function emptyBucket(): RateBucket {
  return { n: 0, wins: 0, sumR: 0 };
}

export function emptyDeskMemory(): DeskMemoryState {
  return empty();
}

function empty(): DeskMemoryState {
  return {
    version: 2,
    items: [],
    pins: [],
    book: {
      equity: 100_000,
      peakEquity: 100_000,
      startEquity: 100_000,
      pathTaken: 0,
      pathWins: 0,
      pathLosses: 0,
      sumR: 0,
      sumUsd: 0,
      updatedAt: Date.now(),
    },
    rates: {
      byStrategy: {},
      byBand: {},
      bySide: {},
      bySymbol: {},
      gold: emptyBucket(),
      recentFills: [],
    },
    pools: {},
  };
}

function mergeBucket(a: RateBucket, b: RateBucket): RateBucket {
  return {
    n: a.n + b.n,
    wins: a.wins + b.wins,
    sumR: Math.round((a.sumR + b.sumR) * 100) / 100,
  };
}

function bump(
  map: Record<string, RateBucket>,
  key: string,
  r: number,
): void {
  const k = key || "untagged";
  const cur = map[k] ?? emptyBucket();
  cur.n += 1;
  if (r > 0) cur.wins += 1;
  cur.sumR = Math.round((cur.sumR + r) * 100) / 100;
  map[k] = cur;
}

export function bucketWr(b: RateBucket | undefined): number | null {
  if (!b || b.n < 1) return null;
  return b.wins / b.n;
}

export function bucketExpectancy(b: RateBucket | undefined): number | null {
  if (!b || b.n < 1) return null;
  return b.sumR / b.n;
}

export function loadDeskMemory(): DeskMemoryState {
  if (typeof window === "undefined") return empty();
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) {
      // migrate v1
      const v1 = window.localStorage.getItem(KEY_V1);
      if (v1) {
        const old = JSON.parse(v1) as DeskMemoryState & { version?: number };
        const next = empty();
        next.pins = old.pins ?? [];
        next.items = old.items ?? [];
        next.book = { ...next.book, ...old.book, sumUsd: (old.book as { sumUsd?: number })?.sumUsd ?? 0 };
        saveDeskMemory(next);
        return next;
      }
      return empty();
    }
    const parsed = JSON.parse(raw) as DeskMemoryState;
    if (!parsed || !Array.isArray(parsed.items)) return empty();
    return {
      ...empty(),
      ...parsed,
      version: 2,
      book: {
        ...empty().book,
        ...parsed.book,
        peakEquity:
          (parsed.book as { peakEquity?: number }).peakEquity ??
          Math.max(parsed.book.equity ?? 100_000, 100_000),
        startEquity:
          (parsed.book as { startEquity?: number }).startEquity ?? 100_000,
        equity: parsed.book.equity > 0 ? parsed.book.equity : 100_000,
      },
      rates: {
        ...empty().rates,
        ...parsed.rates,
        byStrategy: { ...parsed.rates?.byStrategy },
        byBand: { ...parsed.rates?.byBand },
        bySide: { ...parsed.rates?.bySide },
        bySymbol: { ...parsed.rates?.bySymbol },
        gold: { ...emptyBucket(), ...parsed.rates?.gold },
        recentFills: parsed.rates?.recentFills ?? [],
      },
      pins: parsed.pins ?? [],
      items: parsed.items.slice(0, MAX_ITEMS),
    };
  } catch {
    return empty();
  }
}

export function saveDeskMemory(state: DeskMemoryState): void {
  if (typeof window === "undefined") return;
  try {
    const slim: DeskMemoryState = {
      ...state,
      version: 2,
      items: state.items.slice(0, MAX_ITEMS),
      pins: state.pins.slice(0, 20),
      rates: {
        ...state.rates,
        recentFills: state.rates.recentFills.slice(0, MAX_FILLS),
      },
    };
    window.localStorage.setItem(KEY, JSON.stringify(slim));
  } catch {
    /* quota */
  }
}

function uid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function remember(
  kind: MemoryKind,
  title: string,
  summary: string,
  tags: string[] = [],
  payload?: Record<string, unknown>,
): DeskMemoryState {
  const state = loadDeskMemory();
  const item: MemoryItem = {
    id: uid(),
    kind,
    ts: Date.now(),
    title,
    summary: summary.slice(0, 800),
    tags: tags.slice(0, 12),
    payload,
  };
  state.items = [item, ...state.items].slice(0, MAX_ITEMS);
  saveDeskMemory(state);
  return state;
}

export function pinNote(note: string): DeskMemoryState {
  const state = loadDeskMemory();
  const n = note.trim().slice(0, 280);
  if (!n) return state;
  state.pins = [n, ...state.pins.filter((p) => p !== n)].slice(0, 20);
  remember("note", "Pinned", n, ["pin"]);
  saveDeskMemory(state);
  return state;
}

export function clearPins(): DeskMemoryState {
  const state = loadDeskMemory();
  state.pins = [];
  saveDeskMemory(state);
  return state;
}

/** Ingest a completed backtest window into book + rates for the brain. */
export function ingestBacktestResult(opts: {
  label: string;
  fills: BacktestFillRecord[];
  processWins?: number;
  summary?: string;
}): DeskMemoryState {
  const state = loadDeskMemory();
  const fills = opts.fills.filter((f) => Number.isFinite(f.r));
  const taken = fills.length;
  const wins = fills.filter((f) => f.r > 0).length;
  const losses = taken - wins;
  const sumR = fills.reduce((s, f) => s + f.r, 0);
  const sumUsd = fills.reduce((s, f) => s + (f.usd || 0), 0);
  const wr = taken ? wins / taken : null;

  // A BACKTEST IS NOT THE BOOK. This used to add every run's fills and
  // dollars to `book` — including `book.equity`, which is the PAPER ACCOUNT
  // (paper-account.ts getPaperAccount) that sizes every new paper fill. So a
  // historical run showing +$8,157 grew the live paper size, re-running the
  // same week counted it twice, and the Lab header printed backtest win rates
  // as "Paper". The run now lands only in the last-backtest fields and the
  // per-strategy rates below, which is what the brain actually reads.
  void losses;
  state.book.lastBacktestLabel = opts.label;
  state.book.lastBacktestPath = taken;
  state.book.lastBacktestWr = wr;
  state.book.lastBacktestSumR = Math.round(sumR * 100) / 100;
  state.book.lastBacktestSumUsd = Math.round(sumUsd * 100) / 100;
  state.book.updatedAt = Date.now();

  for (const f of fills) {
    bump(state.rates.byStrategy, f.strategy, f.r);
    bump(state.rates.byBand, f.band || f.grade, f.r);
    bump(state.rates.bySide, f.side, f.r);
    bump(state.rates.bySymbol, f.symbol, f.r);
    const isGold =
      f.side === "short" &&
      (f.strategy === "mechanical" || f.strategy.includes("mech"));
    if (isGold) {
      state.rates.gold = mergeBucket(state.rates.gold, {
        n: 1,
        wins: f.r > 0 ? 1 : 0,
        sumR: f.r,
      });
    }
  }

  state.rates.recentFills = [...fills, ...state.rates.recentFills].slice(
    0,
    MAX_FILLS,
  );

  const stratLine = Object.entries(state.rates.byStrategy)
    .map(([k, b]) => {
      const w = b.n ? ((b.wins / b.n) * 100).toFixed(0) : "—";
      return `${k} ${b.n}t ${w}% ${b.sumR >= 0 ? "+" : ""}${b.sumR.toFixed(1)}R`;
    })
    .slice(0, 8)
    .join(" · ");

  remember(
    "backtest",
    opts.label,
    `PATH ${taken} · WR ${wr != null ? (wr * 100).toFixed(0) + "%" : "—"} · ${sumR >= 0 ? "+" : ""}${sumR.toFixed(2)}R · $${sumUsd.toFixed(0)}${opts.processWins != null ? ` · process skips ${opts.processWins}` : ""}`,
    ["backtest", "path", "rates"],
    {
      label: opts.label,
      taken,
      wins,
      losses,
      sumR,
      sumUsd,
      wr,
      byStrategy: { ...state.rates.byStrategy },
      stratLine,
    },
  );
  saveDeskMemory(state);
  return state;
}

/** @deprecated use ingestBacktestResult — kept for callers */
export function updateBookFromBacktest(opts: {
  label: string;
  taken: number;
  wins: number;
  losses: number;
  sumR: number;
  wr: number | null;
  fills?: BacktestFillRecord[];
  sumUsd?: number;
  processWins?: number;
}): DeskMemoryState {
  if (opts.fills?.length) {
    return ingestBacktestResult({
      label: opts.label,
      fills: opts.fills,
      processWins: opts.processWins,
    });
  }
  // Fallback: aggregate only — into the last-backtest fields, never the
  // book (see ingestBacktestResult).
  const state = loadDeskMemory();
  state.book.lastBacktestLabel = opts.label;
  state.book.lastBacktestPath = opts.taken;
  state.book.lastBacktestWr = opts.wr;
  state.book.lastBacktestSumR = opts.sumR;
  state.book.updatedAt = Date.now();
  remember(
    "backtest",
    opts.label,
    `PATH ${opts.taken} · WR ${opts.wr != null ? (opts.wr * 100).toFixed(0) + "%" : "—"} · ${opts.sumR >= 0 ? "+" : ""}${opts.sumR}R`,
    ["backtest", "path"],
    { ...opts },
  );
  saveDeskMemory(state);
  return state;
}

export function rememberLiveSetup(opts: {
  symbol: string;
  side: string;
  grade: string;
  score: number;
  mode: "paper" | "live" | "skip";
  note?: string;
  strategy?: string;
  r?: number;
}): DeskMemoryState {
  const state = remember(
    opts.mode === "skip" ? "discretion" : "live_setup",
    `${opts.mode.toUpperCase()} ${opts.symbol} ${opts.side}`,
    `${opts.grade} ${opts.score.toFixed(2)}${opts.note ? " · " + opts.note : ""}`,
    [opts.mode, opts.symbol, opts.side, opts.grade],
    opts,
  );
  // Closed live/paper with R updates rates
  if (opts.mode !== "skip" && opts.r != null && Number.isFinite(opts.r)) {
    const s = loadDeskMemory();
    bump(s.rates.byStrategy, opts.strategy || "live", opts.r);
    bump(s.rates.bySide, opts.side, opts.r);
    bump(s.rates.bySymbol, opts.symbol, opts.r);
    bump(s.rates.byBand, opts.grade, opts.r);
    s.book.pathTaken += 1;
    if (opts.r > 0) s.book.pathWins += 1;
    else s.book.pathLosses += 1;
    s.book.sumR = Math.round((s.book.sumR + opts.r) * 100) / 100;
    saveDeskMemory(s);
    return s;
  }
  return state;
}

/**
 * Ingest a closed paper trade into book + rates + memory tape.
 * Brain, synapse, and path rates all read this.
 * Equity: set applyEquity true unless applyPaperPnl already moved equity.
 */
export function ingestPaperFill(opts: {
  symbol: string;
  side: string;
  strategy?: string;
  band?: string;
  grade?: string;
  score?: number;
  r: number;
  usd: number;
  exit: string;
  entry?: number;
  exitPx?: number;
  reason?: string;
  /** When true (default), move book equity by usd */
  applyEquity?: boolean;
  /** Idempotency key from paper trade id */
  tradeId?: string;
}): DeskMemoryState {
  const state = loadDeskMemory();
  // Skip if this paper trade already ingested
  if (opts.tradeId) {
    const dup = state.rates.recentFills.some(
      (f) =>
        (f as { tradeId?: string }).tradeId === opts.tradeId ||
        (f.windowLabel === "paper-live" &&
          f.symbol === opts.symbol &&
          f.side === opts.side &&
          Math.abs(f.r - opts.r) < 0.001 &&
          Math.abs((f.usd || 0) - opts.usd) < 0.5),
    );
    const dupItem = state.items.some(
      (i) =>
        i.kind === "paper" &&
        (i.payload as { tradeId?: string } | undefined)?.tradeId === opts.tradeId,
    );
    if (dup || dupItem) return state;
  }
  const r = opts.r;
  const usd = opts.usd;
  const strategy = opts.strategy || "paper";
  const band = opts.band || opts.grade || "—";
  // Win/loss by NET dollars, matching analytics.ts (`t.pnl > 0`). Using gross
  // R meant a trade that cleared the stop but not the commission counted as a
  // WIN in the header chip / Risk tab and a LOSS in AnalyticsPanel.
  const win = usd != null && Number.isFinite(usd) ? usd > 0 : r > 0;

  state.book.pathTaken += 1;
  if (win) state.book.pathWins += 1;
  else state.book.pathLosses += 1;
  state.book.sumR = Math.round((state.book.sumR + r) * 100) / 100;
  state.book.sumUsd = Math.round((state.book.sumUsd + usd) * 100) / 100;
  state.book.paperTaken = (state.book.paperTaken ?? 0) + 1;
  state.book.paperWins = (state.book.paperWins ?? 0) + (win ? 1 : 0);
  state.book.paperLosses = (state.book.paperLosses ?? 0) + (win ? 0 : 1);
  state.book.paperSumR =
    Math.round(((state.book.paperSumR ?? 0) + r) * 100) / 100;
  state.book.paperSumUsd =
    Math.round(((state.book.paperSumUsd ?? 0) + usd) * 100) / 100;
  state.book.lastPaperLabel = `${opts.symbol} ${opts.side} ${opts.reason || opts.exit}`;
  state.book.lastPaperR = Math.round(r * 1000) / 1000;
  state.book.lastPaperUsd = Math.round(usd * 100) / 100;

  if (opts.applyEquity !== false) {
    if (!state.book.startEquity) state.book.startEquity = 100_000;
    if (!state.book.equity || state.book.equity < 100) state.book.equity = 100_000;
    if (!state.book.peakEquity) state.book.peakEquity = state.book.equity;
    state.book.equity =
      Math.round((state.book.equity + usd) * 100) / 100;
    state.book.equity = Math.max(100, state.book.equity);
    state.book.peakEquity = Math.max(state.book.peakEquity, state.book.equity);
  }
  state.book.updatedAt = Date.now();

  bump(state.rates.byStrategy, strategy, r);
  bump(state.rates.byBand, band, r);
  bump(state.rates.bySide, opts.side, r);
  bump(state.rates.bySymbol, opts.symbol, r);
  if (
    opts.side === "short" &&
    (strategy === "mechanical" || strategy.includes("mech"))
  ) {
    state.rates.gold = mergeBucket(state.rates.gold, {
      n: 1,
      wins: win ? 1 : 0,
      sumR: r,
    });
  }

  const fill: BacktestFillRecord & { tradeId?: string } = {
    date: new Date().toISOString().slice(0, 10),
    symbol: opts.symbol,
    side: opts.side,
    strategy,
    band,
    grade: opts.grade || band,
    score: opts.score ?? 0,
    r,
    usd,
    exit: opts.reason || opts.exit,
    windowLabel: "paper-live",
    tradeId: opts.tradeId,
  };
  state.rates.recentFills = [fill, ...state.rates.recentFills].slice(
    0,
    MAX_FILLS,
  );

  const item: MemoryItem = {
    id: uid(),
    kind: "paper",
    ts: Date.now(),
    title: `PAPER ${opts.symbol} ${opts.side.toUpperCase()} ${win ? "WIN" : "LOSS"}`,
    summary: `${r >= 0 ? "+" : ""}${r.toFixed(2)}R · $${usd.toFixed(0)} · ${opts.reason || opts.exit}${opts.entry != null && opts.exitPx != null ? ` · ${opts.entry}→${opts.exitPx}` : ""} · ${strategy}`,
    tags: ["paper", opts.symbol, opts.side, strategy, band, win ? "win" : "loss"],
    payload: { ...opts, fill },
  };
  state.items = [item, ...state.items].slice(0, MAX_ITEMS);
  saveDeskMemory(state);
  return state;
}

/** Remember a paper entry so brain sees open risk. */
export function rememberPaperOpen(opts: {
  symbol: string;
  side: string;
  strategy?: string;
  grade?: string;
  band?: string;
  score?: number;
  entry: number;
  stop: number;
  tp1: number;
  tp2?: number;
  contracts: number;
  riskPts: number;
}): DeskMemoryState {
  const state = loadDeskMemory();
  state.book.openPaperCount = (state.book.openPaperCount ?? 0) + 1;
  state.book.updatedAt = Date.now();
  const item: MemoryItem = {
    id: uid(),
    kind: "paper_open",
    ts: Date.now(),
    title: `PAPER IN ${opts.symbol} ${opts.side.toUpperCase()}`,
    summary: `${opts.contracts}ct @ ${opts.entry} · SL ${opts.stop} · TP1 ${opts.tp1}${opts.tp2 != null ? ` · TP2 ${opts.tp2}` : ""} · ${opts.strategy || "—"} · ${opts.grade || opts.band || ""}`,
    tags: ["paper", "open", opts.symbol, opts.side, opts.strategy || ""],
    payload: { ...opts },
  };
  state.items = [item, ...state.items].slice(0, MAX_ITEMS);
  saveDeskMemory(state);
  return state;
}

export function setOpenPaperCount(n: number): void {
  const state = loadDeskMemory();
  state.book.openPaperCount = Math.max(0, n);
  state.book.updatedAt = Date.now();
  saveDeskMemory(state);
}

export function recentByKind(kind: MemoryKind, n = 8): MemoryItem[] {
  return loadDeskMemory().items.filter((i) => i.kind === kind).slice(0, n);
}

export function memoryDigest(state?: DeskMemoryState): string {
  const s = state ?? loadDeskMemory();
  const wr =
    s.book.pathTaken > 0
      ? ((s.book.pathWins / s.book.pathTaken) * 100).toFixed(0) + "%"
      : "—";
  const lastBt = s.book.lastBacktestLabel
    ? `Last BT ${s.book.lastBacktestLabel}: ${s.book.lastBacktestPath ?? 0} PATH · ${s.book.lastBacktestWr != null ? (s.book.lastBacktestWr * 100).toFixed(0) + "%" : "—"} WR · ${s.book.lastBacktestSumR ?? 0}R`
    : "No backtest in memory yet";
  const topStrat = Object.entries(s.rates.byStrategy)
    .filter(([, b]) => b.n >= 2)
    .sort((a, b) => b[1].n - a[1].n)
    .slice(0, 3)
    .map(([k, b]) => `${k} ${(bucketWr(b)! * 100).toFixed(0)}%/${b.n}`)
    .join(" · ");
  const pins = s.pins.length ? `Pins: ${s.pins.join(" | ")}` : "No pins";
  const paperLine =
    (s.book.paperTaken ?? 0) > 0
      ? `Live paper ${s.book.paperTaken} · WR ${
          s.book.paperTaken
            ? ((((s.book.paperWins ?? 0) / s.book.paperTaken) * 100).toFixed(0) + "%")
            : "—"
        } · ΣR ${s.book.paperSumR ?? 0} · last ${s.book.lastPaperLabel ?? "—"} ${s.book.lastPaperR != null ? s.book.lastPaperR + "R" : ""}`
      : "No live paper fills yet";
  const openN = s.book.openPaperCount ?? 0;
  return [
    `Paper $${Math.round(s.book.equity).toLocaleString()} · PATH ${s.book.pathTaken} · WR ${wr} · Σ ${s.book.sumR >= 0 ? "+" : ""}${s.book.sumR}R · PnL $${s.book.sumUsd.toFixed(0)}`,
    paperLine + (openN ? ` · OPEN ${openN}` : ""),
    lastBt,
    topStrat ? `Rates ${topStrat}` : "Rates empty — run a backtest",
    pins,
  ].join(" · ");
}

/** Live setup rate card for brain / UI */
export function rateCardForSetup(
  state: DeskMemoryState,
  opts: {
    strategy?: string;
    side?: string;
    band?: string;
    symbol?: string;
  },
): {
  strategy: RateBucket | null;
  side: RateBucket | null;
  band: RateBucket | null;
  symbol: RateBucket | null;
  gold: RateBucket;
  bookWr: number | null;
  advice: string[];
  sizeBias: number; // 0.5–1.25 mult suggestion
} {
  const strat = opts.strategy
    ? state.rates.byStrategy[opts.strategy] ?? null
    : null;
  const side = opts.side ? state.rates.bySide[opts.side] ?? null : null;
  const band = opts.band ? state.rates.byBand[opts.band] ?? null : null;
  const symbol = opts.symbol
    ? state.rates.bySymbol[opts.symbol] ?? null
    : null;
  const advice: string[] = [];
  let sizeBias = 1;

  const swr = bucketWr(strat ?? undefined);
  const sexp = bucketExpectancy(strat ?? undefined);
  if (strat && strat.n >= 5 && swr != null) {
    if (swr < 0.45 || (sexp != null && sexp < -0.15)) {
      advice.push(
        `${opts.strategy} cold in BT (${(swr * 100).toFixed(0)}% / ${strat.n}t ${sexp?.toFixed(2)}R) — REDUCE or skip`,
      );
      sizeBias = Math.min(sizeBias, 0.5);
    } else if (swr >= 0.65 && sexp != null && sexp > 0.15) {
      advice.push(
        `${opts.strategy} strong in BT (${(swr * 100).toFixed(0)}% / ${strat.n}t) — favor`,
      );
      sizeBias = Math.max(sizeBias, 1.1);
    }
  } else if (opts.strategy) {
    advice.push(`${opts.strategy}: thin BT sample — keep standard size`);
  }

  const sideWr = bucketWr(side ?? undefined);
  if (side && side.n >= 5 && sideWr != null) {
    if (sideWr < 0.45) {
      advice.push(`${opts.side} side weak in BT (${(sideWr * 100).toFixed(0)}%)`);
      sizeBias = Math.min(sizeBias, 0.75);
    } else if (sideWr >= 0.6) {
      advice.push(`${opts.side} side OK in BT (${(sideWr * 100).toFixed(0)}%)`);
    }
  }

  const bandWr = bucketWr(band ?? undefined);
  if (band && band.n >= 5 && bandWr != null && bandWr < 0.5) {
    advice.push(`Band ${opts.band} BT WR ${(bandWr * 100).toFixed(0)}% — selective`);
    sizeBias = Math.min(sizeBias, 0.75);
  }

  const bookWr =
    state.book.pathTaken >= 3
      ? state.book.pathWins / state.book.pathTaken
      : null;
  if (bookWr != null && bookWr < 0.5 && state.book.pathTaken >= 8) {
    advice.push("Book cold — A+/gold only preference");
    sizeBias = Math.min(sizeBias, 0.5);
  }

  return {
    strategy: strat,
    side,
    band,
    symbol,
    gold: state.rates.gold,
    bookWr,
    advice,
    sizeBias,
  };
}

export function topStrategyRates(
  state?: DeskMemoryState,
  minN = 2,
): { id: string; n: number; wr: number; expR: number; sumR: number }[] {
  const s = state ?? loadDeskMemory();
  return Object.entries(s.rates.byStrategy)
    .filter(([, b]) => b.n >= minN)
    .map(([id, b]) => ({
      id,
      n: b.n,
      wr: b.wins / b.n,
      expR: b.sumR / b.n,
      sumR: b.sumR,
    }))
    .sort((a, b) => b.n - a.n || b.wr - a.wr);
}

/* ------------------------------------------------------------------ *
 * The session the brain can read back.
 *
 * `now:wire` is a pinned atlas node that SAYS the wire exists. Nothing ever
 * wrote the other end of it: a trade closed, `ingestPaperFill` moved the book
 * and the rates, `absorbAtlas` wrote one line titled "Close <id>" — and the
 * raid that armed it, the array the displacement left, the fill, the partial
 * and the exit were never stored anywhere the next session reads. So the next
 * open could not see that the draw it is about to target had already been
 * taken, which is the desk's own rule ("A pool or a gap that already traded is
 * spent. No second entry in the same leg." — smc:draw).
 *
 * What follows writes that story as an atlas node LINKED to the draw, plus one
 * node per draw that says whether the pool was taken, and a durable ledger in
 * this module's own state because the atlas keeps only 40 unpinned nodes.
 *
 * Idempotent on purpose: writing the same story twice must not move a node's
 * `at`, because after the mergeAtlas fix `at` means "when this line last
 * changed" (scripts/verify-brain-nerve.mjs).
 * ------------------------------------------------------------------ */

/** The raid, the array, the fill, the partial, the exit, and the draw it aimed at. */
export interface SessionTradeStory {
  /** ET trade date, "YYYY-MM-DD". */
  date: string;
  symbol: string;
  side: "long" | "short";
  strategy?: string;
  band?: string;
  /** The pool the raid took. A buyside raid arms a short; a sellside raid arms a long. */
  raid: { pool: string; price: number };
  /** The array that displacement LEFT, and where the limit rested (its CE). */
  array: { kind: string; price: number };
  /** The fill, or null when the limit was never touched. */
  fill: { price: number } | null;
  /** The partial at T1, or null when T1 never printed. */
  partial: { price: number; r: number } | null;
  /** How it ended, or null while it is still open. */
  exit: { price: number; reason: string; r: number; usd?: number } | null;
  /** The draw the plan targeted. */
  draw: { pool: string; price: number };
  /** True when price actually traded through the draw. */
  drawTaken: boolean;
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24) || "pool";
}

/** `pool:<symbol>:<slug>` — one id for the atlas node and the ledger row. */
export function poolId(symbol: string, pool: string): string {
  return `pool:${slug(symbol)}:${slug(pool)}`;
}

/** `backtest:trade:<date>:<symbol>:<side>:<draw>` — one node per closed trade. */
export function sessionTradeNodeId(story: SessionTradeStory): string {
  return `backtest:trade:${story.date}:${slug(story.symbol)}:${story.side}:${slug(story.draw.pool)}`;
}

const px = (n: number): string => (Number.isFinite(n) ? String(Math.round(n * 100) / 100) : "?");

/** The sentence the brain says back. Every number comes from the story. */
export function sessionTradeLine(story: SessionTradeStory): string {
  const raidSide = story.side === "short" ? "buyside" : "sellside";
  const parts = [
    `${story.symbol} ${story.side} ${story.date}: the ${raidSide} raid took ${story.raid.pool} at ${px(story.raid.price)}`,
    `displacement left the ${story.array.kind} at ${px(story.array.price)}`,
    story.fill ? `filled ${px(story.fill.price)}` : "never filled",
  ];
  if (story.partial) parts.push(`half off at ${px(story.partial.price)} for ${story.partial.r >= 0 ? "+" : ""}${story.partial.r.toFixed(2)}R`);
  else if (story.fill) parts.push("no partial");
  if (story.exit) {
    parts.push(
      `out ${px(story.exit.price)} on ${story.exit.reason} for ${story.exit.r >= 0 ? "+" : ""}${story.exit.r.toFixed(2)}R`,
    );
  }
  parts.push(
    story.drawTaken
      ? `the draw ${story.draw.pool} ${px(story.draw.price)} TRADED — that pool is spent`
      : `the draw ${story.draw.pool} ${px(story.draw.price)} is still open`,
  );
  return `${parts.join(". ")}.`;
}

/** What the draw node says once a session has looked at it. */
export function poolLine(story: SessionTradeStory): string {
  return story.drawTaken
    ? `${story.symbol} ${story.draw.pool} at ${px(story.draw.price)} was TAKEN on ${story.date} by the ${story.side}. Spent: no second entry in the same leg.`
    : `${story.symbol} ${story.draw.pool} at ${px(story.draw.price)} is still open. The ${story.side} of ${story.date} aimed at it and did not reach it.`;
}

/**
 * The nodes and edges one closed trade adds. Pure — no atlas, no storage.
 * The trade node hangs off `smc:draw` (the desk's own rule about spent pools)
 * and off its own draw node, so `neighborsOf` walks from the rule to the pool
 * to the trade.
 */
export function sessionTradeNodes(
  story: SessionTradeStory,
  nowMs: number,
): { nodes: AtlasNode[]; edges: AtlasEdge[] } {
  const tradeId = sessionTradeNodeId(story);
  const drawId = poolId(story.symbol, story.draw.pool);
  const won = (story.exit?.r ?? 0) > 0;
  const trade: AtlasNode = {
    id: tradeId,
    shelf: "backtest",
    title: `${story.symbol} ${story.side} ${story.date}`,
    text: sessionTradeLine(story),
    who: "Sterling",
    at: nowMs,
    // A session that happened is a fact, not a teaching. It starts mid and is
    // graded by whoever reads it back, like every other unpinned line.
    confidence: 55,
    n: 1,
    pinned: false,
    tags: [
      "session",
      "closed",
      slug(story.symbol),
      story.side,
      slug(story.raid.pool),
      slug(story.draw.pool),
      ...(story.strategy ? [slug(story.strategy)] : []),
      ...(story.exit ? [won ? "win" : "loss"] : []),
    ].slice(0, 12),
    prior: [],
  };
  const draw: AtlasNode = {
    id: drawId,
    shelf: "market",
    title: `${story.symbol} ${story.draw.pool}`,
    text: poolLine(story),
    who: "Gemma",
    at: nowMs,
    confidence: story.drawTaken ? 80 : 60,
    n: 1,
    pinned: false,
    tags: ["pool", "draw", slug(story.symbol), slug(story.draw.pool), story.drawTaken ? "taken" : "open"],
    prior: [],
  };
  return {
    nodes: [trade, draw],
    edges: [
      { from: tradeId, to: drawId, why: "the draw this trade targeted" },
      { from: drawId, to: "smc:draw", why: "a pool that already traded is spent" },
    ],
  };
}

/**
 * Add a closed trade to an atlas. Pure and idempotent: the same story written
 * twice returns the SAME atlas object, so no node's `at` moves and the people's
 * "what changed" map stays honest.
 */
export function applySessionTrade(
  atlas: DeskAtlas,
  story: SessionTradeStory,
  nowMs: number,
): DeskAtlas {
  const { nodes, edges } = sessionTradeNodes(story, nowMs);
  let changed = false;
  const byId = new Map(atlas.nodes.map((n) => [n.id, n]));
  for (const fresh of nodes) {
    const cur = byId.get(fresh.id);
    if (!cur) {
      byId.set(fresh.id, fresh);
      changed = true;
      continue;
    }
    if (cur.text === fresh.text) continue; // nothing changed: keep its time
    byId.set(fresh.id, {
      ...cur,
      text: fresh.text,
      who: fresh.who,
      tags: fresh.tags,
      at: nowMs,
      n: cur.n + 1,
      confidence: fresh.confidence,
      prior: [{ at: cur.at, text: cur.text }, ...cur.prior].slice(0, 5),
    });
    changed = true;
  }
  const edgeKey = (e: AtlasEdge) => `${e.from}>${e.to}`;
  const edgeMap = new Map(atlas.edges.map((e) => [edgeKey(e), e]));
  for (const e of edges) {
    if (!edgeMap.has(edgeKey(e))) {
      edgeMap.set(edgeKey(e), e);
      changed = true;
    }
  }
  if (!changed) return atlas;
  return { ...atlas, updatedAt: nowMs, nodes: [...byId.values()], edges: [...edgeMap.values()] };
}

export interface PoolRead {
  id: string;
  taken: boolean;
  /** The line the brain says. null when this desk has never looked at the pool. */
  text: string | null;
  /** Where the answer came from. */
  from: "atlas" | "ledger" | "unknown";
}

/**
 * Has this draw already been taken? The question the next session asks.
 * The atlas answers first (it is the brain's copy and can be graded); the
 * module's own ledger answers when the atlas has evicted the node.
 */
export function poolTaken(
  symbol: string,
  pool: string,
  opts?: { atlas?: DeskAtlas | null; state?: DeskMemoryState },
): PoolRead {
  const id = poolId(symbol, pool);
  const node = opts?.atlas?.nodes.find((n) => n.id === id) ?? null;
  if (node) return { id, taken: node.tags.includes("taken"), text: node.text, from: "atlas" };
  const row = (opts?.state ?? loadDeskMemory()).pools?.[id];
  if (row) {
    return {
      id,
      taken: row.taken,
      text: `${row.symbol} ${row.pool} at ${px(row.price)} ${row.taken ? "was TAKEN" : "is still open"} — ${row.date}, ${row.by}.`,
      from: "ledger",
    };
  }
  return { id, taken: false, text: null, from: "unknown" };
}

/** Every draw this desk has a record of, newest first. */
export function poolLedger(state?: DeskMemoryState): PoolRecord[] {
  const s = state ?? loadDeskMemory();
  return Object.values(s.pools ?? {}).sort((a, b) => b.updatedAt - a.updatedAt);
}

/**
 * Write a closed trade into the atlas, the pool ledger and the memory tape.
 * The one call the paper manager / room exit path makes when a trade ends.
 * Side-effectful (localStorage) — the pure parts above are what the verifier
 * drives.
 */
export function rememberSessionTrade(
  story: SessionTradeStory,
  nowMs = Date.now(),
): { state: DeskMemoryState; atlas: DeskAtlas } {
  const atlas = applySessionTrade(mergeAtlas(loadAtlas(), null, nowMs), story, nowMs);
  saveAtlas(atlas);

  const state = loadDeskMemory();
  const id = poolId(story.symbol, story.draw.pool);
  const pools = { ...(state.pools ?? {}) };
  const by = `${story.side} ${story.strategy ?? "desk"}${story.exit ? ` out on ${story.exit.reason}` : ""}`;
  const prior = pools[id];
  // A pool stays taken once it has been taken: a later session that did not
  // reach it does not un-spend it.
  pools[id] = {
    id,
    symbol: story.symbol,
    pool: story.draw.pool,
    price: story.draw.price,
    taken: story.drawTaken || !!prior?.taken,
    date: story.drawTaken || !prior ? story.date : prior.date,
    by: story.drawTaken || !prior ? by : prior.by,
    updatedAt: nowMs,
  };
  state.pools = pools;

  const dup = state.items.some(
    (i) => i.kind === "session" && (i.payload as { nodeId?: string } | undefined)?.nodeId === sessionTradeNodeId(story),
  );
  if (!dup) {
    const item: MemoryItem = {
      id: uid(),
      kind: "session",
      ts: nowMs,
      title: `SESSION ${story.symbol} ${story.side.toUpperCase()} ${story.date}`,
      summary: sessionTradeLine(story).slice(0, 800),
      tags: ["session", story.symbol, story.side, slug(story.draw.pool), story.drawTaken ? "draw-taken" : "draw-open"],
      payload: { nodeId: sessionTradeNodeId(story), story },
    };
    state.items = [item, ...state.items].slice(0, MAX_ITEMS);
  }
  saveDeskMemory(state);
  return { state, atlas };
}
