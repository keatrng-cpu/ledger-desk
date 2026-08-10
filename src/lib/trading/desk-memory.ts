/**
 * Persistent desk memory (browser localStorage).
 * Backtest fills feed strategy/band/side rates the veteran brain uses live.
 */

export type MemoryKind =
  | "backtest"
  | "journal"
  | "live_setup"
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
}

const KEY = "ledger.desk.memory.v2";
const KEY_V1 = "ledger.desk.memory.v1";
const MAX_ITEMS = 120;
const MAX_FILLS = 200;

export function emptyBucket(): RateBucket {
  return { n: 0, wins: 0, sumR: 0 };
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
    let raw = window.localStorage.getItem(KEY);
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

  state.book.pathTaken += taken;
  state.book.pathWins += wins;
  state.book.pathLosses += losses;
  state.book.sumR = Math.round((state.book.sumR + sumR) * 100) / 100;
  state.book.sumUsd = Math.round((state.book.sumUsd + sumUsd) * 100) / 100;
  // Equity actually moves with paper PnL and holds in localStorage
  if (!state.book.startEquity) state.book.startEquity = 100_000;
  if (!state.book.equity || state.book.equity < 100) state.book.equity = 100_000;
  if (!state.book.peakEquity) state.book.peakEquity = state.book.equity;
  state.book.equity =
    Math.round((state.book.equity + sumUsd) * 100) / 100;
  state.book.equity = Math.max(100, state.book.equity);
  state.book.peakEquity = Math.max(state.book.peakEquity, state.book.equity);
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
  // Fallback: aggregate only
  const state = loadDeskMemory();
  state.book.pathTaken += opts.taken;
  state.book.pathWins += opts.wins;
  state.book.pathLosses += opts.losses;
  state.book.sumR = Math.round((state.book.sumR + opts.sumR) * 100) / 100;
  if (opts.sumUsd != null) {
    state.book.sumUsd = Math.round((state.book.sumUsd + opts.sumUsd) * 100) / 100;
  }
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
  return [
    `Paper $${Math.round(s.book.equity).toLocaleString()} · PATH ${s.book.pathTaken} · WR ${wr} · Σ ${s.book.sumR >= 0 ? "+" : ""}${s.book.sumR}R · PnL $${s.book.sumUsd.toFixed(0)}`,
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
