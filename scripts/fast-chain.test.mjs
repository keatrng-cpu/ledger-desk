import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { register } from "tsx/esm/api";
register();
const RULES = JSON.parse(readFileSync(new URL("../shared/desk-rules.json", import.meta.url)));
const fc = await import("../src/lib/execution/fast-chain.ts");
const BASE = { band: "B+", symbol: "ES", side: "short", entry: 7851.75, stop_px: 7856.25, first_target: 7846.3, px: 7852, atr: 8, brain_symbol: "ES", brain_side: "short", bias1h: "bull", bias4h: "bear", expMin: 20.6 };
const CASES = [{}, { band: "B" }, { band: "A+" }, { stop_px: 7840 }, { first_target: 7849 }, { px: 7860 }, { brain_side: "long" }, { bias1h: "bull", bias4h: "bull" }, { expMin: 31 }, { expMin: null }, { side: "long", stop_px: 7840, first_target: 7870 }, { side: "long", stop_px: 7856.25, first_target: 7846.3 }, { t2: 7850 }, { t2: 7840 }, { desk_ticket_side: "call" }, { desk_ticket_side: "put", desk_ticket_underlier: "QQQ" }, { desk_ticket_side: "put", desk_ticket_underlier: "SPY" }];
test("fastChain from shared rules: B+ / no hold timer: 2 consecutive polls, 90 s max age / T1 <= 30 m / first target 0.85R", () => {
  assert.deepEqual(fc.FC, RULES.fastChain);
  assert.equal(RULES.fastChain.mode, "live"); assert.equal(RULES.fastChain.confirmPolls, 2); assert.equal(RULES.fastChain.maxActionableAgeS, 90); assert.equal(RULES.fastChain.minHoldS, undefined); assert.equal(RULES.fastChain.minBand, "B+");
  assert.equal(RULES.fastChain.maxMinutesToT1, 30); assert.equal(RULES.fastChain.firstTargetR, 0.85); assert.equal(RULES.fastChain.spreadFallback, false);
  assert.ok(fc.fastSetupRows(BASE).every(([, ok]) => ok));
});
test("watcher (Python) fastchain.setup_rows matches the TS chain on the same cases", () => {
  const dirs = [process.env.WATCHER_DIR, "/workspace/desk-watcher", "/workspace/dw-optpnl"].filter(Boolean);
  const dir = dirs.find((d) => existsSync(`${d}/watcher/fastchain.py`));
  if (!dir) return;
  const snaps = CASES.map((c) => ({ ...BASE, ...c }));
  const py = `import json,sys\nsys.path.insert(0, ${JSON.stringify(dir)})\nfrom watcher import fastchain as f\nout=[]\nfor s in json.loads(${JSON.stringify(JSON.stringify(snaps))}):\n  s=dict(s); s["tape_prices"]={s["symbol"]:s.pop("px")}; s["htf_bias"]=[("1h",s.pop("bias1h")),("4h",s.pop("bias4h"))]; s["loss"]={"velocity":{"expMin":s.pop("expMin")}}\n  out.append([[n,ok] for n,ok,_ in f.setup_rows(s)])\nprint(json.dumps({"rows":out,"rules":f.FC}))`;
  const r = JSON.parse(execFileSync("python3", ["-c", py]).toString());
  assert.deepEqual(r.rules, RULES.fastChain);
  snaps.forEach((s, i) => assert.deepEqual(r.rows[i], fc.fastSetupRows(s).map(([n, ok]) => [n, ok]), JSON.stringify(CASES[i])));
});

