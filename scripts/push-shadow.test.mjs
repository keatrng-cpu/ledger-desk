import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "tsx/esm/api";
register();
const p = await import("../src/lib/desk/push-shadow.ts");
const h = await import("../src/lib/desk/rules-hash.ts");
test("cardLatency: last CLOSED 1m bar at or before the build, build ms after it", () => {
  const t = Date.UTC(2026, 9, 15, 18, 0, 2, 900);
  const l = p.cardLatency(t);
  assert.equal(l.barCloseAt, Date.UTC(2026, 9, 15, 18, 0, 0)); assert.equal(l.buildMs, 2900); assert.equal(l.mode, "shadow"); assert.equal(l.targetS, 10);
  assert.ok(l.barCloseAt <= t);
});
test("sseFrame: one frame per new card, none for a re-read; shadow and live=false", () => {
  const card = { at: "2026-10-15T18:00:02.900Z", wire: { rulesHash: "a4bfcb65c88badcd", rule1: [{ symbol: "ES" }], latency: p.cardLatency(1), strategy: { symbol: "ES", side: "long", band: "B+" } } };
  const f = p.sseFrame(card, null, 5);
  assert.ok(f.frame.startsWith("event: card\n")); assert.ok(f.frame.endsWith("\n\n"));
  const body = JSON.parse(f.frame.split("data: ")[1]);
  assert.equal(body.live, false); assert.equal(body.rulesHash, "a4bfcb65c88badcd"); assert.equal(body.pushedAt, 5); assert.equal(body.rule1.length, 1);
  assert.equal(p.sseFrame(card, card.at, 6), null);
  assert.equal(p.sseFrame({}, null, 6), null);
});
test("stream is OFF unless DESK_PUSH_SHADOW=1", async () => {
  assert.equal(p.pushEnabled({}), false); assert.equal(p.pushEnabled({ DESK_PUSH_SHADOW: "0" }), false); assert.equal(p.pushEnabled({ DESK_PUSH_SHADOW: "1" }), true);
  const saved = process.env.DESK_PUSH_SHADOW; delete process.env.DESK_PUSH_SHADOW;
  const { Route } = await import("../src/routes/api/desk/card-stream.ts");
  const res = await Route.options.server.handlers.GET({ request: new Request("http://x/api/desk/card-stream") });
  assert.equal(res.status, 404);
  if (saved !== undefined) process.env.DESK_PUSH_SHADOW = saved;
});
test("rules hash unchanged: push config is outside shared/desk-rules.json", () => {
  assert.equal(readFileSync("shared/desk-rules.json", "utf8").includes("push-shadow"), false);
  assert.equal(h.RULES_HASH, "c3b14cab9e29a630");   // fix1016 block added 10-16; push config still outside desk-rules.json
  assert.equal(JSON.parse(readFileSync("shared/push-shadow.json", "utf8")).live, false);
});
