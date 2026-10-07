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
 * Trade path (Keaton 2026-10-06, revised): Agentic ••••6158 (account_number 995386158),
 * option_level_2, limited_margin. Fresh get_portfolio 2026-10-06 09:46 ET:
 * cash $996.12, buying power $996.12. That read is the floor default so the
 * desk and Trading Stand show buying power, not the old $0 snapshot.
 * Individual ••••7477 (415577477) is display-only: never a place target.
 *
 * Hard BP gate (Accuracy): evaluateRhBuyingPower in rh-autofire-gates.ts on a fresh
 * get_portfolio read (mayPlaceAfterReview.accountAtReview). accountPlaceGate here is the
 * Manager-block side: wrong account / snapshot / unknown / < $150 BP all refuse.
 */
import {
  RH_MAX_DEBIT_TOTAL,
  RH_MIN_DEBIT_TOTAL,
  RH_PREFERRED_ACCOUNT_LABEL,
  RH_PREFERRED_ACCOUNT_MASK_LAST4,
  RH_PREFERRED_ACCOUNT_NUMBER,
} from "./rh-autofire-gates";

export { RH_PREFERRED_ACCOUNT_LABEL, RH_PREFERRED_ACCOUNT_MASK_LAST4, RH_PREFERRED_ACCOUNT_NUMBER };

/** Individual ••••7477 — display-only (never placeable by this agent). */
export const RH_INDIVIDUAL_ACCOUNT_NUMBER = "415577477";
export const RH_INDIVIDUAL_ACCOUNT_MASK_LAST4 = "7477";

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
  /** Full RH account_number when known — places require RH_PREFERRED_ACCOUNT_NUMBER. */
  accountNumber: string | null;
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

/** Like num() but keeps "unknown" as NaN so the hard BP gate can fail closed. */
function numOrNaN(v: unknown): number {
  if (v == null || v === "") return Number.NaN;
  const n = typeof v === "number" ? v : Number.parseFloat(String(v));
  return Number.isFinite(n) ? n : Number.NaN;
}

export function canFillRhEnvelope(optionsBuyingPowerUsd: number): boolean {
  return Number.isFinite(optionsBuyingPowerUsd) && optionsBuyingPowerUsd >= RH_MIN_DEBIT_TOTAL;
}

/** Pure mapper → ManagerRoomState.account. */
export function toManagerRhAccount(args: {
  cashUsd: number;
  optionsBuyingPowerUsd: number;
  asOf?: string;
  accountNumber?: string | null;
  accountMaskLast4?: string | null;
  agenticAllowed?: boolean;
  optionLevel?: string | null;
  label?: string | null;
  isSnapshot?: boolean;
}): ManagerRhAccount {
  // Unknown BP stays NaN (not 0) — canFillEnvelope false, hard gate says "unknown".
  const bp = numOrNaN(args.optionsBuyingPowerUsd);
  const acctNo = args.accountNumber ?? null;
  return {
    source: "rh_live",
    cashUsd: num(args.cashUsd),
    optionsBuyingPowerUsd: bp,
    envelopeMinUsd: RH_MIN_DEBIT_TOTAL,
    envelopeMaxUsd: RH_MAX_DEBIT_TOTAL,
    canFillEnvelope: canFillRhEnvelope(bp),
    asOf: args.asOf ?? new Date().toISOString(),
    accountNumber: acctNo,
    accountMaskLast4: args.accountMaskLast4 ?? (acctNo ? acctNo.slice(-4) : null),
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
    optionsBuyingPowerUsd: numOrNaN(bp),
    asOf: args.asOf,
    accountNumber: args.account.account_number,
    accountMaskLast4: args.account.account_number.slice(-4),
    agenticAllowed: args.account.agentic_allowed === true,
    optionLevel: args.account.option_level || null,
    label,
  });
}

/**
 * SAMPLE snapshot — Individual ••••7477 (display-only) from connector read 2026-10-06
 * (portfolio cash $984.12, buying_power $11.56, cash account). Never a place target.
 */
export const RH_INDIVIDUAL_SNAPSHOT_2026_10_06: ManagerRhAccount = toManagerRhAccount({
  cashUsd: 984.12,
  optionsBuyingPowerUsd: 11.56,
  asOf: "2026-10-06T01:45:00.000Z",
  accountNumber: RH_INDIVIDUAL_ACCOUNT_NUMBER,
  accountMaskLast4: RH_INDIVIDUAL_ACCOUNT_MASK_LAST4,
  agenticAllowed: false,
  optionLevel: "option_level_2",
  label: "Individual",
  isSnapshot: true,
});

