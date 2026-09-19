/**
 * Tamper-evident trade attestation — the part of a track record that cannot
 * be added later.
 *
 * WHY THIS EXISTS
 * A trading record built to be shown to somebody else (an allocator, a
 * verification service, an NFA or SEC examiner, a prop firm) is worth exactly
 * as much as the answer to one question: "how do we know you did not delete
 * the losers?" Three years of rows in a database you control is not an answer.
 * Neither is a screenshot. The record has to have been fixed at the time it
 * was written, in a way that cannot be rewritten afterwards without the
 * rewrite being detectable.
 *
 * WHAT THIS DOES
 * Every economically meaningful trade event is hashed into an append-only
 * chain: each link commits to the hash of the link before it. Editing or
 * removing any historical trade changes its body hash, which changes its link
 * hash, which breaks every link after it. To forge one losing trade out of the
 * record you must rebuild the entire chain from that point forward.
 *
 * WHAT THIS DOES *NOT* DO BY ITSELF
 * A chain proves ORDER and INTEGRITY, not absolute TIME. Whoever holds the
 * database can still rebuild the whole chain from scratch and backdate every
 * `recorded_at`. Absolute time comes from anchoring the tip hash somewhere the
 * trader does not control — see `sealTip()` and ANCHORING below. Chain plus
 * anchor is what makes the record evidential; either alone is not.
 *
 * ANCHORING (the cheap, credible option)
 * `sealTip()` emits a one-line seal for the current chain tip. Committing that
 * line to the public repo each session gets the hash a third-party timestamp
 * for free: GitHub records push time server-side, on its clock, not yours.
 * Any trade recorded before a given seal is thereby pinned to a date no later
 * than that seal's public push. An RFC-3161 timestamp authority is the formal
 * version of the same idea and can be added later over the identical hashes —
 * the chain does not need to change to gain a stronger anchor.
 *
 * DETERMINISM
 * Canonicalisation follows RFC 8785 (JSON Canonicalization Scheme): sorted
 * keys, no insignificant whitespace, ECMAScript shortest-round-trip numbers.
 * That matters because a verifier must be able to recompute these hashes in a
 * different language years from now and get the same bytes. Anything that
 * makes serialisation implementation-dependent silently destroys the record.
 */

import { createHash } from "node:crypto";

/** Chain genesis. 64 hex zeros — the `prev_hash` of the first link. */
export const GENESIS_HASH = "0".repeat(64);

/**
 * The fields sealed into the record, in no particular order (the canonical
 * form sorts them). Anything NOT in this list may be corrected after the fact
 * without breaking the chain — so this list is the definition of what the
 * trader is actually attesting to. Prices, size, outcome and the discipline
 * claims (grade, prescore, reason) are in. Display-only decoration is out.
 */
export const ATTESTED_FIELDS = [
  "id",
  "user_id",
  "mode",
  "source",
  "symbol",
  "side",
  "status",
  "opened_at",
  "closed_at",
  "entry",
  "stop",
  "target",
  "exit",
  "contracts",
  "pnl",
  "r",
  "commission",
  "slippage",
  "grade",
  "prescore",
  "killzone",
  "reason",
] as const;

export type AttestedField = (typeof ATTESTED_FIELDS)[number];

/** Lifecycle points worth sealing. `seal` rows carry no trade, only the tip. */
export const ATTEST_EVENTS = ["open", "close", "amend", "seal"] as const;
export type AttestEvent = (typeof ATTEST_EVENTS)[number];

export interface AttestationRow {
  seq: number;
  user_id: string;
  trade_id: string;
  event: AttestEvent;
  recorded_at: string;
  body: Record<string, unknown>;
  body_hash: string;
  prev_hash: string;
  hash: string;
}

/* ── Canonical JSON (RFC 8785 subset) ─────────────────────────────────────── */

function canonicalNumber(n: number): string {
  if (!Number.isFinite(n)) {
    // NaN and +/-Infinity have no JSON representation. Letting them through
    // would produce `null` and silently seal a different value than the one
    // the desk computed.
    throw new Error(`attest: non-finite number cannot be canonicalised (${n})`);
  }
  // String(-0) === "0", which is what RFC 8785 requires.
  return String(n);
}

function canonicalString(s: string): string {
  return JSON.stringify(s);
}

/** RFC 8785 canonical serialisation of a JSON-compatible value. */
export function canonicalize(value: unknown): string {
  if (value === null) return "null";
  const t = typeof value;
  if (t === "boolean") return value ? "true" : "false";
  if (t === "number") return canonicalNumber(value as number);
  if (t === "string") return canonicalString(value as string);
  if (Array.isArray(value)) {
    return `[${value.map((v) => canonicalize(v === undefined ? null : v)).join(",")}]`;
  }
  if (t === "object") {
    const obj = value as Record<string, unknown>;
    // RFC 8785 orders by UTF-16 code unit, which is what the default
    // Array#sort comparator on strings already does.
    const keys = Object.keys(obj)
      .filter((k) => obj[k] !== undefined)
      .sort();
    const parts = keys.map((k) => `${canonicalString(k)}:${canonicalize(obj[k])}`);
    return `{${parts.join(",")}}`;
  }
  throw new Error(`attest: value of type ${t} cannot be canonicalised`);
}

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

/* ── Building the attested body ───────────────────────────────────────────── */

