/**
 * /api/desk/chat-trades — trades Keaton + assistant took from chat, for the Review tab.
 * GET → rows (chat_trades table when present, else the bundled journal), shadow priors,
 * and a marked-up closed-bar SVG chart per trade. Read-only, session-gated. Never a gate input.
 */
import { createFileRoute } from "@tanstack/react-router";
import { jsonResponse } from "@/lib/alerts/cron";
import { getSessionUser } from "@/lib/auth/verify.server";
import { chatSetupPriors, chatTradeChartSvg, mergeChatTrades, type ChatTrade } from "@/lib/trading/chat-trades";
import { CHAT_BARS, CHAT_TRADES } from "@/lib/trading/chat-trades-data";

async function get(): Promise<Response> {
  const user = await getSessionUser();
  if (!user) return jsonResponse({ ok: false, error: "not signed in" }, 401);
  let rows: ChatTrade[] = CHAT_TRADES;
  let source = "bundled";
  try {
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    const db = await sql.query<{ body: ChatTrade }>(`select body from chat_trades where user_id = $1 order by day_key desc limit 500`, [user.id]);
    if (db.length) { rows = mergeChatTrades(db.map((r) => r.body), CHAT_TRADES); source = "chat_trades"; }
  } catch { /* table not migrated yet → bundled */ }
  const trades = rows.map((t) => ({ ...t, chartSvg: CHAT_BARS[`${t.symbol}-${t.day}`] ? chatTradeChartSvg(t, CHAT_BARS[`${t.symbol}-${t.day}`]) : null }));
  return jsonResponse({ ok: true, source, trades, priors: chatSetupPriors(rows), live: false }, 200, { "cache-control": "no-store" });
}

export const Route = createFileRoute("/api/desk/chat-trades")({ server: { handlers: { GET: get } } });
