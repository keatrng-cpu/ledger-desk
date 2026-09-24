/**
 * The gate sweep, per YEAR, on 93,830 bars instead of 4,124.
 *
 *   npx tsx scripts/sweep-regimes.mjs
 *
 * WHY THIS IS THE FIRST USE OF THE 4-YEAR TAPE
 *
 * `sweep-gates.mjs` ran 18 variants over 63 days and printed 0 takes on every
 * one. That result has always been ambiguous in the same way: a gate that
 * refuses everything for two months might be genuinely too tight, or those
 * two months might simply not have contained the setup it is built for. One
 * sample cannot separate those, and no amount of re-running it on the same 63
 * days ever will.
 *
 * Four years splits into four regimes. If `retrace` binds identically in a
 * trending year and a chopping one, the gate is tight regardless of what the
 * market is doing and the constraint is structural. If it binds in one and
 * releases in another, the gate is doing its job and the 63-day window was
 * simply the wrong two months.
 *
 * That is a real question with a real answer, and until now it was
 * unanswerable.
 *
 * WHAT THIS DOES NOT DO
 * It does not change a gate. It reports which layer blocks how often, per
 * year, per variant. Nothing here is permission to loosen anything — the
 * decision rule for that was pre-registered in take-census.ts and needs the
 * LIVE clock, which a closed-bar replay is not.
 */

import { readFileSync } from "node:fs";

const { setGate, ORIGINAL_GATE } = await import("../src/lib/trading/gate-tuning.ts");
const { buildCases, tally } = await import("../src/lib/learn/cases.ts");

const H = JSON.parse(readFileSync("src/data/history-4y.json", "utf8"));
const MNQ = H.bars.MNQ ?? [];
const ES = H.bars.ES ?? [];
if (MNQ.length < 5000 || ES.length < 5000) {
  console.error(`tape too thin (MNQ ${MNQ.length}, ES ${ES.length}) — run capture-history.mjs first.`);
  process.exit(1);
}

const yearOf = (t) => new Date(t).getUTCFullYear();
const YEARS = [...new Set(MNQ.map((b) => yearOf(b.t)))].sort();

console.log(`tape: ${H.window.start} → ${H.window.end}, ${H.symbology}`);
console.log(`MNQ ${MNQ.length.toLocaleString()} · ES ${ES.length.toLocaleString()} 15m bars across ${YEARS.length} years\n`);

/**
 * Regime, measured rather than asserted.
 *
 * A "trending" year and a "chopping" one are not vibes: net move over the
 * year divided by the total distance travelled is the standard efficiency
 * ratio, and it separates the two without anyone choosing a label.
 */
function regime(bars) {
  if (bars.length < 2) return { label: "—", efficiency: 0, rangePct: 0 };
  const net = Math.abs(bars[bars.length - 1].c - bars[0].c);
  let travel = 0;
  for (let i = 1; i < bars.length; i++) travel += Math.abs(bars[i].c - bars[i - 1].c);
  const efficiency = travel > 0 ? net / travel : 0;
  const hi = Math.max(...bars.map((b) => b.h));
  const lo = Math.min(...bars.map((b) => b.l));
  const rangePct = lo > 0 ? ((hi - lo) / lo) * 100 : 0;
  return {
    label: efficiency > 0.06 ? "trending" : efficiency > 0.03 ? "mixed" : "chopping",
    efficiency,
    rangePct,
  };
}

// A focused set: the original, the two knobs that shipped, and the variants
// the 2026-09-21 sweep identified as touching the binding layers.
const VARIANTS = {
  v0_original: { ...ORIGINAL_GATE },
  v1_shipped: { ...ORIGINAL_GATE, sameBarDisplacement: true, sideFromRaid: true },
  v2_armedIsTake: { ...ORIGINAL_GATE, sameBarDisplacement: true, sideFromRaid: true, armedIsTake: true },
  v3_pad50: { ...ORIGINAL_GATE, sameBarDisplacement: true, sideFromRaid: true, retracePad: 0.5 },
  v4_impulse: { ...ORIGINAL_GATE, sameBarDisplacement: true, sideFromRaid: true, dealingRange: "impulse" },
  v5_loose: {
    ...ORIGINAL_GATE,
    sameBarDisplacement: true,
    sideFromRaid: true,
    armedIsTake: true,
    retracePad: 0.5,
    recentSweepBars: 32,
    recentDisplacementBars: 16,
  },
};

