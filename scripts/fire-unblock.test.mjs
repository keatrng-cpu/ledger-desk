// fire-unblock 2026-10-15 (audits/strictness-1015 + Accuracy #30): persist 20s per symbol:side surviving flips/failed rows,
// POI-half HTF exemption / soft, soft velocity, failed-FVG plan drop + plan hysteresis. Python twin: watcher tests/test_fire_unblock.py.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { register } from "tsx/esm/api";
register();
const RULES = JSON.parse(readFileSync(new URL("../shared/desk-rules.json", import.meta.url)));
const fc = await import("../src/lib/execution/fast-chain.ts");
const pp = await import("../src/lib/execution/plan-pin.ts");
const canon = await import("../src/lib/trading/smc-canon.ts");

// today's 09:40 CT MNQ short B+ (q 0.6499, qRaw 0.858), 1h+4h bear, T1 ~46 min at card velocity
const S0940 = { band: "B+", symbol: "MNQ", side: "short", entry: 29877.38, stop_px: 29924.24, first_target: 29748.42, px: 29876, atr: 40, brain_symbol: "MNQ", brain_side: "short", bias1h: "bear", bias4h: "bear", expMin: 46 };
const rowsOf = (s) => Object.fromEntries(fc.fastSetupRows(s));

test("rules: hold 20s, velocity soft, hard stops kept, band edges unchanged", () => {
  assert.equal(RULES.fastChain.mode, "shadow"); assert.equal(RULES.fastChain.minHoldS, 20); assert.equal(RULES.fastChain.velocityMode, "soft");
  assert.deepEqual([RULES.fastChain.persistDip.maxCards, RULES.fastChain.persistDip.maxS], [1, 5]);
  assert.equal(RULES.fastChain.targetLadder.t1RrMin, 0.6); assert.equal(RULES.fastChain.targetLadder.evOn, "t1");
  assert.ok(!RULES.fastChain.hard.includes("fast:velocity"));
  for (const h of ["band", "fast:persist", "fast:plan", "fast:geometry", "fast:entry", "fast:agree"]) assert.ok(RULES.fastChain.hard.includes(h), h);
  assert.equal(RULES.fastChain.rrMin, 1.0);
  for (const [k, v] of Object.entries({ "A+": 0.75, A: 0.68, "A-": 0.65, "B+": 0.6 })) assert.equal(RULES.bandEdges[k], v, k);
  assert.equal(RULES.poiHalf.htfAlignedExempt, true); assert.equal(RULES.poiHalf.mode, "soft");
});

test("replay 09:40 CT MNQ short: setup rows pass (velocity 46m is soft) and persist passes at 20s", () => {
  assert.ok(fc.fastSetupRows(S0940).every(([, ok]) => ok), JSON.stringify(rowsOf(S0940)));
  assert.equal(fc.velocitySoftRow(S0940).sizeCut, true);
  let st = null;
  for (let t = 0; t <= 21_000; t += 3_000) st = fc.streakNext(st, { ...S0940, at: `t${t}` }, t);
  assert.equal(fc.persistOk(st, 19_000), false); assert.equal(fc.persistOk(st, 20_000), true);
});

const poll = (st, from, to, step = 2000, o = {}) => { for (let t = from; t <= to; t += step) st = fc.streakNext(st, { ...S0940, ...o, at: `t${t}` }, t); return st; };
test("persist: qualifying conditions continuous; 1-card / 5s dip tolerated; longer, side change, invalidation, strategy.invalidated reset", () => {
  let st = poll(null, 0, 10_000);
  st = fc.streakNext(st, { ...S0940, band: "B", at: "dip" }, 12_000); assert.equal(st.sinceMs, 0); assert.equal(st.dips, 1);
  st = fc.streakNext(st, { ...S0940, at: "back" }, 14_000); assert.equal(st.dips, 0);
  st = fc.streakNext(st, { ...S0940, px: 29910, at: "c" }, 16_000); assert.equal(st.sinceMs, 0);       // entry fail is not a dip
  const two = fc.streakNext(fc.streakNext(st, { ...S0940, band: "B", at: "e" }, 17_000), { ...S0940, band: "B", at: "f" }, 18_000);
  assert.equal(two.sinceMs, null);
  assert.equal(fc.streakNext(st, { ...S0940, band: "B", at: "g" }, 22_500).sinceMs, null);
  assert.equal(fc.streakNext(st, { ...S0940, strategy_invalidated: true }, 17_000).sinceMs, null);
  assert.equal(fc.streakNext(st, { ...S0940, px: 29930 }, 17_000).sinceMs, null);
  assert.equal(fc.streakNext(st, { ...S0940, px: 29740 }, 17_000).sinceMs, null);
  assert.equal(fc.streakNext(st, { ...S0940, side: "long", stop_px: 29820, first_target: 29950 }, 17_000).sinceMs, null);
});

