/**
 * GET /api/desk/card — scanner, floor, and brain. No account, no positions.
 *
 * The handoff stays behind the cron secret. Grok's webhook trigger exists,
 * but the create call does not return the endpoint or the signing secret,
 * so the site cannot POST to it. This read is the path that works.
 */
import { createFileRoute } from "@tanstack/react-router";
import { jsonResponse } from "@/lib/alerts/cron";
import { fetchTradingDesk } from "@/lib/trading/build-desk";
import { deskListenCard, type DeskListenCard } from "@/lib/trading/desk-listen";

const FRESH_MS = 20_000;
let cached: { at: number; card: DeskListenCard } | null = null;

async function handle(): Promise<Response> {
  const now = Date.now();
  if (cached && now - cached.at < FRESH_MS) {
    return jsonResponse(cached.card, 200);
  }
  try {
    const res = await fetchTradingDesk({ data: { left: "MNQ", right: "ES" } });
    if (!res.ok) return jsonResponse({ ok: false, error: res.error, desk: "unavailable" }, 503);
    const card = deskListenCard(res);
    cached = { at: now, card };
    return jsonResponse(card, 200, { "cache-control": "no-store" });
  } catch (err) {
    console.error("[desk] card failed:", err);
    return jsonResponse({ ok: false, error: "Desk card failed" }, 500);
  }
}

export const Route = createFileRoute("/api/desk/card")({
  server: {
    handlers: { GET: handle },
  },
});
