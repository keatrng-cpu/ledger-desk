/**
 * Web Push delivery — the raw protocol, implemented on `node:crypto` alone.
 *
 * ZERO new dependencies, deliberately. The usual answer here is the `web-push`
 * npm package, but everything it does is three RFCs and Node already ships
 * every primitive they need:
 *
 *   RFC 8292 (VAPID)  — an ES256 JWT proving the sender owns the key pair the
 *                       subscription was created against.
 *   RFC 8291 (Message Encryption) — ECDH P-256 against the subscriber's public
 *                       key, HKDF down to a content key + nonce.
 *   RFC 8188 (aes128gcm) — the wire framing: salt ‖ rs ‖ idlen ‖ key ‖ AEAD.
 *
 * The push service is a dumb relay: it never sees the plaintext, and it will
 * reject anything not signed by the VAPID key. That means a leaked `p256dh` /
 * `auth` pair from the database is not a way to send this user notifications —
 * only `VAPID_PRIVATE_KEY` is, and that never leaves the server.
 *
 * Nothing here logs or returns key material. Failures surface as a status code
 * and a generic reason.
 */

import {
  createCipheriv,
  createECDH,
  createPrivateKey,
  hkdfSync,
  randomBytes,
  sign as cryptoSign,
} from "node:crypto";
import type { AlertNotification } from "./types";

/* ------------------------------------------------------------------ */
/* Config                                                             */
/* ------------------------------------------------------------------ */

function envValue(name: string): string | undefined {
  const raw = typeof process !== "undefined" ? process.env[name] : undefined;
  return raw && raw.trim() ? raw.trim() : undefined;
}

/**
 * VAPID contact, sent as the JWT `sub` claim. RFC 8292 requires a `mailto:` or
 * `https:` URI; some push services reject a delivery without a usable one.
 * Falls back to the Vercel production URL when that is all we have — never to
 * a made-up address, because a wrong `sub` fails at the push service with a
 * 403 that is very hard to read backwards.
 */
export function vapidSubject(): string | undefined {
  const explicit = envValue("VAPID_SUBJECT");
  if (explicit) return explicit;
  const host = envValue("VERCEL_PROJECT_PRODUCTION_URL") ?? envValue("VERCEL_URL");
  return host ? `https://${host}` : undefined;
}

export function vapidPublicKey(): string | undefined {
  return envValue("VAPID_PUBLIC_KEY");
}

function vapidPrivateKey(): string | undefined {
  return envValue("VAPID_PRIVATE_KEY");
}

export interface PushConfigState {
  configured: boolean;
  /** Safe to hand to the browser — it is the public half, by design. */
  publicKey: string | null;
  /** Which env var is missing. Never contains a value. */
  missing: string[];
}

/** Whether push can actually be sent, and what is missing if not. */
export function pushConfig(): PushConfigState {
  const missing: string[] = [];
  const pub = vapidPublicKey();
  if (!pub) missing.push("VAPID_PUBLIC_KEY");
  if (!vapidPrivateKey()) missing.push("VAPID_PRIVATE_KEY");
  if (!vapidSubject()) missing.push("VAPID_SUBJECT");
  return {
    configured: missing.length === 0,
    publicKey: pub ?? null,
    missing,
  };
}

/* ------------------------------------------------------------------ */
/* base64url                                                          */
/* ------------------------------------------------------------------ */

const b64url = (b: Buffer): string => b.toString("base64url");

function fromB64url(s: string, expectedLen?: number, what = "value"): Buffer {
  const buf = Buffer.from(s, "base64url");
  if (expectedLen != null && buf.length !== expectedLen) {
    // Length only — never the value.
    throw new Error(
      `Malformed ${what}: expected ${expectedLen} bytes, got ${buf.length}`,
    );
  }
  return buf;
}

/* ------------------------------------------------------------------ */
/* VAPID (RFC 8292)                                                   */
/* ------------------------------------------------------------------ */

/** JWT lifetime. RFC 8292 caps `exp` at 24h; 12h leaves room for clock skew. */
const JWT_TTL_SECONDS = 12 * 60 * 60;

/**
 * Build a signing key from the raw 32-byte P-256 scalar that
 * `web-push generate-vapid-keys` (and every other generator) emits.
 *
 * The public half is DERIVED from the private scalar rather than trusted from
 * `VAPID_PUBLIC_KEY`, then checked against it. A mismatched pair — easy to
 * create by rotating one env var and not the other — otherwise fails only at
 * the push service, as a 403 on every send, with nothing local to see.
 */
function vapidKeyPair(): { key: ReturnType<typeof createPrivateKey>; publicKey: Buffer } {
  const priv = fromB64url(vapidPrivateKey() ?? "", 32, "VAPID_PRIVATE_KEY");
  const ecdh = createECDH("prime256v1");
  ecdh.setPrivateKey(priv);
  const derived = ecdh.getPublicKey(); // 65 bytes, uncompressed (0x04‖X‖Y)

  const declared = fromB64url(vapidPublicKey() ?? "", 65, "VAPID_PUBLIC_KEY");
  if (!derived.equals(declared)) {
    throw new Error(
      "VAPID_PUBLIC_KEY does not match VAPID_PRIVATE_KEY — regenerate the pair together",
    );
  }

  const key = createPrivateKey({
    key: {
      kty: "EC",
      crv: "P-256",
      d: b64url(priv),
      x: b64url(derived.subarray(1, 33)),
      y: b64url(derived.subarray(33, 65)),
    },
    format: "jwk",
  });
  return { key, publicKey: derived };
}

