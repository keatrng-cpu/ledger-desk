/**
 * POST /api/engine/journal — Trading-Automation pushes journal rows here.
 *
 * TanStack Start server route (`server.handlers`), NOT a Nitro `server/routes/`
 * file: `vite.config.ts` only registers the Nitro plugin when
 * `command === "build"`, so a Nitro route would 404 in `npm run dev`. Start
 * server routes are compiled by `tanstackStart()` in both dev and build.
 *
 * Auth: `Authorization: Bearer <ENGINE_BRIDGE_TOKEN>` (see bridge/auth-server).
 * Contract + examples: docs/ENGINE_BRIDGE.md.
 */

import { createFileRoute } from "@tanstack/react-router";
import {
  authorizeBridgeRequest,
  jsonResponse,
} from "@/lib/bridge/auth-server";
import { ingestEngineEvents } from "@/lib/bridge/ingest-server";
import {
  formatIssues,
  journalBatchSchema,
  MAX_EVENTS_PER_BATCH,
  toDeskEvent,
} from "@/lib/bridge/schema";

/** Raw body ceiling (~500 rows of journal JSON fits comfortably under this). */
const MAX_BODY_BYTES = 1_000_000;

async function handleJournal({
  request,
}: {
  request: Request;
}): Promise<Response> {
  const auth = authorizeBridgeRequest(request);
  if (!auth.ok) return auth.response;

  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) {
    return jsonResponse(
      { ok: false, error: "Payload too large", max_events: MAX_EVENTS_PER_BATCH },
      413,
    );
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return jsonResponse({ ok: false, error: "Body must be valid JSON" }, 400);
  }

  const parsed = journalBatchSchema.safeParse(body);
  if (!parsed.success) {
    return jsonResponse(
      {
        ok: false,
        error: "Invalid body",
        issues: formatIssues(parsed.error),
        max_events: MAX_EVENTS_PER_BATCH,
      },
      400,
    );
  }

  const batchId = parsed.data.batch_id ?? null;
  const rows = parsed.data.events.map((e) => toDeskEvent(e, batchId));

  try {
    const result = await ingestEngineEvents(auth.userId, rows, batchId);
    return jsonResponse(
      {
        ok: true,
        inserted: result.inserted,
        duplicate: result.duplicate,
        batch_id: result.batchId,
        received: rows.length,
      },
      result.duplicate ? 200 : 201,
    );
  } catch (err) {
    // Log server-side; the caller gets a generic message (no schema leakage).
    console.error("[engine-bridge] journal ingest failed:", err);
    return jsonResponse({ ok: false, error: "Ingest failed" }, 500);
  }
}

export const Route = createFileRoute("/api/engine/journal")({
  server: {
    handlers: {
      POST: handleJournal,
    },
  },
});
