/** Pure helpers for the read-only Charts tab (public/trade-charts/index.json, written by `python -m trade_charts publish`). */
export type ChartRow = {
  id: string; day: string; symbol: string; side: string; source: string; band?: string | null;
  fill_t: string; exit_t?: string | null; fill_px?: number | null; exit_px?: number | null;
  R?: number | null; paper_pnl_usd?: number | null; summary?: string | null; png: string; json: string;
};
export type Filter = "all" | "win" | "loss";

/** Newest first, then the win/loss filter (a flat 0R trade is neither a win nor a loss). */
export function filterRows(rows: ChartRow[], f: Filter): ChartRow[] {
  const s = [...rows].sort((a, b) => Date.parse(b.fill_t) - Date.parse(a.fill_t));
  if (f === "win") return s.filter((r) => (r.R ?? 0) > 0);
  if (f === "loss") return s.filter((r) => (r.R ?? 0) < 0);
  return s;
}

/** Only `<YYYY-MM-DD>/<safe name>.png|json` under /trade-charts is ever fetched (no traversal, no other origin). */
export function chartUrl(p: string): string {
  return /^[0-9]{4}-[0-9]{2}-[0-9]{2}\/[A-Za-z0-9_-][A-Za-z0-9._-]*\.(png|json)$/.test(p) && !p.includes("..") ? `/trade-charts/${p}` : "";
}
