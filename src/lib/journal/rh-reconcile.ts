/**
 * Auto-journal of LIVE Robinhood option round-trips (account 995386158).
 *
 * The closed loop the trader asked for:
 *   1. INGEST   — pull get_option_orders + get_pnl_trade_history (read-only).
 *   2. ROUND-TRIP — FIFO-pair opens->closes per option_id into one cycle each
 *                   (what the option was: strike/type/qty/debit->credit).
 *   3. ATTRIBUTE — bind each cycle to the desk card that suggested it
 *                  (desk_card_journal: band, entry/stop/target, the reasons).
 *   4. OUTCOME   — realized $ (pnl-history authoritative), ROI, hold, win,
 *                  hit-target — written to rh_fill_journal.
 *
 * Pure builders (execsFromOrders / roundTripsFromOrders / attachRealized /
 * analyzeRhJournal) are unit-tested against real fills in
 * scripts/rh-reconcile.test.mjs. Nothing here can place an order.
 */
import type { Sql } from "@/lib/db";

// ---------------------------------------------------------------- pure layer

export interface RawExec {
  optionId: string;
  side: "buy" | "sell";
  effect: "open" | "close";
  qty: number;
  price: number; // per-contract premium
  ts: number; // ms
  orderId: string;
  underlying: string; // chain_symbol, e.g. QQQ
  optionType: "call" | "put" | null;
  strike: number | null;
  expiration: string | null; // yyyy-mm-dd
}

export interface RhRoundTrip {
  optionId: string;
  underlying: string;
  optionType: "call" | "put" | null;
  strike: number | null;
  expiration: string | null;
  side: "long" | "short"; // call=long, put=short
  cycle: number; // 0,1,… if the same contract is re-opened same day
  contracts: number;
  openedAt: number | null;
  openOrderId: string | null;
  debit: number | null; // avg per-contract open premium
  debitTotal: number | null; // $ out
  closedAt: number | null;
  closeCount: number;
  credit: number | null; // avg per-contract close premium
  creditTotal: number | null; // $ in
  realized: number | null; // net $ (exec-derived; overridden by pnl-history)
  roi: number | null;
  holdSecs: number | null;
  status: "open" | "closed";
}

function n(x: unknown): number | null {
  const v = typeof x === "number" ? x : typeof x === "string" && x.trim() !== "" ? Number(x) : NaN;
  return Number.isFinite(v) ? v : null;
}

/** Orders payload (get_option_orders .data) -> flat executions, oldest first. */
export function execsFromOrders(orders: unknown): RawExec[] {
  const list = Array.isArray(orders)
    ? orders
    : Array.isArray((orders as { orders?: unknown })?.orders)
      ? (orders as { orders: unknown[] }).orders
      : [];
  const out: RawExec[] = [];
  for (const raw of list) {
    const o = raw as Record<string, unknown>;
    if (String(o.state ?? "") !== "filled") continue;
    const underlying = String(o.chain_symbol ?? o.symbol ?? "");
    const legs = Array.isArray(o.legs) ? (o.legs as Record<string, unknown>[]) : [];
    for (const leg of legs) {
      const side = String(leg.side ?? "") === "sell" ? "sell" : "buy";
      const effect = String(leg.position_effect ?? "") === "close" ? "close" : "open";
      const optionType = ((): "call" | "put" | null => {
        const t = String(leg.option_type ?? "").toLowerCase();
        return t === "call" || t === "put" ? t : null;
      })();
      const strike = n(leg.strike_price);
      const expiration = typeof leg.expiration_date === "string" ? leg.expiration_date : null;
      const optionId = String(leg.option_id ?? "");
      const execs = Array.isArray(leg.executions) ? (leg.executions as Record<string, unknown>[]) : [];
      for (const e of execs) {
        const qty = n(e.quantity);
        const price = n(e.price);
        const ts = Date.parse(String(e.timestamp ?? o.updated_at ?? o.created_at ?? ""));
        if (qty == null || price == null || !Number.isFinite(ts) || !optionId) continue;
        out.push({ optionId, side, effect, qty, price, ts, orderId: String(o.id ?? ""), underlying, optionType, strike, expiration });
      }
    }
  }
  return out.sort((a, b) => a.ts - b.ts);
}

