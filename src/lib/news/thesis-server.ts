/**
 * Server side of the news thesis. Builds the material itself (headlines with
 * their feed summaries, the official calendar, the pulse, today's NFL games)
 * — it takes no text from the browser, so it cannot be used as an open model
 * proxy — then asks two models in parallel:
 *   - Grok via xAI /v1/responses with web_search (the call the Invest kill
 *     watch proved in production): it can reach sources beyond the feeds,
 *     including any feed that failed, and returns citations;
 *   - Claude via the Messages API, working from the material alone — Sonnet 5
 *     and, as the guarantee, Haiku 4.5 (fast; the first live run got an empty
 *     reply from Sonnet 5 and no Grok key, and the card said nothing useful).
 * The first that parses leads (Grok, then Sonnet, then Haiku); the next is a
 * second opinion; every model tried is listed with what went wrong. One result is cached for 10 minutes for
 * everyone, and a call already in flight is shared, so the cost is bounded
 * however many phones open the tab. Everything finishes inside ~25s (the
 * edge cuts a silent function near 30s). Narration only — nothing here is
 * read by a gate, a scanner or a size.
 */

import { createServerFn } from "@tanstack/react-start";
import { loadNews } from "./news-server";
import { dedupe, orderItems, tagItem } from "./feed";
import { timeline } from "./schedule";
import { buildThesisInput, parseThesis, THESIS_INSTRUCTIONS, type ThesisContext, type ThesisResult, type ThesisRun } from "./thesis";
import { fundProfile } from "@/lib/invest/exposure";
import { ALL_DOSSIERS } from "@/lib/invest/dossiers";
import { parseXaiResponse } from "@/lib/invest/kill-watch";
import { parseEspnScoreboard } from "@/lib/predict/board";
import { americanToProb, noVig } from "@/lib/predict/math";

const XAI_URL = "https://api.x.ai/v1/responses";
const XAI_MODEL = "grok-4.7";
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const SONNET = "claude-sonnet-5";
const HAIKU = "claude-haiku-4-5-20251001";
const BUDGET_MS = 25_000;
const CACHE_MS = 10 * 60_000;
const MAX_HEADLINES = 36;
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

let cache: { at: number; data: ThesisResult } | null = null;
let inflight: Promise<ThesisResult> | null = null;

const etDate = (d: Date) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
const etTime = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" });
const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
/** The model guessed weekdays from dates on the first live run (MU 'Tue' for Wed 9/30) — so every date carries its weekday. */
const weekday = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });

function ago(iso: string | null): string {
  if (!iso) return "time n/a";
  const m = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000));
  return m < 60 ? `${m}m ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`;
}

async function nflGames(): Promise<string[]> {
  try {
    const res = await fetch("https://site.web.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard", {
      headers: { "User-Agent": UA, Accept: "application/json" },
      signal: AbortSignal.timeout(6_000),
      cache: "no-store",
    });
    if (!res.ok) return [];
    return parseEspnScoreboard(await res.json())
      .filter((g) => g.state !== "post")
      .map((g) => {
        const name = `${g.away.code} @ ${g.home.code}`;
        if (g.state === "in") {
          const wp = g.liveHomeWp != null ? `, ESPN live ${g.home.code} ${pct(g.liveHomeWp)}` : "";
          return `${name} LIVE ${g.detail}, ${g.away.score ?? 0}-${g.home.score ?? 0}${wp}`;
        }
        const nv = noVig(americanToProb(g.away.moneyline ?? NaN), americanToProb(g.home.moneyline ?? NaN));
        const line = nv ? ` — DK no-vig ${g.away.code} ${pct(nv.a)} / ${g.home.code} ${pct(nv.b)}` : "";
        return `${name} ${g.date} ${etTime(g.start)} ET${line}${g.weather ? `, ${g.weather}` : ""}`;
      });
  } catch {
    return [];
  }
}

async function runGrok(input: string, ms: number): Promise<ThesisRun | null> {
  const key = process.env.XAI_API_KEY?.trim();
  const run: ThesisRun = { model: XAI_MODEL, webSearch: true, thesis: null, raw: null, sources: [], error: null };
  if (!key) return { ...run, error: "XAI_API_KEY is not visible to this function" };
  try {
    const res = await fetch(XAI_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: XAI_MODEL,
        instructions: THESIS_INSTRUCTIONS,
        input: [{ role: "user", content: input }],
        tools: [{ type: "web_search" }],
        max_turns: 2,
        max_output_tokens: 1100,
      }),
      signal: AbortSignal.timeout(ms),
    });
    if (!res.ok) return { ...run, error: `xAI returned ${res.status}` };
    const parsed = parseXaiResponse(await res.json());
    return { ...run, thesis: parseThesis(parsed.text), raw: parsed.text || null, sources: parsed.citations };
  } catch (e) {
    return { ...run, error: e instanceof Error && e.name === "TimeoutError" ? `timed out after ${Math.round(ms / 1000)}s` : String(e).slice(0, 120) };
  }
}

