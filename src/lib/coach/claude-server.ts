/**
 * Real Claude narration over already-computed desk state.
 *
 * WHY THIS EXISTS. The desk coach panel was labelled "Grok + Claude ready"
 * and the TZ chat was labelled a "chat", but the 2026-08-12 audit found zero
 * LLM calls anywhere in the repo — no fetch to any model API, no API key
 * referenced, no SDK dependency. Both were deterministic template/regex code.
 * That code is good and stays exactly as it is; this ADDS a real model call
 * beside it, on demand.
 *
 * ── THE HOUSE RULE THIS MUST NOT BREAK ───────────────────────────────────
 * CLAUDE.md: "AI never gates a trade. Rules + structure decide; you narrate."
 *
 * Everything here is READ-ONLY NARRATION. This module:
 *   - receives desk state that has ALREADY been scored by scanner.ts,
 *   - returns prose,
 *   - and returns NOTHING that any caller feeds back into a score, a size, a
 *     gate, or an order.
 * There is deliberately no numeric field on the response type — not a score,
 * not a multiplier, not a verdict enum — precisely so a future caller cannot
 * accidentally wire model output into the trading path. If narration ever
 * needs to influence a decision, that decision belongs in deterministic
 * TypeScript (see journal/discretion.ts for how a real one is built).
 *
 * ── COST ─────────────────────────────────────────────────────────────────
 * Charged per call, so this is ON DEMAND ONLY — a button, never the 30s desk
 * poll. Authenticated (a paid endpoint must never be anonymous), rate limited
 * per user, and capped at a small max_tokens. Absent an API key it degrades
 * to `configured: false` and the UI keeps showing the deterministic coach,
 * exactly as before.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { authMiddleware } from "@/lib/auth/middleware";
import { getSql } from "@/lib/db";
import { readClosed } from "@/lib/journal/analytics-server";
import { normalizeKey } from "@/lib/journal/analytics";
import { computeDiscretion, neutralDiscretion } from "@/lib/journal/discretion";
import { backtestPriorFor } from "@/lib/journal/discretion-server";

/** Anthropic Messages API. */
const API_URL = "https://api.anthropic.com/v1/messages";
const API_VERSION = "2023-06-01";
const MODEL = "claude-sonnet-5";

/** Bounded output — this is a paragraph of narration, not an essay. */
const MAX_TOKENS = 1100;

/** Wall-clock ceiling so a hung request cannot hold a serverless invocation. */
const TIMEOUT_MS = 30_000;

/** Per-user rate limit: a thinking aid, not a polling loop. */
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 6;

/**
 * In-memory per-user call times. Resets on cold start, which is acceptable:
 * this exists to stop a stuck client from looping a paid endpoint, not to
 * meter billing. A durable counter would mean a DB write per call to guard a
 * call that already costs more than the write.
 */
const recentCalls = new Map<string, number[]>();

function rateLimited(userId: string, now: number): boolean {
  const cutoff = now - RATE_LIMIT_WINDOW_MS;
  const hits = (recentCalls.get(userId) ?? []).filter((t) => t > cutoff);
  if (hits.length >= RATE_LIMIT_MAX) {
    recentCalls.set(userId, hits);
    return true;
  }
  hits.push(now);
  recentCalls.set(userId, hits);
  // Bound the map so a long-lived instance cannot grow it without limit.
  if (recentCalls.size > 500) {
    for (const [k, v] of recentCalls) {
      if (v.every((t) => t <= cutoff)) recentCalls.delete(k);
    }
  }
  return false;
}

function apiKey(): string | null {
  const raw = process.env.ANTHROPIC_API_KEY;
  return raw && raw.trim() ? raw.trim() : null;
}

/**
 * The desk facts the narration is allowed to see. A closed, explicit shape
 * rather than the whole DeskPayload: it keeps the prompt small (cost), and
 * means adding a field to DeskPayload can never silently start shipping new
 * data to a third party.
 */
