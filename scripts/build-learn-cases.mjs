/**
 * Build the Learn tab's real-tape cases from the captured history.
 *
 * Runs src/lib/learn/cases.ts — the live desk's assembly, causally — over
 * src/data/learn-history.json and writes src/data/learn-cases.json. Done at
 * build time rather than in the browser because a month of 15m bars is
 * ~1,900 full engine runs per symbol, and the result must be identical for
 * everyone who opens the tab.
 *
 * Prints the honest tally of the WHOLE pool before selection, so the win/loss
 * mix is on the record every time this runs.
 *
 * Run: npx tsx scripts/build-learn-cases.mjs
 */

import { readFileSync, writeFileSync } from "node:fs";

const { buildCases, selectForTeaching, tally } = await import("../src/lib/learn/cases.ts");

const history = JSON.parse(readFileSync("src/data/learn-history.json", "utf8"));
const mnq = history.bars.MNQ;
const es = history.bars.ES;

console.log(`history: ${history.capturedAt} · MNQ ${mnq.length} bars · ES ${es.length} bars`);

const t0 = Date.now();
const all = [
  ...buildCases("MNQ", mnq, "ES", es),
  ...buildCases("ES", es, "MNQ", mnq),
];
console.log(`engine: ${all.length} cases in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

/* Causality re-check: every bar the trade was scored on must be strictly
   after the decision bar. If this ever fails, the case is a lie. */
for (const c of all) {
  const decision = c.bars[c.decisionIndex];
  if (!decision || decision.t !== c.decisionT) {
    console.error(`CAUSALITY: ${c.id} decisionIndex does not point at the decision bar`);
    process.exit(1);
  }
  for (let i = c.decisionIndex + 1; i < c.bars.length; i++) {
    if (c.bars[i].t <= c.decisionT) {
      console.error(`CAUSALITY: ${c.id} has a future bar not after the decision`);
      process.exit(1);
    }
  }
}

const t = tally(all);
console.log(
  `pool: ${t.takes} TAKEs → ${t.wins} wins · ${t.losses} losses · ${t.scratch} scratch · ${t.unfilled} unfilled · ΣR ${t.sumR >= 0 ? "+" : ""}${t.sumR} · ${t.stands} near-misses`,
);
for (const sym of ["MNQ", "ES"]) {
  const s = tally(all.filter((c) => c.symbol === sym));
  console.log(`  ${sym}: ${s.takes} takes, ${s.wins}W/${s.losses}L/${s.scratch}S/${s.unfilled}U, ΣR ${s.sumR >= 0 ? "+" : ""}${s.sumR}, ${s.stands} stands`);
}

const selected = selectForTeaching(all);
console.log(`selected ${selected.length} for the tab:`);
for (const c of selected) {
  const tag = c.outcome === "stand" ? `${c.word} (${c.missing})` : `${c.outcome.toUpperCase()}${c.r != null ? ` ${c.r >= 0 ? "+" : ""}${c.r}R` : ""}${c.lossKind ? ` [${c.lossKind}]` : ""}`;
  console.log(`  ${c.decisionEt}  ${c.symbol} ${c.side ?? "—"}  Q${c.confluence}  ${tag}`);
}

const out = {
  builtAt: new Date().toISOString(),
  historyCapturedAt: history.capturedAt,
  interval: history.interval,
  pool: t,
  cases: selected,
};
writeFileSync("src/data/learn-cases.json", JSON.stringify(out), "utf8");
console.log(`wrote src/data/learn-cases.json (${(JSON.stringify(out).length / 1024).toFixed(0)} KB)`);
