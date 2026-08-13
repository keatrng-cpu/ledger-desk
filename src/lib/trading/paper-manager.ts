/**
 * One-click paper trading + auto management from live desk prices.
 * No auth required — localStorage book. Optional server journal when logged in.
 *
 * System rules:
 * - Entry at zone mid (key area)
 * - Stop from invalidation, clamped to day-trade max risk
 * - Target ≥ 1R (prefer structure target if valid)
 * - Size from grade × paper equity (micros)
 * - Scale-out: 50% @ +1R → BE, runner @ +2R / TP2
 * - Exit when live print hits stop / targets
 * - Time / context stops + dynamic targets from the draw (trading/management.ts)
 * - One book per day — MNQ or ES, never both (profit-rules.ts rule 1)
 */

import {
  APLUS_RULES,
  CONTRACTS,
  sizeContracts,
  type ContractKey,
  type RiskGrade,
} from "@/lib/aplus/config";
import { tradingDayStart } from "@/lib/journal/risk";
import type { SetupCandidate } from "./scanner";
import { getPaperAccount, PAPER_START_EQUITY } from "./paper-account";
import {
  ingestPaperFill,
  rememberPaperOpen,
  setOpenPaperCount,
} from "./desk-memory";
import { MAX_RISK_PTS } from "./simulate-path-trade";
import type { DrawRead } from "./draw";
import type { NewsEvent } from "./news";
import { getSessionClock } from "./sessions";
import { PROGRESS_R, retarget, shouldFlatten } from "./management";


const STORAGE_KEY = "ledger-paper-trades-v1";

/**
 * The BOOK a symbol belongs to. MNQ and NQ are one book, MES and ES another —
 * the micro is the same instrument at 1/10th the multiplier, so holding both
 * is not diversification. Used by the one-book-per-day rule.
 */
export function bookRoot(symbol: string): string {
  return symbol.replace(/^M(?=NQ$|ES$)/, "");
}

export type PaperStatus = "open" | "closed";

export interface PaperTrade {
  id: string;
  symbol: ContractKey;
  displaySymbol: string;
  side: "long" | "short";
  status: PaperStatus;
  entry: number;
  stop: number;
  /** Working stop (moves to BE after TP1) */
  workingStop: number;
  tp1: number;
  tp2: number;
  contracts: number;
  contractsOpen: number;
  riskPts: number;
  riskPct: number;
  riskDollars: number;
  grade: string;
  score: number;
  strategy: string;
  openedAt: number;
  closedAt?: number;
  exit?: number;
  exitReason?: string;
  rMultiple?: number;
  pnlUsd?: number;
  scaleLegs: { at: string; price: number; contracts: number; r: number; note: string }[];
  reason: string;
  pathBand?: string;
  /** Already pushed into desk-memory brain rates */
  ingested?: boolean;
  /**
   * Killzone id at entry — read by the time stop (management.ts) to know when
   * the window the idea was taken in has closed. Optional: records written
   * before Phase B simply skip that rule.
   */
  killzone?: string;
  /**
   * Discretion multiplier actually applied to size at open (journal/discretion.ts).
   * 1.0 (or absent, for records logged before this existed) means neutral —
   * no measured-history adjustment. Recorded for audit: "why was this sized
   * at 0.75x" should always be answerable from the trade itself.
   */
  discretionFactor?: number;
  /**
   * Max favourable excursion so far, in R. A PRICE ratio used only by the
   * no-progress time stop — NOT the booked R, which is net of commission
   * (see finalizeClose).
   */
  mfeR?: number;
  /**
   * Latest management note — a re-target or the time/context stop that closed
   * the trade. Kept off `reason` (which is the entry thesis as mirrored to
   * desk_trades) so neither field grows without bound.
   */
  manageNote?: string;
}

function parseNums(text: string | undefined | null): number[] {
  if (!text) return [];
  return [...text.matchAll(/(\d{3,7}(?:\.\d+)?)/g)]
    .map((m) => Number(m[1]))
    .filter((n) => Number.isFinite(n) && n > 0);
}

function zoneMid(entryZone: string): number | null {
  const nums = parseNums(entryZone);
  if (nums.length >= 2) return (nums[0]! + nums[1]!) / 2;
  if (nums.length === 1) return nums[0]!;
  return null;
}

function firstPrice(s: string | undefined): number | null {
  const n = parseNums(s)[0];
  return n ?? null;
}

function tickRound(symbol: string, px: number): number {
  const key = (symbol in CONTRACTS ? symbol : "MNQ") as ContractKey;
  const tick = CONTRACTS[key]?.tick ?? 0.25;
  return Math.round(px / tick) * tick;
}

