/**
 * X news-timing input (SHADOW, design + stub; flag X_PULSE, default off). See docs/grok-advisor-1016/README.md §X pulse.
 *
 * Design: a poller (cron/watcher side, every 60 s in 07:00-15:00 CT) runs X API v2 recent search
 * (GET /2/tweets/search/recent, bearer from env X_BEARER_TOKEN, never logged) — or the X connector's search_posts_all
 * read when run by an agent — over `shared/grok-reader.json advisor.xPulse.accounts` with since_id paging.
 * Each post is classified by keyword (`classifyImpact`, deterministic) and written to the Supabase shadow table
 * public.x_pulse (migrations/0011). The advisor only TAGS suggestions within ±windowMin of a high-impact pulse
 * (`newsTag`); nothing gates on it. The stub below does not call the network unless X_PULSE=1 and the token is set.
 */
import CFG from "../../../shared/grok-reader.json";
type Env = Record<string, string | undefined>;
export type XPulse = { id: string; at: number; author: string; text: string; impact: "high" | "medium" | "low"; keywords: string[] };
const XC = CFG.advisor.xPulse;
export const xPulseEnabled = (env: Env = process.env) => ["1", "true", "on"].includes(String(env[XC.envFlag] ?? "").trim().toLowerCase());

export function classifyImpact(text: string): { impact: XPulse["impact"]; keywords: string[] } {
  const t = text.toLowerCase();
  const hi = XC.highImpact.filter((k) => t.includes(k.toLowerCase()));
  if (hi.length) return { impact: "high", keywords: hi };
  const md = XC.mediumImpact.filter((k) => t.includes(k.toLowerCase()));
  return { impact: md.length ? "medium" : "low", keywords: md };
}
/** Nearest high-impact pulse within ±windowMin of atMs (pulse must be at or before readAt — no lookahead in grading). */
export function newsTag(atMs: number, pulses: XPulse[], windowMin = XC.windowMin): { id: string; headline: string; minutesFrom: number } | null {
  let best: XPulse | null = null;
  for (const p of pulses) if (p.impact === "high" && Math.abs(p.at - atMs) <= windowMin * 60_000 && p.at <= atMs + windowMin * 60_000 && (!best || Math.abs(p.at - atMs) < Math.abs(best.at - atMs))) best = p;
  return best ? { id: best.id, headline: best.text.slice(0, 140), minutesFrom: Math.round((best.at - atMs) / 60_000) } : null;
}
export function pulseRow(p: XPulse) { return { id: p.id, ts: new Date(p.at).toISOString(), author: p.author, text: p.text.slice(0, 500), impact: p.impact, keywords: p.keywords }; }
export function searchQuery(): string { return `(${XC.accounts.map((a) => `from:${a}`).join(" OR ")}) -is:retweet`; }

/** STUB poller. Returns [] when off. When on, one recent-search page → classified pulses (writer to x_pulse left to the cron owner). */
export async function pollXPulse(o: { env?: Env; fetchImpl?: typeof fetch; sinceId?: string } = {}): Promise<XPulse[]> {
  const env = o.env ?? process.env; const tok = env.X_BEARER_TOKEN?.trim();
  if (!xPulseEnabled(env) || !tok) return [];
  try {
    const u = new URL("https://api.x.com/2/tweets/search/recent");
    u.searchParams.set("query", searchQuery()); u.searchParams.set("max_results", "25"); u.searchParams.set("tweet.fields", "created_at,author_id");
    if (o.sinceId) u.searchParams.set("since_id", o.sinceId);
    const res = await (o.fetchImpl ?? fetch)(u, { headers: { authorization: `Bearer ${tok}` } });
    if (!res.ok) return [];
    const j = (await res.json()) as { data?: { id: string; text: string; created_at?: string; author_id?: string }[] };
    return (j.data ?? []).map((d) => ({ id: d.id, at: Date.parse(d.created_at ?? "") || Date.now(), author: d.author_id ?? "?", text: d.text, ...classifyImpact(d.text) }));
  } catch { return []; }
}
