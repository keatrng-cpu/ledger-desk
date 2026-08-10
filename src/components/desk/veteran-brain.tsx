import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Brain,
  MessageSquare,
  Pin,
  Radar,
  RefreshCw,
  ShieldAlert,
  Sparkles,
} from "lucide-react";
import type { DeskPayload } from "@/lib/trading/build-desk";
import type { RiskState } from "@/lib/journal/risk";
import {
  loadDeskMemory,
  pinNote,
  remember,
  type DeskMemoryState,
} from "@/lib/trading/desk-memory";
import {
  runVeteranBrain,
  type DiscretionVerdict,
  type VeteranBrief,
} from "@/lib/trading/veteran-brain";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

function verdictStyle(v: DiscretionVerdict): string {
  switch (v) {
    case "TAKE":
      return "border-[color-mix(in_oklab,var(--color-up)_45%,var(--color-border))] bg-[color-mix(in_oklab,var(--color-up)_12%,transparent)] text-[var(--color-up)]";
    case "REDUCE":
      return "border-[color-mix(in_oklab,var(--color-warn)_45%,var(--color-border))] bg-[color-mix(in_oklab,var(--color-warn)_12%,transparent)] text-[var(--color-warn)]";
    case "WATCH":
      return "border-[var(--color-border-strong)] bg-[var(--color-surface-2)] text-[var(--color-fg)]";
    default:
      return "border-[color-mix(in_oklab,var(--color-down)_35%,var(--color-border))] bg-[color-mix(in_oklab,var(--color-down)_8%,transparent)] text-[var(--color-down)]";
  }
}

function toneDot(tone: string): string {
  if (tone === "pass") return "text-[var(--color-up)]";
  if (tone === "fail") return "text-[var(--color-down)]";
  if (tone === "warn") return "text-[var(--color-warn)]";
  return "text-[var(--color-subtle)]";
}

function tabStatusClass(s: string): string {
  if (s === "hot") return "text-[var(--color-up)]";
  if (s === "warn") return "text-[var(--color-warn)]";
  if (s === "ok") return "text-[var(--color-primary)]";
  return "text-[var(--color-subtle)]";
}

function stratStatusClass(s: string): string {
  if (s === "ready") return "text-[var(--color-up)]";
  if (s === "forming") return "text-[var(--color-warn)]";
  if (s === "blocked") return "text-[var(--color-down)]";
  return "text-[var(--color-subtle)]";
}

