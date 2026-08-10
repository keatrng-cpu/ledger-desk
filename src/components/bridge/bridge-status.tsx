/**
 * Bridge status card — engine liveness + paper-loop arm switch.
 *
 * Self-contained: it fetches its own status via `getBridgeStatus` and refreshes
 * on the same 30s cadence as the desk poll. The integrator only has to mount it
 * (see INTEGRATION-P4.md); it does not read desk payload props.
 */

import { useCallback, useEffect, useState } from "react";
import { Activity, FlaskConical, RefreshCw } from "lucide-react";
import {
  getBridgeStatus,
  togglePaperMode,
  type BridgeStatusPayload,
} from "@/lib/bridge/paper-server";
import { cn } from "@/lib/utils";

const REFRESH_MS = 30_000;
const GREEN_MS = 2 * 60_000;
const AMBER_MS = 15 * 60_000;

type Health = "live" | "stale" | "down";

function health(lastSeen: string | null, nowMs: number): Health {
  if (!lastSeen) return "down";
  const age = nowMs - Date.parse(lastSeen);
  if (!Number.isFinite(age) || age < 0) return "stale";
  if (age < GREEN_MS) return "live";
  if (age < AMBER_MS) return "stale";
  return "down";
}

const DOT: Record<Health, string> = {
  live: "bg-[var(--color-up)]",
  stale: "bg-[var(--color-warn)]",
  down: "bg-[var(--color-down)]",
};

const LABEL: Record<Health, string> = {
  live: "engine live",
  stale: "engine stale",
  down: "engine down",
};

function ago(lastSeen: string | null, nowMs: number): string {
  if (!lastSeen) return "never";
  const secs = Math.max(0, Math.round((nowMs - Date.parse(lastSeen)) / 1000));
  if (!Number.isFinite(secs)) return "—";
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  return `${Math.floor(secs / 3600)}h ago`;
}

export function BridgeStatus({ className }: { className?: string }) {
  const [status, setStatus] = useState<BridgeStatusPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const load = useCallback(async () => {
    try {
      const res = await getBridgeStatus();
      if (res.ok) {
        setStatus(res);
        setError(null);
      } else {
        setError(res.error);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Bridge status unavailable");
    }
  }, []);

  useEffect(() => {
    void load();
    const poll = setInterval(() => {
      setNowMs(Date.now());
      void load();
    }, REFRESH_MS);
    return () => clearInterval(poll);
  }, [load]);

  const onToggle = useCallback(async () => {
    if (!status || busy) return;
    setBusy(true);
    try {
      const res = await togglePaperMode({
        data: { enabled: !status.paperEnabled },
      });
      setStatus({ ...status, paperEnabled: res.paperEnabled });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Toggle failed");
    } finally {
      setBusy(false);
    }
  }, [busy, status]);

  const state = health(status?.lastSeen ?? null, nowMs);

  return (
    <section
      className={cn(
        "rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3 sm:p-4",
        className,
      )}
    >
      <header className="mb-3 flex items-center gap-2">
        <Activity className="h-4 w-4 text-[var(--color-primary)]" />
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-[var(--color-fg)]">
            Automation bridge
          </h2>
          <p className="text-xs text-[var(--color-subtle)]">
            Trading-Automation engine → desk journal (paper first)
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setNowMs(Date.now());
            void load();
          }}
          className="rounded-[var(--radius-sm)] border border-[var(--color-border)] p-1.5 text-[var(--color-subtle)] hover:text-[var(--color-fg)]"
          aria-label="Refresh bridge status"
        >
          <RefreshCw className="h-3.5 w-3.5" />
        </button>
      </header>

      <div className="flex items-center gap-2 font-mono text-xs">
        <span className={cn("h-2 w-2 rounded-full", DOT[state])} />
        <span className="text-[var(--color-fg)]">{LABEL[state]}</span>
        <span className="text-[var(--color-subtle)]">
          · {ago(status?.lastSeen ?? null, nowMs)}
        </span>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-x-4 gap-y-1.5 font-mono text-xs sm:grid-cols-2">
        {(
          [
            ["Engine mode", status?.mode ?? "—"],
            ["Symbol", status?.symbol ?? "—"],
            ["Engine events today", String(status?.engineEventsToday ?? 0)],
            ["Open paper trades", String(status?.openPaperTrades ?? 0)],
          ] as const
        ).map(([k, v]) => (
          <div
            key={k}
            className="flex justify-between gap-3 border-b border-[var(--color-border)] py-1.5"
          >
            <span className="text-[var(--color-subtle)]">{k}</span>
            <span className="text-right text-[var(--color-fg)]">{v}</span>
          </div>
        ))}
      </div>

      <div className="mt-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <FlaskConical className="h-4 w-4 text-[var(--color-subtle)]" />
          <span className="font-mono text-xs text-[var(--color-fg)]">
            Paper loop
          </span>
          <span
            className={cn(
              "rounded-[var(--radius-sm)] px-1.5 py-0.5 font-mono text-[10px] uppercase",
              status?.paperEnabled
                ? "border border-[color-mix(in_oklab,var(--color-up)_40%,var(--color-border))] text-[var(--color-up)]"
                : "border border-[var(--color-border)] text-[var(--color-muted)]",
            )}
          >
            {status?.paperEnabled ? "armed" : "off"}
          </span>
        </div>
        <button
          type="button"
          onClick={() => void onToggle()}
          disabled={busy || !status}
          className={cn(
            "rounded-[var(--radius-sm)] border px-2.5 py-1 font-mono text-xs transition-colors",
            "border-[var(--color-border)] text-[var(--color-fg)] hover:bg-[var(--color-border)]/40",
            (busy || !status) && "cursor-not-allowed opacity-50",
          )}
        >
          {status?.paperEnabled ? "Disarm" : "Arm paper"}
        </button>
      </div>

      {error ? (
        <p className="mt-3 font-mono text-xs text-[var(--color-down)]">
          {error}
        </p>
      ) : null}

      <p className="mt-3 text-xs leading-relaxed text-[var(--color-muted)]">
        Paper only. Live execution stays locked until ≥100 closed paper trades
        show positive expectancy (ROADMAP Phase 4 ladder).
      </p>
    </section>
  );
}
