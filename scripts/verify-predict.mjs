/**
 * The Predict tab's arithmetic and parsing, against hand-built cases.
 *
 * Pinned because each one can cost money or say something false:
 *   1. American odds → probability, and removing the book's margin.
 *   2. Fees: Kalshi's P×(1−P) formula rounded UP per order, plus the broker's
 *      per-contract commission, on BOTH sides of a round trip.
 *   3. The martingale shape: any "sell when it rises" rule on a fairly priced
 *      contract has negative expected value — exactly the fees.
 *   4. Kalshi/ESPN parsing and matching (JAC↔JAX, WAS↔WSH), and the live
 *      reference replacing the book once a game starts.
 *   5. The journal: net after fees, buckets by entry price.
 *
 * Run: npx tsx scripts/verify-predict.mjs
 */

let pass = 0;
let fail = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++;
  else fail++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : ` — got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`);
};
const ok = (name, cond) => check(name, !!cond, true);
const r4 = (n) => Math.round(n * 10_000) / 10_000;

const mem = new Map();
globalThis.window = {
  localStorage: { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) },
  dispatchEvent() {},
  addEventListener() {},
  removeEventListener() {},
};

const M = await import("../src/lib/predict/math.ts");
const B = await import("../src/lib/predict/board.ts");
const J = await import("../src/lib/predict/journal.ts");

console.log("\nodds and the book's margin");
check("+260 → 27.78%", r4(M.americanToProb(260)), 0.2778);
check("-325 → 76.47%", r4(M.americanToProb(-325)), 0.7647);
check("EVEN parses as +100", M.parseAmerican("EVEN"), 100);
check("'+124' parses", M.parseAmerican("+124"), 124);
const nv = M.noVig(M.americanToProb(260), M.americanToProb(-325));
check("no-vig sums to 1", r4(nv.a + nv.b), 1);
check("the margin is the overround", r4(nv.overround), 0.0425);
check("LAC no-vig ≈ 26.6%", Math.round(nv.a * 1000) / 1000, 0.266);

console.log("\nfees — per venue, from the published schedules");
// The worked example the schedules produce: 100 contracts, bought at 25¢, sold at 40¢.
const rt40 = (v) => Math.round((M.sideFee(0.25, 100, M.VENUES[v]) + M.sideFee(0.4, 100, M.VENUES[v])) * 100) / 100;
check("Robinhood → Rothera: $2.86", rt40("rh-rothera"), 2.86);
check("Robinhood → Kalshi: $4.00", rt40("rh-kalshi"), 4);
check("Kalshi direct taker: $3.00", rt40("kalshi"), 3);
check("Polymarket US taker: $2.97", rt40("polymarket-us"), 2.97);
check("Gold halves Robinhood's k: $2.80 via Rothera", rt40("rh-rothera-gold"), 2.8);
check("Robinhood's commission caps at 1¢/contract: 100 @ 50¢ via Kalshi = $1 + $1", M.sideFee(0.5, 100, M.VENUES["rh-kalshi"]), 2);
check("Rothera's exchange fee has a 1¢ floor per order", M.sideFee(0.99, 1, M.VENUES["rh-rothera"]), 0.02);
check("the default venue is Robinhood → Rothera", M.DEFAULT_FEES.id, "rh-rothera");
check("no contracts, no fee", M.sideFee(0.5, 0), 0);
const rt = M.roundTrip(0.25, 0.35, 100);
check("round trip: cost", rt.cost, 25);
check("round trip: proceeds", rt.proceeds, 35);
ok("round trip pays fees on both sides", rt.fees > M.sideFee(0.25, 100));
check("round trip net = proceeds − cost − fees", rt.pnl, Math.round((35 - 25 - rt.fees) * 100) / 100);
ok("break-even exit is above the entry", rt.breakevenExit > 0.25);

console.log("\nthe martingale — an exit rule is not an edge");
const shape = M.exitRuleShape(0.25, 0.4);
check("a fair 25¢ reaches 40¢ at most 62.5% of the time (p/q)", shape.pHit, 0.625);
check("'sell at 40¢, else hold' via Robinhood→Rothera expects −$2.30 — the entry fee plus 62.5% of the exit fee", shape.ev, -2.3);
check("about −9.2% of the stake before the spread", Math.round(shape.evPct * 1000) / 10, -9.2);
check("an exit below the entry is not a rule", M.exitRuleShape(0.4, 0.3), null);
const e = M.entryEdge(0.38, 0.407);
ok("buying 38¢ vs a 40.7% reference: the fee takes over half the gap", e.edge > 0 && e.edge < 0.02);

