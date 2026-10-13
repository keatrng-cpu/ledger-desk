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

const cardPlan = await import("../src/lib/trading/card-plan.ts");
const desk = await import("../src/lib/trading/options-desk.ts");

test("stop text names the raid only when it is on the stop side (card-plan.ts:288)", () => {
  // live card 2026-10-13 09:33 ET shape: MNQ short, stop above.
  assert.match(cardPlan.planStopText({ side: "short", entry: 30620, stop: 30698.5, sweep: { price: 30690, t: null } }), /beyond the raid 30690\.00/);
  assert.match(cardPlan.planStopText({ side: "short", entry: 30620, stop: 30698.5, sweep: { price: 30580, t: null } }), /entry array's far edge/);
  assert.match(cardPlan.planStopText({ side: "long", entry: 100, stop: 95, sweep: { price: 96, t: null } }), /beyond the raid 96\.00/);
  assert.match(cardPlan.planStopText({ side: "long", entry: 100, stop: 95, sweep: { price: 104, t: null } }), /entry array's far edge/);
});

test("working stop is 25% of the ticket debit, not the cap (options-desk.ts:1695)", () => {
  const out = desk.restampWorkingStop(["Working stop $138 / −25% of debit — not 1/3, not full", "Trim 50%"], 310);
  assert.equal(out[0], "Working stop $78 / −25% of debit — not 1/3, not full");
  assert.equal(out[1], "Trim 50%");
});

const sg = await import("../src/lib/trading/strategy-grade.ts");
const ew = await import("../src/lib/trading/engine-weights.ts");

test("INDEPENDENCE: a ronan card is complete without mechanical_model", () => {
  const r = sg.isStrategyComplete("ronan", ["ifvg", "displacement", "mid_bias"]);
  assert.equal(r.complete, true, r.note);
  assert.ok(!r.missing.includes("mechanical_model"));
});

test("INDEPENDENCE: a TJR card is complete without mechanical_model", () => {
  const r = sg.isStrategyComplete("tjr", ["sweep_significant", "ifvg", "mss"]);
  assert.equal(r.complete, true, r.note);
});

test("INDEPENDENCE: Blake's mechanical card still requires mechanical_model", () => {
  const r = sg.isStrategyComplete("mechanical", ["sweep_significant", "ifvg", "mss"]);
  assert.equal(r.complete, false);
  assert.ok(r.missing.includes("mechanical_model"));
});

test("INDEPENDENCE: 'still missing' names only the card's own template musts", () => {
  const raw = ["mechanical_model", "blake_swing", "or_raid", "htf_gap", "smt", "HTF top-down gate"];
  const ronan = shared.ownTemplateMissing(sg.templateFor("ronan"), raw, ew.SCORE_KEYS);
  assert.deepEqual(ronan, ["HTF top-down gate"]);
  const mech = shared.ownTemplateMissing(sg.templateFor("mechanical"), raw, ew.SCORE_KEYS);
  assert.ok(mech.includes("mechanical_model"));
  const smt = shared.ownTemplateMissing(sg.templateFor("smt"), raw, ew.SCORE_KEYS);
  assert.ok(smt.includes("smt") && smt.includes("mechanical_model")); // smt's own any-of group lists it
});

test("INDEPENDENCE: band/q come from the card's own template (unchanged by the missing filter)", () => {
  const comps = ["ifvg", "displacement", "mid_bias", "structure"];
  const a = sg.gradeStrategyAgainstMarket("ronan", comps, { htfOk: true });
  const b = sg.gradeStrategyAgainstMarket("ronan", [...comps, "mechanical_model"], { htfOk: true });
  assert.equal(a.complete, true);
  assert.equal(a.fit, b.fit); // another model's key is not in ronan's template: no penalty, no bonus
});

const shock = await import("../src/lib/trading/shock.ts");
const B = (o, h, l, c) => ({ t: 0, o, h, l, c, v: 1 });

test("SHOCK bias: close through the prior bar is delivery — lean with it", () => {
  const b = shock.shockBiasFrom("up", B(100, 140, 99, 138), B(98, 101, 97, 100), "macro", null);
  assert.deepEqual([b.kind, b.bias, b.smt, b.headlineTone], ["delivery", "bull", "both", "unknown"]);
  assert.equal(b.headline, null);
});

test("SHOCK bias: wick back inside is manipulation — lean fade; single-index raises the fade", () => {
  const single = shock.shockBiasFrom("up", B(100, 140, 99, 100.5), B(98, 101, 97, 100), "single", null);
  const both = shock.shockBiasFrom("up", B(100, 140, 99, 100.5), B(98, 101, 97, 100), "macro", null);
  assert.deepEqual([single.kind, single.bias], ["manipulation", "bear"]);
  assert.ok(single.confidence > both.confidence);
});

test("SHOCK bias: forming candle is pending — no lean, headline tone never invented", () => {
  const b = shock.shockBiasFrom("down", null, null, "single", "CPI");
  assert.deepEqual([b.kind, b.bias, b.confidence, b.headline, b.headlineTone], ["pending", "neutral", 0, "CPI", "unknown"]);
  assert.equal(shock.shockLeanSide(b), null);
});

test("SHOCK never hard-blocks: build-desk no longer turns a shock into a news blackout", async () => {
  const fs = await import("node:fs");
  const src = fs.readFileSync(new URL("../src/lib/trading/build-desk.ts", import.meta.url), "utf8");
  assert.ok(!/shock\.active\s*\?\s*\{\s*\.\.\.newsBase,\s*verdict:\s*"blackout"/.test(src));
  assert.match(src, /shockFloorMs: shock\.active \? shock\.freshFloorMs : null/);
});

test("SHOCK lean is a ranking nudge: it orders two otherwise-equal cards, never removes one", () => {
  const mk = (side) => ({ symbol: "MNQ", side, htfOk: true, components: ["sweep_significant", "displacement"], entryPx: 1, confluence: 0.7, pathBand: "A", actionable: true });
  const scan = { candidates: [mk("long"), mk("short")] };
  const bias = { symbol: "MNQ", topDown: "neutral" };
  const narr = { liquidity: { lastSweep: "none" } };
  const out = master.eligibleCandidates(scan, bias, narr, "short");
  assert.equal(out.length, 2);
  assert.equal(out[0].side, "short");
  assert.equal(master.eligibleCandidates(scan, bias, narr, "long")[0].side, "long");
});

const rp = await import("../src/lib/trading/raid-pair.ts");
const gt = await import("../src/lib/trading/gate-tuning.ts");

test("DATED SWEEPS: weight is 1 to recentSweepBars, decays linearly, 0 at twice", () => {
  const n = gt.GATE.recentSweepBars;
  assert.equal(rp.sweepAgeWeight(0), 1);
  assert.equal(rp.sweepAgeWeight(n), 1);
  assert.ok(rp.sweepAgeWeight(n + n / 2) > 0.45 && rp.sweepAgeWeight(n + n / 2) < 0.55);
  assert.equal(rp.sweepAgeWeight(2 * n), 0);
});

test("DATED SWEEPS: a raid past the old cliff still arms its side until invalidated", () => {
  const bars = tape();
  const n = gt.GATE.recentSweepBars;
  // push the SSL raid at index 60 to age n+4 with quiet bars that never close under its wick
  const tail = Array.from({ length: n + 2 }, (_, k) => bar(64 + k, 100.5, 101, 100, 100.6));
  const aged = [...bars, ...tail];
  const age = aged.length - 1 - 60;
  assert.ok(age > n);
  const raid = rp.polaritySweep(aged, "bull");
  assert.equal(raid?.side, "sellside");
  assert.ok(raid.ageWeight < 1 && raid.ageWeight > 0);
  // a close under the raid wick kills it
  const wick = raid.wickExtreme;
  const dead = [...aged, bar(aged.length, 100, 100, wick - 5, wick - 1)];
  assert.equal(rp.polaritySweep(dead, "bull")?.index === 60, false);
});

test("DATED SWEEPS: brain names the erased other-side raid instead of 'No raid yet'", () => {
  const input = canon.canonInputForCandidate(card({ side: "short", components: ["ifvg", "displacement"] }), { topDown: "bear", mid: "bear", dealing: { zone: "premium" } }, { liquidity: { lastSweep: "none", oppositeSweep: "ssl" }, confirmation: "none" }, clock);
  const f = canon.scoreCanonStack(input).factors.find((x) => x.id === "sweep");
  assert.equal(f.pass, false);
  assert.match(f.detail, /SSL raid arms LONG, not short/);
});

const det2 = await import("../src/lib/trading/detectors.ts");
function provFixture(lastClose) {
  const closed = tape().slice(0, 60);
  const n = closed.length;
  const lows = det2.fractalSwings(closed, det2.MM_SWING_WIDTH).filter((s) => s.kind === "low" && s.index + det2.MM_SWING_WIDTH < n);
  const lvl = lows[lows.length - 1].price;
  const start = closed[n - 1].t + 15 * 60_000;
  const m = (k, o, h, l, c) => ({ t: start + k * 60_000, o, h, l, c, v: 1 });
  const minute = [
    ...Array.from({ length: 30 }, (_, k) => ({ t: closed[n - 1].t + k * 60_000 - 15 * 60_000, o: 100, h: 100.2, l: 99.8, c: 100, v: 1 })),
    m(0, lvl + 1, lvl + 1.2, lvl - 2, lvl - 1), // wick through the pool, closes outside
    m(1, lvl - 1, lvl + 0.8, lvl - 2.5, lvl + 0.5), // close back inside
    m(2, lvl + 0.5, lvl + 1, lvl + 0.2, lastClose(lvl)),
  ];
  return { closed, minute, lvl, nowMs: start + 3 * 60_000 + 1 };
}

test("PROVISIONAL: a 1m close back inside after the wick counts before the 15m close", () => {
  const f = provFixture((l) => l + 0.8);
  const r = rp.provisionalRaid(f.closed, f.minute, "bull", f.nowMs);
  assert.equal(r?.provisional, true);
  assert.equal(r.side, "sellside");
  assert.equal(r.sweptLevel, f.lvl);
  assert.equal(r.wickExtreme, f.lvl - 2.5);
});

test("PROVISIONAL: a 1m close back beyond the level drops it; no raid on the other side", () => {
  const f = provFixture((l) => l - 0.5);
  assert.equal(rp.provisionalRaid(f.closed, f.minute, "bull", f.nowMs), null);
  const g = provFixture((l) => l + 0.8);
  assert.equal(rp.provisionalRaid(g.closed, g.minute, "bear", g.nowMs), null);
});

test("PROVISIONAL: once the 15m bar closes beyond the wick it is not a sweep (dropped)", () => {
  const f = provFixture((l) => l + 0.8);
  const closedBar = { t: f.closed[f.closed.length - 1].t + 15 * 60_000, o: f.lvl + 1, h: f.lvl + 1.2, l: f.lvl - 3, c: f.lvl - 2.8, v: 1 };
  const bars = [...f.closed, closedBar];
  assert.equal(rp.provisionalRaid(bars, f.minute, "bull", closedBar.t + 15 * 60_000 + 1), null);
  assert.ok(!rp.recentRealSweeps(bars).some((s) => s.index === bars.length - 1));
});

test("PROVISIONAL: brain text says 'SSL raid (1m, provisional)'", () => {
  const input = canon.canonInputForCandidate(card({ components: ["ifvg"] }), book, { liquidity: { lastSweep: "ssl", lastSweepProvisional: true }, confirmation: "sweep_only" }, clock);
  const f = canon.scoreCanonStack(input).factors.find((x) => x.id === "sweep");
  assert.match(f.detail, /SSL raid \(1m, provisional\)/);
  assert.equal(f.pass, true);
});
