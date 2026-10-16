/**
 * Journal core: shapes, the live risk governor, the open gate and the *For bodies (closeTradeFor, recordRealFillFor).
 * Free of server-fn, auth and `@/lib/db` VALUE imports: every function takes the `Sql` it runs on. That keeps the
 * watcher fill path (desk/watcher-fills.ts + its tests) from loading db.ts, whose import kicks off the PGLite
 * bootstrap. journal/server.ts wraps these in createServerFn and re-exports them unchanged.
 */
import { z } from "zod";
import type { Sql } from "@/lib/db";
import { CONTRACTS, type ContractKey } from "@/lib/aplus/config";
import { computeTradePnl, isKnownSymbol } from "./pnl";
import { appendAttestation } from "./attest-server";
import { closeTradeSchema, realFillSchema } from "./fill-schemas";
import { getSessionClock } from "@/lib/trading/sessions";
import {
  emptyBookCounters,
  monthKeyFromMs,
  pathTakeGate,
  PATH_MONTH_CAP,
  type BookCounters,
  type PathGateResult,
} from "@/lib/trading/profit-rules";
import type { SetupCandidate } from "@/lib/trading/scanner";
import {
  computeRiskFlags,
  currentKillzoneWindow,
  tradingDayStart,
  tradingWeekStart,
  type RiskState,
} from "./risk";

export type { RiskState };

/* ------------------------------------------------------------------ */
/* Shared shapes                                                      */
/* ------------------------------------------------------------------ */

export const SYMBOLS = Object.keys(CONTRACTS) as [ContractKey, ...ContractKey[]];

export const symbolSchema = z.enum(SYMBOLS);
export const sideSchema = z.enum(["long", "short"]);
export const modeSchema = z.enum(["live", "paper"]);
export const sourceSchema = z.enum(["desk", "engine", "paper"]);
export const eventSchema = z.enum(["CANDIDATE", "SKIP", "ENTRY", "EXIT", "HALT"]);

export const price = z.number().finite().positive();

export interface JournalTrade {
  id: string;
  mode: "live" | "paper";
  source: "desk" | "engine" | "paper";
  symbol: string;
  side: "long" | "short";
  status: "open" | "closed";
  openedAt: string;
  closedAt: string | null;
  entry: number;
  stop: number | null;
  target: number | null;
  exit: number | null;
  contracts: number;
  pnl: number | null;
  r: number | null;
  commission: number;
  slippage: number;
  reason: string | null;
  prescore: number | null;
  grade: string | null;
  killzone: string | null;
  componentsPresent: string[] | null;
  componentsMissing: string[] | null;
  /* --- Real-fill context (migrations/0015). Null on rows written before it. --- */
  /** The sequence's word for this book and side at the moment of the decision. */
  deskWord: string | null;
  /** Must-layers that were not passing — the gates this trade went through. */
  missingLayers: string[] | null;
  /** Taken against the desk: word not TAKE, or a gate that would have refused. */
  override: boolean;
  /** The refusal the gate WOULD have given, verbatim. */
  overrideGate: string | null;
  pathBand: string | null;
  /** The trader's one-line reason. */
  why: string | null;
  /** Written before the outcome was known? */
  whyPre: boolean | null;
  planEntry: number | null;
  planStop: number | null;
  /** When the fill actually happened, which is not when it was logged. */
  filledAt: string | null;
  /** Pre-click state, 1 calm … 5 tilted (journal/discipline.ts STATE_SCALE). */
  stateRating: number | null;
  mistakes: string[] | null;
  exitReason: string | null;
}

/** JSON-safe value — matches what jsonb can hold and what server fns may return. */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export interface DeskEvent {
  id: number;
  ts: string;
  event: "CANDIDATE" | "SKIP" | "ENTRY" | "EXIT" | "HALT";
  symbol: string | null;
  prescore: number | null;
  reason: string | null;
  pnl: number | null;
  r: number | null;
  source: "desk" | "engine" | "paper";
  payload: Record<string, JsonValue> | null;
}

export interface DeskSettings {
  equity: number;
  updatedAt: string | null;
}

