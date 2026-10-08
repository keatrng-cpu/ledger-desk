/**
 * ITEM 17 — the brain must remember the last sequence.
 *
 * `now:wire` is a pinned atlas node that SAYS the wire exists. Nothing wrote the
 * other end: a trade closed, the book and the rates moved, and the raid that
 * armed it, the array the displacement left, the fill, the partial and the exit
 * went nowhere the NEXT session reads. So the next open could not see that the
 * draw it was about to target had already been taken — which is the desk's own
 * rule (`smc:draw`: "A pool or a gap that already traded is spent").
 *
 * The properties under test:
 *   1. a closed trade becomes an atlas node carrying the whole sequence,
 *   2. it is LINKED to the draw it targeted, and the draw to the desk's rule,
 *   3. the next session can read "that pool was taken" (atlas, then the ledger
 *      when the atlas has evicted the node),
 *   4. a pool stays taken: a later session that missed it does not un-spend it,
 *   5. writing the same story twice moves NO node's `at` — after the mergeAtlas
 *      fix a node's time means when it last CHANGED (verify-brain-nerve.mjs).
 *
 * Runs the real modules with a localStorage shim only.
 *
 * Run: npx tsx scripts/verify-desk-session.mjs
 */

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
};
globalThis.window = globalThis;
globalThis.dispatchEvent = () => true;
globalThis.addEventListener = () => {};

const M = await import("../src/lib/trading/desk-memory.ts");
const A = await import("../src/lib/room/desk-atlas.ts");