const contextSchema = z.object({
  question: z.string().max(500).optional(),
  killzone: z.string().max(60).nullable().optional(),
  sessionPhase: z.string().max(60).nullable().optional(),
  htfLeft: z.string().max(40).nullable().optional(),
  htfRight: z.string().max(40).nullable().optional(),
  newsVerdict: z.string().max(40).nullable().optional(),
  smtNote: z.string().max(300).nullable().optional(),
  dealingZone: z.string().max(40).nullable().optional(),
  bestSymbol: z.string().max(20).nullable().optional(),
  bestSide: z.string().max(10).nullable().optional(),
  bestGrade: z.string().max(10).nullable().optional(),
  bestConfluence: z.number().nullable().optional(),
  bestPresent: z.array(z.string().max(60)).max(20).optional(),
  bestMissing: z.array(z.string().max(60)).max(20).optional(),
  /**
   * A LABEL only — which strategy to look up real discretion/history for.
   * The client cannot use this to fabricate a number: the server
   * independently queries Postgres for whatever this names, same as every
   * other identifier passed to a server fn in this codebase. Worst case a
   * bad value is a wrong-strategy lookup, never a fabricated statistic.
   */
  bestStrategy: z.string().max(60).nullable().optional(),
  actionableCount: z.number().int().nullable().optional(),
  blocked: z.array(z.string().max(160)).max(10).optional(),
  focus: z.string().max(300).nullable().optional(),
  /** Full desk snapshot (claude-handoff.ts). Bounded so cost stays finite. */
  snapshot: z.string().max(8000).optional(),
});

export type CoachContext = z.input<typeof contextSchema>;

export interface CoachNarration {
  /** False when ANTHROPIC_API_KEY is unset — UI keeps the deterministic coach. */
  configured: boolean;
  /** Prose. Deliberately the ONLY payload — no score, no verdict, no size. */
  text: string | null;
  /** Present when the call could not be made or failed. Safe to render. */
  error: string | null;
  model: string | null;
}

/**
 * The contract with the model, stated to the model. This mirrors CLAUDE.md
 * rather than restating it loosely: the desk's own rules are the spec.
 */
const SYSTEM_PROMPT = [
  "You are a desk assistant inside a private ICT/SMC futures trading desk (MNQ/ES).",
  "Follow CLAUDE.md: floor 0.65, A+/A/A- only, one book, Judas 9:30-9:45 ET stand,",
  "RR >= 1, HTF absolute, mechanical+SMT/TJR primary, Yahoo ~10m lag.",
  "",
  "HARD RULES FOR THIS ENDPOINT:",
  "- You NEVER give a trade signal, entry, target, stop, or size. The desk's",
  "  deterministic TypeScript scoring already decided all of that before you",
  "  were called. You explain what it computed; you do not second-guess it,",
  "  and you never tell the trader to take or skip a trade.",
  "- You never invent a number. If a number was not given to you, say it is",
  "  not in the data rather than estimating one.",
  "- You never claim to see a live chart beyond the snapshot fields.",
  "- If a LEDGER DESK HANDOFF snapshot is present, that is the full desk.",
  "",
  "WHAT YOU ARE FOR: making the already-computed state legible — which",
  "confluences are present versus missing and what that implies about setup",
  "quality, how the HTF bias and the killzone interact, what would have to",
  "change for a B-grade setup to become A-grade, and what the trader should",
  "be watching next.",
  "",
  "STYLE: an experienced desk colleague. Concrete and specific to the numbers",
  "given. 150 words or less unless asked a direct question that needs more.",
  "No preamble, no disclaimers, no bullet-point padding. If the honest answer",
  "is 'nothing is set up, stand down', say exactly that in one line.",
].join("\n");

/**
 * The other half of the loop: MNQ/ES -> HTF bias -> confluence scanner ->
 * risk governor -> [you are here] -> journal + analytics + memory +
 * discretion -> back to the next read.
 *
 * Without this, the coach only ever saw the current bar — it could describe
 * today's structure but had no way to say "you're on a 3-loss streak, this
 * is exactly the pattern that's cost you before" or "blake_mech is real-data
 * demoted, that's the same model this setup wants to use." Those are the
 * two sentences a desk coach exists to say, and they require the journal.
 *
 * Fetched SERVER-SIDE from Postgres, never trusted from the client — the
 * client only names WHICH strategy to look up (bestStrategy), it cannot
 * supply the numbers themselves. Live and paper stay reported separately,
 * same discipline as analytics.ts and journal/discretion.ts everywhere else
 * in this app: "LIVE AND PAPER ARE NEVER MIXED."
 */
