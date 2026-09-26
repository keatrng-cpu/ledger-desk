/**
 * ROADMAP addendum, 2026-08-14 — Apex evaluation-phase AUTOMATIC execution.
 *
 * *** 2026-09-25: REFUSES IN EVERY PHASE, BY APEX'S OWN RULE. ***
 *
 * This path was built on the reading that Apex bans automation on a funded
 * account but explicitly permits it during the evaluation. That reading is
 * superseded: Apex's current Prohibited Activities text says automation is
 * strictly prohibited on ALL account types, evaluations included, and names
 * hands-off / set-and-forget trading specifically. The only permission in
 * Apex's own text is a PA compliance article allowing semi-automated tools
 * the trader actively monitors that assist order placement (ATM brackets).
 * So the only mode this desk treats as compliant is semi-automatic — the
 * trader clicks every entry; tools may pre-stage or manage the bracket.
 *
 * The gates now live in `autofire-gates.ts` (pure, importable without
 * booting the database) and end in a policy gate that refuses every call
 * that would otherwise have fired, until Apex support confirms otherwise IN
 * WRITING and `APEX_AUTOMATION_CONFIRMED_IN_WRITING` is changed in a commit
 * that quotes it. scripts/verify-autofire-gates.mjs pins that refusal. The
 * rest of this file is left intact so the send path is not rebuilt from
 * memory if that confirmation ever arrives — but today no call reaches it.
 *
 * "Automatic trades if they are in the 85+ range" — this is the one file that
 * would turn a scanner candidate into a live order with NO human click in between.
 * Everything else in this repo (paper-manager, LogSetupDialog, even the
 * manual `placeTradovateOrder`) waits for a person. This does not. That is
 * exactly why it carries more gates than anything else in the execution/
 * folder, and why every gate is re-checked on every single call rather than
 * cached — a poll loop calls this every ~30s, and each of those calls must
 * independently re-earn the right to send.
 *
 * THIS MUST STAY A SERVER FUNCTION, NOT A PLAIN EXPORTED HELPER. The two
 * hard gates below (`apexAccountPhase()`, the autofire switch) read
 * `process.env`, which does not exist in the browser bundle. If this logic
 * were called directly from index.tsx's client-side poll loop instead of
 * through `createServerFn`, `process.env.APEX_ACCOUNT_PHASE` would silently
 * read `undefined` in the browser and this would ALWAYS resolve phase as
 * "none" — which happens to fail closed (autofire never fires), but for the
 * wrong reason, and a future refactor could get that "accidentally safe"
 * property wrong. Running server-side is not an optimization here, it is
 * the only way the phase-lock means anything.
 *
 * GATE ORDER (cheapest / least reversible first — no reason to touch
 * Postgres or Tradovate for a candidate that was never going to fire):
 *   1. apexAccountPhase() === "evaluation" — a legal/contractual gate, not a
 *      risk preference: "funded" or "none" (unset) refuse categorically. It
 *      was written as the phase where automation was allowed; under Apex's
 *      current text no phase is, so it now only keeps those two refusing
 *      first with their own reason. See execution-gate.ts.
 *   2. TRADOVATE_AUTOFIRE_ENABLED=true — separate from TRADOVATE_ENABLED
 *      (which only permits manual sends) and separate from
 *      TRADOVATE_LIVE_ARMED (which only permits the live host over demo).
 *      Three independent switches; autofire needs all three, plus this one.
 *   3. candidate.actionable === true — every existing deterministic gate
 *      (HTF, killzone, structure, conditions) already passed. Autofire adds
 *      NO new trade logic; it only decides whether an ALREADY-qualified
 *      candidate gets sent without a click.
 *   4. candidate.confluence >= AUTOFIRE_CONFLUENCE_FLOOR (0.85) — the number
 *      the owner asked for, stricter than the generic A+ threshold (0.75).
 *   5. APEX POLICY — Apex prohibits automation on all account types, so this
 *      refuses every call that clears 1–4, until Apex support confirms
 *      otherwise in writing (`APEX_AUTOMATION_CONFIRMED_IN_WRITING`). Gates
 *      1–5 are `evaluateAutofireGates` in autofire-gates.ts.
 *   6. openTrade() — the SAME function LogSetupDialog calls for a manual
 *      live log. This is deliberate, not a shortcut: it re-runs the halt
 *      checks (daily/weekly/killzone-cap) AND pathTakeGate (month cap,
 *      loss-streak cooldown, blake_mech demotion, one-book-per-day) exactly
 *      as a human click would. Autofire does not get an easier gate than a
 *      person — it goes through the identical one. Only a successful
 *      journal entry proceeds to the broker.
 *   7. placeTradovateOrderAllAccounts() — the multi-account fan-out built in
 *      tradovate-orders.ts, with its own independent per-account Apex
 *      trailing-drawdown check (execution-gate.ts's apexAccountRisk).
 *
 * A refusal at any step returns a reason and sends nothing — this function
 * refuses far more often than it fires, by design, same as every other send
 * path in this folder.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { authMiddleware } from "@/lib/auth/middleware";
import { apexAccountPhase, executionEnv, type ApexAccountPhase } from "./execution-gate";
import { buildOrderIntent, newClientOrderId } from "./order-intent";
import { placeTradovateOrderAllAccounts, type FanOutAccountResult } from "./tradovate-orders";
import { buildPaperLevels } from "@/lib/trading/paper-manager";
import { openTrade, type JournalTrade } from "@/lib/journal/server";
import type { SetupCandidate } from "@/lib/trading/scanner";
import { AUTOFIRE_CONFLUENCE_FLOOR, evaluateAutofireGates } from "./autofire-gates";

// Re-exported so existing importers (index.tsx reads the floor for its cheap
// client-side pre-filter) keep one import site. The definitions live in
// autofire-gates.ts — one copy, the one the verifier pins.
export { AUTOFIRE_CONFLUENCE_FLOOR, evaluateAutofireGates };

function boolEnv(name: string): boolean {
  const v = typeof process !== "undefined" ? process.env[name] : undefined;
  return (v ?? "").trim().toLowerCase() === "true";
}

/** TRADOVATE_AUTOFIRE_ENABLED — deliberately separate from TRADOVATE_ENABLED. */
export function autofireEnabled(): boolean {
  return boolEnv("TRADOVATE_AUTOFIRE_ENABLED");
}

