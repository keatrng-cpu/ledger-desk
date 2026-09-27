/**
 * The news thesis — one briefing that turns the headlines, the calendar, the
 * pulse and today's games into a summary, an analysis and the impact on each
 * book the trader runs. Written by a model ON REQUEST (a button, a 10-minute
 * shared cache), never on the poll and never into a gate: narration only,
 * the same rule as the in-app coach. This file is pure — the prompt, the
 * shape and the parser — so it can be tested without a network.
 */

export interface Thesis {
  headline: string;
  summary: string[];
  analysis: string[];
  impacts: { futures: string; options: string; investing: string; predictions: string };
  watch: string[];
  confidence: "low" | "medium" | "high" | null;
}

export interface ThesisSource {
  url: string;
  title: string | null;
}

export interface ThesisRun {
  model: string;
  webSearch: boolean;
  thesis: Thesis | null;
  /** The model's text when it did not return the JSON asked for. */
  raw: string | null;
  sources: ThesisSource[];
  error: string | null;
}

export interface ThesisResult {
  generatedAt: string;
  cached: boolean;
  primary: ThesisRun | null;
  second: ThesisRun | null;
  /** Every model tried and what went wrong with it, so an empty card says why. */
  tried: { model: string; ok: boolean; error: string | null }[];
  inputs: { headlines: number; feedsFailed: string[]; games: number; events: number };
}

export interface ThesisContext {
  nowEt: string;
  headlines: { source: string; title: string; summary: string | null; tags: string; ago: string }[];
  failed: string[];
  pulse: string[];
  calendar: string[];
  games: string[];
}

export const THESIS_INSTRUCTIONS = [
  "You are the news desk for one trader who runs four books: day trades in MNQ/ES futures;",
  "QQQ/SPY option swings on Robinhood (1-14 days); a long-term share book (VTI ballast; never holds QQQ/SPY/VOO shares);",
  "and NFL/sports event contracts on Robinhood (Kalshi-listed moneylines).",
  "Build ONE thesis from the material given. Where a feed failed, a story is thin, or a claim needs confirming,",
  "search the web and combine several independent sources; prefer primary sources (Fed, BLS, BEA, company filings,",
  "team and league reports) and say when something is reported rather than confirmed.",
  "Then say what it means for each book: futures (event risk and which index is more exposed, and why),",
  "options (what implied volatility and the calendar are pricing, and when), investing (sectors or named companies over months),",
  "predictions (for the listed games: injury, quarterback, weather or news that should move win chances, and which way).",
  "Never tell the reader to buy or sell, never size a position, never give an entry price: explain mechanisms and",
  "what would confirm or break the view. If the material is quiet, say so plainly — a quiet tape is a finding.",
  "Return ONLY a JSON object, no prose around it:",
  '{"headline":string,"summary":[string],"analysis":[string],',
  '"impacts":{"futures":string,"options":string,"investing":string,"predictions":string},',
  '"watch":[string],"confidence":"low"|"medium"|"high"}.',
  "Exactly 3 items per list, each under 140 characters; each impact under 200 characters; the whole reply under 380 words.",
  "Times in ET. Use the weekday printed with each date; never work one out yourself.",
].join(" ");

/** The material, as one compact block the model reads. */
export function buildThesisInput(ctx: ThesisContext): string {
  const lines: string[] = [`Now: ${ctx.nowEt}`];
  if (ctx.pulse.length) lines.push(`Pulse (Yahoo, delayed): ${ctx.pulse.join(" · ")}`);
  if (ctx.calendar.length) lines.push("Calendar (official schedules):", ...ctx.calendar.map((x) => `- ${x}`));
  if (ctx.games.length) lines.push("Games still to play or in progress (DraftKings no-vig / ESPN live):", ...ctx.games.map((x) => `- ${x}`));
  if (ctx.failed.length) lines.push(`Feeds that did not load (search for these yourself): ${ctx.failed.join(", ")}`);
  lines.push(`Headlines (${ctx.headlines.length}, newest first within tier):`);
  for (const h of ctx.headlines) {
    lines.push(`- [${h.source}, ${h.ago}] ${h.title}${h.tags ? ` {${h.tags}}` : ""}${h.summary ? ` — ${h.summary}` : ""}`);
  }
  return lines.join("\n");
}

const str = (v: unknown, n = 300): string => (typeof v === "string" ? v.trim().slice(0, n) : "");
const list = (v: unknown): string[] =>
  Array.isArray(v)
    ? v
        .map((x) => str(x))
        .filter(Boolean)
        .slice(0, 6)
    : [];

/**
 * Close a JSON object that was cut off mid-reply: keep everything up to the
 * last complete value and close the open brackets. A reply that hit the
 * output limit still gives its headline and first lists instead of nothing.
 */
export function repairJson(s: string): string | null {
  const safe: { at: number; stack: string[] }[] = [];
  const stack: string[] = [];
  let inStr = false;
  let esc = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') {
        inStr = false;
        safe.push({ at: i, stack: [...stack] });
      }
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{" || ch === "[") stack.push(ch);
    else if (ch === "}" || ch === "]") {
      stack.pop();
      safe.push({ at: i, stack: [...stack] });
    }
  }
  for (let k = safe.length - 1; k >= 0; k--) {
    const { at, stack: open } = safe[k];
    const next = s.slice(at + 1).match(/^\s*(\S)/)?.[1];
    if (next === ":") continue; // that string was a key, not a value
    const head = s.slice(0, at + 1).replace(/[\s,]+$/, "");
    return head + open.reverse().map((o) => (o === "{" ? "}" : "]")).join("");
  }
  return null;
}

/** The model's text → a Thesis, or null when it is not the JSON asked for. Never throws. */
export function parseThesis(text: string | null | undefined): Thesis | null {
  if (!text) return null;
  const body = text.replace(/```(?:json)?/gi, "");
  const a = body.indexOf("{");
  const b = body.lastIndexOf("}");
  if (a < 0) return null;
  let j: Record<string, unknown> | null = null;
  try {
    if (b > a) j = JSON.parse(body.slice(a, b + 1)) as Record<string, unknown>;
  } catch {
    j = null;
  }
  if (!j) {
    const fixed = repairJson(body.slice(a));
    try {
      j = fixed ? (JSON.parse(fixed) as Record<string, unknown>) : null;
    } catch {
      j = null;
    }
  }
  if (!j) return null;
  const headline = str(j.headline, 240);
  const summary = list(j.summary);
  if (!headline || !summary.length) return null;
  const im = (j.impacts ?? {}) as Record<string, unknown>;
  const conf = str(j.confidence).toLowerCase();
  return {
    headline,
    summary,
    analysis: list(j.analysis),
    impacts: { futures: str(im.futures), options: str(im.options), investing: str(im.investing), predictions: str(im.predictions) },
    watch: list(j.watch),
    confidence: conf === "low" || conf === "medium" || conf === "high" ? conf : null,
  };
}
