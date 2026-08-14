/**
 * Synthetic verification for the exit-freshness gate in paper-manager.ts.
 *
 * This is the measurement instrument for the entire ROADMAP — every R that
 * Phase C will read comes out of managePaperTradesAgainstPrice. The property
 * under test is: a stop/target/time-stop must NEVER book a fill against a
 * quote the desk itself would refuse to let you ENTER on.
 *
 * Runs against the real module (no mocks of the logic), with only a minimal
 * localStorage/window shim so the browser-targeted module can load in Node.
 */

// --- minimal browser shim (storage only; all trading logic is the real thing)
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
};
globalThis.window = globalThis;
globalThis.dispatchEvent = () => true;
globalThis.addEventListener = () => {};

const KEY = "ledger-paper-trades-v1";

const { managePaperTradesAgainstPrice } = await import(
  "../src/lib/trading/paper-manager.ts"
);
const { QUOTE_EXECUTION_MAX_LAG_SEC } = await import("../src/lib/market/types.ts");

let pass = 0;
let fail = 0;
function check(label, actual, expected) {
  const ok = actual === expected;
  if (ok) {
    pass++;
    console.log(`  ok: ${label}`);
  } else {
    fail++;
    console.error(`  FAIL: ${label} — expected ${expected}, got ${actual}`);
  }
}

/** A long that is CLEARLY stopped out at any price <= 100. */
function seedStoppedLong() {
  const t = {
    id: "t1",
    symbol: "MNQ",
    displaySymbol: "MNQ",
    side: "long",
    status: "open",
    entry: 110,
    stop: 100,
    workingStop: 100,
    tp1: 130,
    tp2: 150,
    contracts: 2,
    contractsOpen: 2,
    riskPts: 10,
    riskPct: 0.005,
    riskDollars: 40,
    grade: "A+",
    score: 0.9,
    strategy: "test",
    openedAt: Date.now() - 60_000,
    scaleLegs: [],
    reason: "verification fixture",
  };
  store.set(KEY, JSON.stringify([t]));
}

// Price is far BELOW the stop — an ungated run must close it.
const stoppedPrice = { last: 90, high: 90, low: 90 };

console.log(`=== Budget in use: ${QUOTE_EXECUTION_MAX_LAG_SEC}s ===`);

console.log("=== FRESH quote (lagSec well inside budget) -> fill IS booked ===");
{
  seedStoppedLong();
  const r = managePaperTradesAgainstPrice(
    { MNQ: { ...stoppedPrice, lagSec: 5 } },
    { enableTimeStops: false },
  );
  check("fresh: 1 position closed", r.closed.length, 1);
  check("fresh: 0 deferred", r.deferred.length, 0);
  check("fresh: exit booked at the stop", r.closed[0]?.exit, 100);
}

console.log("=== STALE quote: STOP still fires, and books the PRE-COMMITTED level ===");
{
  seedStoppedLong();
  const r = managePaperTradesAgainstPrice(
    { MNQ: { ...stoppedPrice, lagSec: QUOTE_EXECUTION_MAX_LAG_SEC + 1 } },
    { enableTimeStops: false },
  );
  // The whole point of the surgical design: the book does NOT freeze.
  check("stale stop: 1 position closed", r.closed.length, 1);
  check("stale stop: exit is the stop level, not the stale print", r.closed[0]?.exit, 100);
  check("stale stop: flagged as deferred/degraded", r.deferred.length, 1);
  check(
    "stale stop: deferral reports the age",
    r.deferred[0]?.lagSec,
    QUOTE_EXECUTION_MAX_LAG_SEC + 1,
  );
}

/** A long already through TP2 — used to prove the stale-fill clamp. */
function seedTargetHitLong() {
  const t = {
    id: "t2",
    symbol: "MNQ",
    displaySymbol: "MNQ",
    side: "long",
    status: "open",
    entry: 100,
    stop: 90,
    workingStop: 90,
    tp1: 110,
    tp2: 120,
    contracts: 1, // single contract -> goes out whole at TP2 path
    contractsOpen: 1,
    riskPts: 10,
    riskPct: 0.005,
    riskDollars: 20,
    grade: "A+",
    score: 0.9,
    strategy: "test",
    openedAt: Date.now() - 60_000,
    scaleLegs: [],
    reason: "verification fixture",
  };
  store.set(KEY, JSON.stringify([t]));
}

