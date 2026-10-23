// Chat sweep (shared rules chatSweep): setup, stop, size and manage — same fixture as desk-watcher tests/test_chat_sweep.py.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { register } from "tsx/esm/api";
register();
const { chatSweepRead, chatSweepSize, chatSweepManage, chatSweepMinContracts, chatSweepLive, chatSweepManageLive, chatUnit, CHAT_SWEEP } = await import("../src/lib/smc/chat-sweep.ts");
test("chat sweep: fixture, lookahead, size, manage", () => {
const cases = JSON.parse(readFileSync(new URL("./fixtures/chat-sweep-cases.json", import.meta.url), "utf8"));
for (const k of cases) {
  const r = chatSweepRead({ symbol: k.symbol, minute: k.minute, partner: k.partner, nowMs: k.nowMs });
  for (const side of ["long", "short"]) {
    const e = k.expect[side]; const p = r[side];
    if (!e) { assert.equal(p, null, `${k.name} ${side} should not print`); continue; }
    assert.ok(p, `${k.name} ${side} should print`);
    assert.equal(p.stop, e.stop, `${k.name} stop`); assert.equal(p.entry, e.entry, `${k.name} entry`); assert.equal(p.t1, e.t1, `${k.name} t1`);
    assert.ok(p.risk <= CHAT_SWEEP.maxStopPts + 1e-9);
  }
}
// no lookahead: appending a future bar does not change a read cut at nowMs
const k0 = cases[0];
const fut = { ...k0.minute.at(-1), t: k0.minute.at(-1).t + 60_000, l: 700, c: 700.5 };
assert.deepEqual(chatSweepRead({ symbol: "QQQ", minute: [...k0.minute, fut], partner: k0.partner, nowMs: k0.nowMs }).long, chatSweepRead({ symbol: "QQQ", minute: k0.minute, partner: k0.partner, nowMs: k0.nowMs }).long);
const LIVE = { ...CHAT_SWEEP, mode: "live", manageLive: true };
assert.equal(chatSweepSize(1, LIVE).ok, false); assert.equal(chatSweepSize(2, LIVE).ok, true);
assert.equal(chatUnit("QQQ", 712), 1); assert.ok(Math.abs(chatUnit("NQ", 711.75 * 41) - 41) < 1e-9);
let m = chatSweepManage({ side: "long", entry: 712.95, t1: 713.8, beTrigger: 0.35, px: 713.31, qty: 3, t1Done: false, beRequested: false }, LIVE);
assert.equal(m.action, "hold"); assert.equal(m.requestBe, true);
m = chatSweepManage({ side: "long", entry: 712.95, t1: 713.8, beTrigger: 0.35, px: 713.8, qty: 3, t1Done: false, beRequested: true }, LIVE);
assert.equal(m.action, "trim"); assert.equal(m.qty, 1); assert.equal(m.requestBe, false); assert.equal(m.beAfterFill, true);
m = chatSweepManage({ side: "short", entry: 712.6, t1: 711.75, beTrigger: 0.35, px: 711.7, qty: 1, t1Done: false, beRequested: false }, LIVE);
assert.equal(m.action, "hold"); assert.equal(m.qty, 0); assert.equal(m.requestBe, true);   // 1 contract: never trim to 0
assert.equal(chatSweepMinContracts(), CHAT_SWEEP.minContracts); assert.equal(CHAT_SWEEP.minContracts, 2);
assert.equal(chatSweepSize(1, { ...LIVE, minContracts: 1 }).ok, true);
// ships in SHADOW: nothing changes the fire, sizing or exits (annotate only)
assert.equal(CHAT_SWEEP.mode, "shadow"); assert.equal(CHAT_SWEEP.manageLive, false);
assert.equal(chatSweepLive(), false); assert.equal(chatSweepManageLive(), false);
assert.equal(chatSweepManageLive({ ...CHAT_SWEEP, mode: "live" }), false);              // live mode alone: management still off
assert.equal(chatSweepManageLive({ ...CHAT_SWEEP, manageLive: true }), false);         // flag alone (shadow): off
assert.deepEqual([chatSweepSize(1).ok, chatSweepSize(1).qty], [true, 1]);             // min 2 not enforced in shadow
for (const px of [713.31, 713.8, 712.0]) {
  const s0 = chatSweepManage({ side: "long", entry: 712.95, t1: 713.8, beTrigger: 0.35, px, qty: 3, t1Done: false, beRequested: false });
  assert.equal(s0.action, "hold"); assert.equal(s0.qty, 0); assert.equal(s0.requestBe, false);
}   // one config value drives sizing
console.log(`chat-sweep: ${cases.length} fixture cases + lookahead/size/manage OK`);
});