test("30 min of B then B+ does not pass persist instantly", () => {
  let st = poll(null, 0, 2000);
  st = poll(st, 4000, 1_800_000, 3000, { band: "B" });
  st = fc.streakNext(st, { ...S0940, at: "bp" }, 1_803_000);
  assert.equal(st.sinceMs, 1_803_000); assert.equal(fc.persistOk(st, 1_803_000), false);
  st = poll(st, 1_805_000, 1_823_000); assert.equal(fc.persistOk(st, 1_823_000), true);
});

test("live 10:02 CT ES B+ long: hold accumulates even when fast:entry fails on alternate polls (root cause of 'held None over 0 cards')", () => {
  const es = { band: "B+", symbol: "ES", side: "long", entry: 7757.75, stop_px: 7750.04, first_target: 7773, atr: 15.41, brain_symbol: "ES", brain_side: "long", bias1h: "bull", bias4h: "bull", expMin: 30.8 };
  let st = null;
  for (let i = 0; i < 8; i++) { st = fc.streakNext(st, { ...es, px: i % 2 ? 7760 : 7771, at: `p${i}` }, i * 3000); assert.equal(st.sinceMs, 0); }
  assert.ok(fc.persistOk(st, 21_000));
  assert.equal(rowsOf({ ...es, px: 7771 })["fast:entry"], false);                         // entry still hard at fire time
});

test("10/14 aligned shorts pass the fast setup rows", () => {
  for (const [sym, e, st, t1, atr] of [["MNQ", 30569, 30653, 30420, 60], ["MNQ", 30483, 30540, 30380, 60], ["ES", 7806, 7816.5, 7790, 8], ["MNQ", 30300, 30345, 30220, 50], ["MNQ", 30179, 30249.5, 30080, 50]]) {
    const s = { ...S0940, symbol: sym, brain_symbol: sym, entry: e, stop_px: st, first_target: t1, px: e, atr };
    assert.ok(fc.fastSetupRows(s).every(([, ok]) => ok), `${sym} ${e} ${JSON.stringify(rowsOf(s))}`);
  }
});

test("09:45 counter-bias A- long stays blocked; R:R<1 and stop-side stay hard", () => {
  assert.equal(rowsOf({ ...S0940, side: "long", band: "A-", entry: 29860, stop_px: 29820, first_target: 29940, px: 29862 })["fast:agree"], false);
  assert.equal(rowsOf({ ...S0940, first_target: 29850 })["fast:plan"], false);
  assert.equal(rowsOf({ ...S0940, px: 29925 })["fast:entry"], false);
  assert.equal(rowsOf({ ...S0940, plan_fvg_failed: true })["fast:plan"], false);
});

const CANON = { side: "short", htf: "bear", mtf: "bear", dealingZone: "discount", swept: "bsl", confirmation: "confirmed", inKillzone: true, smt: false, components: ["ifvg"] };
test("brain canon: POI half exempt when 1h+4h aligned (no grade cut); otherwise still costs score", () => {
  const off = canon.scoreCanonStack(CANON); const on = canon.scoreCanonStack({ ...CANON, htfAlignedBoth: true });
  assert.equal(off.factors.find((f) => f.id === "pd_half").pass, false);
  assert.equal(on.factors.find((f) => f.id === "pd_half").pass, true);
  assert.ok(on.score > off.score);
  const counter = canon.scoreCanonStack({ ...CANON, side: "long", dealingZone: "premium", swept: "ssl" });
  assert.equal(counter.factors.find((f) => f.id === "htf").pass, false);                     // counter-bias still fails the HTF must
});