console.log("\nKalshi + ESPN parsing");
check("date from the event ticker", B.dateFromTicker("KXNFLGAME-26SEP27CARCLE"), "2026-09-27");
const kalshi = {
  events: [
    {
      event_ticker: "KXNFLGAME-26SEP27NEJAC",
      title: "New England vs Jacksonville",
      markets: [
        { ticker: "KXNFLGAME-26SEP27NEJAC-JAC", yes_sub_title: "Jacksonville", yes_bid_dollars: "0.5900", yes_ask_dollars: "0.6000", last_price_dollars: "0.6000", volume_fp: "331857.0", status: "active" },
        { ticker: "KXNFLGAME-26SEP27NEJAC-NE", yes_sub_title: "New England", yes_bid_dollars: "0.4000", yes_ask_dollars: "0.4100", last_price_dollars: "0.4000", volume_fp: "522694.0", status: "active" },
      ],
    },
  ],
};
const ev = B.parseKalshiEvents(kalshi);
check("Kalshi's JAC is ESPN's JAX", ev[0].sides[0].code, "JAX");
check("prices parse from dollar strings", ev[0].sides[0].ask, 0.6);
const espn = {
  events: [
    {
      id: "1",
      date: "2026-09-27T17:00Z",
      status: { type: { state: "pre", shortDetail: "9/27 - 1:00 PM EDT" } },
      competitions: [
        {
          competitors: [
            { homeAway: "home", team: { abbreviation: "JAX", displayName: "Jacksonville Jaguars" }, score: "0" },
            { homeAway: "away", team: { abbreviation: "NE", displayName: "New England Patriots" }, score: "0" },
          ],
          odds: [{ details: "JAX -3", overUnder: 44.5, moneyline: { home: { close: { odds: "-155" } }, away: { close: { odds: "+130" } } } }],
        },
      ],
    },
  ],
};
const games = B.parseEspnScoreboard(espn);
check("the game's ET date", games[0].date, "2026-09-27");
check("moneylines parse", [games[0].away.moneyline, games[0].home.moneyline], [130, -155]);
const board = B.buildBoard("nfl", games, ev);
check("the Kalshi event is matched to the ESPN game", board[0].eventTicker, "KXNFLGAME-26SEP27NEJAC");
check("pregame reference is the book", board[0].home.referenceName, "DraftKings no-vig");
const inGame = B.buildBoard("nfl", [{ ...games[0], state: "in", liveHomeWp: 0.8 }], ev);
check("in-game reference is ESPN live", inGame[0].home.referenceName, "ESPN live");
check("the live away probability is the complement", r4(inGame[0].away.live), 0.2);
ok("a 60¢ ask against an 80% live probability shows a positive gap", inGame[0].home.edge > 0.15);
check("a game with no contract still shows", B.buildBoard("nfl", [{ ...games[0], home: { ...games[0].home, code: "ZZZ" } }], ev)[0].eventTicker, null);

console.log("\nESPN extras — model and injuries");
const extras = B.parseSummaryExtras({
  predictor: { homeTeam: { gameProjection: "78.1" }, awayTeam: { gameProjection: "21.7" } },
  injuries: [
    {
      team: { abbreviation: "WAS" },
      injuries: [
        { status: "Injured Reserve", athlete: { displayName: "Long Term", position: { abbreviation: "CB" } } },
        { status: "Questionable", athlete: { displayName: "Wide Out", position: { abbreviation: "WR" } } },
        { status: "Out", athlete: { displayName: "Signal Caller", position: { abbreviation: "QB" } } },
      ],
    },
  ],
});
check("ESPN's model projection parses as a probability", [extras.modelHome, extras.modelAway], [0.781, 0.217]);
check("injured reserve is left out; the QB sorts first; Kalshi codes are normalised", extras.injuries.WSH, ["QB Signal Caller (Out)", "WR Wide Out (Questionable)"]);
check("no predictor, no number", B.parseSummaryExtras({}).modelHome, null);
const withModel = B.buildBoard("nfl", games, ev, {}, undefined, { "1": { modelHome: 0.6, modelAway: 0.39, injuries: {} } });
check("the model rides on each side", withModel[0].home.model, 0.6);
check("the market is Kalshi's midpoint", withModel[0].home.market, 0.595);
ok("the three-way line names all three", /market 59\.5% · book .* · ESPN model 60\.0%/.test(B.threeWay(withModel[0].home)));

console.log("\nthe journal");
check("a fill logs", J.logEntry({ league: "nfl", game: "NE @ JAX", ticker: "X-NE", team: "NE", contracts: 10, entry: 0.41, referenceAtEntry: 0.417, referenceName: "DraftKings no-vig" }).ok, true);
const t = J.loadTrades()[0];
check("sold at 55¢: net after both fees", J.closeTrade(t.id, { exit: 0.55 }).ok, true);
const closed = J.loadTrades()[0];
check("P/L = 5.50 − fee(55¢) − 4.10 − fee(41¢)", J.tradePnl(closed), Math.round((5.5 - M.sideFee(0.55, 10) - 4.1 - M.sideFee(0.41, 10)) * 100) / 100);
check("a closed trade is not edited", J.closeTrade(t.id, { settled: 1 }).ok, false);
J.logEntry({ league: "nfl", game: "KC @ MIA", ticker: "X-MIA", team: "MIA", contracts: 10, entry: 0.16, referenceAtEntry: null, referenceName: null });
J.closeTrade(J.loadTrades()[0].id, { settled: 0 });
const jr = J.readJournal();
check("two closed trades", jr.closed, 2);
check("the longshot lands in its bucket", jr.buckets[0].n, 1);
check("and it lost the stake plus the entry fee", jr.buckets[0].net, Math.round((-1.6 - M.sideFee(0.16, 10)) * 100) / 100);
ok("under 30 trades the record says it is noise", /noise/.test(jr.line));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
