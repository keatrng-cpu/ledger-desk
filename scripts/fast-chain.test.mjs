import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { register } from "tsx/esm/api";
register();
const RULES = JSON.parse(readFileSync(new URL("../shared/desk-rules.json", import.meta.url)));
const fc = await import("../src/lib/execution/fast-chain.ts");
const BASE = { band: "B+", symbol: "ES", side: "short", entry: 7851.75, stop_px: 7856.25, first_target: 7846.3, px: 7852, atr: 8, brain_symbol: "ES", brain_side: "short", bias1h: "bull", bias4h: "bear", expMin: 20.6 };
const CASES = [{}, { band: "B" }, { band: "A+" }, { stop_px: 7840 }, { first_target: 7849 }, { px: 7860 }, { brain_side: "long" }, { bias1h: "bull", bias4h: "bull" }, { expMin: 31 }, { expMin: null }, { side: "long", stop_px: 7840, first_target: 7870 }];
test("fastChain from shared rules: B+ / 90 s hold / T1 <= 30 m / first target 0.85R", () => {
  assert.deepEqual(fc.FC, RULES.fastChain);
  assert.equal(RULES.fastChain.mode, "live"); assert.equal(RULES.fastChain.minHoldS, 90); assert.equal(RULES.fastChain.minBand, "B+");
  assert.equal(RULES.fastChain.maxMinutesToT1, 30); assert.equal(RULES.fastChain.firstTargetR, 0.85); assert.equal(RULES.fastChain.spreadFallback, true);
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
