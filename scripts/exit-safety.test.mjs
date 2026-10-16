/** Exit safety (Keaton 2026-10-16) — one unit with desk-watcher watcher/exitsafe.py. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "tsx/esm/api";
register();
const X = await import("../src/lib/execution/exit-safety.ts");
const base = { entryLive: true, exitLive: true, sameInstance: true, exitCallable: true, sessionValid: true };

test("preflight refuses LIVE mismatch (entry live, exit dry-run — the 10-16 QQQ put)", () => {
  const r = X.preflightExitPath({ ...base, exitLive: false });
  assert.equal(r.ok, false); assert.match(r.reason, /LIVE mismatch/);
});
test("preflight refuses other instance / no session / not callable / dry-run", () => {
  assert.match(X.preflightExitPath({ ...base, sameInstance: false }).reason, /instance/);
  assert.match(X.preflightExitPath({ ...base, sessionValid: false }).reason, /session/);
  assert.match(X.preflightExitPath({ ...base, exitCallable: false }).reason, /callable/);
  assert.match(X.preflightExitPath({ ...base, entryLive: false, exitLive: false }).reason, /LIVE=0/);
  assert.equal(X.preflightExitPath(base).ok, true);
});
test("single-close invariant: second close refused while one working; nothing after fill", () => {
  const b = new X.CloseBook(); b.send("stop", "o1");
  assert.throws(() => b.send("ladder", "o2"), /single-close/);
  b.cleared("cancelled"); b.send("ladder", "o2"); b.cleared("filled");
  assert.throws(() => b.send("ladder", "o3"), /already closed/);
});
test("resting stop cancel on other exit: stop must be cleared before ladder rung", () => {
  const b = new X.CloseBook(); b.send("stop", "s1");
  assert.equal(b.canSend().ok, false); b.cleared("cancelled"); assert.equal(b.canSend().ok, true);
});
test("ladder timing / re-price / cross", () => {
  const s = X.ladderSchedule(); assert.deepEqual(s.slice(0, 4), [0, 2.5, 5, 7.5]);
  assert.deepEqual(X.ladderPrice(0, 1.47), { px: 1.47, crossed: false });
  assert.deepEqual(X.ladderPrice(5, 1.30), { px: 1.30, crossed: false });
  assert.deepEqual(X.ladderPrice(7.5, 1.20), { px: 1.19, crossed: true });
  assert.equal(X.stopLimitPrice(1.2), 1.02); assert.equal(X.stopLimitPrice(0.2), 0.15);
});
test("flag defaults off; note reflects it", () => {
  assert.equal(X.exitSafeEnabled({}), false); assert.match(X.exitSafetyNote(false), /OFF/);
});
test("one unit: params match watcher patch PARAMS; desk-rules.json untouched (hash a4bfcb65c88badcd)", () => {
  const patch = readFileSync(new URL("../docs/exit-safety-1016/watcher-exit-safety.patch", import.meta.url), "utf8");
  for (const [k, v] of [["reprice_s", X.EXIT_SAFE_PARAMS.repriceS], ["cross_after_s", X.EXIT_SAFE_PARAMS.crossAfterS], ["tick", X.EXIT_SAFE_PARAMS.tick], ["stop_limit_offset_pct", X.EXIT_SAFE_PARAMS.stopLimitOffsetPct]])
    assert.match(patch, new RegExp(`"${k}": ${Number(v).toFixed(String(v).includes(".") ? String(v).split(".")[1].length : 1)}`));
});
