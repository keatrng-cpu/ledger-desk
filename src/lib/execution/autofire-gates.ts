/**
 * Apex autofire — the PURE gates, in a module that imports nothing with a
 * side effect.
 *
 * WHY THIS IS ITS OWN FILE. `evaluateAutofireGates` was always documented as
 * "extracted as a PURE function deliberately ... so this can be exercised
 * directly against every phase/switch/actionable/confluence combination",
 * and its header named a verifier that would do so. The function was pure;
 * its MODULE was not. `apex-autofire.ts` imports execution-gate.ts, which
 * imports `@/lib/db`, and db.ts starts a PGLite bootstrap the moment it loads
 * in Node — so importing the gate from a verifier boots a database and dies
 * on the unhandled rejection. The named verifier never existed, and could not
 * have. Moving the gates here, next to nothing but `import type`, is what
 * makes the claim true: scripts/verify-autofire-gates.mjs now pins every
 * branch, including the one below that matters most.
 *
 * *** 2026-09-25: AUTOFIRE REFUSES IN EVERY PHASE. ***
 *
 * The original design (2026-08-14) rested on one reading of Apex's rules:
 * automation banned on a funded Performance Account, "explicitly permitted"
 * during the evaluation. Apex's current Prohibited Activities page does not
 * say that. It says "the use of automation is strictly prohibited on all
 * account types" and singles out hands-off, set-and-forget trading. The only
 * permission Apex's own text gives is narrower and lives in a PA compliance
 * article: semi-automated tools, actively monitored by the trader, that
 * ASSIST order placement (ATM brackets are its example). propfirm/rules.ts
 * had already recorded on 2026-08-15 that the prohibition carries no
 * evaluation carve-out; this file is where the send path finally agrees.
 *
 * So the gates below end in a POLICY gate that refuses whenever every other
 * gate has passed — the exact case that used to fire. Nothing else changed in
 * behaviour: the env var names, their defaults and the order of the earlier
 * refusals are as they were, so a configuration that refused yesterday
 * refuses today at the same gate, and the one that would have sent an order
 * now refuses with the reason Apex gives. The only other edit is to the phase
 * refusal's WORDING, which used to say automation was banned on a funded
 * account — true, but it read as though the evaluation were exempt.
 */

import type { SetupCandidate } from "@/lib/trading/scanner";
import type { ApexAccountPhase } from "./execution-gate";

/** The number the owner asked for. Stricter than the generic A+ line (0.75). */
export const AUTOFIRE_CONFLUENCE_FLOOR = 0.85;

/**
 * Has Apex support confirmed IN WRITING that this desk's autofire is
 * permitted on the account it would trade?
 *
 * A code constant, deliberately NOT an environment variable. An env toggle is
 * exactly the switch that gets flipped from a hosting dashboard at 09:31 with
 * no paper trail; a constant can only change in a commit, and the commit is
 * where the written confirmation (ticket or email reference, date, and the
 * account types it covers) has to be quoted. scripts/verify-autofire-gates.mjs
 * pins it to false, so flipping it also means changing the verifier on
 * purpose rather than by accident.
 */
export const APEX_AUTOMATION_CONFIRMED_IN_WRITING = false;

/**
 * The refusal, worded once. The Lab tab's Apex panel prints this same string
 * as its automation note, so the page and the send path cannot drift apart.
 */
export const APEX_AUTOMATION_PROHIBITED_REASON =
  'Apex\'s current Prohibited Activities text says "the use of automation is strictly prohibited on all account types" — ' +
  "evaluations included; hands-off, set-and-forget trading is named specifically. Autofire stays disabled until Apex " +
  "support confirms otherwise in writing. The only mode treated as compliant is semi-automatic: the trader clicks every " +
  "entry, and tools may only pre-stage or manage the bracket (ATM-style).";

/**
 * Gates 1–5, as a PURE function: no I/O, no Postgres, no Tradovate, no
 * `createServerFn`/auth middleware — so it can be (and is, in
 * scripts/verify-autofire-gates.mjs) exercised directly against every
 * phase/switch/actionable/confluence combination without a live request
 * context. This is the single most safety-critical property of the whole
 * feature — an account gets terminated for a rules violation, not just for a
 * loss — so it has to be provable in isolation from the rest of the send path.
 *
 * `phase`/`enabled` are passed in rather than read internally so the same
 * function can be driven by a test harness without mutating `process.env`
 * mid-process.
 */
export function evaluateAutofireGates(
  candidate: Pick<SetupCandidate, "actionable" | "confluence">,
  phase: ApexAccountPhase,
  enabled: boolean,
): { ok: true } | { ok: false; reason: string } {
  // Gate 1 — the phase. Written when the evaluation was believed to be the
  // one phase where automation was allowed; it no longer grants anything
  // (gate 5 refuses every phase), but funded and unset keep refusing here,
  // first, with their own reason.
  if (phase !== "evaluation") {
    return {
      ok: false,
      reason:
        `Apex account phase is "${phase}", not "evaluation" — automation refuses categorically ` +
        `(Apex prohibits automation on every account type, funded included; "none" means APEX_ACCOUNT_PHASE ` +
        `was never set, which must never be read as permission).`,
    };
  }
  if (!enabled) {
    return { ok: false, reason: "TRADOVATE_AUTOFIRE_ENABLED is not true." };
  }
  if (candidate.actionable !== true) {
    return {
      ok: false,
      reason: "Candidate is not actionable — a deterministic gate (HTF/killzone/structure/conditions) is unmet.",
    };
  }
  const confluence = typeof candidate.confluence === "number" ? candidate.confluence : 0;
  if (confluence < AUTOFIRE_CONFLUENCE_FLOOR) {
    return {
      ok: false,
      reason: `Confluence ${confluence.toFixed(2)} < autofire floor ${AUTOFIRE_CONFLUENCE_FLOOR.toFixed(2)}.`,
    };
  }
  // Gate 5 — Apex's own rule. Reached only when every gate above passed,
  // which is precisely the configuration that used to send a live order with
  // no human click.
  if (!APEX_AUTOMATION_CONFIRMED_IN_WRITING) {
    return { ok: false, reason: APEX_AUTOMATION_PROHIBITED_REASON };
  }
  return { ok: true };
}
