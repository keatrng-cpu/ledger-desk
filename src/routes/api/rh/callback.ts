/**
 * GET /api/rh/callback — Robinhood returns the code. The refresh token is
 * stored for this trader. The browser is not given the token. A later visit
 * to the desk uses the stored row.
 */
import { createFileRoute } from "@tanstack/react-router";
import { getSessionUser } from "@/lib/auth/verify.server";
import { PKCE_COOKIE, exchangeCode, unpackPkce } from "@/lib/execution/rh-oauth";

function page(status: number, text: string): Response {
  return new Response(`<!doctype html><meta charset="utf-8"><title>Robinhood</title><p>${text}</p><p><a href="/">Back to the desk</a></p>`, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}

function cookieValue(request: Request, name: string): string | null {
  const raw = request.headers.get("cookie") ?? "";
  for (const part of raw.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

async function handle({ request }: { request: Request }): Promise<Response> {
  const user = await getSessionUser();
  if (!user) return new Response(null, { status: 302, headers: { Location: "/login" } });
  const url = new URL(request.url);
  const err = url.searchParams.get("error");
  if (err) return page(400, "Robinhood did not complete the sign-in.");
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const packed = unpackPkce(cookieValue(request, PKCE_COOKIE) ?? "");
  const clear = `${PKCE_COOKIE}=; HttpOnly; SameSite=Lax; Path=/api/rh; Max-Age=0`;
  if (!code || !state || !packed || packed.s !== state || packed.u !== user.id) {
    return page(400, "This sign-in did not match the desk session. Connect again from the floor.");
  }
  try {
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    const origin = url.origin;
    const redirectUri = `${origin}/api/rh/callback`;
    const { clientIdFor } = await import("@/lib/execution/rh-oauth");
    const clientId = await clientIdFor(sql, redirectUri);
    await exchangeCode(sql, { userId: user.id, clientId, redirectUri, code, verifier: packed.v });
    return new Response(null, {
      status: 302,
      headers: { Location: "/", "Set-Cookie": clear, "Cache-Control": "no-store" },
    });
  } catch (e) {
    const why = e instanceof Error ? e.message : "Robinhood did not return a session.";
    const res = page(502, why);
    res.headers.append("Set-Cookie", clear);
    return res;
  }
}

export const Route = createFileRoute("/api/rh/callback")({
  server: {
    handlers: { GET: handle },
  },
});
