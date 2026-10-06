/**
 * ONE feed-honesty tone for every lag/source indicator on the desk.
 *
 * The SOURCE decides first, never the lag. Synthetic quotes stamp lagSec:0
 * (yahoo.ts) and Yahoo is a delayed structure feed — neither may ever read
 * green. An unknown / unrecognized source defaults to red/not-live; it must
 * never fall through to a lag check that could paint green. A missing lag
 * reading (null/undefined) is also red — never coerce unknown lag to 0.
 *
 * Used by the header feed dot, the mobile lag chip, the Charts print dot,
 * and the Floor OPS·THE FEED canvas (floor-screens drawFeed).
 */

export type FeedToneKind = "live" | "delayed" | "not-live";

export type FeedTone = {
  /** live = green · delayed = amber · not-live = red. */
  tone: FeedToneKind;
  /** Dot fill class: bg-[var(--color-up|warn|down)]. */
  className: string;
  /** Compact chip text (mobile lag chip, Charts print). */
  chip: string;
  /** Accessible short label. */
  label: string;
  /** Full tooltip. */
  title: string;
};

const KNOWN = new Set(["live_gateway", "yahoo", "databento", "synthetic"]);

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

export function lagWords(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  return s >= 90 ? `${s}s (~${Math.round(s / 60)} min)` : `${s}s`;
}

function paint(tone: FeedToneKind): string {
  return tone === "live"
    ? "bg-[var(--color-up)]"
    : tone === "delayed"
      ? "bg-[var(--color-warn)]"
      : "bg-[var(--color-down)]";
}

/**
 * Tone from sources + worst lag. Empty / unknown sources → not-live (red).
 * SYN → red. Y! → amber (never green). Otherwise lag bands: ≤15 live,
 * ≤120 delayed, else not-live.
 */
export function feedTone(sources: string[], worstLagSec: number | null | undefined): FeedTone {
  const list = sources.filter((s) => s != null && String(s).length > 0);
  const tags = list.map(sourceTag);
  const sourceBit = list
    .map((s, i) => `${tags[i]} (${s})`)
    .filter((v, i, a) => a.indexOf(v) === i)
    .join(" · ");
  const lagKnown = worstLagSec != null && Number.isFinite(worstLagSec);
  const lag = lagKnown ? Math.max(0, worstLagSec as number) : 0;
  const lagTxt = lagKnown ? lagWords(lag) : "unknown";

  // Unknown / empty → red. Never fall through to a lag check.
  const hasUnknown = list.length === 0 || list.some((s) => !KNOWN.has(s));
  if (hasUnknown) {
    return {
      tone: "not-live",
      className: paint("not-live"),
      chip: `? · not live`,
      label: `Not live · unrecognized source · reported lag ${lagTxt}`,
      title: `NOT LIVE — unrecognized or missing feed source. ${sourceBit || "(none)"}. Reported lag ${lagTxt}. Unknown sources never read live.`,
    };
  }

  const hasSyn = list.includes("synthetic");
  if (hasSyn) {
    return {
      tone: "not-live",
      className: paint("not-live"),
      chip: lagKnown ? `SYN · lag ${Math.round(lag)}s` : `SYN · lag unknown`,
      label: `Not live · SYN · reported lag ${lagTxt} (synthetic stamps 0s)`,
      title: `NOT LIVE — synthetic feed (source decides, not the lag). ${sourceBit}. Reported lag ${lagTxt} — synthetic quotes stamp lagSec:0 even when invented. Do not treat as a live print.`,
    };
  }

  const hasYahoo = list.includes("yahoo");
  if (hasYahoo) {
    return {
      tone: "delayed",
      className: paint("delayed"),
      chip: lagKnown ? `Y! · lag ${Math.round(lag)}s` : `Y! · lag unknown`,
      label: `Not live · Y! · delayed ${lagTxt}`,
      title: `NOT LIVE — Yahoo is a delayed structure feed, never green. ${sourceBit}. Delay vs the exchange print ${lagTxt}.`,
    };
  }

  // Missing lag on an otherwise-live source (Databento / gateway) must never
  // fall through as 0s and paint green — unknown lag is not live.
  if (!lagKnown) {
    return {
      tone: "not-live",
      className: paint("not-live"),
      chip: `lag unknown`,
      label: `Not live · lag unknown`,
      title: `NOT LIVE — feed lag is unknown. ${sourceBit}. A missing lag reading never reads live.`,
    };
  }

  if (lag <= 15) {
    return {
      tone: "live",
      className: paint("live"),
      chip: `lag ${Math.round(lag)}s`,
      label: `Live · feed delay ${lagTxt}`,
      title: `Live feed delay vs the exchange print — ${sourceBit} · worst ${lagTxt}. Green ≤ 15s · amber ≤ 2 min · red beyond. SYN/Y! never green.`,
    };
  }
  if (lag <= 120) {
    return {
      tone: "delayed",
      className: paint("delayed"),
      chip: `lag ${Math.round(lag)}s`,
      label: `Delayed · ${lagTxt}`,
      title: `Feed delay vs the exchange print — ${sourceBit} · worst ${lagTxt}. Amber ≤ 2 min · red beyond. SYN/Y! never green.`,
    };
  }
  return {
    tone: "not-live",
    className: paint("not-live"),
    chip: `lag ${Math.round(lag)}s`,
    label: `Stale · ${lagTxt}`,
    title: `Feed delay vs the exchange print — ${sourceBit} · worst ${lagTxt}. Red beyond 2 min. SYN/Y! never green.`,
  };
}

/** @deprecated Prefer feedTone — kept as the old name for call-site clarity. */
export const feedDotTone = feedTone;
