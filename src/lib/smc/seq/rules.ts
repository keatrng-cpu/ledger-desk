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

const OFF = new Map<number, number>();
/** ET wall clock of an epoch ms: { day: YYYY-MM-DD, hm: minutes after midnight, wd: 0=Sun }. DST-safe (hourly offset cache). */
export function etOf(t: number): { day: string; hm: number; wd: number } {
  const key = Math.floor(t / 3_600_000);
  let off = OFF.get(key);
  if (off == null) {
    const s = new Date(t).toLocaleString("en-US", { timeZone: "America/New_York", hourCycle: "h23" });
    off = Math.round((new Date(s + " UTC").getTime() - Math.floor(t / 1000) * 1000) / 60_000);
    OFF.set(key, off);
  }
  const e = new Date(t + off * 60_000);
  return { day: e.toISOString().slice(0, 10), hm: e.getUTCHours() * 60 + e.getUTCMinutes(), wd: e.getUTCDay() };
}
