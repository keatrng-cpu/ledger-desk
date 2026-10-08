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
import { attachGrokReport } from "@/lib/desk/grok-report";

const FRESH_MS = 20_000;
let cached: { at: number; card: DeskListenCard } | null = null;

async function withReport(card: DeskListenCard): Promise<DeskListenCard> {
  try {
    const { getSql } = await import("@/lib/db");
    const { readGrokReport } = await import("@/lib/desk/grok-report");
    return attachGrokReport(card, await readGrokReport(await getSql()));
  } catch {
    return card;
  }
}

async function handle(): Promise<Response> {
  const now = Date.now();
  try {
    if (cached && now - cached.at < FRESH_MS) {
      return jsonResponse(await withReport(cached.card), 200, { "cache-control": "no-store" });
    }
    const res = await fetchTradingDesk({ data: { left: "MNQ", right: "ES" } });
    if (!res.ok) return jsonResponse({ ok: false, error: res.error, desk: "unavailable" }, 503);
    const card = deskListenCard(res);
    cached = { at: now, card };
    return jsonResponse(await withReport(card), 200, { "cache-control": "no-store" });
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
