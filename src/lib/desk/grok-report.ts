/**
 * What Grok reports back after the floor hands over a ticket.
 * One row, shared by the connector and the desk poll.
 */
import type { Sql } from "@/lib/db";
import type { DeskListenCard } from "@/lib/trading/desk-listen";

export const GROK_STATUSES = ["placed", "stood", "managing", "closed"] as const;
export type GrokStatus = (typeof GROK_STATUSES)[number];

export interface GrokReport {
  taken: boolean;
  status: GrokStatus;
  pnl: number | null;
  journal: string;
  underlier: string | null;
  side: string | null;
  contracts: number | null;
  entry: number | null;
  exit: number | null;
  reason: string | null;
  at: string;
}

function str(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (!t) return null;
  return t.slice(0, max);
}

function num(v: unknown): number | null {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  return v;
}

export function parseGrokReport(raw: unknown, nowMs = Date.now()): GrokReport {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const status = o.status;
  if (typeof o.taken !== "boolean") throw new Error("taken must be true or false");
  if (typeof status !== "string" || !(GROK_STATUSES as readonly string[]).includes(status)) {
    throw new Error("status must be placed, stood, managing, or closed");
  }
  const journal = str(o.journal, 1500);
  if (!journal) throw new Error("journal paragraph is required");
  return {
    taken: o.taken,
    status: status as GrokStatus,
    pnl: num(o.pnl),
    journal,
    underlier: str(o.underlier, 12),
    side: str(o.side, 8),
    contracts: num(o.contracts),
    entry: num(o.entry),
    exit: num(o.exit),
    reason: str(o.reason, 240),
    at: new Date(nowMs).toISOString(),
  };
}

export function reportLine(report: GrokReport): string {
  const pnl = report.pnl == null ? "pnl unread" : `${report.pnl >= 0 ? "+" : ""}$${report.pnl.toFixed(2)}`;
  const what = [report.underlier, report.side, report.contracts != null ? `${report.contracts}ct` : null].filter(Boolean).join(" ");
  return `Grok ${report.status}. Taken ${report.taken ? "yes" : "no"}. ${pnl}.${what ? ` ${what}.` : ""} ${report.journal}`;
}

export function attachGrokReport(card: DeskListenCard, report: GrokReport | null): DeskListenCard {
  if (!report) return { ...card, report: null };
  return {
    ...card,
    report,
    said: [...card.said, { who: "Sterling", line: reportLine(report) }],
  };
}

function fromRow(row: { taken: boolean; pnl: unknown; journal: string; detail: unknown; at_ms: unknown }): GrokReport {
  const detail = (typeof row.detail === "string" ? JSON.parse(row.detail) : row.detail) as Record<string, unknown> | null;
  const d = detail && typeof detail === "object" ? detail : {};
  const atMs = typeof row.at_ms === "number" ? row.at_ms : Number(row.at_ms);
  return {
    taken: row.taken,
    status: (GROK_STATUSES as readonly string[]).includes(String(d.status)) ? (d.status as GrokStatus) : row.taken ? "placed" : "stood",
    pnl: row.pnl == null ? null : Number(row.pnl),
    journal: row.journal,
    underlier: typeof d.underlier === "string" ? d.underlier : null,
    side: typeof d.side === "string" ? d.side : null,
    contracts: typeof d.contracts === "number" ? d.contracts : null,
    entry: typeof d.entry === "number" ? d.entry : null,
    exit: typeof d.exit === "number" ? d.exit : null,
    reason: typeof d.reason === "string" ? d.reason : null,
    at: new Date(Number.isFinite(atMs) ? atMs : Date.now()).toISOString(),
  };
}

export async function readGrokReport(sql: Sql): Promise<GrokReport | null> {
  const rows = await sql.query<{ taken: boolean; pnl: unknown; journal: string; detail: unknown; at_ms: unknown }>(
    `select taken, pnl, journal, detail, at_ms from grok_desk_report where id = 'latest' limit 1`,
  );
  const row = rows[0];
  return row ? fromRow(row) : null;
}

export async function writeGrokReport(sql: Sql, raw: unknown): Promise<GrokReport> {
  const report = parseGrokReport(raw);
  const detail = {
    status: report.status,
    underlier: report.underlier,
    side: report.side,
    contracts: report.contracts,
    entry: report.entry,
    exit: report.exit,
    reason: report.reason,
  };
  await sql.query(
    `insert into grok_desk_report (id, taken, pnl, journal, detail, at_ms)
     values ('latest', $1, $2, $3, $4::jsonb, $5)
     on conflict (id) do update set
       taken = excluded.taken,
       pnl = excluded.pnl,
       journal = excluded.journal,
       detail = excluded.detail,
       at_ms = excluded.at_ms`,
    [report.taken, report.pnl, report.journal, JSON.stringify(detail), Date.parse(report.at)],
  );
  return report;
}
