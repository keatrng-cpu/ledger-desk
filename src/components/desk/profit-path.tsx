import { useDeskSynapse } from "@/lib/trading/desk-synapse";
import { useEffect, useMemo, useState } from "react";
import {
  Crosshair,
  Gauge,
  Loader2,
  Route,
  Target,
  TrendingUp,
} from "lucide-react";
import {
  buildProfitPath,
  demoGradedTrades,
  PROFIT_ACTION_FLOOR,
  PROFIT_MIN_SAMPLE,
  PROFIT_TARGET_WR,
  type GradedTrade,
  type ProfitPathSnapshot,
} from "@/lib/trading/profit-path";
import { listTrades, type JournalTrade } from "@/lib/journal/server";
import { APLUS_RULES } from "@/lib/aplus/config";
import { cn } from "@/lib/utils";

function toGraded(t: JournalTrade): GradedTrade {
  const reason = t.reason ?? "";
  const strat =
    reason.match(/strategy[:\s]+([a-z_]+)/i)?.[1] ??
    reason.match(/\b(tjr|mechanical|judas|pdi|patty|ronan|smt|blake_mech|continuation)\b/i)?.[1];
  return {
    id: t.id,
    symbol: t.symbol,
    side: t.side,
    opened: t.openedAt,
    closed: t.closedAt ?? t.openedAt,
    entry: t.entry,
    exit: t.exit ?? t.entry,
    pnl: t.pnl ?? 0,
    r: t.r ?? 0,
    commission: t.commission,
    slippage: t.slippage,
    reason,
    confluence: t.prescore ?? undefined,
    grade: t.grade ?? undefined,
    strategy: strat?.toLowerCase(),
  };
}

function pct(n: number): string {
  return `${(n * 100).toFixed(0)}%`;
}

function Tile({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "up" | "down" | "warn" | "neutral";
}) {
  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2">
      <p className="text-[10px] uppercase tracking-wider text-[var(--color-subtle)]">
        {label}
      </p>
      <p
        className={cn(
          "font-mono text-lg font-semibold tabular",
          tone === "up" && "text-[var(--color-up)]",
          tone === "down" && "text-[var(--color-down)]",
          tone === "warn" && "text-[var(--color-warn)]",
          !tone || tone === "neutral"
            ? "text-[var(--color-fg)]"
            : undefined,
        )}
      >
        {value}
      </p>
      {sub && (
        <p className="text-[10px] text-[var(--color-subtle)]">{sub}</p>
      )}
    </div>
  );
}