function resolveContractSymbol(symbol: string): ContractKey {
  const key = (symbol in CONTRACTS ? symbol : "MNQ") as ContractKey;
  if (APLUS_RULES.useMicros) {
    const micro = CONTRACTS[key].micro as ContractKey;
    if (micro in CONTRACTS) return micro;
  }
  return key;
}

export interface BuiltPaperLevels {
  symbol: ContractKey;
  displaySymbol: string;
  side: "long" | "short";
  entry: number;
  stop: number;
  tp1: number;
  tp2: number;
  riskPts: number;
  contracts: number;
  riskPct: number;
  riskDollars: number;
  grade: RiskGrade | string;
  /** Discretion multiplier actually applied to size (journal/discretion.ts). 1.0 = neutral / none supplied. */
  discretionFactor: number;
}

/**
 * Build correct key-area levels + contract size from a scanner setup.
 *
 * `discretionMult` — real measured-edge sizing multiplier from
 * journal/discretion.ts, keyed by the caller to this candidate's strategy
 * and fetched server-side (getDiscretionState). Optional and defaults to
 * neutral (1.0) so every existing caller keeps its current behavior until
 * it is explicitly wired up.
 */
export function buildPaperLevels(
  c: SetupCandidate,
  equity?: number,
  lastPrice?: number,
  discretionMult?: number,
): BuiltPaperLevels {
  const displaySymbol = c.symbol;
  const symbol = resolveContractSymbol(c.symbol);
  const side = c.side;
  const eq = equity ?? getPaperAccount().equity ?? PAPER_START_EQUITY;

  let entry =
    zoneMid(c.entryZone) ??
    firstPrice(c.entryZone) ??
    lastPrice ??
    0;

  // Prefer live mid if zone is far from last print (stale array)
  if (lastPrice != null && entry > 0) {
    const dist = Math.abs(entry - lastPrice);
    const maxRisk = MAX_RISK_PTS[c.symbol] ?? MAX_RISK_PTS[symbol] ?? 48;
    if (dist > maxRisk * 1.5) {
      entry = lastPrice; // enter at market / key print near array
    }
  }

  const inv = firstPrice(c.invalidation);
  const maxRisk =
    MAX_RISK_PTS[c.symbol] ?? MAX_RISK_PTS[symbol] ?? DEFAULT_MAX(symbol);

  let stop: number;
  if (inv != null) {
    stop =
      side === "long"
        ? Math.min(inv, entry - entry * 0.0004)
        : Math.max(inv, entry + entry * 0.0004);
  } else {
    const pad = Math.min(maxRisk * 0.5, entry * 0.001);
    stop = side === "long" ? entry - pad : entry + pad;
  }

  let riskPts = Math.abs(entry - stop);
  if (riskPts < entry * 0.0004) {
    riskPts = Math.max(maxRisk * 0.25, entry * 0.0006);
    stop = side === "long" ? entry - riskPts : entry + riskPts;
  }
  if (riskPts > maxRisk) {
    riskPts = maxRisk;
    stop = side === "long" ? entry - riskPts : entry + riskPts;
  }

  // Targets: ALWAYS honor structure TP when on correct side of entry.
  // Old 0.9R gate dropped user TPs like 7770 (~0.8R) and left synthetic 7767 —
  // so live never "took" the planned target.
  const allTps = (c.targets || [])
    .flatMap((s) => parseNums(s))
    .filter((n) => Number.isFinite(n) && n > 0);
  const below = allTps.filter((n) => n < entry).sort((a, b) => b - a); // near → deep
  const above = allTps.filter((n) => n > entry).sort((a, b) => a - b);
  // Short: TP1 = nearest target below entry; TP2 = deepest (session low)
  // Long: TP1 = nearest above; TP2 = highest
  const t1raw =
    side === "short"
      ? (below[0] ?? firstPrice(c.targets[0]))
      : (above[0] ?? firstPrice(c.targets[0]));
  const t2raw =
    side === "short"
      ? (below[below.length - 1] ?? firstPrice(c.targets[1]))
      : (above[above.length - 1] ?? firstPrice(c.targets[1]));
  let tp1 = side === "long" ? entry + riskPts : entry - riskPts;
  let tp2 = side === "long" ? entry + riskPts * 2 : entry - riskPts * 2;

  if (t1raw != null) {
    const ok = side === "long" ? t1raw > entry : t1raw < entry;
    const r = Math.abs(t1raw - entry) / Math.max(riskPts, 1e-6);
    // Accept any correct-side target from 0.35R up to tpMaxR (user plan wins)
    if (ok && r >= 0.35 && r <= APLUS_RULES.tpMaxR + 0.25) {
      tp1 = t1raw;
    }
  }
  if (t2raw != null) {
    const ok = side === "long" ? t2raw > entry : t2raw < entry;
    const r = Math.abs(t2raw - entry) / Math.max(riskPts, 1e-6);
    if (
      ok &&
      r > Math.abs(tp1 - entry) / Math.max(riskPts, 1e-6) * 0.95 &&
      r <= APLUS_RULES.tpMaxR + 0.5
    ) {
      tp2 = t2raw;
    }
  }

  // Geometry guard (never invert)
  if (side === "short" && tp1 >= entry) tp1 = entry - riskPts;
  if (side === "long" && tp1 <= entry) tp1 = entry + riskPts;
  if (side === "short" && tp2 >= tp1) tp2 = Math.min(tp1 - riskPts * 0.5, entry - riskPts * 2);
  if (side === "long" && tp2 <= tp1) tp2 = Math.max(tp1 + riskPts * 0.5, entry + riskPts * 2);

  entry = tickRound(symbol, entry);
  stop = tickRound(symbol, stop);
  tp1 = tickRound(symbol, tp1);
  tp2 = tickRound(symbol, tp2);
  riskPts = Math.abs(entry - stop);

  const grade = (c.riskGrade || c.pathBand || c.grade || "A-") as RiskGrade;
  const sizing = sizeContracts({
    symbol,
    riskPts,
    equity: eq,
    gradeOrScore: grade === "skip" ? "B+" : grade,
    discretionMult,
  });

  return {
    symbol,
    displaySymbol,
    side,
    entry,
    stop,
    tp1,
    tp2,
    riskPts,
    contracts: Math.max(1, sizing.contracts),
    riskPct: sizing.riskPct,
    riskDollars: sizing.riskDollars,
    grade,
    discretionFactor: discretionMult ?? 1.0,
  };
}

