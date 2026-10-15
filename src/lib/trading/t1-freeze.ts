/**
 * Desk-side T1 FREEZE (10/15 post-mortem item 2). Once a setup is ARMED or FIRED its T1 is the number the trade is managed to;
 * later polls re-run target selection (new pools, swept pools, sanePlan promotion) and must not move it under an open
 * plan. Key = fast-chain setupId (symbol:side:entry), so the freeze follows the same setup the watcher confirms/spends.
 *  - first poll a setup is armed/fired with a real T1 -> that T1 (and its R:R vs the stop at that time) is frozen;
 *  - every later poll the card's plan.t1 / rr1 is forced back to the frozen value; a differing fresh T1 is only noted;
 *  - a frozen setup that goes un-armed keeps its freeze if it FIRED (position is managed to it) and drops it otherwise;
 *  - freezes are per ET session day (pruned on day change).
 * Pure apart from the module store; nothing here touches rulesHash (no desk-rules.json key).
 */
import { sessionDay } from "@/lib/execution/fast-chain";

export type FreezeState = "armed" | "fired";
export interface FrozenT1 { sid: string; t1: number; rr1: number | null; name: string | null; state: FreezeState; frozenMs: number; day: string }
export type FreezeStore = Map<string, FrozenT1>;
export const DESK_T1_FREEZE: FreezeStore = new Map();

export const freezeSid = (symbol: string, side: string, entry: number | null | undefined) => `${symbol}:${side}:${entry ?? null}`;

export interface FreezeInput { symbol: string; side: "long" | "short"; entry: number | null; stop: number | null; t1: number | null; t1Name?: string | null; state: FreezeState | null }
export interface FreezeOut { t1: number | null; rr1: number | null; frozen: FrozenT1 | null; note: string | null }

export function t1Freeze(store: FreezeStore, i: FreezeInput, nowMs: number): FreezeOut {
  const day = sessionDay(nowMs);
  for (const [k, v] of store) if (v.day !== day) store.delete(k);
  const sid = freezeSid(i.symbol, i.side, i.entry);
  const rr = (t: number | null) => (t != null && i.entry != null && i.stop != null && i.entry !== i.stop ? +(Math.abs(t - i.entry) / Math.abs(i.entry - i.stop)).toFixed(2) : null);
  let f = store.get(sid) ?? null;
  if (!f) {
    if (i.state == null || i.t1 == null || !Number.isFinite(i.t1)) return { t1: i.t1, rr1: rr(i.t1), frozen: null, note: null };
    f = { sid, t1: i.t1, rr1: rr(i.t1), name: i.t1Name ?? null, state: i.state, frozenMs: nowMs, day };
    store.set(sid, f);
    return { t1: f.t1, rr1: f.rr1, frozen: f, note: `T1 frozen at ${f.t1}${f.name ? ` (${f.name})` : ""} on ${i.state}` };
  }
  if (i.state === "fired" && f.state !== "fired") f.state = "fired";
  if (i.state == null && f.state !== "fired") { store.delete(sid); return { t1: i.t1, rr1: rr(i.t1), frozen: null, note: `T1 freeze released (${sid} no longer armed)` }; }
  const moved = i.t1 != null && Math.abs(i.t1 - f.t1) > 1e-9;
  return { t1: f.t1, rr1: rr(f.t1), frozen: f, note: moved ? `T1 held at frozen ${f.t1} (${f.state}); fresh selection said ${i.t1} - ignored` : null };
}
/** Mark a setup FIRED (desk saw the fire); keeps its freeze through un-arming for the rest of the session. */
export function markT1Fired(store: FreezeStore, sid: string): void { const f = store.get(sid); if (f) f.state = "fired"; }
