/** Canonical hash of shared/desk-rules.json (sorted keys, shortest numbers). The card carries it; the watcher fails closed on mismatch. */
import { createHash } from "node:crypto";
import RULES from "../../../shared/desk-rules.json";
export function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.keys(v as object).sort().map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(",")}}`;
  return JSON.stringify(v);
}
export const RULES_HASH = createHash("sha256").update(canonical(RULES), "utf8").digest("hex").slice(0, 16);
