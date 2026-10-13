import { createHash, timingSafeEqual } from "node:crypto";
/** Public-safe guard for the desk-watcher status payload (Watcher tab). */
const FORBIDDEN_KEYS = /"(password|token|access_token|refresh_token|mfa[a-z_]*|secret|buying_power|cash|equity|balance|portfolio_value)"\s*:/i;
const LONG_DIGITS = /\d{7,}/; // any full account number (or anything that looks like one)

export function safeWatcherStatus(raw: unknown): { ok: true; body: Record<string, unknown> } | { ok: false; why: string } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, why: "not an object" };
  const text = JSON.stringify(raw);
  if (text.length > 400_000) return { ok: false, why: "too large" };
  if (FORBIDDEN_KEYS.test(text)) return { ok: false, why: "carries a credential/balance field" };
  const acct = (raw as { account?: unknown }).account;
  if (acct != null && !/^••••\d{4}$/.test(String(acct))) return { ok: false, why: "account not masked" };
  // digits in prices/timestamps are fine (heartbeat ms ≤ 13 digits) — only the account must never appear
  if (/995386158/.test(text)) return { ok: false, why: "unmasked account number" };
  void LONG_DIGITS;
  return { ok: true, body: raw as Record<string, unknown> };
}

export const WATCHER_STALE_S = 30;

const eq = (a: string, b: string) => timingSafeEqual(createHash("sha256").update(a).digest(), createHash("sha256").update(b).digest());
/** POST auth: Bearer WATCHER_STATUS_TOKEN (dedicated key); CRON_SECRET accepted as a fallback. */
export function watcherAuthorized(header: string | null, env: Record<string, string | undefined> = process.env): boolean {
  const m = /^Bearer\s+(.+)$/i.exec((header ?? "").trim()); const got = m?.[1]?.trim() ?? "";
  if (!got) return false;
  const keys = [env.WATCHER_STATUS_TOKEN, env.CRON_SECRET].map((k) => k?.trim()).filter((k): k is string => Boolean(k));
  let ok = false; for (const k of keys) ok = eq(got, k) || ok;
  return ok;
}
