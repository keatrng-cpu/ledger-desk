/**
 * Netlify schedule for GET /api/cron/actuals — weekdays 08:45 ET (12:45 and 13:45 UTC; the route keeps the 08:xx ET one).
 * Same pattern as room-step.mjs: this file only rings the SSR route (which holds the auth, the ET guard and the
 * work). No CRON_SECRET or URL → 200 "skipped", so a schedule never fails before the secret exists.
 * Errors go to Sentry when SENTRY_DSN is set; a no-op otherwise.
 */
import { captureError } from "../../src/lib/notify/sentry.ts";

export default async () => {
  const secret = process.env.CRON_SECRET;
  const base = (process.env.URL || process.env.DEPLOY_PRIME_URL || "").replace(/\/$/, "");
  if (!secret || !base) {
    console.log("actuals skipped: CRON_SECRET or URL is unset");
    return new Response("skipped", { status: 200 });
  }
  let res;
  try {
    res = await fetch(`${base}/api/cron/actuals`, { headers: { Authorization: `Bearer ${secret}` } });
  } catch (err) {
    await captureError(err, { fn: "actuals" });
    throw err;
  }
  const body = await res.text();
  if (!res.ok && res.status !== 503) {
    console.error("actuals", res.status, body.slice(0, 400));
    await captureError(new Error(`actuals HTTP ${res.status}`), { fn: "actuals" });
    return new Response(body, { status: 500 });
  }
  console.log("actuals", res.status, body.slice(0, 400));
  return new Response(body, { status: 200 });
};

export const config = { schedule: "45 12,13 * * 1-5" };
