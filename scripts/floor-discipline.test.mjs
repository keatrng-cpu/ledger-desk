import { test } from "node:test";
import assert from "node:assert/strict";
import { register } from "tsx/esm/api";
register();
const W = await import("./lib/talk-world.mjs");
const D = await import("../src/lib/room/floor-discipline.ts");
const norm = (t) => t.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

// Item 40: a whole replayed day — zero repeated lines, every line cites a digit.
function replayDay(card) {
  const t0 = W.at(2026, 10, 6, 9, 28);
  const sim = new W.Sim(t0, {
    dt: 2000,
    make: (t, o) => {
      const drift = Math.floor((t - t0) / (20 * W.MIN));
      return { ...o, bookOver: { QQQ: { rangeUsedPct: 40 + drift * 3, volRatio: drift % 3 ? 0.9 : 1.5 }, SPY: { rangeUsedPct: 35 + drift * 3 } }, pulse: { vix: 17.2 + drift * 0.15, tenYear: 4.12, at: t }, card };
    },
  });
  sim.run(6.5 * 3600, W.walker(61, 2.5));
  return sim.items.flatMap((i) => i.lines);
}
for (const [name, card] of [
  ["B+ card", { key: "MNQ:long:B+:2", name: "B+ MNQ long", verdict: "WATCH", u: "QQQ", type: "CALL", band: "B+", tier: "forming", awayPts: 100, futSymbol: "MNQ", futSide: "long", entry: 29_900, stop: 29_860, t1: 30_000, pT1: 0.27, expR: 0.01, block: "LTF shift not printed", strategy: null }],
  ["A card (skeptic)", { key: "MNQ:long:A:1", name: "A MNQ long", verdict: "ARMED", u: "QQQ", type: "CALL", band: "A", tier: "armed", awayPts: 30, futSymbol: "MNQ", futSide: "long", entry: 29_960, stop: 29_900, t1: 30_100, pT1: 0.31, expR: 0.05, fit: 0.7, block: null, strategy: null }],
]) {
  test(`replay day (${name}): zero repeats, 100% of lines carry a live number`, () => {
    const lines = replayDay(card);
    assert.ok(lines.length >= 20, `only ${lines.length} lines`);
    const noDigit = lines.filter((l) => !/\d/.test(l.text));
    assert.deepEqual(noDigit.map((l) => l.text), []);
    const seen = new Map();
    for (const l of lines) seen.set(norm(l.text), (seen.get(norm(l.text)) ?? 0) + 1);
    assert.deepEqual([...seen].filter(([, n]) => n > 1), []);
    if (card.band === "A") assert.ok(lines.some((l) => /^Skeptic: A on MNQ/.test(l.text)), "skeptic challenged the A card");
  });
}

// Geometry lint (#1/#44).
test("plan geometry lint", () => {
  assert.equal(D.planGeometry("long", 100, 95, 110).ok, true);
  assert.equal(D.planGeometry("short", 100, 105, 90).ok, true);
  assert.equal(D.planGeometry("long", 30721.75, 30750.75, 30591.25).ok, false); // the live 2026-10-13 card
  assert.equal(D.planGeometry("short", 100, 95, 90).ok, false);
  assert.equal(D.planGeometry("long", 100, 95, 110, 105).ok, false);
  assert.equal(D.planGeometry("long", null, 95, 110).ok, true);
});
test("geometry lint over every fixture card in the talk verifiers", async () => {
  const fs = await import("node:fs");
  const src = fs.readFileSync(new URL("./verify-live-talk.mjs", import.meta.url), "utf8");
  const re = /futSide: "(long|short)", entry: ([\d_]+), stop: ([\d_]+), t1: ([\d_]+)/g;
  let m, n = 0;
  while ((m = re.exec(src))) {
    n++;
    const [, side, e, s, t] = m;
    assert.ok(D.planGeometry(side, +e.replace(/_/g, ""), +s.replace(/_/g, ""), +t.replace(/_/g, "")).ok, m[0]);
  }
  assert.ok(n > 0);
});
test("discipline: digit-free and repeated lines dropped", () => {
  const out = D.disciplineLines([{ text: "No number." }, { text: "CE 100." }, { text: "CE 100!" }, { text: "Stop 95." }], ["stop 95"]);
  assert.deepEqual(out.map((l) => l.text), ["CE 100."]);
});
test("skeptic reads the live A- edge (parity with desk-rules.json)", () => {
  const edges = D.bandEdges();
  assert.equal(D.skepticChallenge({ band: "B+", pT1: 0.2 }), null);
  const c = D.skepticChallenge({ band: "A-", fit: edges["A-"] + 0.01 });
  assert.equal(c.factor, "fit");
  assert.equal(c.edge, edges["A-"]);
  const moved = D.skepticChallenge({ band: "A-", fit: 0.7 }, { ...edges, "A-": 0.69 });
  assert.equal(moved.edge, 0.69);
  assert.equal(D.rulesHashOf({ a: 1 }) === D.rulesHashOf({ a: 2 }), false);
  assert.deepEqual(D.bandDiff({ "A-": 0.65 }, { "A-": 0.66 }), [{ band: "A-", from: 0.65, to: 0.66 }]);
});

