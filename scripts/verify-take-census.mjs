/**
 * The census decides whether a gate gets changed, so its arithmetic has to be
 * unarguable and its thresholds have to be the ones that were pre-registered.
 *
 *   npx tsx scripts/verify-take-census.mjs
 */
import {
  census,
  PRE_REGISTERED,
  PRE_REGISTERED_CONCLUSIONS,
  CENSUS_MAX,
} from "../src/lib/trading/take-census.ts";
import { APLUS_RULES } from "../src/lib/aplus/config.ts";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

let pass = 0;
let fail = 0;
const fails = [];
const ok = (c, l) => (c ? pass++ : (fail++, fails.push(l)));

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 8, 1, 13, 30);

/** Build n polls across `sessions` days, `takeEpisodes` of them TAKE. */
function build({ n, sessions, takeEpisodes = 0, lagSec = 5, missing = "retrace", spanDays }) {
  const out = [];
  const span = (spanDays ?? sessions) * DAY;
  for (let i = 0; i < n; i++) {
    const t = T0 + Math.floor((i / Math.max(1, n - 1)) * span);
    out.push({
      t,
      session: `2026-09-${String(1 + Math.floor((t - T0) / DAY)).padStart(2, "0")}`,
      symbol: "MNQ",
      side: "short",
      word: "STAND",
      mustPass: 6,
      mustNeed: 9,
      missingLayer: missing,
      lagSec,
      source: "live_gateway",
      confluence: 0.72,
    });
  }
  // Each TAKE episode is a single poll, spaced far past the 30-min episode gap.
  for (let e = 0; e < takeEpisodes; e++) {
    const t = T0 + Math.floor(((e + 0.5) / Math.max(1, takeEpisodes)) * span);
    out.push({
      t,
      session: `2026-09-${String(1 + Math.floor((t - T0) / DAY)).padStart(2, "0")}`,
      symbol: "MNQ",
      side: "short",
      word: "TAKE",
      mustPass: 9,
      mustNeed: 9,
      missingLayer: null,
      lagSec,
      source: "live_gateway",
      confluence: 0.91,
    });
  }
  return out;
}

// ── 1. No verdict before the pre-registered sample ─────────────────────────
{
  const c = census(build({ n: 100, sessions: 2 }));
  ok(c.verdict === "insufficient", "a small sample reports no verdict");
  ok(c.takesPerWeek === 0, "and still reports the rate honestly");
  ok(/more/.test(c.line), "it says how much more is needed");

  // Enough polls but too few sessions is STILL insufficient — one unusual
  // week is the failure mode this guards.
  const many = census(build({ n: 5_000, sessions: 3, spanDays: 3 }));
  ok(many.verdict === "insufficient", "polls alone do not buy a verdict; sessions are required");
}

// ── 2. THE EXCLUSION: a lagged quote cannot answer a timing question ───────
{
  const stale = build({ n: 4_000, sessions: 10, takeEpisodes: 20, lagSec: 600 });
  const c = census(stale);
  ok(c.polls === 0, "600s-lagged polls are all excluded");
  ok(c.excludedStale === stale.length, "and counted as excluded, not silently dropped");
  ok(c.verdict === "insufficient", "an all-stale sample yields no verdict");

  const mixed = census([
    ...build({ n: 3_200, sessions: 10, takeEpisodes: 8, lagSec: 5 }),
    ...build({ n: 2_000, sessions: 10, takeEpisodes: 40, lagSec: 900 }),
  ]);
  ok(mixed.excludedStale === 2_040, `stale polls excluded (got ${mixed.excludedStale})`);
  ok(
    mixed.takeEpisodes < 40,
    "the 40 stale TAKEs cannot inflate the rate — that is the whole exclusion",
  );
}

// ── 3. Episodes, not polls ────────────────────────────────────────────────
//
// A single TAKE held for 12 minutes is ONE opportunity. Counting raw polls
// would make any threshold a formality.
{
  const base = build({ n: 3_200, sessions: 10 });
  const t = T0 + 5 * DAY;
  const held = [];
  for (let i = 0; i < 40; i++) {
    held.push({
      t: t + i * 20_000,
      session: "2026-09-06",
      symbol: "MNQ",
      side: "short",
      word: "TAKE",
      mustPass: 9,
      mustNeed: 9,
      missingLayer: null,
      lagSec: 4,
      source: "live_gateway",
      confluence: 0.9,
    });
  }
  const c = census([...base, ...held]);
  ok(c.takes === 40, "all 40 TAKE polls are counted as polls");
  ok(c.takeEpisodes === 1, `40 consecutive TAKE polls are ONE episode (got ${c.takeEpisodes})`);
}

