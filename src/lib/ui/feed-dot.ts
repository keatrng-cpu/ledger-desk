/**
 * Source-first feed lag colour — shared by the Session HUD and the Floor
 * decision strip. SYN and Yahoo are never green.
 */

/** "606s (~10 min)" — the one place the feed delay is written out. */
export function lagWords(sec: number): string {
  const s = Math.round(sec);
  return s >= 90 ? `${s}s (~${Math.round(s / 60)} min)` : `${s}s`;
}

/** Short tag matching QuoteChip (LIVE / Y! / DB / SYN). */
export function sourceTag(source: string): string {
  return source === "live_gateway"
    ? "LIVE"
    : source === "yahoo"
      ? "Y!"
      : source === "databento"
        ? "DB"
        : "SYN";
}

export interface FeedDotTone {
  className: string;
  label: string;
  title: string;
  /** Short source tag for the strip (LIVE / Y! / DB / SYN). */
  tag: string;
}

/**
 * Dot colour keys on SOURCE first, then lag.
 * SYN and Y! are never green — synthetic stamps lagSec:0 (yahoo.ts) and Yahoo
 * is delayed structure, not a live execution feed. Only live_gateway / fresh
 * databento can read green.
 */
export function feedDotTone(sources: string[], worstLagSec: number): FeedDotTone {
  const tags = sources.map(sourceTag);
  const hasSyn = sources.includes("synthetic");
  const hasYahoo = sources.includes("yahoo");
  const sourceBit = sources
    .map((s, i) => `${tags[i]} (${s})`)
    .filter((v, i, a) => a.indexOf(v) === i)
    .join(" · ");
  const tag = tags.includes("LIVE")
    ? "LIVE"
    : tags.includes("DB")
      ? "DB"
      : tags.includes("Y!")
        ? "Y!"
        : "SYN";
  if (hasSyn) {
    return {
      className: "bg-[var(--color-down)]",
      label: `Not live · SYN · reported lag ${lagWords(worstLagSec)} (synthetic stamps 0s)`,
      title: `NOT LIVE — synthetic feed (source decides, not the lag). ${sourceBit}. Reported lag ${lagWords(worstLagSec)} — synthetic quotes stamp lagSec:0 even when invented. Do not treat as a live print.`,
      tag: "SYN",
    };
  }
  if (hasYahoo) {
    return {
      className: "bg-[var(--color-warn)]",
      label: `Not live · Y! · delayed ${lagWords(worstLagSec)}`,
      title: `NOT LIVE — Yahoo is a delayed structure feed, never green. ${sourceBit}. Delay vs the exchange print ${lagWords(worstLagSec)}.`,
      tag: "Y!",
    };
  }
  if (worstLagSec <= 15) {
    return {
      className: "bg-[var(--color-up)]",
      label: `Live · feed delay ${lagWords(worstLagSec)}`,
      title: `Live feed delay vs the exchange print — ${sourceBit} · worst ${lagWords(worstLagSec)}. Green ≤ 15s · amber ≤ 2 min · red beyond. SYN/Y! never green.`,
      tag,
    };
  }
  if (worstLagSec <= 120) {
    return {
      className: "bg-[var(--color-warn)]",
      label: `Delayed · ${lagWords(worstLagSec)}`,
      title: `Feed delay vs the exchange print — ${sourceBit} · worst ${lagWords(worstLagSec)}. Amber ≤ 2 min · red beyond. SYN/Y! never green.`,
      tag,
    };
  }
  return {
    className: "bg-[var(--color-down)]",
    label: `Stale · ${lagWords(worstLagSec)}`,
    title: `Feed delay vs the exchange print — ${sourceBit} · worst ${lagWords(worstLagSec)}. Red beyond 2 min. SYN/Y! never green.`,
    tag,
  };
}
