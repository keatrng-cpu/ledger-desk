/**
 * The firing system: does the desk actually call the trader to the screen at
 * the one moment that matters, and does it refuse at every moment that does
 * not?
 *
 *   npx tsx scripts/verify-entry-alarm.mjs
 *
 * This runs the REAL `considerEntryAlarm` against a shimmed window, rather
 * than reading the source and believing it. The alarm's side effects already
 * guard on their environment — `ctx()` returns null with no AudioContext,
 * `showOsNote` returns with no Notification — so the only shim needed is a
 * localStorage and a dispatchEvent.
 *
 * WHAT IT CAUGHT (2026-09-24)
 *   1. The book loop did `return null` on an already-fired key instead of
 *      `continue`. `oneBook` is the SAME OBJECT as left or right, so the list
 *      [oneBook, left, right] tested one book twice — and once either book
 *      had alarmed for the day, the scan ended on it and the other book could
 *      never fire at all.
 *   2. The PATH alarm and the touch alarm shared one dedupe slot, so firing
 *      one erased the other's memory.
 *
 * Both are "the alarm did not go off on a trade that qualified", which is the
 * only failure mode of an alarm that costs money.
 */

// FROZEN CLOCK.
//
// `considerEntryAlarm` reads the real wall clock for its Judas and day-key
// checks, so this suite read it too — and failed every day between 09:30 and
// 09:45 ET, when the alarm correctly refuses. The pre-push hook then blocked
// every push for those fifteen minutes, which is how it was found.
//
// A test of a time-gated function that depends on WHEN it runs is not testing
// the function. Time is pinned to 10:15 ET — inside NY AM, clear of Judas —
// and moved deliberately where the gate itself is under test.
let NOW = Date.UTC(2026, 8, 24, 14, 15); // 10:15 ET, a Thursday
const realNow = Date.now;
Date.now = () => NOW;
/** ET is UTC-4 in September. */
const atEt = (h, m) => {
  NOW = Date.UTC(2026, 8, 24, h + 4, m);
};

// A window just real enough for the module under test.
const store = new Map();
globalThis.window = {
  localStorage: {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  },
  dispatchEvent: () => true,
  addEventListener: () => {},
  removeEventListener: () => {},
};
globalThis.localStorage = globalThis.window.localStorage;
globalThis.CustomEvent = class {
  constructor(type, init) {
    this.type = type;
    this.detail = init?.detail;
  }
};

const { considerEntryAlarm, PATH_ALARM_STORAGE } = await import(
  "../src/lib/alerts/path-alarm.ts"
);
const { isWatchable, touchKey } = await import("../src/lib/trading/entry-trigger.ts");

let pass = 0;
let fail = 0;
const fails = [];
const ok = (c, l) => (c ? pass++ : (fail++, fails.push(l)));

const arm = (over = {}) =>
  store.set(
    PATH_ALARM_STORAGE,
    JSON.stringify({
      armed: true,
      muted: false,
      lastKey: null,
      lastTouchKey: null,
      lastAt: null,
      lastTitle: null,
      ...over,
    }),
  );

const state = () => JSON.parse(store.get(PATH_ALARM_STORAGE) ?? "{}");

/** A book whose every must passes except the retrace — the watchable shape. */
function book(symbol, side, entry, over = {}) {
  return {
    symbol,
    side,
    word: "WAIT",
    missing: "retrace",
    mustPass: 8,
    mustNeed: 9,
    pathBand: "A",
    layers: [
      { id: "dol", must: true, state: "pass" },
      { id: "sweep", must: true, state: "pass" },
      { id: "pd_half", must: true, state: "pass" },
      { id: "ltf", must: true, state: "pass" },
      { id: "target", must: true, state: "pass" },
      { id: "retrace", must: true, state: "wait" },
    ],
    plan: {
      symbol,
      side,
      entry,
      stop: side === "short" ? entry + 20 : entry - 20,
      riskPts: 20,
      t1: side === "short" ? entry - 40 : entry + 40,
      t2: null,
      rr1: 2,
      rr2: null,
      entryZone: { top: entry + 1, bottom: entry - 1 },
      price: entry,
    },
    ...over,
  };
}

