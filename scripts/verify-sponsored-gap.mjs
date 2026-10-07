/**
 * Sponsored gaps as PB Trading teaches them (src/lib/trading/sponsored-gap.ts), and the desk's tag they rest on.
 *
 *   npx tsx scripts/verify-sponsored-gap.mjs
 *
 * RESEARCH (the trader's, 2026-10-07): a sponsored gap is an institutional fair value gap, a one-sided displacement leap that leaves a clean vacuum.
 * PB tiers them: the 1 hour and 4 hour are the narrative (the map), the 1 to 5 minute the transaction (the trigger). The if-then: price trades
 * into a higher-timeframe bullish sponsored gap, drop to the 5 minute and wait for the boundary to be respected, and the entry is the inverse of a
 * counter-trend lower-timeframe gap (a bearish 5 minute gap closed through by displacement), with the stop under the structure the gap defends.
 *
 * Pins: which gaps count (1h / 4h, sponsored, the card's side, still live); the four states and the trigger; both sides; Blake and Patty's check
 * (a preference, never a refusal); the Floor's line; and, on the desk's REAL stored bars, that "sponsored" means exactly "middle body >= 1.5 ATR".
 */
import { readFileSync } from "node:fs";

const S = await import("../src/lib/trading/sponsored-gap.ts");
const B = await import("../src/lib/trading/school-brief.ts");
const { exTier } = await import("../src/lib/room/live-voices.ts");
const { Facts, freshTalkState } = await import("../src/lib/room/live-types.ts");
const { spokenProblems } = await import("./lib/spoken-check.mjs");

