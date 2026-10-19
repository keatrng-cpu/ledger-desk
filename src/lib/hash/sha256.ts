/**
 * Isomorphic sha256 (Node AND browser) — a drop-in for node:crypto's
 * `createHash("sha256").update(input, "utf8").digest("hex")`.
 *
 * node:crypto is externalized in Vite's client bundle and throws on access, which
 * broke every dev page load. @noble/hashes is pure JS and runs identically in both
 * environments, and sha256 is standard, so the digest is byte-identical to the old
 * node:crypto output (and to Python's hashlib) — no hash value changes anywhere.
 */
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

export function sha256hex(input: string): string {
  return bytesToHex(sha256(new TextEncoder().encode(input)));
}