async function runClaude(model: string, input: string, ms: number): Promise<ThesisRun | null> {
  const key = process.env.ANTHROPIC_API_KEY?.trim();
  const run: ThesisRun = { model, webSearch: false, thesis: null, raw: null, sources: [], error: null };
  if (!key) return { ...run, error: "ANTHROPIC_API_KEY is not visible to this function" };
  try {
    const res = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model,
        max_tokens: 1100,
        // The first live run came back cut off mid-JSON: the output budget went to thinking.
        ...(model === SONNET ? { thinking: { type: "disabled" } } : {}),
        system: `${THESIS_INSTRUCTIONS} This call has no web search: work only from the material given and mark what still needs confirming.`,
        messages: [{ role: "user", content: input }],
      }),
      signal: AbortSignal.timeout(ms),
    });
    if (!res.ok) return { ...run, error: `Anthropic returned ${res.status}` };
    const json = (await res.json()) as { content?: { type: string; text?: string }[]; stop_reason?: string };
    const blocks = json.content ?? [];
    const text = blocks
      .filter((c) => c.type === "text")
      .map((c) => c.text ?? "")
      .join("\n")
      .trim();
    if (!text) return { ...run, error: `no text (stop: ${json.stop_reason ?? "?"}; blocks: ${blocks.map((b) => b.type).join(",") || "none"})` };
    const thesis = parseThesis(text);
    return {
      ...run,
      thesis,
      raw: text,
      error: thesis ? null : json.stop_reason === "max_tokens" ? `cut off at the output limit (blocks: ${blocks.map((b) => b.type).join(",")})` : "reply was not the JSON asked for",
    };
  } catch (e) {
    return { ...run, error: e instanceof Error && e.name === "TimeoutError" ? `timed out after ${Math.round(ms / 1000)}s` : String(e).slice(0, 120) };
  }
}

async function build(): Promise<ThesisResult> {
  const t0 = Date.now();
  const now = new Date();
  const today = etDate(now);
  const [news, games] = await Promise.all([loadNews(), nflGames()]);
  const qqq = new Map(fundProfile("QQQ")?.holdings ?? []);
  const w = (t: string) => (t === "GOOGL" ? (qqq.get("GOOGL") ?? 0) + (qqq.get("GOOG") ?? 0) : (qqq.get(t) ?? 0));
  const dossiers = new Set(ALL_DOSSIERS.filter((d) => d.kind === "company").map((d) => d.ticker));
  const tagged = orderItems(dedupe(news.items.map((i) => tagItem(i, w, dossiers)))).filter((t) => t.tier <= 2);
  const events = timeline(today, addDays(today, 7), { minQqqWeight: 0.02 }).slice(0, 14);
  const ctx: ThesisContext = {
    nowEt: `${now.toLocaleString("en-US", { timeZone: "America/New_York", weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} ET`,
    headlines: tagged.slice(0, MAX_HEADLINES).map((t) => ({
      source: t.source,
      title: t.title,
      summary: t.summary ?? null,
      tags: [...t.tickers, ...t.topics, ...t.teams].join(","),
      ago: ago(t.published),
    })),
    failed: news.failed.map((f) => f.source),
    pulse: news.pulse
      .filter((p) => p.last != null)
      .map((p) => `${p.label} ${p.symbol === "^TNX" ? `${p.last!.toFixed(2)}%` : p.last!.toFixed(2)}${p.prevClose ? ` (${(((p.last! - p.prevClose) / p.prevClose) * 100).toFixed(2)}%)` : ""}`),
    calendar: events.map((e) => `${weekday(e.date)} ${e.date} ${e.when} — ${e.name}${e.ticker ? ` (${e.ticker}${e.qqqWeight ? `, ${(e.qqqWeight * 100).toFixed(1)}% of QQQ` : ""})` : ""}`),
    games,
  };
  const input = buildThesisInput(ctx);
  const left = Math.max(5_000, BUDGET_MS - (Date.now() - t0));
  const runs = (
    await Promise.all([runGrok(input, left), runClaude(SONNET, input, Math.max(5_000, left - 1_000)), runClaude(HAIKU, input, Math.max(5_000, left - 1_000))])
  ).filter((r): r is ThesisRun => r != null);
  const withThesis = runs.filter((r) => r.thesis);
  const withText = runs.filter((r) => !r.thesis && r.raw);
  const ranked = [...withThesis, ...withText];
  return {
    generatedAt: new Date().toISOString(),
    cached: false,
    primary: ranked[0] ?? null,
    second: ranked[1] ?? null,
    tried: runs.map((r) => ({ model: r.model, ok: Boolean(r.thesis), error: r.error })),
    inputs: { headlines: ctx.headlines.length, feedsFailed: ctx.failed, games: games.length, events: events.length },
  };
}

/** Public: it takes no input, and one shared result per 10 minutes bounds what it can cost. */
export const getNewsThesis = createServerFn({ method: "POST" }).handler(async (): Promise<ThesisResult> => {
  if (cache && Date.now() - cache.at < CACHE_MS) return { ...cache.data, cached: true };
  if (!inflight) {
    inflight = build()
      .then((data) => {
        // Cache only a result that produced a thesis; a double failure is retried on the next open.
        if (data.primary?.thesis) cache = { at: Date.now(), data };
        return data;
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
});
