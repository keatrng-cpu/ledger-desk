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
