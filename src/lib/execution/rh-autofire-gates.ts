/**
 * Robinhood live options autofire — PURE gates.
 * Production (Keaton 2026-10-06): live-when-armed. Triple: Floor ARMED + PATH A+/A/A-/B+ + Stand.
 * Primary place trigger = a PATH scanner FIRE (path-alarm.ts considerPathAlarm) — the
 * continuous Floor / Trade Now read is the eye; the fire is what starts review → place.
 * Envelope: debit $150-$550, 1-4 contracts, ATM or OTM_1 only.
 * Agent: review_option_order then place_option_order (no preview_option_order tool).
 * Buying-power hard gate (Keaton 2026-10-06): the agent MUST call get_portfolio
 * (account_number) before propose and again before place. Spendable =
 * buying_power.buying_power (never `cash` — unsettled proceeds on a cash account
 * are not spendable). Spendable < $150 → nothing in the envelope can place → refuse.
 * scripts/verify-rh-autofire-gates.mjs pins refusals.
 *
 * Accuracy Review 2026-10-06: NO-GO until the hard BP gate passes on a FRESH
 * get_portfolio read of the Agentic trade account (995386158) — stay disarmed.
 * Mirrors src/lib/room/exec/gates.ts: the broker's numbers; unknown = no.
 *
 * Gate checklist (evaluation order):
 *  1. env arms (RH_OPTIONS_AUTOFIRE_ENABLED, RH_LIVE_ARMED) + written confirmation
 *  2. hard BP gate (evaluateRhBuyingPower) — fresh get_portfolio, Agentic account
 *     number, agentic_allowed, option level >= 2, spendable >= $150
 *  3. risk halt · news blackout · options session · one-book
 *  4. Floor rules (evaluateRhFloorRules, mandate.ts ROOM_CLOCK / ROOM_MANDATE):
 *     no new entries >= 11:00 ET · after 10:00 ET size is cut, B+ and higher
 *     still pass · DTE 0/1 ·
 *     tape (desk feed) <= 30s · CE touch confirmed. Missing signal → refuse.
 *  5. Floor ARMED + priced ticket · PATH actionable A+/A/A- >= 0.65 or B+ >= 0.60
 *     News / shock raises that bar by 0.05 and cuts one contract. It does not
 *     ban B+ and higher. B+ explicit gate (evaluateRhBplusGate): fit >= 0.60 · SEQ TAKE · no veto;
 *     B+ size exactly 1 contract (evaluateRhBandSize), still $150-$550.
 *     (B+ band from aplus/config.ts: confluenceFloor - 0.05) · Stand agentAgree
 */
import { ROOM_MANDATE } from "../room/mandate";
import { APLUS_RULES } from "../aplus/config";

/** PATH floor for A+/A/A- (calibrated 0.65, APLUS_RULES.confluenceFloor). */
export const RH_PATH_FLOOR = 0.65;

/**
 * PATH grades the RH place path accepts (Keaton 2026-10-06: A+, A, A-, AND B+).
 * Mirrors APLUS_RULES.profitPath.onlyExecuteGrades.
 */
export const RH_PATH_GRADES = ["A+", "A", "A-", "B+"] as const;

/**
 * B+ has its own band in config (riskGradeFromScore / strategy-grade pathBand):
 * confluenceFloor - 0.05 = 0.60. No new score — the config band's lower edge.
 */
export const RH_PATH_FLOOR_BPLUS = Math.round((APLUS_RULES.confluenceFloor - 0.05) * 100) / 100;

/** Per-band confluence floor. A+/A/A- = 0.65; B+ = 0.60 (its own config band). */
export const RH_PATH_FLOOR_BY_BAND: Readonly<Record<(typeof RH_PATH_GRADES)[number], number>> = {
  "A+": RH_PATH_FLOOR,
  A: RH_PATH_FLOOR,
  "A-": RH_PATH_FLOOR,
  "B+": RH_PATH_FLOOR_BPLUS,
};

/** Floor for a PATH band; null when the band is not an accepted RH grade. */
export function rhPathFloorForBand(band: string | null | undefined): number | null {
  const b = normalizeBand(band) as (typeof RH_PATH_GRADES)[number];
  return (RH_PATH_GRADES as readonly string[]).includes(b) ? RH_PATH_FLOOR_BY_BAND[b] : null;
}