export interface AutofireResult {
  fired: boolean;
  /** Human-readable — safe to render or log. Always present. */
  reason: string;
  phase: ApexAccountPhase;
  candidateId: string | null;
  trade: JournalTrade | null;
  broker: { env: string; results: FanOutAccountResult[]; blockedReason: string | null } | null;
}

function refuse(
  reason: string,
  extra: { phase?: ApexAccountPhase; candidateId?: string | null } = {},
): AutofireResult {
  return {
    fired: false,
    reason,
    phase: extra.phase ?? apexAccountPhase(),
    candidateId: extra.candidateId ?? null,
    trade: null,
    broker: null,
  };
}

/*
 * Gates 1–5 — `evaluateAutofireGates` — live in autofire-gates.ts, a module
 * with no runtime imports, so scripts/verify-autofire-gates.mjs can exercise
 * every phase/switch/actionable/confluence combination without booting the
 * database this file's imports pull in. See that file for why the last gate
 * refuses every call that clears the first four.
 */

const autofireInput = z.object({
  /**
   * The full SetupCandidate from the SAME server-computed desk payload this
   * poll already holds — not user-entered. `buildPaperLevels` and `openTrade`
   * each independently validate the concrete numbers they derive from it
   * (entry/stop geometry, symbol resolution), so a malformed candidate still
   * cannot reach the broker; it just fails one of those checks instead of
   * this one.
   */
  candidate: z.record(z.string(), z.unknown()),
  equity: z.number().finite().positive(),
  killzone: z.string().max(64).nullish(),
  /** Last traded price for this candidate's symbol, for entry-near-market logic (matches recordArmedShadow). */
  lastPrice: z.number().finite().positive().nullish(),
});

/**
 * Attempt to autofire ONE candidate. Called from index.tsx's existing poll
 * loop, once per poll, on the same best-actionable candidate
 * `recordArmedShadow`/`raiseDeskAlerts` already look at — this does not scan
 * independently, it rides the same 30s tick.
 */