const P = (o = {}) => ({ symbol: "MNQ", side: "short", entry: 29877.38, stop: 29924.24, t1: 29748.42, t2: 29700, q: 0.65, rr: 2.75, fvgFailed: false, minute: 1, ...o });
test("plan hysteresis + failed-FVG drop", () => {
  const a = P();
  assert.equal(pp.choosePlan(a, P({ entry: 29890, q: 0.67, minute: 2 })).plan, a);
  const c = P({ entry: 29890, q: 0.71, minute: 2 }); assert.equal(pp.choosePlan(a, c).plan, c);
  const d = P({ entry: 29890, rr: 3.1, minute: 2 }); assert.equal(pp.choosePlan(a, d).plan, d);
  assert.equal(pp.choosePlan(a, P({ entry: 1, q: 0.99, minute: 1 })).plan, a);
  assert.equal(pp.choosePlan(P({ fvgFailed: true }), c).plan, c);
  assert.equal(pp.choosePlan(a, P({ entry: 1, q: 0.99, fvgFailed: true, minute: 2 })).plan, a);
});

const FVG = { symbol: "MNQ", tf: "1m", kind: "fvg", dir: "bear", lo: 29870, hi: 29885, mitigated: false, createdT: 100 };
test("plan pin store: atomic pin, FVG re-read live by id, cleared on side change / invalidation / session end", () => {
  const pins = new Map(); const ctx = (o = {}) => ({ arrays: [FVG], px: 29876, day: "2026-10-15", sessionOpen: true, ...o });
  const a = P({ minute: 1, fvg: undefined });
  let r = pp.stepPins(pins, a, ctx()); assert.equal(r.why, "new"); assert.equal(pp.fvgId(r.plan.fvg), "1m:bear:29870:29885:100");
  const b = P({ entry: 29880, stop: 29930, t1: 29760, t2: 29650, q: 0.67, rr: 2.8, minute: 2 });
  r = pp.stepPins(pins, b, ctx()); assert.equal(r.plan.entry, 29877.38); assert.equal(r.plan.t2, 29700); assert.equal(r.plan.q, 0.65);   // whole pin kept
  r = pp.stepPins(pins, b, ctx({ arrays: [{ ...FVG, mitigated: true }] }));                          // pinned FVG fails LIVE
  assert.notEqual(r.plan?.entry, 29877.38);
  pp.stepPins(pins, a, ctx());
  r = pp.stepPins(pins, P({ side: "long", entry: 29870, stop: 29820, t1: 29950, minute: 3 }), ctx()); assert.ok(r.cleared.some((x) => /side change/.test(x)));
  pins.clear(); pp.stepPins(pins, a, ctx());
  r = pp.stepPins(pins, b, ctx({ px: 29930 })); assert.ok(r.cleared.some((x) => /invalidated/.test(x)));
  pins.clear(); pp.stepPins(pins, a, ctx());
  r = pp.stepPins(pins, b, ctx({ day: "2026-10-16" })); assert.ok(r.cleared.some((x) => /session end/.test(x)));
});

test("desk pinPlan: wire carries the pinned plan whole, gateTarget from the pin", async () => {
  const dl = await import("../src/lib/trading/desk-listen.ts");
  dl.resetPlanPins();
  const top = (e, st, t1, t2, q) => ({ symbol: "ES", side: "long", confluence: q, entryPx: e, plan: { entry: e, stop: st, t1, t2, rr1: (t1 - e) / (e - st), target: t1 } });
  const arr = [{ symbol: "ES", tf: "1m", kind: "fvg", dir: "bull", lo: 7755, hi: 7760, mitigated: false, createdT: 1 }];
  const now = Date.parse("2026-10-15T15:00:00Z");
  const w1 = dl.pinPlan(top(7757.13, 7743.25, 7772.75, 7780.25, 0.62), arr, now, 7758, true).wire;
  const w2 = dl.pinPlan(top(7758, 7744, 7770, 7790, 0.63), arr, now + 60_000, 7758, true).wire;
  assert.equal(w2.planPinned, true); assert.equal(w2.entry, 7757.13); assert.equal(w2.t2, 7780.25); assert.equal(w2.q, 0.62);
  assert.equal(w2.planId, w1.planId);
  assert.equal(w2.gateTarget.price, w1.gateTarget.price);
  dl.resetPlanPins();
});