/** A desk in the trade window, news clear, both books priced AT their CE. */
function desk(left, right, prices, over = {}) {
  return {
    clock: { inTradeWindow: true, killzoneLabel: "NY AM" },
    news: { verdict: "clear" },
    left: { symbol: left.symbol },
    right: { symbol: right.symbol },
    quotes: {
      left: { price: prices[0], lagSec: 2, source: "live_gateway" },
      right: { price: prices[1], lagSec: 2, source: "live_gateway" },
    },
    smcMaster: { left, right, oneBook: left },
    ...over,
  };
}

const L = () => book("MNQ", "short", 30000);
const R = () => book("ES", "short", 7700);

// ── 1. It fires when everything but the retrace is true and price is at CE ──
{
  store.clear();
  arm();
  const l = L();
  const fire = considerEntryAlarm(desk(l, R(), [30000, 7000]));
  ok(fire != null, "fires on a watchable book with price at CE");
  ok(fire?.symbol === "MNQ", `names the book (${fire?.symbol})`);
  ok(/TOUCH/.test(fire?.title ?? ""), "the title says TOUCH");
  ok(/waiting on/.test(fire?.body ?? ""), "and the body says what is still missing");

  // Once per plan per day.
  ok(
    considerEntryAlarm(desk(l, R(), [30000, 7000])) == null,
    "does not fire twice for the same plan",
  );
}

// ── 2. THE REGRESSION: the second book must still be able to fire ──────────
//
// `oneBook` is the same object as `left`. With `return null` on a matched key
// the scan ended on MNQ and ES could never alarm for the rest of the day.
{
  store.clear();
  arm();
  const l = L();
  const r = R();
  const first = considerEntryAlarm(desk(l, r, [30000, 7000]));
  ok(first?.symbol === "MNQ", "MNQ fires first");

  // Now ES arrives at ITS entry. MNQ is still watchable and still at CE.
  const second = considerEntryAlarm(desk(l, r, [30000, 7700]));
  ok(second != null, "the SECOND book still fires after the first has");
  ok(second?.symbol === "ES", `and it is the right one (${second?.symbol})`);
}

// ── 3. The two alarms no longer share a dedupe slot ───────────────────────
{
  store.clear();
  arm();
  const l = L();
  considerEntryAlarm(desk(l, R(), [30000, 7000]));
  const afterTouch = state();
  ok(afterTouch.lastTouchKey != null, "the touch writes lastTouchKey");
  ok(afterTouch.lastKey == null, "and does NOT write the PATH alarm's slot");

  // A PATH alarm writing lastKey must not un-suppress the touch.
  arm({ lastKey: "some-path-key", lastTouchKey: afterTouch.lastTouchKey });
  ok(
    considerEntryAlarm(desk(l, R(), [30000, 7000])) == null,
    "a PATH fire cannot re-trigger an already-fired touch",
  );
}