let pass = 0;
let fail = 0;
function check(name, ok, detail = "") {
  if (ok) {
    pass++;
    console.log(`  ok   ${name}`);
  } else {
    fail++;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

/** A short off the buyside raid of PDH, drawing on the sellside pool below. */
const shortStory = {
  date: "2026-10-05",
  symbol: "MNQ",
  side: "short",
  strategy: "mechanical",
  band: "A",
  raid: { pool: "PDH", price: 24_310.25 },
  array: { kind: "FVG", price: 24_288 },
  fill: { price: 24_288 },
  partial: { price: 24_240, r: 1.1 },
  exit: { price: 24_205, reason: "T2", r: 2.3, usd: 920 },
  draw: { pool: "PDL", price: 24_200 },
  drawTaken: true,
};

console.log("the whole sequence is in the line, and every number is the story's");
{
  const line = M.sessionTradeLine(shortStory);
  check("the raid and its pool", /buyside raid took PDH at 24310.25/.test(line), line);
  check("the array the displacement left", /displacement left the FVG at 24288/.test(line), line);
  check("the fill", /filled 24288/.test(line), line);
  check("the partial", /half off at 24240 for \+1\.10R/.test(line), line);
  check("the exit", /out 24205 on T2 for \+2\.30R/.test(line), line);
  check("and whether the draw traded", /draw PDL 24200 TRADED/.test(line), line);

  const sellside = M.sessionTradeLine({ ...shortStory, side: "long", raid: { pool: "PDL", price: 1 } });
  check("a long is armed by the SELLSIDE raid", /sellside raid took PDL/.test(sellside), sellside);

  const unfilled = M.sessionTradeLine({ ...shortStory, fill: null, partial: null, exit: null, drawTaken: false });
  check("a plan that never filled says so", /never filled/.test(unfilled) && !/filled 24288/.test(unfilled), unfilled);
  check("and leaves the draw open", /draw PDL 24200 is still open/.test(unfilled), unfilled);
  check("no partial is not a silent zero", /no partial/.test(M.sessionTradeLine({ ...shortStory, partial: null })));
}

console.log("\nthe closed trade is a node, linked to the draw, and the draw to the rule");
{
  const base = A.mergeAtlas(null, null, 1_000);
  const after = M.applySessionTrade(base, shortStory, 5_000);
  const tradeId = M.sessionTradeNodeId(shortStory);
  const drawId = M.poolId("MNQ", "PDL");
  check("the node id names the date, the book, the side and the draw", tradeId === "backtest:trade:2026-10-05:mnq:short:pdl", tradeId);
  const trade = A.nodeById(after, tradeId);
  check("the trade is on the backtest shelf", trade && trade.shelf === "backtest", JSON.stringify(trade && trade.shelf));
  check("it carries the sequence", trade && trade.text === M.sessionTradeLine(shortStory));
  check("it is tagged with both pools", trade && trade.tags.includes("pdh") && trade.tags.includes("pdl"), JSON.stringify(trade && trade.tags));
  check("a session is not pinned teaching", trade && trade.pinned === false);
  const draw = A.nodeById(after, drawId);
  check("the draw is its own node", draw && draw.title === "MNQ PDL", JSON.stringify(draw && draw.title));
  check("and says the pool is spent", draw && /was TAKEN on 2026-10-05/.test(draw.text), draw && draw.text);
  check("the trade is linked to the draw it targeted", after.edges.some((e) => e.from === tradeId && e.to === drawId));
  check("and the draw to the desk's own spent-pool rule", after.edges.some((e) => e.from === drawId && e.to === "smc:draw"));
  check("so the rule walks to the pool", A.neighborsOf(after, "smc:draw").some((n) => n.id === drawId));
  check("and the pool walks to the trade", A.neighborsOf(after, drawId).some((n) => n.id === tradeId));
  check("nothing else was added", after.nodes.length === base.nodes.length + 2, `${base.nodes.length} -> ${after.nodes.length}`);
}

console.log("\nthe node's time still means when it last changed");
{
  const base = A.mergeAtlas(null, null, 1_000);
  const once = M.applySessionTrade(base, shortStory, 5_000);
  const twice = M.applySessionTrade(once, shortStory, 9_000);
  check("the same story twice is the same atlas", twice === once);
  const moved = twice.nodes.filter((n) => n.at > 5_000);
  check("so no line's time moved", moved.length === 0, JSON.stringify(moved.map((n) => [n.id, n.at])));

  // Re-reading the pool after it traded IS a change, and is dated.
  const later = M.applySessionTrade(once, { ...shortStory, exit: { price: 24_300, reason: "stop", r: -1, usd: -400 } }, 9_000);
  const trade = A.nodeById(later, M.sessionTradeNodeId(shortStory));
  check("a corrected story is dated and counted", trade.at === 9_000 && trade.n === 2, JSON.stringify([trade.at, trade.n]));
  check("and keeps what it used to say", trade.prior.length === 1 && /out 24205 on T2/.test(trade.prior[0].text));

  // The mergeAtlas invariant this item was told to keep true.
  const merged = A.mergeAtlas(once, null, 20_000);
  const seedsMoved = A.nowLines(merged).filter((n) => n.at > 1_000);
  check("a later merge still moves no unchanged seed", seedsMoved.length === 0, JSON.stringify(seedsMoved.map((n) => n.id)));
  check("and the session node survives the merge", A.nodeById(merged, M.sessionTradeNodeId(shortStory)) != null);
}

console.log("\nthe next session can read that the pool was taken");
{
  store.clear();
  const { atlas } = M.rememberSessionTrade(shortStory, 5_000);
  const read = M.poolTaken("MNQ", "PDL", { atlas });
  check("from the atlas", read.taken === true && read.from === "atlas", JSON.stringify(read));
  check("with the sentence to say", /PDL at 24200 was TAKEN/.test(read.text ?? ""), String(read.text));

  // The atlas keeps 40 unpinned nodes; the ledger is the durable copy.
  const evicted = { ...atlas, nodes: atlas.nodes.filter((n) => n.id !== M.poolId("MNQ", "PDL")) };
  const fromLedger = M.poolTaken("MNQ", "PDL", { atlas: evicted });
  check("and from the ledger when the atlas has evicted the node", fromLedger.taken === true && fromLedger.from === "ledger", JSON.stringify(fromLedger));

  const never = M.poolTaken("ES", "PWH", { atlas });
  check("a pool this desk never looked at is unknown, not taken", never.taken === false && never.from === "unknown" && never.text === null, JSON.stringify(never));

  const ledger = M.poolLedger();
  check("the ledger has the one row", ledger.length === 1 && ledger[0].pool === "PDL" && ledger[0].taken === true, JSON.stringify(ledger));
  check("the session is on the memory tape", M.recentByKind("session").length === 1);
  check("the tape row links back to the node", M.recentByKind("session")[0].payload.nodeId === M.sessionTradeNodeId(shortStory));
  M.rememberSessionTrade(shortStory, 9_000);
  check("the same close is not taped twice", M.recentByKind("session").length === 1);
}

console.log("\na pool stays spent");
{
  store.clear();
  M.rememberSessionTrade(shortStory, 5_000);
  // A later session aims at the same pool and does not reach it.
  M.rememberSessionTrade(
    { ...shortStory, date: "2026-10-06", drawTaken: false, exit: { price: 24_300, reason: "stop", r: -1 } },
    9_000,
  );
  const row = M.poolLedger()[0];
  check("the ledger still says taken", row.taken === true, JSON.stringify(row));
  check("and keeps the session that took it", row.date === "2026-10-05", row.date);
  check("while the clock moved", row.updatedAt === 9_000, String(row.updatedAt));
  check("two sessions, two trade nodes", M.recentByKind("session").length === 2);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
