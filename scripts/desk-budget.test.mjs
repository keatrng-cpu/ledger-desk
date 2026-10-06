import { test } from "node:test";
import assert from "node:assert/strict";
import { register } from "tsx/esm/api";
register();
const { budgetedLeg, summarizeBudget, __resetDeskBudgetCache } = await import("../src/lib/market/desk-budget.ts");

const sleep = (ms, v) => new Promise((r) => setTimeout(() => r(v), ms));

test("fresh value inside the wait is served fresh", async () => {
  __resetDeskBudgetCache();
  const r = await budgetedLeg("a", "k:a", () => sleep(10, 42), { waitMs: 200, maxStaleMs: 60_000 });
  assert.equal(r.value, 42);
  assert.equal(r.leg.status, "fresh");
});

test("slow fetch with no last-good is MISSING, never invented", async () => {
  __resetDeskBudgetCache();
  const t0 = Date.now();
  const r = await budgetedLeg("b", "k:b", () => sleep(500, 7), { waitMs: 50, maxStaleMs: 60_000 });
  assert.equal(r.value, null);
  assert.equal(r.leg.status, "missing");
  assert.ok(Date.now() - t0 < 300, "budget honoured");
});

test("slow fetch serves last-good flagged stale; the in-flight result lands for the next build", async () => {
  __resetDeskBudgetCache();
  await budgetedLeg("c", "k:c", () => sleep(5, 1), { waitMs: 100, maxStaleMs: 60_000 });
  let calls = 0;
  const slow = () => { calls++; return sleep(150, 2); };
  const r = await budgetedLeg("c", "k:c", slow, { waitMs: 30, maxStaleMs: 60_000 });
  assert.equal(r.value, 1);
  assert.equal(r.leg.status, "stale");
  assert.equal(typeof r.leg.ageSec, "number");
  // A second build while the first fetch is still in flight joins it.
  const r2 = await budgetedLeg("c", "k:c", slow, { waitMs: 300, maxStaleMs: 60_000 });
  assert.equal(calls, 1, "in-flight request shared, not duplicated");
  assert.equal(r2.value, 2);
  assert.equal(r2.leg.status, "fresh");
});

test("TTL hit is 'cached' (not stale) and does not fetch", async () => {
  __resetDeskBudgetCache();
  await budgetedLeg("d", "k:d", () => sleep(1, "x"), { waitMs: 100, maxStaleMs: 60_000, ttlMs: 10_000 });
  let calls = 0;
  const r = await budgetedLeg("d", "k:d", () => { calls++; return sleep(1, "y"); }, { waitMs: 100, maxStaleMs: 60_000, ttlMs: 10_000 });
  assert.equal(r.value, "x");
  assert.equal(r.leg.status, "cached");
  assert.equal(calls, 0);
});

test("last-good older than maxStale is not served", async () => {
  __resetDeskBudgetCache();
  await budgetedLeg("e", "k:e", () => sleep(1, 5), { waitMs: 100, maxStaleMs: 60_000 });
  await sleep(30);
  const r = await budgetedLeg("e", "k:e", () => sleep(300, 6), { waitMs: 20, maxStaleMs: 10 });
  assert.equal(r.value, null);
  assert.equal(r.leg.status, "missing");
});

test("cold wait stretches only when there is nothing to fall back to", async () => {
  __resetDeskBudgetCache();
  const r = await budgetedLeg("f", "k:f", () => sleep(50, 9), { waitMs: 1, coldWaitMs: 3_000, maxStaleMs: 60_000 });
  assert.equal(r.value, 9, JSON.stringify(r.leg));
  assert.equal(r.leg.status, "fresh");
});

test("failure / empty upstream falls back like a timeout; clone protects the cache", async () => {
  __resetDeskBudgetCache();
  const clone = (v) => ({ ...v });
  const a = await budgetedLeg("g", "k:g", async () => ({ n: 1 }), { waitMs: 100, maxStaleMs: 60_000 }, clone);
  a.value.n = 999; // caller mutates what it was given
  const b = await budgetedLeg("g", "k:g", async () => { throw new Error("boom"); }, { waitMs: 100, maxStaleMs: 60_000 }, clone);
  assert.equal(b.leg.status, "stale");
  assert.equal(b.value.n, 1);
});

test("summary: only core legs stale the desk", () => {
  const t0 = Date.now() - 100;
  const legs = [
    { id: "bars:MNQ", status: "fresh", ms: 1, ageSec: 0 },
    { id: "daily:MNQ", status: "stale", ms: 7000, ageSec: 900 },
  ];
  const s1 = summarizeBudget(legs, ["bars:MNQ", "quote:MNQ"], t0);
  assert.equal(s1.tripped, true);
  assert.equal(s1.stale, false);
  assert.equal(s1.line, "");
  const s2 = summarizeBudget([...legs, { id: "quote:MNQ", status: "stale", ms: 7000, ageSec: 40 }], ["bars:MNQ", "quote:MNQ"], t0);
  assert.equal(s2.stale, true);
  assert.deepEqual(s2.staleCore, ["quote:MNQ"]);
  assert.match(s2.line, /quote:MNQ last-good 40s old/);
});
