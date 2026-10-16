/**
 * GET /api/desk/card-stream — SHADOW push path (shared/push-shadow.json). Server-sent events: one `card` event per new
 * desk card, for up to streamMaxS, then the client reconnects. OFF (404) unless DESK_PUSH_SHADOW=1. Read-only: it reads
 * the same /api/desk/card the watcher polls (1 s server cache), so no second card build and no account data.
 */
import { createFileRoute } from "@tanstack/react-router";
import { jsonResponse } from "@/lib/alerts/cron";
import { PUSH, pushEnabled, sseFrame } from "@/lib/desk/push-shadow";

async function get({ request }: { request: Request }): Promise<Response> {
  if (!pushEnabled(process.env)) return jsonResponse({ ok: false, error: "push shadow off" }, 404);
  const src = new URL("/api/desk/card", request.url).toString();
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(ctl) {
      const until = Date.now() + PUSH.streamMaxS * 1000; let last: string | null = null;
      ctl.enqueue(enc.encode(`retry: 500\n: shadow push stream, no orders\n\n`));
      while (Date.now() < until && !request.signal.aborted) {
        try {
          const r = await fetch(src, { headers: { "cache-control": "no-cache" } });
          if (r.ok) { const f = sseFrame(await r.json(), last, Date.now()); if (f) { last = f.at; ctl.enqueue(enc.encode(f.frame)); } }
        } catch { /* next tick */ }
        await new Promise((res) => setTimeout(res, PUSH.checkMs));
      }
      ctl.close();
    },
  });
  return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" } });
}

export const Route = createFileRoute("/api/desk/card-stream")({ server: { handlers: { GET: get } } });
