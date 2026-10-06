/**
 * fix/desk-bootstrap: the bounded desk/risk fetches must fail CLOSED.
 *
 * Accuracy review 2026-10-06 (0e7d3ad) B1. A risk timeout became null, and
 * publishDesk(held, null) wiped the last-known risk and the "Risk halt" veto.
 * loadRisk also mapped every error, including the new 8s pg connect timeout,
 * to "no-session", which let entry through. These tests pin the helpers in
 * src/lib/trading/desk-fetch-guard.ts that index.tsx loadRisk/load and
 * desk-synapse publishDesk now run through, plus source guards on the wiring.
 *
 * Run: npm test  (node --test, TypeScript via tsx's loader)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "tsx/esm/api";

register();
const G = await import("../src/lib/trading/desk-fetch-guard.ts");

const never = () => new Promise(() => {});
const CLEAN = { dailyHaltHit: false, weeklyHaltHit: false, killzoneCapHit: false };
const HALTED = { dailyHaltHit: true, weeklyHaltHit: false, killzoneCapHit: false };

// ---------------------------------------------------------------- withClientTimeout
test("withClientTimeout: resolves when the promise beats the budget", async () => {
  const v = await G.withClientTimeout(Promise.resolve(42), 50, "X");
  assert.equal(v, 42);
});

test("withClientTimeout: rejects with ClientTimeoutError on a hang, message matches describeDeskError", async () => {
  await assert.rejects(G.withClientTimeout(never(), 20, "Risk"), (e) => {
    assert.ok(e instanceof G.ClientTimeoutError);
    assert.match(e.message, /timed out after/i);
    assert.equal(e.label, "Risk");
    return true;
  });
});

test("withClientTimeout: passes the original rejection through untouched", async () => {
  const boom = new Error("Unauthorized");
  await assert.rejects(G.withClientTimeout(Promise.reject(boom), 50, "X"), (e) => e === boom);
});

test("withClientTimeout: a late result after the timeout is dropped", async () => {
  let resolveLate;
  const late = new Promise((r) => (resolveLate = r));
  const p = G.withClientTimeout(late, 10, "Desk build");
  await assert.rejects(p, G.ClientTimeoutError);
  resolveLate("late"); // must not throw or re-settle
  await new Promise((r) => setTimeout(r, 5));
});

// ---------------------------------------------------------------- classify
test("risk timeout / transport / DB errors are UNKNOWN, never no-session", () => {
  const unknowns = [
    new G.ClientTimeoutError("Risk", 12_000),
    new Error("Risk timed out after 12s"),
    new Error("timeout exceeded when trying to connect"), // pg-pool connectionTimeoutMillis
    new Error("Connection terminated due to connection timeout"),
    new Error("Query read timeout"), // pg query_timeout
    new Error("Failed to fetch"),
    new TypeError("NetworkError when attempting to fetch resource."),
    new Error("<html><head><title>Inactivity Timeout</title></head></html>"),
    new Error("Internal Server Error"),
    { status: 503 },
    "socket hang up",
    null,
    undefined,
  ];
  for (const e of unknowns) {
    assert.equal(G.classifyRiskFailure(e), "unknown", `expected unknown for ${String(e?.message ?? e)}`);
    assert.equal(G.isSignedOutError(e), false);
  }
});

test("only a genuine signed-out answer is no-session", () => {
  const unauth = Object.assign(new Error("Unauthorized"), { name: "UnauthorizedError", status: 401 });
  assert.equal(G.classifyRiskFailure(unauth), "no-session");
  assert.equal(G.classifyRiskFailure(new Error("Unauthorized")), "no-session"); // as the server-fn client surfaces it
  assert.equal(G.classifyRiskFailure({ status: 401 }), "no-session");
  assert.equal(G.classifyRiskFailure({ name: "UnauthorizedError" }), "no-session");
});

// ---------------------------------------------------------------- loadRisk decision
test("loadRisk: a hung getRiskState becomes UNKNOWN after the budget, not no-session", async () => {
  const out = await G.readRiskGoverned(never, 20);
  assert.equal(out.state, "unknown");
  assert.ok(out.error instanceof G.ClientTimeoutError);
  assert.ok(!("risk" in out), "unknown carries no risk to publish");
});

test("loadRisk: a pg connect-timeout rejection becomes UNKNOWN", async () => {
  const out = await G.readRiskGoverned(
    () => Promise.reject(new Error("timeout exceeded when trying to connect")),
    1_000,
  );
  assert.equal(out.state, "unknown");
});

test("loadRisk: a synchronous throw is still classified (never escapes)", async () => {
  const out = await G.readRiskGoverned(() => {
    throw new Error("Failed to fetch");
  }, 1_000);
  assert.equal(out.state, "unknown");
});

test("loadRisk: signed out is no-session; success is ok with the risk", async () => {
  const signedOut = await G.readRiskGoverned(() => Promise.reject(new Error("Unauthorized")), 1_000);
  assert.equal(signedOut.state, "no-session");
  const ok = await G.readRiskGoverned(() => Promise.resolve(HALTED), 1_000);
  assert.deepEqual(ok, { state: "ok", risk: HALTED });
});

// ---------------------------------------------------------------- entry gate
test("entry gate fails CLOSED on unknown and loading, whatever the last risk was", () => {
  assert.equal(G.riskEntryAllowed("unknown", CLEAN), false);
  assert.equal(G.riskEntryAllowed("unknown", HALTED), false);
  assert.equal(G.riskEntryAllowed("unknown", null), false);
  assert.equal(G.riskEntryAllowed("loading", CLEAN), false);
  assert.equal(G.riskEntryAllowed("loading", null), false);
});

test("entry gate: no-session allowed (server still rejects writes); ok reads the halts", () => {
  assert.equal(G.riskEntryAllowed("no-session", null), true);
  assert.equal(G.riskEntryAllowed("ok", CLEAN), true);
  assert.equal(G.riskEntryAllowed("ok", HALTED), false);
  assert.equal(G.riskEntryAllowed("ok", { ...CLEAN, weeklyHaltHit: true }), false);
  assert.equal(G.riskEntryAllowed("ok", { ...CLEAN, killzoneCapHit: true }), false);
  assert.equal(G.riskEntryAllowed("ok", null), false);
});

test("timeout end-to-end: halted user, risk read hangs → gate unknown, closed, halt kept", async () => {
  // Poll 1: governor answers HALTED. Poll 2: governor hangs.
  let synapseRisk = null;
  const first = await G.readRiskGoverned(() => Promise.resolve(HALTED), 1_000);
  assert.equal(first.state, "ok");
  synapseRisk = G.resolvePublishedRisk(first.risk, synapseRisk); // publishRisk
  const second = await G.readRiskGoverned(never, 20);
  assert.equal(second.state, "unknown");
  // load() now calls publishDesk(held) with NO risk arg.
  synapseRisk = G.resolvePublishedRisk(undefined, synapseRisk);
  assert.deepEqual(synapseRisk, HALTED, "the Risk halt survives the timeout");
  assert.equal(G.riskEntryAllowed(second.state, synapseRisk), false);
});

// ---------------------------------------------------------------- publishDesk merge
test("publishDesk without a risk arg preserves the prior risk and halt", () => {
  assert.deepEqual(G.resolvePublishedRisk(undefined, HALTED), HALTED);
  assert.equal(G.resolvePublishedRisk(undefined, null), null);
  // An explicit value still replaces it (publishRisk / a real answer).
  assert.deepEqual(G.resolvePublishedRisk(CLEAN, HALTED), CLEAN);
  assert.equal(G.resolvePublishedRisk(null, HALTED), null);
});

// ---------------------------------------------------------------- stale honesty
test("effectiveLagSec ages a frozen quote out of green", () => {
  const now = Date.parse("2026-10-06T14:00:00Z");
  const q = { lagSec: 1, fetchedAtMs: now - 30_000 };
  assert.equal(G.effectiveLagSec(q, now), 31);
  assert.ok(G.effectiveLagSec(q, now) > 15, "past the green threshold");
  assert.equal(G.effectiveLagSec({ lagSec: 2, fetchedAtMs: now + 5_000 }, now), 2, "skew clamped");
  assert.equal(G.effectiveLagSec({ lagSec: 3 }, now), 3, "no fetch stamp → payload lag");
});

test("deskStaleLine names the build time and the reason", () => {
  const line = G.deskStaleLine("2026-10-06T14:32:05Z", "Desk build timed out");
  assert.match(line, /^Desk stale · built 10:32:05 AM ET · Desk build timed out$/);
  assert.match(G.deskStaleLine(null, "x"), /build time unknown/);
  assert.match(G.riskUnknownLine(Date.parse("2026-10-06T14:32:05Z")), /^risk unknown · since 10:32:05 AM ET$/);
});

// ---------------------------------------------------------------- wiring guards
const index = readFileSync(new URL("../src/routes/index.tsx", import.meta.url), "utf8");
const synapse = readFileSync(new URL("../src/lib/trading/desk-synapse.ts", import.meta.url), "utf8");

test("wiring: load() publishes the desk with NO risk arg and never passes null", () => {
  assert.match(index, /publishDesk\(held\);/);
  assert.doesNotMatch(index, /publishDesk\([^)]*,\s*null\s*\)/);
  assert.doesNotMatch(index, /publishDesk\(held,/);
  assert.match(index, /void loadRisk\(\);/);
});

test("wiring: loadRisk never publishes null risk and only sets no-session on the classified branch", () => {
  const body = index.slice(index.indexOf("const loadRisk = useCallback"), index.indexOf("const entryAllowed ="));
  assert.ok(body.length > 0);
  assert.doesNotMatch(body, /publishRisk\(null\)/);
  assert.doesNotMatch(body, /catch\s*\{[^}]*no-session/s, "no blanket catch → no-session");
  assert.match(body, /readRiskGoverned\(/);
  assert.match(body, /outcome\.state === "no-session"/);
  assert.match(body, /setRiskFetchState\("unknown"\)/);
  assert.match(index, /const entryAllowed = riskEntryAllowed\(riskFetchState, risk\)/);
});

test("wiring: desk-synapse publishDesk merges through resolvePublishedRisk", () => {
  assert.match(synapse, /risk: resolvePublishedRisk\(risk, get\(\)\.risk\)/);
});

test("wiring: quote poll is bounded", () => {
  assert.match(index, /withClientTimeout\(\s*fetchLiveQuotes\(/);
});
