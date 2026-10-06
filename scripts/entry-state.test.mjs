/**
 * The entry-state hero's mapping (src/lib/ui/entry-state.ts) — every row of
 * the table in that file, plus the two conflict reads. Presentation only:
 * these tests pin which desk words produce which hero word, so the hero can
 * never disagree with the board verdict it is derived from.
 *
 * Run: npm test  (node --test, TypeScript via tsx's loader)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { register } from "tsx/esm/api";

register();
const { deriveEntryState, detectConflicts, killzoneEnd } = await import("../src/lib/ui/entry-state.ts");

// 2026-10-06 is a Tuesday. 10:00 ET = 14:00 UTC (EDT).
const NY_AM = Date.parse("2026-10-06T14:00:00Z");
const ASIA = Date.parse("2026-10-06T00:40:00Z"); // 20:40 ET Monday

function book(over = {}) {
  return {
    symbol: "MNQ",
    side: "long",
    word: "WAIT",
    missing: "Retrace into array",
    missingDetail: "price 30pt above the array",
    mustPass: 7,
    mustNeed: 9,
    layers: [],
    plan: null,
    ...over,
  };
}

function card(over = {}) {
  return {
    symbol: "MNQ",
    side: "long",
    confluence: 0.6,
    grade: "B",
    pathBand: "C",
    actionable: false,
    htfOk: true,
    vetoes: [],
    missing: ["LTF shift"],
    entryPx: null,
    ...over,
  };
}

function desk(over = {}) {
  return {
    clock: { inTradeWindow: true, sessionLive: true, killzoneLabel: "NY AM killzone", nextWindow: "Lunch 11:00 ET" },
    news: { verdict: "clear", reason: "" },
    brief: { verdict: "trade", headline: "" },
    bias: {
      left: { symbol: "MNQ", topDown: "bull" },
      right: { symbol: "ES", topDown: "bull" },
    },
    draws: {
      left: { primary: { side: "above", price: 31400, name: "PDH" } },
      right: { primary: { side: "above", price: 7850, name: "PDH" } },
    },
    narrative: { left: { liquidity: { lastSweep: "none" } }, right: { liquidity: { lastSweep: "none" } } },
    smcMaster: { left: book(), right: book({ symbol: "ES" }), oneBook: null },
    scan: { candidates: [card()] },
    ...over,
  };
}

const STAND = { word: "STAND", line: "WAIT MNQ LONG · Retrace", book: "left" };

test("row 1: MANAGE (open position) is WAIT — do not add", () => {
  const r = deriveEntryState(desk(), { word: "MANAGE", line: "MNQ LONG in play · stop 1", book: "left" }, NY_AM);
  assert.equal(r.state, "WAIT");
  assert.equal(r.rule, 1);
  assert.match(r.why, /already in a trade/);
});

test("row 2: TAKE is ENTER with a countdown to the end of the killzone", () => {
  const d = desk({ scan: { candidates: [card({ actionable: true, pathBand: "A+", confluence: 0.8 })] } });
  d.smcMaster.left = book({ word: "TAKE", plan: { entry: 31344.25 } });
  const r = deriveEntryState(d, { word: "TAKE", line: "MNQ LONG A+", book: "left" }, NY_AM);
  assert.equal(r.state, "ENTER");
  assert.equal(r.rule, 2);
  assert.match(r.why, /31,344\.25/);
  assert.ok(r.countdown, "countdown inside NY AM");
  // NY AM ends 11:00 ET = 15:00 UTC.
  assert.equal(r.countdown.endsAtMs, Date.parse("2026-10-06T15:00:00Z"));
});

test("row 3: closed window is WAIT even with an armed card", () => {
  const d = desk({
    clock: { inTradeWindow: false, sessionLive: false, killzoneLabel: "Asia range", nextWindow: "London 3:00 ET" },
    scan: { candidates: [card({ actionable: true, pathBand: "A", confluence: 0.77 })] },
  });
  const r = deriveEntryState(d, STAND, ASIA);
  assert.equal(r.state, "WAIT");
  assert.equal(r.rule, 3);
  assert.match(r.why, /window is closed \(Asia range\)/);
});

test("row 3: news blackout is WAIT", () => {
  const r = deriveEntryState(desk({ news: { verdict: "blackout", reason: "CPI 08:30" } }), STAND, NY_AM);
  assert.equal(r.state, "WAIT");
  assert.match(r.why, /CPI 08:30/);
});

test("row 4: an armed A-band card without a TAKE is ARMED", () => {
  const d = desk({ scan: { candidates: [card({ actionable: true, pathBand: "A", confluence: 0.77 })] } });
  const r = deriveEntryState(d, STAND, NY_AM);
  assert.equal(r.state, "ARMED");
  assert.match(r.why, /waiting on retrace into array/);
});

test("row 4 needs the fit at the floor: an actionable B+ is not ARMED", () => {
  const d = desk({ scan: { candidates: [card({ actionable: true, pathBand: "B+", grade: "B", confluence: 0.7 })] } });
  assert.notEqual(deriveEntryState(d, STAND, NY_AM).state, "ARMED");
});

test("row 5: a clean card at the floor is STALKING", () => {
  const d = desk({ scan: { candidates: [card({ confluence: 0.68 })] } });
  d.smcMaster.left = book({ mustPass: 3 });
  const r = deriveEntryState(d, STAND, NY_AM);
  assert.equal(r.state, "STALKING");
  assert.match(r.why, /clears the 0\.65 floor/);
});

test("row 5: one must-layer from complete is STALKING", () => {
  const d = desk();
  d.smcMaster.left = book({ mustPass: 8, mustNeed: 9 });
  const r = deriveEntryState(d, STAND, NY_AM);
  assert.equal(r.state, "STALKING");
  assert.match(r.why, /8\/9/);
});

test("row 6: a vetoed card is WAIT and says the veto", () => {
  const d = desk({ scan: { candidates: [card({ confluence: 0.66, vetoes: ["mitigation block — failed push origin"] })] } });
  d.smcMaster.left = book({ mustPass: 3 });
  const r = deriveEntryState(d, STAND, NY_AM);
  assert.equal(r.state, "WAIT");
  assert.equal(r.rule, 6);
  assert.match(r.why, /vetoed \(mitigation block\)/);
});

test("killzoneEnd is null outside a trade window", () => {
  assert.equal(killzoneEnd(ASIA), null);
});

test("conflict: HTF bull with the draw below", () => {
  const d = desk();
  d.draws.left.primary = { side: "below", price: 31371, name: "PDH (external BSL)" };
  const c = detectConflicts(d);
  assert.equal(c.length, 1);
  assert.equal(c[0].kind, "htf_vs_draw");
  assert.equal(c[0].a.dir, "up");
  assert.equal(c[0].b.dir, "down");
});

test("conflict: sequence long while the BSL raid arms a short", () => {
  const d = desk();
  d.narrative.right.liquidity.lastSweep = "bsl";
  const c = detectConflicts(d);
  assert.equal(c.length, 1);
  assert.equal(c[0].kind, "stand_vs_armed");
  assert.match(c[0].explain, /arms a short/);
});

test("conflict: sequence long while an actionable card is short", () => {
  const d = desk({ scan: { candidates: [card({ side: "short", actionable: true, pathBand: "A" })] } });
  const c = detectConflicts(d);
  assert.equal(c.length, 1);
  assert.match(c[0].b.label, /armed short/);
});

test("no conflicts on an aligned desk", () => {
  assert.deepEqual(detectConflicts(desk()), []);
});