/**
 * FIFO-pair executions into round-trip cycles, one per option_id per open->flat
 * cycle. Weighted-avg debit/credit; realized = Σ(close-open)·qty·100 (fees are
 * folded in later from pnl-history). Unflattened remainder -> status "open".
 */
export function roundTripsFromOrders(orders: unknown): RhRoundTrip[] {
  const execs = execsFromOrders(orders);
  const byId = new Map<string, RawExec[]>();
  for (const e of execs) {
    const arr = byId.get(e.optionId) ?? [];
    arr.push(e);
    byId.set(e.optionId, arr);
  }
  const trips: RhRoundTrip[] = [];
  for (const [optionId, list] of byId) {
    let cycleIdx = 0;
    // running cycle state
    let openLots: { qty: number; price: number; ts: number; orderId: string }[] = [];
    let openQtyTotal = 0;
    let openCostTotal = 0;
    let openTs: number | null = null;
    let openOrderId: string | null = null;
    let closedQty = 0;
    let closeProceeds = 0;
    let closeMatchedOpenCost = 0;
    let closeTs: number | null = null;
    const closeOrders = new Set<string>();
    const meta = list[0];

    const flush = (status: "open" | "closed") => {
      if (openTs == null && closedQty === 0) return;
      const contracts = status === "closed" ? closedQty : openQtyTotal + closedQty;
      const debit = contracts > 0 ? (status === "closed" ? closeMatchedOpenCost / closedQty : openCostTotal / Math.max(1, openQtyTotal + closedQty)) : null;
      const credit = closedQty > 0 ? closeProceeds / closedQty : null;
      const realized = closedQty > 0 ? (closeProceeds - closeMatchedOpenCost) * 100 : null;
      const debitTotal = debit != null ? debit * contracts * 100 : null;
      const creditTotal = credit != null ? credit * closedQty * 100 : null;
      trips.push({
        optionId,
        underlying: meta.underlying,
        optionType: meta.optionType,
        strike: meta.strike,
        expiration: meta.expiration,
        side: meta.optionType === "put" ? "short" : "long",
        cycle: cycleIdx,
        contracts,
        openedAt: openTs,
        openOrderId,
        debit,
        debitTotal,
        closedAt: status === "closed" ? closeTs : null,
        closeCount: closeOrders.size,
        credit,
        creditTotal,
        realized,
        roi: realized != null && closeMatchedOpenCost > 0 ? realized / (closeMatchedOpenCost * 100) : null,
        holdSecs: openTs != null && closeTs != null ? Math.round((closeTs - openTs) / 1000) : null,
        status,
      });
      cycleIdx += 1;
    };

    const reset = () => {
      openLots = [];
      openQtyTotal = 0;
      openCostTotal = 0;
      openTs = null;
      openOrderId = null;
      closedQty = 0;
      closeProceeds = 0;
      closeMatchedOpenCost = 0;
      closeTs = null;
      closeOrders.clear();
    };

    for (const e of list) {
      if (e.effect === "open") {
        if (openTs == null) {
          openTs = e.ts;
          openOrderId = e.orderId;
        }
        openLots.push({ qty: e.qty, price: e.price, ts: e.ts, orderId: e.orderId });
        openQtyTotal += e.qty;
        openCostTotal += e.qty * e.price;
      } else {
        // close: FIFO-consume open lots
        let remaining = e.qty;
        while (remaining > 0 && openLots.length > 0) {
          const lot = openLots[0];
          const take = Math.min(remaining, lot.qty);
          closeMatchedOpenCost += take * lot.price;
          closeProceeds += take * e.price;
          closedQty += take;
          lot.qty -= take;
          openQtyTotal -= take;
          remaining -= take;
          if (lot.qty <= 1e-9) openLots.shift();
        }
        closeTs = e.ts;
        if (e.orderId) closeOrders.add(e.orderId);
        // cycle complete when flat
        if (openQtyTotal <= 1e-9) {
          flush("closed");
          reset();
        }
      }
    }
    // leftover open position (not flattened) -> an open row
    if (openQtyTotal > 1e-9 || closedQty > 0) flush(openQtyTotal > 1e-9 ? "open" : "closed");
  }
  return trips.sort((a, b) => (a.openedAt ?? 0) - (b.openedAt ?? 0));
}

export interface PnlTrade { timestamp: number; symbol: string; side: string; quantity: number; realizedGain: number | null }

