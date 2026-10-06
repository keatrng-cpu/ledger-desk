/**
 * The Robinhood live-options automation, as the screen's colour system sees it.
 *
 * READ-ONLY SEAM. This file never places, reviews or cancels anything and has
 * no route to a broker. It holds the last lifecycle the automation REPORTED so
 * the flash, the header badge and the hero can show it:
 *
 *   idle      → nothing (the desk entry state drives the colour)
 *   open      → strong green flash + persistent green edge glow + "IN TRADE"
 *   closed    → green flash (won), red (lost), grey/white (flat/scratch),
 *               then back to idle
 *
 * "Considering an entry" (the automation's Floor ARMED + PATH + Stand triple
 * agreement) is not a separate state here: it is the same STALKING → ARMED
 * the desk entry state already shows (amber, then teal).
 *
 * DATA SOURCE. The RH automation itself (src/lib/execution/rh-autofire*.ts,
 * untracked work in the main checkout) is a pure gate + proposal builder an
 * agent drives through the Robinhood MCP tools; it persists no decision, fill
 * or position and no endpoint exposes one. The only RH position record the
 * app holds is the RH fill log (src/lib/trading/rh-income.ts, localStorage
 * `ledger-rh-income-v1`, written by "Log RH fill" / close on the Options tab).
 * `bridgeRhFills` READS that log: an unclosed fill = open, a fill that just
 * closed = closed with its pnl sign. A future read-only poller of the real
 * automation should call `reportAutomation` the same way. The dev preview
 * (?flash=intrade|close-win|close-loss|close-flat) also reports here.
 */

import { loadRhIncome, subscribeRhIncome, type RhFill } from "@/lib/trading/rh-income";

export type AutomationState =
  | { phase: "idle" }
  /** `quiet`: already open when the page loaded — glow and badge, no flash. */
  | { phase: "open"; label: string; at: number; quiet?: boolean }
  | { phase: "closed"; result: "win" | "loss" | "flat"; label: string; at: number };

let state: AutomationState = { phase: "idle" };
const subs = new Set<() => void>();

export function getAutomation(): AutomationState {
  return state;
}

export function subscribeAutomation(fn: () => void): () => void {
  subs.add(fn);
  return () => subs.delete(fn);
}

/** Record what the automation reported. Presentation only. */
export function reportAutomation(next: AutomationState) {
  state = next;
  for (const fn of subs) fn();
}

const SERVER: AutomationState = { phase: "idle" };
export const getAutomationServer = () => SERVER;


const fillLabel = (f: RhFill) => `${f.underlier} ${f.side} · debit $${Math.round(f.debit)}`;

/**
 * Read-only bridge from the RH fill log. Never writes the log. Returns the
 * unsubscribe. `|pnl| < $1` is a scratch (flat).
 */
export function bridgeRhFills(): () => void {
  let openIds = new Set<string>();
  const read = (first: boolean) => {
    const fills = loadRhIncome().fills;
    const open = fills.filter((f) => !f.closedAt);
    const closedNow = fills.filter((f) => f.closedAt && openIds.has(f.id));
    const nextIds = new Set(open.map((f) => f.id));
    const newlyOpen = open.some((f) => !openIds.has(f.id));
    openIds = nextIds;
    if (open.length) {
      if (first || newlyOpen) reportAutomation({ phase: "open", label: open.map(fillLabel).join(" + "), at: Date.now(), quiet: first });
      return;
    }
    if (closedNow.length) {
      const pnl = closedNow.reduce((a, f) => a + (f.pnl ?? 0), 0);
      reportAutomation({
        phase: "closed",
        result: Math.abs(pnl) < 1 ? "flat" : pnl > 0 ? "win" : "loss",
        label: `${closedNow.map(fillLabel).join(" + ")} · ${pnl >= 0 ? "+" : "−"}$${Math.abs(Math.round(pnl))}`,
        at: Date.now(),
      });
    } else if (state.phase === "open") reportAutomation({ phase: "idle" });
  };
  read(true);
  return subscribeRhIncome(() => read(false));
}