test("parity with the watcher: streak + plan pick", () => {
  const dir = [process.env.WATCHER_DIR, "/workspace/dw-unblock2", "/workspace/dw-unblock"].filter(Boolean).find((d) => existsSync(`${d}/watcher/fastchain.py`));
  if (!dir) return;
  const seq = [{ ...S0940, at: "a" }, { ...S0940, band: "B", at: "b" }, { ...S0940, px: 29910, at: "c" }, { ...S0940, band: "B", at: "c2" }, { ...S0940, band: "B", at: "c3" }, { ...S0940, at: "d" }, { ...S0940, px: 29930, at: "e" }, { ...S0940, at: "f" }];
  let st = null; const ts = seq.map((s, i) => { st = fc.streakNext(st, s, i * 2000); return st.sinceMs; });
  const pairs = [[P(), P({ entry: 29890, q: 0.67, minute: 2 })], [P(), P({ entry: 29890, q: 0.71, minute: 2 })], [P({ fvgFailed: true }), P({ minute: 2, entry: 1 })], [P(), P({ entry: 1, q: 0.99, minute: 1 })], [P(), P({ t2: 29600, minute: 2 })]];
  const tsPick = pairs.map(([a, b]) => pp.choosePlan(a, b).plan === a ? "pin" : "cand");
  const py = `import json,sys\nsys.path.insert(0, ${JSON.stringify(dir)})\nfrom watcher import fastchain as f\nst=None;out=[]\nfor i,s in enumerate(json.loads(${JSON.stringify(JSON.stringify(seq))})):\n  s=dict(s); s["tape_prices"]={s["symbol"]:s.pop("px")}; s["htf_bias"]=[("1h",s.pop("bias1h")),("4h",s.pop("bias4h"))]; s["loss"]={"velocity":{"expMin":s.pop("expMin")}}\n  st=f.streak_next(st,s,i*2000); out.append(st["since_ms"])\npk=[]\nfor a,b in json.loads(${JSON.stringify(JSON.stringify(pairs))}):\n  a["fvg_failed"]=a.pop("fvgFailed"); b["fvg_failed"]=b.pop("fvgFailed"); p,_=f.plan_pick(a,b); pk.append("pin" if p is a else "cand")\nprint(json.dumps({"st":out,"pk":pk}))`;
  const r = JSON.parse(execFileSync("python3", ["-c", py]).toString());
  assert.deepEqual(r.st, ts); assert.deepEqual(r.pk, tsPick);
});

test("target ladder: 09:59 CT ES long gates on T2 7780.25 (T1 7772.75 R:R 1.13 stays first scale-out)", () => {
  const es = { band: "B+", symbol: "ES", side: "long", entry: 7757.13, stop_px: 7743.25, first_target: 7772.75, t2: 7780.25, px: 7758, atr: 15, brain_symbol: "ES", brain_side: "long", bias1h: "bull", bias4h: "bull", expMin: 20 };
  const g = fc.gateTarget(es); assert.equal(g.which, "t2"); assert.equal(g.target, 7780.25); assert.ok(g.rr >= 1.5);
  assert.ok(fc.fastSetupRows(es).every(([, ok]) => ok));
  assert.equal(fc.gateTarget({ ...es, t2: 7775 }).which, "t1");
  assert.equal(fc.gateTarget({ ...es, first_target: 7775 }).which, "t1");
  assert.equal(rowsOf({ ...es, first_target: 7760, t2: 7765 })["fast:plan"], false);
  assert.equal(fc.gateTarget({ ...es, first_target: 7758.5, t2: 7790 }).which, "t1");          // T1 0.1R: no ladder (t1RrMin 0.6)
  assert.equal(rowsOf({ ...es, first_target: 7758.5, t2: 7790 })["fast:plan"], false);
});
