/**
 * Closed-hours study. The room may discuss the long board and the prediction
 * book. It may not invent a company, a price, or a side, and it may not send.
 *
 * Run: npx tsx scripts/verify-off-hours-study.mjs
 */
import { readFileSync } from "node:fs";
import { studyPack, toPredictLite, yesCentsOf } from "../src/lib/room/off-hours-study.ts";

const voice = readFileSync("src/lib/room/live-voices-invest.ts", "utf8");
const talk = readFileSync("src/lib/room/live-talk.ts", "utf8");
for (const name of ["exStudyInvest", "exStudyWatchNews", "exStudyOutsider", "exStudyPredict"]) {
  if (!voice.includes(`export function ${name}`)) {
    console.error("missing", name);
    process.exit(1);
  }
}
if (voice.includes("exOffHoursStudy")) {
  console.error("old single study exchange is still exported");
  process.exit(1);
}
if (!talk.includes("study:invest") || !talk.includes("study:predict") || !talk.includes("study:watch") || !talk.includes("study:outsider")) {
  console.error("talk is not scheduling the four study passes");
  process.exit(1);
}
if (voice.includes("placeOrder") || voice.includes("review_option_order")) {
  console.error("study voice must not send");
  process.exit(1);
}

if (yesCentsOf(0.64) !== 64) process.exit(1);
if (yesCentsOf(64) !== 64) process.exit(1);
if (yesCentsOf(140) !== null) process.exit(1);
if (yesCentsOf(null) !== null) process.exit(1);

const news = [
  { id: "1", title: "Constellation signs another nuclear year for a data center", source: "Wire", publishedMs: 3, tier: 2, why: "", impact: "Power names.", tickers: ["CEG", "SMCI"], topics: ["ai-capex"], primary: false },
  { id: "2", title: "Chiefs listed as a home favorite this week", source: "Book", publishedMs: 2, tier: 2, why: "", impact: null, tickers: [], topics: ["nfl"], primary: false },
  { id: "3", title: "The market was higher today", source: "Wire", publishedMs: 1, tier: 3, why: "", impact: null, tickers: ["QQQ"], topics: [], primary: false },
];

const pack = studyPack({
  weekend: true,
  etDate: "2026-10-10",
  etMin: 14 * 60,
  news,
  invest: null,
  predict: toPredictLite({
    asOf: "2026-10-10T18:00:00Z",
    label: "Kalshi",
    markets: [
      { event: "Kansas City Chiefs win", outcome: "Yes", yesPrice: 0.61, setupGrade: "B" },
      { event: "Will the market close higher", outcome: "Yes", yesPrice: 0.5, setupGrade: null },
    ],
  }),
});

const ceg = pack.hits.find((h) => h.ticker === "CEG");
if (!ceg) {
  console.error("CEG headline was not read as a watchlist name", pack.hits);
  process.exit(1);
}
const smci = pack.outsiders.find((o) => o.ticker === "SMCI");
if (!smci || smci.beside?.ticker !== "CEG") {
  console.error("SMCI should be studied beside CEG, not added", pack.outsiders);
  process.exit(1);
}
if (pack.outsiders.some((o) => o.ticker === "QQQ" || o.ticker === "CEG")) {
  console.error("an index or a watchlist name was treated as a new company");
  process.exit(1);
}
const chiefs = pack.predicts[0];
if (!chiefs || chiefs.yesCents !== 61 || chiefs.newsTitle !== news[1].title) {
  console.error("chiefs market did not take the chiefs headline", chiefs);
  process.exit(1);
}
const generic = pack.predicts[1];
if (generic?.newsTitle) {
  console.error("a generic market word matched a headline", generic);
  process.exit(1);
}
if (!pack.watch.some((w) => w.ticker === "CEG") && pack.watch.length !== 4) {
  console.error("watch slice", pack.watch);
  process.exit(1);
}
if (pack.watch.length !== 4) {
  console.error("expected four long-board names", pack.watch);
  process.exit(1);
}

console.log(`off-hours study ok · watch ${pack.watch.map((w) => w.ticker).join(",")} · hit ${ceg.ticker} · outsider ${smci.ticker} beside ${smci.beside.ticker} · chiefs ${chiefs.yesCents}c`);
