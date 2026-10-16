/**
 * 8:20 CT pre-open check → Slack (SLACK_DESK_WEBHOOK_URL) and Sentry (SENTRY_DSN). Both optional: with
 * neither set this only logs. Reads the public /api/desk/watcher feed; needs no secret and sends no order.
 * Runs at 13:20 and 14:20 UTC on weekdays; isPreopenSlot keeps only the one that is 08:20 Chicago time.
 */
import { notifyDesk } from "../../src/lib/notify/desk-alert.ts";
import { captureError } from "../../src/lib/notify/sentry.ts";
import { evaluatePreopen, isPreopenSlot } from "../../src/lib/notify/preopen.ts";
import { RULES_HASH } from "../../src/lib/desk/rules-hash.ts";

export default async () => {
  const now = Date.now();
  if (!isPreopenSlot(now)) return new Response("not 08:20 CT", { status: 200 });
  const base = (process.env.URL || process.env.DEPLOY_PRIME_URL || "").replace(/\/$/, "");
  let feed = null;
  try {
    if (base) {
      const res = await fetch(`${base}/api/desk/watcher`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(5000) });
      feed = res.ok ? await res.json() : { ok: false };
    }
  } catch (err) {
    await captureError(err, { fn: "desk-preopen" });
  }
  const v = evaluatePreopen(feed, RULES_HASH, now);
  for (const e of v.events) await notifyDesk(e);
  console.log("desk-preopen", v.ok ? "PASS" : "FAIL", v.failures.join("; "));
  return new Response(JSON.stringify({ ok: v.ok, failures: v.failures }), { status: 200, headers: { "content-type": "application/json" } });
};

export const config = { schedule: "20 13,14 * * 1-5" };
