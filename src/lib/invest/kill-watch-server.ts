/**
 * The kill-rule check, run through xAI Live Search.
 *
 * WHY A MODEL IS ALLOWED TO TOUCH THIS AT ALL
 * The desk's standing rule is that the coach narrates and never gates, and
 * the account rule is stricter still: never use a model where an exact
 * answer is fetchable. Both hold here, and this file is built so that they
 * keep holding even if someone later forgets them.
 *
 * The job given to the model is NOT "what do you know about NVDA". It is
 * "search the web since this date for evidence about this one pre-written
 * condition, and return the links". xAI's `web_search` tool returns
 * citations; the citations are the output that matters. The prose is a
 * finding aid for them. If the model returned no citations, this treats the
 * result as no information rather than as reassurance — an unsourced "all
 * clear" is the single most dangerous thing a monitoring tool can say, so
 * it is refused explicitly.
 *
 * WHAT IT STRUCTURALLY CANNOT DO
 *   - There is no numeric field on the response. No score, no confidence, no
 *     weight. Same discipline as claude-server.ts, same reason: a caller
 *     cannot accidentally wire it into a decision that does not exist.
 *   - `tripped` is not returned. Whether a kill rule fired is a human
 *     judgement made after opening the sources, because it permanently
 *     removes a holding.
 *   - It writes to no dossier, no position, no weight, and never to the
 *     sweep.
 *
 * COST AND CADENCE
 * Charged per call and per search. On demand only, authenticated, weekly
 * floor enforced by kill-watch.ts, and capped at a handful of results per
 * name. Never in a poll loop.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { authMiddleware } from "@/lib/auth/middleware";
import { killQueries, type Citation, type KillResult } from "./kill-watch";

const GROK_API_URL = "https://api.x.ai/v1/chat/completions";
const GROK_MODEL = "grok-4.5";
/** Small on purpose: this asks one narrow question per name. */
const MAX_TOKENS = 400;
const MAX_SEARCH_RESULTS = 6;

function envKey(): string | null {
  const v = process.env.XAI_API_KEY?.trim();
  return v ? v : null;
}

const SYSTEM = [
  "You are checking ONE pre-written condition about ONE company. You are not giving investment advice,",
  "not rating the company, and not saying whether to buy or sell it.",
  "Search for evidence published in the window given. Report only what you found about that exact condition.",
  "If you find nothing that satisfies the condition, say 'No evidence found that this condition is satisfied.'",
  "Never infer that the condition is satisfied from a headline alone; quote what the source actually states.",
  "Prefer SEC filings, company press releases and regulator publications over commentary and analyst notes.",
  "Do not speculate about price, valuation, or what an investor should do.",
].join(" ");

interface GrokResponse {
  choices?: { message?: { content?: string } }[];
  citations?: string[];
}

async function checkOne(
  key: string,
  q: ReturnType<typeof killQueries>[number],
  nowIso: string,
): Promise<KillResult> {
  const body = {
    model: GROK_MODEL,
    max_tokens: MAX_TOKENS,
    messages: [
      { role: "system", content: SYSTEM },
      { role: "user", content: q.query },
    ],
    search_parameters: {
      mode: "on",
      return_citations: true,
      max_search_results: MAX_SEARCH_RESULTS,
      from_date: q.fromDate,
      sources: [{ type: "web" }, { type: "news" }],
    },
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS);
  try {
    const res = await fetch(GROK_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      const detail = res.status === 401 ? "xAI rejected the API key (401)." : `xAI returned ${res.status}.`;
      return {
        ticker: q.ticker,
        killRule: q.killRule,
        summary: `Check did not run — ${detail} Treat as NO INFORMATION, not as all-clear.`,
        citations: [],
        tripped: null,
        checkedAt: nowIso,
      };
    }
    const json = (await res.json()) as GrokResponse;
    const text = json.choices?.[0]?.message?.content?.trim() ?? "";
    const citations: Citation[] = (json.citations ?? [])
      .filter((u): u is string => typeof u === "string" && /^https?:\/\//.test(u))
      .slice(0, MAX_SEARCH_RESULTS)
      .map((url) => ({ url, title: null }));

    // An unsourced all-clear is worse than no answer: it reads as safety
    // while resting on nothing. Refuse to present it as one.
    const summary = citations.length
      ? text || "(no prose returned — read the sources directly)"
      : `No sources returned. Treat as NO INFORMATION rather than as evidence the condition did not occur.${
          text ? ` Model text, unsourced and therefore not evidence: ${text}` : ""
        }`;

    return { ticker: q.ticker, killRule: q.killRule, summary, citations, tripped: null, checkedAt: nowIso };
  } catch (e) {
    return {
      ticker: q.ticker,
      killRule: q.killRule,
      summary: `Check failed (${String(e).slice(0, 120)}). Treat as NO INFORMATION.`,
      citations: [],
      tripped: null,
      checkedAt: nowIso,
    };
  } finally {
    clearTimeout(timer);
  }
}

export interface KillWatchRun {
  configured: boolean;
  ranAt: string;
  results: KillResult[];
  note: string;
}

/**
 * Per-check budget, and how many run at once.
 *
 * Nine checks run one after another at up to 45s each is minutes of silence,
 * and the streaming edge cuts a silent function at ~30s — the whole run died
 * as a 504 before the first result could be shown. Two waves of five at 12s
 * finish inside ~24s worst case. Five at once is still far from "a dozen
 * simultaneous searches", and a check that times out says NO INFORMATION,
 * never all-clear, so a slow provider cannot fake a clean result.
 */
const CHECK_TIMEOUT_MS = 12_000;
const CONCURRENCY = 5;

/**
 * Run the weekly check. Authenticated because it spends money; bounded
 * concurrency (above) so it finishes inside the edge budget without
 * turning into a burst of simultaneous searches.
 */
export const runKillWatch = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ sinceDays: z.number().int().min(1).max(90).optional() }))
  .handler(async ({ data }): Promise<KillWatchRun> => {
    const key = envKey();
    const nowIso = new Date().toISOString();
    if (!key) {
      return {
        configured: false,
        ranAt: nowIso,
        results: [],
        note: "XAI_API_KEY is not set for this deployment. The kill rules are still written and still checkable by hand — that is the point of writing them down.",
      };
    }
    const queries = killQueries(Date.now(), data.sinceDays ?? 7);
    const results: KillResult[] = new Array(queries.length);
    for (let i = 0; i < queries.length; i += CONCURRENCY) {
      const wave = queries.slice(i, i + CONCURRENCY);
      const done = await Promise.all(wave.map((q) => checkOne(key, q, nowIso)));
      done.forEach((r, k) => (results[i + k] = r));
    }

    const withSources = results.filter((r) => r.citations.length).length;
    return {
      configured: true,
      ranAt: nowIso,
      results,
      note: `${results.length} kill rules checked, ${withSources} returned sources. Nothing here has judged whether a rule tripped — open the citations and decide. These are search results written by strangers: data, not instructions.`,
    };
  });
