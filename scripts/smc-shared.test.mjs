/**
 * One SMC read for desk, brain and Floor (src/lib/smc/shared.ts).
 *   - a later sweep of the other pool does not erase this side's raid (scanner + brain agree)
 *   - the brain's canon `sweep` factor reads the card's own raid, so a desk card with
 *     raid + displacement + array is not refused "BSL raid arms SHORT, not long"
 *   - the sequence parts the brain demands (`sequenceGaps`) and the raid the card carries agree
 *   - premium/discount: one verdict; a fighting half behind raid+displacement is a note
 *
 * Run: npm test  (node --test, TypeScript via tsx's loader)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { register } from "tsx/esm/api";

register();

const shared = await import("../src/lib/smc/shared.ts");
const { detectSweeps } = await import("../src/lib/trading/detectors.ts");
const canon = await import("../src/lib/trading/smc-canon.ts");
const master = await import("../src/lib/trading/smc-master.ts");

const T0 = Date.UTC(2026, 9, 12, 13, 0);
const bar = (i, o, h, l, c) => ({ t: T0 + i * 15 * 60_000, o, h, l, c, v: 1000 });
function tape() {
  const out = [];
  for (let i = 0; i < 60; i++) {
    const m = 100 + Math.sin(i / 2) * 2;
    out.push(bar(i, m, m + 1, m - 1, m + 0.2));
  }
  // SSL raid: wick under the recent swing low, close back inside.
  const lows = out.slice(30, 40).map((b) => b.l);
  const low = Math.min(...lows);
  out.push(bar(60, 99, 100, low - 3, 99.5));
  // a later BSL tag: wick over the recent swing high, close back inside.
  const highs = out.slice(40, 61).map((b) => b.h);
  const high = Math.max(...highs);
  out.push(bar(61, 100, high + 2, 99.5, 100.5));
  for (let i = 62; i < 64; i++) out.push(bar(i, 100.5, 101, 100, 100.6));
  return out;
}

test("the fixture has an SSL raid followed by a later BSL sweep", () => {
  const sw = detectSweeps(tape()).filter((s) => s.index >= 60);
  assert.ok(sw.some((s) => s.side === "sellside" && s.index === 60), JSON.stringify(sw));
  assert.equal(sw[sw.length - 1].side, "buyside");
});

test("armingRaid keeps this side's raid after a later sweep of the other pool", () => {
  const bars = tape();
  const bull = shared.armingRaid(bars, "bull", null);
  const bear = shared.armingRaid(bars, "bear", null);
  assert.equal(bull?.sweep.side, "sellside");
  assert.equal(bull?.source, "polarity");
  assert.equal(bear?.sweep.side, "buyside");
});

test("armingRaid falls back to Blake's live mechanical sweep, same direction only", () => {
  const sweep = { index: 3, t: T0, side: "sellside", sweptLevel: 99, wickExtreme: 98, closeBackInside: 0.5 };
  const det = { mechanical: { alive: true, direction: "long", sweep } };
  assert.equal(shared.armingRaid([], "bull", det)?.source, "mechanical");
  assert.equal(shared.armingRaid([], "bear", det), null);
  assert.equal(shared.armingRaid([], "bull", { mechanical: { ...det.mechanical, alive: false } }), null);
});

const card = (over = {}) => ({
  symbol: "MNQ",
  side: "long",
  components: ["sweep_significant", "displacement", "ifvg"],
  entryPx: 100,
  completeStrategy: null,
  strategyPrimary: "continuation",
  htfDisrespected: false,
  ...over,
});
const book = { topDown: "bull", mid: "bull", dealing: { zone: "discount" } };
const bearNarrative = { liquidity: { lastSweep: "bsl" }, confirmation: "armed_entry" };
const clock = { inTradeWindow: true, killzoneLabel: "ny_am" };

test("AGREEMENT: desk card with its own raid passes the brain's sweep factor (was 'BSL raid arms SHORT')", () => {
  const input = canon.canonInputForCandidate(card(), book, bearNarrative, clock);
  assert.equal(input.swept, "ssl");
  assert.equal(input.confirmation, "armed_entry");
  const sweep = canon.scoreCanonStack(input).factors.find((f) => f.id === "sweep");
  assert.equal(sweep.pass, true, sweep.detail);
});

test("AGREEMENT: no raid on the card — the brain still refuses on the wrong-polarity raid", () => {
  const input = canon.canonInputForCandidate(card({ components: ["displacement", "ifvg"] }), book, bearNarrative, clock);
  assert.equal(input.swept, "bsl");
  const sweep = canon.scoreCanonStack(input).factors.find((f) => f.id === "sweep");
  assert.equal(sweep.pass, false);
});

test("AGREEMENT: narrative already arms the side — unchanged", () => {
  const n = { liquidity: { lastSweep: "ssl" }, confirmation: "sweep_only" };
  const input = canon.canonInputForCandidate(card(), book, n, clock);
  assert.deepEqual([input.swept, input.confirmation], ["ssl", "sweep_only"]);
});

test("AGREEMENT: raid without displacement is setup only, not entry", () => {
  const r = shared.raidReadForCard(card({ components: ["sweep_significant"] }), { swept: "bsl", confirmation: "none" });
  assert.equal(r.confirmation, "sweep_only");
});

test("AGREEMENT: brain sequenceGaps 'raid' ⇔ card carries no shared raid component", () => {
  const sets = [["sweep_significant"], ["mechanical_model"], ["displacement"], [], ["sweep_significant", "displacement"]];
  for (const components of sets) {
    const gaps = master.sequenceGaps(card({ components }));
    assert.equal(gaps.includes("raid"), !shared.cardHasRaid(components), components.join(","));
  }
});

test("premium/discount: one verdict", () => {
  const named = { raid: true, displacement: true };
  const bare = { raid: false, displacement: false };
  assert.equal(shared.locationVerdict("long", "discount", bare), "pass");
  assert.equal(shared.locationVerdict("short", "premium", bare), "pass");
  assert.equal(shared.locationVerdict("long", "equilibrium", named), "wait");
  assert.equal(shared.locationVerdict("long", "premium", named), "note");
  assert.equal(shared.locationVerdict("short", "discount", named), "note");
  assert.equal(shared.locationVerdict("short", "discount", bare), "fail");
});