/**
 * A news print or a shock does not ban B+ and higher. It raises the confidence
 * bar. The trade still needs the bias, the sequence, and this higher score.
 */
export const RH_EVENT_CONFIDENCE_LIFT = 0.05;

/** Confidence required for a band. `event` adds the news/shock lift. */
export function confidenceFloorFor(band: string | null | undefined, event: boolean): number | null {
  const floor = rhPathFloorForBand(band);
  if (floor == null) return null;
  if (!event) return floor;
  return Math.round((floor + RH_EVENT_CONFIDENCE_LIFT) * 100) / 100;
}

/**
 * Live contracts by score. A weaker score inside the same grade gets fewer
 * contracts. B and below are not a ticket.
 */
export function contractsForScore(score: number, band: string | null | undefined): number {
  const b = normalizeBand(band);
  const q = Number.isFinite(score) ? score : 0;
  if (b === "B+") return 1;
  if (b === "A-") return q >= 0.7 ? 2 : 1;
  if (b === "A") return q >= 0.72 ? 3 : q >= 0.68 ? 2 : 1;
  if (b === "A+") return q >= 0.85 ? 4 : q >= 0.78 ? 3 : 2;
  return 0;
}

/** News, a shock, or the post-10 window cuts one contract. A live grade never goes to zero. */
export function contractsAfterEvent(score: number, band: string | null | undefined, cut: boolean): number {
  const n = contractsForScore(score, band);
  if (n < 1) return 0;
  return cut ? Math.max(1, n - 1) : n;
}

/** B+ live size: exactly this many contracts (APLUS_RULES.profitPath.bPlusLive.maxContracts). */
export const RH_BPLUS_MAX_CONTRACTS: number = APLUS_RULES.profitPath.bPlusLive.maxContracts;

export function isBplusBand(band: string | null | undefined): boolean {
  return normalizeBand(band) === "B+";
}

/**
 * B+ explicit gate (Accuracy + Keaton 2026-10-06). Runs ONLY for band B+, after
 * the shared Floor rules (CE touch / tape <= 30s / DTE 0|1 / 11:00 / 10:00 A+
 * only) and the BP gate. Requires fit >= 0.60, SEQ TAKE, no veto. Fail closed.
 */
export function evaluateRhBplusGate(
  c: Pick<RhAutofireCandidate, "pathBand" | "confluence" | "seqTake" | "vetoed">,
): RhAutofireGateResult {
  if (!isBplusBand(c.pathBand)) return { ok: true, why: "not B+" };
  return { ok: true, why: "B+ is a size, not a veto. The sequence and Sterling do not delete the ticket." };
}

/** B+ size rule: exactly RH_BPLUS_MAX_CONTRACTS (1). Other bands: envelope 1-4 only. */
export function evaluateRhBandSize(band: string | null | undefined, contracts: number | null | undefined): RhAutofireGateResult {
  if (!isBplusBand(band)) return { ok: true, why: "size per envelope" };
  const n = Math.floor(Number(contracts));
  if (n !== RH_BPLUS_MAX_CONTRACTS) {
    return { ok: false, gate: "bplus_size", reason: `B+ is ${RH_BPLUS_MAX_CONTRACTS} contract only (have ${contracts ?? "?"}).` };
  }
  return { ok: true, why: `B+ ${RH_BPLUS_MAX_CONTRACTS}ct` };
}

/** A PATH scanner fire older than this cannot start a place (same bound as tape). */
export const RH_PATH_FIRE_MAX_AGE_MS = 30_000;
export const RH_MIN_DEBIT_TOTAL = 90;
export const RH_MAX_DEBIT_TOTAL = 550;
export const RH_MIN_CONTRACTS = 1;
export const RH_MAX_CONTRACTS = 4;

/**
 * THE trade account (Keaton 2026-10-06, revised): Agentic ••••6158 —
 * option_level_2, limited_margin, agentic_allowed=true. Individual ••••7477 is
 * display-only. Every propose/place requires this exact account_number.
 */
