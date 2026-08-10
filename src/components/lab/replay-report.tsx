import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, FlaskConical, Loader2, Play } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { latestEngineRun } from "@/lib/engine/ingest";
import {
  runReplay,
  type ReplayRunPayload,
} from "@/lib/engine/replay-server";
import { cn } from "@/lib/utils";

function pct(v: number): string {
  return `${(v * 100).toFixed(0)}%`;
}

function expCls(v: number): string {
  if (v > 0.05) return "text-[var(--color-up)]";
  if (v < -0.05) return "text-[var(--color-down)]";
  return "text-[var(--color-muted)]";
}

/**
 * Replay calibration report — buckets replayed scanner candidates by
 * pre-score and shows what each confluence floor would have admitted.
 * Mount location: see INTEGRATION-P2.md (Lab section of index.tsx).
 */
export function ReplayReport() {
  const [data, setData] = useState<ReplayRunPayload | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load the most recent stored replay run so the report survives reloads.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await latestEngineRun({ data: { kind: "replay" } });
        if (!cancelled && res.ok && res.run) {
          setData(res.run.payload as unknown as ReplayRunPayload);
        }
      } catch {
        // signed out / db unavailable — report simply starts empty
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const run = useCallback(async () => {
    setRunning(true);
    setError(null);
    try {
      const res = await runReplay({});
      if (res.ok) {
        setData({
          report: res.report,
          outcomes: res.outcomes,
          meta: res.meta,
        });
      } else {
        setError(res.error);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Replay failed");
    } finally {
      setRunning(false);
    }
  }, []);

  const report = data?.report ?? null;

  return (
    <Card className="overflow-hidden">
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-[var(--color-primary-dim)] text-[var(--color-primary)]">
            <FlaskConical className="h-5 w-5" aria-hidden />
          </div>
          <div>
            <CardTitle className="text-sm font-medium text-[var(--color-fg)]">
              Replay calibration — the floor question
            </CardTitle>
            <CardDescription>
              No-lookahead walk of MNQ+ES 5d/15m through the live scanner;
              every non-skip candidate simulated forward. Answers what floor
              0.50 vs 0.65 admits — with data, not opinion.
            </CardDescription>
          </div>
        </div>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={running}
          onClick={() => void run()}
        >
          {running ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Play className="h-3.5 w-3.5" />
          )}
          Run replay
        </Button>
      </CardHeader>

      <CardContent className="space-y-4">
        {error ? (
          <div className="rounded-[var(--radius-md)] border-l-4 border-[var(--color-down)] bg-[var(--color-surface-2)] px-3 py-2 text-sm text-[var(--color-muted)]">
            <b className="text-[var(--color-fg)]">Replay failed:</b> {error}
          </div>
        ) : null}

        {!report ? (
          <p className="text-sm text-[var(--color-muted)]">
            No replay run yet — press{" "}
            <span className="font-mono text-[var(--color-fg)]">
              Run replay
            </span>{" "}
            to fetch real 5d/15m Yahoo bars and walk the scanner bar by bar.
          </p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2 font-mono text-[11px] text-[var(--color-subtle)]">
              <span className="rounded-full border border-[var(--color-border)] px-2 py-0.5 text-[var(--color-primary)]">
                {report.total} outcomes
              </span>
              {data?.meta ? (
                <span>
                  {data.meta.symbols.join("+")} · {data.meta.range}/
                  {data.meta.interval} · ran{" "}
                  {data.meta.ranAt.slice(0, 16).replace("T", " ")}Z
                </span>
              ) : null}
            </div>

            <div>
              <h3 className="mb-2 text-[10px] font-medium uppercase tracking-[0.12em] text-[var(--color-subtle)]">
                By pre-score bucket
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="text-[var(--color-subtle)]">
                    <tr>
                      <th className="pb-1 pr-3 font-medium">bucket</th>
                      <th className="pb-1 pr-3 text-right font-medium">n</th>
                      <th className="pb-1 pr-3 text-right font-medium">fill</th>
                      <th className="pb-1 pr-3 text-right font-medium">
                        win 1R
                      </th>
                      <th className="pb-1 pr-3 text-right font-medium">
                        win 2R
                      </th>
                      <th className="pb-1 pr-3 text-right font-medium">
                        exp 1R:1
                      </th>
                      <th className="pb-1 text-right font-medium">exp 2R:1</th>
                    </tr>
                  </thead>
                  <tbody className="font-mono">
                    {report.buckets.map((b) => (
                      <tr
                        key={b.label}
                        className="border-t border-[var(--color-border)]"
                      >
                        <td className="py-1.5 pr-3 text-[var(--color-fg)]">
                          {b.label}
                        </td>
                        <td className="py-1.5 pr-3 text-right tabular">
                          {b.n}
                        </td>
                        <td className="py-1.5 pr-3 text-right tabular text-[var(--color-muted)]">
                          {b.n ? pct(b.fillRate) : "—"}
                        </td>
                        <td className="py-1.5 pr-3 text-right tabular">
                          {b.resolved1R ? pct(b.winRate1R) : "—"}
                        </td>
                        <td className="py-1.5 pr-3 text-right tabular">
                          {b.resolved2R ? pct(b.winRate2R) : "—"}
                        </td>
                        <td
                          className={cn(
                            "py-1.5 pr-3 text-right tabular",
                            b.resolved1R ? expCls(b.expectancy1R) : "",
                          )}
                        >
                          {b.resolved1R
                            ? `${b.expectancy1R >= 0 ? "+" : ""}${b.expectancy1R.toFixed(2)}R`
                            : "—"}
                        </td>
                        <td
                          className={cn(
                            "py-1.5 text-right tabular",
                            b.resolved2R ? expCls(b.expectancy2R) : "",
                          )}
                        >
                          {b.resolved2R
                            ? `${b.expectancy2R >= 0 ? "+" : ""}${b.expectancy2R.toFixed(2)}R`
                            : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div>
              <h3 className="mb-2 text-[10px] font-medium uppercase tracking-[0.12em] text-[var(--color-subtle)]">
                What each floor admits (cumulative ≥ floor)
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="text-[var(--color-subtle)]">
                    <tr>
                      <th className="pb-1 pr-3 font-medium">floor</th>
                      <th className="pb-1 pr-3 text-right font-medium">
                        admitted
                      </th>
                      <th className="pb-1 pr-3 text-right font-medium">
                        of all
                      </th>
                      <th className="pb-1 pr-3 text-right font-medium">fill</th>
                      <th className="pb-1 pr-3 text-right font-medium">
                        win 1R
                      </th>
                      <th className="pb-1 pr-3 text-right font-medium">
                        exp 1R:1
                      </th>
                      <th className="pb-1 text-right font-medium">exp 2R:1</th>
                    </tr>
                  </thead>
                  <tbody className="font-mono">
                    {report.floors.map((f) => (
                      <tr
                        key={f.floor}
                        className={cn(
                          "border-t border-[var(--color-border)]",
                          (f.floor === 0.5 || f.floor === 0.65) &&
                            "bg-[var(--color-surface-2)]",
                        )}
                      >
                        <td className="py-1.5 pr-3 text-[var(--color-fg)]">
                          {f.floor.toFixed(2)}
                          {f.floor === 0.5 ? " (TEST)" : ""}
                          {f.floor === 0.65 ? " (calib)" : ""}
                        </td>
                        <td className="py-1.5 pr-3 text-right tabular">
                          {f.admitted}
                        </td>
                        <td className="py-1.5 pr-3 text-right tabular text-[var(--color-muted)]">
                          {pct(f.admittedPct)}
                        </td>
                        <td className="py-1.5 pr-3 text-right tabular text-[var(--color-muted)]">
                          {f.admitted ? pct(f.fillRate) : "—"}
                        </td>
                        <td className="py-1.5 pr-3 text-right tabular">
                          {f.admitted ? pct(f.winRate1R) : "—"}
                        </td>
                        <td
                          className={cn(
                            "py-1.5 pr-3 text-right tabular",
                            f.admitted ? expCls(f.expectancy1R) : "",
                          )}
                        >
                          {f.admitted
                            ? `${f.expectancy1R >= 0 ? "+" : ""}${f.expectancy1R.toFixed(2)}R`
                            : "—"}
                        </td>
                        <td
                          className={cn(
                            "py-1.5 text-right tabular",
                            f.admitted ? expCls(f.expectancy2R) : "",
                          )}
                        >
                          {f.admitted
                            ? `${f.expectancy2R >= 0 ? "+" : ""}${f.expectancy2R.toFixed(2)}R`
                            : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}

        <div className="flex gap-2 rounded-[var(--radius-md)] border-l-4 border-[var(--color-warn)] bg-[var(--color-surface-2)] px-3 py-2 text-xs leading-relaxed text-[var(--color-muted)]">
          <AlertTriangle
            className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--color-warn)]"
            aria-hidden
          />
          <span>
            <b className="text-[var(--color-fg)]">Honest caveats:</b> 15m Yahoo
            bars (free feed, can lag); intrabar order unknown — when stop and
            target land in the same bar we count the STOP; target hits on the
            fill bar are never counted; entry at the zone&apos;s proximal edge
            (EQ); no slippage, no commission; ~5 trading days of data.
            Directional evidence only — <b>not a backtest</b>.
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
