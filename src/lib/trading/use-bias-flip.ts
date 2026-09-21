/**
 * Detect, between desk polls, a change the trader must not miss on one
 * symbol: its HTF bias flipping, or its graded side flipping.
 *
 * Compared per poll (`fetchedAt`), never per render, so a click cannot fire
 * it; the first poll after mount has nothing to compare against and never
 * flashes — a fresh tab is not a flip. Only the SAME symbol's read is
 * compared: the caller may chart a different symbol from one poll to the
 * next, and MNQ's bias against ES's would be a false alarm.
 *
 * Shared by the Now tab's setup chart and the Charts tab's panes so both
 * surfaces flash red for the same reason at the same moment.
 */

import { useEffect, useRef, useState } from "react";

/** How long a flip keeps the red flash up (ms). About three polls. */
export const FLIP_FLASH_MS = 75_000;

export interface BiasFlip {
  reason: string;
  until: number;
}

export function useBiasFlip(
  fetchedAt: string,
  symbol: string,
  topDown: string,
  side: string | null,
): BiasFlip | null {
  const prev = useRef<{ symbol: string; topDown: string; side: string | null; at: string } | null>(null);
  const [flip, setFlip] = useState<BiasFlip | null>(null);

  useEffect(() => {
    const cur = { symbol, topDown, side, at: fetchedAt };
    const p = prev.current;
    prev.current = cur;
    if (!p || p.at === cur.at || p.symbol !== cur.symbol) return;
    let reason: string | null = null;
    if (p.topDown !== cur.topDown) {
      reason = `${cur.symbol} HTF bias flipped ${p.topDown} → ${cur.topDown}`;
    } else if (p.side && cur.side && p.side !== cur.side) {
      reason = `${cur.symbol} book side flipped ${p.side} → ${cur.side}`;
    }
    if (reason) setFlip({ reason, until: Date.now() + FLIP_FLASH_MS });
  }, [fetchedAt, symbol, topDown, side]);

  // Clear the flash when its window closes, without waiting for a poll.
  useEffect(() => {
    if (!flip) return;
    const ms = flip.until - Date.now();
    if (ms <= 0) {
      setFlip(null);
      return;
    }
    const id = window.setTimeout(() => setFlip(null), ms);
    return () => window.clearTimeout(id);
  }, [flip]);

  return flip;
}

/**
 * The frame class for a chart surface: red for a warning (shock, news
 * blackout, bias/side flip), green for TAKE, the subtle high-confluence
 * pulse for a hot WAIT, nothing otherwise. Red wins over green: a TAKE
 * printed on the bar the bias flipped is a TAKE to re-read, not to send.
 */
export function chartFrameClass(input: {
  warn: boolean;
  take: boolean;
  hotWait?: boolean;
}): string {
  if (input.warn) return "flash-warn";
  if (input.take) return "flash-take";
  if (input.hotWait) return "flash-high-confluence";
  return "";
}