const SIB = { at: "sib", entry: 7851.25, px: 7856 }; // sibling on the same symbol:side failing fast:entry
test("persist: fires on the 2nd consecutive real poll of the same setup id, no timer", () => {
  let st = fc.streakNext(null, { ...BASE, at: "a1" }, 0); assert.ok(!fc.persistOk(st, 0));
  assert.ok(!fc.persistOk(fc.streakNext(st, { ...BASE, at: "a1" }, 1_000), 1_000)); // re-read of the same card
  st = fc.streakNext(st, { ...BASE, at: "a2" }, 4_000); assert.ok(fc.persistOk(st, 4_000));
});
test("persist: a sibling/failing poll breaks the consecutive count but keeps the setup age; stale after 90 s", () => {
  let st = fc.streakNext(null, { ...BASE, at: "a1" }, 0);
  st = fc.streakNext(st, { ...BASE, ...SIB }, 4_000);
  st = fc.streakNext(st, { ...BASE, at: "a3" }, 8_000); assert.equal(st.polls, 1); assert.equal(st.firstMs, 0); assert.ok(!fc.persistOk(st, 8_000));
  st = fc.streakNext(st, { ...BASE, at: "a4" }, 90_000); assert.ok(fc.persistOk(st, 90_000));
  st = fc.streakNext(st, { ...BASE, at: "a5" }, 90_001); assert.ok(!fc.persistOk(st, 90_001)); // stale, never fired
});
test("persist: invalidation and side change reset the setup", () => {
  const st = fc.streakNext(fc.streakNext(null, { ...BASE, at: "a1" }, 0), { ...BASE, at: "a2" }, 4_000);
  assert.equal(fc.streakNext(st, { ...BASE, at: "x", px: 7857 }, 5_000).firstMs, null);
  assert.equal(fc.streakNext(st, { ...BASE, at: "x", px: 7846 }, 5_000).firstMs, null);
  assert.equal(fc.streakNext(st, { ...BASE, at: "x", strategy_invalidated: true }, 5_000).firstMs, null);
  const fl = fc.streakNext(st, { ...BASE, at: "l", side: "long", stop_px: 7840, first_target: 7870 }, 5_000);
  assert.equal(fc.streakNext(fl, { ...BASE, at: "a3" }, 200_000).firstMs, 200_000);
});
test("persist: watcher streak_next agrees with the TS twin on a poll sequence", () => {
  const dir = [process.env.WATCHER_DIR, "/workspace/desk-watcher"].filter(Boolean).find((d) => existsSync(`${d}/watcher/fastchain.py`));
  if (!dir) return;
  const seq = [[{ at: "a1" }, 0], [SIB, 4000], [{ at: "a3" }, 8000], [{ at: "a3" }, 9000], [{ at: "a4" }, 12000], [{ at: "a5", band: "B" }, 16000], [{ at: "a6" }, 20000], [{ at: "a7" }, 95000], [{ at: "c1", px: 7847 }, 96000], [{ at: "p1" }, 100000], [{ at: "p2" }, 104000]].map(([c, t]) => [{ ...BASE, ...c }, t]);
  const py = `import json,sys\nsys.path.insert(0, ${JSON.stringify(dir)})\nfrom watcher import fastchain as f\nst=None;out=[]\nfor s,t in json.loads(${JSON.stringify(JSON.stringify(seq))}):\n  s=dict(s); s["tape_prices"]={s["symbol"]:s.pop("px")}; s["htf_bias"]=[("1h",s.pop("bias1h")),("4h",s.pop("bias4h"))]; s["loss"]={"velocity":{"expMin":s.pop("expMin")}}\n  st=f.streak_next(st,s,t); out.append(f.persist_check(st,t)[0])\nprint(json.dumps(out))`;
  const py_out = JSON.parse(execFileSync("python3", ["-c", py]).toString());
  let st = null; const ts_out = seq.map(([s, t]) => { st = fc.streakNext(st, s, t); return fc.persistOk(st, t); });
  assert.deepEqual(py_out, ts_out); assert.ok(ts_out.includes(true));
});
test("velocity: soft row + size cut (half over the cap, minimum over 2x or unknown)", () => {
  for (const expMin of [31, null]) { const r = Object.fromEntries(fc.fastSetupRows({ ...BASE, expMin })); assert.equal(r["fast:velocity"], undefined); assert.equal(r["soft:fast:velocity"], true); }
  assert.ok(!RULES.fastChain.hard.includes("fast:velocity"));
  assert.equal(fc.velocitySize(4, 30), 4); assert.equal(fc.velocitySize(4, 31), 2); assert.equal(fc.velocitySize(3, 45), 1);
  assert.equal(fc.velocitySize(4, 61), 1); assert.equal(fc.velocitySize(4, null), 1); assert.equal(fc.velocitySize(null, 10), null);
});
test("entry re-arm: chase keeps the setup; pullback restarts the 90 s clock and confirmPolls", () => {
  let st = fc.streakNext(null, { ...BASE, at: "a1" }, 0);
  st = fc.streakNext(st, { ...BASE, at: "c1", px: 7847 }, 4_000); assert.equal(st.firstMs, 0); assert.ok(st.outOfZone);
  st = fc.streakNext(st, { ...BASE, at: "p1" }, 125_000); assert.equal(st.firstMs, 125_000); assert.ok(!fc.persistOk(st, 125_000));
  st = fc.streakNext(st, { ...BASE, at: "p2" }, 129_000); assert.ok(fc.persistOk(st, 129_000));
  const b = fc.streakNext(fc.streakNext(fc.streakNext(null, { ...BASE, at: "a1" }, 0), { ...BASE, at: "c1", px: 7847 }, 4_000), { ...BASE, at: "p1", band: "B" }, 8_000);
  assert.ok(!fc.persistOk(b, 8_000));
});
test("geometry: Floor ticket on another underlying/direction ignored; malformed T2 = no T2", () => {
  const geo = (c) => Object.fromEntries(fc.fastSetupRows({ ...BASE, ...c }))["fast:geometry"];
  assert.equal(geo({ symbol: "MNQ", entry: 30540, stop_px: 30560, first_target: 30500, px: 30541, atr: 40, brain_symbol: "MNQ", desk_ticket_side: "call", desk_ticket_underlier: "QQQ" }), true);
  assert.equal(geo({ side: "long", stop_px: 7840, first_target: 7870, desk_ticket_side: "put", desk_ticket_underlier: "QQQ" }), true);
  assert.equal(geo({ desk_ticket_side: "call", desk_ticket_underlier: "QQQ" }), true);
  assert.equal(fc.deskTicketApplies({ ...BASE, desk_ticket_side: "put", desk_ticket_underlier: "QQQ" }), false);
  assert.equal(fc.deskTicketApplies({ ...BASE, desk_ticket_side: "put", desk_ticket_underlier: "SPY" }), true);
  assert.equal(geo({ t2: 7850 }), true); assert.equal(fc.effectiveT2({ ...BASE, t2: 7850 }), null); assert.equal(fc.effectiveT2({ ...BASE, t2: 7840 }), 7840);
  assert.equal(geo({ stop_px: 7850 }), false); // real geometry still refuses
});
