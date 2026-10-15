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
  assert.equal(RULES.fastChain.minHoldS, 20); assert.equal(RULES.fastChain.velocityMode, "soft");
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

test("persist survives grade flicker / failed entry row / plan swap; resets on side change or invalidation", () => {
  let st = fc.streakNext(null, { ...S0940, at: "a" }, 0);
  st = fc.streakNext(st, { ...S0940, band: "B", at: "b" }, 4_000);
  st = fc.streakNext(st, { ...S0940, px: 29910, at: "c" }, 8_000);
  st = fc.streakNext(st, { ...S0940, entry: 29880, at: "d" }, 12_000);
  assert.equal(st.sinceMs, 0); assert.equal(st.cards, 4);
  assert.equal(fc.streakNext(st, { ...S0940, px: 29930 }, 13_000).sinceMs, null);          // through the stop
  assert.equal(fc.streakNext(st, { ...S0940, px: 29740 }, 13_000).sinceMs, null);          // T1 traded
  assert.equal(fc.streakNext(st, { ...S0940, side: "long", stop_px: 29820, first_target: 29950 }, 13_000).sinceMs, null);   // side change: old hold gone (new long fails agree here)
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

const P = (o = {}) => ({ symbol: "MNQ", side: "short", entry: 29877.38, stop: 29924.24, t1: 29748.42, q: 0.65, rr: 2.75, fvgFailed: false, minute: 1, ...o });
test("plan hysteresis + failed-FVG drop", () => {
  const a = P();
  assert.equal(pp.choosePlan(a, P({ entry: 29890, q: 0.67, minute: 2 })).plan, a);
  const c = P({ entry: 29890, q: 0.71, minute: 2 }); assert.equal(pp.choosePlan(a, c).plan, c);
  const d = P({ entry: 29890, rr: 3.1, minute: 2 }); assert.equal(pp.choosePlan(a, d).plan, d);
  assert.equal(pp.choosePlan(a, P({ entry: 1, q: 0.99, minute: 1 })).plan, a);
  assert.equal(pp.choosePlan(P({ fvgFailed: true }), c).plan, c);
  assert.equal(pp.choosePlan(a, P({ entry: 1, q: 0.99, fvgFailed: true, minute: 2 })).plan, a);
  const arr = [{ symbol: "MNQ", kind: "fvg", dir: "bear", lo: 29870, hi: 29885, mitigated: true }];
  assert.equal(pp.planFvgFailed({ symbol: "MNQ", side: "short", entry: 29877.38 }, arr), true);
  assert.equal(pp.planFvgFailed({ symbol: "MNQ", side: "short", entry: 29877.38 }, [{ ...arr[0], mitigated: false }]), false);
});

test("parity with the watcher: streak + plan pick", () => {
  const dir = [process.env.WATCHER_DIR, "/workspace/dw-unblock"].filter(Boolean).find((d) => existsSync(`${d}/watcher/fastchain.py`));
  if (!dir) return;
  const seq = [{ ...S0940, at: "a" }, { ...S0940, band: "B", at: "b" }, { ...S0940, px: 29910, at: "c" }, { ...S0940, px: 29930, at: "d" }, { ...S0940, at: "e" }];
  let st = null; const ts = seq.map((s, i) => { st = fc.streakNext(st, s, i * 5000); return st.sinceMs; });
  const pairs = [[P(), P({ entry: 29890, q: 0.67, minute: 2 })], [P(), P({ entry: 29890, q: 0.71, minute: 2 })], [P({ fvgFailed: true }), P({ minute: 2, entry: 1 })], [P(), P({ entry: 1, q: 0.99, minute: 1 })]];
  const tsPick = pairs.map(([a, b]) => pp.choosePlan(a, b).plan === a ? "pin" : "cand");
  const py = `import json,sys\nsys.path.insert(0, ${JSON.stringify(dir)})\nfrom watcher import fastchain as f\nst=None;out=[]\nfor i,s in enumerate(json.loads(${JSON.stringify(JSON.stringify(seq))})):\n  s=dict(s); s["tape_prices"]={s["symbol"]:s.pop("px")}; s["htf_bias"]=[("1h",s.pop("bias1h")),("4h",s.pop("bias4h"))]; s["loss"]={"velocity":{"expMin":s.pop("expMin")}}\n  st=f.streak_next(st,s,i*5000); out.append(st["since_ms"])\npk=[]\nfor a,b in json.loads(${JSON.stringify(JSON.stringify(pairs))}):\n  a["fvg_failed"]=a.pop("fvgFailed"); b["fvg_failed"]=b.pop("fvgFailed"); p,_=f.plan_pick(a,b); pk.append("pin" if p is a else "cand")\nprint(json.dumps({"st":out,"pk":pk}))`;
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
});
