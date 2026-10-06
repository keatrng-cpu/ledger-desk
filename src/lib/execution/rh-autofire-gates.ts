/**
 * Robinhood live options autofire — PURE gates.
 * Production (Keaton 2026-10-06): live-when-armed. Triple: Floor ARMED + PATH A+/A/A- + Stand.
 * Envelope: debit $150-$550, 1-4 contracts, ATM or OTM_1 only.
 * Agent: review_option_order then place_option_order (no preview_option_order tool).
 * Buying-power hard gate (Keaton 2026-10-06): the agent MUST call get_portfolio
 * (account_number) before propose and again before place. Spendable =
 * buying_power.buying_power (never `cash` — unsettled proceeds on a cash account
 * are not spendable). Spendable < $150 → nothing in the envelope can place → refuse.
 * scripts/verify-rh-autofire-gates.mjs pins refusals.
 */

export const RH_PATH_FLOOR = 0.65;
export const RH_MIN_DEBIT_TOTAL = 150;
export const RH_MAX_DEBIT_TOTAL = 550;
export const RH_MIN_CONTRACTS = 1;
export const RH_MAX_CONTRACTS = 4;

export type RhStrikeOffset = "ATM" | "OTM_1";
export const RH_ALLOWED_OFFSETS: readonly RhStrikeOffset[] = ["ATM", "OTM_1"];

/**
 * Flipped true 2026-10-06: Keaton confirmed in writing in chat that he wants
 * live RH options autofire for the next NY morning (review then place when
 * Floor + PATH + Stand agree). Env still needs RH_OPTIONS_AUTOFIRE_ENABLED
 * and RH_LIVE_ARMED before any place.
 */
export const RH_OPTIONS_LIVE_CONFIRMED_IN_WRITING = true;

export const RH_LIVE_DISARMED_REASON =
  "RH_LIVE_ARMED is not true — live Robinhood options stay shut until the trader arms them.";

export const RH_NOT_CONFIRMED_REASON =
  "RH_OPTIONS_LIVE_CONFIRMED_IN_WRITING is false — flip in rh-autofire-gates.ts after confirming agentic options trading is permitted on this Robinhood account.";

/** A get_portfolio read older than this cannot authorize a live ticket. */
export const RH_BP_MAX_AGE_MS = 5 * 60_000;

/**
 * Robinhood account read for the BP gate + Floor context.
 * Build from get_portfolio (+ get_accounts for type / unsettled / access) via
 * rhAccountFromPortfolio in rh-account.ts. Only source "get_portfolio" with a
 * fresh asOfMs can clear the gate; a desk snapshot (screenshot) is context only.
 */
export interface RhAccountSnapshot {
  /** e.g. "Individual ••7477" — masked, never the full number. */
  label: string;
  /** get_accounts.type: "cash" | "limited_margin" | "margin". */
  accountType: string;
  /** get_portfolio.cash — includes unsettled proceeds; NOT spendable by itself. */
  cash: number;
  /** get_portfolio.buying_power.buying_power — the authoritative spendable figure. */
  buyingPower: number;
  /** Options buying power when the source reports one separately; else null (= buyingPower). */
  optionsBuyingPower?: number | null;
  /** get_accounts.unsettled_funds (cash accounts). */
  unsettledFunds?: number | null;
  /** get_accounts.agentic_allowed — false = this agent cannot trade the account. */
  agenticAllowed?: boolean | null;
  /** get_accounts.option_level, e.g. "option_level_2". */
  optionLevel?: string | null;
  dayChangeUsd?: number | null;
  dayChangePct?: number | null;
  asOfMs: number;
  source: "get_portfolio" | "desk_snapshot" | string;
}

/** What the account can actually put into an options debit right now. Never reads `cash`. */
export function rhSpendable(a: RhAccountSnapshot | null | undefined): number {
  if (!a) return 0;
  const bp = Number(a.buyingPower);
  const obp = a.optionsBuyingPower == null ? bp : Number(a.optionsBuyingPower);
  const v = Math.min(Number.isFinite(bp) ? bp : 0, Number.isFinite(obp) ? obp : 0);
  return v > 0 ? v : 0;
}

