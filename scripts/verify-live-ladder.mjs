/**
 * Live quote rank, and the futures-paper band ratchet.
 *   npx tsx scripts/verify-live-ladder.mjs
 */
const F = await import("../src/lib/market/freshest.ts");
const P = await import("../src/lib/trading/auto-paper.ts");

let fail = 0;
const check = (name, ok, detail = "") => {
  if (!ok) fail++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : ` — ${detail}`}`);
};

const q = (source, lagSec, price = 100) => ({
  symbol: "MNQ",
  yahoo: "NQ=F",
  price,
  marketTimeMs: Date.now() - lagSec * 1000,
  marketTimeIso: "",
  previousClose: 99,
  change: 1,
  changePct: 1,
  dayHigh: null,
  dayLow: null,
  volume: null,
  fetchedAtMs: Date.now(),
  fetchedAtIso: "",
  lagSec,
  timezone: "America/New_York",
  source,
});

check("a 2s gateway tick beats a 1s yahoo print", F.pickFreshestQuote(q("yahoo", 1), q("live_gateway", 2))?.source === "live_gateway");
check("a 40s gateway bar beats yahoo", F.pickFreshestQuote(q("yahoo", 8), q("live_gateway", 40))?.source === "live_gateway");
check("a 10m databento bar beats a delayed yahoo print", F.pickFreshestQuote(q("yahoo", 8 * 60), q("databento", 10 * 60))?.source === "databento");
check("a 10h databento bar loses to yahoo", F.pickFreshestQuote(q("yahoo", 15 * 60), q("databento", 10 * 3600))?.source === "yahoo");
check("a gateway tick older than 90s is not live", F.liveQuoteRank(q("live_gateway", 120)) == null);
check("yahoo is the last real rank", F.liveQuoteRank(q("yahoo", 900)) === 3);
check("synthetic is never ranked", F.liveQuoteRank(q("synthetic", 0)) == null);

check("A- is below A", P.bandRank("A-") < P.bandRank("A") && P.bandRank("A") < P.bandRank("A+"));
check("a win does not raise the bar", P.nextBandAfter("A-", false).min === 1);
check("an A- loss wants an A", P.nextBandAfter("A-", true).min === 2);
check("an A loss wants an A+", P.nextBandAfter("A", true).min === 3);
check("an A+ loss stands down", "skip" in P.nextBandAfter("A+", true));
check("three losers in five is cold", P.strategyCold(5, 2) === true);
check("a 2-trade sample is not cold", P.strategyCold(2, 0) === false);
check("a win that beat the last R keeps the floor", P.sessionAim({ band: "A-", r: 1.2, won: true }, 0.4).min === 1);
check("a win that did not beat the last R wants the next band", P.sessionAim({ band: "A-", r: 0.3, won: true }, 1.1).min === 2);
check("an A win that did not beat wants A+", P.sessionAim({ band: "A", r: 0.4, won: true }, 1.2).min === 3);
check("an A+ win that did not beat stays A+", P.sessionAim({ band: "A+", r: 0.4, won: true }, 1.2).min === 3);
check("no prior fill keeps the floor", P.sessionAim({ band: "A", r: 0.5, won: true }, null).min === 1);
check("an A loss still wants A+", P.sessionAim({ band: "A", r: -1, won: false }, 0.5).min === 3);
check("an A+ loss still stands the session down", "skip" in P.sessionAim({ band: "A+", r: -1, won: false }, 0.2));

console.log(fail ? `\n${fail} failed` : "\nall passed");
process.exit(fail ? 1 : 0);
