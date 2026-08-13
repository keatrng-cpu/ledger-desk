/**
 * Journal + risk-governor server functions (Phase 1).
 *
 * Every fn: authenticate (authMiddleware) -> authorize (scope by
 * context.userId) -> validate (zod). All SQL is parameterized via the shared
 * `Sql` surface (tagged template / $n placeholders) — never string
 * interpolation. PnL is NET of commission + slippage, using CONTRACTS point
 * values from src/lib/aplus/config.ts. The governor (getRiskState) is pure
 * SQL aggregates + deterministic math from src/lib/journal/risk.ts.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getSql, type Sql } from "@/lib/db";
import { authMiddleware } from "@/lib/auth/middleware";
import { APLUS_RULES, CONTRACTS, type ContractKey } from "@/lib/aplus/config";
import { computeTradePnl, isKnownSymbol } from "./pnl";
import { getSessionClock } from "@/lib/trading/sessions";
import { sendAlert, haltHitAlert } from "@/lib/alerts/send-server";
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

const SYMBOLS = Object.keys(CONTRACTS) as [ContractKey, ...ContractKey[]];

const symbolSchema = z.enum(SYMBOLS);
const sideSchema = z.enum(["long", "short"]);
const modeSchema = z.enum(["live", "paper"]);
const sourceSchema = z.enum(["desk", "engine", "paper"]);
const eventSchema = z.enum(["CANDIDATE", "SKIP", "ENTRY", "EXIT", "HALT"]);

const price = z.number().finite().positive();

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

type TradeRow = {
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
};

function iso(v: string | Date): string {
  return (v instanceof Date ? v : new Date(v)).toISOString();
}

function stringArray(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  return v.filter((x): x is string => typeof x === "string");
}

function mapTrade(row: TradeRow): JournalTrade {
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
  };
}

const TRADE_COLUMNS = `id, mode, source, symbol, side, status, opened_at,
  closed_at, entry, stop, target, exit, contracts, pnl, r, commission,
  slippage, reason, prescore, grade, killzone, components_present,
  components_missing`;

/* ------------------------------------------------------------------ */
/* Settings                                                           */
/* ------------------------------------------------------------------ */

const DEFAULT_EQUITY = 100_000;

async function readEquity(sql: Sql, userId: string): Promise<number> {
  const rows = await sql<{ equity: number }>`
    select equity from desk_settings where user_id = ${userId}`;
  return rows[0]?.equity ?? DEFAULT_EQUITY;
}

export const getSettings = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<DeskSettings> => {
    const sql = await getSql();
    const rows = await sql<{ equity: number; updated_at: string | Date }>`
      select equity, updated_at from desk_settings
      where user_id = ${context.userId}`;
    if (!rows[0]) return { equity: DEFAULT_EQUITY, updatedAt: null };
    return { equity: rows[0].equity, updatedAt: iso(rows[0].updated_at) };
  });

const updateEquitySchema = z.object({
  equity: z.number().finite().min(100).max(100_000_000),
});