/** get_pnl_trade_history .data.trades -> normalized. */
export function pnlTradesFrom(body: unknown): PnlTrade[] {
  const trades = Array.isArray((body as { trades?: unknown })?.trades)
    ? (body as { trades: unknown[] }).trades
    : Array.isArray(body)
      ? (body as unknown[])
      : [];
  return trades
    .map((t) => {
      const r = t as Record<string, unknown>;
      return {
        timestamp: Date.parse(String(r.timestamp ?? "")),
        symbol: String(r.symbol ?? ""),
        side: String(r.side ?? ""),
        quantity: n(r.quantity) ?? 0,
        realizedGain: n(r.realized_gain),
      };
    })
    .filter((t) => Number.isFinite(t.timestamp));
}

/**
 * Overlay broker-authoritative realized P&L onto each closed cycle: sum the
 * pnl-history sells whose timestamp falls in (openedAt, closedAt] for the same
 * underlying. Falls back to the exec-derived realized when unmatched.
 */
export function attachRealized(trips: RhRoundTrip[], pnl: PnlTrade[]): RhRoundTrip[] {
  return trips.map((t) => {
    if (t.status !== "closed" || t.openedAt == null || t.closedAt == null) return t;
    const matched = pnl.filter(
      (p) => p.side === "sell" && p.symbol === t.underlying && p.timestamp >= t.openedAt! - 1500 && p.timestamp <= t.closedAt! + 1500 && p.realizedGain != null,
    );
    if (matched.length === 0) return t;
    const realized = matched.reduce((s, p) => s + (p.realizedGain ?? 0), 0);
    const roi = t.debitTotal && t.debitTotal > 0 ? realized / t.debitTotal : t.roi;
    return { ...t, realized, roi, win: realized > 0 } as RhRoundTrip & { win: boolean };
  });
}

// ------------------------------------------------------- card attribution

/** Underlier symbols a QQQ/SPY option expresses, for matching a desk card. */
const UNDERLIER_ALIASES: Record<string, string[]> = {
  QQQ: ["NQ", "MNQ", "QQQ"],
  SPY: ["ES", "MES", "SPY"],
};

function etDayKey(ms: number): string {
  return new Date(ms).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

/** Coarse ICT killzone label from the ET time of day. */
export function killzoneFor(ms: number): string {
  const hm = new Date(ms).toLocaleTimeString("en-GB", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false });
  const [h, m] = hm.split(":").map(Number);
  const t = h * 60 + m;
  if (t >= 570 && t < 660) return "nyAm"; // 09:30–11:00
  if (t >= 450 && t < 570) return "preMarket"; // 07:30–09:30
  if (t >= 660 && t < 810) return "nyLunch"; // 11:00–13:30
  if (t >= 810 && t < 960) return "nyPm"; // 13:30–16:00
  return "off";
}

interface CardRow {
  id: string;
  symbol: string;
  side: string;
  band: string | null;
  entry: number | null;
  stop: number | null;
  target: number | null;
  rr: number | null;
  opened_ms: number | null;
  signal: string | null;
  context: unknown;
  review: unknown;
}

/** Distil the "why it was suggested" from a card-journal context blob. */
export function whyFromContext(context: unknown): unknown {
  const c = (context ?? {}) as Record<string, unknown>;
  const pick = (k: string) => (c[k] === undefined ? undefined : c[k]);
  const why: Record<string, unknown> = {};
  for (const k of ["capReasons", "reasons", "thesis", "brain", "blocks", "word", "missing", "displacement", "sweep", "judas", "loss", "ev", "entryState"]) {
    const v = pick(k);
    if (v !== undefined) why[k] = v;
  }
  return Object.keys(why).length ? why : (context ?? null);
}

