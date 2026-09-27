/**
 * The kill-rule check, run through xAI's Agent Tools web search.
 *
 * FIXED 2026-09-26 — THIS HAD NEVER RETURNED A SOURCE
 * It called /v1/chat/completions with `search_parameters` (xAI "Live
 * Search"). xAI removed Live Search on 2026-01-12; those requests return
 * HTTP 410 Gone. Every check since this file was written therefore came
 * back "xAI returned 410 … NO INFORMATION" — the refusal to present an
 * unsourced all-clear held, which is the only reason the failure was
 * harmless. It now calls /v1/responses with `tools: [{ type: "web_search" }]`
 * (https://docs.x.ai/developers/tools/web-search, checked 2026-09-26) and
 * reads sources from the output annotations and the top-level `citations`
 * (kill-watch.ts parseXaiResponse). A 410 is named if it ever recurs.
 *
 * ONE NAME PER CALL
 * The streaming edge cuts a silent function at ~30s. An agentic search runs
 * several searches before it answers, so a batch of nine could never fit;
 * the panel calls this once per name, three at a time, and each call has its
 * own budget. A check that runs out of time says NO INFORMATION.
 *
 * WHY A MODEL IS ALLOWED TO TOUCH THIS AT ALL
 * The job given to the model is not "what do you know about NVDA". It is
 * "search since this date for evidence about this one pre-written
 * condition, and return the links". The links are the output that matters;
 * the prose is a finding aid. Structurally:
 *   - no numeric field on the response — no score, no confidence;
 *   - `tripped` is never returned — a PERSON sets it after reading the
 *     sources (kill-store.ts), because it permanently removes a holding;
 *   - nothing here writes to a dossier, a position, a weight or the sweep.
 *
 * COST AND CADENCE: charged per call and per search. On demand only,
 * authenticated, weekly floor enforced by the panel via kill-watch.ts isDue.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { authMiddleware } from "@/lib/auth/middleware";
import { killQueries, parseXaiResponse, summaryFor, type KillResult } from "./kill-watch";

const XAI_RESPONSES_URL = "https://api.x.ai/v1/responses";
/**
 * The model xAI's web-search guide uses with the web_search tool
 * (https://docs.x.ai/developers/tools/web-search, checked 2026-09-26; the
 * models page lists it as the flagship). The coach's chat model (grok-4.5)
 * is left alone — this is the only caller of server-side search.
 */
const XAI_SEARCH_MODEL = "grok-4.7";
/** Small on purpose: one narrow question per name. */
const MAX_OUTPUT_TOKENS = 700;
/**
 * Agentic search turns per check (`max_turns`, documented on /v1/responses).
 * Measured 2026-09-27 on the local desk with no cap: 3 of 9 names answered
 * inside 24s, the other 6 were still searching. One question about one
 * pre-written condition does not need a long research loop.
 */
const MAX_TURNS = 2;
/**
 * Under the ~30s cut the host puts on one function call, with room for a
 * cold start. There is no background mode to escape it — xAI documents
 * `background` as unsupported — so a check that needs longer says NO
 * INFORMATION and the panel retries it once.
 */
export const CHECK_TIMEOUT_MS = 26_000;

function envKey(): string | null {
  const v = process.env.XAI_API_KEY?.trim();
  return v ? v : null;
}

const INSTRUCTIONS = [
  "You are checking ONE pre-written condition about ONE company. You are not giving investment advice,",
  "not rating the company, and not saying whether to buy or sell it.",
  "Search the web for evidence published in the window given. Report only what you found about that exact condition.",
  "If you find nothing that satisfies the condition, say 'No evidence found that this condition is satisfied.'",
  "Never infer that the condition is satisfied from a headline alone; quote what the source actually states.",
  "Prefer SEC filings, company press releases and regulator publications over commentary and analyst notes.",
  "Do not speculate about price, valuation, or what an investor should do. Keep the answer under 120 words.",
].join(" ");

function notRun(ticker: string, killRule: string, detail: string, nowIso: string): KillResult {
  return {
    ticker,
    killRule,
    summary: `Check did not run — ${detail} Treat as NO INFORMATION, not as all-clear.`,
    citations: [],
    tripped: null,
    checkedAt: nowIso,
  };
}

export interface KillCheck {
  configured: boolean;
  result: KillResult;
}

/**
 * Check one name. Authenticated because it spends money; the ticker must be
 * one of the pre-registered kill queries, so this cannot be pointed at an
 * arbitrary question.
 */
export const runKillCheck = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    z.object({
      ticker: z.string().regex(/^[A-Z][A-Z.-]{0,9}$/),
      sinceDays: z.number().int().min(1).max(90),
    }),
  )
  .handler(async ({ data }): Promise<KillCheck> => {
    const nowIso = new Date().toISOString();
    const q = killQueries(Date.now(), data.sinceDays).find((x) => x.ticker === data.ticker);
    if (!q) {
      return {
        configured: true,
        result: notRun(data.ticker, "", "no pre-written kill rule for that ticker.", nowIso),
      };
    }
    const key = envKey();
    if (!key) {
      return {
        configured: false,
        result: notRun(
          q.ticker,
          q.killRule,
          "XAI_API_KEY is not set for this deployment. The rule is still written and still checkable by hand.",
          nowIso,
        ),
      };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS);
    try {
      const res = await fetch(XAI_RESPONSES_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model: XAI_SEARCH_MODEL,
          instructions: INSTRUCTIONS,
          input: [{ role: "user", content: q.query }],
          tools: [{ type: "web_search" }],
          max_turns: MAX_TURNS,
          max_output_tokens: MAX_OUTPUT_TOKENS,
        }),
        signal: controller.signal,
      });
      if (!res.ok) {
        const detail =
          res.status === 401
            ? "xAI rejected the API key (401)."
            : res.status === 410
              ? "xAI returned 410 Gone — the search API this calls has been retired again."
              : res.status === 429
                ? "xAI rate-limited the check (429)."
                : `xAI returned ${res.status}.`;
        return { configured: true, result: notRun(q.ticker, q.killRule, detail, nowIso) };
      }
      const parsed = parseXaiResponse(await res.json());
      return {
        configured: true,
        result: {
          ticker: q.ticker,
          killRule: q.killRule,
          summary: summaryFor(parsed),
          citations: parsed.citations,
          tripped: null,
          checkedAt: nowIso,
        },
      };
    } catch (e) {
      const aborted = e instanceof Error && e.name === "AbortError";
      return {
        configured: true,
        result: notRun(
          q.ticker,
          q.killRule,
          aborted ? `the search ran past ${CHECK_TIMEOUT_MS / 1000}s.` : `request failed (${String(e).slice(0, 120)}).`,
          nowIso,
        ),
      };
    } finally {
      clearTimeout(timer);
    }
  });
