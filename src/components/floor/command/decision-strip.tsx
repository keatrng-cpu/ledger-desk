/**
 * Floor decision strip — pinned command row.
 * Desk word · Manager call · RH Agentic BP/arm · next checkpoint · feed lag.
 * Display only. Extends the a6be9b7 strip (no duplicate).
 */
import { useEffect, useMemo, useState } from "react";
import type { ManagerRoomState } from "@/lib/room/manager-feed";
import { displayEntry, useAutomation, useEntryState, useRhAccount } from "@/components/desk/use-entry-state";
import { readRhAccount } from "@/lib/ui/rh-account";
import { RH_MIN_DEBIT_TOTAL } from "@/lib/execution/rh-autofire-gates";
import { RhAccountStrip } from "@/components/desk/rh-account-strip";
import { feedDotTone } from "@/lib/ui/feed-dot";
import { fmtAiSyncCountdown, nextAiSyncCheckpoint } from "@/lib/coach/ai-sync";
import { useRoomStore } from "@/components/room/room-engine";
import type { DeskPayload } from "@/lib/trading/build-desk";
import { Wallet } from "lucide-react";

export function FloorDecisionStrip({
  desk,
  entry,
  managerState,
  onManager,
}: {
  desk: DeskPayload | null;
  entry: ReturnType<typeof useEntryState>["read"];
  managerState: ManagerRoomState | null;
  onManager: () => void;
}) {
  const auto = useAutomation();
  const d = entry ? displayEntry(entry, auto) : null;
  const call = managerState?.call ?? null;
  const rh = useRhAccount();

  // Next Discuss checkpoint countdown (same schedule as Discuss tab).
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  const next = useMemo(() => nextAiSyncCheckpoint(now), [now]);

  // Feed source + lag — prefer desk quotes when present, else room feedRead.
  const feedRead = useRoomStore((s) => s.feedRead);
  const feedDot = useMemo(() => {
    if (desk) {
      const sources = [
        desk.quotes.left.source,
        desk.quotes.right.source,
        desk.left.source,
        desk.right.source,
      ];
      const lag = Math.max(desk.quotes.left.lagSec, desk.quotes.right.lagSec);
      return feedDotTone(sources, lag);
    }
    if (feedRead) {
      const kind =
        feedRead.kind === "live_gateway"
          ? "live_gateway"
          : feedRead.kind === "yahoo"
            ? "yahoo"
            : feedRead.kind === "databento"
              ? "databento"
              : "synthetic";
      return feedDotTone([kind], feedRead.lagSec ?? 999);
    }
    return feedDotTone(["synthetic"], 999);
  }, [desk, feedRead]);

  // Fail-closed arm status when account missing or below envelope floor.
  const armBlocked =
    !rh ||
    !Number.isFinite(rh.optionsBuyingPowerUsd) ||
    rh.optionsBuyingPowerUsd < (rh.envelopeMinUsd || RH_MIN_DEBIT_TOTAL) ||
    !rh.canFillEnvelope;
  const armRead = rh
    ? readRhAccount(rh)
    : {
        blocked: true,
        line: `below $${RH_MIN_DEBIT_TOTAL} envelope, arm blocked`,
        who: "RH Agentic",
        freshness: "no read",
        wrongAccount: false,
      };

  return (
    <div className="z-20 grid gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-1)] px-3 py-2 lg:grid-cols-[auto_minmax(0,1.4fr)_auto_auto_auto] lg:items-center">
      {/* Market state — house vocabulary */}
      <div className="flex items-center gap-2" title={d?.hint ?? "Waiting for the desk"}>
        <span className="text-[9px] font-semibold uppercase tracking-wider text-[var(--color-subtle)]">Desk</span>
        <span
          className="rounded px-2 py-0.5 font-mono text-[13px] font-bold"
          style={{ color: d?.color ?? "var(--color-muted)", border: `1px solid ${d?.color ?? "var(--color-border)"}` }}
        >
          {d?.label ?? "WAIT"}
        </span>
      </div>

      {/* Manager call */}
      <button
        type="button"
        onClick={onManager}
        className="flex min-w-0 items-center gap-2 text-left"
        title="Open the Manager's stand"
      >
        <span className="text-[9px] font-semibold uppercase tracking-wider text-[var(--color-subtle)]">Manager</span>
        <span className="font-mono text-[11px] font-semibold text-[var(--color-fg)]">
          {managerState?.current ?? "—"}
        </span>
        <span className="min-w-0 truncate text-[11px] text-[var(--color-muted)]">
          {call
            ? `${call.action}${call.underlier ? ` · ${call.underlier} ${call.side ?? ""}` : ""}${call.reasoning?.thesis ? ` — ${call.reasoning.thesis}` : ""}`
            : d?.why ?? "No call yet."}
        </span>
      </button>

      {/* RH Agentic BP + arm — fail-closed when missing / below envelope */}
      <div className="flex flex-wrap items-center gap-2">
        {rh ? (
          <RhAccountStrip />
        ) : (
          <div
            role="status"
            className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[12px] font-semibold pulse-veto"
            style={{
              color: "#ef4444",
              borderColor: "#ef4444",
              background: "color-mix(in oklab, #ef4444 12%, transparent)",
            }}
            title={`No ManagerRoomState.account — fail-closed. Envelope floor $${RH_MIN_DEBIT_TOTAL}. Display only.`}
          >
            <Wallet className="h-3.5 w-3.5" aria-hidden />
            <span className="font-mono">RH Agentic · arm blocked</span>
            <span className="font-mono text-[11px] font-normal opacity-80">· {armRead.line}</span>
          </div>
        )}
        {armBlocked && rh && (
          <span className="text-[10px] font-bold uppercase tracking-wide text-[#ef4444]">arm blocked</span>
        )}
      </div>

      {/* Next checkpoint */}
      <div className="flex items-center gap-2" title={`Next Discuss checkpoint ${next.slot} ET`}>
        <span className="text-[9px] font-semibold uppercase tracking-wider text-[var(--color-subtle)]">Next</span>
        <span className="font-mono text-[11px] font-semibold text-[var(--color-fg)]">{next.slot} ET</span>
        <span className="font-mono text-[11px] text-[var(--color-muted)]">{fmtAiSyncCountdown(next.secs)}</span>
      </div>

      {/* Feed source + lag dot — SYN/Y! never green */}
      <div className="flex items-center gap-2" title={feedDot.title}>
        <span className="text-[9px] font-semibold uppercase tracking-wider text-[var(--color-subtle)]">Feed</span>
        <span className={`inline-block h-2 w-2 rounded-full ${feedDot.className}`} aria-hidden />
        <span className="font-mono text-[11px] font-semibold text-[var(--color-fg)]">{feedDot.tag}</span>
        <span className="max-w-[10rem] truncate text-[10px] text-[var(--color-muted)] sm:max-w-none">
          {feedDot.label}
        </span>
      </div>
    </div>
  );
}
