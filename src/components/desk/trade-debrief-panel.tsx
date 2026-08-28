import { useEffect, useState } from "react";
import { BookOpen, CheckCircle2, XCircle } from "lucide-react";
import {
  debriefPaper,
  loadDebriefs,
  loadLastDebrief,
  pushDebrief,
  subscribeDebriefs,
  type DebriefResult,
  type TradeDebrief,
} from "@/lib/trading/trade-debrief";
import { loadPaperTrades } from "@/lib/trading/paper-manager";
import { cn } from "@/lib/utils";

function pct(n: number | null): string {
  return n == null ? "—" : `${Math.round(n * 100)}%`;
}

function tone(result: DebriefResult): "up" | "down" | "warn" {
  if (result === "win") return "up";
  if (result === "loss") return "down";
  return "warn";
}

function DebriefBody({ d, compact }: { d: TradeDebrief; compact?: boolean }) {
  const t = tone(d.result);
  return (
    <div
      className={cn(
        "rounded-[var(--radius-md)] border px-3 py-2.5",
        t === "up" &&
          "border-[color-mix(in_oklab,var(--color-up)_50%,var(--color-border))] bg-[color-mix(in_oklab,var(--color-up)_9%,transparent)]",
        t === "down" &&
          "border-[color-mix(in_oklab,var(--color-down)_50%,var(--color-border))] bg-[color-mix(in_oklab,var(--color-down)_9%,transparent)]",
        t === "warn" &&
          "border-[color-mix(in_oklab,var(--color-warn)_45%,var(--color-border))] bg-[color-mix(in_oklab,var(--color-warn)_8%,transparent)]",
      )}
    >
      <div className="mb-1.5 flex flex-wrap items-center gap-2">
        {d.result === "win" ? (
          <CheckCircle2 className="h-4 w-4 text-[var(--color-up)]" />
        ) : (
          <XCircle
            className={cn(
              "h-4 w-4",
              t === "down" ? "text-[var(--color-down)]" : "text-[var(--color-warn)]",
            )}
          />
        )}
        <p
          className={cn(
            "text-[11px] font-semibold uppercase tracking-wide",
            t === "up" && "text-[var(--color-up)]",
            t === "down" && "text-[var(--color-down)]",
            t === "warn" && "text-[var(--color-warn)]",
          )}
        >
          {d.result === "win"
            ? "Worked"
            : d.result === "loss"
              ? "Failed"
              : d.result === "miss"
                ? "Missed"
                : "Skipped"}
          {d.r != null ? ` · ${d.r >= 0 ? "+" : ""}${d.r.toFixed(2)}R` : ""}
          {d.usd != null ? ` · ${d.usd >= 0 ? "+" : ""}$${d.usd.toFixed(0)}` : ""}
        </p>
        <span className="ml-auto font-mono text-[10px] text-[var(--color-subtle)]">
          {d.symbol} {d.side} · {d.strategy} · {d.grade}
        </span>
      </div>
      <p className="text-sm font-medium text-[var(--color-fg)]">{d.headline}</p>
      {!compact && (
        <>
          <ul className="mt-1.5 space-y-0.5 text-[12px] leading-snug text-[var(--color-muted)]">
            {d.why.slice(0, 3).map((w) => (
              <li key={w}>• {w}</li>
            ))}
          </ul>
          {d.worked.length > 0 && (
            <p className="mt-1.5 text-[11px] text-[var(--color-up)]">
              Worked: {d.worked.join(" · ")}
            </p>
          )}
          {d.failed.length > 0 && (
            <p className="mt-0.5 text-[11px] text-[var(--color-down)]">
              Failed: {d.failed.join(" · ")}
            </p>
          )}
          <p className="mt-1.5 text-[12px] text-[var(--color-fg)]">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--color-subtle)]">
              Lesson ·{" "}
            </span>
            {d.lesson}
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5 font-mono text-[10px] text-[var(--color-muted)]">
            <span className="rounded-full border border-[var(--color-border)] px-2 py-0.5">
              Paper {d.stats.paperN} · WR {pct(d.stats.paperWr)} · ΣR{" "}
              {d.stats.paperSumR.toFixed(2)}
            </span>
            <span className="rounded-full border border-[var(--color-border)] px-2 py-0.5">
              {d.strategy} n={d.stats.stratN} WR {pct(d.stats.stratWr)}
            </span>
            <span className="rounded-full border border-[var(--color-border)] px-2 py-0.5">
              {d.side} n={d.stats.sideN} WR {pct(d.stats.sideWr)}
            </span>
            <span className="rounded-full border border-[var(--color-border)] px-2 py-0.5">
              Eq ${d.stats.equity.toLocaleString()}
            </span>
          </div>
        </>
      )}
    </div>
  );
}

export function TradeDebriefPanel({
  lastPaper,
}: {
  lastPaper?: TradeDebrief | null;
}) {
  const [last, setLast] = useState<TradeDebrief | null>(null);
  const [recent, setRecent] = useState<TradeDebrief[]>([]);

  useEffect(() => {
    const sync = () => {
      let next = lastPaper ?? loadLastDebrief();
      if (!next) {
        const closed = loadPaperTrades().find((t) => t.status === "closed");
        if (closed) {
          next = closed.debrief ?? debriefPaper(closed);
          pushDebrief(next);
        }
      }
      setLast(next);
      setRecent(loadDebriefs().slice(0, 6));
    };
    sync();
    return subscribeDebriefs(sync);
  }, [lastPaper]);

  const shown = lastPaper ?? last;
  if (!shown && recent.length === 0) return null;

  const rest = recent.filter((d) => d.id !== shown?.id).slice(0, 4);

  return (
    <section className="rounded-[var(--radius-lg)] border border-[color-mix(in_oklab,var(--color-primary)_28%,var(--color-border))] bg-[var(--color-surface)] p-3">
      <header className="mb-2 flex items-center gap-2">
        <BookOpen className="h-4 w-4 text-[var(--color-primary)]" />
        <div>
          <h3 className="text-sm font-semibold text-[var(--color-fg)]">
            Trade debrief
          </h3>
          <p className="text-[10px] text-[var(--color-subtle)]">
            Close and miss write here — brain + rates remember it
          </p>
        </div>
      </header>
      {shown ? <DebriefBody d={shown} /> : null}
      {rest.length > 0 && (
        <div className="mt-2 space-y-1.5">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-subtle)]">
            Session tape
          </p>
          {rest.map((d) => (
            <DebriefBody key={d.id} d={d} compact />
          ))}
        </div>
      )}
    </section>
  );
}
