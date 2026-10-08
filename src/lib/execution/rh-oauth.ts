/**
 * The website's Robinhood sign-in.
 *
 * One click starts OAuth (PKCE, public client, scope internal). The callback
 * stores the refresh token in Postgres. Opening the desk again reads that
 * row. It does not start OAuth again. A revoked refresh is the only time
 * the trader connects again.
 *
 * The token never goes to the browser, git, or a log line.
 */
import { createHash, randomBytes } from "node:crypto";
import type { Sql } from "@/lib/db";

export const MCP_RESOURCE = "https://agent.robinhood.com/mcp/trading";
export const RH_AUTHORIZE = "https://robinhood.com/oauth";
export const RH_TOKEN = "https://api.robinhood.com/oauth2/token/";
export const RH_REGISTER = "https://agent.robinhood.com/oauth/trading/register";
export const PKCE_COOKIE = "rh_pkce";

export interface OauthRow {
  userId: string;
  clientId: string;
  redirectUri: string;
  refreshToken: string;
  accessToken: string | null;
  accessExpiresAt: number | null;
}

export interface PkcePack {
  s: string;
  v: string;
  u: string;
}

type FetchLike = typeof fetch;

export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export function packPkce(p: PkcePack): string {
  return Buffer.from(JSON.stringify(p), "utf8").toString("base64url");
}

export function unpackPkce(raw: string): PkcePack | null {
  try {
    const p = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as PkcePack;
    if (!p || typeof p.s !== "string" || typeof p.v !== "string" || typeof p.u !== "string") return null;
    return p;
  } catch {
    return null;
  }
}

export function authorizeUrl(args: { clientId: string; redirectUri: string; state: string; challenge: string }): string {
  const q = new URLSearchParams({
    response_type: "code",
    client_id: args.clientId,
    redirect_uri: args.redirectUri,
    scope: "internal",
    state: args.state,
    code_challenge: args.challenge,
    code_challenge_method: "S256",
    resource: MCP_RESOURCE,
  });
  return `${RH_AUTHORIZE}?${q.toString()}`;
}

/** Form body for the token endpoint. A refresh does not send the authorization code. */
export function tokenForm(fields: Record<string, string>): string {
  return new URLSearchParams(fields).toString();
}

export function codeExchangeForm(args: { clientId: string; redirectUri: string; code: string; verifier: string }): string {
  return tokenForm({
    grant_type: "authorization_code",
    client_id: args.clientId,
    redirect_uri: args.redirectUri,
    code: args.code,
    code_verifier: args.verifier,
    resource: MCP_RESOURCE,
  });
}

export function refreshForm(args: { clientId: string; refreshToken: string }): string {
  return tokenForm({
    grant_type: "refresh_token",
    client_id: args.clientId,
    refresh_token: args.refreshToken,
    resource: MCP_RESOURCE,
  });
}

export async function readOauth(sql: Sql, userId: string): Promise<OauthRow | null> {
  const rows = await sql.query<{
    user_id: string;
    client_id: string;
    redirect_uri: string;
    refresh_token: string;
    access_token: string | null;
    access_expires_at: number | null;
  }>(
    `select user_id, client_id, redirect_uri, refresh_token, access_token, access_expires_at from rh_oauth where user_id = $1`,
    [userId],
  );
  const r = rows[0];
  if (!r?.refresh_token || !r.client_id) return null;
  const exp = r.access_expires_at == null ? null : Number(r.access_expires_at);
  return {
    userId: r.user_id,
    clientId: r.client_id,
    redirectUri: r.redirect_uri,
    refreshToken: r.refresh_token,
    accessToken: r.access_token,
    accessExpiresAt: exp != null && Number.isFinite(exp) ? exp : null,
  };
}

