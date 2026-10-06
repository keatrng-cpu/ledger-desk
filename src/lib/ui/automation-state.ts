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
 * DATA SOURCE — none exists yet. As of this branch the RH automation is a
 * pure gate + proposal builder (src/lib/execution/rh-autofire*.ts, untracked
 * in the main checkout) that an agent drives through the Robinhood MCP tools;
 * the app persists no RH decision, fill or position and exposes no endpoint
 * for one. Until a server function / poller publishes it, `reportAutomation`
 * is only called by the dev preview (?flash=intrade|close-win|close-loss|
 * close-flat). Wire a future read-only poller to `reportAutomation`.
 */

export type AutomationState =
  | { phase: "idle" }
  | { phase: "open"; label: string; at: number }
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
