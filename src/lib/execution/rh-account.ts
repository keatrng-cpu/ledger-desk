/**
 * Robinhood account read → RhAccountSnapshot (BP gate + Floor context).
 *
 * Agent duty (Keaton 2026-10-06): before proposeRhLiveOption, call
 *   user-Robinhood-xai get_accounts  (type, unsettled_funds, agentic_allowed, option_level)
 *   user-Robinhood-xai get_portfolio {account_number}  (cash, buying_power.buying_power)
 * and pass rhAccountFromPortfolio(...) as candidate.account. Re-read before place.
 * get_accounts "does NOT return reliable buying power" — BP comes from get_portfolio only.
 * Pure parsing. Does not place.
 */
import type { RhAccountSnapshot } from "./rh-autofire-gates";

const num = (x: unknown): number | null => {
  const v = typeof x === "number" ? x : typeof x === "string" && x.trim() !== "" ? Number(x) : NaN;
  return Number.isFinite(v) ? v : null;
};

export function maskAccount(n: string | null | undefined): string {
  const s = String(n ?? "");
  return s.length >= 4 ? `••${s.slice(-4)}` : "••??";
}

/** get_portfolio + matching get_accounts row → snapshot. BP missing → NaN (gate: bp_unknown). */
export function rhAccountFromPortfolio(args: {
  portfolio: unknown;
  account?: unknown;
  asOfMs: number;
  label?: string;
}): RhAccountSnapshot {
  const p = ((args.portfolio as { data?: unknown })?.data ?? args.portfolio ?? {}) as Record<string, unknown>;
  const a = (args.account ?? {}) as Record<string, unknown>;
  const bpRaw = p.buying_power;
  // Missing BP stays NaN → evaluateRhBuyingPower refuses "bp_unknown" (fail closed, distinct from $0).
  const bp = num(typeof bpRaw === "object" && bpRaw ? (bpRaw as Record<string, unknown>).buying_power : bpRaw) ?? Number.NaN;
  const kind = String(a.brokerage_account_type ?? "individual");
  const label = args.label ?? `${kind.charAt(0).toUpperCase()}${kind.slice(1)} ${maskAccount(a.account_number as string)}`;
  return {
    label,
    accountNumber: typeof a.account_number === "string" ? a.account_number : null,
    accountType: String(a.type ?? "unknown"),
    cash: num(p.cash) ?? 0,
    buyingPower: bp,
    optionsBuyingPower: null,
    unsettledFunds: num(a.unsettled_funds),
    agenticAllowed: typeof a.agentic_allowed === "boolean" ? a.agentic_allowed : null,
    optionLevel: typeof a.option_level === "string" ? a.option_level : null,
    asOfMs: args.asOfMs,
    source: "get_portfolio",
  };
}

/**
 * Desk read for the Floor — Agentic ••6158, get_portfolio 2026-10-06 13:46 UTC.
 * This is the account the crew and Trading Stand quote. The Individual
 * snapshot below stays display-only and must not be what the room speaks.
 */
export const RH_AGENTIC_DESK_READ: RhAccountSnapshot = {
  label: "Agentic ••6158",
  accountNumber: "995386158",
  accountType: "limited_margin",
  cash: 996.12,
  buyingPower: 996.12,
  optionsBuyingPower: 996.12,
  unsettledFunds: 0,
  agenticAllowed: true,
  optionLevel: "option_level_2",
  asOfMs: Date.UTC(2026, 9, 6, 13, 46, 0),
  source: "get_portfolio",
};

/**
 * Desk snapshot for the Floor — Keaton's screenshot 2026-10-06, matched by a
 * read-only get_portfolio / get_accounts at 01:46 UTC. CONTEXT ONLY:
 * source "desk_snapshot" can never clear evaluateRhBuyingPower.
 *   Individual (cash acct): $984.12 cash, $972.56 unsettled, $11.56 buying power,
 *   options level 2, today −$179.84 (−15.45%), not tradable by the agent.
 */
export const RH_DESK_ACCOUNT_SNAPSHOT: RhAccountSnapshot = {
  label: "Individual ••7477",
  accountNumber: "415577477", // display-only — never the trade account
  accountType: "cash",
  cash: 984.12,
  buyingPower: 11.56,
  optionsBuyingPower: 11.56,
  unsettledFunds: 972.56,
  agenticAllowed: false,
  optionLevel: "option_level_2",
  dayChangeUsd: -179.84,
  dayChangePct: -15.45,
  asOfMs: Date.UTC(2026, 9, 6, 1, 46, 0),
  source: "desk_snapshot",
};
