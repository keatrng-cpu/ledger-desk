/**
 * Plan pin + hysteresis + failed-FVG drop (fire-unblock 2026-10-15, Accuracy #30; review F3).
 *
 * The DESK BUILD is the single source of the pin. The card carries the pinned plan whole (entry, stop, T1, T2, q,
 * R:R, FVG id) plus planId + planMinute; the watcher reads those and keeps no pin of its own, so the two cannot drift.
 * Rules (shared rules fastChain.planHysteresis; Python twin watcher fastchain.plan_pick for parity):
 *  - the pin is atomic: when kept, every level/score on the card comes from the pin, never a mix with the candidate;
 *  - FVG status is re-read LIVE every build from the current arrays by FVG id: a pin whose FVG fails is dropped;
 *  - a candidate whose FVG failed is never pinned;
 *  - inside one build minute the pin never swaps; after that only for a clearly better plan (q +minQGain or R:R +minRrGain);
 *  - pins are cleared on side change (that symbol), invalidation (price through the stop / T1 traded) and session end.
 */
import RULES from "../../../shared/desk-rules.json";

const H = (RULES.fastChain as { planHysteresis?: { minQGain?: number; minRrGain?: number; dropFailedFvg?: boolean } }).planHysteresis ?? {};
export const PLAN_MIN_Q_GAIN = H.minQGain ?? 0.05;
export const PLAN_MIN_RR_GAIN = H.minRrGain ?? 0.25;

export interface FvgRef { tf: string; dir: string; lo: number; hi: number; createdT?: number | null }
export interface PinPlan {
  symbol: string; side: string; entry: number | null; stop: number | null; t1: number | null; t2?: number | null;
  q: number | null; rr: number | null; fvg?: FvgRef | null; fvgFailed?: boolean; minute: number | null; day?: string | null;
}
export interface ArrayLike { symbol?: string; tf?: string; kind: string; dir: string; lo: number; hi: number; mitigated: boolean; failed?: boolean; createdT?: number }

export const planId = (p: Pick<PinPlan, "symbol" | "side" | "entry" | "stop" | "t1">) => `${p.symbol}:${p.side}:${p.entry}:${p.stop}:${p.t1}`;
export const buildMinute = (nowMs: number) => Math.floor(nowMs / 60_000);
export const fvgId = (f: FvgRef | null | undefined) => (f ? `${f.tf}:${f.dir}:${f.lo}:${f.hi}:${f.createdT ?? ""}` : null);
const same = (a: PinPlan, b: PinPlan) => a.entry === b.entry && a.stop === b.stop && a.t1 === b.t1 && (a.t2 ?? null) === (b.t2 ?? null);

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

/** The plan's entry FVG: the youngest same-direction FVG/iFVG on its symbol containing the entry. */
export function planFvg(p: { symbol: string; side: string; entry: number | null }, arrays: ArrayLike[]): FvgRef | null {
  if (p.entry == null) return null;
  const dir = p.side === "short" ? "bear" : "bull";
  const hits = arrays.filter((a) => a.symbol === p.symbol && (a.kind === "fvg" || a.kind === "ifvg") && a.dir === dir && a.lo <= p.entry! && p.entry! <= a.hi);
  hits.sort((a, b) => (b.createdT ?? 0) - (a.createdT ?? 0));
  const h = hits[0];
  return h ? { tf: String(h.tf ?? ""), dir: h.dir, lo: h.lo, hi: h.hi, createdT: h.createdT ?? null } : null;
}

/** Live FVG status by id: failed when the referenced array is now mitigated / a failed inversion. Missing from the list = unknown (not failed). */
export function fvgFailedNow(f: FvgRef | null | undefined, symbol: string, arrays: ArrayLike[]): boolean {
  if (!f) return false;
  const a = arrays.find((x) => x.symbol === symbol && String(x.tf ?? "") === f.tf && x.dir === f.dir && x.lo === f.lo && x.hi === f.hi && (f.createdT == null || x.createdT == null || x.createdT === f.createdT));
  return a ? a.mitigated || a.failed === true : false;
}

/** Back-compat helper: does the entry sit only on failed arrays? */
export function planFvgFailed(p: { symbol: string; side: string; entry: number | null }, arrays: ArrayLike[]): boolean {
  return fvgFailedNow(planFvg(p, arrays), p.symbol, arrays);
}

/** Invalidated against the live price: through the stop, or T1 (the first scale-out) traded. */
export function planInvalidated(p: PinPlan, px: number | null): boolean {
  if (px == null || p.stop == null) return false;
  if (p.side === "short") return px >= p.stop || (p.t1 != null && px <= p.t1);
  return px <= p.stop || (p.t1 != null && px >= p.t1);
}

/** One step of the desk pin store (pure; the store is a Map the caller owns). */
export function stepPins(
  pins: Map<string, PinPlan>,
  cand: PinPlan,
  ctx: { arrays: ArrayLike[]; px: number | null; day: string; sessionOpen: boolean },
): { plan: PinPlan | null; why: string; cleared: string[] } {
  const cleared: string[] = [];
  for (const [k, p] of [...pins]) {
    const why = !ctx.sessionOpen || p.day !== ctx.day ? "session end"
      : p.symbol === cand.symbol && p.side !== cand.side ? "side change"
      : p.symbol === cand.symbol && planInvalidated(p, ctx.px) ? "invalidated"
      : null;
    if (why) { pins.delete(k); cleared.push(`${k}: ${why}`); }
  }
  const key = `${cand.symbol}:${cand.side}`;
  const prev = pins.get(key) ?? null;
  const live = prev ? { ...prev, fvgFailed: fvgFailedNow(prev.fvg, prev.symbol, ctx.arrays) } : null;   // re-read every build
  const c = { ...cand, day: ctx.day, fvg: cand.fvg ?? planFvg(cand, ctx.arrays) };
  c.fvgFailed = fvgFailedNow(c.fvg, c.symbol, ctx.arrays);
  const { plan, why } = choosePlan(live, c);
  if (plan && ctx.sessionOpen) pins.set(key, plan); else pins.delete(key);
  return { plan, why, cleared };
}
