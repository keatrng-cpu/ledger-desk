/**
 * Push-path SHADOW (audits/overnight-1016 latency cuts (a)+(b)). Pure helpers for /api/desk/card-stream and wire.latency.
 * The stream emits one SSE `card` event per NEW card (by `at`) with the timing the watcher needs to measure
 * bar close -> desk build -> watcher receipt -> decision. Config shared/push-shadow.json (outside the rules hash);
 * live is false: nothing here gates, sizes or fires.
 */
import CFG from "../../../shared/push-shadow.json";

export const PUSH = CFG;
export type CardLatency = { mode: "shadow"; barCloseAt: number; builtAt: number; buildMs: number; targetS: number };

/** Latest 1m bar close at or before `builtAt` (closed bars only) and how long the build took after it. */
export function cardLatency(builtAt: number): CardLatency {
  const barCloseAt = Math.floor(builtAt / 60_000) * 60_000;
  return { mode: "shadow", barCloseAt, builtAt, buildMs: builtAt - barCloseAt, targetS: CFG.targetS };
}

export function pushEnabled(env: Record<string, string | undefined>): boolean {
  return env.DESK_PUSH_SHADOW === "1";
}

type CardLike = { at?: string; wire?: { rulesHash?: string; rule1?: unknown[]; latency?: CardLatency | null; strategy?: { symbol?: string; side?: string; band?: string | null } | null } };
/** One SSE frame for a card the stream has not sent yet; null when `at` is unchanged. */
export function sseFrame(card: CardLike, lastAt: string | null, pushedAt: number): { frame: string; at: string } | null {
  if (!card?.at || card.at === lastAt) return null;
  const w = card.wire ?? {};
  const body = { at: card.at, pushedAt, rulesHash: w.rulesHash ?? null, latency: w.latency ?? null, rule1: w.rule1 ?? [],
    strategy: w.strategy ? { symbol: w.strategy.symbol, side: w.strategy.side, band: w.strategy.band ?? null } : null, mode: "shadow", live: false };
  return { frame: `event: card\nid: ${card.at}\ndata: ${JSON.stringify(body)}\n\n`, at: card.at };
}
