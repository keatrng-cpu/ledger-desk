/**
 * The entry state for the current desk, shared by the Now hero, the header
 * chip and the Floor's lighting so all three can only ever say the same word.
 * Mapping and rationale: src/lib/ui/entry-state.ts.
 */
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import {
  getAutomation,
  getAutomationServer,
  subscribeAutomation,
  type AutomationState,
} from "@/lib/ui/automation-state";
import type { DeskPayload } from "@/lib/trading/build-desk";
import {
  deriveEntryState,
  detectConflicts,
  type EntryState,
  type EntryStateRead,
} from "@/lib/ui/entry-state";
import { pricePathVerdict } from "@/components/desk/price-path-board";

export function useEntryState(desk: DeskPayload | null): {
  read: EntryStateRead | null;
  conflicts: ReturnType<typeof detectConflicts>;
} {
  // Same pattern as the board: paper-book reads only after mount (SSR has no localStorage).
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  return useMemo(() => {
    if (!desk) return { read: null, conflicts: [] };
    const verdict = pricePathVerdict(desk, ready);
    const now = ready ? Date.now() : Date.parse(desk.fetchedAt) || 0;
    return { read: deriveEntryState(desk, verdict, now), conflicts: detectConflicts(desk) };
    // `desk` changes identity on every rebuild and quote patch; that is the cadence we want.
  }, [desk, ready]);
}

/** Colour + motion per state. Keeps the desk's semantics: teal good, amber warning, grey idle. */
export const ENTRY_STYLE: Record<
  EntryState,
  { color: string; pulse: string; label: string; hint: string }
> = {
  WAIT: { color: "#8b8b94", pulse: "", label: "WAIT", hint: "Nothing to enter now." },
  STALKING: {
    color: "var(--color-warn)",
    pulse: "",
    label: "STALKING",
    hint: "Close — watching, not armed.",
  },
  ARMED: {
    color: "var(--color-primary)",
    pulse: "pulse-armed",
    label: "ARMED",
    hint: "A PATH card is armed; the sequence is one step from TAKE.",
  },
  ENTER: {
    color: "#4ade80",
    pulse: "pulse-enter",
    label: "ENTER",
    hint: "The desk printed TAKE — rest the limit at CE.",
  },
};

export function useAutomation(): AutomationState {
  return useSyncExternalStore(subscribeAutomation, getAutomation, getAutomationServer);
}

/**
 * The word the hero and the header chip print. A position that is OPEN
 * outranks the entry state, so the screen never says WAIT next to a live
 * trade:
 *   - the RH automation reports an open position → IN TRADE
 *   - the board verdict is MANAGE (a paper position is open; entry-state rule 1) → MANAGING
 *   - otherwise the entry state itself.
 */
export interface DisplayEntry {
  key: EntryState | "IN TRADE" | "MANAGING";
  label: string;
  color: string;
  pulse: string;
  why: string;
  hint: string;
}

export function displayEntry(read: EntryStateRead, auto: AutomationState): DisplayEntry {
  if (auto.phase === "open") {
    return {
      key: "IN TRADE",
      label: "IN TRADE",
      color: "#22c55e",
      pulse: "pulse-enter",
      why: `The Robinhood automation reports an open position (${auto.label}). Manage it — no new entry.`,
      hint: "Open position reported by the RH automation (read from the RH fill log).",
    };
  }
  if (read.rule === 1) {
    return { key: "MANAGING", label: "MANAGING", color: "#22c55e", pulse: "", why: read.why, hint: "A paper position is open — manage it." };
  }
  const st = ENTRY_STYLE[read.state];
  return { key: read.state, label: st.label, color: st.color, pulse: st.pulse, why: read.why, hint: st.hint };
}
