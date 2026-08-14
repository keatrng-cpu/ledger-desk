/**
 * ROADMAP E2 — Tradovate transport. Auth, token cache, and one HTTP surface.
 *
 * ENVIRONMENT SAFETY, which is the whole point of this file:
 *   - `demo.tradovateapi.com` is the DEFAULT and the fallback for every
 *     unrecognised value of TRADOVATE_ENV. Reaching the live host requires
 *     someone to have typed exactly "live" into a deployment env var.
 *   - The live host additionally requires TRADOVATE_LIVE_ARMED=true, checked
 *     in execution-gate.ts. Two independent switches, both set outside the
 *     app, so no code path and no UI click can promote demo to live as a
 *     side effect of anything else.
 *
 * CREDENTIALS. Read from process.env at call time and never returned,
 * logged, cached to disk, or included in an error message. Nothing in this
 * repo stores them; they live in the host's environment settings only. Per
 * ROADMAP Phase E's own note: credentials stay under the owner's hand.
 *
 * TOKENS. Tradovate access tokens are short-lived. They are cached in module
 * memory keyed by environment, with a safety margin before expiry, and are
 * never persisted — a serverless cold start simply re-authenticates.
 */

import { executionEnv, type ExecutionEnv } from "./execution-gate";

const HOSTS: Record<ExecutionEnv, string> = {
  demo: "https://demo.tradovateapi.com/v1",
  live: "https://live.tradovateapi.com/v1",
};

/** Re-auth this many ms before the token actually expires. */
const TOKEN_MARGIN_MS = 60_000;
/** Network timeout. Netlify functions cap well below this; fail fast. */
const REQUEST_TIMEOUT_MS = 12_000;

interface CachedToken {
  accessToken: string;
  expiresAtMs: number;
  /** Tradovate returns the account list with the token; cached alongside. */
  accountId: number | null;
  accountSpec: string | null;
}

const tokenCache = new Map<ExecutionEnv, CachedToken>();

export function tradovateBaseUrl(env: ExecutionEnv = executionEnv()): string {
  return HOSTS[env] ?? HOSTS.demo;
}

function requireEnv(name: string): string {
  const v = typeof process !== "undefined" ? process.env[name] : undefined;
  if (!v || !v.trim()) {
    // Names only — never the value, and never a partial value.
    throw new Error(`Tradovate: ${name} is not set`);
  }
  return v.trim();
}

async function fetchJson<T>(
  url: string,
  init: RequestInit,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    const text = await res.text();
    if (!res.ok) {
      // Tradovate error bodies can echo the request. Truncate hard so a
      // credential can never ride out inside an error string.
      throw new Error(
        `Tradovate ${init.method ?? "GET"} ${new URL(url).pathname} -> ${res.status} ${text.slice(0, 200)}`,
      );
    }
    return (text ? JSON.parse(text) : {}) as T;
  } finally {
    clearTimeout(timer);
  }
}

interface AccessTokenResponse {
  accessToken?: string;
  expirationTime?: string;
  userId?: number;
  /** Present on failure instead of a token. */
  errorText?: string;
  "p-ticket"?: string;
}

/**
 * Authenticate and cache. Safe to call on every request — a live token is
 * reused until it is close to expiry.
 */
export async function tradovateToken(
  env: ExecutionEnv = executionEnv(),
): Promise<CachedToken> {
  const cached = tokenCache.get(env);
  if (cached && cached.expiresAtMs - TOKEN_MARGIN_MS > Date.now()) return cached;

  const body = {
    name: requireEnv("TRADOVATE_USERNAME"),
    password: requireEnv("TRADOVATE_PASSWORD"),
    appId: requireEnv("TRADOVATE_APP_ID"),
    appVersion: process.env.TRADOVATE_APP_VERSION?.trim() || "1.0",
    cid: requireEnv("TRADOVATE_CID"),
    sec: requireEnv("TRADOVATE_SECRET"),
  };

  const res = await fetchJson<AccessTokenResponse>(
    `${tradovateBaseUrl(env)}/auth/accesstokenrequest`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );

  if (res["p-ticket"]) {
    // Tradovate throttles repeated auth with a time penalty ticket. Surface
    // it plainly rather than hammering the endpoint.
    throw new Error(
      "Tradovate: auth throttled (p-ticket issued). Wait for the penalty window before retrying.",
    );
  }
  if (!res.accessToken) {
    throw new Error(`Tradovate: auth failed${res.errorText ? ` — ${res.errorText}` : ""}`);
  }

  const expiresAtMs = res.expirationTime
    ? new Date(res.expirationTime).getTime()
    : Date.now() + 15 * 60_000;

  const token: CachedToken = {
    accessToken: res.accessToken,
    expiresAtMs,
    accountId: null,
    accountSpec: null,
  };

  // Resolve the trading account once per token — every order needs both the
  // numeric id and the spec/name.
  try {
    const accounts = await fetchJson<
      { id: number; name: string; active?: boolean }[]
    >(`${tradovateBaseUrl(env)}/account/list`, {
      headers: { authorization: `Bearer ${res.accessToken}` },
    });
    const account = accounts.find((a) => a.active !== false) ?? accounts[0];
    if (account) {
      token.accountId = account.id;
      token.accountSpec = account.name;
    }
  } catch {
    // Leave unresolved; the order path refuses to send without an account.
  }

  tokenCache.set(env, token);
  return token;
}

/** Authenticated request against the resolved environment. */
export async function tradovateRequest<T>(
  path: string,
  init: RequestInit = {},
  env: ExecutionEnv = executionEnv(),
): Promise<T> {
  const token = await tradovateToken(env);
  return fetchJson<T>(`${tradovateBaseUrl(env)}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init.headers ?? {}),
      authorization: `Bearer ${token.accessToken}`,
    },
  });
}

/** Clears cached tokens. Used by the kill switch and by tests. */
export function resetTradovateAuth(): void {
  tokenCache.clear();
}
