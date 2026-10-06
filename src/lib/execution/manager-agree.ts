/**
 * Trading Stand Manager → RH autofire agentAgree adapter (design step 5).
 *
 * Duck-typed against DESIGN_MANAGER_TRADING_STAND.md ManagerCall / ManagerRoomState.
 * When proto/owner-manager lands ManagerRoomState on main, pass feed.getState() here —
 * no gate thresholds change. Absent Manager state → agentAgree false (safe).
 *
 * Does NOT place orders. Hard gates stay in rh-autofire-gates.ts.
 * ManagerRoomState.account (read-only RH block) lives in manager-account.ts.
 */
import type { ManagerRhAccount } from "./manager-account";

/** Minimal ManagerCall shape the RH path needs (design ManagerCall.agentAgree). */
export interface ManagerCallAgree {
  agentAgree: boolean;
}

/**
 * Minimal ManagerRoomState shape — `call` is read for the Stand bit;
 * `account` is the read-only RH block (cash / options BP / envelope) for monitors.
 */
export interface ManagerRoomStateAgree {
  call: ManagerCallAgree | null;
  account?: ManagerRhAccount | null;
}

/**
 * THE Stand bit for rh-autofire.
 * True only when call.agentAgree === true. Null/undefined/missing → false.
 */
export function agentAgreeFromManagerCall(
  call: ManagerCallAgree | null | undefined,
): boolean {
  return call?.agentAgree === true;
}

/**
 * Read agentAgree from ManagerRoomState (or any object with call.agentAgree).
 * Safe when Manager feed is not mounted yet.
 */
export function agentAgreeFromManagerRoomState(
  state: ManagerRoomStateAgree | null | undefined,
): boolean {
  return agentAgreeFromManagerCall(state?.call ?? null);
}

/**
 * Resolve Stand agentAgree for candidateFromFloorPathStand.
 *
 * Priority:
 * 1. manager (ManagerRoomState-like) when the key is present
 * 2. managerCall when the key is present
 * 3. explicit agentAgree boolean (legacy / tests)
 * 4. false (Manager absent — refuse agent gate)
 *
 * Manager sources win over explicit agentAgree so the chair owns the bit.
 */
export function resolveStandAgentAgree(args: {
  manager?: ManagerRoomStateAgree | null;
  managerCall?: ManagerCallAgree | null;
  agentAgree?: boolean;
}): boolean {
  if ("manager" in args) {
    return agentAgreeFromManagerRoomState(args.manager);
  }
  if ("managerCall" in args) {
    return agentAgreeFromManagerCall(args.managerCall);
  }
  return args.agentAgree === true;
}
