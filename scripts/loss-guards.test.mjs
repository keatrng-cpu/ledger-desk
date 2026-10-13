import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { register } from "tsx/esm/api";
register();
const RULES = JSON.parse(readFileSync(new URL("../shared/desk-rules.json", import.meta.url)));
const g = await import("../src/lib/smc/loss-guards.ts");
const L = RULES.loss;

test("loss guards read shared/desk-rules.json loss.*", () => {
  assert.deepEqual(g.LOSS, L);
});
test("1) 1h+4h both oppose: block under A, size cut at A/A-... A+ needs sweep+displacement", () => {
  const both = ["bear", "bear"];
  assert.equal(g.htfGuard("long", ...both, "B+", false, false).block, true);
  assert.equal(g.htfGuard("long", ...both, "A-", true, true).block, true);   // A- is under A
  const a = g.htfGuard("long", ...both, "A", false, false); assert.equal(a.block, false); assert.equal(a.sizeMult, L.htf.sizeMult);
  const ap = g.htfGuard("long", ...both, "A+", true, false); assert.equal(ap.capBand, "A"); assert.equal(ap.sizeMult, L.htf.sizeMult);
  const ok = g.htfGuard("long", ...both, "A+", true, true); assert.equal(ok.capBand, null); assert.equal(ok.sizeMult, 1);
  assert.equal(g.htfGuard("long", "bull", "bear", "B+", false, false).bothOppose, false);
  assert.equal(g.htfGuard("short", "neutral", "bull", "B+", false, false).bothOppose, false);
  // audit 2026-10-01 13:45 ET MNQ long 30868 (stopped 30814.75 in 9m): 1h bear + 4h bear on the desk's own mtf rungs
  assert.equal(g.htfGuard("long", "bear", "bear", "B+", false, false).block, true);
});
test("2) early exit: no 0.3R within N minutes; velocity q penalty", () => {
  assert.equal(g.earlyExit(L.early.minutes, 0.29 * 10, 10).cut, true);
  assert.equal(g.earlyExit(L.early.minutes - 1, 0, 10).cut, false);
  assert.equal(g.earlyExit(L.early.minutes, 0.31 * 10, 10).cut, false);
  const flat = Array.from({ length: 60 }, (_, i) => ({ t: i * 60_000, o: 100, h: 100.5, l: 99.5, c: 100, v: 0 }));
  const v = g.velocityRead(flat, 100, 130); // 1pt range / 60m → 30pt = 1800m
  assert.ok(v.expMin > L.velocity.maxMin); assert.equal(v.penalty, L.velocity.qPenalty);
  assert.equal(g.velocityRead(flat, 100, 100.3).penalty, 0);
});
test("3) buffered stop: beyond the swing + buffer, never inside max(minStopAtr, MAE pct)×ATR", () => {
  // audit 2026-09-30 11:00 ET ES short 7770.75, swing 7779.25 (0.64×ATR 13.27) → stopped, then T1 7756.5 printed
  const s = g.bufferedStop("short", 7770.75, 7779.25, 13.27);
  assert.ok(s >= 7779.25 + L.stop.bufferAtr * 13.27 - 0.25 - 1e-9);
  const tight = g.bufferedStop("long", 100, 99, 10);
  assert.ok(100 - tight >= Math.max(RULES.minStopAtr, L.stop.maePctAtr) * 10 - 0.125);
  assert.equal(g.bufferedStop("long", 100, null, 10), 100 - Math.round(Math.max(RULES.minStopAtr, L.stop.maePctAtr) * 10 * 4) / 4);
});
test("4) late entry: > late.maxAtr past the level blocks unless the full late rule passes", () => {
  assert.equal(g.lateGuard(106, 100, 10, false).block, true);
  assert.equal(g.lateGuard(106, 100, 10, true).block, false);
  assert.equal(g.lateGuard(104, 100, 10, false).late, false);
});
test("5) chop: tight overlapping range with failed breaks", () => {
  const bars = Array.from({ length: 60 }, (_, i) => ({ t: i * 60_000, o: 100, h: i === 32 ? 102 : 101, l: i === 47 ? 98 : 99, c: 100, v: 0 }));
  const c = g.chopRead(bars, 10); assert.equal(c.chop, true, JSON.stringify(c)); assert.ok(c.rangeAtr < L.chop.rangeAtr); assert.ok(c.failedBreaks >= L.chop.failedBreaks);
  const trend = Array.from({ length: 60 }, (_, i) => ({ t: i * 60_000, o: 100 + i, h: 101 + i, l: 99.8 + i, c: 101 + i, v: 0 }));
  assert.equal(g.chopRead(trend, 10).chop, false);
});
test("6) T1 must be a ranked draw (T2 promoted, else watch); breakeven at beFrac", () => {
  const ranked = [{ price: 120, rank: 0.5 }];
  assert.equal(g.rankedT1(110, 120, ranked).promoted, true);
  assert.equal(g.rankedT1(110, null, ranked).ok, false);
  assert.equal(g.rankedT1(120, null, ranked).ok, true);
  assert.equal(g.breakevenDue("long", 100, 120, 100 + 20 * L.target.beFrac), true);
  assert.equal(g.breakevenDue("short", 100, 80, 100 - 20 * L.target.beFrac + 0.5), false);
});
test("7) option net at T1 after theta and spread", () => {
  assert.equal(g.optionNetAtT1("ES", 7000, 7010, 20).ok, true);
  assert.equal(g.optionNetAtT1("ES", 7000, 7000.25, 60).ok, false);
  assert.equal(g.optionNetAtT1("XYZ", 1, 2, 10).net, null);
});
test("watcher (Python) mirrors the TS guards on the same inputs", () => {
  const dirs = [process.env.WATCHER_DIR, "/workspace/desk-watcher-next", "/workspace/desk-watcher"].filter(Boolean);
  const dir = dirs.find((d) => existsSync(`${d}/watcher/gates.py`) && readFileSync(`${d}/watcher/gates.py`, "utf8").includes("def loss_htf"));
  if (!dir) return; // watcher checkout not on this box / not yet on the loss guards
  const py = `import json,sys\nsys.path.insert(0, ${JSON.stringify(dir)})\nfrom watcher import gates\nout={}\nfor band in ["A+","A","A-","B+"]:\n  for sw in (True,False):\n    out[band+str(sw)]=list(gates.loss_htf("long",[("1h","bear"),("4h","bear")],band,sw,sw)[:2])\nout["rules"]=gates.RULES["loss"]\nprint(json.dumps(out))`;
  const r = JSON.parse(execFileSync("python3", ["-c", py]).toString());
  assert.deepEqual(r.rules, L);
  for (const band of ["A+", "A", "A-", "B+"]) for (const sw of [true, false]) {
    const t = g.htfGuard("long", "bear", "bear", band, sw, sw);
    assert.deepEqual(r[band + (sw ? "True" : "False")], [t.block, !t.block && t.sizeMult < 1], `${band} sweep/disp=${sw}`);
  }
});
test("modes (Keaton 13:45 CT): late + breakeven live; htf, early, velocity, stop, chop, ranked T1, option shadow", () => {
  const live = ["late"], shadowR = ["htf", "early", "velocity", "stop", "chop", "option", "target"];
  for (const k of live) assert.equal(L[k].mode, "live", k);
  for (const k of shadowR) assert.equal(L[k].mode, "shadow", k);
  assert.equal(L.target.beMode, "live");
  assert.ok(["block", "sizeCut"].includes(L.htf.legacyBothOppose));
});
test("desk build: shadow rules are recorded, never applied (source guard)", () => {
  const src = readFileSync(new URL("../src/lib/trading/build-desk.ts", import.meta.url), "utf8");
  for (const r of ["stop", "chop", "velocity", "htf", "late", "option"]) assert.match(src, new RegExp(`isLive\\(LOSS_RULES\\.${r}\\.mode\\)`), r);
  assert.match(src, /isLive\(LOSS_RULES\.target\.mode\)/);
});
test("watcher (Python) reads the same modes and keeps shadow rules out of the fire", () => {
  const dir = [process.env.WATCHER_DIR, "/workspace/desk-watcher-next", "/workspace/desk-watcher"].filter(Boolean)
    .find((d) => existsSync(`${d}/watcher/gates.py`) && readFileSync(`${d}/watcher/gates.py`, "utf8").includes("def loss_mode"));
  if (!dir) return;
  const py = `import json,sys\nsys.path.insert(0, ${JSON.stringify(dir)})\nfrom watcher import gates\nprint(json.dumps({k: gates.loss_mode(k) for k in ["htf","early","velocity","stop","late","chop","target","option"]} | {"be": gates.loss_mode("target","beMode")}))`;
  const r = JSON.parse(execFileSync("python3", ["-c", py]).toString());
  for (const k of ["htf", "early", "velocity", "stop", "late", "chop", "target", "option"]) assert.equal(r[k], L[k].mode, k);
  assert.equal(r.be, L.target.beMode);
});
