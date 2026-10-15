/**
 * Review 2026-10-15 #3: primary-card churn ES <-> MNQ. The primary only flips when the other symbol's score
 * beats the incumbent by MARGIN for N consecutive polls. Pure core + one process-level memo for the live desk.
 */
export const PRIMARY_HYSTERESIS = { margin: 0.03, polls: 3 } as const;

export type PrimaryState = { symbol: string | null; challenger: string | null; streak: number };
export const emptyPrimary = (): PrimaryState => ({ symbol: null, challenger: null, streak: 0 });

/** scores: symbol -> score (confluence/quality, 0..1). Missing symbol = no full-plan card this poll. */
export function stickyPrimary(
  prev: PrimaryState,
  scores: Record<string, number | null | undefined>,
  cfg: { margin: number; polls: number } = PRIMARY_HYSTERESIS,
): PrimaryState & { flipped: boolean; why: string } {
  const live = Object.entries(scores).filter(([, s]) => s != null && Number.isFinite(s)) as [string, number][];
  if (!live.length) return { ...emptyPrimary(), flipped: prev.symbol != null, why: "no full-plan card" };
  const best = [...live].sort((a, b) => b[1] - a[1])[0];
  const inc = prev.symbol != null ? live.find(([s]) => s === prev.symbol) : undefined;
  if (!inc) return { symbol: best[0], challenger: null, streak: 0, flipped: prev.symbol !== best[0], why: prev.symbol ? `${prev.symbol} has no card` : "first primary" };
  if (best[0] === inc[0] || best[1] - inc[1] < cfg.margin) return { symbol: inc[0], challenger: null, streak: 0, flipped: false, why: `${inc[0]} holds (lead < ${cfg.margin})` };
  const streak = prev.challenger === best[0] ? prev.streak + 1 : 1;
  if (streak >= cfg.polls) return { symbol: best[0], challenger: null, streak: 0, flipped: true, why: `${best[0]} beat ${inc[0]} by >= ${cfg.margin} for ${streak} polls` };
  return { symbol: inc[0], challenger: best[0], streak, flipped: false, why: `${best[0]} leads ${streak}/${cfg.polls} polls` };
}

let memo: PrimaryState = emptyPrimary();
let memoDay = "";
/** Live desk: one memo per process, reset each ET day. */
export function primaryForPoll(day: string, scores: Record<string, number | null | undefined>) {
  if (day !== memoDay) { memo = emptyPrimary(); memoDay = day; }
  const r = stickyPrimary(memo, scores);
  memo = { symbol: r.symbol, challenger: r.challenger, streak: r.streak };
  return r;
}
export const __resetPrimaryMemo = () => { memo = emptyPrimary(); memoDay = ""; };

/** After a lead re-grade, the non-lead symbol's book is restored from the pre-flip grade (its own plan stands). */
export function keepOtherBook<M extends { left: { symbol: string }; right: { symbol: string } }>(before: M, after: M, leadSymbol: string): M {
  if (!before) return after;
  const out = { ...after };
  if (before.left?.symbol !== leadSymbol && before.left?.symbol === after.left?.symbol) out.left = before.left;
  if (before.right?.symbol !== leadSymbol && before.right?.symbol === after.right?.symbol) out.right = before.right;
  return out;
}