/** Timestamps are normalised so a database round-trip cannot change the hash. */
function normalizeTimestamp(v: unknown): string | null {
  if (v == null) return null;
  const ms = v instanceof Date ? v.getTime() : Date.parse(String(v));
  if (!Number.isFinite(ms)) {
    throw new Error(`attest: unparseable timestamp ${JSON.stringify(v)}`);
  }
  return new Date(ms).toISOString();
}

const TIMESTAMP_FIELDS = new Set<string>(["opened_at", "closed_at"]);

/**
 * Project a trade row onto exactly ATTESTED_FIELDS, with stable types.
 *
 * Every attested field is present even when null, so "field absent" and
 * "field null" can never hash to different bodies for the same trade.
 */
export function attestedBody(trade: Record<string, unknown>): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  for (const field of ATTESTED_FIELDS) {
    const raw = trade[field];
    if (TIMESTAMP_FIELDS.has(field)) {
      body[field] = normalizeTimestamp(raw ?? null);
      continue;
    }
    body[field] = raw === undefined ? null : raw;
  }
  return body;
}

export function bodyHash(body: Record<string, unknown>): string {
  return sha256Hex(canonicalize(body));
}

/**
 * The link hash. Domain-separated with newlines so no two different field
 * tuples can concatenate to the same preimage.
 */
export function linkHash(input: {
  user_id: string;
  trade_id: string;
  event: AttestEvent;
  recorded_at: string;
  body_hash: string;
  prev_hash: string;
}): string {
  return sha256Hex(
    [
      "ledger-desk/attest/v1",
      input.prev_hash,
      input.user_id,
      input.trade_id,
      input.event,
      input.recorded_at,
      input.body_hash,
    ].join("\n"),
  );
}

/** Build the next link for `trade`, given the current chain tip. */
export function buildLink(
  trade: Record<string, unknown>,
  event: AttestEvent,
  prevHash: string,
  recordedAtMs: number = Date.now(),
): Omit<AttestationRow, "seq"> {
  const body = attestedBody(trade);
  const bh = bodyHash(body);
  const recorded_at = new Date(recordedAtMs).toISOString();
  const user_id = String(trade.user_id ?? "");
  const trade_id = String(trade.id ?? "");
  if (!user_id) throw new Error("attest: trade.user_id is required");
  if (!trade_id) throw new Error("attest: trade.id is required");
  return {
    user_id,
    trade_id,
    event,
    recorded_at,
    body,
    body_hash: bh,
    prev_hash: prevHash,
    hash: linkHash({
      user_id,
      trade_id,
      event,
      recorded_at,
      body_hash: bh,
      prev_hash: prevHash,
    }),
  };
}

/* ── Verification ─────────────────────────────────────────────────────────── */

export interface ChainVerdict {
  ok: boolean;
  checked: number;
  /** `seq` of the first bad link, or null when the chain is intact. */
  brokenAt: number | null;
  reason: string | null;
  /** Tip hash — what `sealTip()` publishes. Null for an empty chain. */
  tip: string | null;
}

/**
 * Recompute every link. `rows` must be one user's chain in ascending `seq`.
 *
 * A verifier with nothing but this function and a CSV export can establish
 * that the record has not been edited since each link was anchored.
 */
export function verifyChain(rows: AttestationRow[]): ChainVerdict {
  let prev = GENESIS_HASH;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    const fail = (reason: string): ChainVerdict => ({
      ok: false,
      checked: i,
      brokenAt: row.seq,
      reason,
      tip: i > 0 ? rows[i - 1]!.hash : null,
    });

    if (row.prev_hash !== prev) {
      return fail(`prev_hash mismatch: expected ${prev}, stored ${row.prev_hash}`);
    }
    const recomputedBody = bodyHash(row.body);
    if (recomputedBody !== row.body_hash) {
      return fail(`body was altered: hashes to ${recomputedBody}, stored ${row.body_hash}`);
    }
    const recomputedLink = linkHash({
      user_id: row.user_id,
      trade_id: row.trade_id,
      event: row.event,
      recorded_at: row.recorded_at,
      body_hash: row.body_hash,
      prev_hash: row.prev_hash,
    });
    if (recomputedLink !== row.hash) {
      return fail(`link hash mismatch: recomputed ${recomputedLink}, stored ${row.hash}`);
    }
    prev = row.hash;
  }
  return {
    ok: true,
    checked: rows.length,
    brokenAt: null,
    reason: null,
    tip: rows.length ? rows[rows.length - 1]!.hash : null,
  };
}

/* ── Anchoring ────────────────────────────────────────────────────────────── */

export interface Seal {
  /** Chain tip at seal time. */
  tip: string;
  /** Links covered by this seal. */
  count: number;
  sealedAt: string;
  /** Single line to commit publicly. */
  line: string;
}

/**
 * Freeze the current tip into one publishable line.
 *
 * Committing this to the public repo hands the hash a timestamp on somebody
 * else's clock. That is the whole trick: after the push, no trade recorded
 * before it can be altered without breaking a hash that a third party already
 * holds a dated copy of.
 */
export function sealTip(
  rows: AttestationRow[],
  sealedAtMs: number = Date.now(),
): Seal | null {
  const verdict = verifyChain(rows);
  if (!verdict.ok || !verdict.tip) return null;
  const sealedAt = new Date(sealedAtMs).toISOString();
  return {
    tip: verdict.tip,
    count: rows.length,
    sealedAt,
    line: `${sealedAt} n=${rows.length} tip=${verdict.tip}`,
  };
}