/**
 * Agentic ••••6158 — the trade account. get_portfolio 2026-10-06 13:46 UTC:
 * cash $996.12, buying power $996.12, limited margin, options level 2.
 * Not a snapshot: the floor plate and the crew quote this read.
 * A place still re-reads get_portfolio at review (evaluateRhBuyingPower).
 */
export const RH_AGENTIC_SNAPSHOT_2026_10_06: ManagerRhAccount = toManagerRhAccount({
  cashUsd: 996.12,
  optionsBuyingPowerUsd: 996.12,
  asOf: "2026-10-06T13:46:00.000Z",
  accountNumber: RH_PREFERRED_ACCOUNT_NUMBER,
  accountMaskLast4: RH_PREFERRED_ACCOUNT_MASK_LAST4,
  agenticAllowed: true,
  optionLevel: "option_level_2",
  label: RH_PREFERRED_ACCOUNT_LABEL,
  isSnapshot: false,
});

/** Default ManagerRoomState.account — funded Agentic read until a newer connector read replaces it. */
export const DEFAULT_MANAGER_ROOM_ACCOUNT: ManagerRhAccount = RH_AGENTIC_SNAPSHOT_2026_10_06;

/** Monitor line, e.g. "BP $11.56 · below $150 envelope, arm blocked". */
export function managerAccountLine(a: ManagerRhAccount | null | undefined): string {
  if (!a) return "RH account — no read";
  if (!Number.isFinite(a.optionsBuyingPowerUsd)) return "BP unknown · arm blocked";
  const bp = `BP $${a.optionsBuyingPowerUsd.toFixed(2)}`;
  return a.canFillEnvelope
    ? `${bp} · envelope $${a.envelopeMinUsd}–$${a.envelopeMaxUsd} ok`
    : `${bp} · below $${a.envelopeMinUsd} envelope, arm blocked`;
}

/**
 * Account-side place gate. Refuses when the account block is missing, it is not
 * the Agentic trade account (account_number 995386158), the agent cannot act on
 * it, options level < 2, the block is a static snapshot, or BP is unknown /
 * < $150 / < ticket debit. Fail closed. Freshness is enforced by
 * evaluateRhBuyingPower on accountAtReview in mayPlaceAfterReview.
 */
export function accountPlaceGate(
  a: ManagerRhAccount | null | undefined,
  opts: { requiredDebitUsd?: number | null } = {},
): { ok: true } | { ok: false; reason: string; gate?: string } {
  if (!a) return { ok: false, gate: "bp_no_account", reason: "No ManagerRoomState.account read — refuse place." };
  if (a.accountNumber !== RH_PREFERRED_ACCOUNT_NUMBER) {
    return {
      ok: false,
      gate: "bp_wrong_account",
      reason: `RH account ${a.accountNumber ?? `••••${a.accountMaskLast4 ?? "????"}`} is not the Agentic trade account ${RH_PREFERRED_ACCOUNT_NUMBER} — refuse place.`,
    };
  }
  if (!a.agenticAllowed) {
    return { ok: false, gate: "agentic", reason: `RH account ••••${a.accountMaskLast4 ?? "????"} not accessible to this agent — refuse place.` };
  }
  const lvl = /option_level_(\d+)/.exec(a.optionLevel ?? "");
  if (!lvl || Number(lvl[1]) < 2) {
    return { ok: false, gate: "options_level", reason: "Options level < 2 — refuse place." };
  }
  if (a.isSnapshot) {
    return { ok: false, gate: "bp_snapshot", reason: "ManagerRoomState.account is a static snapshot, not a fresh read — refuse place." };
  }
  const bp = a.optionsBuyingPowerUsd;
  if (typeof bp !== "number" || !Number.isFinite(bp)) {
    return { ok: false, gate: "bp_unknown", reason: "Options buying power unknown — refuse place (fail closed)." };
  }
  // Recompute — never trust the canFillEnvelope flag on its own.
  if (bp < Math.max(RH_MIN_DEBIT_TOTAL, a.envelopeMinUsd || 0)) {
    return { ok: false, gate: "bp_below_envelope", reason: managerAccountLine(a) };
  }
  const need = opts.requiredDebitUsd;
  if (need != null && !(bp + 1e-9 >= need)) {
    return { ok: false, gate: "bp_ticket", reason: `Ticket debit $${need.toFixed(2)} > BP $${bp.toFixed(2)} — refuse place.` };
  }
  return { ok: true };
}