export type TradeRow = {
  id: string;
  mode: JournalTrade["mode"];
  source: JournalTrade["source"];
  symbol: string;
  side: JournalTrade["side"];
  status: JournalTrade["status"];
  opened_at: string | Date;
  closed_at: string | Date | null;
  entry: number;
  stop: number | null;
  target: number | null;
  exit: number | null;
  contracts: number;
  pnl: number | null;
  r: number | null;
  commission: number;
  slippage: number;
  reason: string | null;
  prescore: number | null;
  grade: string | null;
  killzone: string | null;
  components_present: unknown;
  components_missing: unknown;
  desk_word?: string | null;
  missing_layers?: unknown;
  override?: boolean | null;
  override_gate?: string | null;
  path_band?: string | null;
  why?: string | null;
  why_pre?: boolean | null;
  plan_entry?: number | null;
  plan_stop?: number | null;
  filled_at?: string | Date | null;
  state_rating?: number | null;
  mistakes?: unknown;
  exit_reason?: string | null;
};

export function iso(v: string | Date): string {
  return (v instanceof Date ? v : new Date(v)).toISOString();
}

export function stringArray(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  return v.filter((x): x is string => typeof x === "string");
}

export function mapTrade(row: TradeRow): JournalTrade {
  return {
    id: row.id,
    mode: row.mode,
    source: row.source,
    symbol: row.symbol,
    side: row.side,
    status: row.status,
    openedAt: iso(row.opened_at),
    closedAt: row.closed_at == null ? null : iso(row.closed_at),
    entry: row.entry,
    stop: row.stop,
    target: row.target,
    exit: row.exit,
    contracts: row.contracts,
    pnl: row.pnl,
    r: row.r,
    commission: row.commission,
    slippage: row.slippage,
    reason: row.reason,
    prescore: row.prescore,
    grade: row.grade,
    killzone: row.killzone,
    componentsPresent: stringArray(row.components_present),
    componentsMissing: stringArray(row.components_missing),
    deskWord: row.desk_word ?? null,
    missingLayers: stringArray(row.missing_layers),
    override: row.override === true,
    overrideGate: row.override_gate ?? null,
    pathBand: row.path_band ?? null,
    why: row.why ?? null,
    whyPre: row.why_pre ?? null,
    planEntry: row.plan_entry ?? null,
    planStop: row.plan_stop ?? null,
    filledAt: row.filled_at == null ? null : iso(row.filled_at),
    stateRating: row.state_rating ?? null,
    mistakes: stringArray(row.mistakes),
    exitReason: row.exit_reason ?? null,
  };
}

export const TRADE_COLUMNS = `id, mode, source, symbol, side, status, opened_at,
  closed_at, entry, stop, target, exit, contracts, pnl, r, commission,
  slippage, reason, prescore, grade, killzone, components_present,
  components_missing, desk_word, missing_layers, override, override_gate,
  path_band, why, why_pre, plan_entry, plan_stop, filled_at, state_rating,
  mistakes, exit_reason`;

/* ------------------------------------------------------------------ */
/* Settings                                                           */
/* ------------------------------------------------------------------ */

export const DEFAULT_EQUITY = 100_000;

export async function readEquity(sql: Sql, userId: string): Promise<number> {
  const rows = await sql<{ equity: number }>`
    select equity from desk_settings where user_id = ${userId}`;
  return rows[0]?.equity ?? DEFAULT_EQUITY;
}

/* ------------------------------------------------------------------ */
/* Risk governor (shared — computed here so openTrade can enforce it,   */
/* not just getRiskState display it)                                   */
/* ------------------------------------------------------------------ */

/**
 * Realized PnL / entry counts scoped to `mode = 'live'` ONLY. Paper trades
 * must never move the live halt: a paper loss can't falsely trip the live
 * daily/weekly halt, and a paper win can't falsely clear one that should be
 * active. (Was previously unscoped — both aggregates summed live+paper
 * together, which could both mask a real halt and fire a false one.)
 */
