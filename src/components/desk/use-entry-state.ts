/**
 * The entry state for the current desk, shared by the Now hero, the header
 * chip and the Floor's lighting so all three can only ever say the same word.
 * Mapping and rationale: src/lib/ui/entry-state.ts.
 */
import { useEffect, useMemo, useState } from "react";
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
