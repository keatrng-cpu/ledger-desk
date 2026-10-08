/**
 * GET /api/rh/connect — start the one Robinhood sign-in.
 *
 * The trader must already be signed into the desk. The browser is sent to
 * Robinhood. The refresh token comes back to /api/rh/callback and is stored
 * on the server. This route does not place an order.
 */
import { createFileRoute } from "@tanstack/react-router";
import { randomBytes } from "node:crypto";
import { getSessionUser } from "@/lib/auth/verify.server";
import { PKCE_COOKIE, authorizeUrl, clientIdFor, packPkce, pkcePair } from "@/lib/execution/rh-oauth";

function page(status: number, text: string): Response {
  return new Response(`<!doctype html><meta charset="utf-8"><title>Robinhood</title><p>${text}</p><p><a href="/">Back to the desk</a></p>`, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}

async function handle({ request }: { request: Request }): Promise<Response> {
  const user = await getSessionUser();
  if (!user) return new Response(null, { status: 302, headers: { Location: "/login" } });
  try {
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    const origin = new URL(request.url).origin;
    const redirectUri = `${origin}/api/rh/callback`;
    const clientId = await clientIdFor(sql, redirectUri);
    const { verifier, challenge } = pkcePair();
    const state = randomBytes(16).toString("base64url");
    const secure = origin.startsWith("https://") ? "; Secure" : "";
    const cookie = `${PKCE_COOKIE}=${packPkce({ s: state, v: verifier, u: user.id })}; HttpOnly; SameSite=Lax; Path=/api/rh; Max-Age=600${secure}`;
    return new Response(null, {
      status: 302,
      headers: {
        Location: authorizeUrl({ clientId, redirectUri, state, challenge }),
        "Set-Cookie": cookie,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    const why = err instanceof Error ? err.message : "Robinhood sign-in did not start.";
    return page(502, why);
  }
}

export const Route = createFileRoute("/api/rh/connect")({
  server: {
    handlers: { GET: handle },
  },
});
