/**
 * Netlify schedule for GET /api/cron/weekly-cost — Sunday 18:30 ET (22:30 and 23:30 UTC; the route keeps the 18:xx ET one).
 * Same pattern as room-step.mjs: this file only rings the SSR route (which holds the auth, the ET guard and the
 * work). No CRON_SECRET or URL → 200 "skipped", so a schedule never fails before the secret exists.
 * Errors go to Sentry when SENTRY_DSN is set; a no-op otherwise.
 */
import { captureError } from "../../src/lib/notify/sentry.ts";

export default async () => {
  const secret = process.env.CRON_SECRET;
  const base = (process.env.URL || process.env.DEPLOY_PRIME_URL || "").replace(/\/$/, "");
  if (!secret || !base) {
    console.log("weekly-cost skipped: CRON_SECRET or URL is unset");
    return new Response("skipped", { status: 200 });
  }
  let res;
  try {
    res = await fetch(`${base}/api/cron/weekly-cost`, { headers: { Authorization: `Bearer ${secret}` } });
  } catch (err) {
    await captureError(err, { fn: "weekly-cost" });
    throw err;
  }
  const body = await res.text();
  if (!res.ok && res.status !== 503) {
    console.error("weekly-cost", res.status, body.slice(0, 400));
    await captureError(new Error(`weekly-cost HTTP ${res.status}`), { fn: "weekly-cost" });
    return new Response(body, { status: 500 });
  }
  console.log("weekly-cost", res.status, body.slice(0, 400));
  return new Response(body, { status: 200 });
};

export const config = { schedule: "30 22,23 * * 0" };
