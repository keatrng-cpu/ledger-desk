/**
 * Paper-futures journal (box: /workspace/paper-futures). Rows live ONLY in desk_paper_journal — never the live snapshot table —
 * so live win rate, PATH n-to-100, calibration (factor lifts, band edges) and live-trade metrics cannot see them.
 * Paper informs shadow/ablation analysis only until reviewed. Band edges are untouched by anything here.
 */
import type { Sql } from "@/lib/db";

export const PAPER_SOURCE = "paper-futures";
const eq = (a: string, b: string) => { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; };

/** Dedicated token only (no CRON_SECRET fallback): the paper writer cannot reach any other route's auth. */
export function paperAuthorized(header: string | null, env: Record<string, string | undefined> = process.env): boolean {
  const k = env.PAPER_JOURNAL_TOKEN?.trim(); const got = /^Bearer\s+(.+)$/i.exec((header ?? "").trim())?.[1]?.trim() ?? "";
  return Boolean(k && got && eq(got, k));
}

export type PaperRow = { id: string; source: string; signal?: string | null; symbol: string; side: string; band?: string | null; q?: number | null;
  result_R?: number | null; "pnl$"?: number | null; mfe_R?: number | null; mae_R?: number | null; outcome?: string | null; lesson?: string | null;
  live_would_block?: string[] | null; closed_at?: string | null };

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
export function safePaperRow(raw: unknown): { ok: true; row: PaperRow } | { ok: false; why: string } {
  if (!raw || typeof raw !== "object") return { ok: false, why: "not an object" };
  const r = raw as Record<string, unknown>;
  if (r.source !== PAPER_SOURCE) return { ok: false, why: `source must be ${PAPER_SOURCE}` };
  if (typeof r.id !== "string" || !r.id || r.id.length > 120) return { ok: false, why: "id" };
  if (!["ES", "MES", "NQ", "MNQ"].includes(String(r.symbol))) return { ok: false, why: "symbol" };
  if (!["long", "short"].includes(String(r.side))) return { ok: false, why: "side" };
  const s = JSON.stringify(r); if (s.length > 64_000) return { ok: false, why: "too large" };
  return { ok: true, row: r as unknown as PaperRow };
}

export async function insertPaperRow(sql: Sql, row: PaperRow, nowMs: number) {
  const closed = row.closed_at ? Date.parse(row.closed_at) : NaN;
  const r = await sql.query(
    `insert into desk_paper_journal (id, source, signal, symbol, side, band, q, result_r, pnl_usd, mfe_r, mae_r, outcome, lesson, live_would_block, closed_ms, received_ms, body)
     values ($1,'paper-futures',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14,$15,$16::jsonb) on conflict (id) do nothing returning id`,
    [row.id, row.signal ?? null, row.symbol, row.side, row.band ?? null, num(row.q), num(row.result_R), num(row["pnl$"]), num(row.mfe_R), num(row.mae_R),
      row.outcome ?? null, row.lesson ?? null, JSON.stringify(row.live_would_block ?? []), Number.isFinite(closed) ? closed : null, nowMs, JSON.stringify(row)]);
  return r.length > 0;
}

/** Paper-only stats view; also splits by "live chain would have blocked" so we can learn whether the blocks help. */
export async function paperStats(sql: Sql) {
  const rows = await sql.query<{ band: string | null; result_r: number | null; pnl_usd: number | null; blocked: boolean }>(
    `select band, result_r, pnl_usd, jsonb_array_length(live_would_block) > 0 as blocked from desk_paper_journal where source = 'paper-futures'`);
  const agg = (xs: typeof rows) => { const n = xs.length, w = xs.filter((x) => (x.pnl_usd ?? 0) > 0).length;
    const R = xs.reduce((a, x) => a + Number(x.result_r ?? 0), 0), usd = xs.reduce((a, x) => a + Number(x.pnl_usd ?? 0), 0);
    return { n, winRate: n ? +(w / n).toFixed(3) : null, avgR: n ? +(R / n).toFixed(2) : null, totalR: +R.toFixed(2), pnlUsd: +usd.toFixed(2) }; };
  const bands: Record<string, ReturnType<typeof agg>> = {};
  for (const b of [...new Set(rows.map((r) => r.band ?? "?"))]) bands[b] = agg(rows.filter((r) => (r.band ?? "?") === b));
  return { source: PAPER_SOURCE, scope: "shadow/ablation only — excluded from live stats, PATH n, calibration", all: agg(rows), byBand: bands,
    liveWouldBlock: agg(rows.filter((r) => r.blocked)), liveWouldFire: agg(rows.filter((r) => !r.blocked)) };
}
