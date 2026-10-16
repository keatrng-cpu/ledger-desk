/**
 * Pulse regime — VIX term structure plus two FRED context series. Pure; no network.
 *
 *   IVTS = VIX / VIX3M. Under 1: contango (the curve prices more risk later than now — the normal state).
 *   At or over 1: backwardation (near-dated fear priced over the three-month).
 *   GDPNow (FRED GDPNOW) and the 2s10s spread (FRED T10Y2Y) are context for the Floor's rates lines.
 *
 * TALK AND JOURNAL ONLY. No gate, score, size, band or order reads anything here, and IVTS is not treated as an
 * edge: the four-year tape has not been cut by it (docs/research note #5). mandate.ts VIX_ELEVATED / VIX_STRESSED
 * keep reading spot VIX exactly as before.
 */

export interface QuoteLike {
  label: string;
  last: number | null;
}

export interface FredPoint {
  series: string;
  date: string;
  value: number;
}

export type VolStructure = "contango" | "backwardation";

export interface PulseRegime {
  vix: number | null;
  vix9d: number | null;
  vix3m: number | null;
  vvix: number | null;
  /** VIX / VIX3M, 4 dp; null when either leg is missing. */
  ivts: number | null;
  structure: VolStructure | null;
  gdpNow: FredPoint | null;
  t10y2y: FredPoint | null;
}

export const PULSE_LABELS = { vix: "VIX", vix9d: "VIX9D", vix3m: "VIX3M", vvix: "VVIX" } as const;

export function volStructure(ivts: number | null | undefined): VolStructure | null {
  if (ivts == null || !Number.isFinite(ivts) || ivts <= 0) return null;
  return ivts >= 1 ? "backwardation" : "contango";
}

export function pulseRegime(quotes: QuoteLike[], fred: { gdpNow: FredPoint | null; t10y2y: FredPoint | null }): PulseRegime {
  const q = (label: string) => {
    const v = quotes.find((x) => x.label === label)?.last;
    return v != null && Number.isFinite(v) && v > 0 ? v : null;
  };
  const vix = q(PULSE_LABELS.vix);
  const vix3m = q(PULSE_LABELS.vix3m);
  const ivts = vix != null && vix3m != null ? Math.round((vix / vix3m) * 10_000) / 10_000 : null;
  return {
    vix,
    vix9d: q(PULSE_LABELS.vix9d),
    vix3m,
    vvix: q(PULSE_LABELS.vvix),
    ivts,
    structure: volStructure(ivts),
    gdpNow: fred.gdpNow,
    t10y2y: fred.t10y2y,
  };
}

/** FRED fredgraph CSV ("DATE,SERIES" header, "." for missing) → newest numeric point. */
export function parseFredCsv(series: string, csv: string): FredPoint | null {
  const lines = csv.trim().split(/\r?\n/).slice(1);
  for (let i = lines.length - 1; i >= 0; i--) {
    const [date, raw] = lines[i]!.split(",");
    const v = Number(raw);
    if (date && /^\d{4}-\d{2}-\d{2}$/.test(date) && raw !== "." && Number.isFinite(v)) return { series, date, value: v };
  }
  return null;
}

/** FRED API JSON (series/observations, sort_order=desc) → newest numeric point. */
export function parseFredJson(series: string, json: unknown): FredPoint | null {
  const obs = (json as { observations?: { date: string; value: string }[] })?.observations ?? [];
  for (const o of obs) {
    const v = Number(o.value);
    if (o.value !== "." && Number.isFinite(v)) return { series, date: o.date, value: v };
  }
  return null;
}
