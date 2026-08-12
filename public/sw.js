/**
 * Service worker — push notifications only.
 *
 * Deliberately NOT a caching/offline worker. This desk shows live prices; a
 * service worker that serves a cached shell is how you end up looking at
 * yesterday's tape while believing it is today's. Registering one for push and
 * having it silently start caching would be a data-integrity bug, not a
 * feature. There is no `fetch` handler here, and there should not be one.
 *
 * Two events:
 *   push              — render the notification the server encrypted for us.
 *   notificationclick — focus an already-open desk tab, or open one.
 *
 * The payload shape is `AlertNotification` (src/lib/alerts/types.ts).
 */

/** Take over immediately instead of waiting for every old tab to close. */
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  // Browsers require a user-visible notification for every push (userVisibleOnly).
  // Failing to show one repeatedly gets the subscription revoked, so every
  // branch below ends in showNotification — including the malformed-payload one.
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }

  const title = typeof data.title === "string" && data.title ? data.title : "Ledger desk";
  const body = typeof data.body === "string" ? data.body : "";
  const tag = typeof data.tag === "string" && data.tag ? data.tag : "ledger-alert";
  // Only same-origin paths are ever followed (the server already enforces this;
  // re-checked here because the service worker is the thing doing the opening).
  const url = typeof data.url === "string" && data.url.startsWith("/") ? data.url : "/";
  const urgent =
    data.kind === "setup_armed" ||
    data.kind === "halt_hit" ||
    data.kind === "position_flattened" ||
    data.kind === "news_blackout_15m";

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      tag,
      // Same tag replaces rather than stacks; renotify makes the replacement
      // still buzz, which matters when a halt upgrades from daily to weekly.
      renotify: true,
      // Time-critical desk alerts should not auto-dismiss before they are seen.
      requireInteraction: urgent,
      icon: "/favicon.svg",
      badge: "/favicon.svg",
      timestamp: Date.parse(data.ts) || Date.now(),
      data: { url, kind: data.kind ?? null },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "/";

  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      // Prefer an existing desk tab: opening a second one mid-session means two
      // pollers, two paper books in view, and the wrong one focused.
      for (const client of windows) {
        if (new URL(client.url).origin === self.location.origin) {
          if ("navigate" in client && target !== "/") {
            await client.navigate(target).catch(() => undefined);
          }
          return client.focus();
        }
      }
      return self.clients.openWindow(target);
    })(),
  );
});
