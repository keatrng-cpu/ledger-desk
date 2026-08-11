import { useEffect, useState } from "react";
import { Bot, CheckCircle2, CircleDot } from "lucide-react";
import {
  closePaperTrade,
  formatPaperTradeLine,
  listOpenPaperTrades,
  loadPaperTrades,
  type PaperTrade,
} from "@/lib/trading/paper-manager";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Default structure TP for ES short session — user: 7763 low */
const DEFAULT_STRUCTURE_TP = 7763;

export function PaperBookPanel({
  lastClosed,
  liveMarks,
  onClosed,
}: {
  lastClosed?: PaperTrade | null;
  /** Live marks by symbol for structure close */
  liveMarks?: Partial<Record<string, number>>;
  onClosed?: (t: PaperTrade) => void;
}) {
  const [open, setOpen] = useState<PaperTrade[]>([]);
  const [recent, setRecent] = useState<PaperTrade[]>([]);

  useEffect(() => {
    const sync = () => {
      setOpen(listOpenPaperTrades());
      setRecent(
        loadPaperTrades()
          .filter((t) => t.status === "closed")
          .slice(0, 5),
      );
    };
    sync();
    window.addEventListener("ledger-paper", sync);
    return () => window.removeEventListener("ledger-paper", sync);
  }, [lastClosed]);

  const doClose = (t: PaperTrade, px: number, reason: string) => {
    const closed = closePaperTrade(t.id, px, reason);
    if (closed) {
      onClosed?.(closed);
      setOpen(listOpenPaperTrades());
      setRecent(
        loadPaperTrades()
          .filter((x) => x.status === "closed")
          .slice(0, 5),
      );
    }
  };

  return (
    <section className="rounded-[var(--radius-lg)] border border-[color-mix(in_oklab,var(--color-primary)_25%,var(--color-border))] bg-[var(--color-surface)] p-3">
      <header className="mb-2 flex items-center gap-2">
        <Bot className="h-4 w-4 text-[var(--color-primary)]" />
        <div>
          <h3 className="text-sm font-semibold text-[var(--color-fg)]">
            Paper book · auto-managed
          </h3>
          <p className="text-[10px] text-[var(--color-subtle)]">
            Structure TP default ES low {DEFAULT_STRUCTURE_TP} · scale @ nearer
            target · close remaining on structure low
          </p>
        </div>
      </header>

      {open.length > 0 ? (
        <ul className="space-y-1.5">
          {open.map((t) => {
            const mark =
              liveMarks?.[t.displaySymbol] ??
              liveMarks?.[t.symbol] ??
              liveMarks?.ES ??
              liveMarks?.MES;
            const structurePx =
              t.side === "short"
                ? Math.min(t.tp2, t.tp1, DEFAULT_STRUCTURE_TP)
                : Math.max(t.tp2, t.tp1);
            // Prefer 7763 for ES shorts as structure close
            const esStructure =
              t.displaySymbol === "ES" || t.symbol === "MES"
                ? DEFAULT_STRUCTURE_TP
                : structurePx;

            return (
              <li
                key={t.id}
                className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2.5 py-2"
              >
                <div className="flex items-start gap-2 font-mono text-[11px]">
                  <CircleDot className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--color-primary)]" />
                  <div className="min-w-0 flex-1">
                    <p className="text-[var(--color-fg)]">
                      {formatPaperTradeLine(t)}
                    </p>
                    <p className="text-[10px] text-[var(--color-subtle)]">
                      {t.strategy} · risk {t.riskPts.toFixed(1)}pts · TP1{" "}
                      {t.tp1} · TP2/structure {t.tp2}
                      {mark != null ? ` · mark ${mark}` : ""}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <Button
                        type="button"
                        size="sm"
                        className="h-7 px-2 text-[10px]"
                        onClick={() =>
                          doClose(
                            t,
                            t.side === "short"
                              ? Math.min(esStructure, mark ?? esStructure)
                              : Math.max(esStructure, mark ?? esStructure),
                            "structure_tp",
                          )
                        }
                      >
                        Close @ {esStructure} structure
                      </Button>
                      {mark != null && (
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          className="h-7 px-2 text-[10px]"
                          onClick={() => doClose(t, mark, "manual_mark")}
                        >
                          Close @ mark {mark}
                        </Button>
                      )}
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        className="h-7 px-2 text-[10px]"
                        onClick={() => doClose(t, t.tp1, "tp1")}
                      >
                        Close @ TP1 {t.tp1}
                      </Button>
                    </div>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-[11px] text-[var(--color-muted)]">
          No open paper trades — click <strong>Log paper</strong> on a setup for
          instant entry.
        </p>
      )}

      {(recent.length > 0 || lastClosed) && (
        <div className="mt-2 space-y-1">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-subtle)]">
            Recent closed
          </p>
          <ul className="space-y-1">
            {(lastClosed && !recent.find((r) => r.id === lastClosed.id)
              ? [lastClosed, ...recent]
              : recent
            )
              .slice(0, 5)
              .map((tr) => (
                <li
                  key={tr.id}
                  className={cn(
                    "rounded border border-[var(--color-border)] px-2 py-1.5 font-mono text-[10px] text-[var(--color-muted)]",
                    (tr.rMultiple ?? 0) >= 0
                      ? "border-[color-mix(in_oklab,var(--color-up)_25%,var(--color-border))]"
                      : "border-[color-mix(in_oklab,var(--color-down)_25%,var(--color-border))]",
                  )}
                >
                  {formatPaperTradeLine(tr)}
                  {tr.exit != null && (
                    <span className="text-[var(--color-subtle)]">
                      {" "}
                      · exit {tr.exit}
                    </span>
                  )}
                </li>
              ))}
          </ul>
        </div>
      )}
    </section>
  );
}
