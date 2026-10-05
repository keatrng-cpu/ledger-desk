/**
 * The executor's storage on Postgres (migrations/0018_room_orders.sql). Every statement is scoped to one
 * trader. `Query` is the one seam: the server passes `(t, p) => sql.query(t, p)`, the verifier passes
 * PGLite — so the verifier runs these exact statements against the real migration.
 */

import type { ExecState, ExecStore } from "./executor";
import { PHASES, type AuditRow, type BrokerQuote, type ExecPhase, type OrderIntent, type RowStatus } from "./types";

export type Query = (text: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;

const COLS = "client_order_id, phase, role, symbol, side, qty, limit_px, status, broker_status, reasons, broker_order_id, filled_qty, filled_avg_px, attempt, intent, quote, at_ms, updated_ms";

const json = <T>(x: unknown): T | null => {
  if (x == null) return null;
  if (typeof x === "string") {
    try {
      return JSON.parse(x) as T;
    } catch {
      return null;
    }
  }
  return x as T;
};
const num = (x: unknown): number | null => (x == null ? null : Number.isFinite(Number(x)) ? Number(x) : null);

export function rowOf(r: Record<string, unknown>): AuditRow {
  return {
    clientOrderId: String(r.client_order_id),
    phase: (PHASES.includes(r.phase as ExecPhase) ? r.phase : "off") as ExecPhase,
    role: r.role === "exit" ? "exit" : "entry",
    symbol: String(r.symbol),
    side: r.side === "sell" ? "sell" : "buy",
    qty: num(r.qty) ?? 0,
    limitPx: num(r.limit_px),
    status: String(r.status) as RowStatus,
    brokerStatus: r.broker_status == null ? null : String(r.broker_status),
    reasons: json<string[]>(r.reasons) ?? [],
    brokerOrderId: r.broker_order_id == null ? null : String(r.broker_order_id),
    filledQty: num(r.filled_qty) ?? 0,
    filledAvgPx: num(r.filled_avg_px),
    attempt: num(r.attempt) ?? 0,
    intent: json<OrderIntent>(r.intent) as OrderIntent,
    quote: json<BrokerQuote>(r.quote),
    atMs: num(r.at_ms) ?? 0,
    updatedMs: num(r.updated_ms) ?? 0,
  };
}

/** The columns an `update` may touch, and how each is bound. */
const PATCHABLE: Record<string, { col: string; jsonb?: boolean }> = {
  status: { col: "status" },
  brokerStatus: { col: "broker_status" },
  reasons: { col: "reasons", jsonb: true },
  brokerOrderId: { col: "broker_order_id" },
  filledQty: { col: "filled_qty" },
  filledAvgPx: { col: "filled_avg_px" },
  limitPx: { col: "limit_px" },
  quote: { col: "quote", jsonb: true },
  updatedMs: { col: "updated_ms" },
};

export class PgExecStore implements ExecStore {
  constructor(
    private readonly q: Query,
    private readonly userId: string,
  ) {}

  async state(): Promise<ExecState> {
    const r = (await this.q(`select wanted, wanted_at_ms, net_ms, killed, kill_reason from room_exec_state where user_id = $1`, [this.userId]))[0];
    if (!r) return { wanted: "off", wantedAtMs: null, netMs: null, killed: false, killReason: null };
    return {
      wanted: (PHASES.includes(r.wanted as ExecPhase) ? r.wanted : "off") as ExecPhase,
      wantedAtMs: num(r.wanted_at_ms),
      netMs: num(r.net_ms),
      killed: r.killed === true,
      killReason: r.kill_reason == null ? null : String(r.kill_reason),
    };
  }

  async setWanted(phase: ExecPhase, nowMs = Date.now()): Promise<void> {
    await this.q(
      `insert into room_exec_state (user_id, wanted, wanted_at_ms) values ($1, $2, $3)
       on conflict (user_id) do update set
         wanted_at_ms = case when room_exec_state.wanted is distinct from excluded.wanted then excluded.wanted_at_ms else room_exec_state.wanted_at_ms end,
         wanted = excluded.wanted,
         updated_at = now()`,
      [this.userId, phase, Math.round(nowMs)],
    );
  }

  /** The safety net ran (whether or not it had anything to sell). */
  async markNet(nowMs: number): Promise<void> {
    await this.q(
      `insert into room_exec_state (user_id, net_ms) values ($1, $2)
       on conflict (user_id) do update set net_ms = excluded.net_ms, updated_at = now()`,
      [this.userId, Math.round(nowMs)],
    );
  }

  async setKilled(killed: boolean, reason: string | null): Promise<void> {
    await this.q(
      `insert into room_exec_state (user_id, killed, kill_reason) values ($1, $2, $3)
       on conflict (user_id) do update set killed = excluded.killed, kill_reason = excluded.kill_reason, updated_at = now()`,
      [this.userId, killed, killed ? reason : null],
    );
  }

  async claimLease(deviceId: string, nowMs: number, leaseSec: number): Promise<boolean> {
    const rows = await this.q(
      `insert into room_exec_state (user_id, lease_holder, lease_ms) values ($1, $2, $3)
       on conflict (user_id) do update set lease_holder = excluded.lease_holder, lease_ms = excluded.lease_ms, updated_at = now()
       where room_exec_state.lease_holder is null
          or room_exec_state.lease_holder = excluded.lease_holder
          or room_exec_state.lease_ms < $4
       returning lease_holder`,
      [this.userId, deviceId, Math.round(nowMs), Math.round(nowMs - leaseSec * 1000)],
    );
    return rows.length === 1;
  }

  async reserve(row: AuditRow): Promise<{ inserted: boolean; row: AuditRow }> {
    const rows = await this.q(
      `insert into room_orders (user_id, ${COLS})
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12, $13, $14, $15, $16::jsonb, $17::jsonb, $18, $19)
       on conflict (user_id, client_order_id) do nothing
       returning client_order_id`,
      [
        this.userId,
        row.clientOrderId,
        row.phase,
        row.role,
        row.symbol,
        row.side,
        row.qty,
        row.limitPx,
        row.status,
        row.brokerStatus,
        JSON.stringify(row.reasons),
        row.brokerOrderId,
        row.filledQty,
        row.filledAvgPx,
        row.attempt,
        JSON.stringify(row.intent),
        row.quote ? JSON.stringify(row.quote) : null,
        Math.round(row.atMs),
        Math.round(row.updatedMs),
      ],
    );
    if (rows.length) return { inserted: true, row };
    const ex = (await this.q(`select ${COLS} from room_orders where user_id = $1 and client_order_id = $2`, [this.userId, row.clientOrderId]))[0];
    return { inserted: false, row: ex ? rowOf(ex) : row };
  }

  async update(clientOrderId: string, patch: Partial<AuditRow>): Promise<void> {
    const sets: string[] = [];
    const params: unknown[] = [this.userId, clientOrderId];
    for (const [k, spec] of Object.entries(PATCHABLE)) {
      if (!(k in patch)) continue;
      const v = (patch as Record<string, unknown>)[k];
      params.push(spec.jsonb ? (v == null ? null : JSON.stringify(v)) : k === "updatedMs" && typeof v === "number" ? Math.round(v) : v);
      sets.push(`${spec.col} = $${params.length}${spec.jsonb ? "::jsonb" : ""}`);
    }
    if (!sets.length) return;
    await this.q(`update room_orders set ${sets.join(", ")} where user_id = $1 and client_order_id = $2`, params);
  }

  async open(phase: ExecPhase): Promise<AuditRow[]> {
    const rows = await this.q(
      `select ${COLS} from room_orders where user_id = $1 and phase = $2 and status in ('reserved', 'working', 'error') order by id`,
      [this.userId, phase],
    );
    return rows.map(rowOf);
  }

  async recent(limit: number): Promise<AuditRow[]> {
    const rows = await this.q(`select ${COLS} from room_orders where user_id = $1 order by id desc limit $2`, [this.userId, limit]);
    return rows.map(rowOf);
  }

  async exitCounts(phase: ExecPhase, symbol: string, etDate: string): Promise<{ total: number; misses: number }> {
    const r = (
      await this.q(
        `select count(*)::int as total,
                (count(*) filter (where status in ('cancelled', 'rejected', 'error') and filled_qty = 0))::int as misses
           from room_orders
          where user_id = $1 and phase = $2 and role = 'exit' and symbol = $3 and intent->>'etDate' = $4`,
        [this.userId, phase, symbol, etDate],
      )
    )[0];
    return { total: num(r?.total) ?? 0, misses: num(r?.misses) ?? 0 };
  }

  async owned(phase: ExecPhase): Promise<Map<string, number>> {
    const rows = await this.q(
      `select symbol, sum(case when side = 'buy' then filled_qty else -filled_qty end)::int as net
         from room_orders
        where user_id = $1 and phase = $2 and filled_qty > 0
        group by symbol
       having sum(case when side = 'buy' then filled_qty else -filled_qty end) > 0`,
      [this.userId, phase],
    );
    return new Map(rows.map((r) => [String(r.symbol), num(r.net) ?? 0]));
  }

  async knownPositionIds(ids: string[]): Promise<Set<string>> {
    if (!ids.length) return new Set();
    const rows = await this.q(
      `select distinct intent->>'positionId' as pid from room_orders
        where user_id = $1 and role = 'entry' and intent->>'positionId' in (select jsonb_array_elements_text($2::jsonb))`,
      [this.userId, JSON.stringify(ids)],
    );
    return new Set(rows.map((r) => String(r.pid)));
  }

  async evidenceRows(limit: number): Promise<AuditRow[]> {
    const rows = await this.q(
      `select ${COLS} from room_orders where user_id = $1 and phase in ('paper', 'shadow') order by id desc limit $2`,
      [this.userId, limit],
    );
    return rows.map(rowOf);
  }
}
