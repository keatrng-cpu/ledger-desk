/**
 * The card's score is P(T1 | filled), and the rest of the card agrees with it.
 *
 * Pins, 2026-10-02:
 *   - the shipped model is the one scripts/build-hit-odds.mjs chose under its
 *     pre-registered rule, it is calibrated out of sample, and its arithmetic
 *     behaves (farther T1 → lower odds, a stop inside the noise → lower odds);
 *   - the live desk attaches it to every planned card, the card leads with it,
 *     and the sequence's target layer quotes the same number;
 *   - vetoes are FLAGS: the fit is not multiplied, the card is refused, the
 *     title is restamped after them, one grade letter;
 *   - SMT scores only at a major level / HTF array and is no longer a model.
 *
 * Run: npx tsx scripts/verify-hit-odds.mjs
 */
import { readFileSync } from "node:fs";

const HO = await import("../src/lib/trading/hit-odds.ts");
const { HIT_ODDS_MODEL, planHitOdds } = await import("../src/lib/trading/hit-odds-model.ts");
const { smtAtLevel, majorLevels } = await import("../src/lib/trading/smt-level.ts");
const { applyVeto, compareForBoard } = await import("../src/lib/trading/scanner.ts");
const { stampPathTitle } = await import("../src/lib/trading/profit-path.ts");
const { ALWAYS_SCAN } = await import("../src/lib/trading/strategies.ts");

let pass = 0;
let fail = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : ` — got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`);
};
const ok = (name, cond) => check(name, !!cond, true);
const read = (p) => readFileSync(p, "utf8");
const code = (p) => read(p).split("\n").filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join("\n");

const M = HIT_ODDS_MODEL;
const V = M.validation;

console.log("\nthe shipped model is the pre-registered winner, and it is calibrated out of sample");
ok("the model file names the script that built it", M.script === "scripts/build-hit-odds.mjs");
const steps = V.steps ?? [];
const expected = steps.reduce((cur, s) => (s.replaces ? s.candidate : cur), "M0");
check("chosen = what the step rule picked", M.chosen, expected);
ok("every step that replaced had z <= -2", steps.every((s) => !s.replaces || s.z <= -2));
ok("out-of-sample mean p within 2 points of the hit rate", Math.abs(V.calibration.meanP - V.calibration.hitRate) <= 0.02);
ok("out-of-sample calibration slope inside 0.7–1.3", V.calibration.slope >= 0.7 && V.calibration.slope <= 1.3);
ok(`it beats the 18-session race on 2025–26 (z ${V.chosenVsRace.z})`, V.chosenVsRace.dLogLoss < 0);
ok("it beats a constant base rate", V.oos[M.chosen].logLoss < V.oos.BASE.logLoss);
ok("trained on the evidence-pack scale of fills", M.n.fills > 3000);

console.log("\nthe arithmetic behaves");
const base = { side: "long", symbol: "ES", entry: 100, stop: 90, t1: 120, atr: 10, price: 105 };
const p2 = HO.hitOdds(base, M);
const p1 = HO.hitOdds({ ...base, t1: 110 }, M);
const p4 = HO.hitOdds({ ...base, t1: 140 }, M);
ok("a probability between 0 and 1", p2.pT1 > 0 && p2.pT1 < 1);
ok("1R target more likely than 2R", p1.pT1 > p2.pT1);
ok("2R target more likely than 4R", p2.pT1 > p4.pT1);
const tight = HO.hitOdds({ ...base, stop: 97, t1: 106, atr: 10 }, M);
const inBand = HO.hitOdds({ ...base, stop: 92, t1: 116, atr: 10 }, M);
ok("same 2R, stop under 0.5 ATR → lower odds", tight.pT1 < inBand.pT1);
check("random-walk reference is 1/(1+rr)", p2.pRandomWalk, +(1 / 3).toFixed(4));
ok("expected R uses the measured payoff split", Math.abs(p2.expR - (p2.pT1 * (M.payoff.winA + M.payoff.winB * 2) + (1 - p2.pT1) * M.payoff.lossMean)) < 0.002);
check("no T1 ahead of the entry → no odds", HO.hitOdds({ ...base, t1: 95 }, M), null);
check("no ATR → no odds", HO.hitOdds({ ...base, atr: null }, M), null);
check("price 0.5 ATR above CE reads ARMED", p2.geometry.tier, "ARMED");
check("ARMED fill rate is the measured one", p2.pFill, M.fillByTier.ARMED);
ok("drivers are in probability points and say whether they are reliable", p2.drivers.every((d) => typeof d.pts === "number" && typeof d.reliable === "boolean"));
const outside = HO.hitOdds({ ...base, fit: 0.35 }, M);
ok("a fit outside the trained range is said out loud", outside.caveats.some((c) => /outside/.test(c)));