export async function computeLiveRiskState(
  sql: Sql,
  userId: string,
): Promise<RiskState> {
  const now = new Date();
  const clock = getSessionClock(now);
  const dayStart = tradingDayStart(now);
  const weekStart = tradingWeekStart(now);
  const kz = currentKillzoneWindow(clock.killzone, now);

  const [equity, aggregates] = await Promise.all([
    readEquity(sql, userId),
    sql<{
      day_pnl: number;
      week_pnl: number;
      kz_entries: number;
      open_trades: number;
    }>`
      select
        coalesce(sum(pnl) filter (
          where status = 'closed' and mode = 'live' and closed_at >= ${dayStart}
        ), 0)::double precision as day_pnl,
        coalesce(sum(pnl) filter (
          where status = 'closed' and mode = 'live' and closed_at >= ${weekStart}
        ), 0)::double precision as week_pnl,
        count(*) filter (
          where mode = 'live' and opened_at >= ${kz.startUtc} and opened_at < ${kz.endUtc}
        ) as kz_entries,
        count(*) filter (where mode = 'live' and status = 'open') as open_trades
      from desk_trades
      where user_id = ${userId}`,
  ]);

  const agg = aggregates[0] ?? {
    day_pnl: 0,
    week_pnl: 0,
    kz_entries: 0,
    open_trades: 0,
  };

  return computeRiskFlags({
    equity,
    dayPnl: Number(agg.day_pnl),
    weekPnl: Number(agg.week_pnl),
    entriesThisKillzone: Number(agg.kz_entries),
    openTrades: Number(agg.open_trades),
    clock,
    dayStart,
    weekStart,
  });
}

/* ------------------------------------------------------------------ */
/* Profit rules (ROADMAP B1)                                          */
/*                                                                    */
/* `pathTakeGate` (trading/profit-rules.ts) enforces the month cap,    */
/* the consecutive-loss cool-down, the blake_mech demotion and         */
/* one-book-per-day. It was called from session-backtest.ts ONLY, so   */
/* the backtest was run under STRICTER rules than the desk enforced —  */
/* which means backtest PnL described a system that was not being      */
/* traded. Everything below promotes that same function, with counters */
/* read from this journal, onto the live open path.                    */
/* ------------------------------------------------------------------ */

/**
 * The BOOK a symbol belongs to. MNQ and NQ are one book, MES and ES another —
 * the micro is the same instrument at 1/10th the multiplier, so holding both
 * is not diversification, and one-book-per-day must compare at this level.
 * (Deliberately duplicated from trading/paper-manager.ts `bookRoot` rather
 * than imported: that module reaches for localStorage and has no business in
 * the server bundle.)
 */
export function bookOf(symbol: string): string {
  return symbol.replace(/^M(?=NQ$|ES$)/, "");
}

/** `strategy:mechanical` out of the reason line the desk writes at log time. */
export function strategyFromReason(reason: string | null | undefined): string | null {
  const m = /strategy:([a-z0-9_]+)/i.exec(reason ?? "");
  return m ? m[1]!.toLowerCase() : null;
}

/**
 * Book counters for one mode, read from the journal.
 *
 * - `blakeLongTaken/Wins` — REAL counts as of migration 0008 + the Phase C
 *   writers (INTEGRATION-D). Before that, this comment said they "stay 0"
 *   because the journal had no reliable per-strategy attribution; the
 *   `strategy` column now exists and is populated on open (see
 *   `candidateFromOpenInput` above and paper-mirror.ts), so the query below
 *   reads it directly instead of hardcoding the pessimistic default. Until
 *   enough rows carry `strategy = 'blake_mech'`, this still reports 0/0 —
 *   honestly, from an empty result set, not from a constant — and
 *   `blakeLongRecovered` correctly keeps the demotion in place either way.
 * - `pathThisMonth` counts ENTRIES this UTC calendar month, matching
 *   `monthKeyFromMs`, which the backtest also keys on UTC.
 * - `consecLosses` counts back from the most recent close while pnl <= 0,
 *   the same "loss" test the backtest applies (`rMultiple <= 0`).
 */
