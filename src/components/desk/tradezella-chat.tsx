import { useCallback, useEffect, useRef, useState } from "react";
import {
  Camera,
  Download,
  ImagePlus,
  Loader2,
  MessagesSquare,
  NotebookPen,
  Send,
  Trash2,
  X,
} from "lucide-react";
import type { DeskPayload } from "@/lib/trading/build-desk";
import {
  analyzeTradezellaChat,
  type TradezellaChatResult,
} from "@/lib/trading/tradezella-server";
import type { TradezellaAnalysis } from "@/lib/trading/tradezella-analyze";
import type { DayBacktestRow } from "@/lib/trading/session-backtest";
import {
  CHART_TIMEFRAMES,
  markAllCharts,
  type ChartShot,
  type ChartTimeframe,
  type MarkedChart,
} from "@/lib/trading/chart-markup";
import { analysisToSetupCandidate } from "@/lib/trading/analysis-to-candidate";
import type { SetupCandidate } from "@/lib/trading/scanner";
import type { LogMode } from "@/components/desk/setup-scanner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Role = "user" | "assistant" | "system";

interface ChatMessage {
  id: string;
  role: Role;
  text: string;
  /** Original uploads */
  shots?: ChartShot[];
  /** Annotated returns */
  marked?: MarkedChart[];
  analysis?: TradezellaAnalysis;
  markdown?: string;
  mode?: "text" | "week_backtest" | "csv";
  days?: DayBacktestRow[];
  queue?: string[];
  ts: number;
}

const WELCOME: ChatMessage = {
  id: "welcome",
  role: "system",
  text: "TZ Lab · “backtest july 2026” uses dual-layer data: HTF 1h/4h (sparse) + NY 08:30–11:00 1m only. Causal 10:00/10:45 ET — no future. Log paper · live · Skip.",
  ts: Date.now(),
};

const QUICK = [
  "backtest july 2026 MNQ ES",
  "backtest week of July 14 2026 MNQ ES",
  "backtest 2026-07-01 to 2026-07-15 MNQ",
  "back test july 2026",
];

function uid() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function BiasPill({ bias }: { bias: string }) {
  return (
    <span
      className={cn(
        "rounded-full border px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase",
        bias === "bull" &&
          "border-[color-mix(in_oklab,var(--color-up)_40%,var(--color-border))] text-[var(--color-up)]",
        bias === "bear" &&
          "border-[color-mix(in_oklab,var(--color-down)_40%,var(--color-border))] text-[var(--color-down)]",
        bias !== "bull" &&
          bias !== "bear" &&
          "border-[var(--color-border)] text-[var(--color-subtle)]",
      )}
    >
      {bias}
    </span>
  );
}

function downloadDataUrl(dataUrl: string, name: string) {
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = name;
  a.click();
}

