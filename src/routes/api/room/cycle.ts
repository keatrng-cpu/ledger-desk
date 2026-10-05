/**
 * /api/room/cycle — the trading floor's orchestrator over HTTP.
 *
 * POST  body = the trader's input schema ({ portfolio, market_data }),
 *       optionally with `context` (a RoomContext: desk read, ledger, minds)
 *       and `now_ms`. Returns the strict output JSON — room_state,
 *       floor_dialogue_and_meetings, broker_action — and nothing else, unless
 *       `?trace=1` asks for { output, trace, minds }.
 *       Without a desk read the room fails closed: it manages exits on the
 *       marks it was given and opens nothing on RSI or a trend tag.
 * GET   builds the live desk (the same fetchTradingDesk the browser uses),
 *       runs one cycle for an empty $10,000 room book, and returns it.
 *       `?drill=1` instead plays the scripted SYNTHETIC drill day end to end.
 *
 * Deterministic and paper-only: nothing here routes to a broker, and no
 * model writes a number (CLAUDE.md: no LLM in the poll loop).
 * AUTH: the same bearer contract as /api/desk/handoff (CRON_SECRET).
 */

import { createFileRoute } from "@tanstack/react-router";
import { authorizeCronRequest, jsonResponse } from "@/lib/alerts/cron";
import { fetchTradingDesk } from "@/lib/trading/build-desk";
import { evaluateOptionsDesk } from "@/lib/trading/options-desk";
import { loadPulse } from "@/lib/news/news-server";
import { marketDataFromDesk, readDeskForRoom } from "@/lib/room/desk-read";
import { playDrill, DRILL_LABEL } from "@/lib/room/drill";
import { outputViolations, runRoomCycle, type RoomContext, type RoomInput } from "@/lib/room/orchestrator";
import { emptyBook, ledgerOf, rollCounters, toRoomInput } from "@/lib/room/paper-book";

async function handlePost({ request }: { request: Request }): Promise<Response> {
  const auth = authorizeCronRequest(request);
  if (!auth.ok) return auth.response;
  let body: (RoomInput & { context?: RoomContext; now_ms?: number }) | null = null;
  try {
    body = (await request.json()) as RoomInput & { context?: RoomContext; now_ms?: number };
  } catch {
    return jsonResponse({ ok: false, error: "Body must be JSON" }, 400);
  }
  const nowMs = Number.isFinite(body?.now_ms) ? Number(body!.now_ms) : Date.now();
  const input: RoomInput = { portfolio: body?.portfolio as RoomInput["portfolio"], market_data: body?.market_data as RoomInput["market_data"] };
  const cycle = runRoomCycle(input, body?.context ?? null, nowMs);
  const bad = outputViolations(cycle.output);
  if (bad.length) {
    console.error("[room] contract violation:", bad);
    return jsonResponse({ ok: false, error: "Contract violation", violations: bad }, 500);
  }
  const trace = new URL(request.url).searchParams.get("trace") === "1";
  return jsonResponse(trace ? { output: cycle.output, trace: cycle.trace, minds: cycle.minds } : cycle.output, 200);
}

async function handleGet({ request }: { request: Request }): Promise<Response> {
  const auth = authorizeCronRequest(request);
  if (!auth.ok) return auth.response;
  const url = new URL(request.url);
  try {
    if (url.searchParams.get("drill") === "1") {
      return jsonResponse(
        {
          label: DRILL_LABEL,
          steps: playDrill().map((s) => ({ at: s.frame.at, caption: s.frame.caption, beat: s.cycle.trace.beat, meeting: s.cycle.trace.meeting?.kind ?? null, output: s.cycle.output })),
        },
        200,
      );
    }
    const res = await fetchTradingDesk({ data: { left: "MNQ", right: "ES" } });
    if (!res.ok) return jsonResponse({ ok: false, error: res.error, desk: "unavailable" }, 503);
    const nowMs = Date.parse(res.fetchedAt) || Date.now();
    const pulse = await loadPulse().catch(() => null);
    const vix = pulse?.pulse.find((p) => p.label === "VIX")?.last ?? null;
    const tenYear = pulse?.pulse.find((p) => p.label === "10y yield")?.last ?? null;
    const book = rollCounters(emptyBook(), nowMs, res.clock.killzone);
    const { market } = marketDataFromDesk(res, vix, nowMs);
    const desk = readDeskForRoom(res, evaluateOptionsDesk(res), [], nowMs, tenYear);
    const cycle = runRoomCycle(toRoomInput(book, market), { desk, ledger: ledgerOf(book) }, nowMs);
    return jsonResponse(url.searchParams.get("trace") === "1" ? { output: cycle.output, trace: cycle.trace } : cycle.output, 200);
  } catch (err) {
    console.error("[room] cycle failed:", err);
    return jsonResponse({ ok: false, error: "Room cycle failed" }, 500);
  }
}

export const Route = createFileRoute("/api/room/cycle")({
  server: {
    handlers: {
      GET: handleGet,
      POST: handlePost,
    },
  },
});
