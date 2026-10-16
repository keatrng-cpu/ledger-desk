/**
 * The Tier-2 "explain this shock" hook named in src/lib/trading/shock.ts (ShockEvent): out of the poll loop,
 * narration only, never a gate.
 *
 * When a candle is ≥ SHOCK_RANGE_MULT × ATR and NO calendar row sits within ±15 minutes of it, Grok (web search)
 * is asked to name the unscheduled headline, with citations. The answer is accepted only when:
 *   - at least one citation URL came back (no source, no claim), and
 *   - every number in it also appears in a cited page title or in the tape facts the code supplied
 *     (ungroundedNumbers) — so a model digit never reaches the Floor unregistered.
 * Anything else — no key, timeout, no citations, an invented figure — leaves the tape line only (`fallback`).
 *
 * Nothing here feeds ShockBias.headline, the lock, the lean, a score or a size. The lock stays the tape.
 */
import { SHOCK_RANGE_MULT, type ShockEvent } from "@/lib/trading/shock";
import type { NewsEvent } from "@/lib/trading/news";
import { etWallToEpochMs } from "@/lib/trading/sessions";
import { firstJson, grokSearch, ungroundedNumbers, type GrokSearchResult } from "./grok-search";

export const CALENDAR_NEAR_MIN = 15;
const CACHE_MS = 30 * 60_000;

export interface ShockExplain {
  key: string;
  at: number;
  symbol: string;
  /** The tape line — always present, always code's. */
  tape: string;
  /** Grok's named headline, or null when the search failed or was rejected. */
  headline: string | null;
  sources: { url: string; title: string | null }[];
  /** Why the headline is null (shown in diagnostics, never spoken). */
  fallback: string | null;
}

export const shockKey = (e: ShockEvent) => `${e.symbol}|${e.at}`;

export function tapeLine(e: ShockEvent): string {
  return `${e.symbol} ${e.side === "up" ? "up" : "down"} ${Math.round(e.pts)} pts, ${e.atrMult.toFixed(1)}× ATR`;
}

/** A calendar row within ±CALENDAR_NEAR_MIN of the shock — then the shock is the release, not a mystery. */
export function calendarRowNear(e: ShockEvent, calendar: NewsEvent[]): NewsEvent | null {
  for (const r of calendar) {
    const ms = etWallToEpochMs(r.date, r.timeEt);
    if (Math.abs(ms - e.at) <= CALENDAR_NEAR_MIN * 60_000) return r;
  }
  return null;
}

export function shouldExplain(e: ShockEvent | null | undefined, calendar: NewsEvent[]): e is ShockEvent {
  return Boolean(e && e.atrMult >= SHOCK_RANGE_MULT && !calendarRowNear(e, calendar));
}

export const SHOCK_INSTRUCTIONS =
  "A US index future just made an unscheduled, outsized move. Search the web and news for the headline that caused it in the minutes " +
  "around the time given (e.g. a Fed leak, a geopolitical event, a policy post). Name it in at most 14 words. " +
  "Use only what a cited source says; if nothing credible is found, say so. No numbers unless the source title carries them. " +
  'Reply with JSON only: {"headline":"..."|null}';

export async function explainShock(
  e: ShockEvent,
  search: (a: Parameters<typeof grokSearch>[0]) => Promise<GrokSearchResult> = grokSearch,
): Promise<ShockExplain> {
  const tape = tapeLine(e);
  const base: ShockExplain = { key: shockKey(e), at: e.at, symbol: e.symbol, tape, headline: null, sources: [], fallback: null };
  const when = new Date(e.at).toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  const res = await search({ instructions: SHOCK_INSTRUCTIONS, input: `${tape} at ${when} ET. No scheduled release was on the calendar.`, ms: 20_000, maxTokens: 300 });
  if (!res.ok) return { ...base, fallback: res.error ?? "search failed" };
  const j = firstJson(res.text);
  const h = typeof j?.headline === "string" ? j.headline.replace(/\s+/g, " ").trim().slice(0, 140) : "";
  if (!h) return { ...base, fallback: "no credible headline found" };
  if (!res.citations.length) return { ...base, fallback: "no citations — headline dropped" };
  const bad = ungroundedNumbers(h, [tape, ...res.citations.map((c) => c.title ?? "")]);
  if (bad.length) return { ...base, fallback: `ungrounded numbers: ${bad.join(", ")}` };
  return { ...base, headline: h, sources: res.citations.slice(0, 3) };
}

const cache = new Map<string, { at: number; data: ShockExplain }>();
const inflight = new Map<string, Promise<ShockExplain>>();

/** One search per shock however many clients ask; cached 30 min. */
export async function explainShockCached(e: ShockEvent, search?: Parameters<typeof explainShock>[1]): Promise<ShockExplain> {
  const k = shockKey(e);
  const hit = cache.get(k);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.data;
  let p = inflight.get(k);
  if (!p) {
    p = explainShock(e, search)
      .then((data) => {
        cache.set(k, { at: Date.now(), data });
        return data;
      })
      .finally(() => inflight.delete(k));
    inflight.set(k, p);
  }
  return p;
}