export async function readBookCounters(
  sql: Sql,
  userId: string,
  mode: "live" | "paper",
  now: Date,
): Promise<{
  counters: BookCounters;
  bookTakenToday: string | null;
  /** The SIDE already taken today — the one-book rule is about bias. */
  sideTakenToday: "long" | "short" | null;
}> {
  const monthStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
  );
  const dayStart = tradingDayStart(now);
  const weekStart = tradingWeekStart(now);

  const [agg, recentClosed, weekOpens] = await Promise.all([
    sql.query<{
      path_this_month: number;
      path_this_week: number;
      aplus_taken: number;
      aplus_wins: number;
      blake_long_taken: number;
      blake_long_wins: number;
    }>(
      `select
         count(*) filter (where opened_at >= $3) as path_this_month,
         count(*) filter (where opened_at >= $4) as path_this_week,
         count(*) filter (where status = 'closed' and grade = 'A+') as aplus_taken,
         count(*) filter (where status = 'closed' and grade = 'A+' and pnl > 0) as aplus_wins,
         count(*) filter (where status = 'closed' and strategy = 'blake_mech' and side = 'long') as blake_long_taken,
         count(*) filter (where status = 'closed' and strategy = 'blake_mech' and side = 'long' and pnl > 0) as blake_long_wins
       from desk_trades
       where user_id = $1 and mode = $2`,
      [userId, mode, monthStart, weekStart],
    ),
    sql.query<{ pnl: number | null }>(
      `select pnl from desk_trades
        where user_id = $1 and mode = $2 and status = 'closed'
        order by closed_at desc
        limit 20`,
      [userId, mode],
    ),
    sql.query<{ symbol: string; side: string; opened_at: string | Date }>(
      `select symbol, side, opened_at from desk_trades
        where user_id = $1 and mode = $2 and opened_at >= $3
        order by opened_at asc
        limit 100`,
      [userId, mode, weekStart],
    ),
  ]);

  const counters = emptyBookCounters(monthKeyFromMs(now.getTime()));
  const a = agg[0];
  if (a) {
    counters.pathThisMonth = Number(a.path_this_month);
    counters.pathThisWeek = Number(a.path_this_week);
    counters.aPlusTaken = Number(a.aplus_taken);
    counters.aPlusWins = Number(a.aplus_wins);
    counters.blakeLongTaken = Number(a.blake_long_taken);
    counters.blakeLongWins = Number(a.blake_long_wins);
  }

  let consec = 0;
  for (const row of recentClosed) {
    if (row.pnl == null || Number(row.pnl) > 0) break;
    consec += 1;
  }
  counters.consecLosses = consec;

  // Same window and same tail length the backtest keeps (`slice(-8)`).
  counters.lastSides = weekOpens.map((r) => r.side).slice(-8);

  const dayMs = dayStart.getTime();
  const first = weekOpens.find(
    (r) => new Date(r.opened_at).getTime() >= dayMs,
  );

  return {
    counters,
    bookTakenToday: first ? bookOf(first.symbol) : null,
    sideTakenToday:
      first && (first.side === "long" || first.side === "short") ? first.side : null,
  };
}

/**
 * The facts `pathTakeGate` reads, assembled from what an open request
 * actually carries. Everything the live path does not know is set to the
 * value that does NOT loosen a rule — with one stated exception:
 *
 *   `htfOk` defaults to TRUE. The client does not send it yet (the scanner
 *   computes it, the log dialog drops it), and defaulting it to false would
 *   reject every live entry outright rather than enforce a gate. Pass
 *   `htfOk: false` explicitly to have the absolute HTF gate enforced here as
 *   well — see INTEGRATION-B.md §1.
 */
export function candidateFromOpenInput(data: {
  symbol: string;
  side: "long" | "short";
  prescore?: number;
  grade?: string;
  pathBand?: string;
  strategyPrimary?: string;
  htfOk?: boolean;
  actionable?: boolean;
  reason?: string;
}): SetupCandidate {
  const strategy =
    data.strategyPrimary?.toLowerCase() ?? strategyFromReason(data.reason) ?? "";
  const band = data.pathBand ?? data.grade ?? "";
  return {
    id: "live-open",
    // Book level, not contract level — see bookOf.
    symbol: bookOf(data.symbol),
    side: data.side,
    confluence: data.prescore ?? 0,
    grade:
      data.grade === "A+" || data.grade === "A-" || data.grade === "skip"
        ? data.grade
        : "B",
    title: "live open",
    reasons: [],
    missing: [],
    components: [],
    strategies: [],
    strategyPrimary: strategy,
    strategyWhy: [],
    entryZone: "",
    invalidation: "",
    targets: [],
    killzoneOk: true,
    htfOk: data.htfOk !== false,
    conditionsOk: true,
    actionable: data.actionable === true,
    regime: "",
    volatility: "",
    pathBand: band ? (band as SetupCandidate["pathBand"]) : undefined,
    completeStrategy: strategy || undefined,
    riskGrade: data.grade,
  };
}

