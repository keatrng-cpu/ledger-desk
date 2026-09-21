/**
 * Sweep the sequence-gate tuning against real tape.
 *
 * For each candidate rule set: set the live knobs (gate-tuning.ts), run the
 * live engine causally over the captured history on both books in the NY AM
 * window (learn/cases.ts — the identical assembly the desk uses), simulate
 * every TAKE with a limit at consequent encroachment and intrabar ties
 * resolved AGAINST the trade, and tally. Print one row per variant.
 *
 * This is how the knobs were chosen. A rule that "feels" right and a rule
 * that fires on the tape are different rules; only the second kind is worth
 * putting a trader's money behind.
 *
 * Run: npx tsx scripts/sweep-gates.mjs [--variants v0,v3,v7]
 *
 * RESULT 2026-09-21: all 18 variants print 0 takes (v9-v12: 1, unfilled).
 * The table and the reason are in src/lib/trading/gate-tuning.ts; the
 * per-layer diagnosis is scripts/diagnose-path.mjs.
 */
import { readFileSync } from "node:fs";

const { setGate, ORIGINAL_GATE } = await import("../src/lib/trading/gate-tuning.ts");
const { buildCases, tally } = await import("../src/lib/learn/cases.ts");

const HIST = JSON.parse(readFileSync("src/data/learn-history.json", "utf8"));
const mnq = HIST.bars.MNQ;
const es = HIST.bars.ES;
console.log(`tape: ${HIST.source} ${JSON.stringify(HIST.contracts)} · MNQ ${mnq.length} · ES ${es.length} · ${HIST.capturedAt.slice(0, 10)}\n`);

const O = ORIGINAL_GATE;
const VARIANTS = {
  v0_original: { ...O },
  v1_sameBar: { ...O, sameBarDisplacement: true },
  v2_armed: { ...O, armedIsTake: true },
  v3_sameBar_armed: { ...O, sameBarDisplacement: true, armedIsTake: true },
  v4_v3_pad50: { ...O, sameBarDisplacement: true, armedIsTake: true, retracePad: 0.5 },
  v5_v3_recency: { ...O, sameBarDisplacement: true, armedIsTake: true, recentSweepBars: 32, recentDisplacementBars: 16 },
  v6_v3_k125: { ...O, sameBarDisplacement: true, armedIsTake: true, displacementK: 1.25 },
  v7_v3_pad50_recency: { ...O, sameBarDisplacement: true, armedIsTake: true, retracePad: 0.5, recentSweepBars: 32, recentDisplacementBars: 16 },
  v8_v7_k125: { ...O, sameBarDisplacement: true, armedIsTake: true, retracePad: 0.5, recentSweepBars: 32, recentDisplacementBars: 16, displacementK: 1.25 },
  // 2026-09-21 diagnosis: v0-v8 all printed ZERO takes because the binding
  // layer was pd_half (the 80-bar window range), not the retrace/shift knobs.
  // These measure the impulse-leg dealing range on its own and stacked.
  v9_impulse: { ...O, dealingRange: "impulse" },
  v10_v3_impulse: { ...O, sameBarDisplacement: true, armedIsTake: true, dealingRange: "impulse" },
  v11_v7_impulse: { ...O, sameBarDisplacement: true, armedIsTake: true, retracePad: 0.5, recentSweepBars: 32, recentDisplacementBars: 16, dealingRange: "impulse" },
  v12_v8_impulse: { ...O, sameBarDisplacement: true, armedIsTake: true, retracePad: 0.5, recentSweepBars: 32, recentDisplacementBars: 16, displacementK: 1.25, dealingRange: "impulse" },
  // v9-v12 also printed ~zero: the impulse range is STRICTER (a >55% retrace
  // of the leg), and the first blocker is the sweep layer failing because the
  // scanner's side and the raid's side disagree. These let the raid pick.
  v13_raid: { ...O, sideFromRaid: true },
  v14_raid_sameBar: { ...O, sideFromRaid: true, sameBarDisplacement: true },
  v15_raid_sameBar_armed: { ...O, sideFromRaid: true, sameBarDisplacement: true, armedIsTake: true },
  v16_v15_pad50_recency: { ...O, sideFromRaid: true, sameBarDisplacement: true, armedIsTake: true, retracePad: 0.5, recentSweepBars: 32, recentDisplacementBars: 16 },
  v17_v16_k125: { ...O, sideFromRaid: true, sameBarDisplacement: true, armedIsTake: true, retracePad: 0.5, recentSweepBars: 32, recentDisplacementBars: 16, displacementK: 1.25 },
};

const argv = process.argv.slice(2);
const only = argv.includes("--variants") ? argv[argv.indexOf("--variants") + 1].split(",") : null;

const rows = [];
for (const [name, gate] of Object.entries(VARIANTS)) {
  if (only && !only.some((k) => name.startsWith(k))) continue;
  setGate(gate);
  const t0 = Date.now();
  const all = [
    ...buildCases("MNQ", mnq, "ES", es, { maxNearMisses: 0 }),
    ...buildCases("ES", es, "MNQ", mnq, { maxNearMisses: 0 }),
  ];
  const t = tally(all);
  const decided = t.wins + t.losses + t.scratch;
  const wr = decided ? t.wins / decided : 0;
  const exp = decided ? t.sumR / decided : 0;
  const perBook = ["MNQ", "ES"].map((s) => {
    const tt = tally(all.filter((c) => c.symbol === s));
    return `${s} ${tt.takes}t ${tt.wins}W/${tt.losses}L ${tt.sumR >= 0 ? "+" : ""}${tt.sumR}R`;
  });
  rows.push({ name, takes: t.takes, wins: t.wins, losses: t.losses, scratch: t.scratch, unfilled: t.unfilled, sumR: t.sumR, wr, exp, secs: ((Date.now() - t0) / 1000).toFixed(0), perBook });
  console.log(
    `${name.padEnd(22)} takes ${String(t.takes).padStart(3)}  ${String(t.wins).padStart(2)}W ${String(t.losses).padStart(2)}L ${String(t.scratch).padStart(2)}S ${String(t.unfilled).padStart(2)}U  ΣR ${(t.sumR >= 0 ? "+" : "") + t.sumR.toFixed(2).padStart(7)}  WR ${(wr * 100).toFixed(0).padStart(3)}%  exp ${(exp >= 0 ? "+" : "") + exp.toFixed(2)}R/trade  · ${perBook.join(" · ")}  (${((Date.now() - t0) / 1000).toFixed(0)}s)`,
  );
}

setGate(ORIGINAL_GATE);

console.log("\nranked by expectancy with n≥6 decided:");
for (const r of rows
  .filter((r) => r.wins + r.losses + r.scratch >= 6)
  .sort((a, b) => b.exp - a.exp || b.sumR - a.sumR)) {
  console.log(`  ${r.name.padEnd(22)} exp ${(r.exp >= 0 ? "+" : "") + r.exp.toFixed(2)}R · ΣR ${(r.sumR >= 0 ? "+" : "") + r.sumR.toFixed(2)} · n=${r.wins + r.losses + r.scratch} · WR ${(r.wr * 100).toFixed(0)}%`);
}
