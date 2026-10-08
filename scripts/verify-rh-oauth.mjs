/**
 * The website's Robinhood sign-in. No network. No order.
 * A stored refresh token is reused. Opening the desk does not start OAuth again.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const {
  pkcePair,
  packPkce,
  unpackPkce,
  codeExchangeForm,
  refreshForm,
  writeOauth,
  readOauth,
  ensureAccess,
  clientIdFor,
} = await import("../src/lib/execution/rh-oauth.ts");
const { quoteFromPayload, positionsFromPayload, instrumentIdFrom, orderIdFrom, reviewFromPayload, mcpTooling } = await import(
  "../src/lib/execution/rh-mcp.ts"
);

let failed = 0;
function check(name, ok, detail = "") {
  if (ok) console.log("ok", name);
  else {
    failed += 1;
    console.error("FAIL", name, detail);
  }
}

{
  const pair = pkcePair();
  const expect = createHash("sha256").update(pair.verifier).digest("base64url");
  check("pkce is S256", pair.challenge === expect && pair.verifier !== pair.challenge);
  const packed = packPkce({ s: "state", v: pair.verifier, u: "user-1" });
  const back = unpackPkce(packed);
  check("the browser cookie is not a token", back?.s === "state" && back?.u === "user-1" && !packed.includes("refresh"));
}

check("a refresh does not send the authorization code", !refreshForm({ clientId: "c", refreshToken: "r" }).includes("authorization_code"));
check("the code exchange is not a refresh", codeExchangeForm({ clientId: "c", redirectUri: "https://desk.example/api/rh/callback", code: "code", verifier: "v" }).includes("authorization_code"));

check(
  "a quote is read from the tool payload",
  quoteFromPayload({ data: { quotes: [{ bid_price: "1.20", ask_price: "1.25" }] } })?.ask === 1.25,
);
check(
  "a position this desk can see has an option id",
  positionsFromPayload({ data: { results: [{ option_id: "opt-1", quantity: "2", type: "call", chain_symbol: "QQQ", average_price: "1.5" }] } })[0]?.optionId === "opt-1",
);
check("the instrument id matches the strike", instrumentIdFrom({ results: [{ id: "abc", strike_price: "605.0000" }] }, 605) === "abc");
check("an order id is read", orderIdFrom({ data: { id: "ord-1" } }) === "ord-1");
check("a rejected review blocks", reviewFromPayload({ alerts: ["Order rejected"] }, false).blocking === true);

{
  const pg = new PGlite();
  const sql = { query: async (text, params) => (await pg.query(text, params)).rows };
  const text = readFileSync(new URL("../migrations/0021_rh_oauth.sql", import.meta.url), "utf8");
  await pg.exec(text);
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), body: init?.body ?? "" });
    if (String(url).includes("/register")) {
      return new Response(JSON.stringify({ client_id: "client-1" }), { status: 201, headers: { "content-type": "application/json" } });
    }
    return new Response("no", { status: 500 });
  };
  const id = await clientIdFor(sql, "https://desk.example/api/rh/callback", fetchImpl);
  const again = await clientIdFor(sql, "https://desk.example/api/rh/callback", fetchImpl);
  check("the site registers once", id === "client-1" && again === "client-1" && calls.length === 1, String(calls.length));

  await writeOauth(
    sql,
    {
      userId: "user-1",
      clientId: "client-1",
      redirectUri: "https://desk.example/api/rh/callback",
      refreshToken: "refresh-1",
      accessToken: "access-1",
      accessExpiresAt: Date.now() + 10 * 60_000,
    },
    Date.now(),
  );
  const stored = await readOauth(sql, "user-1");
  check("reopening reads the same refresh token", stored?.refreshToken === "refresh-1");
  let tokenPosts = 0;
  const access = await ensureAccess(sql, stored, async () => {
    tokenPosts += 1;
    return new Response("no", { status: 500 });
  });
  check("a live access token does not ask Robinhood again", access === "access-1" && tokenPosts === 0);

  const posts = [];
  const mcpFetch = async (url, init) => {
    const body = init?.body ? JSON.parse(init.body) : null;
    posts.push(body);
    const method = body?.method;
    const name = body?.params?.name;
    if (method === "initialize" || method === "notifications/initialized") {
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { protocolVersion: "2025-03-26" } }), {
        status: 200,
        headers: { "content-type": "application/json", "mcp-session-id": "sess" },
      });
    }
    if (name === "review_option_order") {
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { content: [{ type: "text", text: "{\"alerts\":[]}" }] } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (name === "place_option_order") {
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { content: [{ type: "text", text: "{\"id\":\"ord-9\"}" }] } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: {} }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const tools = mcpTooling("access-1", mcpFetch);
  const order = {
    account_number: "995386158",
    legs: [{ option_id: "opt-1", side: "buy", position_effect: "open", ratio_quantity: 1 }],
    type: "limit",
    quantity: "1",
    price: "1.25",
    time_in_force: "gfd",
    market_hours: "regular_hours",
    chain_symbol: "QQQ",
    underlying_type: "equity",
    refKey: "k",
  };
  const reviewed = await tools.review(order);
  const placed = await tools.place(order, "ref-1");
  const names = posts.map((p) => p?.params?.name).filter(Boolean);
  check("review then place on the MCP", reviewed.ok === true && placed.id === "ord-9" && names[0] === "review_option_order" && names[1] === "place_option_order");
  check("the bearer is the access token, not a pasted key", posts.every((p) => p) && !JSON.stringify(posts).includes("RH_ACCESS_TOKEN"));
  await pg.close();
}

{
  const eng = readFileSync(new URL("../src/components/room/room-engine.ts", import.meta.url), "utf8");
  const sched = readFileSync(new URL("../netlify/functions/room-step.mjs", import.meta.url), "utf8");
  check("an open desk does not wait out a 20s gap", !/RH_GAP_MS/.test(eng));
  check("a closed tab steps every minute", /schedule: "\* 13-21 \* \* 1-5"/.test(sched));
}

if (failed) {
  console.error(failed, "failed");
  process.exit(1);
}
console.log("rh oauth ok");