/**
 * Hard BP gate. Fail closed: no read, stale read, non-live source, no access,
 * no options level, or spendable under the $150 envelope floor → refuse.
 * With `debitTotal`, also refuses when spendable cannot cover that ticket.
 */
export function evaluateRhBuyingPower(
  a: RhAccountSnapshot | null | undefined,
  nowMs: number,
  debitTotal?: number | null,
): RhAutofireGateResult {
  if (!a) {
    return { ok: false, gate: "bp_unknown", reason: "No Robinhood account read — agent must call get_portfolio before propose." };
  }
  if (a.source !== "get_portfolio") {
    return { ok: false, gate: "bp_source", reason: `Account read is ${a.source || "unknown"}, not a live get_portfolio — context only, cannot authorize a ticket.` };
  }
  const age = nowMs - Number(a.asOfMs);
  if (!(age >= -60_000 && age <= RH_BP_MAX_AGE_MS)) {
    return { ok: false, gate: "bp_stale", reason: `get_portfolio read is ${Math.round(age / 60_000)} min old (max ${RH_BP_MAX_AGE_MS / 60_000}) — re-read before propose.` };
  }
  if (a.agenticAllowed === false) {
    return { ok: false, gate: "account_access", reason: `${a.label} is not tradable by this agent — read-only.` };
  }
  if (a.optionLevel != null && !/option_level_[23]/.test(a.optionLevel)) {
    return { ok: false, gate: "options_level", reason: `${a.label} options level ${a.optionLevel || "none"} < 2 — cannot buy calls/puts.` };
  }
  const sp = rhSpendable(a);
  if (sp < RH_MIN_DEBIT_TOTAL) {
    return {
      ok: false,
      gate: "bp_floor",
      reason: `${a.label} buying power $${sp.toFixed(2)} < $${RH_MIN_DEBIT_TOTAL} min debit — nothing in the $${RH_MIN_DEBIT_TOTAL}-$${RH_MAX_DEBIT_TOTAL} envelope can place.`,
    };
  }
  if (debitTotal != null && !(sp + 1e-9 >= Number(debitTotal))) {
    return { ok: false, gate: "bp_ticket", reason: `Ticket debit $${Number(debitTotal).toFixed(2)} > buying power $${sp.toFixed(2)}.` };
  }
  return { ok: true, why: `BP $${sp.toFixed(2)} covers ${debitTotal != null ? `$${Number(debitTotal).toFixed(2)}` : `$${RH_MIN_DEBIT_TOTAL} floor`}` };
}

export type RhPathBand = "A+" | "A" | "A-" | string;

export interface RhAutofireCandidate {
  floorVerdict: "ARMED" | "WATCH" | "STAND" | string;
  deskContracts: number;
  pathActionable: boolean;
  pathBand: RhPathBand | null;
  confluence: number;
  agentAgree: boolean;
  optionsSessionOpen: boolean;
  newsBlackout: boolean;
  riskHalt: boolean;
  oneBookBlocked: boolean;
  /**
   * Fresh get_portfolio read for the account that would place. Missing → refuse
   * (gate "bp_unknown"). Required in practice; optional in the type so old
   * callers fail closed instead of failing to compile.
   */
  account?: RhAccountSnapshot | null;
}

export interface RhTicketEnvelope {
  contracts: number;
  debitTotal: number;
  strikeOffset: string;
}

export interface RhAutofireFlags {
  autofireEnabled: boolean;
  liveArmed: boolean;
  confirmedInWriting?: boolean;
  /** Clock for the BP freshness check; defaults to Date.now(). */
  nowMs?: number;
}

export type RhAutofireGateResult =
  | { ok: true; why: string }
  | { ok: false; reason: string; gate: string };

const HIGH_PROB = new Set(["A+", "A", "A-", "A＋"]);

function normalizeBand(band: string | null | undefined): string {
  return String(band ?? "").replace("−", "-").replace("＋", "+");
}

function normalizeOffset(offset: string | null | undefined): string {
  const o = String(offset ?? "").trim().toUpperCase().replace(/-/g, "_");
  if (o === "ATM" || o === "AT_THE_MONEY") return "ATM";
  if (o === "OTM_1" || o === "OTM1" || o === "1_OTM" || o === "ONE_OTM") return "OTM_1";
  return o;
}