interface LoopContext {
  liveN: number;
  liveWinRate: number | null;
  liveSumR: number | null;
  liveStreak: string | null;
  paperN: number;
  paperWinRate: number | null;
  paperSumR: number | null;
  discretionLine: string | null;
}

const RECENT_WINDOW = 30;

function recentStats(
  closed: { pnl: number; r: number; closed: string }[],
): { n: number; winRate: number | null; sumR: number | null } {
  const window = [...closed]
    .sort((a, b) => new Date(b.closed).getTime() - new Date(a.closed).getTime())
    .slice(0, RECENT_WINDOW);
  if (!window.length) return { n: 0, winRate: null, sumR: null };
  const wins = window.filter((t) => t.pnl > 0).length;
  const withR = window.filter((t) => Number.isFinite(t.r));
  return {
    n: window.length,
    winRate: wins / window.length,
    sumR: withR.length ? withR.reduce((a, t) => a + t.r, 0) : null,
  };
}

function lossStreak(closed: { pnl: number; closed: string }[]): number {
  const byRecent = [...closed].sort(
    (a, b) => new Date(b.closed).getTime() - new Date(a.closed).getTime(),
  );
  let n = 0;
  for (const t of byRecent) {
    if (t.pnl > 0) break;
    n += 1;
  }
  return n;
}

async function buildLoopContext(
  userId: string,
  strategy: string | null | undefined,
): Promise<LoopContext> {
  const sql = await getSql();
  const [live, paper] = await Promise.all([
    readClosed(sql, userId, "live", null),
    readClosed(sql, userId, "paper", null),
  ]);

  const liveStats = recentStats(live);
  const paperStats = recentStats(paper);
  const streak = lossStreak(live);

  let discretionLine: string | null = null;
  const key = normalizeKey(strategy ?? null);
  if (key) {
    const liveForStrat = live.filter((t) => normalizeKey(t.strategy) === key);
    const paperForStrat = paper.filter((t) => normalizeKey(t.strategy) === key);
    const result =
      liveForStrat.length || paperForStrat.length
        ? computeDiscretion(key, liveForStrat, paperForStrat, backtestPriorFor(key))
        : neutralDiscretion(key);
    discretionLine = result.reason;
  }

  return {
    liveN: liveStats.n,
    liveWinRate: liveStats.winRate,
    liveSumR: liveStats.sumR,
    liveStreak: streak >= 2 ? `${streak} consecutive live losses` : null,
    paperN: paperStats.n,
    paperWinRate: paperStats.winRate,
    paperSumR: paperStats.sumR,
    discretionLine,
  };
}

