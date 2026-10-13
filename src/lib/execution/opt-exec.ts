/**
 * Option-PnL execution rules (shared rules `optExec`; Python twin watcher/optexec.py; parity test scripts/opt-exec.test.mjs).
 * Pure functions used by the Floor ticket text and the backtest; the watcher executes them on RH.
 */
import RULES from "../../../shared/desk-rules.json";

export const OX = RULES.optExec;
type Rule = keyof typeof OX;
export function oxMode(rule: Rule | "delta" | "spread"): "live" | "shadow" {
  const v = (OX as Record<string, unknown>)[rule];
  const m = v && typeof v === "object" && !Array.isArray(v) ? (v as { mode?: string }).mode : (OX as Record<string, unknown>)[`${rule}Mode`];
  return m === "live" ? "live" : "shadow";
}
export function spreadPct(bid: number | null, ask: number | null): number | null {
  if (!bid || !ask || ask < bid) return null;
  const mid = (bid + ask) / 2;
  return mid > 0 ? (ask - bid) / mid : null;
}
export interface OxCand<C> { contract: C; quote: { delta?: number | null; bid?: number | null; ask?: number | null; oi?: number | null; volume?: number | null } | null }
/** Fixes 2+3: |delta| in deltaBand, spread <= maxSpreadPctOfMid, most liquid, then tightest, then closest to band middle. */
export function pickByDelta<C>(cands: OxCand<C>[]): OxCand<C> | null {
  const [lo, hi] = OX.deltaBand; const mid = (lo + hi) / 2;
  const ok: [number, number, number, OxCand<C>][] = [];
  for (const c of cands) {
    const q = c.quote ?? {}; const d = q.delta; const sp = spreadPct(q.bid ?? null, q.ask ?? null);
    if (d == null || sp == null) continue;
    if (Math.abs(d) >= lo && Math.abs(d) <= hi && sp <= OX.maxSpreadPctOfMid + 1e-12) ok.push([-(q.oi ?? 0) - (q.volume ?? 0), sp, Math.abs(Math.abs(d) - mid), c]);
  }
  ok.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
  return ok[0]?.[3] ?? null;
}
const r2 = (x: number) => Math.round(x * 100 + 1e-9) / 100;
/** Fix 4: limit at mid, walking toward the ask by stepFracOfHalfSpread per step, never past the ask. */
export function walkLimit(bid: number | null, ask: number | null, step: number): number | null {
  if (ask == null) return null;
  if (!bid || bid <= 0 || bid > ask) return r2(ask);
  const half = (ask - bid) / 2; const s = Math.max(0, Math.min(Math.trunc(step), OX.limitWalk.maxSteps));
  return r2(Math.min(ask, bid + half + s * OX.limitWalk.stepFracOfHalfSpread * half));
}
const hm = (s: string) => { const [h, m] = s.split(":").map(Number); return h * 60 + m; };
/** Fix 5: 0DTE before zeroDteUntilEt, else afterDte; never 0DTE from session.zeroDteCutoffEt. */
export function dteTarget(etMin: number): number {
  const want = etMin < hm(OX.dteByTime.zeroDteUntilEt) ? 0 : OX.dteByTime.afterDte;
  return etMin >= hm(RULES.session.zeroDteCutoffEt) ? Math.max(want, 1) : want;
}
/** Fix 14. */
export function todMult(etMin: number): number {
  return etMin >= hm(OX.todSize.cutFromEt) ? OX.todSize.cutMult : 1;
}
/** Ticket target lines (fixes 9/10): the Floor prints what the watcher will do. */
export function ticketManageLines(): string[] {
  return [
    `Trim ${Math.round(OX.trim.frac * 100)}% at +${Math.round(OX.trim.atGain * 100)}%; the rest runs to T2.`,
    `Stop to breakeven on the option once it is up ${Math.round(OX.breakeven.atGain * 100)}%.`,
    `Not up ${Math.round(OX.timeStop.minGain * 100)}% in ${OX.timeStop.minutes} min: cut.`,
  ];
}
