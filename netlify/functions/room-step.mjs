/**
 * Netlify schedule for GET /api/cron/room-step.
 *
 * The step lives on the SSR route — that is the function with the database.
 * This file only rings it. Every five minutes from 13:00 through 21:00 UTC
 * covers 09:30–16:00 ET in both EST and EDT. The route skips anything
 * outside the options session, so the extra hours do not trade.
 *
 * A site with no CRON_SECRET returns 200. A schedule must not fail every
 * weekday before the secret exists. This file only rings the route. The
 * route is the sender.
 */

export default async () => {
  const secret = process.env.CRON_SECRET;
  const base = (process.env.URL || process.env.DEPLOY_PRIME_URL || "").replace(/\/$/, "");
  if (!secret || !base) {
    console.log("room-step skipped: CRON_SECRET or URL is unset");
    return new Response("skipped", { status: 200 });
  }
  const res = await fetch(`${base}/api/cron/room-step`, {
    headers: { Authorization: `Bearer ${secret}` },
  });
  const body = await res.text();
  if (!res.ok && res.status !== 503) {
    console.error("room-step", res.status, body.slice(0, 400));
    return new Response(body, { status: 500 });
  }
  console.log("room-step", res.status, body.slice(0, 400));
  return new Response(body, { status: 200 });
};

export const config = { schedule: "*/5 13-21 * * 1-5" };
