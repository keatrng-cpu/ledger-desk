/**
 * GET /api/desk/handoff — the live desk as text, for a scheduled reader.
 *
 * WHY THIS EXISTS
 * CLAUDE.md: "If the trader pastes a `=== LEDGER DESK HANDOFF ===` block, that
 * IS the live desk. Treat it as ground truth for that timestamp (note
 * lagSec)." Until now that block could only be produced by a human clicking
 * Copy for Claude with the tab open. This serves the identical block over
 * HTTP so a scheduled agent can read the desk during NY AM without anybody
 * being at the screen.
 *
 * READ-ONLY, AND THAT IS THE WHOLE DESIGN
 * This route computes nothing and decides nothing. It calls the SAME
 * `fetchTradingDesk` the browser calls and renders it with the SAME
 * `buildClaudeHandoff` the Copy button uses. If a reader of this endpoint and
 * a human looking at the tab ever disagree, that is a bug in the desk, not a
 * difference between two views of it.
 *
 * WHAT A READER OF THIS MAY AND MAY NOT DO
 * CLAUDE.md is unambiguous: "Keep scoring deterministic. No LLM in the poll
 * loop," and in-app Claude/Grok "must remain narration (no size/signal)." A
 * model reading this endpoint is in exactly that position — it may narrate the
 * tape against gates that were already computed, and it may call the trader to
 * the screen. It may not score, size, gate, or place anything. There is no
 * write path here to abuse: the route has no POST, and the execution adapter
 * is behind four independent environment switches none of which this touches.
 *
 * AUTH
 * Same bearer contract as the cron jobs (`CRON_SECRET`). The handoff carries
 * live positions, levels and account state, so it is not public.
 *
 * NO ET WINDOW GUARD, deliberately, unlike the cron routes. Those fire on a
 * schedule and guard against firing twice across DST; this is pulled by a
 * caller that already decided it wants to look. Refusing to answer at 11:31
 * would make the endpoint lie about a desk that is still running.
 */

import { createFileRoute } from "@tanstack/react-router";
import { authorizeCronRequest, jsonResponse } from "@/lib/alerts/cron";
import { fetchTradingDesk } from "@/lib/trading/build-desk";
import { buildClaudeHandoff } from "@/lib/trading/claude-handoff";
import { getSessionClock } from "@/lib/trading/sessions";

async function handleHandoff({ request }: { request: Request }): Promise<Response> {
  const auth = authorizeCronRequest(request);
  if (!auth.ok) return auth.response;

  try {
    const res = await fetchTradingDesk({ data: { left: "MNQ", right: "ES" } });
    if (!res.ok) {
      // The desk's own failure, passed through rather than dressed up. A
      // reader must be able to tell "the desk is down" from "the desk says
      // stand", because those call for opposite responses.
      return jsonResponse({ ok: false, error: res.error, desk: "unavailable" }, 503);
    }

    const clock = getSessionClock();
    const text = buildClaudeHandoff(res);

    const url = new URL(request.url);
    if (url.searchParams.get("format") === "json") {
      return jsonResponse(
        {
          ok: true,
          etTime: clock.nowEt,
          killzone: clock.killzone,
          sessionLive: clock.sessionLive ?? clock.inTradeWindow,
          sessionSource: clock.sessionSource ?? "killzone",
          lagSec: res.quotes?.left?.lagSec ?? null,
          handoff: text,
        },
        200,
      );
    }

    // Plain text by default: the handoff block is meant to be READ, and a
    // reader that has to unwrap JSON to find it will eventually be given the
    // JSON instead by mistake.
    return new Response(text, {
      status: 200,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "no-store",
      },
    });
  } catch (err) {
    // Detail server-side; the caller gets a generic message. The handoff
    // contains account state, so an error path must not echo internals.
    console.error("[desk] handoff failed:", err);
    return jsonResponse({ ok: false, error: "Handoff failed" }, 500);
  }
}

export const Route = createFileRoute("/api/desk/handoff")({
  server: {
    handlers: {
      GET: handleHandoff,
    },
  },
});