function DEFAULT_MAX(symbol: string): number {
  if (symbol.includes("ES") || symbol === "MES") return 18;
  return 48;
}

export function loadPaperTrades(): PaperTrade[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as PaperTrade[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function savePaperTrades(trades: PaperTrade[]): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(trades.slice(0, 200)));
  window.dispatchEvent(new Event("ledger-paper"));
  window.dispatchEvent(new Event("ledger-memory"));
}

export function listOpenPaperTrades(): PaperTrade[] {
  return loadPaperTrades().filter((t) => t.status === "open");
}

/**
 * Rule 1 of profit-rules.ts — ONE BOOK PER DAY.
 *
 * Returns the book already taken this trading day (18:00 ET roll, same
 * boundary as the live risk governor), or null when the day is still open.
 * Open OR closed counts: the rule caps how many correlated ideas the day
 * gets, not how many are running at once.
 *
 * WHY PAPER ENFORCES THIS AND NOT THE REST OF THE GATE
 * Paper exists to build the sample, so it is deliberately exempt from the
 * halt, the ~9/month PATH cap and the loss-streak cool-down — those cap the
 * RATE at which evidence accumulates, and Phase C needs n≥30 before any of it
 * can be read. One-book-per-day is a different kind of rule: NQ and ES are
 * ~0.9 correlated, so taking both is one idea at double risk. A paper record
 * that quietly allowed it would overstate diversification and understate
 * drawdown — it would be evidence for a book nobody would actually run. The
 * cap on the sample RATE is a cost; a cap on its HONESTY is not acceptable.
 * (Live enforces the whole gate — see journal/server.ts openTrade.)
 */
export function bookTakenToday(now = Date.now()): {
  book: string;
  symbol: string;
  at: number;
} | null {
  const dayStart = tradingDayStart(new Date(now)).getTime();
  for (const t of loadPaperTrades()) {
    if (t.openedAt < dayStart || t.openedAt > now) continue;
    return { book: bookRoot(t.displaySymbol), symbol: t.displaySymbol, at: t.openedAt };
  }
  return null;
}

/**
 * One-click open paper trade from setup — no dialog.
 */