/** `Authorization: vapid t=<jwt>, k=<pubkey>` for one push-service origin. */
function vapidHeader(audience: string): string {
  const { key, publicKey } = vapidKeyPair();
  const sub = vapidSubject();
  if (!sub) throw new Error("VAPID_SUBJECT is not configured");

  const header = b64url(Buffer.from(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = b64url(
    Buffer.from(
      JSON.stringify({
        aud: audience,
        exp: Math.floor(Date.now() / 1000) + JWT_TTL_SECONDS,
        sub,
      }),
    ),
  );
  const signingInput = `${header}.${claims}`;
  // ES256 wants the raw r‖s pair (JOSE), not the DER wrapper Node defaults to.
  const signature = cryptoSign("sha256", Buffer.from(signingInput), {
    key,
    dsaEncoding: "ieee-p1363",
  });
  return `vapid t=${signingInput}.${b64url(signature)}, k=${b64url(publicKey)}`;
}

/* ------------------------------------------------------------------ */
/* Payload encryption (RFC 8291 over RFC 8188 aes128gcm)              */
/* ------------------------------------------------------------------ */

/** Record size. 4096 is the size every push service is required to accept. */
const RECORD_SIZE = 4096;
/** 16-byte GCM tag + the 1-byte record delimiter come out of the budget. */
export const MAX_PUSH_PLAINTEXT = RECORD_SIZE - 16 - 1;

/**
 * Encrypt `plaintext` for one subscriber. Returns the complete aes128gcm body.
 *
 * The key schedule is RFC 8291 §3.4 verbatim:
 *   IKM   = HKDF(salt=auth_secret, ikm=ecdh_secret, info="WebPush: info\0"‖ua‖as, 32)
 *   CEK   = HKDF(salt=salt, ikm=IKM, info="Content-Encoding: aes128gcm\0", 16)
 *   NONCE = HKDF(salt=salt, ikm=IKM, info="Content-Encoding: nonce\0", 12)
 */
function encryptPayload(
  plaintext: Buffer,
  uaPublicB64: string,
  authSecretB64: string,
): Buffer {
  if (plaintext.length > MAX_PUSH_PLAINTEXT) {
    throw new Error(
      `Push payload too large: ${plaintext.length} > ${MAX_PUSH_PLAINTEXT} bytes`,
    );
  }
  const uaPublic = fromB64url(uaPublicB64, 65, "subscription key");
  const authSecret = fromB64url(authSecretB64, 16, "subscription auth");

  // Ephemeral (application-server) key pair — fresh per message, so two
  // notifications to the same device share no key material.
  const as = createECDH("prime256v1");
  as.generateKeys();
  const asPublic = as.getPublicKey();
  const ecdhSecret = as.computeSecret(uaPublic);

  const salt = randomBytes(16);
  const keyInfo = Buffer.concat([
    Buffer.from("WebPush: info\0", "utf8"),
    uaPublic,
    asPublic,
  ]);
  const ikm = Buffer.from(hkdfSync("sha256", ecdhSecret, authSecret, keyInfo, 32));
  const cek = Buffer.from(
    hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: aes128gcm\0", "utf8"), 16),
  );
  const nonce = Buffer.from(
    hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: nonce\0", "utf8"), 12),
  );

  const cipher = createCipheriv("aes-128-gcm", cek, nonce);
  // 0x02 is the RFC 8188 delimiter marking this as the LAST record. Using 0x01
  // (a non-final record) makes browsers drop the message with no error.
  const body = Buffer.concat([
    cipher.update(Buffer.concat([plaintext, Buffer.from([0x02])])),
    cipher.final(),
    cipher.getAuthTag(),
  ]);

  const rs = Buffer.alloc(4);
  rs.writeUInt32BE(RECORD_SIZE, 0);
  return Buffer.concat([
    salt, // 16
    rs, // 4
    Buffer.from([asPublic.length]), // 1 (=65)
    asPublic, // 65
    body,
  ]);
}

/* ------------------------------------------------------------------ */
/* Delivery                                                           */
/* ------------------------------------------------------------------ */

export interface PushTarget {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface PushSendResult {
  ok: boolean;
  status: number;
  /** True when the push service says this endpoint is permanently dead. */
  gone: boolean;
  /** Generic, safe to persist and show. Never contains key material. */
  reason?: string;
}

/** How long the push service should hold an undelivered message (seconds). */
const DEFAULT_TTL = 60 * 60;

/**
 * Deliver one notification. Never throws — a broken push service must not take
 * down the trading path that raised the alert. Callers act on `gone` to prune.
 */
export async function sendPush(
  target: PushTarget,
  notification: AlertNotification,
  opts: { urgency?: "normal" | "high"; ttl?: number; signal?: AbortSignal } = {},
): Promise<PushSendResult> {
  try {
    const audience = new URL(target.endpoint).origin;
    const plaintext = Buffer.from(JSON.stringify(notification), "utf8");
    const body = encryptPayload(plaintext, target.p256dh, target.auth);

    const res = await fetch(target.endpoint, {
      method: "POST",
      headers: {
        authorization: vapidHeader(audience),
        "content-encoding": "aes128gcm",
        "content-type": "application/octet-stream",
        "content-length": String(body.length),
        ttl: String(opts.ttl ?? DEFAULT_TTL),
        urgency: opts.urgency ?? "normal",
      },
      body: new Uint8Array(body),
      signal: opts.signal,
    });

    // 404/410 = the subscription no longer exists. Anything else that fails is
    // transient as far as we are concerned (retryable, keep the row).
    const gone = res.status === 404 || res.status === 410;
    if (res.ok) return { ok: true, status: res.status, gone: false };
    return {
      ok: false,
      status: res.status,
      gone,
      reason: gone ? "subscription expired" : `push service returned ${res.status}`,
    };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      gone: false,
      // Message only — the stack (and anything it closes over) stays out.
      reason: err instanceof Error ? err.message : "push failed",
    };
  }
}
