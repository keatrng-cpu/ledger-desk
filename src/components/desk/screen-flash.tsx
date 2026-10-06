/**
 * Full-viewport colour flash that follows the entry-state system.
 *
 *   STALKING → amber · ARMED → teal · ENTER → bright green, pulsed 3×
 *   veto / invalidation (a live state falls back to WAIT on rule 3 or 6) → soft red
 *   WAIT → nothing
 *   RH automation (src/lib/ui/automation-state.ts):
 *     open   → strong green flash + persistent green edge glow
 *     closed → green (won) / red (lost) / grey-white (flat), then idle
 *
 * Fast (~600 ms) and pointer-events: none. prefers-reduced-motion gets a static
 * edge border instead of the fade. Header toggle: src/lib/ui/flash-prefs.ts.
 * Dev only: ?flash=stalking|armed|enter|veto|intrade|close-win|close-loss|close-flat
 * previews a state (and holds it) for screenshots. Presentation only.
 */
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { DeskPayload } from "@/lib/trading/build-desk";
import { useEntryState } from "@/components/desk/use-entry-state";
import type { EntryState } from "@/lib/ui/entry-state";
import { getFlashOn, subscribeFlash } from "@/lib/ui/flash-prefs";
import {
  getAutomation,
  getAutomationServer,
  reportAutomation,
  subscribeAutomation,
  type AutomationState,
} from "@/lib/ui/automation-state";

export type FlashKind = "stalking" | "armed" | "enter" | "veto" | "intrade" | "close-win" | "close-loss" | "close-flat";

const FLASH: Record<FlashKind, { color: string; repeat: number; ms: number }> = {
  stalking: { color: "#f59e0b", repeat: 1, ms: 600 },
  armed: { color: "#14b8a6", repeat: 1, ms: 650 },
  enter: { color: "#4ade80", repeat: 3, ms: 520 },
  veto: { color: "#ef4444", repeat: 1, ms: 700 },
  intrade: { color: "#22c55e", repeat: 2, ms: 700 },
  "close-win": { color: "#4ade80", repeat: 1, ms: 800 },
  "close-loss": { color: "#ef4444", repeat: 1, ms: 800 },
  "close-flat": { color: "#e5e7eb", repeat: 1, ms: 700 },
};

const ENTRY_FLASH: Partial<Record<EntryState, FlashKind>> = { STALKING: "stalking", ARMED: "armed", ENTER: "enter" };

export function useFlashOn(): boolean {
  return useSyncExternalStore(subscribeFlash, getFlashOn, () => true);
}

export function useAutomation(): AutomationState {
  return useSyncExternalStore(subscribeAutomation, getAutomation, getAutomationServer);
}

/** Dev preview param, read once on the client. */
function devPreview(): FlashKind | null {
  if (!import.meta.env.DEV || typeof window === "undefined") return null;
  const v = new URLSearchParams(window.location.search).get("flash");
  return v && v in FLASH ? (v as FlashKind) : null;
}

export function ScreenFlash({ desk }: { desk: DeskPayload | null }) {
  const on = useFlashOn();
  const { read } = useEntryState(desk);
  const auto = useAutomation();
  const [flash, setFlash] = useState<{ kind: FlashKind; n: number; hold: boolean } | null>(null);
  const seq = useRef(0);
  const prev = useRef<{ state: EntryState; rule: number } | null>(null);
  const prevAuto = useRef<AutomationState["phase"]>("idle");
  const preview = useRef<FlashKind | null>(null);

  const fire = (kind: FlashKind, hold = false) => {
    seq.current += 1;
    setFlash({ kind, n: seq.current, hold });
  };

  // Dev preview: set the automation lifecycle the param names, and hold the flash for a screenshot.
  useEffect(() => {
    const p = devPreview();
    preview.current = p;
    if (!p) return;
    if (p === "intrade") reportAutomation({ phase: "open", label: "PREVIEW QQQ call ×1", at: Date.now() });
    else if (p.startsWith("close-"))
      reportAutomation({ phase: "closed", result: p.slice(6) as "win" | "loss" | "flat", label: "PREVIEW", at: Date.now() });
    fire(p, true);
  }, []);

  // Entry-state transitions.
  useEffect(() => {
    if (!read || preview.current) return;
    const was = prev.current;
    prev.current = { state: read.state, rule: read.rule };
    if (!was || was.state === read.state) return;
    const k = ENTRY_FLASH[read.state];
    if (k) fire(k);
    // A live state falling back to WAIT on the gate (rule 3) or because the card
    // dropped / was vetoed (rule 6) is an invalidation. Rule 1 (MANAGE) is not.
    else if (read.state === "WAIT" && (read.rule === 3 || read.rule === 6) && was.state !== "WAIT") fire("veto");
  }, [read?.state, read?.rule]); // eslint-disable-line react-hooks/exhaustive-deps

  // Automation lifecycle transitions.
  useEffect(() => {
    if (preview.current) return;
    const was = prevAuto.current;
    prevAuto.current = auto.phase;
    if (was === auto.phase) return;
    if (auto.phase === "open") fire("intrade");
    else if (auto.phase === "closed") {
      fire(auto.result === "win" ? "close-win" : auto.result === "loss" ? "close-loss" : "close-flat");
      // Then back to WAIT: the close is shown once, not held.
      const id = window.setTimeout(() => reportAutomation({ phase: "idle" }), 2500);
      return () => window.clearTimeout(id);
    }
  }, [auto]);

  // Clear a finished flash.
  useEffect(() => {
    if (!flash || flash.hold) return;
    const f = FLASH[flash.kind];
    const id = window.setTimeout(() => setFlash((x) => (x?.n === flash.n ? null : x)), f.ms * f.repeat + 120);
    return () => window.clearTimeout(id);
  }, [flash]);

  const inTrade = auto.phase === "open";
  if (!on) return null;
  const f = flash ? FLASH[flash.kind] : null;
  return (
    <>
      {inTrade && (
        <div
          aria-hidden
          className="ld-edge-glow pointer-events-none fixed inset-0 z-[70]"
          style={{ ["--flash-c" as string]: "#22c55e" }}
        />
      )}
      {flash && f && (
        <div
          key={flash.n}
          aria-hidden
          data-flash={flash.kind}
          className={flash.hold ? "ld-flash-hold pointer-events-none fixed inset-0 z-[71]" : "ld-flash pointer-events-none fixed inset-0 z-[71]"}
          style={{
            ["--flash-c" as string]: f.color,
            animationDuration: `${f.ms}ms`,
            animationIterationCount: flash.hold ? "infinite" : f.repeat,
          }}
        />
      )}
    </>
  );
}

/** "IN TRADE" badge for the header and the hero — only while the automation reports an open position. */
export function InTradeBadge({ className = "", big = false }: { className?: string; big?: boolean }) {
  const auto = useAutomation();
  if (auto.phase !== "open") return null;
  return (
    <span
      className={`pulse-enter inline-flex shrink-0 items-center gap-1 rounded-full border-2 border-[#22c55e] bg-[#22c55e]/15 font-mono font-black tracking-[0.1em] text-[#4ade80] ${big ? "px-3 py-1 text-lg" : "px-2 py-0.5 text-[12px]"} ${className}`}
      title={`Robinhood automation reports an open position: ${auto.label}`}
    >
      IN TRADE
    </span>
  );
}
