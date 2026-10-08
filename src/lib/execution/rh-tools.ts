/**
 * The Robinhood calls the desk sender is allowed to make.
 * review, then place. Nothing else routes an order.
 */
import { createHash } from "node:crypto";
import type { RhOrder } from "./rh-cycle";
import { RH_MIN_PLACE_GAP_MS } from "./rh-autofire-gates";

export interface RhPos {
  optionId: string;
  quantity: number;
  averagePrice: number | null;
  chainSymbol: string;
  optionType: "call" | "put" | null;
}

export interface RhQuote {
  bid: number | null;
  ask: number | null;
  asOfMs: number;
}

export interface RhReview {
  ok: boolean;
  blocking: boolean;
  alerts: string[];
}

/** One session. Null from the factory means this process cannot reach Robinhood. */
export interface RhTooling {
  readAccount(): Promise<{ portfolio: unknown; account: unknown } | null>;
  positions(): Promise<RhPos[]>;
  quote(optionId: string): Promise<RhQuote | null>;
  findOption(q: { underlier: "QQQ" | "SPY"; expiry: string; type: "call" | "put"; strike: number }): Promise<string | null>;
  review(order: RhOrder): Promise<RhReview>;
  place(order: RhOrder, refId: string): Promise<{ id: string }>;
  /** Account P&L today as a fraction, when the read included it. */
  dayPnlPct(): Promise<number | null>;
}

/** Stable UUID for one logical order. Retries resend this id. */
export function refIdFor(key: string): string {
  const h = createHash("sha256").update(key).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export interface DeskOpen {
  optionId: string;
  decisionKey: string;
  underlier: "QQQ" | "SPY";
  optionType: "call" | "put";
  quantity: number;
  avgDebit: number;
  entry: number | null;
  stop: number | null;
  side: "long" | "short";
  refId: string;
  openedAt: number;
}

export interface RhLedger {
  list(): Promise<DeskOpen[]>;
  put(row: DeskOpen): Promise<void>;
  drop(optionId: string): Promise<void>;
  /** A placement that is no longer a row (a close) still counts for the 60s throttle. */
  notePlace(at: number): Promise<void>;
  lastPlaceAt(): Promise<number | null>;
  /**
   * Take the one placement slot. False when another placement holds it.
   * The SQL book does this in one update, so two instances cannot both win.
   */
  claim(at: number): Promise<boolean>;
}

export function memoryLedger(seed: DeskOpen[] = [], placedAt: number | null = null): RhLedger {
  const rows = [...seed];
  let last = placedAt;
  const fromRows = () => rows.reduce<number | null>((m, r) => (m == null || r.openedAt > m ? r.openedAt : m), null);
  return {
    async list() {
      return rows.slice();
    },
    async put(row) {
      const i = rows.findIndex((r) => r.optionId === row.optionId);
      if (i >= 0) rows[i] = row;
      else rows.push(row);
      if (last == null || row.openedAt > last) last = row.openedAt;
    },
    async drop(optionId) {
      const i = rows.findIndex((r) => r.optionId === optionId);
      if (i >= 0) rows.splice(i, 1);
    },
    async notePlace(at) {
      if (Number.isFinite(at) && (last == null || at > last)) last = at;
    },
    async lastPlaceAt() {
      const from = fromRows();
      if (last == null) return from;
      if (from == null) return last;
      return Math.max(last, from);
    },
    async claim(at) {
      if (!Number.isFinite(at)) return false;
      if (last != null && (at < last || at - last < RH_MIN_PLACE_GAP_MS)) return false;
      last = at;
      return true;
    },
  };
}