/** The subset of an open request the profit rules actually read. */
export interface OpenGateInput {
  symbol: string;
  side: "long" | "short";
  mode: "live" | "paper";
  prescore?: number;
  grade?: string;
  pathBand?: string;
  strategyPrimary?: string;
  htfOk?: boolean;
  actionable?: boolean;
  reason?: string;
}

/**
 * Throws the readable rejection when the profit rules refuse this open, and
 * returns silently when they do not.
 *
 * LIVE runs the whole of `pathTakeGate` — month cap, loss cool-down, blake
 * demotion, same-side cap, band floor, one-book-per-day — so the live desk and
 * the session backtest are finally the same rule set. That comparability is
 * the entire point of B1: without it, backtest PnL describes a system nobody
 * is trading.
 *
 * PAPER is exempt from all of it EXCEPT one-book-per-day. Paper exists to
 * build the sample, and the cap / cool-down / band rules throttle the RATE at
 * which evidence accumulates while Phase C still needs n>=30. One book per day
 * is a different kind of rule: NQ and ES are ~0.9 correlated, so taking both
 * is one idea at double risk. A paper record that allowed it would overstate
 * diversification and understate drawdown — it would be evidence for a book
 * nobody would run. Throttling the sample RATE is a cost worth paying;
 * corrupting its HONESTY is not.
 *
 * Paper cannot simply read `pathTakeGate`'s verdict, because that function
 * short-circuits: a paper-exempt rule (say month_cap) returns first and the
 * dual-book branch is never reached. So paper reproduces exactly that branch's
 * comparison — `alreadyTookSymbolToday !== c.symbol` — instead.
 *
 * Exported so the gate can be exercised directly against a database; the
 * server fn around it adds auth and validation, never rules.
 */
export async function assertOpenAllowed(
  sql: Sql,
  userId: string,
  data: OpenGateInput,
  now = new Date(),
): Promise<void> {
  const { counters, bookTakenToday, sideTakenToday } = await readBookCounters(
    sql,
    userId,
    data.mode,
    now,
  );
  if (data.mode === "live") {
    const gate = pathTakeGate(candidateFromOpenInput(data), counters, {
      alreadyTookSymbolToday: bookTakenToday,
    });
    if (!gate.take) throw new Error(pathGateError(gate, "live", counters));
    return;
  }
  // The rule is about BIAS, not book. CLAUDE.md: "MNQ or ES, never both SAME
  // BIAS." MNQ long + ES long is one idea at double risk; MNQ long + ES short
  // is the SMT divergence trade, which carries LESS directional risk than
  // either leg alone. Kept in step with paper-manager.ts, which had the same
  // contradiction — two copies of a rule that disagree with the doc are worse
  // than one.
  if (
    bookTakenToday &&
    bookTakenToday !== bookOf(data.symbol) &&
    sideTakenToday != null &&
    sideTakenToday === data.side
  ) {
    throw new Error(
      `One book per day: already took ${bookTakenToday} ${sideTakenToday} on the paper book this session (since 18:00 ET). ${bookOf(data.symbol)} ${data.side} is a second correlated book on the SAME bias — that is one idea at double risk, not two trades.`,
    );
  }
}

/** Readable, in the same voice as the halt errors above. */
export function pathGateError(
  gate: PathGateResult,
  mode: "live" | "paper",
  counters: BookCounters,
): string {
  const head: Record<PathGateResult["reason"], string> = {
    ok: "Profit rule",
    dual_book_block: "One book per day",
    month_cap: `PATH month cap ${counters.pathThisMonth}/${PATH_MONTH_CAP}`,
    blake_long_demoted: "Demoted model",
    htf: "HTF top-down gate",
    not_path_band: "Not a PATH band",
    other: "Profit rule",
  };
  return `${head[gate.reason]}: ${gate.detail}. No new ${mode} entry — this is the same pathTakeGate (trading/profit-rules.ts) the session backtest runs, so the backtest and the book stay one system.`;
}

/* ------------------------------------------------------------------ */
/* Open / close trades                                                */
/* ------------------------------------------------------------------ */

