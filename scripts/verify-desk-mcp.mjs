/**
 * Protocol check for the desk MCP server. No live desk, no network.
 * Run: npx tsx scripts/verify-desk-mcp.mjs
 */
import { encodeMcp, handleMcpMessage, wantsSse } from "../src/lib/desk/mcp-server.ts";

const card = {
  ok: true,
  at: "2026-10-08T13:00:00.000Z",
  clock: { et: "09:00", killzone: "pre", judas: "off", sessionOpen: false },
  quotes: {
    left: { symbol: "MNQ", price: 1, lagSec: 1 },
    right: { symbol: "ES", price: 2, lagSec: 1 },
  },
  scanner: [{ symbol: "MNQ", side: "long", band: "A", q: 0.7, actionable: false }],
  floor: { id: "path_continuation", verdict: "STAND", band: "A", blocks: ["flat"], ticket: null },
  brain: { thesis: "one book", symbol: "MNQ", side: "long", word: "WAIT", missing: "CE" },
};

let failed = 0;
function check(name, ok) {
  if (!ok) {
    failed += 1;
    console.error("FAIL", name);
  } else {
    console.log("ok", name);
  }
}

const init = await handleMcpMessage(
  { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26" } },
  async () => card,
);
check("initialize", init.body?.result?.serverInfo?.name === "ledger-desk");

const note = await handleMcpMessage({ jsonrpc: "2.0", method: "notifications/initialized" }, async () => card);
check("initialized is empty", note.status === 202 && note.body == null);

const list = await handleMcpMessage({ jsonrpc: "2.0", id: 2, method: "tools/list" }, async () => card);
const names = (list.body?.result?.tools ?? []).map((t) => t.name);
check("tools", ["read_desk", "read_scanner", "read_floor", "read_brain", "report_trade"].every((n) => names.includes(n)));

const call = await handleMcpMessage(
  { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "read_floor", arguments: {} } },
  async () => card,
);
const text = call.body?.result?.content?.[0]?.text ?? "";
check("floor call", text.includes('"verdict":"STAND"') && !text.includes("account"));

const bad = await handleMcpMessage(
  { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "place_order" } },
  async () => card,
);
check("no place tool", bad.body?.result?.isError === true);

const sse = encodeMcp(init, true);
check("sse", wantsSse("text/event-stream") && sse.contentType === "text/event-stream" && sse.body.startsWith("event: message"));
check("json preferred", wantsSse("application/json, text/event-stream") === false);
const reported = await handleMcpMessage(
  {
    jsonrpc: "2.0",
    id: 5,
    method: "tools/call",
    params: { name: "report_trade", arguments: { taken: false, status: "stood", journal: "No sweep. Stood down." } },
  },
  async () => card,
  async (args) => ({ ...args, saved: true }),
);
check("report", reported.body?.result?.content?.[0]?.text?.includes('"saved":true'));

const missing = await handleMcpMessage(
  { jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "report_trade", arguments: { taken: true } } },
  async () => card,
  async () => {
    throw new Error("journal paragraph is required");
  },
);
check("report rejects", missing.body?.result?.isError === true);

if (failed) {
  console.error(failed, "failed");
  process.exit(1);
}
console.log("desk mcp ok");
