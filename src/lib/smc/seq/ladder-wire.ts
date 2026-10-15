/**
 * Builds the two-sided ladder for both books from the desk payload. Display-only (see ladder.ts). Never throws.
 * Same object on DeskPayload.twoSided (desk card UI), wire.deskSeq.ladder (watcher / MCP / Grok) and the room's
 * booksOf() (brain / Floor display context).
 */
import type { DeskPayload } from "@/lib/trading/build-desk";
import type { OhlcBar } from "@/lib/market/types";
import { closedByFeed, feedClockRead } from "../smc-unity";
import { premarketMapCached } from "./premarket-map";
import { scenarios } from "./scenarios";
import { ladderBook, ladderText, LADDER_METHOD, type LadderWire } from "./ladder";
import type { Side } from "./rules";

type DeskLike = Pick<DeskPayload, "left" | "right" | "quotes" | "levels" | "mtf" | "scan">;
export function buildLadderWire(desk: DeskLike): LadderWire | null {
  try {
    const books: LadderWire["books"] = {};
    const rows: string[] = [];
    for (const side of ["left", "right"] as const) {
      const sym = desk[side].symbol;
      const q = desk.quotes[side] as { price: number | null; marketTimeMs?: number | null };
      const minute = (desk.mtf?.[side]?.minute ?? []) as OhlcBar[];
      const hourly = ((desk.mtf?.[side] as { hourly?: OhlcBar[] } | undefined)?.hourly ?? []) as OhlcBar[];
      const daily = (desk.mtf?.[side]?.daily ?? []) as OhlcBar[];
      if (q.price == null || (!hourly.length && !daily.length)) continue;
      const fc = feedClockRead(minute, q.marketTimeMs ?? null);
      const nowMs = fc.feedNowMs ?? q.marketTimeMs ?? Date.now();
      const closed1m = closedByFeed(minute, 60_000, nowMs);
      const deskLevels = (desk.levels.find((l) => l.symbol === sym)?.items ?? []).map((x) => ({ name: x.name, price: x.price }));
      const map = minute.length ? premarketMapCached({ symbol: sym, minute: closed1m, bars15: (desk[side].bars ?? []) as OhlcBar[], deskLevels, nowMs }) : null;
      const top = desk.scan.candidates.find((c) => c.symbol === sym);
      const plan = top?.plan as { entry?: number | null; stop?: number | null } | null | undefined;
      const card = top ? { side: top.side as Side, entry: plan?.entry ?? (top as { entryPx?: number | null }).entryPx ?? null, stop: plan?.stop ?? null } : null;
      const b = ladderBook({ symbol: sym, price: q.price, nowMs, hourly, daily, minuteClosed: closed1m, map, scen: scenarios(map), card });
      books[sym] = b;
      if (b.ltfFlip?.stage === "PROMOTED") rows.push(`${sym} LTF flip → ${b.ltfFlip.side} promoted (entry ${b.ltfFlip.entry}, stop ${b.ltfFlip.stop}), ${b.ltfFlip.demotes} demoted`);
      for (const n of b.noUpgrade) if (top && top.side === n.side) rows.push(`${sym} ${n.why} (card ${top.side} band ${top.pathBand ?? "?"})`);
      if (b.cardCheck && !b.cardCheck.valid) rows.push(`${sym} card plan ${b.cardCheck.side} invalid: ${b.cardCheck.why}`);
    }
    return { mode: "shadow", displayOnly: true, method: LADDER_METHOD, books, rows };
  } catch {
    return null; // display layer must never break the card
  }
}
export { ladderText };
