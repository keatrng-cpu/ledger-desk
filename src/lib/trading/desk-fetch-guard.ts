/**
 * Fail-closed helpers for the desk's client-side fetches (fix/desk-bootstrap).
 *
 * The bootstrap hang fix bounded every desk-side await. A bounded await can
 * fail, and the first cut of that fix let the failure fail OPEN. Two ways:
 *   1. A risk timeout became `null`, and `publishDesk(held, null)` wiped the
 *      last-known risk, which took the veteran brain's "Risk halt" veto with it.
 *   2. `loadRisk` mapped EVERY error, including the new 8s pg connect timeout,
 *      to "no-session". "no-session" lets entry through, so the take button lit.
 *
 * The fix: "no-session" is reserved for a genuine signed-out answer from the
 * server (authMiddleware -> UnauthorizedError, "Unauthorized" / 401). Any other
 * failure (timeout, transport, 5xx, DB) is "unknown". "unknown" BLOCKS entry,
 * keeps the last-known risk, and says how long the governor has been silent.
 *
 * Pure and DOM-free, so node:test can pin it (scripts/desk-fetch-guard.test.mjs).
 */

/** Where the risk governor's last answer left the entry gate. */
export type RiskFetchState = "loading" | "no-session" | "unknown" | "ok";

/** The fields of RiskState the entry gate reads. */
export type RiskHaltFlags = {
  dailyHaltHit: boolean;
  weeklyHaltHit: boolean;
  killzoneCapHit: boolean;
};

/**
 * Bound a promise so a server fn that never settles (hung Neon connect, edge
 * stall, missing reject) cannot hold the caller forever. It does not cancel the
 * underlying request. It only stops waiting, so a late result is dropped.
 */
export function withClientTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = globalThis.setTimeout(
      () => reject(new ClientTimeoutError(label, ms)),
      ms,
    );
    p.then(
      (v) => {
        globalThis.clearTimeout(t);
        resolve(v);
      },
      (e) => {
        globalThis.clearTimeout(t);
        reject(e);
      },
    );
  });
}

/** Thrown by withClientTimeout. The message keeps the "timed out after Ns" wording describeDeskError matches. */
export class ClientTimeoutError extends Error {
  readonly label: string;
  readonly ms: number;
  constructor(label: string, ms: number) {
    super(`${label} timed out after ${Math.round(ms / 1000)}s`);
    this.name = "ClientTimeoutError";
    this.label = label;
    this.ms = ms;
  }
}

/**
 * True only for the server SAYING nobody is signed in. authMiddleware throws
 * UnauthorizedError("Unauthorized", status 401). The server-fn client surfaces
 * that as an Error whose message is "Unauthorized" (discipline-panel.tsx keys
 * on the same word). A timeout, a dropped socket, a 5xx or a pg error is NOT
 * this. It means "we don't know".
 */
export function isSignedOutError(e: unknown): boolean {
  if (e instanceof ClientTimeoutError) return false;
  if (e && typeof e === "object") {
    const o = e as { name?: unknown; status?: unknown; statusCode?: unknown };
    if (o.name === "UnauthorizedError") return true;
    if (o.status === 401 || o.statusCode === 401) return true;
  }
  const msg = e instanceof Error ? e.message : typeof e === "string" ? e : "";
  // Exact match only (Accuracy re-review 00c071e S5). The server emits the bare
  // word "Unauthorized". An upstream error whose text merely MENTIONS it
  // ("proxy: upstream unauthorized for pooler", "Unauthorized host ...") is a
  // transport failure, which must stay "unknown" and keep entry blocked.
  return /^Unauthorized$/.test(msg.trim());
}

/** Map a failed risk read to the gate state. Only a signed-out answer is "no-session". */
export function classifyRiskFailure(e: unknown): Extract<RiskFetchState, "no-session" | "unknown"> {
  return isSignedOutError(e) ? "no-session" : "unknown";
}

/** What one governor read told the gate. Only "ok" carries a risk to publish. */
export type RiskReadOutcome<R> =
  | { state: "ok"; risk: R }
  | { state: "no-session"; error: unknown }
  | { state: "unknown"; error: unknown };

/** Classify a settled governor read (loadRisk's decision, kept pure). */
export function riskReadOutcome<R>(r: PromiseSettledResult<R>): RiskReadOutcome<R> {
  if (r.status === "fulfilled") return { state: "ok", risk: r.value };
  return { state: classifyRiskFailure(r.reason), error: r.reason };
}

/**
 * One bounded governor read: getRiskState under its own client budget, then
 * classified. Never rejects. A hang becomes "unknown" after `ms`.
 */
