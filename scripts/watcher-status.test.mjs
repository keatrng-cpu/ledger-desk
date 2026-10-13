import { test } from "node:test";
import assert from "node:assert/strict";
import { register } from "tsx/esm/api";
register();
const { safeWatcherStatus } = await import("../src/lib/desk/watcher-status.ts");
test("watcher status: masked account passes; raw account, balances, tokens rejected", () => {
  assert.equal(safeWatcherStatus({ account: "••••6158", heartbeat: 1760380000, card: { q: 0.7 } }).ok, true);
  assert.equal(safeWatcherStatus({ account: "995386158" }).ok, false);
  assert.equal(safeWatcherStatus({ account: "••••6158", note: "acct 995386158" }).ok, false);
  assert.equal(safeWatcherStatus({ account: "••••6158", buying_power: 1000 }).ok, false);
  assert.equal(safeWatcherStatus({ account: "••••6158", x: { token: "abc" } }).ok, false);
  assert.equal(safeWatcherStatus([]).ok, false);
});
test("watcher POST auth: dedicated key, CRON_SECRET fallback, nothing else", async () => {
  const { watcherAuthorized: a } = await import("../src/lib/desk/watcher-status.ts");
  const env = { WATCHER_STATUS_TOKEN: "k1", CRON_SECRET: "c1" };
  assert.equal(a("Bearer k1", env), true); assert.equal(a("Bearer c1", env), true);
  assert.equal(a("Bearer nope", env), false); assert.equal(a(null, env), false); assert.equal(a("Bearer ", env), false);
  assert.equal(a("Bearer k1", { CRON_SECRET: "c1" }), false); assert.equal(a("Bearer x", {}), false);
});
