/**
 * Browser side of Web Push: register the service worker, ask for permission,
 * subscribe, hand the subscription to the server.
 *
 * Deliberately UI-free — these are three functions a button can call, so the
 * integrator can put the control wherever it belongs (see INTEGRATION-C.md)
 * without this module dictating a layout.
 *
 * Everything degrades to a readable reason instead of throwing: on iOS the
 * whole API only exists once the app is installed to the home screen, in an
 * http:// preview it does not exist at all, and a user can deny permission
 * permanently. All three are normal states, not errors.
 */

import {
  getAlertStatus,
  subscribeToAlerts,
  unsubscribeFromAlerts,
} from "./server";

export const SERVICE_WORKER_URL = "/sw.js";

export type PushSupport =
  | { supported: true }
  | { supported: false; reason: string };

/** Why push can't work here, in words a user can act on. */
export function pushSupport(): PushSupport {
  if (typeof window === "undefined") return { supported: false, reason: "server" };
  if (!("serviceWorker" in navigator)) {
    return { supported: false, reason: "This browser has no service worker support." };
  }
  if (!("PushManager" in window)) {
    return {
      supported: false,
      reason:
        "This browser has no Push API. On iOS, add the app to the Home Screen first — Safari only exposes push to installed web apps.",
    };
  }
  if (!window.isSecureContext) {
    return {
      supported: false,
      reason: "Push requires HTTPS (or localhost). The deployed URL will work.",
    };
  }
  return { supported: true };
}

/**
 * base64url VAPID key -> the Uint8Array pushManager.subscribe() wants.
 * Backed by an explicit ArrayBuffer: `applicationServerKey` is typed
 * `BufferSource`, which excludes the SharedArrayBuffer-backed view that
 * `new Uint8Array(length)` widens to.
 */
function urlBase64ToUint8Array(base64Url: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64Url.length % 4)) % 4);
  const base64 = (base64Url + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

function keyToBase64Url(buf: ArrayBuffer | null): string {
  if (!buf) return "";
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function registration(): Promise<ServiceWorkerRegistration> {
  const existing = await navigator.serviceWorker.getRegistration(SERVICE_WORKER_URL);
  if (existing) return existing;
  return navigator.serviceWorker.register(SERVICE_WORKER_URL, { scope: "/" });
}

export interface EnableResult {
  ok: boolean;
  /** Present when ok === false. Safe to render verbatim. */
  reason?: string;
}

/**
 * Turn alerts on for THIS browser. Idempotent — calling it when already
 * subscribed re-saves the same endpoint (the server upserts on endpoint).
 */
export async function enablePushAlerts(): Promise<EnableResult> {
  const support = pushSupport();
  if (!support.supported) return { ok: false, reason: support.reason };

  const status = await getAlertStatus();
  if (!status.configured || !status.publicKey) {
    return {
      ok: false,
      reason: `Server push keys are not set (${status.missing.join(", ")}).`,
    };
  }

  // Ask AFTER confirming the server can actually send: a permission prompt the
  // user grants for a feature that then does nothing is a prompt spent for free.
  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    return {
      ok: false,
      reason:
        permission === "denied"
          ? "Notifications are blocked for this site — re-enable them in the browser's site settings."
          : "Notification permission was dismissed.",
    };
  }

  const reg = await registration();
  await navigator.serviceWorker.ready;

  const existing = await reg.pushManager.getSubscription();
  const sub =
    existing ??
    (await reg.pushManager.subscribe({
      // Required by every browser: pushes must be user-visible.
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(status.publicKey),
    }));

  const p256dh = keyToBase64Url(sub.getKey("p256dh"));
  const auth = keyToBase64Url(sub.getKey("auth"));
  if (!p256dh || !auth) {
    return { ok: false, reason: "Browser returned an incomplete subscription." };
  }

  await subscribeToAlerts({
    data: {
      endpoint: sub.endpoint,
      p256dh,
      auth,
      userAgent: navigator.userAgent.slice(0, 300),
    },
  });
  return { ok: true };
}

/** Turn alerts off for this browser: unsubscribe locally, then forget it. */
export async function disablePushAlerts(): Promise<EnableResult> {
  const support = pushSupport();
  if (!support.supported) return { ok: false, reason: support.reason };

  const reg = await navigator.serviceWorker.getRegistration(SERVICE_WORKER_URL);
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return { ok: true };

  const endpoint = sub.endpoint;
  await sub.unsubscribe().catch(() => undefined);
  await unsubscribeFromAlerts({ data: { endpoint } });
  return { ok: true };
}

/** Is this browser currently subscribed? (Local check — no network.) */
export async function isPushEnabled(): Promise<boolean> {
  if (!pushSupport().supported) return false;
  if (Notification.permission !== "granted") return false;
  const reg = await navigator.serviceWorker.getRegistration(SERVICE_WORKER_URL);
  return !!(await reg?.pushManager.getSubscription());
}