export async function readRiskGoverned<R>(
  fetchRisk: () => Promise<R>,
  ms: number,
): Promise<RiskReadOutcome<R>> {
  const [r] = await Promise.allSettled([
    // Call inside the bounded promise so a synchronous throw is caught too.
    withClientTimeout(Promise.resolve().then(fetchRisk), ms, "Risk"),
  ]);
  return riskReadOutcome(r);
}

/**
 * desk-synapse publishDesk's risk merge. `undefined` (no risk argument) means
 * "no new information, so keep what you had". Only an explicit value replaces
 * it. Callers on a soft or failed risk path must pass nothing, never null.
 */
export function resolvePublishedRisk<R>(next: R | null | undefined, prev: R | null): R | null {
  return next !== undefined ? next : prev;
}

/** True when a risk read carries any entry-blocking flag. */
export function riskHalted(risk: RiskHaltFlags | null | undefined): boolean {
  return !!risk && (risk.dailyHaltHit || risk.weeklyHaltHit || risk.killzoneCapHit);
}

/**
 * The entry gate. Fails closed on "loading" and "unknown". "no-session" is the
 * signed-out preview, which has no governor, so it is allowed (the server still
 * rejects the write) UNLESS this session already saw a halt: a 401 after a
 * known halt does not lift the halt (Design re-review 00c071e S7). `risk` is
 * the last-known governor answer, which loadRisk keeps on every non-"ok" read.
 * "ok" reads the halts.
 */
export function riskEntryAllowed(state: RiskFetchState, risk: RiskHaltFlags | null): boolean {
  if (state === "loading" || state === "unknown") return false;
  if (state === "no-session") return !riskHalted(risk);
  if (!risk) return false;
  return !riskHalted(risk);
}

/** Why entry is blocked, for the card strip. undefined when entry is allowed. */
export function riskEntryBlockedReason(
  state: RiskFetchState,
  risk: RiskHaltFlags | null,
  unknownSinceMs: number | null,
): string | undefined {
  if (state === "unknown") return riskUnknownLine(unknownSinceMs);
  if (state === "loading") return "risk loading";
  if (state === "no-session" && riskHalted(risk)) return "signed out · last known halt holds";
  return undefined;
}

/** The live-risk shape runVeteranBrain reads. */
export type BrainLiveRisk = {
  dailyHaltHit: boolean;
  weeklyHaltHit: boolean;
  killzoneCapHit: boolean;
  /** The governor is silent (gate "unknown"): the brain adds a "Risk unknown" veto. */
  riskUnknown: boolean;
};

/**
 * What the veteran brain is told about risk (Accuracy re-review 00c071e S4).
 * While the gate is "unknown" the last-known flags are still passed (a known
 * halt keeps its veto), AND riskUnknown is set, so the veto list can never read
 * "None" while the governor is silent. null only when there is no risk read
 * and nothing is unknown (loading / signed-out preview).
 */
export function brainLiveRisk(
  state: RiskFetchState,
  risk: RiskHaltFlags | null,
): BrainLiveRisk | null {
  const unknown = state === "unknown";
  if (!risk && !unknown) return null;
  return {
    dailyHaltHit: !!risk?.dailyHaltHit,
    weeklyHaltHit: !!risk?.weeklyHaltHit,
    killzoneCapHit: !!risk?.killzoneCapHit,
    riskUnknown: unknown,
  };
}

/** "10:32:05 ET". The desk reads in New York time. */
export function etClock(ms: number): string {
  return `${new Date(ms).toLocaleTimeString("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  })} ET`;
}

/** Blocker text for the card strip and the desk banner while the governor is silent. */
export function riskUnknownLine(sinceMs: number | null): string {
  return sinceMs != null
    ? `risk unknown · since ${etClock(sinceMs)}`
    : "risk unknown";
}

/**
 * The lag a quote has NOW, not the lag it had when it was fetched. If the quote
 * poll fails, it keeps the last quotes, and their payload `lagSec` stays frozen
 * at a fresh-looking number. Any age since fetch is added, so a frozen quote
 * ages out of green. Never less than the payload's own lag. Clock skew can make
 * the age negative, and it is clamped to 0.
 */
export function effectiveLagSec(
  q: { lagSec: number; fetchedAtMs?: number | null },
  nowMs: number,
): number {
  const base = Number.isFinite(q.lagSec) ? q.lagSec : 0;
  if (q.fetchedAtMs == null || !Number.isFinite(q.fetchedAtMs)) return base;
  return base + Math.max(0, (nowMs - q.fetchedAtMs) / 1000);
}

/** The strip shown when a rebuild fails after a desk already exists. */
export function deskStaleLine(fetchedAtIso: string | null | undefined, reason: string): string {
  const ms = fetchedAtIso ? Date.parse(fetchedAtIso) : NaN;
  const built = Number.isFinite(ms) ? `built ${etClock(ms)}` : "build time unknown";
  return `Desk stale · ${built} · ${reason}`;
}
