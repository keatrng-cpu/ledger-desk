import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { register } from "tsx/esm/api";
register();
const RULES = JSON.parse(readFileSync(new URL("../shared/desk-rules.json", import.meta.url)));
const ox = await import("../src/lib/execution/opt-exec.ts");
const wk = await import("../src/lib/execution/weekly-lock.ts");
const C = (strike, d, bid, ask, oi = 0) => ({ contract: { strike }, quote: { delta: d, bid, ask, oi, volume: 0 } });
const CANDS = [C(1, 0.5, 2.0, 2.04), C(2, 0.6, 2.5, 2.7), C(3, 0.58, 2.6, 2.66, 10), C(4, 0.62, 2.8, 2.86, 500)];
const WEEK = [[0, 0], [950, 950], [600, 1000], [700, 1000], [-300, 0], [-299, 0], [899, 0]];

test("optExec / weekly / dayGovernor read shared rules", () => {
  assert.deepEqual(ox.OX, RULES.optExec); assert.deepEqual(wk.WEEKLY, RULES.weekly);
  assert.equal(RULES.weekly.mode, "live"); assert.equal(RULES.dayGovernor.mode, "shadow");
  for (const k of ["t1VsCost", "highIv", "slowSetup", "projNetFloor"]) assert.equal(RULES.optExec[k].mode, "shadow");
});
test("delta pick, limit walk, DTE by time, time-of-day size", () => {
  assert.equal(ox.pickByDelta(CANDS).contract.strike, 4);
  assert.equal(ox.walkLimit(1, 1.1, 0), 1.05); assert.equal(ox.walkLimit(1, 1.1, 99), 1.1);
  assert.equal(ox.dteTarget(600), 0); assert.equal(ox.dteTarget(14 * 60 + 31), 1); assert.equal(ox.dteTarget(15 * 60 + 26), 1);
  assert.equal(ox.todMult(600), 1); assert.equal(ox.todMult(14 * 60 + 5), RULES.optExec.todSize.cutMult);
});
test("weekly lock: $900 locks A+ 1ct/$250; 30% giveback blocks; -$300 blocks", () => {
  const a = wk.lockState(950, 950); assert.equal(a.state, "locked"); assert.equal(wk.weeklyAllows(a, "A"), false); assert.equal(wk.weeklyAllows(a, "A+"), true);
  assert.deepEqual(wk.weeklyCaps(a, 4, 650), [1, 250]);
  assert.equal(wk.lockState(700, 1000).state, "giveback_block"); assert.equal(wk.lockState(701, 1000, true).state, "locked");
  assert.equal(wk.lockState(-300, 0).state, "loss_block"); assert.equal(wk.lockState(-299, 0).state, "open");
  assert.equal(wk.weeklyAllows(null, "A+"), false);
});
test("watcher (Python) mirrors opt-exec + weekly lock on the same inputs", () => {
  const dirs = [process.env.WATCHER_DIR, "/workspace/desk-watcher", "/workspace/dw-optpnl", "/workspace/desk-watcher-next"].filter(Boolean);
  const dir = dirs.find((d) => existsSync(`${d}/watcher/optexec.py`) && existsSync(`${d}/watcher/weekly.py`));
  if (!dir) return;
  const py = `import json,sys\nsys.path.insert(0, ${JSON.stringify(dir)})\nfrom watcher import optexec as o, weekly as w\nC=${JSON.stringify(CANDS)}\nout={"pick":o.pick_by_delta(C)["contract"]["strike"],"walk":[o.walk_limit(1,1.1,i) for i in range(6)],"tod":[o.tod_mult(__import__("datetime").datetime(2026,10,13,h,m,tzinfo=w.ET)) for h,m in ((10,0),(14,5))],"week":[w.lock_state(p,k)["state"] for p,k in ${JSON.stringify(WEEK)}],"rules":[o.OX,w.W]}\nprint(json.dumps(out))`;
  const r = JSON.parse(execFileSync("python3", ["-c", py]).toString());
  assert.deepEqual(r.rules, [RULES.optExec, RULES.weekly]);
  assert.equal(r.pick, ox.pickByDelta(CANDS).contract.strike);
  assert.deepEqual(r.walk, [0, 1, 2, 3, 4, 5].map((i) => ox.walkLimit(1, 1.1, i)));
  assert.deepEqual(r.tod, [ox.todMult(600), ox.todMult(14 * 60 + 5)]);
  assert.deepEqual(r.week, WEEK.map(([p, k]) => wk.lockState(p, k).state));
});
