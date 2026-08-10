/**
 * Persistent desk memory (browser localStorage).
 * Survives refreshes so the veteran brain can recall backtests, journals, and decisions.
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
  /** Structured tags for recall */
  tags: string[];
  payload?: Record<string, unknown>;
}

export interface DeskMemoryState {
  version: 1;
  items: MemoryItem[];
  /** Free-form notes the trader pinned for the brain */
  pins: string[];
  /** Rolling paper book stats the brain trusts */
  book: {
    equity: number;
    pathTaken: number;
    pathWins: number;
    pathLosses: number;
    sumR: number;
    lastBacktestLabel?: string;
    lastBacktestPath?: number;
    lastBacktestWr?: number | null;
    lastBacktestSumR?: number | null;
    updatedAt: number;
  };
}

const KEY = "ledger.desk.memory.v1";
const MAX_ITEMS = 120;

function empty(): DeskMemoryState {
  return {
    version: 1,
    items: [],
    pins: [],
    book: {
      equity: 100_000,
      pathTaken: 0,
      pathWins: 0,
      pathLosses: 0,
      sumR: 0,
      updatedAt: Date.now(),
    },
  };
}

export function loadDeskMemory(): DeskMemoryState {
  if (typeof window === "undefined") return empty();
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return empty();
    const parsed = JSON.parse(raw) as DeskMemoryState;
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.items)) {
      return empty();
    }
    return {
      ...empty(),
      ...parsed,
      book: { ...empty().book, ...parsed.book },
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
      items: state.items.slice(0, MAX_ITEMS),
      pins: state.pins.slice(0, 20),
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

export function updateBookFromBacktest(opts: {
  label: string;
  taken: number;
  wins: number;
  losses: number;
  sumR: number;
  wr: number | null;
}): DeskMemoryState {
  const state = loadDeskMemory();
  state.book.pathTaken += opts.taken;
  state.book.pathWins += opts.wins;
  state.book.pathLosses += opts.losses;
  state.book.sumR = Math.round((state.book.sumR + opts.sumR) * 100) / 100;
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
}): DeskMemoryState {
  return remember(
    opts.mode === "skip" ? "discretion" : "live_setup",
    `${opts.mode.toUpperCase()} ${opts.symbol} ${opts.side}`,
    `${opts.grade} ${opts.score.toFixed(2)}${opts.note ? " · " + opts.note : ""}`,
    [opts.mode, opts.symbol, opts.side, opts.grade],
    opts,
  );
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
  const pins = s.pins.length ? `Pins: ${s.pins.join(" | ")}` : "No pins";
  return [
    `Book PATH ${s.book.pathTaken} · WR ${wr} · Σ ${s.book.sumR >= 0 ? "+" : ""}${s.book.sumR}R · equity $${s.book.equity.toLocaleString()}`,
    lastBt,
    pins,
  ].join(" · ");
}
