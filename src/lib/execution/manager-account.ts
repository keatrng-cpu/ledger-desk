/**
 * ManagerRoomState.account — read-only Robinhood account block for Manager monitors.
 *
 * Design Atelier shows cash / options BP; Stand/host may inject live numbers later
 * from RH connector reads (get_accounts + get_portfolio with account_number).
 * PURE: no connector calls, no orders. Envelope comes from rh-autofire-gates.
 *
 * Soft gate: optionsBuyingPowerUsd < envelopeMinUsd ($150) → canFillEnvelope=false
 * ("BP $11.56 · below $150 envelope, arm blocked").
 *
 * Trade path (Keaton 2026-10-06): Individual ••••7477 (account_number 415577477).
 * Agentic ••••6158 is NOT the trade path. Individual is currently not accessible to
 * the agent (agentic_allowed=false) → accountPlaceGate refuses until it is.
 * Keaton plans to convert Individual to margin so BP can cover the envelope.
 */
import { RH_MAX_DEBIT_TOTAL, RH_MIN_DEBIT_TOTAL } from "./rh-autofire-gates";

/** Preferred RH account for autofire config (Individual, Keaton 2026-10-06). */
export const RH_PREFERRED_ACCOUNT_NUMBER = "415577477";
export const RH_PREFERRED_ACCOUNT_MASK_LAST4 = "7477";
export const RH_PREFERRED_ACCOUNT_LABEL = "Individual";

export interface ManagerRhAccount {
  source: "rh_live";
  cashUsd: number;
  optionsBuyingPowerUsd: number;
  envelopeMinUsd: number; // 150
  envelopeMaxUsd: number; // 550
  /** optionsBuyingPowerUsd >= envelopeMinUsd */
  canFillEnvelope: boolean;
  /** ISO timestamp of the connector read (or snapshot). */
  asOf: string;
  accountMaskLast4: string | null;
  /** Caller-relative: true only when this agent may act on the account. */
  agenticAllowed: boolean;
  optionLevel: string | null;
  label: string | null;
  /** True when this block is the static sample snapshot, not a fresh read. */
  isSnapshot: boolean;
}

/** Slice of ManagerRoomState carrying the account block. */
export interface ManagerRoomStateAccount {
  account: ManagerRhAccount | null;
}

function num(v: unknown): number {
  const n = typeof v === "number" ? v : Number.parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? n : 0;
}

export function canFillRhEnvelope(optionsBuyingPowerUsd: number): boolean {
  return optionsBuyingPowerUsd >= RH_MIN_DEBIT_TOTAL;
}

/** Pure mapper → ManagerRoomState.account. */
export function toManagerRhAccount(args: {
  cashUsd: number;
  optionsBuyingPowerUsd: number;
  asOf?: string;
  accountMaskLast4?: string | null;
  agenticAllowed?: boolean;
  optionLevel?: string | null;
  label?: string | null;
  isSnapshot?: boolean;
}): ManagerRhAccount {
  const bp = num(args.optionsBuyingPowerUsd);
  return {
    source: "rh_live",
    cashUsd: num(args.cashUsd),
    optionsBuyingPowerUsd: bp,
    envelopeMinUsd: RH_MIN_DEBIT_TOTAL,
    envelopeMaxUsd: RH_MAX_DEBIT_TOTAL,
    canFillEnvelope: canFillRhEnvelope(bp),
    asOf: args.asOf ?? new Date().toISOString(),
    accountMaskLast4: args.accountMaskLast4 ?? null,
    agenticAllowed: args.agenticAllowed === true,
    optionLevel: args.optionLevel ?? null,
    label: args.label ?? null,
    isSnapshot: args.isSnapshot === true,
  };
}

/** get_accounts row (subset). */
export interface RhConnectorAccountRow {
  account_number: string;
  brokerage_account_type?: string;
  nickname?: string;
  agentic_allowed?: boolean;
  option_level?: string;
}

/** get_portfolio data (subset). */
export interface RhConnectorPortfolio {
  cash?: string | number;
  buying_power?: { buying_power?: string | number } | string | number;
}

/** Map connector payloads (get_accounts row + get_portfolio data) → account block. */
export function managerRhAccountFromConnector(args: {
  account: RhConnectorAccountRow;
  portfolio: RhConnectorPortfolio;
  asOf?: string;
}): ManagerRhAccount {
  const bpRaw = args.portfolio.buying_power;
  const bp = typeof bpRaw === "object" && bpRaw !== null ? bpRaw.buying_power : bpRaw;
  const t = args.account.brokerage_account_type ?? "";
  const label = args.account.nickname || (t ? t.charAt(0).toUpperCase() + t.slice(1) : null);
  return toManagerRhAccount({
    cashUsd: num(args.portfolio.cash),
    optionsBuyingPowerUsd: num(bp),
    asOf: args.asOf,
    accountMaskLast4: args.account.account_number.slice(-4),
    agenticAllowed: args.account.agentic_allowed === true,
    optionLevel: args.account.option_level || null,
    label,
  });
}

/**
 * SAMPLE snapshot — Individual ••••7477 from connector read pattern 2026-10-06
 * (portfolio cash $984.12, buying_power $11.56, ~$972.56 unsettled, cash account).
 * Not a live read; hosts should replace with managerRhAccountFromConnector.
 */
export const RH_INDIVIDUAL_SNAPSHOT_2026_10_06: ManagerRhAccount = toManagerRhAccount({
  cashUsd: 984.12,
  optionsBuyingPowerUsd: 11.56,
  asOf: "2026-10-06T01:45:00.000Z",
  accountMaskLast4: RH_PREFERRED_ACCOUNT_MASK_LAST4,
  agenticAllowed: false,
  optionLevel: "option_level_2",
  label: RH_PREFERRED_ACCOUNT_LABEL,
  isSnapshot: true,
});

/** Default ManagerRoomState.account (sample snapshot until host injects live). */
export const DEFAULT_MANAGER_ROOM_ACCOUNT: ManagerRhAccount = RH_INDIVIDUAL_SNAPSHOT_2026_10_06;

/** Monitor line, e.g. "BP $11.56 · below $150 envelope, arm blocked". */
export function managerAccountLine(a: ManagerRhAccount | null | undefined): string {
  if (!a) return "RH account — no read";
  const bp = `BP $${a.optionsBuyingPowerUsd.toFixed(2)}`;
  return a.canFillEnvelope
    ? `${bp} · envelope $${a.envelopeMinUsd}–$${a.envelopeMaxUsd} ok`
    : `${bp} · below $${a.envelopeMinUsd} envelope, arm blocked`;
}

/**
 * Account-side place gate. Refuses when the account block is missing, the agent
 * cannot act on it, options level < 2, or BP cannot fill the $150 envelope.
 */
export function accountPlaceGate(
  a: ManagerRhAccount | null | undefined,
): { ok: true } | { ok: false; reason: string } {
  if (!a) return { ok: false, reason: "No ManagerRoomState.account read — refuse place." };
  if (!a.agenticAllowed) {
    return { ok: false, reason: `RH account ••••${a.accountMaskLast4 ?? "????"} not accessible to this agent — refuse place.` };
  }
  const lvl = /option_level_(\d+)/.exec(a.optionLevel ?? "");
  if (!lvl || Number(lvl[1]) < 2) {
    return { ok: false, reason: "Options level < 2 — refuse place." };
  }
  if (!a.canFillEnvelope) return { ok: false, reason: managerAccountLine(a) };
  return { ok: true };
}
