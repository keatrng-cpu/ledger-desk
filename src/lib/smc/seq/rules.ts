/**
 * deskSeq — Keaton's trade sequence (audits/desk-sequence-brief-2026-10-14.md, fixes 1–10).
 * One rules block, `deskSeq` in shared/desk-rules.json (byte-identical in the watcher copy, one RULES_HASH).
 * Every item ships mode "shadow": computed, published on wire.deskSeq and logged by the watcher as
 * shadow:seq:<rule> rows. It never moves q, band, actionable, the brain word, the Floor verdict or a fire.
 * Band edges, the $650 cap and the daily/weekly locks are not read or written here.
 */
import RULES from "../../../../shared/desk-rules.json";

export type Side = "long" | "short";
export type Mode = "live" | "shadow";
type Item = { mode?: string; [k: string]: unknown };
const DS = (((RULES as unknown) as { deskSeq?: Record<string, Item> }).deskSeq ?? {}) as Record<string, Item>;
export const seqMode = (k: string): Mode => (DS[k]?.mode === "live" ? "live" : "shadow");
export const seqNum = (k: string, f: string, d: number): number => {
  const v = DS[k]?.[f];
  return typeof v === "number" && Number.isFinite(v) ? v : d;
};
export const seqItem = <T = unknown>(k: string, f: string): T | undefined => DS[k]?.[f] as T | undefined;
export const r2 = (n: number) => Math.round(n * 100) / 100;
