import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Brain,
  MessageSquare,
  Pin,
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

  // Reload memory when tab focuses / after backtests write
  useEffect(() => {
    const sync = () => setMem(loadDeskMemory());
    sync();
    window.addEventListener("focus", sync);
    window.addEventListener("ledger-memory", sync);
    return () => {
      window.removeEventListener("focus", sync);
      window.removeEventListener("ledger-memory", sync);
    };
  }, []);

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

  const recent = mem.items.slice(0, 6);

  return (
    <section className="rounded-[var(--radius-lg)] border border-[color-mix(in_oklab,var(--color-primary)_30%,var(--color-border))] bg-[var(--color-surface)] p-3 sm:p-4">
      <header className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div className="flex items-start gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-[var(--radius-md)] bg-[color-mix(in_oklab,var(--color-primary)_16%,transparent)] text-[var(--color-primary)]">
            <Brain className="h-4.5 w-4.5" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-[var(--color-fg)]">
              Veteran brain · SMC/ICT
            </h2>
            <p className="text-[11px] text-[var(--color-subtle)]">
              Remembers backtests, journal path, pins · discretion on top of
              hard gates
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
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
            title="Refresh memory"
            onClick={() => {
              setMem(loadDeskMemory());
              setTick((n) => n + 1);
            }}
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        </div>
      </header>

      {/* Headline */}
      <div className="mb-3 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2.5">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-primary)]">
          {brief.posture} · conf {(brief.confidence * 100).toFixed(0)}%
          {brief.sizeMult > 0
            ? ` · size ×${brief.sizeMult}`
            : " · size ×0"}
        </p>
        <p className="mt-1 text-sm font-medium text-[var(--color-fg)]">
          {brief.headline}
        </p>
        <p className="mt-1 text-[11px] text-[var(--color-muted)]">{brief.focus}</p>
      </div>

      {/* Discretion layers */}
      <div className="mb-3">
        <p className="mb-1.5 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-subtle)]">
          <ShieldAlert className="h-3 w-3" />
          Discretion stack
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

      {/* Green / yellow / veto */}
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

      {/* Monologue */}
      <div className="mb-3 rounded-[var(--radius-md)] border border-[color-mix(in_oklab,var(--color-primary)_25%,var(--color-border))] bg-[color-mix(in_oklab,var(--color-primary)_6%,transparent)] px-3 py-2">
        <p className="mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-primary)]">
          <Sparkles className="h-3 w-3" />
          Veteran says
        </p>
        <ul className="space-y-1 text-[12px] leading-relaxed text-[var(--color-fg)]">
          {brief.monologue.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      </div>

      {/* Memory strip */}
      <div className="mb-3">
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-subtle)]">
          Memory
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

      {/* Pin + ask */}
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="flex gap-1.5">
          <input
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            placeholder="Pin rule for brain (e.g. no London open)"
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
            placeholder="Ask veteran (should I take it? HTF? size?)"
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
        Discretion never overrides HTF gate, news blackout, or risk halt.
        Structure scores stay ground truth — the brain only sizes conviction.
      </p>
    </section>
  );
}