/** Which must-layer stopped each case — the actionable output. */
function blockers(cases) {
  const count = {};
  for (const c of cases) {
    if (c.outcome !== "stand") continue;
    const id = c.missingId ?? c.missing ?? c.blockedBy ?? "unknown";
    count[String(id)] = (count[String(id)] ?? 0) + 1;
  }
  return Object.entries(count).sort((a, b) => b[1] - a[1]);
}

const rows = [];
for (const year of YEARS) {
  const mnq = MNQ.filter((b) => yearOf(b.t) === year);
  const es = ES.filter((b) => yearOf(b.t) === year);
  if (mnq.length < 500) {
    console.log(`${year}: ${mnq.length} bars — partial year, skipped\n`);
    continue;
  }
  const reg = regime(mnq);
  console.log(
    `── ${year} ${"─".repeat(30)} ${mnq.length.toLocaleString()} bars · ${reg.label} (efficiency ${reg.efficiency.toFixed(3)}, range ${reg.rangePct.toFixed(0)}%)`,
  );

  for (const [name, gate] of Object.entries(VARIANTS)) {
    setGate(gate);
    let cases = [];
    try {
      cases = [
        ...buildCases("MNQ", mnq, "ES", es),
        ...buildCases("ES", es, "MNQ", mnq),
      ];
    } catch (e) {
      console.log(`   ${name.padEnd(16)} ERROR ${String(e).slice(0, 60)}`);
      continue;
    }
    const t = tally(cases);
    const top = blockers(cases).slice(0, 2).map(([k, n]) => `${k} ${n}`).join(", ");
    console.log(
      `   ${name.padEnd(16)} takes ${String(t.takes).padStart(4)}  W/L ${String(t.wins).padStart(3)}/${String(t.losses).padStart(3)}  ` +
        `sumR ${(t.sumR >= 0 ? "+" : "") + t.sumR.toFixed(1)}  stands ${String(t.stands).padStart(5)}  | blocks: ${top}`,
    );
    rows.push({ year, regime: reg.label, variant: name, ...t });
  }
  console.log("");
}
setGate(ORIGINAL_GATE);

/* ── Does the binding layer move with the regime? ────────────────────────── */
console.log("═".repeat(78));
console.log("TAKES BY VARIANT AND REGIME — the question the 63-day window could not answer\n");
const variants = [...new Set(rows.map((r) => r.variant))];
const years = [...new Set(rows.map((r) => r.year))];
console.log(`  ${"variant".padEnd(16)}${years.map((y) => String(y).padStart(8)).join("")}    total`);
for (const v of variants) {
  const cells = years.map((y) => {
    const r = rows.find((x) => x.variant === v && x.year === y);
    return String(r ? r.takes : "-").padStart(8);
  });
  const total = rows.filter((x) => x.variant === v).reduce((s, x) => s + x.takes, 0);
  console.log(`  ${v.padEnd(16)}${cells.join("")}${String(total).padStart(9)}`);
}
console.log(`\n  regimes: ${years.map((y) => `${y} ${rows.find((r) => r.year === y)?.regime ?? "?"}`).join(" · ")}`);
console.log(
  "\nRead it this way: a row that is flat at zero across four different regimes is a\n" +
    "STRUCTURAL refusal — the gate does not fire regardless of what the market does.\n" +
    "A row that varies with the regime means the gate works and 63 days was the wrong\n" +
    "window. Nothing here loosens anything; take-census.ts owns that decision and it\n" +
    "needs the live clock, which a closed-bar replay is not.",
);