let pass = 0;
let fail = 0;
const check = (name, ok, detail = "") => {
  if (ok) pass++;
  else fail++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : ` — ${detail}`}`);
};

const gap = (o) => ({ kind: "sponsored", tf: "4h", side: "bull", top: 102, bottom: 100, state: "fresh", ...o });
const ARR = [
  gap({}), // 4h bullish [100, 102]
  gap({ tf: "1h", top: 112, bottom: 110, state: "partial" }), // 1h bullish [110, 112]
  gap({ tf: "15m", top: 90, bottom: 88 }), // lower tier: not the map
  gap({ kind: "fvg", top: 96, bottom: 94 }), // a plain gap, not sponsored
  gap({ top: 80, bottom: 78, state: "mitigated" }), // filled through: no longer sponsoring
  gap({ top: 70, bottom: 68, state: "inverted" }),
  gap({ side: "bear", top: 122, bottom: 120 }), // 4h bearish [120, 122]
];
const read = (o) => S.sponsoredRead({ arrays: ARR, side: "long", price: 101, atr: 1, inverse: false, ...o });

console.log("the map: which gaps count");
{
  check("a 4h bullish sponsored gap with price inside it is in play for a long", read({}).state === "in_gap" && read({}).gap.tf === "4h" && read({}).gap.bottom === 100);
  check("the 15m sponsored gap is not the map (PB's tiers: 1h and 4h only)", read({ price: 89 }).gap?.tf !== "15m");
  check("a plain (not sponsored) gap is not the map", read({ price: 95 }).gap?.top !== 96);
  check("a mitigated or an inverted gap no longer sponsors", read({ price: 79 }).gap?.top !== 80 && read({ price: 69 }).gap?.top !== 70);
  check("a long reads bullish gaps only, a short bearish only", read({}).gap.side === "bull" && read({ side: "short", price: 121 }).gap.side === "bear");
  check("the nearest live gap is chosen, 1h or 4h (price 111 is inside the 1h gap)", read({ price: 111 }).gap.tf === "1h" && read({ price: 111 }).state === "in_gap");
  check("with no 1h/4h sponsored gap on the side there is no map, even when an inverse printed", (() => { const r = S.sponsoredRead({ arrays: ARR.slice(2, 6), side: "long", price: 95, atr: 1, inverse: true }); return r.state === "none" && r.trigger === false && /No 1 hour or 4 hour sponsored gap/.test(r.line); })());
  check("no arrays at all, or no price, is 'none' and says why", S.sponsoredRead({ arrays: null, side: "long", price: 1, atr: 1, inverse: false }).state === "none" && /No live price/.test(read({ price: null }).line));
}

console.log("the if-then");
{
  const wait = read({});
  check("in the gap, no inverse: wait for the 5 minute to respect the boundary and a bearish 5 minute gap to invert", wait.state === "in_gap" && wait.trigger === false && wait.line === "Price is in the 4 hour bullish sponsored gap 100 to 102. Wait: the 5 minute must respect the boundary, then a bearish 5 minute gap must invert.", wait.line);
  const hit = read({ inverse: true, rung: 5 });
  check("in the gap WITH the 5 minute inverse: that is the trigger, and the structure it defends is under the gap", hit.trigger === true && hit.invalidation === 100 && hit.line === "The 5 minute inverse printed inside the 4 hour bullish sponsored gap 100 to 102. That is PB's trigger. The structure it defends is below 100.", hit.line);
  check("at the gap (within half an ATR above it) counts: 'at', and the trigger can fire", (() => { const r = read({ price: 102.4, inverse: true, rung: 3 }); return r.state === "near" && r.trigger && /printed at the 4 hour/.test(r.line) && r.distanceAtr === 0.4; })());
  check("exactly half an ATR away is still near; just past it is far", read({ price: 102.5 }).state === "near" && read({ price: 102.51 }).state === "far");
  check("far from the gap an inverse is NOT a trigger (the map is not in play), and the line says how far", (() => { const r = read({ price: 104, inverse: true }); return r.state === "far" && r.trigger === false && /is 2\.0 ATR away\. Wait for price to trade into it\./.test(r.line); })());
  check("a short mirrors it: a bearish gap, a bullish 5 minute gap must invert, the structure is ABOVE the gap", (() => { const r = read({ side: "short", price: 121, inverse: true, rung: 5 }); return r.trigger && r.invalidation === 122 && /bearish sponsored gap 120 to 122/.test(r.line) && /defends is above 122/.test(r.line) && /bullish 5 minute gap must invert/.test(read({ side: "short", price: 121 }).line); })());
  check("a gap below price is reached from above: a long pulling back into a gap under it is 'far' until it arrives", read({ price: 106 }).state === "far");
  check("without an ATR the gap can still be 'in', but 'near' cannot be claimed", read({ atr: null, price: 101 }).state === "in_gap" && read({ atr: null, price: 102.2 }).state === "far" && read({ atr: null, price: 102.2 }).distanceAtr === null);
  check("without a rung the sentence says '1 to 5 minute'", /The 1 to 5 minute inverse printed/.test(read({ inverse: true }).line));
  check("every sentence passes the floor's own speech checker", spokenProblems([wait, hit, read({ price: 104 }), read({ side: "short", price: 121, inverse: true, rung: 5 }), read({ price: null })].map((r) => ({ character: "Sterling", text: r.line }))).length === 0, spokenProblems([wait, hit].map((r) => ({ character: "Sterling", text: r.line }))).join(" | "));
}

console.log("Blake and Patty read it; it never refuses a card");
{
  const base = { side: "long", components: ["sweep_significant", "ifvg", "breaker", "pd", "displacement", "mss"], killzoneOk: true, disrespected: false, drawName: "PDH", drawSwept: false, rr1: 2, mitigated: false, ladder: null };
  const checkOf = (school, sponsored) => B.schoolRead(school, { ...base, sponsored }).checks.find((c) => c.id === "htf_gap");
  for (const school of ["blake", "patty"]) {
    check(`${school}: price in the gap -> pass`, checkOf(school, { state: "in_gap", trigger: false }).state === "pass");
    check(`${school}: the inverse printed in it -> pass, and says so`, /inverse printed in it/.test(checkOf(school, { state: "near", trigger: true }).detail));
    check(`${school}: far, or no gap on the side -> fail (a preference)`, checkOf(school, { state: "far", trigger: false }).state === "fail" && checkOf(school, { state: "none", trigger: false }).state === "fail");
    check(`${school}: not read -> unknown, never a pass`, checkOf(school, undefined).state === "unknown" && checkOf(school, null).state === "unknown");
    check(`${school}: it is a preference, not a must: a far gap does not make the school wait`, checkOf(school, { state: "far", trigger: false }).must === false && B.schoolRead(school, { ...base, sponsored: { state: "far", trigger: false } }).verdict === B.schoolRead(school, { ...base, sponsored: { state: "in_gap", trigger: false } }).verdict);
  }
  check("ICT and TJR do not carry this check (it is PB's map)", !B.schoolRead("ict", { ...base, sponsored: { state: "in_gap", trigger: true } }).checks.some((c) => c.id === "htf_gap") && !B.schoolRead("tjr", { ...base, sponsored: { state: "in_gap", trigger: true } }).checks.some((c) => c.id === "htf_gap"));
}

console.log("the Floor says it");
{
  const k = { name: "A+ ES long", symbol: "ES", verdict: "WATCH", u: "SPY", type: "CALL", band: "A+", tier: "armed", awayPts: 2, futSymbol: "ES", futSide: "long", entry: 7832, stop: 7826, t1: 7845,
    pT1: 0.3, expR: 0.1, block: null, strategy: "patty", setup: "", fit: 0.9, sequence: "ANTICIPATION · 5m", entryLine: "x", key: "k", schools: { line: "Patty fits this long.", by: { Sterling: "Patty fits: the sweep." } } };
  const sterling = (card) => exTier({ st: freshTalkState(), f: new Facts(), key: "t:sp", now: 1_000_000 }, { card, from: null, to: "armed", b: null }).lines.find((l) => l.character === "Sterling")?.text ?? "";
  const line = read({ inverse: true, rung: 5 }).line;
  check("on a new card Sterling opens with PB's map", sterling({ ...k, sponsored: line }).startsWith("The 5 minute inverse printed inside the 4 hour bullish sponsored gap 100 to 102"), sterling({ ...k, sponsored: line }).slice(0, 120));
  check("with no sponsored gap he says what he said before", !/sponsored gap/.test(sterling({ ...k, sponsored: null })));
  check("it is not long (the standing complaint)", sterling({ ...k, sponsored: line }).split(/\s+/).length <= 70, String(sterling({ ...k, sponsored: line }).split(/\s+/).length));
}

console.log("the desk's own tag, on its real bars");
{
  const { detectFvgs } = await import("../src/lib/trading/detectors.ts");
  const { buildSmcTape } = await import("../src/lib/trading/smc-board.ts");
  const hist = JSON.parse(readFileSync(new URL("../src/data/history-4y.json", import.meta.url), "utf8"));
  // Windows across the stored history, because a single recent window may hold no sponsored gap at all. The tape keeps the last 10 gaps per timeframe.
  for (const sym of ["MNQ", "ES"]) {
    const all = hist.bars[sym];
    let sponsoredSeen = 0;
    let plainSeen = 0;
    let badSponsored = 0;
    let missedSponsored = 0;
    for (let end = all.length - 1; end > 3000 && end > all.length - 30000; end -= 1500) {
      const bars = all.slice(end - 1500, end);
      const last10 = detectFvgs(bars).slice(-10);
      const arr15 = buildSmcTape(bars).arrays.filter((a) => a.tf === "15m" && (a.kind === "sponsored" || a.kind === "fvg"));
      const match = (a) => last10.find((g) => Math.abs(g.top - a.top) < 1e-6 && Math.abs(g.bottom - a.bottom) < 1e-6 && g.kind === a.side);
      for (const a of arr15) {
        const ratio = match(a)?.middleBodyAtrRatio;
        if (a.kind === "sponsored") {
          sponsoredSeen++;
          if (!(ratio >= 1.5)) badSponsored++;
        } else {
          plainSeen++;
          if (ratio >= 1.5) missedSponsored++;
        }
      }
    }
    check(`${sym}: sponsored arrays were found to test (${sponsoredSeen} sponsored, ${plainSeen} plain, across windows of the stored history)`, sponsoredSeen >= 5 && plainSeen >= 5, `${sponsoredSeen}/${plainSeen}`);
    check(`${sym}: every 15m 'sponsored' array is a real gap whose middle body is >= 1.5 ATR`, badSponsored === 0, `${badSponsored} wrong`);
    check(`${sym}: no plain 'fvg' array has a middle body >= 1.5 ATR (nothing sponsored is missed)`, missedSponsored === 0, `${missedSponsored} missed`);
  }
}

console.log("wired in, and no gate");
{
  const lw = readFileSync(new URL("../src/lib/room/live-world.ts", import.meta.url), "utf8");
  const sp = readFileSync(new URL("../src/lib/trading/sponsored-gap.ts", import.meta.url), "utf8");
  check("the Floor's card read keeps the 1-5 minute read and builds the sponsored read from this index's own tape", /const ltf = readLtfLead\(/.test(lw) && /const sponsored = sponsoredFor\(desk, c, ltf\);/.test(lw) && /sponsored: sponsored\.state === "none" \? null : sponsored\.line/.test(lw) && /schoolsOf\(desk, c, sponsored\)/.test(lw));
  check("it imports no config, gate, size or order path", !/aplus\/config|profit-rules|options-sleeve|sleeve-sizing|APLUS_RULES|rh-autofire/.test(sp));
  check("deterministic: no network, no model, no clock, no randomness", !/\bfetch\s*\(|anthropic|\bxai\b|Math\.random|Date\.now\s*\(|new Date\s*\(/.test(sp));
}

console.log(`\nsponsored-gap: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
