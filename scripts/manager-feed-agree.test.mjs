/**
 * Manager feed → manager-agree wiring (src/lib/room/manager-feed.ts):
 * a real feed's getState() reaches the Stand bit; the demo stub never does.
 * And the account block defaults to Trading Stand's DEFAULT_MANAGER_ROOM_ACCOUNT snapshot.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { register } from "tsx/esm/api";

register();
const feedMod = await import("../src/lib/room/manager-feed.ts");
const rh = await import("../src/lib/execution/rh-autofire.ts");
const acct = await import("../src/lib/execution/manager-account.ts");
const ui = await import("../src/lib/ui/rh-account.ts");

const fakeFeed = (state) => ({ getState: () => state, subscribe: () => () => {} });

test("a real feed's ManagerRoomState reaches candidateFromFloorPathStand", () => {
  const s = { call: { agentAgree: true }, account: acct.DEFAULT_MANAGER_ROOM_ACCOUNT };
  const m = feedMod.managerStateForAgree(fakeFeed(s));
  assert.equal(m, s);
  const c = rh.candidateFromFloorPathStand({
    floor: { verdict: "ARMED", deskContracts: 1, band: "A", confluence: 0.7 },
    pathActionable: true,
    manager: m,
    optionsSessionOpen: true,
    newsBlackout: false,
    riskHalt: false,
    oneBookBlocked: false,
  });
  assert.equal(c.agentAgree, true);
  assert.equal(feedMod.standAgentAgree(fakeFeed({ call: { agentAgree: false } })), false);
});

test("the demo stub never becomes the Stand bit, and does not report automation by default", () => {
  const stub = feedMod.createStubManagerFeed();
  assert.equal(feedMod.isStubManagerFeed(stub), true);
  assert.equal(feedMod.managerStateForAgree(stub), null);
  assert.equal(feedMod.standAgentAgree(stub), false);
  assert.equal(feedMod.standAgentAgree(null), false);
  stub.dispose();
});

test("ManagerRoomState.account defaults to the funded Agentic read; the line is Stand's", () => {
  const stub = feedMod.createStubManagerFeed();
  const a = stub.getState().account;
  assert.equal(a, acct.DEFAULT_MANAGER_ROOM_ACCOUNT);
  assert.equal(a.isSnapshot, false);
  assert.equal(a.optionsBuyingPowerUsd, 996.12);
  const r = ui.readRhAccount(a);
  assert.equal(r.line, acct.managerAccountLine(a));
  assert.equal(r.blocked, false);
  assert.equal(r.wrongAccount, false);
  stub.dispose();
});

test("below-envelope reads red with Stand's exact words; the Individual block reads display-only", () => {
  const ind = ui.readRhAccount(acct.RH_INDIVIDUAL_SNAPSHOT_2026_10_06);
  assert.equal(ind.blocked, true);
  assert.equal(ind.line, "BP $11.56 · below $50 envelope, arm blocked");
  assert.equal(ind.who, "Individual ••••7477");
  const ok = ui.readRhAccount(acct.toManagerRhAccount({ cashUsd: 1000, optionsBuyingPowerUsd: 1000 }));
  assert.equal(ok.blocked, false);
  const unknown = ui.readRhAccount(acct.toManagerRhAccount({ cashUsd: 0, optionsBuyingPowerUsd: Number.NaN }));
  assert.equal(unknown.blocked, true);
});
