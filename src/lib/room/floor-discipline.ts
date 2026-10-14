/**
 * Floor discipline (floor-62, Keaton 2026-10-13): the rules every Floor line and screen obey.
 *   - every spoken line cites a live number (a digit), or it is dropped;
 *   - an exact repeat inside the session is dropped;
 *   - a plan whose stop/targets sit on the wrong side of entry is flagged and never narrated;
 *   - a skeptic challenges any card graded A- or better, measured against the LIVE band edges;
 *   - a change to the desk scoring rules (shared/desk-rules.json) is itself an event the Floor speaks.
 * Read-only over desk-rules.json: nothing here changes scoring, gates or orders. Narration only.
 */
import RULES from "../../../shared/desk-rules.json";

/** A line "cites a live number" when it carries at least one digit. */
export const hasLiveNumber = (text: string): boolean => /\d/.test(text);

const normLine = (t: string) => t.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

/** Keep only lines with a number that were not said (exactly) before. Order is preserved. */
export function disciplineLines<L extends { text: string }>(lines: readonly L[], said: readonly string[]): L[] {
  const seen = new Set(said);
  const out: L[] = [];
  for (const l of lines) {
    if (!hasLiveNumber(l.text)) continue;
    const n = normLine(l.text);
    if (seen.has(n)) continue;
    seen.add(n);
    out.push(l);
  }
  return out;
}

export type GeoResult = { ok: true } | { ok: false; why: string };

/** Long: stop < entry < t1 (< t2). Short: the mirror. Missing numbers are not a violation. */
export function planGeometry(side: string, entry: number | null | undefined, stop: number | null | undefined, t1?: number | null, t2?: number | null): GeoResult {
  if (entry == null || !Number.isFinite(entry)) return { ok: true };
  const long = /^l/i.test(side);
  const below = (a: number, b: number) => (long ? a < b : a > b);
  if (stop != null && !below(stop, entry)) return { ok: false, why: `${long ? "long" : "short"} stop ${stop} is on the ${long ? "upper" : "lower"} side of entry ${entry}` };
  if (t1 != null && !below(entry, t1)) return { ok: false, why: `${long ? "long" : "short"} T1 ${t1} is on the wrong side of entry ${entry}` };
  if (t1 != null && t2 != null && !below(t1, t2)) return { ok: false, why: `T2 ${t2} is not beyond T1 ${t1}` };
  return { ok: true };
}

/** FNV-1a over desk-rules.json: a browser-safe change signature the Floor compares (NOT the card's canonical sha256 RULES_HASH
 * in src/lib/desk/rules-hash.ts, which needs node:crypto). It only detects that the rules changed. */
export function rulesHashOf(obj: unknown): string {
  const s = JSON.stringify(obj);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}
export const RULES_HASH = rulesHashOf(RULES);

export type BandEdges = Record<string, number>;
export const bandEdges = (): BandEdges => ((RULES as unknown as { bandEdges: BandEdges }).bandEdges);

/** What changed between two band-edge tables (for the "rules changed" line). */
export function bandDiff(a: BandEdges, b: BandEdges): { band: string; from: number | null; to: number | null }[] {
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])];
  return keys.filter((k) => a[k] !== b[k]).map((k) => ({ band: k, from: a[k] ?? null, to: b[k] ?? null }));
}

const TOP = new Set(["A+", "A", "A-"]);
export const isTopGrade = (band: string | null | undefined): boolean => !!band && TOP.has(band);

export interface SkepticInput {
  band: string | null;
  fit?: number | null;
  pT1?: number | null;
  expR?: number | null;
  awayPts?: number | null;
}
/** The weakest live factor of an A- or better card, with the margin to the live A- edge. Null when the card is not top grade. */
export function skepticChallenge(k: SkepticInput, edges: BandEdges = bandEdges()): { factor: string; value: number; edge: number | null; margin: number | null } | null {
  if (!isTopGrade(k.band)) return null;
  const edge = edges["A-"] ?? null;
  const margin = k.fit != null && edge != null ? +(k.fit - edge).toFixed(3) : null;
  if (k.pT1 != null && k.pT1 < 0.55) return { factor: "pT1", value: k.pT1, edge, margin };
  if (k.expR != null && k.expR < 0.3) return { factor: "expR", value: k.expR, edge, margin };
  if (margin != null && margin < 0.05) return { factor: "fit", value: k.fit!, edge, margin };
  if (k.pT1 != null) return { factor: "pT1", value: k.pT1, edge, margin };
  if (k.fit != null) return { factor: "fit", value: k.fit, edge, margin };
  return { factor: "band", value: edge ?? 0, edge, margin };
}

/** kzDisp seat note read live from desk-rules.json (no literal backtest numbers). */
export function kzNoteParts(): { items: number; live: number; shadow: number } {
  const items = Object.values((RULES as unknown as { kzDisp: { items: Record<string, { mode: string }> } }).kzDisp.items);
  const live = items.filter((i) => i.mode === "live").length;
  return { items: items.length, live, shadow: items.length - live };
}
