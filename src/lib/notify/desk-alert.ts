/**
 * Desk → Slack alerts (incoming webhook in env SLACK_DESK_WEBHOOK_URL).
 *
 * One module for every place that tells Keaton something happened: the Netlify functions import it, and
 * the desk-watcher carries a line-for-line Python twin (docs/connectors-1016/watcher-notify.patch).
 *
 * Contract:
 *  - No webhook configured → no-op (returns { sent: false, why: "disabled" }), never throws.
 *  - Dedupe: the same event key inside DEDUPE_MS is sent once (a card re-armed every poll is ONE alert). A key is
 *    recorded only after Slack answers 2xx, so a failed/timed-out post (5 s AbortSignal) can be retried.
 *  - Rate limit: at most RATE_MAX posts per RATE_WINDOW_MS per process; overflow is dropped and counted,
 *    and the next post that gets through says how many were suppressed.
 *  - Every outgoing string goes through scrubText: no keys, tokens, webhook URLs or account numbers.
 *  - Notification is a side channel. It never decides, gates or places anything, and a Slack failure
 *    is swallowed (logged) so it can never break the caller.
 */
import { scrubText } from "./scrub";

export type Side = "long" | "short";
export type DeskEvent =
  | { type: "card_fire" | "card_arm"; symbol: string; grade: string; side: Side; entry: number; stop: number; t1: number; signal?: string }
  | { type: "order_filled"; symbol: string; side?: Side; qty: number; price: number; signal?: string }
  | { type: "order_rejected"; symbol: string; reason: string; signal?: string }
  | { type: "daily_stop" | "weekly_lock"; pnl?: number; limit?: number; day?: string }
  | { type: "preopen_check"; ok: boolean; day: string; failures?: string[] }
  | { type: "watcher_down"; heartbeatAgeS: number | null }
  | { type: "rules_hash_mismatch"; expected: string; got: string | null }
  | { type: "rule1_shadow"; symbol: string; side: Side; entry: number; stop: number; t1?: number; day?: string };

export const DEDUPE_MS = 10 * 60_000;
export const RATE_WINDOW_MS = 60_000;
export const RATE_MAX = 6;
export const SLACK_TIMEOUT_MS = 5_000;

const px = (n: number | undefined) => (typeof n === "number" && Number.isFinite(n) ? String(Math.round(n * 100) / 100) : "?");

/** Stable identity of an event for dedupe. Prices are part of a card's key: a moved entry is a new alert. */
export function eventKey(e: DeskEvent): string {
  switch (e.type) {
    case "card_fire": case "card_arm": return `${e.type}:${e.signal ?? `${e.symbol}:${e.side}:${px(e.entry)}:${px(e.stop)}`}`;
    case "order_filled": return `fill:${e.signal ?? e.symbol}:${e.qty}@${px(e.price)}`;
    case "order_rejected": return `reject:${e.signal ?? e.symbol}:${e.reason.slice(0, 60)}`;
    case "daily_stop": case "weekly_lock": return `${e.type}:${e.day ?? ""}`;
    case "preopen_check": return `preopen:${e.day}:${e.ok}`;
    case "watcher_down": return "watcher_down";
    case "rules_hash_mismatch": return `rules:${e.expected}:${e.got}`;
    case "rule1_shadow": return `rule1:${e.day ?? ""}:${e.symbol}:${e.side}:${px(e.entry)}`;
  }
}

