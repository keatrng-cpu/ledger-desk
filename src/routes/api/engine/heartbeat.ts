/**
 * POST /api/engine/heartbeat — engine liveness ping.
 *
 * Deliberately NOT a desk_events row: the event enum
 * (CANDIDATE|SKIP|ENTRY|EXIT|HALT) is the engine's journal vocabulary and a
 * heartbeat is not a journal event — writing one as `HALT` would corrupt every
 * halt count and metric. Heartbeats upsert `engine_status`
 * (migrations/0004_bridge.sql) instead, one row per user.
 *
 * Same bearer-token contract as /api/engine/journal.
 */

import { createFileRoute } from "@tanstack/react-router";
import {
  authorizeBridgeRequest,
  jsonResponse,
} from "@/lib/bridge/auth-server";
import { recordHeartbeat } from "@/lib/bridge/ingest-server";
import { ENGINE_MODES, formatIssues, heartbeatSchema } from "@/lib/bridge/schema";

const MAX_BODY_BYTES = 8_192;

async function handleHeartbeat({
  request,
}: {
  request: Request;
}): Promise<Response> {
  const auth = authorizeBridgeRequest(request);
  if (!auth.ok) return auth.response;

  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) {
    return jsonResponse({ ok: false, error: "Payload too large" }, 413);
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return jsonResponse({ ok: false, error: "Body must be valid JSON" }, 400);
  }

  const parsed = heartbeatSchema.safeParse(body);
  if (!parsed.success) {
    return jsonResponse(
      {
        ok: false,
        error: "Invalid body",
        issues: formatIssues(parsed.error),
        modes: ENGINE_MODES,
      },
      400,
    );
  }

  try {
    const status = await recordHeartbeat(auth.userId, parsed.data);
    return jsonResponse(
      {
        ok: true,
        last_seen: status.last_seen,
        mode: status.mode,
        symbol: status.symbol,
        // Lets the engine see whether the desk paper loop is armed.
        paper_enabled: status.paper_enabled,
      },
      200,
    );
  } catch (err) {
    console.error("[engine-bridge] heartbeat failed:", err);
    return jsonResponse({ ok: false, error: "Heartbeat failed" }, 500);
  }
}

export const Route = createFileRoute("/api/engine/heartbeat")({
  server: {
    handlers: {
      POST: handleHeartbeat,
    },
  },
});
