/**
 * EV fire path (shared rules `evFire`; Python twin watcher/evfire.py; parity in scripts/ev-fire.test.mjs).
 * OFF by default. Pure functions: the desk attaches `ev` to each card and the watcher re-derives the same numbers.
 *   EV_R = p·min(RR, rrCap) − (1 − p) − max(costFloorR, costR), p = calibrated P(T1) (shared/ev-calibration.json).
 */
import RULES from "../../../shared/desk-rules.json";
import CAL from "../../../shared/ev-calibration.json";

export type EvMode = "off" | "shadow" | "live";
export const EVF = (RULES as unknown as { evFire: EvFireRules }).evFire;
export interface EvFireRules {
  mode: EvMode; threshold: number; qFloor: number; rrCap: number; costFloorR: number; holdS: number;
  fullUsd: number; probeUsd: number; fullMinBand: string;
  calibration: { tableHash: string | null; prior: number; windowDays: number; bucket: number; minSamples: number };
  ltfSoft: { mode: EvMode; cap: string; liftDisp: number };
  qRawOnce: { mode: EvMode };
  dropCrossedStop: { mode: EvMode };
}
interface CalTable { hash: string; trained: boolean; global: number; bucket: number; cells: Record<string, { n: number; hits: number; p: number }> }
const TABLE = CAL as unknown as CalTable;
const BANDS = ["C", "B", "B+", "A-", "A", "A+"];
const rank = (b: string | null | undefined) => BANDS.indexOf(String(b ?? "").replace("−", "-"));
export const on = (m: string | undefined | null) => m === "shadow" || m === "live";

export function calKey(q: number, rungs: number, htfOk: boolean, bucket = TABLE.bucket): string {
  return `${Math.min(Math.floor(q / bucket + 1e-9), Math.floor(0.75 / bucket))}|${rungs >= 5 ? 1 : 0}|${htfOk ? 1 : 0}`;
}
/** Calibrated P(T1); null = refuse (untrained table, or its hash is not the one pinned in the rules). */
export function pOf(q: number, rungs: number, htfOk: boolean, table: CalTable = TABLE, pin: string | null = EVF.calibration.tableHash): number | null {
  if (!table.trained || !pin || table.hash !== pin) return null;
  return table.cells[calKey(q, rungs, htfOk, table.bucket)]?.p ?? table.global;
}
export function evR(p: number, rr: number, costR: number | null = null): number {
  const cost = Math.max(EVF.costFloorR, costR ?? 0);
  return +(p * Math.min(rr, EVF.rrCap) - (1 - p) - cost).toFixed(6);
}
/** $ cap for an EV fire: band >= fullMinBand → fullUsd ($650), else the half probe ($325). Never above the band caps. */
export const sizeUsd = (band: string | null | undefined): number => (rank(band) >= rank(EVF.fullMinBand) ? EVF.fullUsd : EVF.probeUsd);
/** The stop has already traded (long: px <= stop; short: px >= stop). */
export function stopCrossed(side: string, px: number | null | undefined, stop: number | null | undefined): boolean {
  if (px == null || stop == null) return false;
  return side === "long" ? px <= stop : side === "short" ? px >= stop : false;
}
/** ltfSoft: the band cap an LTF kill imposes (null = lifted by displacement on the card's own side). */
export function ltfSoftCap(dispScore: number | null | undefined): string | null {
  return dispScore != null && dispScore >= EVF.ltfSoft.liftDisp ? null : EVF.ltfSoft.cap;
}
export interface EvCardIn { q: number; band: string | null; side: string; entry: number | null; stop: number | null; t1: number | null; rungs: number; htfOk: boolean; costR?: number | null }
export interface EvRead { p: number | null; rr: number | null; evR: number | null; costR: number; sizeUsd: number; would: boolean; why: string; calHash: string }
export function evCard(c: EvCardIn): EvRead {
  const costR = Math.max(EVF.costFloorR, c.costR ?? 0);
  const base = { costR, sizeUsd: sizeUsd(c.band), calHash: TABLE.hash };
  const ok = c.entry != null && c.stop != null && c.t1 != null && (c.side === "long" ? c.stop < c.entry && c.entry < c.t1 : c.side === "short" ? c.t1 < c.entry && c.entry < c.stop : false);
  if (!ok) return { ...base, p: null, rr: null, evR: null, would: false, why: "plan levels invalid" };
  const rr = Math.abs(c.t1! - c.entry!) / Math.abs(c.entry! - c.stop!);
  const p = pOf(c.q, c.rungs, c.htfOk);
  if (p == null) return { ...base, p: null, rr, evR: null, would: false, why: `calibration untrained or hash ${TABLE.hash} != pinned ${EVF.calibration.tableHash}` };
  const ev = evR(p, rr, c.costR ?? null);
  const would = c.q >= EVF.qFloor && ev >= EVF.threshold;
  return { ...base, p, rr: +rr.toFixed(4), evR: ev, would, why: `EV ${ev.toFixed(3)}R = ${p}·min(${rr.toFixed(2)},${EVF.rrCap}) − ${(1 - p).toFixed(3)} − ${costR} (need >= ${EVF.threshold}, q ${c.q} >= ${EVF.qFloor}); size $${base.sizeUsd}` };
}