const M = await import("../src/lib/room/floor-motion.ts");
const S = await import("../src/lib/room/said-memory.ts");
test("motion: ease in, decelerate on arrival, turn first, sidestep", () => {
  let v = 0;
  for (let i = 0; i < 100; i++) v = M.nextSpeed(v, 1.35, 5, 0.016);
  assert.ok(Math.abs(v - 1.35) < 1e-9);
  assert.ok(M.nextSpeed(0, 1.35, 5, 0.016) < 0.1, "no instant full speed");
  assert.ok(M.nextSpeed(1.35, 1.35, 0.1, 0.016) < 0.5, "slows near the end");
  assert.equal(M.turnFirst(0, Math.PI), true);
  assert.equal(M.turnFirst(0, 0.3), false);
  assert.deepEqual(M.separation([0, 0], [0, 1], [[0, -0.3]]), [0, 0], "someone behind is ignored");
  const [sx] = M.separation([0, 0], [0, 1], [[0.05, 0.3]]);
  assert.ok(sx < 0, "steps away from someone ahead-right");
});
test("said-memory: a material number change is said again; a cent of drift is not", () => {
  const t = 1_000_000;
  let rows = S.rememberSaid("Buying power $996.12 on the account.", [], t);
  assert.equal(S.heardBefore("Buying power $996.13 on the account.", rows, t + 1000), true);
  assert.equal(S.heardBefore("Buying power $1,250.00 on the account.", rows, t + 1000), false);
  rows = S.rememberSaid("3 of 8 PATH entries used.", [], t);
  assert.equal(S.heardBefore("4 of 8 PATH entries used.", rows, t + 1000), false);
  assert.equal(S.heardBefore("3 of 8 PATH entries used.", rows, t + 1000), true);
});

test("#39 said memory is keyed by ET trading day", () => {
  assert.equal(S.etDay(Date.UTC(2026, 9, 14, 3, 0)), "2026-10-13"); // 23:00 ET on the 13th
  assert.notEqual(S.saidKey(Date.UTC(2026, 9, 13, 15)), S.saidKey(Date.UTC(2026, 9, 14, 15)));
});

// #32: distinct voices — across a replayed day no two seats say the same sentence shape (numbers collapsed).
test("#32 no two seats share a line template in a replayed day", () => {
  const t0 = W.at(2026, 10, 6, 9, 28);
  const sim = new W.Sim(t0, { dt: 2000, make: (t, o) => ({ ...o, pulse: { vix: 17 + Math.floor((t - t0) / 1_200_000) * 0.2, tenYear: 4.12, at: t } }) });
  sim.run(6.5 * 3600, W.walker(7, 2.5));
  const by = new Map();
  for (const l of sim.items.flatMap((i) => i.lines)) {
    const g = S.speechGist(l.text);
    if (!by.has(g)) by.set(g, new Set());
    by.get(g).add(l.character);
  }
  const shared = [...by].filter(([, who]) => who.size > 1).map(([g, who]) => `${[...who].join("/")}: ${g}`);
  assert.deepEqual(shared, []);
});

// Accuracy Review: a headline with no publish time never gets an invented time.
test("invest news with a null publish time says the time is unknown", async () => {
  const IV = await import("../src/lib/room/live-voices-invest.ts");
  const { Facts } = await import("../src/lib/room/live-types.ts");
  const { freshTalkState } = await import("../src/lib/room/live-talk.ts");
  const now = Date.UTC(2026, 9, 6, 17, 0);
  const n = { id: "n1", title: "Acme wins contract", source: "Wire", publishedMs: null, tier: 1, why: "", impact: null, tickers: ["ACME"], topics: [] };
  for (const key of ["k1", "k2", "k3", "k4"]) {
    const ex = IV.exInvNews({ st: freshTalkState(), f: new Facts(), key, now }, { inv: {}, n, hit: { key: "ACME", label: "ACME", kind: "held" } });
    const head = ex.lines[0].text;
    assert.match(head, /publish time unknown/);
    assert.doesNotMatch(head, /\d{2}:\d{2}/, "no clock stamped");
  }
});
