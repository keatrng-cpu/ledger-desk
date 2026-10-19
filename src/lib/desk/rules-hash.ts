/** Canonical hash of shared/desk-rules.json (sorted keys, shortest numbers). The card carries it; the watcher fails closed on mismatch. */
// Isomorphic sha256 (runs in Node AND the browser) instead of node:crypto, which
// Vite externalizes in client code and threw "node:crypto has been externalized"
// on every dev page load. sha256 is standard, so the digest is byte-identical to
// the old node:crypto value (verified: 0a692dc19944a8df) — RULES_HASH is unchanged
// and TS<->Python watcher parity holds.
import { sha256hex } from "@/lib/hash/sha256";
import RULES from "../../../shared/desk-rules.json";
export function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.keys(v as object).sort().map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(",")}}`;
  return JSON.stringify(v);
}
export const RULES_HASH = sha256hex(canonical(RULES)).slice(0, 16);
