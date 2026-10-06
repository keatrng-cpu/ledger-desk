/**
 * The Robinhood account block (ManagerRoomState.account, Trading Stand's
 * src/lib/execution/manager-account.ts) as the screen shows it: the Floor
 * Manager monitors and the Now hero.
 *
 * READ-ONLY, PRESENTATION ONLY. Nothing here can place, review or cancel an
 * order or feed a gate — the account place gate is accountPlaceGate in
 * manager-account.ts, the envelope is rh-autofire-gates.ts.
 *
 * Source: whatever the Manager feed carries in ManagerRoomState.account. Until
 * a host injects a live connector read, that is Trading Stand's
 * DEFAULT_MANAGER_ROOM_ACCOUNT — since b8e76f4 the Agentic ••••6158 trade
 * account's $0 SNAPSHOT (isSnapshot: true; Individual ••••7477 is display-only)
 * — and the screen says "snapshot". Which account is the trade path is Trading
 * Stand's call (RH_PREFERRED_ACCOUNT_*); this file only follows it.
 * The Floor reports each feed update here so the hero (on another tab) reads
 * the same block. Dev preview: ?flash=bp-low / ?flash=bp-ok.
 */
import {
  DEFAULT_MANAGER_ROOM_ACCOUNT,
  managerAccountLine,
  RH_PREFERRED_ACCOUNT_MASK_LAST4,
  type ManagerRhAccount,
} from "@/lib/execution/manager-account";

export type { ManagerRhAccount };

let snap: ManagerRhAccount | null = DEFAULT_MANAGER_ROOM_ACCOUNT;
const subs = new Set<() => void>();

export const getRhAccount = () => snap;
export const getRhAccountServer = (): ManagerRhAccount | null => DEFAULT_MANAGER_ROOM_ACCOUNT;
export function subscribeRhAccount(fn: () => void): () => void {
  subs.add(fn);
  return () => subs.delete(fn);
}

/** Record the account block a feed reported (null = no read). */
export function reportRhAccount(next: ManagerRhAccount | null) {
  const same =
    next === snap ||
    (!!next &&
      !!snap &&
      next.asOf === snap.asOf &&
      next.optionsBuyingPowerUsd === snap.optionsBuyingPowerUsd &&
      next.cashUsd === snap.cashUsd &&
      next.canFillEnvelope === snap.canFillEnvelope &&
      next.accountMaskLast4 === snap.accountMaskLast4);
  if (same) return;
  snap = next;
  for (const fn of subs) fn();
}

export interface RhAccountRead {
  /** canFillEnvelope false — the $150 minimum debit cannot fit, the arm is blocked. */
  blocked: boolean;
  /** managerAccountLine, e.g. "BP $11.56 · below $150 envelope, arm blocked". */
  line: string;
  /** "Individual ••••7477" */
  who: string;
  /** "snapshot 01:45 UTC" when isSnapshot, else "as of …". */
  freshness: string;
  /** The block is not the trade account (RH_PREFERRED_ACCOUNT_MASK_LAST4). */
  wrongAccount: boolean;
}

export function readRhAccount(a: ManagerRhAccount): RhAccountRead {
  const t = new Date(a.asOf);
  const when = Number.isFinite(t.getTime())
    ? t.toLocaleString("en-US", {
        timeZone: "America/New_York",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      }) + " ET"
    : a.asOf;
  return {
    blocked: !a.canFillEnvelope,
    line: managerAccountLine(a),
    who: `${a.label ?? "RH"} ••••${a.accountMaskLast4 ?? "????"}`,
    freshness: a.isSnapshot ? `snapshot ${when}` : `as of ${when}`,
    wrongAccount: a.accountMaskLast4 !== RH_PREFERRED_ACCOUNT_MASK_LAST4,
  };
}