export function evaluateRhTicketEnvelope(t: RhTicketEnvelope): RhAutofireGateResult {
  const n = Math.floor(Number(t.contracts));
  if (!(n >= RH_MIN_CONTRACTS && n <= RH_MAX_CONTRACTS)) {
    return { ok: false, gate: "contracts", reason: `Contracts ${t.contracts} outside ${RH_MIN_CONTRACTS}-${RH_MAX_CONTRACTS}.` };
  }
  const debit = Number(t.debitTotal);
  if (!(debit >= RH_MIN_DEBIT_TOTAL)) {
    return { ok: false, gate: "debit_floor", reason: `Debit $${debit.toFixed(0)} under minimum $${RH_MIN_DEBIT_TOTAL}.` };
  }
  if (!(debit <= RH_MAX_DEBIT_TOTAL + 1e-9)) {
    return { ok: false, gate: "debit_cap", reason: `Debit $${debit.toFixed(0)} exceeds maximum $${RH_MAX_DEBIT_TOTAL}.` };
  }
  const offset = normalizeOffset(t.strikeOffset);
  if (!(RH_ALLOWED_OFFSETS as readonly string[]).includes(offset)) {
    return { ok: false, gate: "strike_offset", reason: `Strike offset ${t.strikeOffset || "-"} is not ATM or one strike OTM.` };
  }
  return { ok: true, why: `${n}ct · $${debit.toFixed(0)} · ${offset}` };
}

export function evaluateRhAutofireGates(c: RhAutofireCandidate, flags: RhAutofireFlags): RhAutofireGateResult {
  if (!flags.autofireEnabled) {
    return { ok: false, gate: "autofire_off", reason: "RH_OPTIONS_AUTOFIRE_ENABLED is not true." };
  }
  if (!flags.liveArmed) {
    return { ok: false, gate: "live_arm", reason: RH_LIVE_DISARMED_REASON };
  }
  const confirmed = flags.confirmedInWriting ?? RH_OPTIONS_LIVE_CONFIRMED_IN_WRITING;
  if (!confirmed) {
    return { ok: false, gate: "confirmed", reason: RH_NOT_CONFIRMED_REASON };
  }
  const bp = evaluateRhBuyingPower(c.account, flags.nowMs ?? Date.now());
  if (!bp.ok) return bp;
  if (c.riskHalt) {
    return { ok: false, gate: "risk_halt", reason: "Risk halt is on — no new Robinhood entries." };
  }
  if (c.newsBlackout) {
    return { ok: false, gate: "blackout", reason: "News / session blackout — stand down." };
  }
  if (!c.optionsSessionOpen) {
    return { ok: false, gate: "session", reason: "Options session closed (RH lists 09:30-16:00 ET; desk flat rules apply)." };
  }
  if (c.oneBookBlocked) {
    return { ok: false, gate: "one_book", reason: "One book rule — another underlier already open or locked today." };
  }
  if (c.floorVerdict !== "ARMED") {
    return { ok: false, gate: "floor", reason: `Floor desk is ${c.floorVerdict || "unknown"} — need ARMED.` };
  }
  if (!(c.deskContracts >= 1)) {
    return { ok: false, gate: "floor_ticket", reason: "Floor ARMED but no priced ticket (deskContracts < 1)." };
  }
  if (!c.pathActionable) {
    return { ok: false, gate: "path_actionable", reason: "PATH scanner candidate is not actionable." };
  }
  const band = normalizeBand(c.pathBand);
  if (!HIGH_PROB.has(band)) {
    return { ok: false, gate: "path_band", reason: `PATH band ${c.pathBand ?? "-"} is not A+/A/A-.` };
  }
  const conf = typeof c.confluence === "number" ? c.confluence : 0;
  if (conf < RH_PATH_FLOOR) {
    return { ok: false, gate: "path_floor", reason: `Confluence ${conf.toFixed(2)} < PATH floor ${RH_PATH_FLOOR.toFixed(2)}.` };
  }
  if (c.agentAgree !== true) {
    return { ok: false, gate: "agent", reason: "Trading Stand (agent) has not agreed this cycle." };
  }
  return { ok: true, why: `Floor ARMED · PATH ${band} Q ${conf.toFixed(2)} · Stand agrees · ${bp.why} · live armed` };
}
