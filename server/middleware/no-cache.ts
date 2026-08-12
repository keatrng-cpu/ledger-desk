/**
 * Stop the deployed desk serving a stale UI.
 *
 * THE BUG THIS FIXES
 * `noCacheDevPlugin` in vite.config.ts carries `apply: "serve"`, so it only
 * ever ran under `npm run dev`. In production the HTML document went out with
 * NO cache directive at all, which leaves the browser (and any CDN or proxy in
 * front of it) free to heuristically cache it. A cached HTML shell keeps
 * referencing the PREVIOUS build's hashed asset URLs, so the old interface
 * keeps rendering and a plain refresh just re-serves the same cached shell —
 * exactly the "reset to an old interface, refreshing does nothing" symptom.
 *
 * THE RULE
 *   - HTML documents: `no-store`. The shell is tiny and must always be current;
 *     it is what points at every other asset.
 *   - Hashed build assets: left alone, so they keep their long immutable cache.
 *     Their URL changes when their content changes, so caching them is both
 *     correct and what keeps the app fast. Blanket no-store everywhere would
 *     be a performance bug, not a fix.
 *   - `/sw.js`: `no-store`. A cached service worker cannot replace itself,
 *     which is the one failure mode that survives even a hard refresh.
 *
 * Auto-registered as global h3 middleware because vite.config.ts sets
 * `serverDir: "./server"` — same mechanism as grok-pwa.ts, and it follows the
 * same `(event, next)` contract.
 */

interface CacheEvent {
  url: URL;
  req: { method: string; headers: Headers };
}

const NO_STORE = "no-store, no-cache, must-revalidate, max-age=0";

/** Build output lives under hashed paths — those SHOULD stay cacheable. */
function isImmutableAsset(pathname: string): boolean {
  if (pathname.startsWith("/assets/") || pathname.startsWith("/_build/")) {
    return true;
  }
  // e.g. /something.a1b2c3d4.js — content-hashed, safe to cache forever.
  return /\.[0-9a-zA-Z]{8,}\.(js|mjs|css|woff2?|png|svg|jpe?g|webp)$/.test(
    pathname,
  );
}

function acceptsHtmlDocument(event: CacheEvent): boolean {
  return (event.req.headers.get("accept") ?? "").includes("text/html");
}

/** Apply the directive without clobbering a response that already set one. */
function withNoStore(result: unknown): unknown {
  if (!(result instanceof Response)) return result;
  const headers = new Headers(result.headers);
  headers.set("cache-control", NO_STORE);
  headers.set("pragma", "no-cache");
  return new Response(result.body, {
    status: result.status,
    statusText: result.statusText,
    headers,
  });
}

export default async function noCacheMiddleware(
  event: CacheEvent,
  next: () => unknown | Promise<unknown>,
): Promise<unknown> {
  const path = event.url.pathname;

  // The service worker must never be cached: a stale one cannot self-replace,
  // and it outlives a hard refresh.
  if (path === "/sw.js") return withNoStore(await next());

  // Hashed assets keep their immutable caching — that is the fast path.
  if (isImmutableAsset(path)) return next();

  if (!acceptsHtmlDocument(event)) return next();

  const result = await next();
  // Only stamp actual HTML. A server-function or JSON response that happens to
  // ride an html-accepting request keeps its own caching semantics.
  if (
    result instanceof Response &&
    String(result.headers.get("content-type") ?? "").includes("text/html")
  ) {
    return withNoStore(result);
  }
  return result;
}
