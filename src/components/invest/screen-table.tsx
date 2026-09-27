/**
 * THE SCREEN — every captured company side by side, columns kept apart.
 *
 * Sorting by one column is a lens, not a ranking: there is no composite
 * here and there will not be one (factors.ts). Rows without a dossier are
 * screen rows only — the completeness gate refuses them — and say so.
 * The default sort is the tab's one arithmetic question: how much growth
 * does today's price already require?
 */

import { useMemo, useState } from "react";
import { allFundamentals } from "@/lib/invest/universe";
import { dossierFor, RISK_FREE } from "@/lib/invest/dossiers";
import { impliedGrowth, earningsYield } from "@/lib/invest/factors";
import { weightInFund } from "@/lib/invest/exposure";
import { pct } from "./format";
import { Card, Note } from "./ui";

type Col = "ticker" | "implied" | "ey" | "pe" | "fpe" | "opm" | "roe" | "rev" | "eps" | "beta" | "vti" | "qqq";

const COLS: { key: Col; label: string; title: string }[] = [
  { key: "ticker", label: "Name", title: "Ticker" },
  { key: "implied", label: "Implied g", title: "Annual earnings growth today's price requires for 10 years (trailing earnings, 4.5% ERP)" },
  { key: "ey", label: "EY−10y", title: "Forward earnings yield minus the ten-year, in points" },
  { key: "pe", label: "P/E", title: "Trailing P/E" },
  { key: "fpe", label: "Fwd", title: "Forward P/E" },
  { key: "opm", label: "Op m", title: "Operating margin" },
  { key: "roe", label: "ROE", title: "Return on equity" },
  { key: "rev", label: "Rev", title: "Quarterly revenue growth, year on year" },
  { key: "eps", label: "EPS", title: "Quarterly earnings growth, year on year" },
  { key: "beta", label: "Beta", title: "Beta" },
  { key: "vti", label: "In VTI", title: "Weight inside VTI" },
  { key: "qqq", label: "In QQQ", title: "Weight inside QQQ" },
];

export function ScreenTable() {
  const [sort, setSort] = useState<{ col: Col; dir: 1 | -1 }>({ col: "implied", dir: 1 });
  const rows = useMemo(() => {
    return allFundamentals()
      .filter((f) => !f.pendingCapture && f.marketCap)
      .map((f) => {
        const d = dossierFor(f.ticker);
        const ey = earningsYield(f);
        return {
          ticker: f.ticker,
          name: d?.name ?? f.name ?? f.ticker,
          status: !d ? "screen only" : d.watch ? "watch" : "dossier",
          note: f.note ?? null,
          implied: impliedGrowth(f).growth,
          ey: ey.spreadPts,
          pe: f.peTrailing,
          fpe: f.peForward,
          opm: f.operatingMargin,
          roe: f.roe,
          rev: f.revenueGrowthYoy,
          eps: f.earningsGrowthYoy,
          beta: f.beta,
          vti: weightInFund("VTI", f.ticker),
          qqq: weightInFund("QQQ", f.ticker),
          asOf: f.asOf,
        };
      });
  }, []);

  const sorted = [...rows].sort((a, b) => {
    const k = sort.col;
    if (k === "ticker") return a.ticker < b.ticker ? -sort.dir : sort.dir;
    const x = a[k] as number | null;
    const y = b[k] as number | null;
    if (x == null && y == null) return 0;
    if (x == null) return 1;
    if (y == null) return -1;
    return (x - y) * sort.dir;
  });

  const fmt = (k: Col, v: number | null) => {
    if (v == null) return "—";
    if (k === "pe" || k === "fpe" || k === "beta") return v.toFixed(k === "beta" ? 2 : 1);
    if (k === "ey") return `${v >= 0 ? "+" : ""}${v.toFixed(1)}`;
    return pct(v);
  };

  return (
    <Card title={`Screen · ${rows.length} captured companies`}>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-[11px] tabular-nums">
          <thead className="text-[10px] uppercase text-[var(--color-muted)]">
            <tr>
              {COLS.map((c) => (
                <th key={c.key} className={`py-1 pr-2 font-medium ${c.key === "ticker" ? "text-left" : "text-right"}`} title={c.title}>
                  <button
                    type="button"
                    className="uppercase underline-offset-2 hover:underline"
                    aria-sort={sort.col === c.key ? (sort.dir === 1 ? "ascending" : "descending") : "none"}
                    onClick={() => setSort((s) => ({ col: c.key, dir: s.col === c.key ? (s.dir === 1 ? -1 : 1) : 1 }))}
                  >
                    {c.label}
                    {sort.col === c.key ? (sort.dir === 1 ? " ↑" : " ↓") : ""}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <tr key={r.ticker} className="border-t border-[var(--color-border)]" title={r.note ?? undefined}>
                <td className="py-1 pr-2 text-left">
                  <span className="font-medium">{r.ticker}</span>{" "}
                  <span className="text-[10px] text-[var(--color-muted)]">
                    {r.status}
                    {r.note ? " *" : ""}
                  </span>
                </td>
                {COLS.slice(1).map((c) => (
                  <td
                    key={c.key}
                    className={`pr-2 text-right ${
                      (c.key === "eps" || c.key === "ey") && (r[c.key] as number | null) != null && (r[c.key] as number) < 0
                        ? "text-[var(--color-down)]"
                        : ""
                    }`}
                  >
                    {fmt(c.key, r[c.key] as number | null)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-2 space-y-1">
        <Note>
          Click a column to sort by it — one lens at a time, never a blend. Implied growth uses trailing earnings and a 4.5% equity
          risk premium over the {RISK_FREE.yieldPct}% ten-year; EY−10y is forward earnings yield minus that ten-year. "Screen
          only" rows have fundamentals and no dossier — the gate refuses them until one is written. * = read the row's note
          (hover): {rows.filter((r) => r.note).map((r) => r.ticker).join(", ") || "none"}.
        </Note>
        <Note>
          Rows as of {[...new Set(rows.map((r) => r.asOf))].sort().join(" / ")} — a captured snapshot, not a feed.
        </Note>
      </div>
    </Card>
  );
}