export function ProfitPathPanel({ equity }: { equity?: number }) {
  const pathFeed = useDeskSynapse((s) => s.feeds.path);
  const posture = useDeskSynapse((s) => s.posture);
  const boosts = useDeskSynapse((s) => s.strategyBoosts);

  const [loading, setLoading] = useState(true);
  const [live, setLive] = useState(false);
  const [path, setPath] = useState<ProfitPathSnapshot | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const trades = await listTrades({ data: { status: "closed", limit: 500 } });
        if (cancelled) return;
        const closed = (trades ?? []).filter((t) => t.status === "closed");
        if (closed.length > 0) {
          setLive(true);
          setPath(
            buildProfitPath(
              closed.map(toGraded),
              equity ?? APLUS_RULES.accountEquity,
            ),
          );
        } else {
          setLive(false);
          setPath(
            buildProfitPath(
              demoGradedTrades(),
              equity ?? APLUS_RULES.accountEquity,
            ),
          );
        }
      } catch {
        if (cancelled) return;
        setLive(false);
        setPath(
          buildProfitPath(
            demoGradedTrades(),
            equity ?? APLUS_RULES.accountEquity,
          ),
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [equity]);

  const pathWrTone = useMemo(() => {
    if (!path) return "neutral" as const;
    if (path.pathOnly.winRate >= PROFIT_TARGET_WR) return "up" as const;
    if (path.pathOnly.winRate >= PROFIT_TARGET_WR - 0.08) return "warn" as const;
    return "down" as const;
  }, [path]);

  if (loading || !path) {
    return (
      <section className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
        <div className="flex items-center gap-2 text-sm text-[var(--color-muted)]">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading profit path…
        </div>
      </section>
    );
  }

  return (
    <section className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 sm:p-5">
      <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Route className="h-4 w-4 text-[var(--color-primary)]" />
            <h2 className="text-sm font-semibold tracking-tight text-[var(--color-fg)]">
              Profit path · ≥70% WR on graded A-path only
            </h2>
          </div>
          <p className="mt-1 max-w-2xl text-xs text-[var(--color-subtle)]">
            Execute only path grade <strong className="text-[var(--color-muted)]">A / A+</strong>{" "}
            (Q ≥ {PROFIT_ACTION_FLOOR} + C complete per strategy). B paper · C journal.{" "}
            {live ? (
              <span className="text-[var(--color-up)]">Live journal</span>
            ) : (
              <span className="text-[var(--color-warn)]">
                Demo graded sample — log real A-path trades to replace
              </span>
            )}
          </p>
        </div>
        <div
          className={cn(
            "rounded-full border px-2.5 py-1 text-[11px] font-medium",
            path.onTrack
              ? "border-[color-mix(in_oklab,var(--color-up)_40%,var(--color-border))] text-[var(--color-up)]"
              : "border-[var(--color-border)] text-[var(--color-muted)]",
          )}
        >
          {path.onTrack ? "On track" : "Build sample"}
        </div>
      </header>

      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
        <Tile
          label="Path WR"
          value={path.pathTradeCount ? pct(path.pathOnly.winRate) : "—"}
          sub={`target ${pct(PROFIT_TARGET_WR)}`}
          tone={pathWrTone}
        />
        <Tile
          label="Path expectancy"
          value={
            path.pathTradeCount
              ? `${path.pathOnly.expectancyR.toFixed(2)}R`
              : "—"
          }
          sub={`target ≥ ${path.targetExpectancyR}R`}
          tone={
            path.pathOnly.expectancyR >= path.targetExpectancyR
              ? "up"
              : path.pathOnly.expectancyR > 0
                ? "warn"
                : "down"
          }
        />
        <Tile
          label="A-path trades"
          value={String(path.pathTradeCount)}
          sub={`${pct(path.sampleProgress)} of ${PROFIT_MIN_SAMPLE}`}
        />
        <Tile
          label="All trades WR"
          value={path.overall.trades ? pct(path.overall.winRate) : "—"}
          sub="includes B/C noise"
          tone="neutral"
        />
        <Tile
          label="Action floor"
          value={String(path.actionFloor)}
          sub={`A+ ≥ ${path.aPlus}`}
        />
        <Tile
          label="Path net"
          value={
            path.pathTradeCount
              ? `$${path.pathOnly.netPnl.toFixed(0)}`
              : "—"
          }
          tone={
            path.pathOnly.netPnl > 0
              ? "up"
              : path.pathOnly.netPnl < 0
                ? "down"
                : "neutral"
          }
        />
      </div>

      {/* Sample progress */}
      <div className="mb-4">
        <div className="mb-1 flex justify-between text-[10px] uppercase tracking-wider text-[var(--color-subtle)]">
          <span>Sample toward statistical strength</span>
          <span className="font-mono">
            {path.pathTradeCount}/{PROFIT_MIN_SAMPLE}
          </span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-[var(--color-surface-2)]">
          <div
            className="h-full rounded-full bg-[var(--color-primary)] transition-all"
            style={{ width: `${path.sampleProgress * 100}%` }}
          />
        </div>
      </div>

      <div className="mb-4 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2.5 text-sm text-[var(--color-muted)]">
        <div className="mb-1 flex items-center gap-1.5 text-[var(--color-primary)]">
          <Gauge className="h-3.5 w-3.5" />
          <span className="text-xs font-semibold uppercase tracking-wide">
            Verdict
          </span>
        </div>
        {path.verdict}
      </div>

      <div className="mb-4 grid grid-cols-1 gap-3 lg:grid-cols-2">
        {/* By grade */}
        <div>
          <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--color-fg)]">
            <Target className="h-3.5 w-3.5 text-[var(--color-primary)]" />
            Graded performance
          </h3>
          <div className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border)]">
            <table className="w-full text-left text-xs">
              <thead className="bg-[var(--color-surface-2)] text-[10px] uppercase tracking-wider text-[var(--color-subtle)]">
                <tr>
                  <th className="px-2.5 py-1.5">Grade</th>
                  <th className="px-2.5 py-1.5">n</th>
                  <th className="px-2.5 py-1.5">WR</th>
                  <th className="px-2.5 py-1.5">E[R]</th>
                  <th className="px-2.5 py-1.5">Net</th>
                </tr>
              </thead>
              <tbody>
                {path.byGrade.map((g) => (
                  <tr
                    key={g.grade}
                    className="border-t border-[var(--color-border)]"
                  >
                    <td className="px-2.5 py-1.5 font-semibold text-[var(--color-fg)]">
                      {g.grade}
                      {(g.grade === "A+" || g.grade === "A") && (
                        <span className="ml-1 text-[9px] font-normal text-[var(--color-up)]">
                          PATH
                        </span>
                      )}
                    </td>
                    <td className="px-2.5 py-1.5 font-mono">{g.trades}</td>
                    <td
                      className={cn(
                        "px-2.5 py-1.5 font-mono",
                        g.winRate >= 0.7
                          ? "text-[var(--color-up)]"
                          : g.winRate < 0.55
                            ? "text-[var(--color-down)]"
                            : "",
                      )}
                    >
                      {pct(g.winRate)}
                    </td>
                    <td className="px-2.5 py-1.5 font-mono">
                      {g.expectancyR.toFixed(2)}
                    </td>
                    <td
                      className={cn(
                        "px-2.5 py-1.5 font-mono",
                        g.netPnl > 0 && "text-[var(--color-up)]",
                        g.netPnl < 0 && "text-[var(--color-down)]",
                      )}
                    >
                      ${g.netPnl.toFixed(0)}
                    </td>
                  </tr>
                ))}
                {!path.byGrade.length && (
                  <tr>
                    <td
                      colSpan={5}
                      className="px-2.5 py-3 text-[var(--color-subtle)]"
                    >
                      No graded closes yet
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="mt-1.5 text-[10px] text-[var(--color-subtle)]">
            Demo shows B/C dragging overall WR down while A-path stays closer to
            70% — that is the edge of selectivity.
          </p>
        </div>

        {/* By strategy */}
        <div>
          <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--color-fg)]">
            <Crosshair className="h-3.5 w-3.5 text-[var(--color-primary)]" />
            By strategy tag
          </h3>
          <div className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border)]">
            <table className="w-full text-left text-xs">
              <thead className="bg-[var(--color-surface-2)] text-[10px] uppercase tracking-wider text-[var(--color-subtle)]">
                <tr>
                  <th className="px-2.5 py-1.5">Strategy</th>
                  <th className="px-2.5 py-1.5">n</th>
                  <th className="px-2.5 py-1.5">WR</th>
                  <th className="px-2.5 py-1.5">E[R]</th>
                </tr>
              </thead>
              <tbody>
                {path.byStrategy.slice(0, 8).map((s) => (
                  <tr
                    key={s.strategy}
                    className="border-t border-[var(--color-border)]"
                  >
                    <td className="px-2.5 py-1.5 font-mono text-[var(--color-fg)]">
                      {s.strategy}
                    </td>
                    <td className="px-2.5 py-1.5 font-mono">{s.trades}</td>
                    <td
                      className={cn(
                        "px-2.5 py-1.5 font-mono",
                        s.winRate >= 0.7 && "text-[var(--color-up)]",
                        s.winRate < 0.5 && "text-[var(--color-down)]",
                      )}
                    >
                      {pct(s.winRate)}
                    </td>
                    <td className="px-2.5 py-1.5 font-mono">
                      {s.expectancyR.toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="rounded-[var(--radius-md)] border border-[color-mix(in_oklab,var(--color-primary)_25%,var(--color-border))] bg-[color-mix(in_oklab,var(--color-primary)_6%,transparent)] px-3 py-3">
        <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--color-primary)]">
          <TrendingUp className="h-3.5 w-3.5" />
          Next actions toward 70%+
        </div>
        <ol className="list-decimal space-y-1.5 pl-4 text-xs text-[var(--color-muted)]">
          {path.nextActions.map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ol>
        {path.winsNeededForTarget != null && (
          <p className="mt-2 font-mono text-[10px] text-[var(--color-subtle)]">
            To hit ~70% WR at n={PROFIT_MIN_SAMPLE}: need ~
            {path.winsNeededForTarget} more wins in the remaining sample
            (ceiling math — still trade process, not forced wins).
          </p>
        )}
      </div>
    </section>
  );
}
