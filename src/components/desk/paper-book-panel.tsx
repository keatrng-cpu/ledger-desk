import { useEffect, useState } from "react";
import { Bot, CheckCircle2, CircleDot, X } from "lucide-react";
import {
  formatPaperTradeLine,
  listOpenPaperTrades,
  loadPaperTrades,
  type PaperTrade,
} from "@/lib/trading/paper-manager";
import { cn } from "@/lib/utils";

export function PaperBookPanel({
  lastClosed,
}: {
  lastClosed?: PaperTrade | null;
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

  return (
    <section className="rounded-[var(--radius-lg)] border border-[color-mix(in_oklab,var(--color-primary)_25%,var(--color-border))] bg-[var(--color-surface)] p-3">
      <header className="mb-2 flex items-center gap-2">
        <Bot className="h-4 w-4 text-[var(--color-primary)]" />
        <div>
          <h3 className="text-sm font-semibold text-[var(--color-fg)]">
            Paper book · auto-managed
          </h3>
          <p className="text-[10px] text-[var(--color-subtle)]">
            Log = instant entry · AI exits on live stop / TP1 / TP2 from desk
            prints
          </p>
        </div>
      </header>

      {open.length > 0 ? (
        <ul className="space-y-1.5">
          {open.map((t) => (
            <li
              key={t.id}
              className="flex items-start gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2.5 py-2 font-mono text-[11px]"
            >
              <CircleDot className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--color-primary)]" />
              <div className="min-w-0 flex-1">
                <p className="text-[var(--color-fg)]">
                  {formatPaperTradeLine(t)}
                </p>
                <p className="text-[10px] text-[var(--color-subtle)]">
                  {t.strategy} · risk {t.riskPts.toFixed(1)}pts ·{" "}
                  {(t.riskPct * 100).toFixed(1)}% · working SL {t.workingStop}
                </p>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[11px] text-[var(--color-muted)]">
          No open paper trades — click <strong>Log</strong> on a setup for
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
              .map((t) => (
                <li
                  key={t.id}
                  className="rounded border border-[var(--color-border)] px-2 py-1.5 font-mono text-[10px] text-[var(--color-muted)]"
                >
                  {formatPaperTradeLine(t)}
                  {t.exit != null && (
                    <span className="text-[var(--color-subtle)]">
                      {" "}
                      · exit {t.exit}
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
