/**
 * Bridge auth — shared-secret bearer check for the `/api/engine/*` endpoints.
 *
 * These endpoints are called by the Python Trading-Automation process, which has
 * no browser session, so the normal `authMiddleware` cookie path cannot apply.
 * The contract instead is:
 *
 *   Authorization: Bearer <ENGINE_BRIDGE_TOKEN>
 *
 * Rules (all enforced here, never at a call site):
 *   - `ENGINE_BRIDGE_TOKEN` unset/blank  -> 503, generic message, no DB writes.
 *     There is deliberately no "open" mode: a missing secret disables the bridge
 *     rather than dropping the gate.
 *   - Wrong / missing / malformed header -> 401, generic message. Never echo the
 *     supplied value, never say which part failed.
 *   - Comparison is constant-time over SHA-256 digests, so neither the token
 *     length nor a shared prefix is observable through timing.
 *
 * Rows written through the bridge are attributed to `ENGINE_BRIDGE_USER_ID`
 * (default `dev-user` — the preview user id used across this repo).
 */

import { createHash, timingSafeEqual } from "node:crypto";

export const DEFAULT_BRIDGE_USER_ID = "dev-user";

function envValue(name: string): string | undefined {
  const raw = typeof process !== "undefined" ? process.env[name] : undefined;
  return raw && raw.trim() ? raw.trim() : undefined;
}

/** The configured shared secret, or undefined when unset/blank. */
export function bridgeToken(): string | undefined {
  return envValue("ENGINE_BRIDGE_TOKEN");
}

/** User id every bridge-written row is attributed to. */
export function bridgeUserId(): string {
  return envValue("ENGINE_BRIDGE_USER_ID") ?? DEFAULT_BRIDGE_USER_ID;
}

/** Length-independent constant-time equality (compares SHA-256 digests). */
function secureEquals(a: string, b: string): boolean {
  const da = createHash("sha256").update(a, "utf8").digest();
  const db = createHash("sha256").update(b, "utf8").digest();
  return timingSafeEqual(da, db);
}

export type BridgeAuthResult =
  | { ok: true; userId: string }
  | { ok: false; response: Response };

/** JSON body helper — bridge responses are always JSON, never HTML. */
export function jsonResponse(
  body: unknown,
  status: number,
  headers?: Record<string, string>,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      // Never let a proxy or browser cache a bridge answer.
      "cache-control": "no-store",
      ...headers,
    },
  });
}

/**
 * Authorize an inbound bridge request. Returns the resolved user id, or a ready
 * Response (503 unconfigured / 401 rejected) that the caller returns verbatim.
 */
export function authorizeBridgeRequest(request: Request): BridgeAuthResult {
  const expected = bridgeToken();
  if (!expected) {
    return {
      ok: false,
      response: jsonResponse(
        { ok: false, error: "Bridge unavailable" },
        503,
      ),
    };
  }

  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  const presented = match?.[1]?.trim() ?? "";
  // Always run the compare (even for an empty presented value) so the rejected
  // path costs the same regardless of how the header was malformed.
  const authorized = secureEquals(presented, expected) && presented.length > 0;
  if (!authorized) {
    return {
      ok: false,
      response: jsonResponse({ ok: false, error: "Unauthorized" }, 401, {
        "www-authenticate": "Bearer",
      }),
    };
  }

  return { ok: true, userId: bridgeUserId() };
}
