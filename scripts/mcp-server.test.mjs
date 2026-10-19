import { test } from "node:test";
import assert from "node:assert/strict";
import { register } from "tsx/esm/api";
register();
const { handleMcpMessage } = await import("../src/lib/desk/mcp-server.ts");

const deadLoad = async () => {
  throw new Error("load must not be called for static tools");
};
const call = (name) =>
  handleMcpMessage({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: {} } }, deadLoad);
const parse = (reply) => JSON.parse(reply.body.result.content[0].text);

test("tools/list includes the Codex-oriented static reads", async () => {
  const r = await handleMcpMessage({ jsonrpc: "2.0", id: 1, method: "tools/list" }, deadLoad);
  const names = r.body.result.tools.map((t) => t.name);
  for (const n of ["read_rules", "read_backtest", "read_calibration"]) assert.ok(names.includes(n), `missing ${n}`);
});

test("read_rules returns the rule set + a 16-hex RULES_HASH, without calling load", async () => {
  const r = await call("read_rules");
  assert.equal(r.body.result.isError, false);
  const d = parse(r);
  assert.match(d.rulesHash, /^[0-9a-f]{16}$/);
  assert.ok(d.rules && typeof d.rules === "object" && "bandEdges" in d.rules);
});

test("read_backtest returns the summary + trade count, and omits the raw trades array", async () => {
  const r = await call("read_backtest");
  const d = parse(r);
  assert.equal(r.body.result.isError, false);
  assert.ok(d.summary && typeof d.tradeCount === "number");
  assert.equal("trades" in d, false);
});

test("read_calibration returns confluence + ladder metadata", async () => {
  const r = await call("read_calibration");
  const d = parse(r);
  assert.equal(r.body.result.isError, false);
  assert.ok(d.confluence && typeof d.confluence.samples === "number");
  assert.ok(d.ladder && typeof d.ladder.method === "string");
});