// ── 4. Every refusal that keeps it honest ─────────────────────────────────
{
  const l = L();
  const at = [30000, 7000];

  store.clear();
  ok(considerEntryAlarm(desk(l, R(), at)) == null, "silent when not armed");

  store.clear();
  arm({ muted: true });
  ok(considerEntryAlarm(desk(l, R(), at)) == null, "silent when muted");

  store.clear();
  arm();
  ok(
    considerEntryAlarm(desk(l, R(), at, { news: { verdict: "blackout" } })) == null,
    "silent in a news blackout",
  );

  store.clear();
  arm();
  ok(
    considerEntryAlarm(
      desk(l, R(), at, { clock: { inTradeWindow: false, killzoneLabel: "closed" } }),
    ) == null,
    "silent outside the trade window",
  );

  // A FAILED must is never alarmed: nothing about it improves by price arriving.
  store.clear();
  arm();
  const dead = book("MNQ", "short", 30000);
  dead.layers = dead.layers.map((x) => (x.id === "sweep" ? { ...x, state: "fail" } : x));
  ok(considerEntryAlarm(desk(dead, R(), at)) == null, "silent on a failed must-layer");

  // Price not at CE.
  store.clear();
  arm();
  ok(considerEntryAlarm(desk(l, R(), [29000, 7000])) == null, "silent when price is away");

  // JUDAS. 09:30-09:45 ET takes nothing, no exception — the same rule
  // smc-master, paper-manager and this alarm all enforce. Asserted by moving
  // the clock, not by waiting for 09:30.
  store.clear();
  arm();
  atEt(9, 35);
  ok(considerEntryAlarm(desk(l, R(), at)) == null, "silent inside the Judas window");
  atEt(9, 46);
  ok(considerEntryAlarm(desk(l, R(), at)) != null, "and fires again once Judas is over");
  atEt(10, 15);

  // No priced plan, and no T1 — nothing to be called to.
  store.clear();
  arm();
  const noPlan = book("MNQ", "short", 30000, { plan: null });
  ok(considerEntryAlarm(desk(noPlan, R(), at)) == null, "silent with no plan");

  store.clear();
  arm();
  const noT1 = book("MNQ", "short", 30000);
  noT1.plan = { ...noT1.plan, t1: null };
  ok(considerEntryAlarm(desk(noT1, R(), at)) == null, "silent with no priced target");
}

// ── 5. isWatchable is the gate, and it is the RIGHT gate ──────────────────
{
  ok(isWatchable(L()), "every must but the retrace passing is watchable");

  const failed = L();
  failed.layers = failed.layers.map((x) => (x.id === "ltf" ? { ...x, state: "fail" } : x));
  ok(!isWatchable(failed), "a failed must is not watchable");

  const twoWaiting = L();
  twoWaiting.layers = twoWaiting.layers.map((x) =>
    x.id === "pd_half" ? { ...x, state: "wait" } : x,
  );
  ok(
    !isWatchable(twoWaiting),
    "two layers outstanding is not watchable — the touch is not the last condition",
  );

  // A COMPLETE sequence is still watchable: TAKE plus a touch is the best
  // case, not a reason to go quiet.
  const take = L();
  take.word = "TAKE";
  take.layers = take.layers.map((x) => ({ ...x, state: "pass" }));
  ok(isWatchable(take), "a complete sequence is still watchable");
}

// ── 6. The key is per-plan, so a RE-PLANNED entry can alarm again ─────────
{
  const a = L();
  const b = book("MNQ", "short", 30055);
  ok(
    touchKey(a, "2026-09-24") !== touchKey(b, "2026-09-24"),
    "a re-priced entry is a different key — the day's one beep is per PLAN",
  );
  ok(
    touchKey(a, "2026-09-24") !== touchKey(a, "2026-09-25"),
    "and it resets tomorrow",
  );
}

// ── 7. The alarm runs on the QUOTE clock, not the 20s desk clock ──────────
//
// The gateway delivers a print a second. Checking "is price at CE" only in
// the 20s desk poll meant a wick into the array and back out inside one
// window — ordinary at the open — filled a resting limit while never calling
// the trader. Asserted against the route because the cadence is wiring, not
// arithmetic.
{
  const { readFileSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const route = readFileSync(
    fileURLToPath(new URL("../src/routes/index.tsx", import.meta.url)),
    "utf8",
  );
  const quotePollStart = route.indexOf("const res = await fetchLiveQuotes");
  const quotePollEnd = route.indexOf("if (patched) applyPaper(patched)");
  ok(quotePollStart > 0 && quotePollEnd > quotePollStart, "found the quote poll");
  const body = route.slice(quotePollStart, quotePollEnd);
  ok(
    body.includes("considerEntryAlarm("),
    "the touch alarm is evaluated on every quote, not only on the 20s build",
  );
  ok(
    body.includes("fillRestingLimits("),
    "and resting limits still tick there too",
  );
}

console.log(`\nentry-alarm: ${pass} passed, ${fail} failed`);
if (fails.length) {
  console.log("\nFAILURES:");
  for (const f of fails) console.log("  ✗", f);
}
Date.now = realNow;
process.exit(fail ? 1 : 0);
