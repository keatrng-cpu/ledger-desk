/**
 * Calibration: does a number the desk prints mean what it says?
 *
 *   npx tsx scripts/verify-calibration.mjs
 *
 * Two kinds of test here, and the second kind matters more.
 *
 * SYNTHETIC — a predictor whose truth is known by construction, so the
 * machinery can be checked against an answer rather than against a hope.
 *
 * REAL — the shadow replay (n=387 resolved), which is where both of the
 * traps this module exists to refuse were actually hit. Those are locked in
 * as fixtures: if a future change makes the desk report "chasing is three
 * times better than resting a limit", this fails.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  reliability,
  expectancy,
  conditional,
  compare,
  wilson,
  PRIOR_STRENGTH,
  MIN_BUCKET_N,
} from "../src/lib/trading/calibration.ts";

let pass = 0;
let fail = 0;
const fails = [];
const ok = (c, l) => (c ? pass++ : (fail++, fails.push(l)));
const near = (a, b, tol, l) => ok(Math.abs(a - b) <= tol, `${l} (got ${a}, want ~${b})`);

// Deterministic PRNG — a flaky statistics test is worse than none.
let seed = 42;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);

// ── 1. A PERFECTLY CALIBRATED predictor is recognised ─────────────────────
{
  const s = [];
  for (let i = 0; i < 2000; i++) {
    const p = 0.05 + rnd() * 0.9;
    s.push({ p, hit: rnd() < p });
  }
  const r = reliability(s);
  ok(r.verdict === "informative", `a true predictor reads informative (got ${r.verdict})`);
  ok(r.skill > 0.2, `and beats a constant (skill ${r.skill.toFixed(3)})`);
  ok(Math.abs(r.t) > 1.96, "with a significant correlation");
  // Every bucket's prediction should land near its outcome.
  for (const b of r.buckets) {
    if (b.observed == null) continue;
    ok(Math.abs(b.gap) < 0.12, `bucket ${b.from}-${b.to}: gap ${b.gap} is small`);
  }
}

// ── 2. A NOISE predictor is called flat, not informative ──────────────────
{
  const s = [];
  for (let i = 0; i < 1500; i++) s.push({ p: 0.05 + rnd() * 0.9, hit: rnd() < 0.4 });
  const r = reliability(s);
  ok(r.verdict === "flat", `noise reads flat (got ${r.verdict})`);
  ok(r.skill <= 0.02, `and adds no skill (${r.skill.toFixed(3)})`);
  ok(/do not size off it|does not order/.test(r.line), "and the line says not to size off it");
}

// ── 3. An INVERTED predictor is called out, not averaged away ─────────────
{
  const s = [];
  for (let i = 0; i < 1500; i++) {
    const p = 0.05 + rnd() * 0.9;
    s.push({ p, hit: rnd() < 1 - p });
  }
  const r = reliability(s);
  ok(r.verdict === "inverted", `an inverted predictor reads inverted (got ${r.verdict})`);
  ok(/WRONG WAY/.test(r.line), "and says so in words");
}

// ── 4. Shrinkage pulls a thin bucket toward the base rate ────────────────
{
  // 200 samples at p≈0.3 that hit 30%, plus a thin cluster at p≈0.9 that
  // went 12/12. Raw says 100%; shrunk must not.
  const s = [];
  for (let i = 0; i < 200; i++) s.push({ p: 0.3, hit: i < 60 });
  for (let i = 0; i < 12; i++) s.push({ p: 0.9, hit: true });
  const r = reliability(s, 0.1);
  const thin = r.buckets.find((b) => b.from >= 0.85);
  ok(thin != null && thin.n === 12, "the thin bucket exists");
  ok(thin.observed === 1, "raw observed is 100%");
  ok(thin.shrunk < 0.75, `shrunk is pulled back (${thin.shrunk?.toFixed(3)})`);
  ok(thin.shrunk > r.baseRate, "but not all the way — it still says something");
  // The pull should be exactly the stated prior weight.
  const want = (12 + PRIOR_STRENGTH * r.baseRate) / (12 + PRIOR_STRENGTH);
  near(thin.shrunk, want, 1e-9, "shrinkage matches the documented formula");
}

// ── 5. Nothing is reported below the floor ────────────────────────────────
{
  ok(reliability([{ p: 0.8, hit: true }]).verdict === "insufficient", "n=1 says insufficient");
  ok(reliability([]).verdict === "insufficient", "empty says insufficient");
  const s = [];
  for (let i = 0; i < 40; i++) s.push({ p: 0.5, hit: rnd() < 0.5 });
  for (const b of reliability(s).buckets) {
    if (b.n < MIN_BUCKET_N) ok(b.observed === null, `a bucket of ${b.n} reports no rate`);
  }
}

// ── 6. Wilson is right where the normal approximation is not ─────────────
{
  const [lo, hi] = wilson(0, 10);
  ok(lo === 0, "0/10 has a lower bound of 0");
  ok(hi > 0.25 && hi < 0.35, `0/10 upper bound is ~0.30 (got ${hi.toFixed(3)})`);
  const [l2, h2] = wilson(10, 10);
  ok(h2 === 1, "10/10 has an upper bound of 1");
  ok(l2 > 0.65 && l2 < 0.75, `10/10 lower bound ~0.72 (got ${l2.toFixed(3)})`);
  const [l3, h3] = wilson(50, 100);
  ok(l3 > 0.39 && h3 < 0.61, "50/100 is a tight interval around 0.5");
}

// ── 7. THE UNIT TRAP: an unfilled plan is 0R, not excluded ───────────────
{
  // Fills 50% of the time at +2R. Excluding the misses says +2R; the trader
  // does not get to keep only the fills, so the truth is +1R.
  const s = [];
  for (let i = 0; i < 100; i++) s.push({ p: 0.5, hit: i % 2 === 0, r: 2, filled: i % 2 === 0 });
  const e = expectancy(s);
  near(e.meanR, 1, 1e-9, "a 50% fill rate at +2R is +1R per opportunity");
  ok(e.n === 100, "every opportunity counts, not just the fills");
}

// ── 8. THE DENOMINATOR TRAP: hit rates with different fill rates ─────────
//
// This is the exact shape of the real finding. `compare` must refuse the hit
// rate and answer on expectancy instead.
{
  const limit = [];
  for (let i = 0; i < 194; i++) {
    const filled = i < 137;
    limit.push({ p: 0.5, hit: filled && i < 40, r: filled ? (i < 40 ? 2 : -1) : 0, filled });
  }
  const chase = [];
  for (let i = 0; i < 193; i++) chase.push({ p: 0.5, hit: i < 118, r: i < 118 ? 0.5 : -1, filled: true });

  const c = compare({ label: "limit", samples: limit }, { label: "chase", samples: chase });
  ok(c.comparable === false, "a hit-rate comparison is refused");
  ok(c.on === "expectancy", "and answered on expectancy instead");
  ok(/Fill rates differ/.test(c.line), "the refusal names the reason");
  ok(/never fills cannot hit/.test(c.line), "and explains it in one clause");

  // conditional() must surface fill rate SEPARATELY so it cannot hide.
  const all = [...limit.map((s) => ({ ...s, leg: "limit" })), ...chase.map((s) => ({ ...s, leg: "chase" }))];
  const slices = conditional(all, (s) => s.leg);
  const l = slices.find((x) => x.key === "limit");
  const ch = slices.find((x) => x.key === "chase");
  ok(Math.abs(l.fillRate - 137 / 194) < 1e-9, "limit fill rate is reported");
  ok(ch.fillRate === 1, "chase fill rate is reported");
  ok(l.rate != null && ch.rate != null, "both rates computed on FILLED legs only");
}

// ── 9. THE REAL FINDING, locked in ────────────────────────────────────────
//
// If a future change makes the desk claim the engine score predicts the
// outcome, or that chasing beats resting a limit, this fails.
{
  const rows = Object.values(
    JSON.parse(
      readFileSync(fileURLToPath(new URL("../src/data/shadow-replay.json", import.meta.url)), "utf8"),
    ),
  ).filter((r) => r.status && r.status !== "open");

  ok(rows.length > 300, `shadow replay has ${rows.length} resolved rows`);

  /**
   * R measured from the leg's OWN entry to its OWN target over its OWN risk.
   *
   * Scoring every win as +1R was the unit trap a second time, in this very
   * file: it erased the reason the limit leg is better. The chase wins 2.6x as
   * often (105 vs 40) and each win is worth 0.58R against the limit's 2.79R,
   * because the chase enters late — nearer the target, further from the stop.
   * Collapsing that to "a win is a win" inverted the answer.
   */
  const rOf = (r) => {
    if (r.status === "unfilled") return 0;
    if (r.status === "lost") return -1;
    if (r.status !== "won") return 0;
    if (!Number.isFinite(r.entry) || !Number.isFinite(r.t1) || !(r.riskPts > 0)) return 1;
    const move = r.side === "short" ? r.entry - r.t1 : r.t1 - r.entry;
    return move / r.riskPts;
  };
  const asSample = (r) => ({
    p: r.confluence,
    hit: !!r.t1Hit,
    filled: r.status !== "unfilled",
    r: rOf(r),
  });
  const samples = rows.filter((r) => Number.isFinite(r.confluence)).map(asSample);

  const rel = reliability(samples);
  ok(rel.n >= 380, `n=${rel.n}`);
  near(rel.baseRate, 0.395, 0.02, "base T1 rate is ~39.5%");
  ok(rel.verdict === "flat", `confluence is FLAT against T1 (got ${rel.verdict})`);
  ok(Math.abs(rel.t) < 1.96, `and not significant (t=${rel.t.toFixed(2)})`);
  ok(
    rel.skill <= 0,
    `read as a probability it does not beat a constant (skill ${rel.skill.toFixed(3)})`,
  );
  ok(rel.brier > rel.brierBase, `Brier ${rel.brier.toFixed(3)} is worse than base ${rel.brierBase.toFixed(3)}`);

  // The legs, compared honestly.
  const byLeg = (leg) => rows.filter((r) => r.leg === leg).map(asSample);
  const c = compare({ label: "limit", samples: byLeg("limit") }, { label: "chase", samples: byLeg("chase") });
  ok(/Fill rates differ/.test(c.line), "the real legs also refuse a hit-rate comparison");

  const el = expectancy(byLeg("limit"));
  const ec = expectancy(byLeg("chase"));
  ok(el.meanR > ec.meanR, `limit (${el.meanR}R) beats chase (${ec.meanR}R) on expectancy`);
  near(el.meanR, 0.173, 0.02, "limit expectancy");
  near(ec.meanR, -0.05, 0.02, "chase expectancy");
  ok(
    !el.significant,
    "and it is NOT significant — consistent with rest-at-CE, never proof of it",
  );

  // The MECHANISM, not just the sign: the chase wins far more often and each
  // win is worth far less. This is why a hit rate pointed the wrong way.
  const wins = (leg) => rows.filter((r) => r.leg === leg && r.status === "won");
  const avgWin = (leg) => {
    const w = wins(leg);
    return w.length ? w.map(rOf).reduce((a, b) => a + b, 0) / w.length : 0;
  };
  ok(wins("chase").length > wins("limit").length * 2, "the chase wins far more often");
  ok(avgWin("limit") > avgWin("chase") * 3, `and for far less each (${avgWin("limit").toFixed(2)}R vs ${avgWin("chase").toFixed(2)}R)`);
}

console.log(`\ncalibration: ${pass} passed, ${fail} failed`);
if (fails.length) {
  console.log("\nFAILURES:");
  for (const f of fails) console.log("  ✗", f);
}
process.exit(fail ? 1 : 0);