export function formatEvent(e: DeskEvent): string {
  switch (e.type) {
    case "card_fire": case "card_arm":
      return `${e.type === "card_fire" ? ":rotating_light: FIRE" : ":large_yellow_circle: ARM"} ${e.grade} ${e.symbol} ${e.side} · entry ${px(e.entry)} · stop ${px(e.stop)} · T1 ${px(e.t1)}`;
    case "order_filled": return `:white_check_mark: FILLED ${e.symbol}${e.side ? ` ${e.side}` : ""} ${e.qty} @ ${px(e.price)}`;
    case "order_rejected": return `:x: ORDER REJECTED ${e.symbol}: ${e.reason.slice(0, 200)}`;
    case "daily_stop": return `:octagonal_sign: DAILY STOP hit${e.pnl != null ? ` (P&L ${px(e.pnl)}${e.limit != null ? ` vs limit ${px(e.limit)}` : ""})` : ""} — no more entries today`;
    case "weekly_lock": return `:lock: WEEKLY LOCK hit${e.pnl != null ? ` (P&L ${px(e.pnl)})` : ""} — desk locked for the week`;
    case "preopen_check": return e.ok ? `:sunrise: 8:20 CT pre-open check PASS (${e.day})` : `:warning: 8:20 CT pre-open check FAIL (${e.day}): ${(e.failures ?? []).join("; ").slice(0, 400)}`;
    case "watcher_down": return `:skull: desk-watcher DOWN — last heartbeat ${e.heartbeatAgeS == null ? "never" : `${Math.round(e.heartbeatAgeS)}s ago`}`;
    case "rules_hash_mismatch": return `:no_entry: rules hash MISMATCH — desk ${e.expected}, watcher ${e.got ?? "none"} (watcher fails closed)`;
    case "rule1_shadow": return `:ghost: Rule1 shadow ${e.symbol} ${e.side} · entry ${px(e.entry)} · stop ${px(e.stop)}${e.t1 != null ? ` · T1 ${px(e.t1)}` : ""} (shadow, no order)`;
  }
}

export type SendResult = { sent: boolean; why?: "disabled" | "duplicate" | "rate_limited" | "error"; status?: number };
type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number }>;

export function createNotifier(opts: { webhookUrl?: string | null; fetch?: FetchLike; now?: () => number; dedupeMs?: number; rateMax?: number; rateWindowMs?: number } = {}) {
  const url = (opts.webhookUrl ?? "").trim();
  const now = opts.now ?? Date.now;
  const doFetch: FetchLike | undefined = opts.fetch ?? (typeof fetch === "function" ? (fetch as unknown as FetchLike) : undefined);
  const dedupeMs = opts.dedupeMs ?? DEDUPE_MS, rateMax = opts.rateMax ?? RATE_MAX, windowMs = opts.rateWindowMs ?? RATE_WINDOW_MS;
  const seen = new Map<string, number>();
  const inflight = new Set<string>(); // a post in progress counts as a duplicate, but is only "seen" once Slack says ok
  let sentAt: number[] = [];
  let suppressed = 0;

  return {
    enabled: Boolean(url && /^https:\/\//.test(url)),
    async notify(e: DeskEvent): Promise<SendResult> {
      if (!url || !/^https:\/\//.test(url) || !doFetch) return { sent: false, why: "disabled" };
      const t = now();
      for (const [k, at] of seen) if (t - at >= dedupeMs) seen.delete(k);
      let key: string;
      try { key = eventKey(e); } catch { return { sent: false, why: "error" }; } // malformed event: never throw into the caller
      if (seen.has(key) || inflight.has(key)) return { sent: false, why: "duplicate" };
      sentAt = sentAt.filter((x) => t - x < windowMs);
      if (sentAt.length >= rateMax) { suppressed++; return { sent: false, why: "rate_limited" }; }
      inflight.add(key); sentAt.push(t);
      const carried = suppressed;
      suppressed = 0;
      try {
        // formatEvent is inside the try: a bad event (e.g. a malformed field) must not leave its key stuck in-flight.
        let text = formatEvent(e);
        if (carried) text += ` _(+${carried} suppressed by rate limit)_`;
        const res = await doFetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: scrubText(text) }), signal: AbortSignal.timeout(SLACK_TIMEOUT_MS) });
        if (res.ok) { seen.set(key, t); return { sent: true, status: res.status }; }
        suppressed += carried; // not delivered: keep the count for the next post; the event itself may be retried
        return { sent: false, why: "error", status: res.status };
      } catch (err) {
        suppressed += carried;
        console.warn("[notify] slack post failed:", scrubText(String(err)));
        return { sent: false, why: "error" };
      } finally {
        inflight.delete(key);
      }
    },
  };
}

let _default: ReturnType<typeof createNotifier> | null = null;
/** Process-wide notifier from env SLACK_DESK_WEBHOOK_URL (no-op when unset). */
export function deskNotifier() {
  if (!_default) _default = createNotifier({ webhookUrl: typeof process !== "undefined" ? process.env.SLACK_DESK_WEBHOOK_URL : undefined });
  return _default;
}
export const notifyDesk = (e: DeskEvent) => deskNotifier().notify(e);