export const openTradeSchema = z
  .object({
    symbol: symbolSchema,
    side: sideSchema,
    entry: price,
    stop: price.optional(),
    target: price.optional(),
    contracts: z.number().int().min(1).max(1000),
    mode: modeSchema.default("live"),
    source: sourceSchema.default("desk"),
    prescore: z.number().min(0).max(1).optional(),
    grade: z.enum(["A+", "A-", "B+", "B", "skip"]).optional(),
    killzone: z.string().max(32).optional(),
    componentsPresent: z.array(z.string().max(200)).max(30).optional(),
    componentsMissing: z.array(z.string().max(200)).max(30).optional(),
    reason: z.string().max(500).optional(),
    /* --- Profit-rule inputs (B1). All optional and all backward-compatible: */
    /* a caller that sends none of them is gated on grade + journal history.  */
    /** `SetupCandidate.pathBand` — the two-axis band, finer than `grade`. */
    pathBand: z.enum(["A+", "A", "A-", "B+", "B", "C", "skip"]).optional(),
    /** `SetupCandidate.strategyPrimary`. Falls back to `strategy:x` in reason. */
    strategyPrimary: z.string().max(64).optional(),
    /** Absolute HTF gate. Omitted = true; see candidateFromOpenInput. */
    htfOk: z.boolean().optional(),
    /** `SetupCandidate.actionable` — lets a scanner-actionable setup through. */
    actionable: z.boolean().optional(),
    /**
     * `MarketConditions.regime` at decision time (trend / chop / dead ...).
     * Persisted for the Phase C regime matrix — "when NOT to use this model"
     * is unanswerable without it. Omitted stays NULL; never inferred.
     */
    regime: z.string().max(32).optional(),
  })
  .superRefine((v, ctx) => {
    // Stop must sit on the loss side of entry; target on the profit side.
    if (v.stop != null) {
      const ok = v.side === "long" ? v.stop < v.entry : v.stop > v.entry;
      if (!ok)
        ctx.addIssue({
          code: "custom",
          path: ["stop"],
          message: `Stop must be ${v.side === "long" ? "below" : "above"} entry for a ${v.side}`,
        });
    }
    if (v.target != null) {
      const ok = v.side === "long" ? v.target > v.entry : v.target < v.entry;
      if (!ok)
        ctx.addIssue({
          code: "custom",
          path: ["target"],
          message: `Target must be ${v.side === "long" ? "above" : "below"} entry for a ${v.side}`,
        });
    }
  });

export type OpenTradeInput = z.input<typeof openTradeSchema>;

/**
 * Server-only options for the *For bodies (NOT in the client schemas, so the UI cannot set them).
 * `realizedPnl`: the desk-watcher trades OPTIONS on the card's underlier; desk_trades keeps the underlier plan terms
 * (entry/stop/exit, so R stays the plan R), but `pnl` must be the real option-premium dollars, because pnl feeds
 * computeLiveRiskState (daily/weekly halt) and cron-stats live_net. Commission is then 0 (RH options).
 */
export type LiveFillOpts = { realizedPnl?: number };
export function withRealizedPnl<T extends { pnl: number; commission: number; r: number | null }>(m: T, opts: LiveFillOpts): T {
  if (opts.realizedPnl == null || !Number.isFinite(opts.realizedPnl)) return m;
  return { ...m, pnl: Math.round(opts.realizedPnl * 100) / 100, commission: 0 };
}

export type CloseTradeInput = z.input<typeof closeTradeSchema>;

