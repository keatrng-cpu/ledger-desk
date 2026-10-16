/**
 * Secret scrubbing shared by the Slack notifier and Sentry. Anything that leaves the desk
 * (a Slack line, a Sentry event) goes through here first. Defensive by design: it is fine to
 * over-redact a log line, never fine to post a Robinhood token, a Databento key, a Supabase
 * service key, a webhook URL or a full broker account number.
 */

/** Env names whose VALUES must never appear anywhere we send. Matched by name pattern too. */
export const SECRET_ENV_PATTERN = /(KEY|SECRET|TOKEN|PASSWORD|PASS|DSN|WEBHOOK|MFA|TOTP|COOKIE|SESSION|DATABASE_URL|DB_URL|POSTGRES_URL|AUTH)/i;

const PATTERNS: [RegExp, string][] = [
  [/https:\/\/hooks\.slack\.com\/[^\s"'<>]+/gi, "[slack-webhook]"],
  [/https?:\/\/[^\s"'<>@]*@[^\s"'<>]*sentry[^\s"'<>]*/gi, "[sentry-dsn]"],
  [/postgres(?:ql)?:\/\/[^\s"'<>]+/gi, "[db-url]"],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}/g, "[jwt]"], // Supabase anon/service keys, RH bearer JWTs
  [/\bsb_(?:secret|publishable)_[A-Za-z0-9_-]{8,}/g, "[supabase-key]"],
  [/\bdb-[A-Za-z0-9]{20,}\b/g, "[databento-key]"],
  [/\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{8,}/g, "[stripe-key]"],
  [/\bxox[abprs]-[A-Za-z0-9-]{8,}/g, "[slack-token]"],
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, "$1 [redacted]"],
  [/("?(?:access_token|refresh_token|id_token|api[_-]?key|apikey|secret|password|passwd|token|mfa_code|totp|device_token|client_secret|authorization|cookie|dsn)"?\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s,}&]+)/gi, "$1[redacted]"],
  // Broker account numbers (RH 9-digit and friends): any bare run of 8+ digits. Prices carry a decimal
  // point and stay; epoch seconds get masked too, which is harmless in an alert.
  [/(?<![\d.])\d{8,}(?![\d.]*\d)/g, "[num]"],
];

export function scrubText(s: string, env: Record<string, string | undefined> = typeof process !== "undefined" ? process.env : {}): string {
  let out = String(s);
  // Exact values of any secret-looking env var first, longest first so prefixes don't leave tails.
  const vals = Object.entries(env)
    .filter(([k, v]) => SECRET_ENV_PATTERN.test(k) && typeof v === "string" && v.trim().length >= 8)
    .map(([, v]) => (v as string).trim())
    .sort((a, b) => b.length - a.length);
  for (const v of vals) out = out.split(v).join("[redacted]");
  for (const [re, rep] of PATTERNS) out = out.replace(re, rep);
  return out;
}

/** Deep-scrub any JSON-ish value: secret-named keys are dropped to "[redacted]", strings are scrubbed. */
export function scrubValue<T>(v: T, env?: Record<string, string | undefined>, depth = 0): T {
  if (depth > 8) return "[deep]" as unknown as T;
  if (typeof v === "string") return scrubText(v, env) as unknown as T;
  if (Array.isArray(v)) return v.map((x) => scrubValue(x, env, depth + 1)) as unknown as T;
  if (v && typeof v === "object") {
    const o: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      o[k] = SECRET_ENV_PATTERN.test(k) || /account(_number)?|cookie|headers/i.test(k) ? "[redacted]" : scrubValue(x, env, depth + 1);
    }
    return o as T;
  }
  return v;
}