export const updateEquity = createServerFn({ method: "POST" })
  .validator((input: unknown) => updateEquitySchema.parse(input))
  .middleware([authMiddleware])
  .handler(async ({ data, context }): Promise<DeskSettings> => {
    const sql = await getSql();
    const rows = await sql<{ equity: number; updated_at: string | Date }>`
      insert into desk_settings (user_id, equity, updated_at)
      values (${context.userId}, ${data.equity}, now())
      on conflict (user_id)
      do update set equity = excluded.equity, updated_at = now()
      returning equity, updated_at`;
    return { equity: rows[0]!.equity, updatedAt: iso(rows[0]!.updated_at) };
  });

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
async function computeLiveRiskState(
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
function bookOf(symbol: string): string {
  return symbol.replace(/^M(?=NQ$|ES$)/, "");
}

/** `strategy:mechanical` out of the reason line the desk writes at log time. */
function strategyFromReason(reason: string | null | undefined): string | null {
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
async function readBookCounters(
  sql: Sql,
  userId: string,
  mode: "live" | "paper",
  now: Date,
): Promise<{ counters: BookCounters; bookTakenToday: string | null }> {
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
function candidateFromOpenInput(data: {
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
  const { counters, bookTakenToday } = await readBookCounters(
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
  if (bookTakenToday && bookTakenToday !== bookOf(data.symbol)) {
    throw new Error(
      `One book per day: already took ${bookTakenToday} on the paper book this session (since 18:00 ET). ${bookOf(data.symbol)} is a second correlated book — that is one idea at double risk, not two trades.`,
    );
  }
}

/** Readable, in the same voice as the halt errors above. */
function pathGateError(
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

const openTradeSchema = z
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

export const openTrade = createServerFn({ method: "POST" })
  .validator((input: unknown) => openTradeSchema.parse(input))
  .middleware([authMiddleware])
  .handler(async ({ data, context }): Promise<JournalTrade> => {
    const sql = await getSql();

    // Server-side halt enforcement. The governor was previously advisory-only
    // (UI hid the Log button off a client poll that can be up to 30s stale) —
    // nothing stopped a direct call to this function from opening a live
    // trade past a halt. Paper trades are exempt: they exist specifically to
    // keep building the sample while live is halted (ROADMAP Phase 4).
    if (data.mode === "live") {
      const risk = await computeLiveRiskState(sql, context.userId);
      if (risk.dailyHaltHit) {
        const detail = `Day PnL ${risk.dayPnl.toFixed(2)} <= -${risk.dailyLimit.toFixed(2)}.`;
        void sendAlert(context.userId, haltHitAlert({ scope: "daily", detail })).catch(
          () => undefined,
        );
        throw new Error(`Daily halt active: ${detail} No new live entries today.`);
      }
      if (risk.weeklyHaltHit) {
        const detail = `Week PnL ${risk.weekPnl.toFixed(2)} <= -${risk.weeklyLimit.toFixed(2)}.`;
        void sendAlert(context.userId, haltHitAlert({ scope: "weekly", detail })).catch(
          () => undefined,
        );
        throw new Error(`Weekly halt active: ${detail} No new live entries this week.`);
      }
      if (risk.killzoneCapHit) {
        const detail = `${risk.entriesThisKillzone}/${risk.killzoneCap} in ${risk.killzoneLabel}.`;
        void sendAlert(context.userId, haltHitAlert({ scope: "killzone", detail })).catch(
          () => undefined,
        );
        throw new Error(`Killzone cap reached (${detail}) No new live entries this window.`);
      }
    }

    // Profit-rule gate (ROADMAP B1) — same pathTakeGate the backtest runs.
    // Live gets the whole gate; paper gets one-book-per-day only. The why is
    // documented on assertOpenAllowed above.
    await assertOpenAllowed(sql, context.userId, data);

    const now = new Date();
    const id = crypto.randomUUID();
    const present = data.componentsPresent
      ? JSON.stringify(data.componentsPresent)
      : null;
    const missing = data.componentsMissing
      ? JSON.stringify(data.componentsMissing)
      : null;

    // A partial unique index (migrations/0005) allows only ONE open position
    // per mode+symbol+side. Surface that as a readable message instead of a
    // raw Postgres constraint error — and note it is per MODE, so an open
    // paper position never blocks the equivalent live entry.
    const existing = await sql.query<{ id: string }>(
      `select id from desk_trades
        where user_id = $1 and mode = $2 and symbol = $3 and side = $4
          and status = 'open'`,
      [context.userId, data.mode, data.symbol, data.side],
    );
    if (existing.length) {
      throw new Error(
        `Already holding an open ${data.mode} ${data.side} in ${data.symbol}. Close it before adding another — one idea per instrument.`,
      );
    }

    const rows = await sql.query<TradeRow>(
      `insert into desk_trades (
         id, user_id, mode, source, symbol, side, status, opened_at, entry,
         stop, target, contracts, reason, prescore, grade, killzone,
         components_present, components_missing, strategy, regime
       ) values (
         $1, $2, $3, $4, $5, $6, 'open', $7, $8, $9, $10, $11, $12, $13,
         $14, $15, $16::jsonb, $17::jsonb, $18, $19
       )
       returning ${TRADE_COLUMNS}`,
      [
        id,
        context.userId,
        data.mode,
        data.source,
        data.symbol,
        data.side,
        now,
        data.entry,
        data.stop ?? null,
        data.target ?? null,
        data.contracts,
        data.reason ?? null,
        data.prescore ?? null,
        data.grade ?? null,
        data.killzone ?? null,
        present,
        missing,
        // Attribution for the Phase C scoreboard / regime matrix: the explicit
        // field, else the `strategy:x` the log dialog already writes into
        // reason. NULL stays NULL — never guess a model; an unattributed trade
        // is reported as unattributed rather than assigned to something.
        data.strategyPrimary?.toLowerCase() ??
          strategyFromReason(data.reason) ??
          null,
        data.regime ?? null,
      ],
    );

    await sql`
      insert into desk_events (user_id, ts, event, symbol, prescore, reason, source, payload)
      values (${context.userId}, ${now}, 'ENTRY', ${data.symbol},
              ${data.prescore ?? null},
              ${data.reason ?? `${data.side} ${data.contracts}x @ ${data.entry}`},
              ${data.source},
              ${JSON.stringify({ tradeId: id, side: data.side, entry: data.entry, stop: data.stop ?? null, target: data.target ?? null, contracts: data.contracts, grade: data.grade ?? null, killzone: data.killzone ?? null })}::jsonb)`;

    return mapTrade(rows[0]!);
  });

const closeTradeSchema = z.object({
  id: z.string().min(1).max(64),
  exit: price,
  slippage: z.number().finite().min(0).max(100_000).default(0),
  reason: z.string().max(500).optional(),
});

export type CloseTradeInput = z.input<typeof closeTradeSchema>;

export const closeTrade = createServerFn({ method: "POST" })
  .validator((input: unknown) => closeTradeSchema.parse(input))
  .middleware([authMiddleware])
  .handler(async ({ data, context }): Promise<JournalTrade> => {
    const sql = await getSql();
    const open = await sql.query<TradeRow>(
      `select ${TRADE_COLUMNS} from desk_trades
       where id = $1 and user_id = $2 and status = 'open'`,
      [data.id, context.userId],
    );
    const trade = open[0];
    if (!trade) throw new Error("Open trade not found");

    if (!isKnownSymbol(trade.symbol)) {
      throw new Error(`Unknown contract symbol: ${trade.symbol}`);
    }

    // Shared money math — paper uses the exact same function (see pnl.ts).
    const { pnl, commission, r } = computeTradePnl({
      symbol: trade.symbol,
      side: trade.side,
      entry: trade.entry,
      exit: data.exit,
      stop: trade.stop,
      contracts: trade.contracts,
      slippage: data.slippage,
    });

    const now = new Date();
    const rows = await sql.query<TradeRow>(
      `update desk_trades
       set status = 'closed', closed_at = $1, exit = $2, pnl = $3, r = $4,
           commission = $5, slippage = $6,
           reason = coalesce($7, reason)
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
        context.userId,
      ],
    );
    if (!rows[0]) throw new Error("Open trade not found");

    await sql`
      insert into desk_events (user_id, ts, event, symbol, prescore, reason, pnl, r, source, payload)
      values (${context.userId}, ${now}, 'EXIT', ${trade.symbol},
              ${trade.prescore}, ${data.reason ?? `exit @ ${data.exit}`},
              ${pnl}, ${r}, ${trade.source},
              ${JSON.stringify({ tradeId: trade.id, exit: data.exit, slippage: data.slippage })}::jsonb)`;

    return mapTrade(rows[0]);
  });

/* ------------------------------------------------------------------ */
/* Listing                                                            */
/* ------------------------------------------------------------------ */

const listTradesSchema = z.object({
  status: z.enum(["open", "closed"]).optional(),
  /**
   * REQUIRED in spirit: live and paper must never be summed into one metric.
   * Defaults to 'live' rather than "all" so that a caller which forgets to
   * specify cannot silently blend a clean paper sample into the live record.
   * Pass 'all' only for a view that visibly separates them by the `mode` field.
   *
   * This defaulted to everything until paper rows started landing in
   * desk_trades (paper-mirror.ts), at which point Path win rate — the metric
   * the whole unlock ladder gates on — began quietly averaging paper in.
   */
  mode: z.enum(["live", "paper", "all"]).default("live"),
  limit: z.number().int().min(1).max(500).default(200),
  offset: z.number().int().min(0).default(0),
});

export const listTrades = createServerFn({ method: "GET" })
  .validator((input: unknown) => listTradesSchema.parse(input ?? {}))
  .middleware([authMiddleware])
  .handler(async ({ data, context }): Promise<JournalTrade[]> => {
    const sql = await getSql();
    const where: string[] = ["user_id = $1"];
    const params: unknown[] = [context.userId];
    if (data.status) {
      params.push(data.status);
      where.push(`status = $${params.length}`);
    }
    if (data.mode !== "all") {
      params.push(data.mode);
      where.push(`mode = $${params.length}`);
    }
    params.push(data.limit, data.offset);
    const rows = await sql.query<TradeRow>(
      `select ${TRADE_COLUMNS} from desk_trades
        where ${where.join(" and ")}
        order by opened_at desc
        limit $${params.length - 1} offset $${params.length}`,
      params,
    );
    return rows.map(mapTrade);
  });

/* ------------------------------------------------------------------ */
/* Events                                                             */
/* ------------------------------------------------------------------ */

const logEventSchema = z.object({
  event: eventSchema,
  symbol: symbolSchema.optional(),
  prescore: z.number().min(0).max(1).optional(),
  reason: z.string().max(500).optional(),
  pnl: z.number().finite().optional(),
  r: z.number().finite().optional(),
  source: sourceSchema.default("desk"),
  payload: z.record(z.string(), z.unknown()).optional(),
});

export type LogEventInput = z.input<typeof logEventSchema>;

export const logEvent = createServerFn({ method: "POST" })
  .validator((input: unknown) => logEventSchema.parse(input))
  .middleware([authMiddleware])
  .handler(async ({ data, context }): Promise<{ id: number }> => {
    const sql = await getSql();
    const rows = await sql<{ id: number }>`
      insert into desk_events (user_id, ts, event, symbol, prescore, reason, pnl, r, source, payload)
      values (${context.userId}, ${new Date()}, ${data.event},
              ${data.symbol ?? null}, ${data.prescore ?? null},
              ${data.reason ?? null}, ${data.pnl ?? null}, ${data.r ?? null},
              ${data.source},
              ${data.payload ? JSON.stringify(data.payload) : null}::jsonb)
      returning id`;
    return { id: rows[0]!.id };
  });

const listEventsSchema = z.object({
  limit: z.number().int().min(1).max(200).default(50),
  offset: z.number().int().min(0).default(0),
  event: eventSchema.optional(),
});

type EventRow = {
  id: number;
  ts: string | Date;
  event: DeskEvent["event"];
  symbol: string | null;
  prescore: number | null;
  reason: string | null;
  pnl: number | null;
  r: number | null;
  source: DeskEvent["source"];
  payload: unknown;
};

export const listEvents = createServerFn({ method: "GET" })
  .validator((input: unknown) => listEventsSchema.parse(input ?? {}))
  .middleware([authMiddleware])
  .handler(async ({ data, context }): Promise<DeskEvent[]> => {
    const sql = await getSql();
    const rows = data.event
      ? await sql.query<EventRow>(
          `select id, ts, event, symbol, prescore, reason, pnl, r, source, payload
           from desk_events where user_id = $1 and event = $2
           order by ts desc, id desc limit $3 offset $4`,
          [context.userId, data.event, data.limit, data.offset],
        )
      : await sql.query<EventRow>(
          `select id, ts, event, symbol, prescore, reason, pnl, r, source, payload
           from desk_events where user_id = $1
           order by ts desc, id desc limit $2 offset $3`,
          [context.userId, data.limit, data.offset],
        );
    return rows.map((row) => ({
      id: row.id,
      ts: iso(row.ts),
      event: row.event,
      symbol: row.symbol,
      prescore: row.prescore,
      reason: row.reason,
      pnl: row.pnl,
      r: row.r,
      source: row.source,
      payload:
        row.payload && typeof row.payload === "object"
          ? (row.payload as Record<string, JsonValue>)
          : null,
    }));
  });

/* ------------------------------------------------------------------ */
/* Risk governor                                                      */
/* ------------------------------------------------------------------ */

export const getRiskState = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<RiskState> => {
    const sql = await getSql();
    return computeLiveRiskState(sql, context.userId);
  });

/** Re-export for UI risk-sizing display (equity * riskPct). */
export const RISK_PCT = APLUS_RULES.riskPct;
