/**
 * Netlify schedule for GET /api/cron/rh-journal.
 *
 * Rings the reconcile route every minute from 13:00 through 21:00 UTC (covers
 * 09:30–16:00 ET in EST and EDT). The route keeps the live-trade auto-journal
 * current: it pulls the latest Robinhood option fills, binds each to its card,
 * and upserts rh_fill_journal. READ-ONLY vs Robinhood — it cannot place, close
 * or cancel an order. This file only rings it; the route is the worker.
 *
 * A site with no CRON_SECRET returns 200 (a schedule must not fail every weekday
 * before the secret exists). Errors go to Sentry when SENTRY_DSN is set.
 */
import { captureError } from "../../src/lib/notify/sentry.ts";

export default async () => {
  const secret = process.env.CRON_SECRET;
  const base = (process.env.URL || process.env.DEPLOY_PRIME_URL || "").replace(/\/$/, "");
  if (!secret || !base) {
    console.log("rh-journal skipped: CRON_SECRET or URL is unset");
    return new Response("skipped", { status: 200 });
  }
  let res;
  try {
    res = await fetch(`${base}/api/cron/rh-journal`, {
      headers: { Authorization: `Bearer ${secret}` },
    });
  } catch (err) {
    await captureError(err, { fn: "rh-journal" });
    throw err;
  }
  const body = await res.text();
  if (!res.ok && res.status !== 503) {
    console.error("rh-journal", res.status, body.slice(0, 400));
    await captureError(new Error(`rh-journal HTTP ${res.status}`), { fn: "rh-journal" });
    return new Response(body, { status: 500 });
  }
  console.log("rh-journal", res.status, body.slice(0, 400));
  return new Response(body, { status: 200 });
};

export const config = { schedule: "* 13-21 * * 1-5" };
