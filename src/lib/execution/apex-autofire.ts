/**
 * ROADMAP addendum, 2026-08-14 — Apex evaluation-phase AUTOMATIC execution.
 *
 * "Automatic trades if they are in the 85+ range" — this is the one file that
 * turns a scanner candidate into a live order with NO human click in between.
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
 *   1. apexAccountPhase() === "evaluation" — Apex's OWN rule: full automation
 *      is banned on a FUNDED account, explicitly permitted during eval. This
 *      is a legal/contractual gate, not a risk preference, and "funded" or
 *      "none" (unset) both refuse categorically. See execution-gate.ts.
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
 *   5. openTrade() — the SAME function LogSetupDialog calls for a manual
 *      live log. This is deliberate, not a shortcut: it re-runs the halt
 *      checks (daily/weekly/killzone-cap) AND pathTakeGate (month cap,
 *      loss-streak cooldown, blake_mech demotion, one-book-per-day) exactly
 *      as a human click would. Autofire does not get an easier gate than a
 *      person — it goes through the identical one. Only a successful
 *      journal entry proceeds to the broker.
 *   6. placeTradovateOrderAllAccounts() — the multi-account fan-out built in
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

/** The number the owner asked for. Stricter than the generic A+ line (0.75). */
export const AUTOFIRE_CONFLUENCE_FLOOR = 0.85;

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

/**
 * Gates 1–4, extracted as a PURE function deliberately: no I/O, no Postgres,
 * no Tradovate, no `createServerFn`/auth middleware — so this can be (and
 * is, in `apex-autofire.gates.verify.mjs`) exercised directly against every
 * phase/switch/actionable/confluence combination without needing a live
 * request context. This is the single most safety-critical property of the
 * whole feature — an account gets terminated if it fires on a funded
 * account — so it has to be provable in complete isolation from the rest of
 * the send path, not just exercised incidentally through an integration
 * test that happens to also cover it.
 *
 * `phase`/`enabled` are passed in rather than read internally so the same
 * function can be driven by a test harness without mutating `process.env`
 * mid-process (env reads are cached by nothing here, but keeping this pure
 * removes even the possibility of a test/prod env-timing bug).
 */
export function evaluateAutofireGates(
  candidate: Pick<SetupCandidate, "actionable" | "confluence">,
  phase: ApexAccountPhase,
  enabled: boolean,
): { ok: true } | { ok: false; reason: string } {
  if (phase !== "evaluation") {
    return {
      ok: false,
      reason:
        `Apex account phase is "${phase}", not "evaluation" — automation refuses categorically ` +
        `(full automation is banned on a funded Apex account; "none" means APEX_ACCOUNT_PHASE ` +
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
  return { ok: true };
}

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

    // Gates 1–4 — see evaluateAutofireGates' own docs for why this is a
    // separately-defined pure function rather than inlined here.
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

    // Gate 5 — the SAME journal gate a human click hits: halts (daily/
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

    // Gate 6 — multi-account fan-out, each account independently checked
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
