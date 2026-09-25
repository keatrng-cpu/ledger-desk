import { useEffect, useState } from "react";
import { managementLine } from "@/lib/trading/discretion-memory";
import { Bot, CheckCircle2, CircleDot } from "lucide-react";
import {
  closePaperTrade,
  formatPaperTradeLine,
  listOpenPaperTrades,
  loadPaperTrades,
  type PaperTrade,
} from "@/lib/trading/paper-manager";
import { Button } from "@/components/ui/button";
import { APLUS_RULES } from "@/lib/aplus/config";
import { cn } from "@/lib/utils";

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
            {APLUS_RULES.scaleOut.tp1Fraction * 100}% at T1 (the plan&apos;s draw) → stop to BE →
            runner to T2 · managed on live prints · Auto paper fills TAKE cards in NY AM
          </p>
        </div>
      </header>

      {open.length > 0 && (
        <p className="mb-2 rounded-[var(--radius-sm)] border border-[color-mix(in_oklab,var(--color-warn)_35%,transparent)] px-2 py-1 text-[10px] leading-snug text-[var(--color-muted)]">
          {managementLine()}
        </p>
      )}
      {open.length > 0 ? (
        <ul className="space-y-1.5">
          {open.map((t) => {
            // THIS instrument's mark only. The old fallback chain ended in
            // `liveMarks.ES`, so an MNQ trade with no MNQ mark offered to
            // close at an ES price — a fill ~23,000 points from market.
            const mark = liveMarks?.[t.displaySymbol] ?? liveMarks?.[t.symbol];

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
                    {/* One manual exit, at the price that is actually
                        printing. "Close @ structure" (a hardcoded ES 7763)
                        and "Close @ TP1" (100% at T1 whether or not it
                        printed) are gone: the first invented fills, the
                        second is the protect-early exit measured at
                        -0.42R/t. The management rule runs on its own. */}
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      {mark != null ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          className="h-7 px-2 text-[10px]"
                          onClick={() => doClose(t, mark, "manual_mark")}
                        >
                          Flatten @ mark {mark}
                        </Button>
                      ) : (
                        <span className="text-[10px] text-[var(--color-subtle)]">
                          No live {t.displaySymbol} mark — nothing to flatten against
                        </span>
                      )}
                      <span className="text-[10px] text-[var(--color-subtle)]">
                        overriding the rule is logged as a discretionary exit
                      </span>
                    </div>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-[11px] text-[var(--color-muted)]">
          No open paper trades. <strong>Log paper</strong> on a card rests a limit at the
          plan&apos;s CE — it fills when price trades there, not when you click.
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
                  {tr.debrief && (
                    <p className="mt-0.5 font-sans text-[10px] text-[var(--color-fg)]">
                      {tr.debrief.lesson}
                    </p>
                  )}
                </li>
              ))}
          </ul>
        </div>
      )}
    </section>
  );
}