export function VeteranBrainPanel({
  desk,
  risk,
}: {
  desk: DeskPayload;
  risk?: RiskState | null;
}) {
  const [mem, setMem] = useState<DeskMemoryState>(() => loadDeskMemory());
  const [q, setQ] = useState("");
  const [pin, setPin] = useState("");
  const [asked, setAsked] = useState<string | undefined>();
  const [tick, setTick] = useState(0);
  const lastVerdict = useRef<string>("");

  // Auto-sync memory from other tabs (backtest, journal)
  useEffect(() => {
    const sync = () => {
      setMem(loadDeskMemory());
      setTick((n) => n + 1);
    };
    sync();
    window.addEventListener("focus", sync);
    window.addEventListener("ledger-memory", sync);
    // Continuous light poll so backtest writes show up without leaving tab
    const id = window.setInterval(sync, 12_000);
    return () => {
      window.removeEventListener("focus", sync);
      window.removeEventListener("ledger-memory", sync);
      window.clearInterval(id);
    };
  }, []);

  // Re-run brain whenever desk payload refreshes (parent poll)
  useEffect(() => {
    setTick((n) => n + 1);
  }, [desk.fetchedAt]);

  const brief: VeteranBrief = useMemo(
    () =>
      runVeteranBrain(
        desk,
        mem,
        asked,
        risk
          ? {
              dailyHaltHit: risk.dailyHaltHit,
              weeklyHaltHit: risk.weeklyHaltHit,
              killzoneCapHit: risk.killzoneCapHit,
            }
          : null,
      ),
    [desk, mem, asked, risk, tick],
  );

  // Auto-log discretion changes into memory (no user action)
  useEffect(() => {
    const key = `${brief.verdict}|${brief.setup?.symbol ?? ""}|${brief.setup?.side ?? ""}|${brief.setup?.confluence?.toFixed(2) ?? ""}`;
    if (key === lastVerdict.current) return;
    lastVerdict.current = key;
    remember(
      "discretion",
      `AUTO ${brief.verdict}`,
      brief.headline,
      ["auto", brief.verdict, brief.setup?.strategyPrimary || "none"],
      {
        verdict: brief.verdict,
        sizeMult: brief.sizeMult,
        strategies: brief.strategyBoard
          .filter((s) => s.status === "ready")
          .map((s) => s.id),
      },
    );
  }, [brief.verdict, brief.headline, brief.setup, brief.sizeMult, brief.strategyBoard]);

  const onAsk = useCallback(() => {
    const text = q.trim();
    if (!text) return;
    setAsked(text);
    remember("note", "Asked veteran", text, ["question"]);
    setMem(loadDeskMemory());
    setQ("");
    setTick((n) => n + 1);
  }, [q]);

  const onPin = useCallback(() => {
    if (!pin.trim()) return;
    setMem(pinNote(pin.trim()));
    setPin("");
    window.dispatchEvent(new Event("ledger-memory"));
  }, [pin]);

  const recent = mem.items.slice(0, 8);
  const ready = brief.strategyBoard.filter((s) => s.status === "ready");

  return (
    <section className="rounded-[var(--radius-lg)] border border-[color-mix(in_oklab,var(--color-primary)_30%,var(--color-border))] bg-[var(--color-surface)] p-3 sm:p-4">
      <header className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div className="flex items-start gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-[var(--radius-md)] bg-[color-mix(in_oklab,var(--color-primary)_16%,transparent)] text-[var(--color-primary)]">
            <Brain className="h-4 w-4" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-[var(--color-fg)]">
              Veteran brain · auto
            </h2>
            <p className="text-[11px] text-[var(--color-subtle)]">
              Reads every tab + all strategies continuously · discretion
              without prompts
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1 rounded-full border border-[var(--color-border)] px-2 py-0.5 text-[10px] text-[var(--color-primary)]">
            <Radar className="h-3 w-3 animate-pulse" />
            Live
          </span>
          <span
            className={cn(
              "rounded-full border px-2.5 py-1 font-mono text-[11px] font-bold tracking-wide",
              verdictStyle(brief.verdict),
            )}
          >
            {brief.verdict}
          </span>
          <button
            type="button"
            className="rounded-full border border-[var(--color-border)] p-1.5 text-[var(--color-muted)] hover:text-[var(--color-fg)]"
            title="Force re-read"
            onClick={() => {
              setMem(loadDeskMemory());
              setTick((n) => n + 1);
            }}
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        </div>
      </header>

      {/* Auto actions */}
      <div className="mb-3 rounded-[var(--radius-md)] border border-[color-mix(in_oklab,var(--color-primary)_35%,var(--color-border))] bg-[color-mix(in_oklab,var(--color-primary)_8%,var(--color-surface-2))] px-3 py-2.5">
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-primary)]">
          Auto plan · no click required
        </p>
        <p className="text-sm font-medium text-[var(--color-fg)]">{brief.headline}</p>
        <p className="mt-1 text-[11px] text-[var(--color-muted)]">{brief.focus}</p>
        <ul className="mt-2 space-y-0.5 text-[11px] text-[var(--color-muted)]">
          {brief.autoActions.map((a) => (
            <li key={a} className="flex gap-1.5">
              <span className="text-[var(--color-primary)]">→</span>
              {a}
            </li>
          ))}
        </ul>
        <p className="mt-2 font-mono text-[11px] text-[var(--color-fg)]">
          Size ×{brief.sizeMult.toFixed(2)} · BT bias ×{brief.rateSizeBias.toFixed(2)} · conf{" "}
          {(brief.confidence * 100).toFixed(0)}% · {brief.posture}
        </p>
      </div>

      {/* Backtest rates → live */}
      <div className="mb-3 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2">
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-subtle)]">
          Backtest rates → live
        </p>
        <p className="font-mono text-[11px] text-[var(--color-fg)]">
          {brief.rateSummary}
        </p>
        {brief.rateAdvice.length > 0 && (
          <ul className="mt-1.5 space-y-0.5 text-[11px] text-[var(--color-muted)]">
            {brief.rateAdvice.map((a) => (
              <li key={a}>→ {a}</li>
            ))}
          </ul>
        )}
      </div>

      {/* Auto tab reads */}
      <div className="mb-3">
        <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-subtle)]">
          Auto-read tabs
        </p>
        <div className="grid gap-1 sm:grid-cols-2">
          {brief.tabReads.map((t) => (
            <div
              key={t.tab}
              className="rounded border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2 py-1.5 text-[11px]"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-[var(--color-fg)]">
                  {t.tab}
                </span>
                <span
                  className={cn(
                    "font-mono text-[9px] uppercase",
                    tabStatusClass(t.status),
                  )}
                >
                  {t.status}
                </span>
              </div>
              <p className="mt-0.5 text-[var(--color-muted)]">{t.line}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Strategy board */}
      <div className="mb-3">
        <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-subtle)]">
          Strategies (always on) · {ready.length} ready
        </p>
        <div className="max-h-44 overflow-auto rounded-[var(--radius-md)] border border-[var(--color-border)]">
          <table className="w-full text-left text-[11px]">
            <thead className="sticky top-0 bg-[var(--color-surface-2)] text-[9px] uppercase tracking-wider text-[var(--color-subtle)]">
              <tr>
                <th className="px-2 py-1.5">Model</th>
                <th className="px-2 py-1.5">Status</th>
                <th className="px-2 py-1.5">Score</th>
                <th className="px-2 py-1.5">Note</th>
              </tr>
            </thead>
            <tbody>
              {brief.strategyBoard.map((s) => (
                <tr
                  key={s.id}
                  className="border-t border-[var(--color-border)]"
                >
                  <td className="px-2 py-1 font-mono font-semibold text-[var(--color-fg)]">
                    {s.id}
                  </td>
                  <td
                    className={cn(
                      "px-2 py-1 font-mono text-[10px] uppercase",
                      stratStatusClass(s.status),
                    )}
                  >
                    {s.status}
                  </td>
                  <td className="px-2 py-1 font-mono">
                    {s.score ? s.score.toFixed(2) : "—"}
                  </td>
                  <td className="px-2 py-1 text-[var(--color-muted)]">
                    {s.note}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Discretion layers */}
      <div className="mb-3">
        <p className="mb-1.5 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-subtle)]">
          <ShieldAlert className="h-3 w-3" />
          Discretion stack (auto)
        </p>
        <ul className="grid gap-1 sm:grid-cols-2">
          {brief.layers.map((L) => (
            <li
              key={L.id}
              className="flex gap-2 rounded border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2 py-1.5 text-[11px]"
            >
              <span className={cn("font-mono font-bold", toneDot(L.tone))}>
                {L.tone === "pass"
                  ? "OK"
                  : L.tone === "fail"
                    ? "NO"
                    : L.tone === "warn"
                      ? "!!"
                      : "·"}
              </span>
              <span>
                <span className="font-semibold text-[var(--color-fg)]">
                  {L.label}
                </span>
                <span className="text-[var(--color-muted)]"> — {L.detail}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>

      <div className="mb-3 grid gap-2 sm:grid-cols-3">
        <div className="rounded border border-[var(--color-border)] px-2 py-1.5">
          <p className="text-[9px] uppercase text-[var(--color-up)]">Likes</p>
          <ul className="mt-0.5 space-y-0.5 text-[11px] text-[var(--color-muted)]">
            {(brief.green.length ? brief.green : ["—"]).map((g) => (
              <li key={g}>+ {g}</li>
            ))}
          </ul>
        </div>
        <div className="rounded border border-[var(--color-border)] px-2 py-1.5">
          <p className="text-[9px] uppercase text-[var(--color-warn)]">Watches</p>
          <ul className="mt-0.5 space-y-0.5 text-[11px] text-[var(--color-muted)]">
            {(brief.yellow.length ? brief.yellow : ["—"]).map((g) => (
              <li key={g}>~ {g}</li>
            ))}
          </ul>
        </div>
        <div className="rounded border border-[var(--color-border)] px-2 py-1.5">
          <p className="text-[9px] uppercase text-[var(--color-down)]">Vetoes</p>
          <ul className="mt-0.5 space-y-0.5 text-[11px] text-[var(--color-muted)]">
            {(brief.vetoes.length ? brief.vetoes : ["None"]).map((g) => (
              <li key={g}>× {g}</li>
            ))}
          </ul>
        </div>
      </div>

      <div className="mb-3 rounded-[var(--radius-md)] border border-[color-mix(in_oklab,var(--color-primary)_25%,var(--color-border))] bg-[color-mix(in_oklab,var(--color-primary)_6%,transparent)] px-3 py-2">
        <p className="mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-primary)]">
          <Sparkles className="h-3 w-3" />
          Veteran (auto)
        </p>
        <ul className="space-y-1 text-[12px] leading-relaxed text-[var(--color-fg)]">
          {brief.monologue.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      </div>

      <div className="mb-3">
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-subtle)]">
          Memory feed (auto)
        </p>
        <p className="mb-1.5 text-[11px] text-[var(--color-muted)]">
          {brief.memoryLine}
        </p>
        {recent.length > 0 && (
          <ul className="max-h-28 space-y-1 overflow-auto text-[11px]">
            {recent.map((it) => (
              <li
                key={it.id}
                className="flex flex-wrap gap-x-2 border-t border-[var(--color-border)] pt-1 text-[var(--color-muted)]"
              >
                <span className="font-mono text-[9px] uppercase text-[var(--color-subtle)]">
                  {it.kind}
                </span>
                <span className="text-[var(--color-fg)]">{it.title}</span>
                <span className="truncate">{it.summary}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Optional pin / ask — brain does not require these */}
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="flex gap-1.5">
          <input
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            placeholder="Optional pin (e.g. A+ only after 2 losses)"
            className="min-w-0 flex-1 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1.5 text-xs text-[var(--color-fg)] outline-none focus:border-[var(--color-primary)]"
            onKeyDown={(e) => e.key === "Enter" && onPin()}
          />
          <Button type="button" size="sm" variant="secondary" onClick={onPin}>
            <Pin className="h-3.5 w-3.5" />
          </Button>
        </div>
        <div className="flex gap-1.5">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Optional question"
            className="min-w-0 flex-1 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1.5 text-xs text-[var(--color-fg)] outline-none focus:border-[var(--color-primary)]"
            onKeyDown={(e) => e.key === "Enter" && onAsk()}
          />
          <Button type="button" size="sm" onClick={onAsk}>
            <MessageSquare className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {brief.asked && brief.answer && (
        <div className="mt-2 rounded border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2.5 py-2 text-[12px]">
          <p className="text-[10px] text-[var(--color-subtle)]">
            Q: {brief.asked}
          </p>
          <p className="mt-0.5 text-[var(--color-fg)]">{brief.answer}</p>
        </div>
      )}

      <p className="mt-3 text-[10px] text-[var(--color-subtle)]">
        Fully automatic: desk poll + memory poll + strategy scan. Hard gates
        (HTF, news blackout, halt) still cannot be overridden.
      </p>
    </section>
  );
}