function buildUserMessage(
  c: z.output<typeof contextSchema>,
  loop: LoopContext,
): string {
  const lines: string[] = ["Current desk state:"];
  const add = (label: string, v: unknown) => {
    if (v == null || v === "" || (Array.isArray(v) && v.length === 0)) return;
    lines.push(`- ${label}: ${Array.isArray(v) ? v.join(", ") : String(v)}`);
  };
  add("Killzone", c.killzone);
  add("Session phase", c.sessionPhase);
  add("HTF bias (left book)", c.htfLeft);
  add("HTF bias (right book)", c.htfRight);
  add("News", c.newsVerdict);
  add("SMT", c.smtNote);
  add("Dealing range zone", c.dealingZone);
  add("Best candidate", [c.bestSymbol, c.bestSide, c.bestGrade].filter(Boolean).join(" "));
  add("Best candidate confluence score", c.bestConfluence);
  add("Confluences PRESENT", c.bestPresent);
  add("Confluences MISSING", c.bestMissing);
  add("Actionable candidates", c.actionableCount);
  add("Blocked by", c.blocked);
  add("Desk focus line", c.focus);

  if (c.snapshot) {
    lines.push("", "Full desk snapshot (authoritative for this call):");
    lines.push(c.snapshot);
  }

  lines.push("");
  lines.push("Journal — real Postgres history, trailing 30 closes, LIVE and PAPER kept separate:");
  add(
    "  Live",
    loop.liveN
      ? `n=${loop.liveN} · WR ${loop.liveWinRate != null ? (loop.liveWinRate * 100).toFixed(0) + "%" : "—"} · sumR ${loop.liveSumR != null ? loop.liveSumR.toFixed(2) : "—"}`
      : "no closed live trades yet",
  );
  add(
    "  Paper",
    loop.paperN
      ? `n=${loop.paperN} · WR ${loop.paperWinRate != null ? (loop.paperWinRate * 100).toFixed(0) + "%" : "—"} · sumR ${loop.paperSumR != null ? loop.paperSumR.toFixed(2) : "—"}`
      : "no closed paper trades yet",
  );
  add("  Streak", loop.liveStreak);
  add("  Discretion for this candidate's strategy", loop.discretionLine);

  lines.push("");
  lines.push(
    c.question
      ? `The trader asks: ${c.question}`
      : "Explain this state and what to watch next.",
  );
  return lines.join("\n");
}

export const askDeskCoach = createServerFn({ method: "POST" })
  .validator((input: unknown) => contextSchema.parse(input ?? {}))
  .middleware([authMiddleware])
  .handler(async ({ data, context }): Promise<CoachNarration> => {
    const key = apiKey();
    if (!key) {
      return {
        configured: false,
        text: null,
        error:
          "ANTHROPIC_API_KEY is not set on this deployment — the deterministic coach above still works. Add the key in Netlify → Site settings → Environment variables to enable narration.",
        model: null,
      };
    }

    if (rateLimited(context.userId, Date.now())) {
      return {
        configured: true,
        text: null,
        error: `Rate limit: ${RATE_LIMIT_MAX} narrations per minute. This endpoint costs money per call.`,
        model: MODEL,
      };
    }

    // Real journal/analytics/discretion state — the loop's own memory, not
    // client-supplied. A DB hiccup degrades to an empty loop context rather
    // than blocking narration entirely: the coach still has current-bar
    // structure to talk about even without history.
    const loop = await buildLoopContext(context.userId, data.bestStrategy).catch(
      (): LoopContext => ({
        liveN: 0,
        liveWinRate: null,
        liveSumR: null,
        liveStreak: null,
        paperN: 0,
        paperWinRate: null,
        paperSumR: null,
        discretionLine: null,
      }),
    );

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(API_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": key,
          "anthropic-version": API_VERSION,
        },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: MAX_TOKENS,
          system: SYSTEM_PROMPT,
          messages: [{ role: "user", content: buildUserMessage(data, loop) }],
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        // Log detail server-side; return a generic, non-leaking message.
        const detail = await res.text().catch(() => "");
        console.error(`[coach] Anthropic ${res.status}:`, detail.slice(0, 500));
        return {
          configured: true,
          text: null,
          error:
            res.status === 401
              ? "Anthropic rejected the API key (401). Check ANTHROPIC_API_KEY."
              : res.status === 429
                ? "Anthropic rate limit or quota reached (429). Try again shortly."
                : `Narration failed (HTTP ${res.status}).`,
          model: MODEL,
        };
      }

      const json = (await res.json()) as {
        content?: { type: string; text?: string }[];
      };
      const text = (json.content ?? [])
        .filter((b) => b.type === "text" && b.text)
        .map((b) => b.text)
        .join("\n")
        .trim();

      return {
        configured: true,
        text: text || null,
        error: text ? null : "Model returned no text.",
        model: MODEL,
      };
    } catch (err) {
      const aborted = err instanceof Error && err.name === "AbortError";
      console.error("[coach] narration failed:", err);
      return {
        configured: true,
        text: null,
        error: aborted
          ? `Narration timed out after ${TIMEOUT_MS / 1000}s.`
          : "Narration failed — network or service error.",
        model: MODEL,
      };
    } finally {
      clearTimeout(timer);
    }
  });