export function openPaperTradeInstant(
  c: SetupCandidate,
  opts?: { lastPrice?: number; killzone?: string; discretionMult?: number },
): { ok: true; trade: PaperTrade } | { ok: false; error: string } {
  try {
    // Rule 1 — one book per day. Checked BEFORE any level math so the message
    // names the conflict rather than a downstream geometry failure.
    const taken = bookTakenToday();
    if (taken && taken.book !== bookRoot(c.symbol)) {
      return {
        ok: false,
        error: `One book per day: already took ${taken.symbol} this session (since 18:00 ET). ${c.symbol} is a second correlated book — that is one idea at double risk, not two trades.`,
      };
    }
    const levels = buildPaperLevels(
      c,
      getPaperAccount().equity,
      opts?.lastPrice,
      opts?.discretionMult,
    );
    if (!levels.entry || !levels.stop) {
      return { ok: false, error: "Could not resolve entry/stop from setup" };
    }
    // Validate geometry
    if (levels.side === "long" && levels.stop >= levels.entry) {
      return { ok: false, error: "Stop not below entry for long" };
    }
    if (levels.side === "short" && levels.stop <= levels.entry) {
      return { ok: false, error: "Stop not above entry for short" };
    }
    if (levels.side === "long" && levels.tp1 <= levels.entry) {
      return { ok: false, error: "Target not above entry for long" };
    }
    if (levels.side === "short" && levels.tp1 >= levels.entry) {
      return { ok: false, error: "Target not below entry for short" };
    }

    const trade: PaperTrade = {
      id: `paper-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      symbol: levels.symbol,
      displaySymbol: levels.displaySymbol,
      side: levels.side,
      status: "open",
      entry: levels.entry,
      stop: levels.stop,
      workingStop: levels.stop,
      tp1: levels.tp1,
      tp2: levels.tp2,
      contracts: levels.contracts,
      contractsOpen: levels.contracts,
      riskPts: levels.riskPts,
      riskPct: levels.riskPct,
      riskDollars: levels.riskDollars,
      grade: String(levels.grade),
      score: c.confluence,
      strategy: c.completeStrategy || c.strategyPrimary || "—",
      openedAt: Date.now(),
      scaleLegs: [],
      reason: [
        c.title,
        `strategy:${c.completeStrategy || c.strategyPrimary || "—"}`,
        `band:${c.pathBand || c.grade}`,
        opts?.killzone ? `kz:${opts.killzone}` : null,
        levels.discretionFactor !== 1.0
          ? `discretion:${levels.discretionFactor.toFixed(2)}x`
          : null,
        "mode:paper auto",
      ]
        .filter(Boolean)
        .join(" · "),
      pathBand: c.pathBand,
      killzone: opts?.killzone,
      discretionFactor: levels.discretionFactor,
    };

    const all = loadPaperTrades();
    all.unshift(trade);
    savePaperTrades(all);

    rememberPaperOpen({
      symbol: trade.displaySymbol,
      side: trade.side,
      strategy: trade.strategy,
      grade: trade.grade,
      band: trade.pathBand,
      score: trade.score,
      entry: trade.entry,
      stop: trade.stop,
      tp1: trade.tp1,
      tp2: trade.tp2,
      contracts: trade.contracts,
      riskPts: trade.riskPts,
    });
    setOpenPaperCount(listOpenPaperTrades().length + 0); // will recount
    setOpenPaperCount(
      loadPaperTrades().filter((x) => x.status === "open").length,
    );
    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event("ledger-memory"));
    }

    return { ok: true, trade };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Paper open failed",
    };
  }
}

function pointValue(symbol: ContractKey): number {
  return CONTRACTS[symbol]?.pointValue ?? 2;
}

function commission(symbol: ContractKey): number {
  return CONTRACTS[symbol]?.commission ?? 1;
}

/**
 * Price feed for management — last + optional bar range for proper hit detection.
 * Short: stop if high >= stop; TP if low <= target.
 * Long: stop if low <= stop; TP if high >= target.
 */
export type ManagePrice = {
  last: number;
  high?: number;
  low?: number;
};

/** Every key a caller might have used for this trade's instrument. */
function symbolKeys(t: PaperTrade): string[] {
  return [
    t.displaySymbol,
    t.symbol,
    t.displaySymbol.replace(/^M/, ""),
    t.symbol.replace(/^M/, ""),
  ];
}

function resolvePrice(
  t: PaperTrade,
  prices: Partial<Record<string, number | ManagePrice>>,
): ManagePrice | null {
  const keys = symbolKeys(t);
  for (const k of keys) {
    const v = prices[k];
    if (v == null) continue;
    if (typeof v === "number" && Number.isFinite(v)) {
      return { last: v, high: v, low: v };
    }
    if (typeof v === "object" && Number.isFinite(v.last)) {
      return {
        last: v.last,
        high: v.high ?? v.last,
        low: v.low ?? v.last,
      };
    }
  }
  return null;
}

function finalizeClose(
  t: PaperTrade,
  sign: number,
): void {
  const totalR = t.scaleLegs.reduce(
    (s, l) => s + l.r * (l.contracts / t.contracts),
    0,
  );
  const totalUsd = t.scaleLegs.reduce((s, l) => {
    const u =
      sign * (l.price - t.entry) * pointValue(t.symbol) * l.contracts;
    return s + u - commission(t.symbol) * l.contracts;
  }, 0);
  // R must be NET of commission, matching live (@/lib/journal/pnl.ts). The
  // leg-weighted `totalR` above is a raw PRICE ratio, so a full stop-out
  // booked exactly -1.00R while the same live trade booked -1.03R. A paper
  // record that is systematically ~2-3% kinder than live is not evidence for
  // unlocking live. Derive R from the net dollars instead.
  const riskUsd =
    t.riskDollars > 0
      ? t.riskDollars
      : t.riskPts * pointValue(t.symbol) * t.contracts;
  const netR = riskUsd > 0 ? totalUsd / riskUsd : totalR;
  t.rMultiple = +netR.toFixed(3);
  t.pnlUsd = +totalUsd.toFixed(2);
  if (!t.ingested) {
    ingestPaperFill({
      symbol: t.displaySymbol,
      side: t.side,
      strategy: t.strategy,
      band: t.pathBand || t.grade,
      grade: t.grade,
      score: t.score,
      r: t.rMultiple!,
      usd: t.pnlUsd!,
      exit: t.exitReason || "close",
      entry: t.entry,
      exitPx: t.exit,
      reason: t.exitReason,
      applyEquity: true,
      tradeId: t.id,
    });
    t.ingested = true;
  }
  setOpenPaperCount(
    loadPaperTrades().filter((x) => x.status === "open" && x.id !== t.id).length,
  );
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("ledger-memory"));
  }
}


function resolveDraw(
  t: PaperTrade,
  draws: Partial<Record<string, DrawRead | null>>,
): DrawRead | null {
  for (const k of symbolKeys(t)) {
    const v = draws[k];
    if (v) return v;
  }
  return null;
}

/**
 * Optional context for the management tick.
 *
 * Everything here is opt-in EXCEPT the time/context stops, which default ON:
 * they need only the clock and the bundled news calendar, both deterministic,
 * so requiring the caller to pass anything would mean shipping B2 switched off.
 * Dynamic targets are opt-in — with no `draws`, targets behave exactly as they
 * did before Phase B.
 */
export interface ManageContext {
  /** Evaluation instant. Defaults to Date.now(). */
  now?: number;
  /**
   * Draw read per instrument (the desk payload's `draws`, keyed "NQ"/"ES" or
   * "MNQ"/"MES"). Omit and targets are never re-ranked.
   */
  draws?: Partial<Record<string, DrawRead | null>>;
  /** News calendar override — tests and replay only. */
  calendar?: NewsEvent[];
  /** Set false to suppress time/context stops (replay harnesses). Default true. */
  enableTimeStops?: boolean;
}

/**
 * Manage open paper trades against live prints (and bar H/L when available).
 * Scale-out 50% @ TP1 → BE, runner @ TP2; stop on working stop.
 *
 * Per tick, per open position, in this order:
 *   1. record max favourable excursion (feeds the no-progress time stop)
 *   2. re-rank targets against the draw           (B3, only when `draws` given)
 *   3. stop  → 4. TP1 → 5. TP2                    (unchanged price events)
 *   6. time / context stops                       (B2)
 * Price events are evaluated before time stops on purpose: a stop or target
 * that actually printed on this tick is a fact, a time stop is a decision.
 */
export function managePaperTradesAgainstPrice(
  prices: Partial<Record<string, number | ManagePrice>>,
  ctx?: ManageContext,
): { closed: PaperTrade[]; updated: PaperTrade[] } {
  const all = loadPaperTrades();
  const closed: PaperTrade[] = [];
  const updated: PaperTrade[] = [];
  const so = APLUS_RULES.scaleOut;
  const now = ctx?.now ?? Date.now();
  const timeStopsOn = ctx?.enableTimeStops !== false;
  const clock = getSessionClock(new Date(now));

  for (const t of all) {
    if (t.status !== "open" || t.contractsOpen <= 0) continue;
    const feed = resolvePrice(t, prices);
    if (!feed) continue;

    // Only trust last print for exit decisions.
    // Bar H/L from HTF/desk series often spans the whole candle and can
    // "stop out" a brand-new trade on the same bar it was opened.
    // Optional wicks only if they are tighter than 1.5R from last (micro noise).
    let high = feed.last;
    let low = feed.last;
    if (feed.high != null && feed.low != null) {
      const span = feed.high - feed.low;
      const maxWick = Math.max(t.riskPts * 0.35, t.entry * 0.0003);
      if (span <= maxWick) {
        high = feed.high;
        low = feed.low;
      }
    }
    // Grace: for 15s after open, only use last print (avoid open-bar ghost fills)
    if (now - t.openedAt < 15_000) {
      high = feed.last;
      low = feed.last;
    }
    const sign = t.side === "long" ? 1 : -1;
    const rPts = (price: number) => (sign * (price - t.entry)) / t.riskPts;

    let dirty = false;

    // 0a) Max favourable excursion — the only durable evidence the no-progress
    // time stop can read. Persisted ONLY on the first crossing of the progress
    // floor: writing every new tick high would hit localStorage (and fire two
    // window events) on every poll of a winning trade.
    const prevMfe = t.mfeR ?? -Infinity;
    const curR = rPts(t.side === "long" ? high : low);
    if (Number.isFinite(curR) && curR > prevMfe) {
      t.mfeR = +curR.toFixed(3);
      if (prevMfe < PROGRESS_R && t.mfeR >= PROGRESS_R) dirty = true;
    }

    // 0b) Dynamic targets from the draw (B3). No draw supplied → untouched,
    // so a caller that passes no context behaves exactly as it did before.
    const draw = ctx?.draws ? resolveDraw(t, ctx.draws) : null;
    if (draw) {
      const rt = retarget(t, draw, { last: feed.last });
      if (rt.changed) {
        const nextTp1 = tickRound(t.symbol, rt.tp1);
        const nextTp2 = tickRound(t.symbol, rt.tp2);
        // Re-assert the invariant AFTER tick rounding: rounding can nudge a
        // level by half a tick, and half a tick the wrong way is still the
        // wrong way. If it does, keep the targets we already had.
        const dist = (px: number) => sign * (px - t.entry);
        const safe =
          dist(nextTp1) > 0 &&
          dist(nextTp2) >= dist(nextTp1) &&
          dist(nextTp1) <= dist(t.tp1) &&
          dist(nextTp2) >= dist(t.tp2) &&
          sign * (nextTp1 - feed.last) > 0;
        if (safe) {
          t.tp1 = nextTp1;
          t.tp2 = nextTp2;
          t.manageNote = rt.notes.join(" · ");
          dirty = true;
        }
      }
    }

    // 1) STOP first (conservative — if stop and target same bar, stop wins)
    const stopHit =
      t.side === "long" ? low <= t.workingStop : high >= t.workingStop;
    if (stopHit) {
      const fill = t.workingStop;
      const r = rPts(fill);
      t.scaleLegs.push({
        at: new Date().toISOString(),
        price: fill,
        contracts: t.contractsOpen,
        r,
        note:
          Math.abs(fill - t.entry) < 0.01 || fill === t.entry
            ? "BE stop"
            : "stop",
      });
      t.contractsOpen = 0;
      t.status = "closed";
      t.closedAt = Date.now();
      t.exit = fill;
      t.exitReason =
        Math.abs(r) < 0.05 ? "be_stop" : r < 0 ? "stop" : "trail_stop";
      finalizeClose(t, sign);
      closed.push(t);
      continue;
    }

    // 2) TP1 scale-out — hit if print reaches OR trades through target
    const tp1Hit = t.side === "long" ? high >= t.tp1 : low <= t.tp1;
    const tp1Fill =
      t.side === "long"
        ? Math.max(t.tp1, feed.last) // long: fill at least target
        : Math.min(t.tp1, feed.last); // short: fill at target or better
    const alreadyTp1 = t.scaleLegs.some((l) => l.note.toLowerCase().includes("tp1"));
    if (so.enabled && tp1Hit && !alreadyTp1) {
      if (t.contractsOpen >= 2) {
        const closeN = Math.max(1, Math.floor(t.contractsOpen * so.tp1Fraction));
        const r = rPts(tp1Fill);
        t.scaleLegs.push({
          at: new Date().toISOString(),
          price: tp1Fill,
          contracts: closeN,
          r,
          note: "TP1 scale-out → BE",
        });
        t.contractsOpen -= closeN;
        if (so.moveStopToBeAfterTp1) {
          t.workingStop = tickRound(
            t.symbol,
            t.entry + sign * (so.beBufferR * t.riskPts),
          );
        }
        dirty = true;
      } else if (t.contractsOpen === 1) {
        // Single micro: full close at TP1 (can't split meaningfully)
        const r = rPts(tp1Fill);
        t.scaleLegs.push({
          at: new Date().toISOString(),
          price: tp1Fill,
          contracts: 1,
          r,
          note: "TP1 full (1ct)",
        });
        t.contractsOpen = 0;
        t.status = "closed";
        t.closedAt = Date.now();
        t.exit = tp1Fill;
        t.exitReason = "tp1";
        finalizeClose(t, sign);
        closed.push(t);
        continue;
      }
    }

    // 3) TP2 runner (or full if no scale)
    const tp2Hit = t.side === "long" ? high >= t.tp2 : low <= t.tp2;
    const tp2Fill =
      t.side === "long"
        ? Math.max(t.tp2, feed.last)
        : Math.min(t.tp2, feed.last);
    if (tp2Hit && t.contractsOpen > 0) {
      const r = rPts(tp2Fill);
      t.scaleLegs.push({
        at: new Date().toISOString(),
        price: tp2Fill,
        contracts: t.contractsOpen,
        r,
        note: "TP2 runner",
      });
      t.contractsOpen = 0;
      t.status = "closed";
      t.closedAt = Date.now();
      t.exit = tp2Fill;
      t.exitReason = alreadyTp1 || t.scaleLegs.some((l) => l.note.includes("TP1"))
        ? "tp1_tp2"
        : "tp2";
      finalizeClose(t, sign);
      closed.push(t);
      continue;
    }

    // 4) TIME / CONTEXT STOPS (B2) — killzone ended, session end, news
    // blackout imminent, N bars with no progress. Evaluated last: anything
    // above this line was a real price event on this tick and outranks a
    // decision. Fills at the last print (a market-out), and books through the
    // same finalizeClose, so R stays NET of commission.
    if (timeStopsOn) {
      const decision = shouldFlatten(t, {
        now,
        clock,
        last: feed.last,
        calendar: ctx?.calendar,
      });
      if (decision.flatten && decision.reason) {
        const fill = feed.last;
        t.scaleLegs.push({
          at: new Date(now).toISOString(),
          price: fill,
          contracts: t.contractsOpen,
          r: rPts(fill),
          note: `flat: ${decision.reason}`,
        });
        t.contractsOpen = 0;
        t.status = "closed";
        t.closedAt = now;
        t.exit = fill;
        t.exitReason = `flat_${decision.reason}`;
        t.manageNote = decision.detail;
        finalizeClose(t, sign);
        closed.push(t);
        continue;
      }
    }

    if (dirty) updated.push(t);
  }

  if (closed.length || updated.length) {
    savePaperTrades(all);
  }
  return { closed, updated };
}


/**
 * Manually / structure-close an open paper trade at a fill price.
 * Used for "close at the 7763 low" style structure TPs.
 */
export function closePaperTrade(
  id: string,
  exitPrice: number,
  reason: string = "structure_tp",
): PaperTrade | null {
  const all = loadPaperTrades();
  const t = all.find((x) => x.id === id && x.status === "open");
  if (!t) return null;
  if (!Number.isFinite(exitPrice) || exitPrice <= 0) return null;

  const sign = t.side === "long" ? 1 : -1;
  const r = (sign * (exitPrice - t.entry)) / Math.max(t.riskPts, 1e-6);
  const openCt = t.contractsOpen;

  t.scaleLegs.push({
    at: new Date().toISOString(),
    price: exitPrice,
    contracts: openCt,
    r,
    note: reason === "structure_tp" ? `structure TP @ ${exitPrice}` : reason,
  });
  t.contractsOpen = 0;
  t.status = "closed";
  t.closedAt = Date.now();
  t.exit = exitPrice;
  t.exitReason = reason;

  // Booked through the SAME finalizeClose as every automatic exit. This path
  // used to compute its own `rMultiple` from the leg-weighted PRICE ratio,
  // which is gross — a structure-TP close was reported ~2-3% kinder than the
  // identical live trade, the exact defect finalizeClose was fixed for.
  finalizeClose(t, sign);
  savePaperTrades(all);
  setOpenPaperCount(listOpenPaperTrades().filter((x) => x.id !== id).length);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("ledger-memory"));
  }
  return t;
}

/** Close every open paper position (optional per-symbol or single fill). */
export function closeAllOpenPaper(
  exitPrice: number,
  reason: string = "structure_tp",
): PaperTrade[] {
  const closed: PaperTrade[] = [];
  for (const t of listOpenPaperTrades()) {
    const c = closePaperTrade(t.id, exitPrice, reason);
    if (c) closed.push(c);
  }
  return closed;
}

/**
 * If short and mark is at/through structure low (or long through high),
 * close remaining size at that structure level.
 */
export function closeOpenAtStructureLow(
  structurePx: number,
  markBySymbol: Partial<Record<string, number>>,
): PaperTrade[] {
  const closed: PaperTrade[] = [];
  for (const t of listOpenPaperTrades()) {
    const mark =
      markBySymbol[t.displaySymbol] ??
      markBySymbol[t.symbol] ??
      markBySymbol[t.displaySymbol.replace(/^M/, "")] ??
      null;
    if (mark == null) continue;
    if (t.side === "short" && mark <= structurePx + 0.25) {
      // fill at structure low (or better if mark lower)
      const fill = Math.min(structurePx, mark);
      const c = closePaperTrade(t.id, fill, "structure_tp");
      if (c) closed.push(c);
    } else if (t.side === "long" && mark >= structurePx - 0.25) {
      const fill = Math.max(structurePx, mark);
      const c = closePaperTrade(t.id, fill, "structure_tp");
      if (c) closed.push(c);
    }
  }
  return closed;
}

/**
 * Sync all closed paper trades into desk-memory (equity + rates + brain).
 * Idempotent via trade.ingested / tradeId in memory.
 * Call on app load and after any paper event so the whole UI stays connected.
 */
let _reconciling = false;

/**
 * Sync closed paper trades into desk-memory. Idempotent.
 * Does NOT dispatch window events (avoids sync↔reconcile infinite loop).
 * Callers should publishMemory / setEquity after.
 */
export function reconcilePaperBookToMemory(): {
  synced: number;
  equity: number;
  open: number;
} {
  if (typeof window === "undefined") {
    return { synced: 0, equity: PAPER_START_EQUITY, open: 0 };
  }
  if (_reconciling) {
    const acc = getPaperAccount();
    return {
      synced: 0,
      equity: acc.equity,
      open: listOpenPaperTrades().length,
    };
  }
  _reconciling = true;
  try {
    const all = loadPaperTrades();
    let synced = 0;
    for (const tr of all) {
      if (tr.status !== "closed") continue;
      if (tr.ingested) continue;
      if (tr.rMultiple == null || tr.pnlUsd == null) {
        const sign = tr.side === "long" ? 1 : -1;
        if (tr.exit != null && tr.riskPts > 0) {
          tr.rMultiple =
            Math.round(
              ((sign * (tr.exit - tr.entry)) / tr.riskPts) * 1000,
            ) / 1000;
          tr.pnlUsd =
            Math.round(
              (sign *
                (tr.exit - tr.entry) *
                pointValue(tr.symbol) *
                tr.contracts -
                commission(tr.symbol) * tr.contracts) *
                100,
            ) / 100;
        } else continue;
      }
      ingestPaperFill({
        symbol: tr.displaySymbol,
        side: tr.side,
        strategy: tr.strategy,
        band: tr.pathBand || tr.grade,
        grade: tr.grade,
        score: tr.score,
        r: tr.rMultiple,
        usd: tr.pnlUsd,
        exit: tr.exitReason || "reconcile",
        entry: tr.entry,
        exitPx: tr.exit,
        reason: tr.exitReason || "reconcile",
        applyEquity: true,
        tradeId: tr.id,
      });
      tr.ingested = true;
      synced += 1;
    }
    if (synced) savePaperTrades(all);
    // update open count without nested event storms
    const open = all.filter((x) => x.status === "open").length;
    // setOpenPaperCount saves memory — only if changed
    try {
      setOpenPaperCount(open);
    } catch {
      /* */
    }
    const acc = getPaperAccount();
    return { synced, equity: acc.equity, open };
  } finally {
    _reconciling = false;
  }
}

export function paperTradeHistory(limit = 20): PaperTrade[] {
  return loadPaperTrades().slice(0, limit);
}

export function formatPaperTradeLine(t: PaperTrade): string {
  if (t.status === "open") {
    return `${t.displaySymbol} ${t.side.toUpperCase()} ${t.contractsOpen}/${t.contracts}ct @ ${t.entry} · SL ${t.workingStop} · TP1 ${t.tp1} · ${t.grade}`;
  }
  return `${t.displaySymbol} ${t.side} CLOSED ${t.exitReason} R ${t.rMultiple?.toFixed(2) ?? "—"} $${t.pnlUsd?.toFixed(0) ?? "—"}`;
}
