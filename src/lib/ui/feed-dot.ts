/**
 * Source-first feed lag colour — shared by the Session HUD and the Floor
 * decision strip. SYN and Yahoo are never green.
 *
 * TODO(unify): origin/fix/tabs-pass-followup ships src/lib/ui/feed-tone.ts
 * (feedTone) with the same fail-closed rules. When that lands on main, delete
 * this file and point every call site at feedTone. Logic here is kept identical
 * so the swap is a rename.
 */

/** Known execution / structure sources. Anything else is unrecognized → red. */
const KNOWN = new Set(["live_gateway", "yahoo", "databento", "synthetic"]);

/** "606s (~10 min)" — the one place the feed delay is written out. */
export function lagWords(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  return s >= 90 ? `${s}s (~${Math.round(s / 60)} min)` : `${s}s`;
}

/** Short tag matching QuoteChip (LIVE / Y! / DB / SYN / ?). */
export function sourceTag(source: string): string {
  return source === "live_gateway"
    ? "LIVE"
    : source === "yahoo"
      ? "Y!"
      : source === "databento"
        ? "DB"
        : source === "synthetic"
          ? "SYN"
          : "?";
}

export interface FeedDotTone {
  className: string;
  label: string;
  title: string;
  /** Short source tag for the strip (LIVE / Y! / DB / SYN / ?). */
  tag: string;
  /** live | delayed | not-live — same vocabulary as feed-tone.ts. */
  tone: "live" | "delayed" | "not-live";
}

/**
 * Dot colour keys on SOURCE first, then lag.
 * Fail closed: unknown / empty source → red; unknown lag → red.
 * SYN and Y! are never green. Only live_gateway / fresh databento can read green.
 */
export function feedDotTone(sources: string[], worstLagSec: number): FeedDotTone {
  const list = (sources ?? []).filter((s) => s != null && String(s).length > 0);
  const tags = list.map(sourceTag);
  const sourceBit = list
    .map((s, i) => `${tags[i]} (${s})`)
    .filter((v, i, a) => a.indexOf(v) === i)
    .join(" · ");
  const lagKnown = Number.isFinite(worstLagSec);
  const lag = lagKnown ? Math.max(0, worstLagSec) : Number.NaN;
  const lagTxt = lagKnown ? lagWords(lag) : "unknown";
  const tag =
    tags.includes("LIVE") ? "LIVE" : tags.includes("DB") ? "DB" : tags.includes("Y!") ? "Y!" : tags.includes("SYN") ? "SYN" : "?";

  // Unknown / empty source → red. Never fall through to a lag check that could paint green.
  const hasUnknown = list.length === 0 || list.some((s) => !KNOWN.has(s));
  if (hasUnknown) {
    return {
      tone: "not-live",
      className: "bg-[var(--color-down)]",
      label: `Not live · unrecognized source · reported lag ${lagTxt}`,
      title: `NOT LIVE — unrecognized or missing feed source. ${sourceBit || "(none)"}. Reported lag ${lagTxt}. Unknown sources never read live.`,
      tag: "?",
    };
  }

  // Unknown lag → red (fail closed), even on a known live source.
  if (!lagKnown) {
    return {
      tone: "not-live",
      className: "bg-[var(--color-down)]",
      label: `Not live · lag unknown`,
      title: `NOT LIVE — feed lag is unknown. ${sourceBit}. Unknown lag never reads green.`,
      tag,
    };
  }

  if (list.includes("synthetic")) {
    return {
      tone: "not-live",
      className: "bg-[var(--color-down)]",
      label: `Not live · SYN · reported lag ${lagTxt} (synthetic stamps 0s)`,
      title: `NOT LIVE — synthetic feed (source decides, not the lag). ${sourceBit}. Reported lag ${lagTxt} — synthetic quotes stamp lagSec:0 even when invented. Do not treat as a live print.`,
      tag: "SYN",
    };
  }
  if (list.includes("yahoo")) {
    return {
      tone: "delayed",
      className: "bg-[var(--color-warn)]",
      label: `Not live · Y! · delayed ${lagTxt}`,
      title: `NOT LIVE — Yahoo is a delayed structure feed, never green. ${sourceBit}. Delay vs the exchange print ${lagTxt}.`,
      tag: "Y!",
    };
  }
  if (lag <= 15) {
    return {
      tone: "live",
      className: "bg-[var(--color-up)]",
      label: `Live · feed delay ${lagTxt}`,
      title: `Live feed delay vs the exchange print — ${sourceBit} · worst ${lagTxt}. Green ≤ 15s · amber ≤ 2 min · red beyond. SYN/Y! never green.`,
      tag,
    };
  }
  if (lag <= 120) {
    return {
      tone: "delayed",
      className: "bg-[var(--color-warn)]",
      label: `Delayed · ${lagTxt}`,
      title: `Feed delay vs the exchange print — ${sourceBit} · worst ${lagTxt}. Amber ≤ 2 min · red beyond. SYN/Y! never green.`,
      tag,
    };
  }
  return {
    tone: "not-live",
    className: "bg-[var(--color-down)]",
    label: `Stale · ${lagTxt}`,
    title: `Feed delay vs the exchange print — ${sourceBit} · worst ${lagTxt}. Red beyond 2 min. SYN/Y! never green.`,
    tag,
  };
}
