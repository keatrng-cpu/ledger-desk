/**
 * Floor / Now arm readout — DISPLAY ONLY, fail closed.
 * Mirrors the hard gates in manager-account.ts (isSnapshot) and
 * rh-autofire-gates.ts (RH_BP_MAX_AGE_MS stale BP). Never places.
 */
import { RH_BP_MAX_AGE_MS, RH_MIN_DEBIT_TOTAL } from "@/lib/execution/rh-autofire-gates";
import type { ManagerRhAccount } from "@/lib/execution/manager-account";

export type ArmBlockReason =
  | "no_account"
  | "snapshot"
  | "stale"
  | "unknown_bp"
  | "below_envelope";

export interface ArmDisplay {
  blocked: boolean;
  reason: ArmBlockReason | null;
  /** Short chip text, e.g. "arm blocked · snapshot". */
  label: string;
}

/** Age of ManagerRhAccount.asOf vs now, or NaN when unparseable. */
export function bpAgeMs(a: ManagerRhAccount, nowMs: number): number {
  const t = Date.parse(a.asOf);
  return Number.isFinite(t) ? nowMs - t : Number.NaN;
}

/**
 * Fail-closed arm display. Snapshot → blocked (manager-account.ts:218-220).
 * BP older than RH_BP_MAX_AGE_MS → blocked (rh-autofire-gates.ts).
 */
export function armDisplay(rh: ManagerRhAccount | null | undefined, nowMs: number = Date.now()): ArmDisplay {
  if (!rh) {
    return { blocked: true, reason: "no_account", label: "arm blocked · no account" };
  }
  if (rh.isSnapshot) {
    return { blocked: true, reason: "snapshot", label: "arm blocked · snapshot" };
  }
  const age = bpAgeMs(rh, nowMs);
  if (!Number.isFinite(age) || age < -60_000 || age > RH_BP_MAX_AGE_MS) {
    return { blocked: true, reason: "stale", label: "arm blocked · stale" };
  }
  const bp = rh.optionsBuyingPowerUsd;
  if (typeof bp !== "number" || !Number.isFinite(bp)) {
    return { blocked: true, reason: "unknown_bp", label: "arm blocked · unknown BP" };
  }
  const floor = rh.envelopeMinUsd || RH_MIN_DEBIT_TOTAL;
  if (bp < floor || !rh.canFillEnvelope) {
    return { blocked: true, reason: "below_envelope", label: "arm blocked · below envelope" };
  }
  return { blocked: false, reason: null, label: "arm ok" };
}

export { RH_BP_MAX_AGE_MS, RH_MIN_DEBIT_TOTAL };