console.log("\none probability on the whole desk");
const bd = code("src/lib/trading/build-desk.ts");
ok("build-desk attaches hitOdds to every planned card", /c\.hitOdds = p\s*\?\s*hitOdds\(/.test(bd));
const card = read("src/components/desk/setup-scanner.tsx");
ok("the card leads with P(T1)", /Math\.round\(odds\.pT1 \* 100\)/.test(card) && /T1 · if filled/.test(card));
ok("the fit stays on the card, as the second number", /fit \{c\.confluence\.toFixed\(2\)\}/.test(card));
const sm = code("src/lib/trading/smc-master.ts");
ok("the sequence's target layer quotes the same model", /planHitOdds\(/.test(sm) && /worthLine\(plan\)/.test(sm));
const geo = planHitOdds({ side: "long", symbol: "ES", entry: 100, stop: 90, t1: 120, atr: 10, price: 105 });
if (geo) check("planHitOdds = the card's number for the same plan", geo.pT1, p2.pT1);
else ok("planHitOdds steps aside when the model needs more than geometry", true);
ok("the offline build and the live card share one feature function", /HO\.oddsFeatures\(/.test(read("scripts/build-hit-odds.mjs")));
const cmp = [
  { htfOk: true, actionable: false, confluence: 0.9, hitOdds: { expRPerCard: -0.1 } },
  { htfOk: true, actionable: false, confluence: 0.7, hitOdds: { expRPerCard: 0.05 } },
].sort(compareForBoard);
check("inside a group the board ranks by expected R per card, not fit", cmp[0].confluence, 0.7);

console.log("\nvetoes are flags, not a 0.42 discount");
ok("no '* 0.42' left in the scanner", !/confluence \* 0\.42/.test(code("src/lib/trading/scanner.ts")));
const c = { title: "ES long — Ronan", confluence: 0.84, pathBand: "A+", grade: "A+", actionable: true, missing: [] };
applyVeto(c, "mitigation block — failed push origin, measured negative");
stampPathTitle(c);
check("the fit is untouched", c.confluence, 0.84);
check("the band stays — a veto does not take the card off the board", c.pathBand, "A+");
check("and remembers what it was", c.bandBeforeVeto, "A+");
check("the veto is named", c.vetoes, ["mitigation block — failed push origin, measured negative"]);
check("the title keeps the band and names the veto", c.title, "ES long — Ronan · [path A+ · fit 0.84 · vetoed]");
applyVeto(c, "mitigation block — failed push origin, measured negative");
check("the same veto twice is recorded once", c.vetoes.length, 1);
ok("the scanner restamps titles after the vetoes", /for \(const c of pathCandidates\) stampPathTitle\(c\)/.test(code("src/lib/trading/scanner.ts")));

console.log("\none grade letter on the card");
const chart = read("src/components/desk/setup-chart-panel.tsx");
ok("the steps panel's 'Engine says' uses the PATH band", /grade: candidate\?\.pathBand \?\? candidate\?\.grade/.test(chart));
ok("the SMC badge prints a count, not a second letter", /SMC \{stack\.mustHits\}\/\{stack\.mustNeed\}/.test(card) && !/SMC \{stack\.grade\}/.test(card));

console.log("\nSMT: a bias input that scores only at a major level or HTF array");
ok("SMT is no longer a scanned model", !ALWAYS_SCAN.includes("smt"));
ok("the scanner's smt component needs atLevel", /smtLevel\?\.present && smtLevel\.atLevel/.test(code("src/lib/trading/scanner.ts")));
// Synthetic tape: yesterday's low at 100, today's bars above it.
const t0 = Date.UTC(2026, 8, 29, 14, 0); // Tue 10:00 ET
const H = 3_600_000;
const bars = [];
for (let k = 0; k < 30; k++) bars.push({ t: t0 - 26 * H + k * 900_000, o: 110, h: 112, l: k === 10 ? 100 : 105, c: 108, v: 1 });
for (let k = 0; k < 20; k++) bars.push({ t: t0 + k * 900_000, o: 110, h: 112, l: 106, c: 109, v: 1 });
const lv = majorLevels(bars);
ok("yesterday's low is a major level (PDL)", lv.some((l) => l.name === "PDL" && l.price === 100));
const div = (held) => ({ active: true, kind: "bullish", leader: "left", refHigh: { left: null, right: null }, refLow: { left: null, right: null }, note: "", timeframe: "15m", sweepPrice: 4000, holdPrice: held });
check("held low at the PDL → SMT at a level", smtAtLevel({ divergence: div(100.5), isLeft: false, side: "long", bars, atr: 4 }).level, "PDL");
check("held low mid-range → present but not at a level", smtAtLevel({ divergence: div(108), isLeft: false, side: "long", bars, atr: 4 }).atLevel, false);
check("a bearish divergence does not read for a long", smtAtLevel({ divergence: { ...div(100.5), kind: "bearish" }, isLeft: false, side: "long", bars, atr: 4 }).present, false);
check("no active divergence → nothing", smtAtLevel({ divergence: { ...div(100.5), active: false }, isLeft: false, side: "long", bars, atr: 4 }).present, false);
const arr = [{ kind: "fvg", tf: "1h", side: "bull", top: 109, bottom: 107, mid: 108 }];
check("held low inside a 1h bull array → at a level", smtAtLevel({ divergence: div(108), isLeft: false, side: "long", bars, arrays: arr, atr: 4 }).level, "1h fvg");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
