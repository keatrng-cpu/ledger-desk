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
const D = await import("../src/lib/predict/devig.ts");
const S = await import("../src/lib/predict/sizing.ts");

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

console.log("\nde-vig methods");
const dv = D.devig(M.americanToProb(260), M.americanToProb(-325));
for (const m of ["proportional", "power", "shin"]) check(`${m} sums to 1`, r4(dv[m][0] + dv[m][1]), 1);
check("proportional matches noVig", r4(dv.proportional[0]), r4(nv.a));
ok("power and Shin put more of the margin on the longshot", dv.power[0] < dv.proportional[0] && dv.shin[0] < dv.proportional[0]);
check("the conservative (low) longshot value is the lowest method", r4(dv.lo[0]), r4(Math.min(dv.proportional[0], dv.power[0], dv.shin[0])));
ok("the favorite's range runs the other way", dv.hi[1] > dv.proportional[1]);
check("bad input → null", D.devig(0, 0.5), null);
const pregame = B.buildBoard("nfl", games, ev);
ok("pregame reference is the lowest de-vig value, not the proportional one", pregame[0].away.reference <= pregame[0].away.book);

console.log("\nsizing, limits, exits, parlays");
const lim = S.limitPriceFor(0.45, 100, 1);
ok("the limit price clears fees + 1¢ against the reference", lim != null && 0.45 - lim - M.feePerContract(lim) >= 0.01 - 1e-9);
ok("one cent higher does not", 0.45 - (lim + 0.01) - M.feePerContract(lim + 0.01) < 0.01);
check("no edge → Kelly says zero", S.kellySize(0.4, 0.41, 1000).contracts, 0);
const kel = S.kellySize(0.5, 0.4, 1000);
ok("a 50% contract at 40¢: full Kelly ≈ (0.5 − cost)/(1 − cost)", Math.abs(kel.full - (0.5 - (0.4 + M.feePerContract(0.4))) / (1 - (0.4 + M.feePerContract(0.4)))) < 1e-9);
ok("quarter Kelly stakes about a quarter of that", Math.abs(kel.used - kel.full / 4) < 0.01);
check("the per-game cap binds", S.kellySize(0.5, 0.4, 1000, { maxStake: 20 }).stake <= 20, true);
const eg = S.exitGuide(0.7, 0.6, 10, "ESPN live");
ok("a bid above fair after fees says sell", eg.diff < 0 && /Selling captures/.test(eg.line));
ok("a bid below fair says hold", S.exitGuide(0.5, 0.6, 10, "ESPN live").diff > 0);
const pl = S.parlayCheck([0.6, 0.5], 0.33);
check("a parlay's fair price is the product of its legs", r4(pl.fair), 0.3);
check("offered 33¢ on a 30¢ parlay is 10% over", Math.round(pl.overpricing * 1000) / 1000, 0.1);
check("Kalshi maker fee is a quarter of taker for NFL", M.makerFee(0.5, 100, M.VENUES.kalshi), 0.44);
ok("Polymarket US pays makers", M.makerFee(0.5, 100, M.VENUES["polymarket-us"]) < 0);
check("Robinhood venues charge a resting order the same", M.makerFee(0.4, 100), M.sideFee(0.4, 100));

console.log("\nPolymarket US, depth, line movement, flags");
const pm = B.parsePolyMarket({ markets: [{ bestBidQuote: { value: "0.8350" }, bestAskQuote: { value: "0.8400" }, marketSides: [{ long: true, team: { abbreviation: "kc" } }, { long: false, team: { abbreviation: "mia" } }] }] });
check("the listed side is the long team", pm.longCode, "KC");
check("the other team is the complement", B.polyQuoteFor(pm, "MIA"), { bid: 0.16, ask: 0.165 });
check("Polymarket's 'was' is ESPN's WSH", B.parsePolyMarket({ markets: [{ marketSides: [{ long: true, team: { abbreviation: "was" } }] }] }).longCode, "WSH");
check("slug is away-home-ET date", B.polySlug("nfl", { ...games[0], away: { ...games[0].away, code: "SEA" }, home: { ...games[0].home, code: "WSH" } }), "aec-nfl-sea-was-2026-09-27");
check("no slug outside the NFL", B.polySlug("nba", games[0]), null);
const kd = B.parseKalshiEvents({ events: [{ event_ticker: "E", markets: [{ ticker: "E-A", yes_bid_size_fp: "42574.82", yes_ask_size_fp: "47815.24" }] }] });
check("depth at the bid and ask parses", [kd[0].sides[0].bidSize, kd[0].sides[0].askSize], [42574.82, 47815.24]);
const moved = JSON.parse(JSON.stringify(espn));
moved.events[0].competitions[0].odds[0].moneyline.home.open = { odds: "-120" };
moved.events[0].competitions[0].odds[0].moneyline.away.open = { odds: "+100" };
const mb = B.buildBoard("nfl", B.parseEspnScoreboard(moved), ev);
ok("the book moved toward JAX since the open", mb[0].home.book - mb[0].home.bookOpen > 0.05);
const wx = B.parseSummaryExtras({ gameInfo: { weather: { gust: 25, precipitation: 70 }, venue: { indoor: false } } });
const wb = B.buildBoard("nfl", games, ev, {}, undefined, { "1": wx });
ok("wind and rain are flagged outdoors", /gusts 25 mph, precipitation 70%/.test(B.weatherFlag(wb[0])));
check("a roof silences it", B.weatherFlag(B.buildBoard("nfl", games, ev, {}, undefined, { "1": { ...wx, indoor: true } })[0]), null);
const qb = B.buildBoard("nfl", games, ev, {}, undefined, { "1": { modelHome: 0.7, modelAway: 0.3, injuries: { JAX: ["QB Starter (Questionable)"] } } });
check("the QB on the report is flagged", B.qbFlag(qb[0], "JAX"), "QB Starter (Questionable)");
ok("model 70% vs book ~59% is a disagreement", /ESPN model 70\.0% vs book/.test(B.disagreement(qb[0], qb[0].home)));
ok("inactives are due 90 minutes before kickoff", /11:30/.test(B.inactivesLine(qb[0], Date.parse("2026-09-27T12:00Z"))));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
