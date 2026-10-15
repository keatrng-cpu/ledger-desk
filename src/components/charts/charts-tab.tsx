/** Charts tab — read-only list of every closed trade (live + paper) with its SMC chart and plain-English summary.
 * Static files only: public/trade-charts/index.json + <day>/<id>.png + <day>/<id>.json, written by
 * `python -m trade_charts publish` (size-capped, whitelisted fields, no secrets). No order buttons, no writes. */
import { useEffect, useMemo, useState } from "react";

import { filterRows, chartUrl as safe, type ChartRow, type Filter } from "@/lib/desk/trade-charts";

type Index = { schema: number; generated?: string; trades: ChartRow[] };

const ct = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleString("en-US", { timeZone: "America/Chicago", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }) + " CT" : "—";

export function ChartsTab() {
  const [idx, setIdx] = useState<Index | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [f, setF] = useState<Filter>("all");
  const [sel, setSel] = useState<string | null>(null);
  const [side, setSide] = useState<Record<string, unknown> | null>(null);
  useEffect(() => {
    fetch("/trade-charts/index.json", { cache: "no-store" }).then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((j: Index) => setIdx(j)).catch(() => setErr("No published charts yet."));
  }, []);
  const rows = useMemo(() => filterRows(idx?.trades ?? [], f), [idx, f]);
  const cur = rows.find((r) => r.id === sel) ?? null;
  useEffect(() => {
    setSide(null); if (!cur) return;
    const u = safe(cur.json); if (!u) return;
    fetch(u).then((r) => r.json()).then(setSide).catch(() => setSide(null));
  }, [cur]);
  if (err) return <div className="text-sm text-[var(--color-muted)]">{err}</div>;
  if (!idx) return <div className="text-sm text-[var(--color-muted)]">Loading charts…</div>;
  const feats = (side?.features ?? {}) as Record<string, unknown>;
  return (
    <div className="space-y-3 text-sm">
      <div className="flex items-center gap-2">
        {(["all", "win", "loss"] as Filter[]).map((k) => (
          <button key={k} type="button" onClick={() => setF(k)} aria-pressed={f === k}
            className={`rounded-full border px-3 py-1 ${f === k ? "border-[var(--color-primary)] text-[var(--color-fg)]" : "border-[var(--color-border)] text-[var(--color-muted)]"}`}>
            {k === "all" ? `All (${idx.trades.length})` : k === "win" ? "Wins" : "Losses"}
          </button>
        ))}
        <span className="ml-auto text-xs text-[var(--color-subtle)]">read-only · generated {ct(idx.generated)}</span>
      </div>
      <div className="grid gap-3 lg:grid-cols-[minmax(260px,1fr)_3fr]">
        <ul className="max-h-[75vh] space-y-1 overflow-auto">
          {rows.map((r) => (
            <li key={r.id}>
              <button type="button" onClick={() => setSel(r.id)}
                className={`w-full rounded border px-2 py-1.5 text-left ${sel === r.id ? "border-[var(--color-primary)]" : "border-[var(--color-border)]"}`}>
                <div className="flex justify-between">
                  <span className="font-semibold">{r.symbol} {r.side.toUpperCase()} {r.band ?? ""}</span>
                  <span className={(r.R ?? 0) > 0 ? "text-emerald-400" : (r.R ?? 0) < 0 ? "text-rose-400" : "text-amber-300"}>
                    {typeof r.R === "number" ? `${r.R >= 0 ? "+" : ""}${r.R.toFixed(2)}R` : "—"}
                  </span>
                </div>
                <div className="text-xs text-[var(--color-muted)]">{ct(r.fill_t)} · {r.source}</div>
              </button>
            </li>
          ))}
        </ul>
        <div>
          {!cur && <div className="text-[var(--color-muted)]">Pick a trade to open its chart.</div>}
          {cur && (
            <div className="space-y-2">
              {cur.summary && <p className="rounded border border-[var(--color-border)] p-2">{cur.summary}</p>}
              {safe(cur.png) && <img src={safe(cur.png)} alt={`${cur.symbol} ${cur.side} chart ${cur.id}`} className="w-full rounded border border-[var(--color-border)]" loading="lazy" />}
              {side && (
                <dl className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs md:grid-cols-4">
                  {["session_phase", "premium_pct", "ifvg_against", "sweep_with_before", "in_with_fvg", "in_with_ob", "htf_aligned", "rr_from_fill", "mfe_R", "mae_R"].map((k) => (
                    <div key={k} className="flex justify-between gap-2"><dt className="text-[var(--color-muted)]">{k}</dt><dd>{String(feats[k] ?? "—")}</dd></div>
                  ))}
                </dl>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