/** Find the card that most likely suggested a round-trip: signal first, else nearest same-side card. */
async function bindCard(sql: Sql, trip: RhRoundTrip): Promise<CardRow & { match: "signal" | "time" | "none" } | { match: "none" }> {
  if (trip.openedAt == null) return { match: "none" };
  const dayKey = etDayKey(trip.openedAt);
  const aliases = UNDERLIER_ALIASES[trip.underlying] ?? [trip.underlying];
  const windowMs = 20 * 60 * 1000; // ±20m around the open fill
  let rows: CardRow[] = [];
  try {
    rows = await sql.query<CardRow>(
      `select id, symbol, side, band, entry, stop, target, rr, opened_ms, signal, context, review
         from desk_card_journal
        where day_key = $1
          and symbol = any($2)
          and lower(side) = $3
          and opened_ms is not null
          and abs(opened_ms - $4) <= $5
        order by abs(opened_ms - $4) asc
        limit 1`,
      [dayKey, aliases, trip.side, trip.openedAt, windowMs],
    );
  } catch {
    return { match: "none" };
  }
  if (rows.length === 0) return { match: "none" };
  return { ...rows[0], match: rows[0].signal ? "signal" : "time" };
}

// ------------------------------------------------------- orchestrator

export interface ReconcileResult {
  ok: boolean;
  reason?: string;
  account: string;
  dayKey: string;
  trips: number;
  closed: number;
  realizedTotal: number;
  bound: number;
  rows: Array<Record<string, unknown>>;
}

/**
 * Pull today's (or `opts.since`) RH option activity, build round-trips, bind
 * each to its card, and upsert rh_fill_journal. Read-only against Robinhood.
 */
export async function reconcileRhFills(
  sql: Sql,
  userId: string,
  opts?: { since?: string; account?: string },
): Promise<ReconcileResult> {
  const { RH_PREFERRED_ACCOUNT_NUMBER } = await import("@/lib/execution/rh-autofire-gates");
  const { toolingForDesk } = await import("@/lib/execution/rh-mcp");
  const account = opts?.account ?? RH_PREFERRED_ACCOUNT_NUMBER;
  const tooling = await toolingForDesk(sql, userId);
  if (!tooling?.raw) return empty(account, "Robinhood is not connected (no stored sign-in).");

  const since = opts?.since ?? new Date(Date.now() - 36 * 3600 * 1000).toISOString();
  let ordersBody: unknown;
  let pnlBody: unknown;
  try {
    ordersBody = await tooling.raw("get_option_orders", { account_number: account, created_at_gte: since });
    pnlBody = await tooling.raw("get_pnl_trade_history", { account_number: account, span: "week" });
  } catch (err) {
    return empty(account, err instanceof Error ? err.message : "Robinhood read failed.");
  }

  const trips = attachRealized(roundTripsFromOrders(ordersBody), pnlTradesFrom(pnlBody));
  let bound = 0;
  const rows: Array<Record<string, unknown>> = [];
  for (const t of trips) {
    const card = await bindCard(sql, t);
    const matched = card.match !== "none";
    if (matched) bound += 1;
    const dayKey = t.openedAt != null ? etDayKey(t.openedAt) : etDayKey(Date.now());
    const id = `${account}:${t.optionId}:${dayKey}:${t.cycle}`;
    const realized = t.realized;
    const win = t.status === "closed" && realized != null ? realized > 0 : null;
    const hitTarget = win; // for a scalp the realized sign is the outcome; refined later vs plan_target
    const why = matched ? whyFromContext((card as CardRow).context) : null;
    const row = {
      id,
      user_id: userId,
      account_number: account,
      day_key: dayKey,
      underlying: t.underlying,
      option_type: t.optionType,
      strike: t.strike,
      expiration: t.expiration,
      dte: t.expiration ? Math.max(0, Math.round((Date.parse(t.expiration + "T20:00:00Z") - (t.openedAt ?? Date.now())) / 86400000)) : null,
      side: t.side,
      contracts: t.contracts,
      opened_at: t.openedAt != null ? new Date(t.openedAt).toISOString() : null,
      open_order_id: t.openOrderId,
      debit: t.debit,
      debit_total: t.debitTotal,
      closed_at: t.closedAt != null ? new Date(t.closedAt).toISOString() : null,
      close_count: t.closeCount,
      credit: t.credit,
      credit_total: t.creditTotal,
      realized,
      roi: t.roi,
      hold_secs: t.holdSecs,
      status: t.status,
      win,
      card_match: card.match,
      card_id: matched ? (card as CardRow).id : null,
      card_signal: matched ? (card as CardRow).signal : null,
      card_band: matched ? (card as CardRow).band : null,
      card_side: matched ? (card as CardRow).side : null,
      card_symbol: matched ? (card as CardRow).symbol : null,
      plan_entry: matched ? (card as CardRow).entry : null,
      plan_stop: matched ? (card as CardRow).stop : null,
      plan_target: matched ? (card as CardRow).target : null,
      plan_rr: matched ? (card as CardRow).rr : null,
      why,
      card: matched ? (card as CardRow).context ?? null : null,
      slippage: null,
      hit_target: hitTarget,
      killzone: t.openedAt != null ? killzoneFor(t.openedAt) : null,
      notes: null,
    };
    rows.push(row);
    await upsertRow(sql, row);
  }

  const closed = trips.filter((t) => t.status === "closed");
  return {
    ok: true,
    account,
    dayKey: etDayKey(Date.now()),
    trips: trips.length,
    closed: closed.length,
    realizedTotal: closed.reduce((s, t) => s + (t.realized ?? 0), 0),
    bound,
    rows,
  };
}