/** Body of `closeTrade`, callable server-side with an explicit user (the watcher fill endpoint uses it). */
export async function closeTradeFor(
  sql: Sql,
  userId: string,
  data: z.output<typeof closeTradeSchema>,
  opts: LiveFillOpts = {},
): Promise<JournalTrade> {
  const open = await sql.query<TradeRow>(
    `select ${TRADE_COLUMNS} from desk_trades
     where id = $1 and user_id = $2 and status = 'open'`,
    [data.id, userId],
  );
  const trade = open[0];
  if (!trade) throw new Error("Open trade not found");

  if (!isKnownSymbol(trade.symbol)) {
    throw new Error(`Unknown contract symbol: ${trade.symbol}`);
  }

  // Shared money math — paper uses the exact same function (see pnl.ts).
  const { pnl, commission, r } = withRealizedPnl(
    computeTradePnl({
      symbol: trade.symbol,
      side: trade.side,
      entry: trade.entry,
      exit: data.exit,
      stop: trade.stop,
      contracts: trade.contracts,
      slippage: data.slippage,
    }),
    opts,
  );

  const now = new Date();
  const rows = await sql.query<TradeRow>(
    `update desk_trades
     set status = 'closed', closed_at = $1, exit = $2, pnl = $3, r = $4,
         commission = $5, slippage = $6,
         reason = coalesce($7, reason),
         exit_reason = coalesce($10, exit_reason),
         mistakes = case when $11::jsonb is null then mistakes
                         else coalesce(mistakes, '[]'::jsonb) || $11::jsonb end
     where id = $8 and user_id = $9 and status = 'open'
     returning ${TRADE_COLUMNS}`,
    [
      now,
      data.exit,
      pnl,
      r,
      commission,
      data.slippage,
      data.reason ?? null,
      data.id,
      userId,
      data.exitReason ?? null,
      data.mistakes?.length ? JSON.stringify(data.mistakes) : null,
    ],
  );
  if (!rows[0]) throw new Error("Open trade not found");

  await sql`
    insert into desk_events (user_id, ts, event, symbol, prescore, reason, pnl, r, source, payload)
    values (${userId}, ${now}, 'EXIT', ${trade.symbol},
            ${trade.prescore}, ${data.reason ?? `exit @ ${data.exit}`},
            ${pnl}, ${r}, ${trade.source},
            ${JSON.stringify({ tradeId: trade.id, exit: data.exit, slippage: data.slippage })}::jsonb)`;

  // Seal the realised outcome — exit, pnl and R as they actually printed.
  // This is the link that matters: it is the losers that a record has to be
  // able to prove it did not quietly drop.
  await appendAttestation(sql, { ...rows[0], user_id: userId }, "close");

  return mapTrade(rows[0]);
}

export type RealFillInput = z.input<typeof realFillSchema>;

/**
 * Record a fill that already happened. NEVER refuses on a desk rule.
 *
 * `openTrade` is the gate for an order the desk is about to place, and it
 * refuses a loss halt and pathTakeGate. A trade count is not a refusal.
 * Applied to a FILL, that refusal is a lie by omission: the trade happened,
 * and the rows it drops are the overrides — the only rows that can tell a
 * mis-tuned gate from a discipline leak. So this runs the same gates purely
 * to RECORD what they would have said (`override_gate`) and inserts anyway.
 *
 * Live only. Paper keeps `openTrade`, where refusing is the point.
 */
