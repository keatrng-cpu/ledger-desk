/**
 * From the room's decision to an order intent — and the order's id.
 *
 * The room's paper book is the DECISION ledger. What it did this cycle is read off the book itself
 * (before → after), so the order a broker sees is exactly the fill the room booked: same contract,
 * same quantity, never a number the room did not print. Pure.
 */

import { etDateOf } from "../option-math";
import { planKey, type RoomCycle } from "../orchestrator";
import type { RoomBook } from "../paper-book";
import { occSymbol } from "./occ";
import type { ExecPhase, OrderIntent } from "./types";

export const entryKey = (etDate: string, plan: string) => `E|${etDate}|${plan}`;
export const exitKey = (etDate: string, positionId: string, reason: string, qty: number) => `X|${etDate}|${positionId}|${reason}|${qty}`;
export const reconcileKey = (etDate: string, symbol: string, seq: number) => `X|${etDate}|${symbol}|reconcile|${seq}`;

function fnv(s: string, seed: number): string {
  let h = seed >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/**
 * The broker's client order id: deterministic in the decision AND the phase, so two devices running the
 * same room send ONE order (the broker, and the audit table's unique key, refuse the second) — while a
 * decision recorded in shadow can still be sent later in paper without the shadow row swallowing it.
 * ≤ 128 characters.
 */
export function clientOrderId(decisionKey: string, phase: ExecPhase): string {
  const role = decisionKey.startsWith("X") ? "x" : "e";
  const date = (decisionKey.split("|")[1] ?? "").replace(/-/g, "");
  const k = `${phase}|${decisionKey}`;
  return `lr${role}-${date}-${fnv(k, 0x811c9dc5)}${fnv(k, 0x9e3779b1)}`;
}

/** The OCC symbol of one room position. */
export function symbolOfPosition(p: { ticker: string; exp: string; type: "CALL" | "PUT"; strike: number }): string {
  return occSymbol({ underlier: p.ticker, exp: p.exp, type: p.type, strike: p.strike });
}

export interface DesiredPosition {
  symbol: string;
  qty: number;
  positionId: string;
}

/** What the room holds right now — the target the broker is steered toward. */
export function desiredOf(book: RoomBook): DesiredPosition[] {
  const out: DesiredPosition[] = [];
  for (const p of book.positions) {
    if (p.contracts < 1) continue;
    try {
      out.push({ symbol: symbolOfPosition(p), qty: p.contracts, positionId: p.id });
    } catch {
      // A position the OCC format cannot name is never sent anywhere.
    }
  }
  return out;
}

/** The first clause of a closed trade's reason ("level", "time stop", …), as a key part. */
function reasonKey(reason: string): string {
  return (reason.split(" — ")[0] ?? reason).trim().replace(/\s+/g, "_").toLowerCase();
}

/**
 * What the room did between two books: the positions it opened (entries) and the trades it closed
 * (exits — used as the shadow record and as the reason hints for the real exits the reconcile sends).
 */
export function intentsFromCycle(args: { before: RoomBook; after: RoomBook; cycle: RoomCycle; nowMs: number }): { entries: OrderIntent[]; exits: OrderIntent[] } {
  const { before, after, cycle, nowMs } = args;
  const etDate = etDateOf(nowMs);
  const entries: OrderIntent[] = [];
  const known = new Set(before.positions.map((p) => p.id));
  for (const p of after.positions) {
    if (known.has(p.id)) continue;
    const e = cycle.trace.entry;
    entries.push({
      decisionKey: entryKey(etDate, e ? planKey(e.entry) : p.id),
      role: "entry",
      side: "buy",
      underlier: p.ticker,
      type: p.type,
      strike: p.strike,
      exp: p.exp,
      qty: p.contracts,
      modelPx: p.entryPx,
      reason: `${p.card}${p.band ? ` · PATH ${p.band}` : ""}`,
      etDate,
      atMs: nowMs,
      positionId: p.id,
    });
  }
  const seen = new Set(before.closed.map((c) => `${c.id}|${c.closedAt}`));
  const exits: OrderIntent[] = [];
  for (const c of after.closed) {
    if (seen.has(`${c.id}|${c.closedAt}`)) continue;
    exits.push({
      decisionKey: exitKey(etDate, c.id, reasonKey(c.reason), c.contracts),
      role: "exit",
      side: "sell",
      underlier: c.ticker,
      type: c.type,
      strike: c.strike,
      exp: c.exp,
      qty: c.contracts,
      modelPx: c.exitPx,
      reason: c.reason,
      etDate,
      atMs: c.closedAt,
      positionId: c.id,
    });
  }
  return { entries, exits };
}
