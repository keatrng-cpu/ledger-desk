/**
 * The Discuss tab's schedule — Grok and Claude fire on their own at 6 fixed
 * points across the NY AM open, purely as the trader's own confidence check:
 * "does an independent read agree with the desk's own grade right now?"
 *
 * WHAT THIS IS NOT. It never touches a score, a gate, or a size — the
 * trader's own framing (2026-09-28): "their discussion isn't added into any
 * grades, it's more of a backup probability security thing... if the desk
 * has a good trade score and grok/claude are in agreement, I look at the
 * charts with less nerves." `askDeskDiscuss`'s system prompts (claude-server.ts)
 * already forbid a signal, an entry, a size, or an invented number — this
 * file only decides WHEN it fires and parses the one-line "Read: bias ·
 * confidence" tag each round-1 statement ends with, so the transcript in
 * discuss-tab.tsx can show a quick badge next to the two full paragraphs.
 *
 * WHY NOT THE 30s POLL DIRECTLY. `trading-coach.tsx`'s manual button carries
 * this comment: "this endpoint costs money per call, so it is never wired to
 * the 30s desk poll." That guard was against firing on every tick — two paid
 * calls every ~20-30s would be hundreds per session. This is a narrower,
 * bounded version of the same tradeoff: it rides the desk's existing refresh
 * to CHECK the clock (same "only fires if the tab is open" honesty already
 * stated for the scheduled jobs in trigger-server.ts), but only actually
 * calls the models at 6 fixed ET minutes — once each, never on every tick.
 *
 * WHY NOT A REAL CRON. Netlify's scheduled-functions plugin needs Pro (see
 * netlify.toml) and isn't wired up. Real cron would also be the wrong shape
 * here anyway: this is a trader looking at a live tab, not a headless job.
 */

import { etWallParts } from "@/lib/trading/sessions";

export interface AiSyncTime {
  slot: string;
  hour: number;
  minute: number;
}

/** 09:25 / 09:32 / 09:35 / 09:40 / 09:45 / 10:00 ET — the trader's own picks, spanning premarket through the Judas window into the open pulse. */
export const AI_SYNC_TIMES: readonly AiSyncTime[] = [
  { slot: "09:25", hour: 9, minute: 25 },
  { slot: "09:32", hour: 9, minute: 32 },
  { slot: "09:35", hour: 9, minute: 35 },
  { slot: "09:40", hour: 9, minute: 40 },
  { slot: "09:45", hour: 9, minute: 45 },
  { slot: "10:00", hour: 10, minute: 0 },
];

function dateKey(p: { year: number; month: number; day: number }): string {
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/** The dedupe key for one slot on one ET calendar day — each slot fires at most once per day. */
export function aiSyncKey(now: Date, slot: string): string {
  return `${dateKey(etWallParts(now.getTime()))}:${slot}`;
}

/**
 * The slot due right now, or null. Weekday-only (the desk is shut on
 * weekends); matches the EXACT ET wall-clock minute, so a ~20s desk refresh
 * catches it without a real cron — a refresh that lands mid-minute still
 * sees the same minute on its next tick before the window closes. Already
 * fired today (per `firedToday`, the caller's own dedupe set) never re-fires.
 */
export function dueAiSyncSlot(now: Date, firedToday: ReadonlySet<string>): { slot: string; key: string } | null {
  const p = etWallParts(now.getTime());
  if (p.weekday === 0 || p.weekday === 6) return null;
  for (const t of AI_SYNC_TIMES) {
    if (p.hour !== t.hour || p.minute !== t.minute) continue;
    const key = `${dateKey(p)}:${t.slot}`;
    if (firedToday.has(key)) return null;
    return { slot: t.slot, key };
  }
  return null;
}

export type DiscussBias = "bullish" | "bearish" | "neutral";
export type DiscussConfidence = "low" | "medium" | "high";

export interface DiscussRead {
  bias: DiscussBias | null;
  confidence: DiscussConfidence | null;
}

/**
 * Pulled from the trailing tag `askDeskDiscuss`'s round-1 prompt asks for:
 * "Read: bullish|bearish|neutral · confidence low|medium|high". A quick badge
 * off the model's own words, not an inference — text lacking the tag (a
 * malformed reply, a round-2 reply, which never carries one) reads as
 * {bias: null, confidence: null} rather than guessing.
 */
export function parseDiscussRead(text: string | null | undefined): DiscussRead {
  if (!text) return { bias: null, confidence: null };
  const m = /Read:\s*(bullish|bearish|neutral)\s*(?:·|-|,)\s*confidence\s*(low|medium|high)/i.exec(text);
  if (!m) return { bias: null, confidence: null };
  return { bias: m[1].toLowerCase() as DiscussBias, confidence: m[2].toLowerCase() as DiscussConfidence };
}

/**
 * Seconds to the next scheduled Discuss checkpoint (weekdays; exchange
 * holidays are not modelled — the scheduler itself fires on any weekday
 * minute match). Shared by the Discuss tab and the Floor command strip.
 */
export function nextAiSyncCheckpoint(nowMs: number): { slot: string; secs: number } {
  const p = etWallParts(nowMs);
  const sod = p.hour * 3600 + p.minute * 60 + p.second;
  const weekday = p.weekday >= 1 && p.weekday <= 5;
  if (weekday) {
    for (const t of AI_SYNC_TIMES) {
      const at = t.hour * 3600 + t.minute * 60;
      if (at > sod) return { slot: t.slot, secs: at - sod };
    }
  }
  let days = 1;
  let wd = (p.weekday + 1) % 7;
  while (wd === 0 || wd === 6) {
    days += 1;
    wd = (wd + 1) % 7;
  }
  const first = AI_SYNC_TIMES[0]!;
  return { slot: first.slot, secs: days * 86400 - sod + first.hour * 3600 + first.minute * 60 };
}

export function fmtAiSyncCountdown(secs: number): string {
  const d = Math.floor(secs / 86400);
  const h = Math.floor((secs % 86400) / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  if (d > 0) return `${d}d ${pad(h)}:${pad(m)}:${pad(s)}`;
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