/** Body of `recordRealFill`, callable server-side with an explicit user (the watcher fill endpoint uses it). */
export async function recordRealFillFor(
  sql: Sql,
  userId: string,
  data: z.output<typeof realFillSchema>,
  opts: LiveFillOpts = {},
): Promise<JournalTrade> {
  if (!isKnownSymbol(data.symbol)) throw new Error(`Unknown contract symbol: ${data.symbol}`);

  // What the gates WOULD have said — recorded, never enforced here.
  let gate: string | null = null;
  try {
    const risk = await computeLiveRiskState(sql, userId);
    if (risk.dailyHaltHit) gate = `Daily halt: day PnL ${risk.dayPnl.toFixed(2)} <= -${risk.dailyLimit.toFixed(2)}`;
    else if (risk.weeklyHaltHit) gate = `Weekly halt: week PnL ${risk.weekPnl.toFixed(2)} <= -${risk.weeklyLimit.toFixed(2)}`;
    if (!gate) {
      await assertOpenAllowed(sql, userId, {
        symbol: data.symbol,
        side: data.side,
        entry: data.entry,
        stop: data.stop,
        contracts: data.contracts,
        mode: "live",
        source: "desk",
        pathBand: data.pathBand,
        strategyPrimary: data.strategyPrimary,
        prescore: data.prescore,
        reason: data.reason,
      } as Parameters<typeof assertOpenAllowed>[2]);
    }
  } catch (e) {
    gate = e instanceof Error ? e.message : String(e);
  }
  const override = gate != null || (data.deskWord != null && data.deskWord !== "TAKE");

  const openedAt = data.filledAt ? new Date(data.filledAt) : new Date();
  const closing = data.exit != null;
  const closedAt = closing ? (data.exitedAt ? new Date(data.exitedAt) : new Date()) : null;
  const money = closing
    ? withRealizedPnl(
        computeTradePnl({
          symbol: data.symbol,
          side: data.side,
          entry: data.entry,
          exit: data.exit!,
          stop: data.stop ?? null,
          contracts: data.contracts,
          slippage: data.slippage,
        }),
        opts,
      )
    : null;

  if (!closing) {
    const existing = await sql.query<{ id: string }>(
      `select id from desk_trades
        where user_id = $1 and mode = 'live' and symbol = $2 and side = $3 and status = 'open'`,
      [userId, data.symbol, data.side],
    );
    if (existing.length) {
      throw new Error(
        `An open live ${data.side} in ${data.symbol} is already recorded. Close it (Book › Journal) first, or record this one with its exit.`,
      );
    }
  }

  const id = crypto.randomUUID();
  const rows = await sql.query<TradeRow>(
    `insert into desk_trades (
       id, user_id, mode, source, symbol, side, status, opened_at, closed_at,
       entry, stop, target, exit, contracts, pnl, r, commission, slippage,
       reason, prescore, grade, killzone, strategy, regime,
       desk_word, missing_layers, override, override_gate, path_band, why,
       why_pre, plan_entry, plan_stop, filled_at, state_rating, mistakes, exit_reason
     ) values (
       $1, $2, 'live', 'desk', $3, $4, $5, $6, $7,
       $8, $9, $10, $11, $12, $13, $14, $15, $16,
       $17, $18, $19, $20, $21, $22,
       $23, $24::jsonb, $25, $26, $27, $28,
       $29, $30, $31, $32, $33, $34::jsonb, $35
     )
     returning ${TRADE_COLUMNS}`,
    [
      id,
      userId,
      data.symbol,
      data.side,
      closing ? "closed" : "open",
      openedAt,
      closedAt,
      data.entry,
      data.stop ?? null,
      data.target ?? null,
      data.exit ?? null,
      data.contracts,
      money?.pnl ?? null,
      money?.r ?? null,
      money?.commission ?? 0,
      data.slippage,
      data.reason ?? null,
      data.prescore ?? null,
      // `grade` keeps the path band's coarse form for the legacy counters.
      data.pathBand === "A" ? "A-" : data.pathBand === "C" ? "skip" : (data.pathBand ?? null),
      data.killzone ?? null,
      data.strategyPrimary?.toLowerCase() ?? strategyFromReason(data.reason) ?? null,
      data.regime ?? null,
      data.deskWord ?? null,
      data.missingLayers ? JSON.stringify(data.missingLayers) : null,
      override,
      gate,
      data.pathBand ?? null,
      data.why ?? null,
      data.whyPre ?? null,
      data.planEntry ?? null,
      data.planStop ?? null,
      openedAt,
      data.stateRating ?? null,
      data.mistakes?.length ? JSON.stringify(data.mistakes) : null,
      data.exitReason ?? null,
    ],
  );

  await sql`
    insert into desk_events (user_id, ts, event, symbol, prescore, reason, source, payload)
    values (${userId}, ${openedAt}, 'ENTRY', ${data.symbol},
            ${data.prescore ?? null},
            ${`REAL FILL ${data.side} ${data.contracts}x @ ${data.entry}${override ? " · OVERRIDE" : ""}`},
            'desk',
            ${JSON.stringify({ tradeId: id, side: data.side, entry: data.entry, stop: data.stop ?? null, deskWord: data.deskWord ?? null, override, gate })}::jsonb)`;
  await appendAttestation(sql, { ...rows[0]!, user_id: userId }, "open");
  if (closing) {
    await sql`
      insert into desk_events (user_id, ts, event, symbol, prescore, reason, pnl, r, source, payload)
      values (${userId}, ${closedAt}, 'EXIT', ${data.symbol},
              ${data.prescore ?? null}, ${data.exitReason ?? `exit @ ${data.exit}`},
              ${money!.pnl}, ${money!.r}, 'desk',
              ${JSON.stringify({ tradeId: id, exit: data.exit, slippage: data.slippage })}::jsonb)`;
    await appendAttestation(sql, { ...rows[0]!, user_id: userId }, "close");
  }
  return mapTrade(rows[0]!);
}

