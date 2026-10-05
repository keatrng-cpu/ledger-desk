/**
 * Netlify schedule for GET /api/cron/exec-flatten.
 *
 * The flatten itself lives on the SSR route — that is the function with the
 * database. This file only rings it. vercel.json already does, on Vercel.
 * Netlify does not read vercel.json, so a closed tab was carrying an
 * automated option through the cash session.
 *
 * 19:35 and 19:40 UTC are 15:35 and 15:40 EDT (the route flattens) and
 * 14:35 and 14:40 EST (the route skips; it is not 15:30 yet).
 * 20:35 and 20:40 UTC are 15:35 and 15:40 EST (flattens) and
 * 16:35 and 16:40 EDT (after the close; the route skips).
 *
 * A site with no CRON_SECRET returns 200. A schedule must not fail every
 * weekday before the secret exists. This function cannot open a trade.
 */

export default async () => {
  const secret = process.env.CRON_SECRET;
  const base = (process.env.URL || process.env.DEPLOY_PRIME_URL || "").replace(/\/$/, "");
  if (!secret || !base) {
    console.log("exec-flatten skipped: CRON_SECRET or URL is unset");
    return new Response("skipped", { status: 200 });
  }
  const res = await fetch(`${base}/api/cron/exec-flatten`, {
    headers: { Authorization: `Bearer ${secret}` },
  });
  const body = await res.text();
  if (!res.ok && res.status !== 503) {
    console.error("exec-flatten", res.status, body.slice(0, 400));
    return new Response(body, { status: 500 });
  }
  console.log("exec-flatten", res.status, body.slice(0, 400));
  return new Response(body, { status: 200 });
};

export const config = { schedule: "35,40 19,20 * * 1-5" };
