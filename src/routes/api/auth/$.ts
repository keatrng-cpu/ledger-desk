/**
 * `/api/auth/*` — the Better Auth request handler.
 *
 * WHY THIS FILE DID NOT EXIST, AND WHAT IT COST
 * `src/lib/auth/server.ts` constructs a fully configured Better Auth instance,
 * `client.ts` points at same-origin `/api/auth/*`, and `middleware.ts` verifies
 * sessions against it — but nothing ever MOUNTED it. Every auth call returned
 * 404: `get-session`, `sign-in`, `sign-up`, all of it. Combined with the
 * missing `/login` route that `gates.tsx` pointed at, there was no reachable
 * path to a session at all.
 *
 * Because `authMiddleware` throws `UnauthorizedError` when signed out, and
 * `openTrade`/`closeTrade` sit behind it, that made every write to
 * `desk_trades` fail — which is why the journal read 0 rows while the desk
 * itself looked healthy. Reads fall back to local state, so nothing surfaced
 * the break. This is the fix for the root cause, not the symptom.
 *
 * A splat route (`$`) rather than named routes because Better Auth owns its
 * whole URL space — sign-in, sign-out, session, callbacks, and every provider
 * path — and that set changes with configuration.
 */

import { createFileRoute } from "@tanstack/react-router";
import { auth } from "@/lib/auth/server";

/**
 * Hand the raw Request straight to Better Auth.
 *
 * No parsing, no body limit, no logging of the request contents: this endpoint
 * carries passwords and session tokens, and anything we do to the payload on
 * the way past is a place they can leak. Errors are logged without the body.
 */
async function handle({ request }: { request: Request }): Promise<Response> {
  try {
    return await auth.handler(request);
  } catch (err) {
    // Never echo `err` to the client — Better Auth errors can carry token and
    // account detail. The trader gets a status; the server keeps the reason.
    console.error(
      `[auth] handler failed for ${new URL(request.url).pathname}:`,
      err instanceof Error ? err.message : err,
    );
    return new Response(JSON.stringify({ error: "Authentication failed" }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
}

export const Route = createFileRoute("/api/auth/$")({
  server: {
    handlers: {
      GET: handle,
      POST: handle,
    },
  },
});
