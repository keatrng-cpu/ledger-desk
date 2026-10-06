/**
 * Floor rule signals for the RH live path — CE touch, tape age, DTE — read
 * from the live desk + Floor options card (Keaton / Accuracy 2026-10-06).
 *
 * Before this, candidateFromFloorPathStand left ceTouch / tapeAgeSec / dte
 * null and evaluateRhFloorRules refused every ticket. These are reads of data
 * the desk already has; nothing is scored or invented. Every signal fails
 * closed: an unreadable input → null → the gate refuses.
 *
 *  - ceTouch   : the candidate's own smc-master book (same symbol AND side)
 *                has a plan, and the live quote is IN its entry array
 *                (readEntry(...).inZone, not `behind`) — the same read the
 *                CE-touch alarm (path-alarm.ts considerEntryAlarm) fires on.
 *  - tapeAgeSec: nowMs − desk.fetchedAt (the desk feed the Floor decided on).
 *  - dte       : Floor options card ticket.dteTarget (0/1 allowed by mandate).
 */
import { readEntry } from "../trading/entry-trigger";
import type { TradePlan } from "../trading/trade-plan";

export interface RhFloorSignals {
  ceTouch: boolean | null;
  tapeAgeSec: number | null;
  dte: number | null;
  why: string[];
}

/** Duck-typed slice of DeskPayload — only what the signals read. */
export interface RhDeskSlice {
  fetchedAt?: string | number | null;
  left?: { symbol?: string } | null;
  right?: { symbol?: string } | null;
  quotes?: { left?: { price?: number | null } | null; right?: { price?: number | null } | null } | null;
  smcMaster?: {
    left?: { symbol?: string; side?: string; plan?: TradePlan | null } | null;
    right?: { symbol?: string; side?: string; plan?: TradePlan | null } | null;
  } | null;
}

const root = (s: string | undefined | null) => String(s ?? "").replace(/^M/, "");

export function rhTapeAgeSec(fetchedAt: string | number | null | undefined, nowMs: number): number | null {
  if (fetchedAt == null || fetchedAt === "") return null;
  const t = typeof fetchedAt === "number" ? fetchedAt : Date.parse(fetchedAt);
  if (!Number.isFinite(t)) return null;
  const age = (nowMs - t) / 1000;
  // A feed stamped in the future is not a fresh feed — fail closed.
  if (age < -5) return null;
  return Math.max(0, age);
}

export function rhCeTouchFromDesk(
  desk: RhDeskSlice | null | undefined,
  symbol: string | null | undefined,
  side: "long" | "short" | string | null | undefined,
): { ceTouch: boolean | null; why: string } {
  if (!desk || !symbol || !side) return { ceTouch: null, why: "no desk / symbol / side" };
  const books = [
    { book: desk.smcMaster?.left, sym: desk.left?.symbol, price: desk.quotes?.left?.price },
    { book: desk.smcMaster?.right, sym: desk.right?.symbol, price: desk.quotes?.right?.price },
  ];
  const hit = books.find((b) => b.book && root(b.book.symbol) === root(symbol));
  if (!hit?.book) return { ceTouch: null, why: `no smc book for ${symbol}` };
  if (hit.book.side !== side) return { ceTouch: false, why: `book side ${hit.book.side ?? "-"} ≠ ${side}` };
  const plan = hit.book.plan ?? null;
  if (!plan || plan.side !== side) return { ceTouch: null, why: "no priced plan on this side" };
  // Quote must belong to the same book (left/right desk symbol).
  if (root(hit.sym) !== root(hit.book.symbol)) return { ceTouch: null, why: "quote/book symbol mismatch" };
  const price = hit.price;
  if (typeof price !== "number" || !Number.isFinite(price) || price <= 0) {
    return { ceTouch: null, why: "no live quote" };
  }
  const read = readEntry(plan, price, null);
  if (!read) return { ceTouch: null, why: "entry unreadable" };
  if (read.behind) return { ceTouch: false, why: "price is past CE on the stop side" };
  return read.inZone
    ? { ceTouch: true, why: `CE touch · ${price.toFixed(2)} in array` }
    : { ceTouch: false, why: `${(read.awayPts ?? 0).toFixed(2)}pt from array` };
}

export function rhFloorSignals(args: {
  desk?: RhDeskSlice | null;
  symbol?: string | null;
  side?: "long" | "short" | string | null;
  /** Floor options card ticket.dteTarget. */
  dte?: number | null;
  nowMs: number;
}): RhFloorSignals {
  const ce = rhCeTouchFromDesk(args.desk ?? null, args.symbol ?? null, args.side ?? null);
  const tapeAgeSec = rhTapeAgeSec(args.desk?.fetchedAt ?? null, args.nowMs);
  const dte = typeof args.dte === "number" && Number.isFinite(args.dte) ? Math.round(args.dte) : null;
  return {
    ceTouch: ce.ceTouch,
    tapeAgeSec,
    dte,
    why: [ce.why, tapeAgeSec == null ? "tape age unknown" : `tape ${Math.round(tapeAgeSec)}s`, dte == null ? "dte unknown" : `DTE ${dte}`],
  };
}
