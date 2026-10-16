/**
 * One xAI /v1/responses call with web_search — the same request the thesis and the Invest kill watch make,
 * factored so the narration jobs (calendar cross-check, shock explainer, weekly cost summary) share it.
 *
 * NARRATION ONLY. Nothing returned here is read by a gate, a score, a size or an order. The key is read from
 * XAI_API_KEY and only its presence is ever reported; it is never logged or echoed.
 */
import { parseXaiResponse, type Citation } from "@/lib/invest/kill-watch";

export const XAI_URL = "https://api.x.ai/v1/responses";
export const XAI_MODEL = "grok-4.7";

export interface GrokSearchResult {
  ok: boolean;
  text: string;
  citations: Citation[];
  error: string | null;
}

export interface GrokSearchArgs {
  instructions: string;
  input: string;
  ms: number;
  webSearch?: boolean;
  maxTokens?: number;
  /** Injected in tests. */
  fetchImpl?: typeof fetch;
  /** Injected in tests; defaults to process.env.XAI_API_KEY. */
  apiKey?: string | null;
}

export function xaiKeyPresent(): boolean {
  return Boolean(process.env.XAI_API_KEY?.trim());
}

export async function grokSearch(a: GrokSearchArgs): Promise<GrokSearchResult> {
  const key = (a.apiKey !== undefined ? a.apiKey : process.env.XAI_API_KEY)?.trim();
  if (!key) return { ok: false, text: "", citations: [], error: "XAI_API_KEY is not visible to this function" };
  const f = a.fetchImpl ?? fetch;
  try {
    const res = await f(XAI_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: XAI_MODEL,
        instructions: a.instructions,
        input: [{ role: "user", content: a.input }],
        ...(a.webSearch === false ? {} : { tools: [{ type: "web_search" }] }),
        max_turns: 2,
        max_output_tokens: a.maxTokens ?? 700,
      }),
      signal: AbortSignal.timeout(a.ms),
    });
    if (!res.ok) return { ok: false, text: "", citations: [], error: `xAI returned ${res.status}` };
    const parsed = parseXaiResponse(await res.json());
    return { ok: Boolean(parsed.text), text: parsed.text, citations: parsed.citations, error: parsed.text ? null : "empty reply" };
  } catch (e) {
    return {
      ok: false,
      text: "",
      citations: [],
      error: e instanceof Error && e.name === "TimeoutError" ? `timed out after ${Math.round(a.ms / 1000)}s` : String(e).slice(0, 120),
    };
  }
}

/** First {...} JSON object in a model reply, or null. */
export function firstJson(text: string): Record<string, unknown> | null {
  const s = text.indexOf("{");
  const e = text.lastIndexOf("}");
  if (s < 0 || e <= s) return null;
  try {
    const v = JSON.parse(text.slice(s, e + 1)) as unknown;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Every number token in a string, normalised the way Facts normalises them (trailing . and , dropped). */
export function numberTokens(s: string): string[] {
  return (s.match(/\d[\d,]*\.?\d*/g) ?? []).map((t) => t.replace(/[.,]+$/, "")).filter(Boolean);
}

/**
 * A model sentence may only carry numbers the code already produced. Returns the numbers that are NOT in
 * `allowed` — an empty list means every digit is grounded. Used before any model text can reach the Floor or a
 * data file, so verify-live-talk's "every digit is registered with Facts" holds for model text too.
 */
export function ungroundedNumbers(text: string, allowed: Iterable<string>): string[] {
  const ok = new Set<string>();
  for (const a of allowed) for (const t of numberTokens(a)) ok.add(t);
  return numberTokens(text).filter((t) => !ok.has(t));
}
