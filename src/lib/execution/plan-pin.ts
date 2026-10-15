/**
 * Plan hysteresis + failed-FVG drop (fire-unblock 2026-10-15, Accuracy finding #30).
 * Since 10:26 ET the watcher saw 3 different MNQ short plans on 22 of 23 reads, two built on FVGs the desk marks
 * failed, and each flip reset persist. Rules (shared rules fastChain.planHysteresis; Python twin watcher fastchain.plan_pick):
 *  - a plan whose FVG failed is dropped (pinned or candidate);
 *  - a different symbol/side replaces the pin (that is a new book, and persist resets there anyway);
 *  - inside one build minute the pin never swaps (desk and watcher read the same per-minute plan);
 *  - otherwise the pin is kept unless the candidate is clearly better: q +minQGain or R:R +minRrGain.
 */
import RULES from "../../../shared/desk-rules.json";

const H = (RULES.fastChain as { planHysteresis?: { minQGain?: number; minRrGain?: number; dropFailedFvg?: boolean } }).planHysteresis ?? {};
export const PLAN_MIN_Q_GAIN = H.minQGain ?? 0.05;
export const PLAN_MIN_RR_GAIN = H.minRrGain ?? 0.25;

export interface PinPlan {
  symbol: string; side: string; entry: number | null; stop: number | null; t1: number | null;
  q: number | null; rr: number | null; fvgFailed?: boolean; minute: number | null;
}
export const planId = (p: Pick<PinPlan, "symbol" | "side" | "entry" | "stop" | "t1">) => `${p.symbol}:${p.side}:${p.entry}:${p.stop}:${p.t1}`;
export const buildMinute = (nowMs: number) => Math.floor(nowMs / 60_000);
const same = (a: PinPlan, b: PinPlan) => a.entry === b.entry && a.stop === b.stop && a.t1 === b.t1;

export function choosePlan(pinned: PinPlan | null, cand: PinPlan | null): { plan: PinPlan | null; why: string } {
  if (H.dropFailedFvg !== false) {
    if (cand?.fvgFailed) cand = null;
    if (pinned?.fvgFailed) pinned = null;
  }
  if (!pinned) return { plan: cand, why: cand ? "new" : "none" };
  if (!cand) return { plan: pinned, why: "keep (candidate failed/absent)" };
  if (pinned.symbol !== cand.symbol || pinned.side !== cand.side) return { plan: cand, why: "book/side change" };
  if (same(pinned, cand)) return { plan: cand, why: "same plan" };
  if (pinned.minute != null && pinned.minute === cand.minute) return { plan: pinned, why: "keep (same build minute)" };
  const dq = (cand.q ?? 0) - (pinned.q ?? 0);
  const drr = (cand.rr ?? 0) - (pinned.rr ?? 0);
  if (dq >= PLAN_MIN_Q_GAIN - 1e-9 || drr >= PLAN_MIN_RR_GAIN - 1e-9) return { plan: cand, why: `clearly better (dq ${dq.toFixed(3)}, dR:R ${drr.toFixed(2)})` };
  return { plan: pinned, why: `keep (dq ${dq.toFixed(3)}, dR:R ${drr.toFixed(2)} not clearly better)` };
}

/** A plan's FVG failed when a same-direction FVG/iFVG on its symbol that contains the entry is mitigated or a failed inversion. */
export function planFvgFailed(
  p: { symbol: string; side: string; entry: number | null },
  arrays: { symbol?: string; kind: string; dir: string; lo: number; hi: number; mitigated: boolean; failed?: boolean }[],
): boolean {
  if (p.entry == null) return false;
  const dir = p.side === "short" ? "bear" : "bull";
  const hits = arrays.filter((a) => a.symbol === p.symbol && (a.kind === "fvg" || a.kind === "ifvg") && a.dir === dir && a.lo <= p.entry! && p.entry! <= a.hi);
  return hits.length > 0 && hits.every((a) => a.mitigated || a.failed === true);
}