function empty(account: string, reason: string): ReconcileResult {
  return { ok: false, reason, account, dayKey: new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" }), trips: 0, closed: 0, realizedTotal: 0, bound: 0, rows: [] };
}

async function upsertRow(sql: Sql, r: Record<string, unknown>): Promise<void> {
  const cols = Object.keys(r);
  const vals = cols.map((c) => {
    const v = r[c];
    return c === "why" || c === "card" ? (v == null ? null : JSON.stringify(v)) : v;
  });
  const placeholders = cols.map((_, i) => `$${i + 1}`).join(", ");
  const updates = cols.filter((c) => c !== "id").map((c) => `${c} = excluded.${c}`).join(", ");
  await sql.query(
    `insert into rh_fill_journal (${cols.join(", ")}) values (${placeholders})
       on conflict (id) do update set ${updates}, updated_at = now()`,
    vals,
  );
}

// ------------------------------------------------------- analyzer / learning

export interface JournalAgg {
  n: number;
  wins: number;
  winRate: number;
  realizedTotal: number;
  avgRealized: number;
  avgRoi: number;
  avgHoldSecs: number;
}

export interface RhAnalysis {
  overall: JournalAgg;
  byBand: Record<string, JournalAgg>;
  bySide: Record<string, JournalAgg>;
  byKillzone: Record<string, JournalAgg>;
  unbound: number;
}

function agg(rows: Array<{ realized: number | null; roi: number | null; hold_secs: number | null; win: boolean | null }>): JournalAgg {
  const closed = rows.filter((r) => r.realized != null);
  const nn = closed.length;
  const wins = closed.filter((r) => r.win === true).length;
  const realizedTotal = closed.reduce((s, r) => s + (r.realized ?? 0), 0);
  const roiVals = closed.map((r) => r.roi).filter((x): x is number => x != null);
  const holds = closed.map((r) => r.hold_secs).filter((x): x is number => x != null);
  return {
    n: nn,
    wins,
    winRate: nn ? wins / nn : 0,
    realizedTotal,
    avgRealized: nn ? realizedTotal / nn : 0,
    avgRoi: roiVals.length ? roiVals.reduce((s, x) => s + x, 0) / roiVals.length : 0,
    avgHoldSecs: holds.length ? Math.round(holds.reduce((s, x) => s + x, 0) / holds.length) : 0,
  };
}

/** Aggregate the journal into the learning view: which cards actually pay. */
export function analyzeRhJournal(
  rows: Array<{ realized: number | null; roi: number | null; hold_secs: number | null; win: boolean | null; card_band: string | null; side: string | null; killzone: string | null; card_match: string | null }>,
): RhAnalysis {
  const groupBy = (key: (r: (typeof rows)[number]) => string | null): Record<string, JournalAgg> => {
    const buckets = new Map<string, typeof rows>();
    for (const r of rows) {
      const k = key(r) ?? "—";
      const arr = buckets.get(k) ?? [];
      arr.push(r);
      buckets.set(k, arr);
    }
    const out: Record<string, JournalAgg> = {};
    for (const [k, v] of buckets) out[k] = agg(v);
    return out;
  };
  return {
    overall: agg(rows),
    byBand: groupBy((r) => r.card_band),
    bySide: groupBy((r) => r.side),
    byKillzone: groupBy((r) => r.killzone),
    unbound: rows.filter((r) => r.card_match === "none" || r.card_match == null).length,
  };
}
