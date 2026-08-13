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

/** Anthropic Messages API. */
const API_URL = "https://api.anthropic.com/v1/messages";
const API_VERSION = "2023-06-01";
const MODEL = "claude-sonnet-5";

/** Bounded output — this is a paragraph of narration, not an essay. */
const MAX_TOKENS = 700;

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
  actionableCount: z.number().int().nullable().optional(),
  blocked: z.array(z.string().max(160)).max(10).optional(),
  focus: z.string().max(300).nullable().optional(),
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
  "",
  "HARD RULES:",
  "- You NEVER give a trade signal, entry, target, stop, or size. The desk's",
  "  deterministic TypeScript scoring already decided all of that before you",
  "  were called. You explain what it computed; you do not second-guess it,",
  "  and you never tell the trader to take or skip a trade.",
  "- You never invent a number. If a number was not given to you, say it is",
  "  not in the data rather than estimating one.",
  "- You never claim to see a chart, a price feed, or anything live. You only",
  "  have the fields below.",
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

function buildUserMessage(c: z.output<typeof contextSchema>): string {
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
          messages: [{ role: "user", content: buildUserMessage(data) }],
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
