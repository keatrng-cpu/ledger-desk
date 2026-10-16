/**
 * graph-drift-1016 #3: reasons persistence SHADOW. desk_card_snap (learning.ts) keeps only cards with q/qRaw >= SNAP_MIN_Q,
 * only the first snapshot per day ("on conflict do nothing"), and only reasons.slice(-12). This keeps EVERY card's full
 * reasons, sampled: a row is written only when a card's reasons change. It does not touch desk_card_snap.
 *
 * NOT WIRED and the table is NOT created: the DDL is a proposal in docs/graph-drift-1016/proposed-0028_card_reasons_shadow.sql
 * (kept out of migrations/ on purpose, because scripts/migrate.mjs applies that folder on every build). Pure helpers only.
 */
import { createHash } from "node:crypto";

export const REASONS_SHADOW_MAX = 64; // per row; a card carries far fewer, this only bounds a runaway list

export interface ReasonsShadowCard { symbol: string; side: string; band?: string | null; q?: number | null; reasons?: unknown }
export interface ReasonsShadowRow { key: string; hash: string; symbol: string; side: string; band: string | null; q: number | null; reasons: string[] }

const keyOf = (c: ReasonsShadowCard) => `${c.symbol}|${c.side}`;
export const reasonsHash = (r: string[]): string => createHash("sha256").update(JSON.stringify(r), "utf8").digest("hex").slice(0, 16);

/** Rows to write for this read: one per card whose reasons hash differs from `last` (card key -> last written hash).
 *  Updates `last` in place. Cards with no reasons are skipped. Order follows `cards`. */
export function reasonsShadowRows(cards: readonly ReasonsShadowCard[], last: Map<string, string>): ReasonsShadowRow[] {
  const out: ReasonsShadowRow[] = [];
  for (const c of cards) {
    const reasons = (Array.isArray(c.reasons) ? c.reasons.filter((x): x is string => typeof x === "string") : []).slice(-REASONS_SHADOW_MAX);
    if (!reasons.length) continue;
    const key = keyOf(c); const hash = reasonsHash(reasons);
    if (last.get(key) === hash) continue;
    last.set(key, hash);
    out.push({ key, hash, symbol: c.symbol, side: c.side, band: c.band ?? null, q: c.q ?? null, reasons });
  }
  return out;
}