export async function writeOauth(sql: Sql, row: OauthRow, nowMs: number): Promise<void> {
  await sql.query(
    `insert into rh_oauth (user_id, client_id, redirect_uri, refresh_token, access_token, access_expires_at, updated_at)
     values ($1, $2, $3, $4, $5, $6, $7)
     on conflict (user_id) do update set
       client_id = excluded.client_id,
       redirect_uri = excluded.redirect_uri,
       refresh_token = excluded.refresh_token,
       access_token = excluded.access_token,
       access_expires_at = excluded.access_expires_at,
       updated_at = excluded.updated_at`,
    [row.userId, row.clientId, row.redirectUri, row.refreshToken, row.accessToken, row.accessExpiresAt, nowMs],
  );
}

export async function dropOauth(sql: Sql, userId: string): Promise<void> {
  await sql.query(`delete from rh_oauth where user_id = $1`, [userId]);
}

async function readJson(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

/** One public client per redirect URI. Re-registering would orphan the refresh token. */
export async function clientIdFor(sql: Sql, redirectUri: string, fetchImpl: FetchLike = fetch): Promise<string> {
  const found = await sql.query<{ client_id: string }>(`select client_id from rh_oauth_client where redirect_uri = $1`, [redirectUri]);
  if (found[0]?.client_id) return found[0].client_id;
  const res = await fetchImpl(RH_REGISTER, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      client_name: "Ledger Desk",
      redirect_uris: [redirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      scope: "internal",
    }),
  });
  const body = (await readJson(res)) as { client_id?: string; error?: string } | null;
  if (!res.ok || !body?.client_id) {
    throw new Error(body?.error || `Robinhood did not register this site (${res.status}).`);
  }
  await sql.query(
    `insert into rh_oauth_client (redirect_uri, client_id) values ($1, $2)
     on conflict (redirect_uri) do update set client_id = excluded.client_id`,
    [redirectUri, body.client_id],
  );
  return body.client_id;
}

interface TokenBody {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
}

async function postToken(form: string, fetchImpl: FetchLike): Promise<{ status: number; body: TokenBody | null }> {
  const res = await fetchImpl(RH_TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: form,
  });
  return { status: res.status, body: (await readJson(res)) as TokenBody | null };
}

export async function exchangeCode(
  sql: Sql,
  args: { userId: string; clientId: string; redirectUri: string; code: string; verifier: string },
  fetchImpl: FetchLike = fetch,
  nowMs = Date.now(),
): Promise<void> {
  const posted = await postToken(codeExchangeForm(args), fetchImpl);
  const body = posted.body;
  if (posted.status >= 400 || !body?.access_token || !body.refresh_token) {
    throw new Error(body?.error || "Robinhood did not return a session.");
  }
  const expires = typeof body.expires_in === "number" ? nowMs + body.expires_in * 1000 : nowMs + 5 * 60_000;
  await writeOauth(
    sql,
    {
      userId: args.userId,
      clientId: args.clientId,
      redirectUri: args.redirectUri,
      refreshToken: body.refresh_token,
      accessToken: body.access_token,
      accessExpiresAt: expires,
    },
    nowMs,
  );
}

/**
 * A usable access token. Refreshes when the stored one is inside a minute of
 * expiry. The new refresh token, when Robinhood rotates it, replaces the old
 * one. invalid_grant drops the row so the desk asks for one new sign-in.
 */
export async function ensureAccess(
  sql: Sql,
  row: OauthRow,
  fetchImpl: FetchLike = fetch,
  nowMs = Date.now(),
): Promise<string | null> {
  if (row.accessToken && row.accessExpiresAt != null && row.accessExpiresAt - nowMs > 60_000) return row.accessToken;
  const posted = await postToken(refreshForm({ clientId: row.clientId, refreshToken: row.refreshToken }), fetchImpl);
  const body = posted.body;
  if (posted.status >= 400 || !body?.access_token) {
    if (posted.status === 400 || posted.status === 401) await dropOauth(sql, row.userId);
    return null;
  }
  const expires = typeof body.expires_in === "number" ? nowMs + body.expires_in * 1000 : nowMs + 5 * 60_000;
  const next: OauthRow = {
    ...row,
    refreshToken: body.refresh_token || row.refreshToken,
    accessToken: body.access_token,
    accessExpiresAt: expires,
  };
  await writeOauth(sql, next, nowMs);
  return body.access_token;
}