// ── 4. The pre-registered thresholds decide, and nothing else ─────────────
{
  // ~10 weeks of span, 25 episodes => 2.5/week, over the clock threshold.
  const hi = census(build({ n: 3_500, sessions: 12, takeEpisodes: 25, spanDays: 70 }));
  ok(hi.takesPerWeek >= PRE_REGISTERED.clockNotGateTakesPerWeek, `hi rate ${hi.takesPerWeek}`);
  ok(hi.verdict === "clock_not_gate", `high live rate => clock_not_gate (got ${hi.verdict})`);
  ok(
    /Do NOT loosen/.test(hi.conclusion),
    "and the pre-registered conclusion forbids loosening on this evidence",
  );

  // 2 episodes over 10 weeks => 0.2/week, under the tight threshold.
  const lo = census(build({ n: 3_500, sessions: 12, takeEpisodes: 2, spanDays: 70 }));
  ok(lo.takesPerWeek <= PRE_REGISTERED.gateTooTightTakesPerWeek, `lo rate ${lo.takesPerWeek}`);
  ok(lo.verdict === "gate_too_tight", `low live rate => gate_too_tight (got ${lo.verdict})`);

  // 8 episodes over 10 weeks => 0.8/week, between the two.
  const mid = census(build({ n: 3_500, sessions: 12, takeEpisodes: 8, spanDays: 70 }));
  ok(mid.verdict === "undecided", `a middling rate is UNDECIDED (got ${mid.verdict})`);
  ok(/Keep collecting/.test(mid.conclusion), "undecided says keep collecting");
}

// ── 5. The branch most easily misread as permission ───────────────────────
{
  const recs = build({ n: 3_500, sessions: 12, takeEpisodes: 25, spanDays: 70 });
  const good = census(recs, 0.4);
  const bad = census(recs, -0.2);
  ok(good.verdict === "clock_not_gate", "positive shadow expectancy keeps clock_not_gate");
  ok(
    bad.verdict === "clock_wrong_trades_bad",
    `negative shadow expectancy flips the verdict (got ${bad.verdict})`,
  );
  ok(
    /change nothing about the gates/i.test(bad.conclusion),
    "and that conclusion explicitly changes no gate",
  );
  ok(
    bad.takesPerWeek === good.takesPerWeek,
    "the RATE is identical — only the conclusion differs, which is the point",
  );
}

// ── 6. The binding layer is named, not described ──────────────────────────
{
  const mostly = [
    ...build({ n: 2_600, sessions: 12, missing: "retrace", spanDays: 70 }),
    ...build({ n: 900, sessions: 12, missing: "pd_half", spanDays: 70 }),
  ];
  const c = census(mostly);
  ok(c.bindingLayer === "retrace", `names the binding layer (got ${c.bindingLayer})`);
  ok(c.byLayer[0].layer === "retrace", "layers are ranked by how often they block");
  ok(c.byLayer[0].share > 0.5, "and the share is reported");

  // No layer over the threshold => no binding layer claimed.
  const even = [
    ...build({ n: 1_200, sessions: 12, missing: "retrace", spanDays: 70 }),
    ...build({ n: 1_200, sessions: 12, missing: "pd_half", spanDays: 70 }),
    ...build({ n: 1_200, sessions: 12, missing: "ltf", spanDays: 70 }),
  ];
  ok(census(even).bindingLayer === null, "an even spread names NO binding layer");
}

// ── 7. A short sample cannot be annualised into a flattering rate ─────────
{
  // 3 episodes in 2 days is 10.5/week if extrapolated naively.
  const c = census(build({ n: 3_200, sessions: 10, takeEpisodes: 3, spanDays: 2 }));
  ok(c.takesPerWeek <= 3, `a 2-day span is not annualised (got ${c.takesPerWeek}/week)`);
}

// ── 8. The module cannot touch a gate ─────────────────────────────────────
{
  const src = readFileSync(
    fileURLToPath(new URL("../src/lib/trading/take-census.ts", import.meta.url)),
    "utf8",
  );
  ok(!/confluenceFloor/.test(src), "take-census never references the confluence floor");
  ok(!/setGate|APLUS_RULES\s*\./.test(src), "take-census never writes a gate");
  ok(APLUS_RULES.confluenceFloor === 0.65, "the floor is still 0.65, untouched");

  // The pre-registration must carry its date and every verdict must have a
  // written consequence — a verdict with no declared action is a mood.
  ok(/^\d{4}-\d{2}-\d{2}$/.test(PRE_REGISTERED.registeredAt), "the pre-registration is dated");
  for (const k of Object.keys(PRE_REGISTERED_CONCLUSIONS)) {
    ok(
      PRE_REGISTERED_CONCLUSIONS[k].length > 60,
      `verdict "${k}" declares a real consequence`,
    );
  }
  ok(
    PRE_REGISTERED.clockNotGateTakesPerWeek > PRE_REGISTERED.gateTooTightTakesPerWeek,
    "the thresholds leave an undecided band rather than a coin flip",
  );
  ok(CENSUS_MAX > PRE_REGISTERED.minPolls, "storage holds more than the minimum sample");
}

console.log(`\ntake-census: ${pass} passed, ${fail} failed`);
if (fails.length) {
  console.log("\nFAILURES:");
  for (const f of fails) console.log("  ✗", f);
}
process.exit(fail ? 1 : 0);
