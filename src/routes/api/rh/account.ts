/**
 * GET /api/rh/account — the LIVE Robinhood account read for the desk chip.
 *
 * Replaces the baked-in RH_AGENTIC_SNAPSHOT (cash/BP $996.12, 2026-10-06) with
 * a real-time get_portfolio read: authoritative buying power, cash, the
 * options/investing/predictions value breakdown, and today's realized P&L from
 * get_realized_pnl. Read-only — this route never reviews or places an order.
 *
 * Session-gated (same as /api/rh/connect). When not connected it returns
 * { linked:false } so the chip keeps its last value rather than erroring.
 */
import { createFileRoute } from "@tanstack/react-router";
import { jsonResponse } from "@/lib/alerts/cron";
import { getSessionUser } from "@/lib/auth/verify.server";

function num(x: unknown): number | null {
  const v = typeof x === "number" ? x : typeof x === "string" && x.trim() !== "" ? Number(x) : NaN;
  return Number.isFinite(v) ? v : null;
}

async function handle(): Promise<Response> {
  const user = await getSessionUser();
  if (!user) return jsonResponse({ ok: false, linked: false, error: "not signed in" }, 401);
  try {
    const { getSql } = await import("@/lib/db");
    const { toolingForDesk } = await import("@/lib/execution/rh-mcp");
    const { managerRhAccountFromConnector } = await import("@/lib/execution/manager-account");
    const { RH_PREFERRED_ACCOUNT_NUMBER } = await import("@/lib/execution/rh-autofire-gates");
    const sql = await getSql();
    const tooling = await toolingForDesk(sql, user.id);
    if (!tooling) return jsonResponse({ ok: true, linked: false }, 200);

    const read = await tooling.readAccount();
    if (!read) return jsonResponse({ ok: true, linked: true, account: null, error: "no portfolio" }, 200);

    const account = managerRhAccountFromConnector({
      account: read.account as Parameters<typeof managerRhAccountFromConnector>[0]["account"],
      portfolio: read.portfolio as Parameters<typeof managerRhAccountFromConnector>[0]["portfolio"],
      asOf: new Date().toISOString(),
    });

    const p = (read.portfolio ?? {}) as Record<string, unknown>;
    const breakdown = {
      total: num(p.total_value),
      cash: num(p.cash),
      options: num(p.options_value),
      equity: num(p.equity_value),
      predictions: num(p.event_contracts_value),
      crypto: num(p.crypto_value),
      futures: num(p.futures_value),
    };

    let dayRealized: number | null = null;
    let dayRealizedPct: number | null = null;
    if (tooling.raw) {
      try {
        const pnl = (await tooling.raw("get_realized_pnl", { account_number: RH_PREFERRED_ACCOUNT_NUMBER, span: "day" })) as Record<string, unknown>;
        dayRealized = num(pnl.total_returns);
        dayRealizedPct = num(pnl.total_rate_of_return);
      } catch {
        /* realized is a nice-to-have; the chip still updates without it */
      }
    }

    return jsonResponse(
      { ok: true, linked: true, account, breakdown, dayRealized, dayRealizedPct, asOf: account.asOf },
      200,
      { "cache-control": "no-store" },
    );
  } catch (err) {
    return jsonResponse({ ok: false, linked: false, error: err instanceof Error ? err.message.slice(0, 200) : "read failed" }, 200);
  }
}

export const Route = createFileRoute("/api/rh/account")({
  server: { handlers: { GET: handle } },
});