function WeekTable({
  days,
  queue,
}: {
  days?: DayBacktestRow[];
  queue?: string[];
}) {
  if (!days?.length) return null;

  const pathRows = days.filter((d) => d.pathEligible);
  const skipRows = days.filter((d) => !d.pathEligible);
  const ordered = [...pathRows, ...skipRows];
  const trades = days
    .map((d) => d.trade)
    .filter((tr): tr is NonNullable<typeof tr> => Boolean(tr?.taken && tr.rMultiple != null));
  const wins = trades.filter((tr) => (tr.rMultiple ?? 0) > 0).length;
  const sumR = trades.reduce((s, tr) => s + (tr.rMultiple ?? 0), 0);
  const sumUsd = trades.reduce((s, tr) => s + (tr.pnlUsd ?? 0), 0);
  const wr = trades.length ? wins / trades.length : null;

  return (
    <div className="mt-3 space-y-3">
      {/* Direct headline + realized P&L */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-2">
          <p className="text-[9px] uppercase tracking-wider text-[var(--color-subtle)]">
            Taken
          </p>
          <p className="font-mono text-lg font-semibold text-[var(--color-fg)]">
            {trades.length}
            <span className="text-xs font-normal text-[var(--color-subtle)]">
              /{pathRows.length} path
            </span>
          </p>
        </div>
        <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-2">
          <p className="text-[9px] uppercase tracking-wider text-[var(--color-subtle)]">
            Win rate
          </p>
          <p className="font-mono text-lg font-semibold text-[var(--color-fg)]">
            {wr != null ? `${(wr * 100).toFixed(0)}%` : "—"}
          </p>
        </div>
        <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-2">
          <p className="text-[9px] uppercase tracking-wider text-[var(--color-subtle)]">
            Net R
          </p>
          <p
            className={
              sumR > 0
                ? "font-mono text-lg font-semibold text-[var(--color-up)]"
                : sumR < 0
                  ? "font-mono text-lg font-semibold text-[var(--color-down)]"
                  : "font-mono text-lg font-semibold text-[var(--color-fg)]"
            }
          >
            {trades.length ? `${sumR >= 0 ? "+" : ""}${sumR.toFixed(2)}R` : "—"}
          </p>
        </div>
        <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-2">
          <p className="text-[9px] uppercase tracking-wider text-[var(--color-subtle)]">
            Net $
          </p>
          <p
            className={
              sumUsd > 0
                ? "font-mono text-lg font-semibold text-[var(--color-up)]"
                : sumUsd < 0
                  ? "font-mono text-lg font-semibold text-[var(--color-down)]"
                  : "font-mono text-lg font-semibold text-[var(--color-fg)]"
            }
          >
            {trades.length
              ? `${sumUsd >= 0 ? "+" : "-"}$${Math.abs(sumUsd).toFixed(0)}`
              : "—"}
          </p>
        </div>
        <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-2">
          <p className="text-[9px] uppercase tracking-wider text-[var(--color-subtle)]">
            Floor
          </p>
          <p className="font-mono text-lg font-semibold text-[var(--color-primary)]">
            0.67
          </p>
        </div>
        <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-2">
          <p className="text-[9px] uppercase tracking-wider text-[var(--color-subtle)]">
            Skip
          </p>
          <p className="font-mono text-lg font-semibold text-[var(--color-muted)]">
            {skipRows.length}
          </p>
        </div>
      </div>

      {pathRows.length > 0 ? (
        <div className="rounded-[var(--radius-md)] border border-[color-mix(in_oklab,var(--color-up)_35%,var(--color-border))] bg-[color-mix(in_oklab,var(--color-up)_8%,transparent)] px-3 py-2">
          <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-up)]">
            Take these (PATH)
          </p>
          <ul className="space-y-1 text-xs text-[var(--color-fg)]">
            {pathRows.map((d) => {
              const tr = d.trade;
              const r = tr?.rMultiple;
              const usd = tr?.pnlUsd;
              return (
              <li
                key={`p-${d.date}-${d.symbol}`}
                className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 font-mono"
              >
                <span className="text-[var(--color-up)]">TAKEN</span>
                <span>{d.date}</span>
                <span>{d.symbol}</span>
                <span
                  className={
                    d.best?.side === "long"
                      ? "text-[var(--color-up)]"
                      : "text-[var(--color-down)]"
                  }
                >
                  {d.best?.side?.toUpperCase()}
                </span>
                <span>
                  {d.best?.grade} {d.best?.confluence.toFixed(2)}
                </span>
                {r != null && (
                  <span
                    className={
                      r > 0
                        ? "font-semibold text-[var(--color-up)]"
                        : "font-semibold text-[var(--color-down)]"
                    }
                  >
                    {r >= 0 ? "+" : ""}
                    {r.toFixed(2)}R
                    {usd != null
                      ? ` · ${usd >= 0 ? "+" : "-"}$${Math.abs(usd).toFixed(0)}`
                      : ""}
                    <span className="ml-1 font-normal text-[var(--color-subtle)]">
                      {tr?.exitReason}
                    </span>
                  </span>
                )}
                <span className="text-[var(--color-subtle)]">
                  HTF {d.htf} · {d.best?.strategyPrimary || "—"}
                </span>
              </li>
              );
            })}
          </ul>
          <p className="mt-1.5 text-[10px] text-[var(--color-subtle)]">
            Auto-taken at decision close · 1 micro · stop vs 1R/2R · RTH exit walk ·
            risk 0.5% model
          </p>
        </div>
      ) : (
        <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-xs text-[var(--color-muted)]">
          <strong className="text-[var(--color-fg)]">No PATH days</strong> at
          floor 0.67. Correct selectivity — do not force B/skip grades.
        </div>
      )}

      <div>
        <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-primary)]">
          Day board · PATH first · floor 0.67
        </p>
        <div className="max-h-72 overflow-auto rounded-[var(--radius-md)] border border-[var(--color-border)]">
          <table className="w-full text-left text-[11px]">
            <thead className="sticky top-0 z-[1] bg-[var(--color-surface-2)] text-[9px] uppercase tracking-wider text-[var(--color-subtle)]">
              <tr>
                <th className="px-2 py-1.5">Date</th>
                <th className="px-2 py-1.5">Sym</th>
                <th className="px-2 py-1.5">HTF</th>
                <th className="px-2 py-1.5">Setup</th>
                <th className="px-2 py-1.5">Score</th>
                <th className="px-2 py-1.5">Path</th>
                <th className="px-2 py-1.5">R</th>
                <th className="px-2 py-1.5">$</th>
                <th className="px-2 py-1.5">Exit</th>
                <th className="px-2 py-1.5">Why not</th>
              </tr>
            </thead>
            <tbody>
              {ordered.map((d, i) => {
                const conf = d.best?.confluence;
                return (
                  <tr
                    key={`${d.date}-${d.symbol}-${i}`}
                    className={
                      d.pathEligible
                        ? "border-t border-[var(--color-border)] bg-[color-mix(in_oklab,var(--color-up)_7%,transparent)]"
                        : "border-t border-[var(--color-border)]"
                    }
                  >
                    <td className="px-2 py-1.5 font-mono text-[var(--color-fg)]">
                      {d.date.slice(5)}
                    </td>
                    <td className="px-2 py-1.5 font-mono">{d.symbol}</td>
                    <td className="px-2 py-1.5">{d.htf}</td>
                    <td className="px-2 py-1.5 text-[var(--color-muted)]">
                      {d.best ? (
                        <span>
                          <span
                            className={
                              d.best.side === "long"
                                ? "text-[var(--color-up)]"
                                : "text-[var(--color-down)]"
                            }
                          >
                            {d.best.side}
                          </span>{" "}
                          {d.best.grade}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-2 py-1.5 font-mono">
                      {conf != null ? conf.toFixed(2) : "—"}
                    </td>
                    <td
                      className={
                        d.pathEligible
                          ? "px-2 py-1.5 font-bold text-[var(--color-up)]"
                          : "px-2 py-1.5 text-[var(--color-subtle)]"
                      }
                    >
                      {d.pathEligible ? "YES" : "no"}
                    </td>
                    <td
                      className={
                        d.trade?.rMultiple != null && d.trade.rMultiple > 0
                          ? "px-2 py-1.5 font-mono font-semibold text-[var(--color-up)]"
                          : d.trade?.rMultiple != null && d.trade.rMultiple < 0
                            ? "px-2 py-1.5 font-mono font-semibold text-[var(--color-down)]"
                            : "px-2 py-1.5 font-mono text-[var(--color-subtle)]"
                      }
                    >
                      {d.trade?.rMultiple != null
                        ? `${d.trade.rMultiple >= 0 ? "+" : ""}${d.trade.rMultiple.toFixed(2)}`
                        : "—"}
                    </td>
                    <td
                      className={
                        d.trade?.pnlUsd != null && d.trade.pnlUsd > 0
                          ? "px-2 py-1.5 font-mono text-[var(--color-up)]"
                          : d.trade?.pnlUsd != null && d.trade.pnlUsd < 0
                            ? "px-2 py-1.5 font-mono text-[var(--color-down)]"
                            : "px-2 py-1.5 font-mono text-[var(--color-subtle)]"
                      }
                    >
                      {d.trade?.pnlUsd != null
                        ? `${d.trade.pnlUsd >= 0 ? "+" : "-"}$${Math.abs(d.trade.pnlUsd).toFixed(0)}`
                        : "—"}
                    </td>
                    <td className="px-2 py-1.5 text-[10px] text-[var(--color-subtle)]">
                      {d.trade?.exitReason ?? "—"}
                    </td>
                    <td className="max-w-[10rem] truncate px-2 py-1.5 text-[10px] text-[var(--color-subtle)]" title={d.deadspot || ""}>
                      {d.pathEligible
                        ? "—"
                        : d.deadspot
                          ? d.deadspot.replace(/^setup below path\s*/i, "").slice(0, 48)
                          : conf != null && conf < 0.67
                            ? `<0.67`
                            : "gates"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {days[0]?.gates && (
        <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2">
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-primary)]">
            Gates (first day sample)
          </p>
          <ul className="grid gap-0.5 text-[11px] sm:grid-cols-2">
            {days[0].gates.map((g) => (
              <li key={g.name} className="flex gap-1.5 text-[var(--color-muted)]">
                <span
                  className={
                    g.pass
                      ? "font-mono text-[var(--color-up)]"
                      : "font-mono text-[var(--color-down)]"
                  }
                >
                  {g.pass ? "OK" : "NO"}
                </span>
                <span>
                  <span className="text-[var(--color-fg)]">{g.name}</span>
                  <span className="text-[var(--color-subtle)]">
                    {" "}
                    — {g.detail}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {queue && queue.length > 0 && (
        <details className="text-[11px] text-[var(--color-muted)]">
          <summary className="cursor-pointer text-[10px] font-semibold uppercase tracking-wide text-[var(--color-subtle)]">
            Queue ({queue.length} sessions)
          </summary>
          <ul className="mt-1 max-h-28 space-y-0.5 overflow-auto pl-1">
            {queue.map((q) => (
              <li key={q}>☐ {q}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function AnalysisCard({
  a,
  marked,
  days,
  queue,
  onLog,
  onSkip,
}: {
  a: TradezellaAnalysis;
  marked?: MarkedChart[];
  days?: DayBacktestRow[];
  queue?: string[];
  onLog?: (c: SetupCandidate, mode: LogMode) => void;
  onSkip?: () => void;
}) {
  const candidate = analysisToSetupCandidate(a);

  return (
    <div className="mt-2 space-y-3 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-2)] p-3 text-xs">
      <div>
        <p className="text-sm font-semibold text-[var(--color-fg)]">{a.title}</p>
        {days && days.length > 0 ? (
          <p className="mt-1 text-[11px] leading-relaxed text-[var(--color-muted)]">
            Floor <span className="font-mono text-[var(--color-primary)]">0.67</span>
            {" · "}
            PATH{" "}
            <span className="font-mono text-[var(--color-up)]">
              {days.filter((d) => d.pathEligible).length}
            </span>
            /{days.length}
            {" · "}
            causal NY 08:30–11:00 · dual-layer HTF
          </p>
        ) : (
          <p className="mt-1 text-[var(--color-muted)]">{a.summary}</p>
        )}
      </div>

      <WeekTable days={days} queue={queue} />

      {/* Marked charts returned */}
      {marked && marked.length > 0 && (
        <div>
          <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-primary)]">
            Marked charts returned ({marked.length})
          </p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {marked.map((m) => (
              <div
                key={m.tf + m.name}
                className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)]"
              >
                <div className="flex items-center justify-between gap-2 border-b border-[var(--color-border)] px-2 py-1">
                  <span className="font-mono text-[10px] font-semibold text-[var(--color-primary)]">
                    {m.tf.toUpperCase()}
                  </span>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 text-[10px] text-[var(--color-muted)] hover:text-[var(--color-fg)]"
                    onClick={() => downloadDataUrl(m.dataUrl, m.name)}
                  >
                    <Download className="h-3 w-3" />
                    Save
                  </button>
                </div>
                <img
                  src={m.dataUrl}
                  alt={`Marked ${m.tf}`}
                  className="max-h-56 w-full object-contain bg-[var(--color-bg)]"
                />
                <p className="px-2 py-1 text-[10px] text-[var(--color-subtle)]">
                  {m.focus}
                </p>
              </div>
            ))}
          </div>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="mt-2"
            onClick={() => {
              for (const m of marked) downloadDataUrl(m.dataUrl, m.name);
            }}
          >
            <Download className="h-3.5 w-3.5" />
            Download all marked
          </Button>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1.5">
          <p className="text-[9px] uppercase tracking-wider text-[var(--color-subtle)]">
            WR
          </p>
          <p className="font-mono font-semibold text-[var(--color-fg)]">
            {a.stats.winRate != null
              ? `${(a.stats.winRate * 100).toFixed(1)}%`
              : "—"}
          </p>
        </div>
        <div className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1.5">
          <p className="text-[9px] uppercase tracking-wider text-[var(--color-subtle)]">
            Trades
          </p>
          <p className="font-mono font-semibold text-[var(--color-fg)]">
            {a.stats.trades ?? "—"}
          </p>
        </div>
        <div className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1.5">
          <p className="text-[9px] uppercase tracking-wider text-[var(--color-subtle)]">
            Net
          </p>
          <p className="font-mono font-semibold text-[var(--color-fg)]">
            {a.stats.netPnl != null ? `$${a.stats.netPnl}` : "—"}
          </p>
        </div>
        <div className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1.5">
          <p className="text-[9px] uppercase tracking-wider text-[var(--color-subtle)]">
            Path
          </p>
          <p className="font-mono font-semibold text-[var(--color-primary)]">
            {(a.systemAlignment.pathWrTarget * 100).toFixed(0)}%
          </p>
        </div>
      </div>

      <p className="text-[var(--color-muted)]">{a.systemAlignment.wrVsTarget}</p>

      <div>
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-primary)]">
          HTF · MTF · LTF
        </p>
        <div className="space-y-1.5">
          {a.timeframes.map((tf) => (
            <div key={tf.tf} className="flex flex-wrap items-start gap-2">
              <span className="w-10 font-mono text-[10px] font-bold text-[var(--color-fg)]">
                {tf.tf}
              </span>
              <BiasPill bias={tf.bias} />
              <span className="min-w-0 flex-1 text-[var(--color-muted)]">
                {tf.label} — {tf.notes}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div>
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-primary)]">
          Conditions
        </p>
        <p className="text-[var(--color-muted)]">
          {a.conditions.regime} · {a.conditions.volatility} vol ·{" "}
          {a.conditions.session} · news {a.conditions.news}
        </p>
      </div>

      {a.strategiesHit.length > 0 && (
        <div>
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-primary)]">
            Strategies
          </p>
          <div className="flex flex-wrap gap-1">
            {a.strategiesHit.map((s) => (
              <span
                key={s.id}
                title={s.why}
                className="rounded-full border border-[color-mix(in_oklab,var(--color-primary)_40%,var(--color-border))] bg-[color-mix(in_oklab,var(--color-primary)_12%,transparent)] px-2 py-0.5 text-[10px] font-medium text-[var(--color-primary)]"
              >
                {s.label}
              </span>
            ))}
          </div>
        </div>
      )}

      {a.setups.map((s) => (
        <div
          key={s.id}
          className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-2.5"
        >
          <div className="mb-1.5 flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-[var(--color-fg)]">
              Setup · {String(s.strategy)} · {s.side.toUpperCase()}
            </span>
            <span className="rounded-full border border-[var(--color-border)] px-1.5 py-0.5 font-mono text-[10px]">
              {s.grade} · {s.confluenceScore.toFixed(2)}
            </span>
          </div>
          <div className="grid grid-cols-1 gap-1 sm:grid-cols-3">
            <p>
              <span className="text-[var(--color-subtle)]">Entry </span>
              <span className="font-mono text-[var(--color-fg)]">{s.entry}</span>
            </p>
            <p>
              <span className="text-[var(--color-subtle)]">S/L </span>
              <span className="font-mono text-[var(--color-down)]">{s.stop}</span>
            </p>
            <p>
              <span className="text-[var(--color-subtle)]">TP </span>
              <span className="font-mono text-[var(--color-up)]">
                {s.targets.join(" · ")}
              </span>
            </p>
          </div>
          <p className="mt-1 text-[var(--color-muted)]">R:R {s.rr}</p>
          <p className="mt-1 text-[var(--color-muted)]">
            + {s.confluencesPresent.join(", ") || "—"}
          </p>
          <p className="text-[var(--color-muted)]">
            − {s.confluencesMissing.slice(0, 6).join(", ") || "—"}
          </p>
        </div>
      ))}

      {/* Log or not */}
      <div className="rounded-[var(--radius-md)] border border-[color-mix(in_oklab,var(--color-primary)_30%,var(--color-border))] bg-[color-mix(in_oklab,var(--color-primary)_6%,transparent)] p-2.5">
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-primary)]">
          Journal this setup?
        </p>
        <p className="mb-2 text-[11px] text-[var(--color-subtle)]">
          Optional — nothing is logged until you choose. Skip keeps the review
          only.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={!candidate || !onLog}
            onClick={() => candidate && onLog?.(candidate, "paper")}
            title="Open paper log dialog"
          >
            <NotebookPen className="h-3.5 w-3.5" />
            Log paper
          </Button>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={!candidate || !onLog}
            onClick={() => candidate && onLog?.(candidate, "live")}
            className="text-[var(--color-warn)]"
            title="Open live log dialog"
          >
            Log live
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => onSkip?.()}
          >
            Skip — don’t log
          </Button>
        </div>
        {!candidate && (
          <p className="mt-1.5 text-[10px] text-[var(--color-warn)]">
            No executable side in setup — add long/short + levels to enable log.
          </p>
        )}
      </div>

      <div>
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-primary)]">
          Backtest checklist
        </p>
        <ul className="space-y-0.5">
          {a.backtestChecklist.map((b) => (
            <li key={b.item} className="flex gap-2 text-[var(--color-muted)]">
              <span
                className={cn(
                  "font-mono text-[10px] uppercase",
                  b.status === "pass" && "text-[var(--color-up)]",
                  b.status === "fail" && "text-[var(--color-down)]",
                  b.status === "unknown" && "text-[var(--color-warn)]",
                )}
              >
                {b.status === "pass" ? "OK" : b.status === "fail" ? "NO" : "??"}
              </span>
              <span>
                {b.item}
                <span className="text-[var(--color-subtle)]"> — {b.detail}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>

      <div>
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-primary)]">
          Next
        </p>
        <ol className="list-decimal space-y-0.5 pl-4 text-[var(--color-muted)]">
          {a.nextActions.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ol>
      </div>

      <p className="text-[10px] text-[var(--color-subtle)]">{a.disclaimer}</p>
    </div>
  );
}

export function TradezellaChat({
  desk,
  onLog,
}: {
  desk?: DeskPayload | null;
  /** Wire to desk journal dialog (paper/live). */
  onLog?: (c: SetupCandidate, mode: LogMode) => void;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([WELCOME]);
  const [text, setText] = useState("");
  const [shots, setShots] = useState<ChartShot[]>([]);
  const [csvText, setCsvText] = useState<string | null>(null);
  const csvRef = useRef<HTMLInputElement>(null);
  const [activeTf, setActiveTf] = useState<ChartTimeframe>("15m");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [skipNote, setSkipNote] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy]);

  const onFile = (file: File | null, tf: ChartTimeframe) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Upload an image (PNG/JPG).");
      return;
    }
    if (file.size > 4_500_000) {
      setError("Image too large (max ~4.5MB).");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || "");
      setShots((prev) => {
        const rest = prev.filter((s) => s.tf !== tf);
        return [...rest, { tf, dataUrl, name: file.name }].sort(
          (a, b) =>
            CHART_TIMEFRAMES.indexOf(a.tf) - CHART_TIMEFRAMES.indexOf(b.tf),
        );
      });
      setError(null);
    };
    reader.readAsDataURL(file);
  };

  const send = useCallback(async () => {
    const msg = text.trim();
    if (!msg && shots.length === 0 && !csvText) return;
    setBusy(true);
    setError(null);
    setSkipNote(null);

    const userShots = [...shots];
    const userCsv = csvText;
    const userMsg: ChatMessage = {
      id: uid(),
      role: "user",
      text:
        msg ||
        (userCsv
          ? "(TradeZella CSV import)"
          : `(${userShots.length} chart${userShots.length === 1 ? "" : "s"}: ${userShots.map((s) => s.tf).join(", ")})`),
      shots: userShots,
      ts: Date.now(),
    };
    setMessages((m) => [...m, userMsg]);
    setText("");
    setShots([]);
    setCsvText(null);

    try {
      const deskContext = desk
        ? {
            htfLeft: `${desk.bias.left.symbol} ${desk.bias.left.topDown} — ${desk.bias.left.summary}`,
            htfRight: `${desk.bias.right.symbol} ${desk.bias.right.topDown} — ${desk.bias.right.summary}`,
            killzone: desk.clock.killzoneLabel,
            smt: desk.scan.smt.note,
            bestSetup: desk.scan.candidates[0]
              ? `${desk.scan.candidates[0].symbol} ${desk.scan.candidates[0].side} ${desk.scan.candidates[0].grade}`
              : undefined,
          }
        : undefined;

      // Analyze with first chart as primary attachment + TF list in message
      const tfNote =
        userShots.length > 0
          ? `\n[Charts attached: ${userShots.map((s) => s.tf).join(", ")}]`
          : "";

      const result: TradezellaChatResult = await analyzeTradezellaChat({
        data: {
          message: userMsg.text + tfNote,
          imageDataUrl: userShots[0]?.dataUrl ?? null,
          imageName: userShots.map((s) => `${s.tf}:${s.name}`).join(", ") || null,
          csvText: userCsv,
          deskContext,
        },
      });

      let marked: MarkedChart[] = [];
      if (userShots.length > 0) {
        try {
          marked = await markAllCharts(userShots, result.analysis);
        } catch (e) {
          console.warn("markup failed", e);
        }
      }

      const assistant: ChatMessage = {
        id: uid(),
        role: "assistant",
        text: result.analysis.summary,
        analysis: result.analysis,
        markdown: result.markdown,
        marked,
        shots: userShots,
        mode: result.mode,
        days: result.days,
        queue: result.queue,
        ts: Date.now(),
      };
      setMessages((m) => [...m, assistant]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Analysis failed");
    } finally {
      setBusy(false);
    }
  }, [text, shots, csvText, desk]);

  const missingTfs = CHART_TIMEFRAMES.filter(
    (tf) => !shots.some((s) => s.tf === tf),
  );

  return (
    <section className="flex min-h-[480px] flex-col rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)]">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--color-border)] px-3 py-2.5 sm:px-4">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] bg-[var(--color-primary-dim)] text-[var(--color-primary)]">
            <MessagesSquare className="h-4 w-4" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-[var(--color-fg)]">
              TradeZella lab · multi-TF charts
            </h2>
            <p className="text-[11px] text-[var(--color-subtle)]">
              Ask “backtest week of …” for real Databento · multi-TF charts · CSV ·
              Log / Skip
            </p>
          </div>
        </div>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => {
            setMessages([WELCOME]);
            setError(null);
            setShots([]);
            setSkipNote(null);
          }}
        >
          <Trash2 className="h-3.5 w-3.5" />
          Clear
        </Button>
      </header>

      <div className="flex flex-wrap gap-1.5 border-b border-[var(--color-border)] px-3 py-2">
        {QUICK.map((q) => (
          <button
            key={q}
            type="button"
            onClick={() => setText(q)}
            className="rounded-full border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2.5 py-1 text-left text-[10px] text-[var(--color-muted)] hover:text-[var(--color-fg)]"
          >
            {q.length > 48 ? `${q.slice(0, 48)}…` : q}
          </button>
        ))}
      </div>

      <div className="max-h-[min(560px,58vh)] flex-1 space-y-3 overflow-y-auto px-3 py-3 sm:px-4">
        {messages.map((m) => (
          <div
            key={m.id}
            className={cn(
              "flex",
              m.role === "user" ? "justify-end" : "justify-start",
            )}
          >
            <div
              className={cn(
                "max-w-[min(100%,40rem)] rounded-[var(--radius-md)] px-3 py-2 text-sm",
                m.role === "user" &&
                  "bg-[color-mix(in_oklab,var(--color-primary)_14%,var(--color-surface-2))] text-[var(--color-fg)]",
                m.role === "assistant" &&
                  "border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-muted)]",
                m.role === "system" &&
                  "border border-dashed border-[var(--color-border)] text-[var(--color-subtle)]",
              )}
            >
              {m.shots && m.shots.length > 0 && m.role === "user" && (
                <div className="mb-2 flex flex-wrap gap-1.5">
                  {m.shots.map((s) => (
                    <div
                      key={s.tf}
                      className="overflow-hidden rounded border border-[var(--color-border)]"
                    >
                      <p className="bg-[var(--color-surface-2)] px-1.5 py-0.5 font-mono text-[9px]">
                        {s.tf}
                      </p>
                      <img
                        src={s.dataUrl}
                        alt={s.tf}
                        className="h-16 w-24 object-cover"
                      />
                    </div>
                  ))}
                </div>
              )}
              <p className="whitespace-pre-wrap">{m.text}</p>
              {m.analysis && (
                <AnalysisCard
                  a={m.analysis}
                  marked={m.marked}
                  days={m.days}
                  queue={m.queue}
                  onLog={onLog}
                  onSkip={() =>
                    setSkipNote(
                      "Skipped journal — review kept in chat only. Good discipline.",
                    )
                  }
                />
              )}
            </div>
          </div>
        ))}
        {busy && (
          <div className="flex items-center gap-2 text-xs text-[var(--color-subtle)]">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Running backtest / analysis (Databento can take 15–40s)…
          </div>
        )}
        {skipNote && (
          <p className="text-xs text-[var(--color-primary)]">{skipNote}</p>
        )}
        <div ref={bottomRef} />
      </div>

      {error && (
        <p className="px-4 text-xs text-[var(--color-down)]">{error}</p>
      )}

      {/* Multi-TF tray */}
      <div className="border-t border-[var(--color-border)] px-3 py-2">
        <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-[var(--color-subtle)]">
          Backtest charts (add all 5 when you have them)
        </p>
        <div className="mb-2 flex flex-wrap gap-1.5">
          {CHART_TIMEFRAMES.map((tf) => {
            const has = shots.find((s) => s.tf === tf);
            return (
              <button
                key={tf}
                type="button"
                onClick={() => {
                  setActiveTf(tf);
                  fileRef.current?.click();
                }}
                className={cn(
                  "inline-flex min-h-10 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors",
                  has
                    ? "border-[color-mix(in_oklab,var(--color-up)_45%,var(--color-border))] bg-[color-mix(in_oklab,var(--color-up)_10%,transparent)] text-[var(--color-up)]"
                    : activeTf === tf
                      ? "border-[var(--color-primary)] text-[var(--color-primary)]"
                      : "border-[var(--color-border)] text-[var(--color-muted)] hover:text-[var(--color-fg)]",
                )}
              >
                {tf}
                {has ? " ✓" : " +"}
              </button>
            );
          })}
        </div>
        {shots.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {shots.map((s) => (
              <div
                key={s.tf}
                className="relative overflow-hidden rounded-[var(--radius-sm)] border border-[var(--color-border)]"
              >
                <span className="absolute left-1 top-1 rounded bg-[var(--color-bg)]/80 px-1 font-mono text-[9px] text-[var(--color-primary)]">
                  {s.tf}
                </span>
                <button
                  type="button"
                  aria-label={`Remove ${s.tf}`}
                  className="absolute right-1 top-1 rounded bg-[var(--color-bg)]/80 p-0.5 text-[var(--color-subtle)] hover:text-[var(--color-fg)]"
                  onClick={() =>
                    setShots((prev) => prev.filter((x) => x.tf !== s.tf))
                  }
                >
                  <X className="h-3 w-3" />
                </button>
                <img
                  src={s.dataUrl}
                  alt={s.tf}
                  className="h-16 w-24 object-cover"
                />
              </div>
            ))}
          </div>
        )}
        {csvText && (
          <p className="mb-1 text-[10px] text-[var(--color-primary)]">
            CSV loaded ({csvText.split("\n").length} lines) — Analyze to grade
          </p>
        )}
        {missingTfs.length > 0 && shots.length > 0 && (
          <p className="mb-1 text-[10px] text-[var(--color-warn)]">
            Still missing: {missingTfs.join(", ")} (optional but recommended)
          </p>
        )}
      </div>

      <div className="border-t border-[var(--color-border)] p-3">
        <div className="flex items-end gap-2">
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              onFile(e.target.files?.[0] ?? null, activeTf);
              e.target.value = "";
            }}
          />
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => fileRef.current?.click()}
            className="shrink-0"
            title={`Add ${activeTf} chart`}
          >
            <ImagePlus className="h-4 w-4" />
            {activeTf}
          </Button>
          <input
            ref={csvRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              const txt = await f.text();
              setCsvText(txt);
              setError(null);
              e.target.value = "";
            }}
          />
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => csvRef.current?.click()}
            className="shrink-0"
            title="Import TradeZella CSV export"
          >
            CSV
          </Button>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            rows={2}
            placeholder="Paste TradeZella stats + context… (Enter to analyze)"
            className="min-h-[44px] flex-1 resize-y rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2 text-sm text-[var(--color-fg)] placeholder:text-[var(--color-subtle)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)]"
          />
          <Button
            type="button"
            size="sm"
            disabled={busy || (!text.trim() && shots.length === 0 && !csvText)}
            onClick={() => void send()}
            className="shrink-0"
          >
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
            Analyze
          </Button>
        </div>
        <p className="mt-1.5 flex items-center gap-1 text-[10px] text-[var(--color-subtle)]">
          <Camera className="h-3 w-3" />
          Click each TF chip to attach that screenshot. We copy every chart back
          marked with bias, entry, S/L, targets, confluences.
        </p>
      </div>
    </section>
  );
}