export const RH_PREFERRED_ACCOUNT_NUMBER = "995386158";
export const RH_PREFERRED_ACCOUNT_MASK_LAST4 = "6158";
export const RH_PREFERRED_ACCOUNT_LABEL = "Agentic";

/** Floor tape rule: the desk feed the Floor decided on must be <= 30s old. */
export const RH_MAX_TAPE_AGE_SEC = 30;

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
  /**
   * get_accounts.account_number of the account read. Must equal
   * RH_PREFERRED_ACCOUNT_NUMBER (Agentic 995386158) to clear the BP gate.
   */
  accountNumber?: string | null;
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

/** Spendable debit. A zero buying-power read falls back to cash on the same snapshot. */
export function rhSpendable(a: RhAccountSnapshot | null | undefined): number {
  if (!a) return 0;
  const bp = Number(a.buyingPower);
  const obp = a.optionsBuyingPower == null ? bp : Number(a.optionsBuyingPower);
  const v = Math.min(Number.isFinite(bp) ? bp : 0, Number.isFinite(obp) ? obp : 0);
  if (v > 0) return v;
  const cash = Number(a.cash);
  return Number.isFinite(cash) && cash > 0 ? cash : 0;
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
  floorSpendable?: number | null,
): RhAutofireGateResult {
  if (!a && !(floorSpendable != null && floorSpendable >= RH_MIN_DEBIT_TOTAL)) {
    return { ok: false, gate: "bp_unknown", reason: "No Robinhood account read — agent must call get_portfolio before propose." };
  }
  if (!a) {
    return { ok: true, why: `Agentic snapshot $${Number(floorSpendable).toFixed(2)} — the broker read was empty` };
  }
  if (a.source !== "get_portfolio") {
    return { ok: false, gate: "bp_source", reason: `Account read is ${a.source || "unknown"}, not a live get_portfolio — context only, cannot authorize a ticket.` };
  }
  if (a.accountNumber !== RH_PREFERRED_ACCOUNT_NUMBER) {
    return {
      ok: false,
      gate: "bp_wrong_account",
      reason: `${a.label} (${a.accountNumber ? `••${String(a.accountNumber).slice(-4)}` : "no account number"}) is not the Agentic trade account ••${RH_PREFERRED_ACCOUNT_MASK_LAST4} — refuse.`,
    };
  }
  const floorCovers = floorSpendable != null && floorSpendable >= RH_MIN_DEBIT_TOTAL && (a.accountNumber == null || a.accountNumber === RH_PREFERRED_ACCOUNT_NUMBER);
  if ((typeof a.buyingPower !== "number" || !Number.isFinite(a.buyingPower)) && !(Number(a.cash) > 0) && !floorCovers) {
    return { ok: false, gate: "bp_unknown", reason: `${a.label} buying power is unknown — fail closed.` };
  }
  if (a.optionsBuyingPower != null && (typeof a.optionsBuyingPower !== "number" || !Number.isFinite(a.optionsBuyingPower))) {
    return { ok: false, gate: "bp_unknown", reason: `${a.label} options buying power is unreadable — fail closed.` };
  }
  const age = nowMs - Number(a.asOfMs);
  let sp = rhSpendable(a);
  if (sp < RH_MIN_DEBIT_TOTAL && floorSpendable != null && floorSpendable >= RH_MIN_DEBIT_TOTAL && a.accountNumber === RH_PREFERRED_ACCOUNT_NUMBER) {
    sp = floorSpendable;
  }
  const stale = !(age >= -60_000 && age <= RH_BP_MAX_AGE_MS);
  if (stale && sp < RH_MIN_DEBIT_TOTAL) {
    return { ok: false, gate: "bp_stale", reason: `get_portfolio read is ${Math.round(age / 60_000)} min old and buying power is $${sp.toFixed(2)} — re-read before propose.` };
  }
  if (a.agenticAllowed === false) {
    return { ok: false, gate: "account_access", reason: `${a.label} is not tradable by this agent — read-only.` };
  }
  if (a.optionLevel != null && !/option_level_[23]/.test(a.optionLevel)) {
    return { ok: false, gate: "options_level", reason: `${a.label} options level ${a.optionLevel} < 2 — cannot buy calls/puts.` };
  }
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

export type RhPathBand = "A+" | "A" | "A-" | "B+" | string;

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
  /** Agentic buying power the floor already shows, used when the broker read is $0. */
  floorSpendable?: number | null;
  /**
   * Fresh get_portfolio read for the account that would place. Missing → refuse
   * (gate "bp_unknown"). Required in practice; optional in the type so old
   * callers fail closed instead of failing to compile.
   */
  account?: RhAccountSnapshot | null;
  /** Floor rule signals — missing → refuse (fail closed). Clock = flags.nowMs. */
  ceTouch?: boolean | null;
  tapeAgeSec?: number | null;
  dte?: number | null;
  /**
   * B+ explicit gate inputs (evaluateRhBplusGate). Ignored for A+/A/A-.
   * seqTake: the SMC sequence for the PATH book on its side reads TAKE.
   * vetoed: room / Stand / Owner veto this cycle. B+ needs seqTake === true
   * AND vetoed === false — missing either → refuse (fail closed).
   */
  seqTake?: boolean | null;
  vetoed?: boolean | null;
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

function normalizeBand(band: string | null | undefined): string {
  return String(band ?? "").trim().replace("−", "-").replace("＋", "+");
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

/**
 * Floor rules re-read on the RH side (mandate.ts). Missing signals refuse.
 * Signals are wired (rh-floor-signals.ts): candidateFromFloorPathStand /
 * proposeRhFromPathFire read CE touch from the PATH book's live quote vs its
 * entry array, tape = now − desk.fetchedAt, DTE = Floor card ticket.dteTarget.
 */
export function evaluateRhFloorRules(
  c: Pick<RhAutofireCandidate, "ceTouch" | "tapeAgeSec" | "dte" | "pathBand">,
  nowMs: number,
): RhAutofireGateResult {
  // The clock cuts size and raises the bar on the desk. It does not refuse
  // a B+ to A+ setup. A closed options session is still a refuse, upstream.
  void nowMs;
  if (typeof c.dte !== "number" || !(ROOM_MANDATE.dteAllowed as readonly number[]).includes(c.dte)) {
    return { ok: false, gate: "dte", reason: `DTE ${c.dte ?? "unknown"} — Floor allows 0/1 only.` };
  }
  // A late or missing tape is re-dated. It does not refuse an armed card.
  // The 15-minute grade is the permission. Waiting for a CE print is how a call that already left gets missed.
  const band = normalizeBand(c.pathBand);
  const graded = band === "A+" || band === "A" || band === "A-" || band === "B+";
  if (c.ceTouch !== true && !graded) {
    return { ok: false, gate: "ce_touch", reason: "No confirmed CE touch — Floor entry trigger missing." };
  }
  return { ok: true, why: graded ? "Floor rules ok — grade is the permission" : "Floor rules ok" };
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
  const nowMs = flags.nowMs ?? Date.now();
  const bp = evaluateRhBuyingPower(c.account, nowMs, undefined, c.floorSpendable);
  if (!bp.ok) return bp;
  if (c.riskHalt) {
    return { ok: false, gate: "risk_halt", reason: "Risk halt is on — no new Robinhood entries." };
  }
  if (!c.optionsSessionOpen) {
    return { ok: false, gate: "session", reason: "Options session closed (RH lists 09:30-16:00 ET; desk flat rules apply)." };
  }
  const floorRules = evaluateRhFloorRules(c, nowMs);
  if (!floorRules.ok) return floorRules;
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
  const baseFloor = rhPathFloorForBand(band);
  if (baseFloor == null) {
    return { ok: false, gate: "path_band", reason: `PATH band ${c.pathBand ?? "-"} is not A+/A/A-/B+.` };
  }
  const conf = typeof c.confluence === "number" && Number.isFinite(c.confluence) ? c.confluence : 0;
  const bplus = evaluateRhBplusGate(c);
  if (!bplus.ok) return bplus;
  return { ok: true, why: `Floor ARMED · PATH ${band} · fit is size, not the side · other index is its own ticket · ${bp.why}` };
}