export const tryApexAutofire = createServerFn({ method: "POST" })
  .validator((input: unknown) => autofireInput.parse(input))
  .middleware([authMiddleware])
  .handler(async ({ data }): Promise<AutofireResult> => {
    // No `context` needed here: `openTrade`/`placeTradovateOrderAllAccounts`
    // each carry their own `authMiddleware` and re-derive `context.userId`
    // independently when called below — this handler never touches
    // per-user data directly.
    const candidate = data.candidate as unknown as SetupCandidate;
    const candidateId = typeof candidate.id === "string" ? candidate.id : null;

    // Gates 1–5 — see autofire-gates.ts for why this is a separately-defined
    // pure function rather than inlined here, and why gate 5 (Apex's own
    // prohibition on automation, every account type) refuses every call that
    // clears the first four. Nothing below this block runs today.
    const phase = apexAccountPhase();
    const gates = evaluateAutofireGates(candidate, phase, autofireEnabled());
    if (!gates.ok) {
      return refuse(gates.reason, { phase, candidateId });
    }

    // Geometry — same builder the manual LogSetupDialog prefill and the
    // shadow recorder use. No second implementation of entry/stop/target math.
    const levels = buildPaperLevels(candidate, data.equity, data.lastPrice ?? undefined);
    if (!levels.entry || !levels.stop) {
      return refuse("Could not derive valid entry/stop geometry from this candidate.", {
        phase,
        candidateId,
      });
    }

    const strategy = candidate.completeStrategy || candidate.strategyPrimary || "unknown";

    // Gate 6 — the SAME journal gate a human click hits: halts (daily/
    // weekly/killzone-cap) AND pathTakeGate (month cap, loss-streak
    // cooldown, blake_mech demotion, one-book-per-day). Autofire earns
    // nothing a manual click wouldn't have to earn too.
    let trade: JournalTrade;
    try {
      trade = await openTrade({
        data: {
          symbol: levels.symbol,
          side: levels.side,
          entry: levels.entry,
          stop: levels.stop,
          target: levels.tp1,
          contracts: levels.contracts,
          mode: "live",
          source: "desk",
          prescore: candidate.confluence,
          grade: candidate.grade,
          killzone: data.killzone ?? undefined,
          componentsPresent: candidate.components ?? candidate.reasons,
          componentsMissing: candidate.missing,
          strategyPrimary: candidate.strategyPrimary,
          pathBand: candidate.pathBand,
          regime: candidate.regime,
          htfOk: candidate.htfOk,
          actionable: candidate.actionable,
          reason: [
            candidate.title,
            strategy ? `strategy:${strategy}` : null,
            "mode:live",
            "source:apex-autofire",
          ]
            .filter(Boolean)
            .join(" · "),
        },
      });
    } catch (e) {
      return refuse(
        `Journal gate refused: ${e instanceof Error ? e.message : "unknown error"}`,
        { phase, candidateId },
      );
    }

    // Journal accepted -> halts + pathTakeGate passed. Build the broker
    // ticket from the JOURNAL ROW's own numbers (not the pre-gate levels) so
    // the order sent is provably the same decision that was just recorded.
    let intent;
    try {
      intent = buildOrderIntent({
        symbol: trade.symbol,
        side: trade.side,
        entry: trade.entry,
        stop: trade.stop ?? levels.stop,
        qty: trade.contracts,
        targets: trade.target != null ? [trade.target] : [levels.tp1, levels.tp2],
        entryType: "limit",
        clientOrderId: newClientOrderId(`autofire-${trade.id}`),
        equity: data.equity,
        context: {
          displaySymbol: candidate.symbol,
          grade: trade.grade,
          score: trade.prescore,
          strategy,
          killzone: data.killzone ?? null,
          note: `apex-autofire · journal:${trade.id}`,
        },
      });
    } catch (e) {
      // Journal entry exists but no order can be built — surface plainly
      // rather than silently leave a journal row with nothing sent.
      return {
        fired: false,
        reason: `Journal entry ${trade.id} recorded, but order build failed: ${e instanceof Error ? e.message : "unknown error"} — no broker send attempted.`,
        phase,
        candidateId,
        trade,
        broker: null,
      };
    }

    // Gate 7 — multi-account fan-out, each account independently checked
    // against its own Apex trailing-drawdown breaker.
    const broker = await placeTradovateOrderAllAccounts({
      data: { intent, expectEnv: executionEnv() },
    });

    const sentCount = broker.results.filter((r) => r.sent).length;
    return {
      fired: true,
      reason: broker.blockedReason
        ? `Journal entry ${trade.id} recorded; broker fan-out blocked: ${broker.blockedReason}`
        : `Journal entry ${trade.id} recorded; sent to ${sentCount}/${broker.results.length} Apex accounts.`,
      phase,
      candidateId,
      trade,
      broker,
    };
  });
