#!/usr/bin/env node
/**
 * Generate a VAPID key pair for Web Push (RFC 8292).
 *
 * `.env.example` has pointed at this script since the Phase B merge, but the
 * file itself was never written — so the documented way to turn push
 * notifications on did not exist. This is it.
 *
 * Zero dependencies: a VAPID key pair is just a P-256 (prime256v1) ECDH key
 * pair, base64url-encoded. `src/lib/alerts/push-server.ts` implements the
 * signing side directly on node:crypto for the same reason.
 *
 *   node scripts/gen-vapid.mjs
 *
 * Then paste the three values into Netlify → Site settings → Environment
 * variables (Production + Deploy previews), and redeploy.
 *
 * ROTATION: the two halves are ONE pair — rotate both together, never one.
 * The send path derives the public key from the private one and refuses to
 * send on a mismatch, so a half-rotation fails loudly rather than silently
 * 403ing at the push service. Rotating invalidates every existing browser
 * subscription; each browser must re-subscribe from the Alerts panel.
 *
 * The private key printed here is a SECRET. It goes in the hosting provider's
 * environment settings and nowhere else — never in git, never in a chat log,
 * never in a screenshot.
 */
import { createECDH } from "node:crypto";

const key = createECDH("prime256v1");
key.generateKeys();

const publicKey = key.getPublicKey("base64url");
const privateKey = key.getPrivateKey("base64url");

// The subject must be a mailto: or https: URL identifying who is sending.
// Push services use it to contact the sender about abuse.
const subject = process.env.VAPID_SUBJECT || "mailto:you@example.com";

console.log("");
console.log("VAPID key pair (P-256). Paste into Netlify env vars, then redeploy:");
console.log("");
console.log(`VAPID_PUBLIC_KEY=${publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${privateKey}`);
console.log(`VAPID_SUBJECT=${subject}`);
console.log("");
console.log("VAPID_PUBLIC_KEY  — served to the browser by design, not secret.");
console.log("VAPID_PRIVATE_KEY — SECRET. Environment variables only; never commit it.");
console.log("VAPID_SUBJECT     — set a real mailto: or https: URL you control.");
console.log("");
console.log("Rotating? Replace BOTH halves together and have every browser");
console.log("re-subscribe from the desk's Risk tab → Alerts panel.");
console.log("");