// Print is far ABOVE tp2 (120) — "target or better" would book 200.
const runawayPrice = { last: 200, high: 200, low: 200 };

console.log("=== FRESH + runaway print -> 'target or better' honoured (books 200) ===");
{
  seedTargetHitLong();
  const r = managePaperTradesAgainstPrice(
    { MNQ: { ...runawayPrice, lagSec: 5 } },
    { enableTimeStops: false },
  );
  check("fresh runaway: closed", r.closed.length, 1);
  check("fresh runaway: books the better print", r.closed[0]?.exit, 200);
}

console.log("=== STALE + runaway print -> fill CLAMPED to target (books 120, not 200) ===");
{
  seedTargetHitLong();
  const r = managePaperTradesAgainstPrice(
    { MNQ: { ...runawayPrice, lagSec: 9999 } },
    { enableTimeStops: false },
  );
  check("stale runaway: still closed (book does not freeze)", r.closed.length, 1);
  check("stale runaway: CLAMPED to the target that fired (tp1), no inflated R", r.closed[0]?.exit, 110);
  check("stale runaway: flagged deferred", r.deferred.length, 1);
}

console.log("=== UNKNOWN age behaves as stale (clamped, not inflated) ===");
{
  seedTargetHitLong();
  const r = managePaperTradesAgainstPrice(
    { MNQ: { ...runawayPrice } },
    { enableTimeStops: false },
  );
  check("unknown: clamped to tp1", r.closed[0]?.exit, 110);
  check("unknown: lagSec reported as undefined", r.deferred[0]?.lagSec, undefined);
}

console.log("=== BARE NUMBER price (legacy shape) -> unknown age -> clamped ===");
{
  seedTargetHitLong();
  const r = managePaperTradesAgainstPrice({ MNQ: 200 }, { enableTimeStops: false });
  check("bare number: clamped to tp1", r.closed[0]?.exit, 110);
  check("bare number: 1 deferred", r.deferred.length, 1);
}

console.log("=== BOUNDARY: lagSec exactly at budget -> treated as FRESH ===");
{
  seedTargetHitLong();
  const r = managePaperTradesAgainstPrice(
    { MNQ: { ...runawayPrice, lagSec: QUOTE_EXECUTION_MAX_LAG_SEC } },
    { enableTimeStops: false },
  );
  check("at budget: books the better print", r.closed[0]?.exit, 200);
  check("at budget: 0 deferred", r.deferred.length, 0);
}

console.log("=== ESCAPE HATCH: enableFreshnessGate:false (replay) -> no clamp ===");
{
  seedTargetHitLong();
  const r = managePaperTradesAgainstPrice(
    { MNQ: { ...runawayPrice } },
    { enableTimeStops: false, enableFreshnessGate: false },
  );
  check("gate off: books better print despite unknown age", r.closed[0]?.exit, 200);
  check("gate off: 0 deferred", r.deferred.length, 0);
}

console.log("=== TIME STOP is HELD on a stale quote (no fictional fill price) ===");
{
  // No stop/target hit: price sits mid-range so only a time stop could close it.
  seedTargetHitLong();
  const midPrice = { last: 105, high: 105, low: 105, lagSec: 9999 };
  const r = managePaperTradesAgainstPrice(
    { MNQ: midPrice },
    // time stops ON, but the quote is stale -> must not book feed.last
    { enableTimeStops: true, now: Date.now() + 86_400_000 },
  );
  check("stale time stop: nothing closed", r.closed.length, 0);
  const after = JSON.parse(store.get(KEY));
  check("stale time stop: position still open", after[0].status, "open");
  check("stale time stop: no exit price invented", after[0].exit, undefined);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
