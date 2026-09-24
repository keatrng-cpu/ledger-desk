/**
 * Stop coherence, the override log, and ladder conflict.
 *
 * Each of these three exists because of a specific thing the desk measured
 * and then did nothing with, so each test here is really asking "does this
 * still say the honest thing":
 *   1. stop-coherence — the sleeve's −25% stop and the futures stop are in
 *      different units and have never been compared. On 0–2 DTE the stop can
 *      be reached by the clock alone, and the file must say CLOCK when it is.
 *   2. override-log — the sequence fires ~never while the trader wins live.
 *      The log must refuse to draw a conclusion at n=4, because four wins is
 *      four coin flips.
 *   3. ladder-conflict — tf_dir=against ran −0.69R/card but n=13. It must
 *      warn and halve size, and must NEVER refuse.
 *
 * Run: npx tsx scripts/verify-desk-enhancements.mjs
 */
const { coherence, minDteForHold, dailyDecayFrac } = await import("../src/lib/trading/stop-coherence.ts");
const { biasDisrespect } = await import("../src/lib/trading/htf-invalidation.ts");
const { scoreGap } = await import("../src/lib/trading/score-drivers.ts");
const { overrideScorecard, crossCheck, summarise, overridePrompt, MIN_N_FOR_READ } = await import(
  "../src/lib/trading/override-log.ts"
);
const { ladderConflict, conflictLedger, LADDER_EVIDENCE, GATE_N_REQUIRED } = await import(
  "../src/lib/trading/ladder-conflict.ts"
);

let pass = 0;
let fail = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : ` — got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`);
};
const ok = (name, cond) => check(name, !!cond, true);

console.log("\nstop coherence — do the two books agree where the trade is wrong?");
// The sleeve's actual shape: $150 debit, ~0.5 delta, 1 DTE, against an MNQ
// plan risking 60 points.
const day = coherence({ symbol: "MNQ", riskPts: 60, debitUsd: 150, delta: 0.5, dte: 1, holdHours: 4 });
check("1 DTE / 4h is tighter than the futures stop", day.verdict, "option-tighter");
check("the option stop is ~30 MNQ points", Math.round(day.optionStopPts), 30);
ok("ratio is about half the plan's stop", day.ratio > 0.45 && day.ratio < 0.55);
ok("decay already eats most of the stop", day.decayToStop > 0.5);
ok("the line is labelled an estimate", day.line.startsWith("ESTIMATE"));
ok("assumptions always travel with it", day.assumptions.length >= 3);

// Hold it all day on a 1 DTE and the stop stops being about price at all.
const clock = coherence({ symbol: "MNQ", riskPts: 60, debitUsd: 150, delta: 0.5, dte: 1, holdHours: 8 });
check("1 DTE held 8h is a CLOCK, not a level", clock.verdict, "clock");
ok("and it says so in those words", /CLOCK, not a level/.test(clock.line));

// More time restores price as the thing being risked.
const swing = coherence({ symbol: "MNQ", riskPts: 60, debitUsd: 4300, delta: 0.75, dte: 21, holdHours: 8 });
ok("a 21 DTE deep-ITM ticket is not a clock", swing.verdict !== "clock");
ok("decay is small at 21 DTE", swing.decayToStop < 0.1);

// A wider option stop than the plan's is the SAFE direction and says so.
const loose = coherence({ symbol: "MNQ", riskPts: 15, debitUsd: 150, delta: 0.5, dte: 7, holdHours: 4 });
check("a small plan stop makes the option stop looser", loose.verdict, "option-looser");
ok("and it tells you to sell on invalidation instead", /invalidation/.test(loose.line));

// Missing ticket data must produce an honest refusal, not a confident number.
const blind = coherence({ symbol: "MNQ", riskPts: 60, debitUsd: 0, delta: 0, dte: 1 });
check("unknown ticket yields no number", blind.optionStopPts, null);
ok("and asks for the actual DTE/delta/debit", /Log the actual/.test(blind.line));
check("an unknown symbol yields no number", coherence({ symbol: "ZZZ", riskPts: 60, debitUsd: 150, delta: 0.5, dte: 5 }).optionStopPts, null);

ok("decay at 1 DTE is total", dailyDecayFrac(1) === 1);
ok("decay at 30 DTE is small", dailyDecayFrac(30) < 0.02);
ok("a 4h hold needs at least 2 DTE", minDteForHold(4) >= 2);
ok("a longer hold needs at least as much time", minDteForHold(12) >= minDteForHold(4));

console.log("\noverride log — which gate was wrong, not whether overriding works");
const four = [
  { id: "1", at: "2026-09-08", symbol: "MNQ", side: "long", book: "options", missing: ["pd_half"], deskWord: "STAND", grade: "B+", resultR: 1.2, resultUsd: 28, reason: "draw was clean", ladderAgreed: true },
  { id: "2", at: "2026-09-10", symbol: "MNQ", side: "long", book: "options", missing: ["pd_half", "ltf"], deskWord: "STAND", grade: "B+", resultR: 0.9, resultUsd: 27, reason: "same read", ladderAgreed: true },
  { id: "3", at: "2026-09-15", symbol: "ES", side: "short", book: "options", missing: ["ltf"], deskWord: "WAIT", grade: "A-", resultR: 1.1, resultUsd: 30, reason: "raid then shift", ladderAgreed: true },
  { id: "4", at: "2026-09-17", symbol: "MNQ", side: "long", book: "options", missing: ["pd_half"], deskWord: "STAND", grade: "B+", resultR: 1.0, resultUsd: 28, reason: "draw", ladderAgreed: false },
];
const s4 = summarise(four);
check("four closed overrides", s4.closed, 4);
check("all four winners", s4.wins, 4);
ok("and it refuses to conclude anything", /coin flips/.test(s4.line));

const card = overrideScorecard(four);
const pd = card.find((r) => r.layer === "pd_half");
check("pd_half counted three times", pd.n, 3);
check("and is still too early to read", pd.verdict, "too-early");
ok("the row says so rather than implying a finding", /not evidence/.test(pd.line));
ok("every layer at n<12 is too-early", card.every((r) => r.n >= MIN_N_FOR_READ || r.verdict === "too-early"));

// With a real n the verdicts must actually fire, in both directions.
const many = (n, layer, r) =>
  Array.from({ length: n }, (_, i) => ({
    id: `${layer}-${i}`, at: "2026-01-01", symbol: "MNQ", side: "long", book: "futures",
    missing: [layer], deskWord: "STAND", grade: "B+", resultR: r, resultUsd: 0, reason: "x", ladderAgreed: true,
  }));
const paysRow = overrideScorecard(many(14, "pd_half", 0.8))[0];
check("a profitable override lane reads override-pays", paysRow.verdict, "override-pays");
ok("and routes the change through the sweep script", /sweep-gates/.test(paysRow.line));
const rightRow = overrideScorecard(many(14, "ltf", -0.6))[0];
check("a losing override lane says the gate was right", rightRow.verdict, "gate-was-right");
ok("and says the layer should be obeyed", /should be obeyed/.test(rightRow.line));
check("a flat lane is neutral", overrideScorecard(many(14, "dol", 0.02))[0].verdict, "neutral");

// The cross-check against the shadow book is the interesting output.
const agreeing = crossCheck(overrideScorecard(many(14, "pd_half", 0.8)), { pd_half: "costing" });
check("live and shadows agreeing is flagged as agreement", agreeing[0].agree, true);
const clashing = crossCheck(overrideScorecard(many(14, "pd_half", 0.8)), { pd_half: "earning" });
check("live and shadows clashing is flagged", clashing[0].agree, false);
ok("and forbids changing a gate on a disagreement", /Do not change a gate/.test(clashing[0].line));

check("an empty log says what it costs", summarise([]).closed, 0);
ok("and explains why the reason must be written first", /before the outcome is known/.test(summarise([]).line));
ok("the prompt demands the reason up front", /before you know how it ends/.test(overridePrompt(["pd_half"], "STAND")));
check("no missing layers means no prompt", overridePrompt([], "TAKE"), "");

console.log("\nladder conflict — warn and halve, never refuse");
const L = (direction, decidedBy = "1d") => ({ direction, decidedBy, reads: [], symbol: "MNQ" });
const agree = ladderConflict(L("bull"), "long");
check("agreement is agreement", agree.level, "agree");
check("and does not size up", agree.sizeMult, 1);
ok("and calls the +0.08R a small positive, not a reason to add", /not a reason to size up/.test(agree.line));

const clash = ladderConflict(L("bear", "1w"), "long");
check("disagreement is conflict", clash.level, "conflict");
check("suggested size is halved", clash.sizeMult, 0.5);
ok("it warns", clash.warn);
ok("it explicitly is NOT a refusal", /NOT a refusal/.test(clash.line));
ok("it names the n in the losing bucket", clash.line.includes(String(LADDER_EVIDENCE.againstN)));
ok("it names the rung that decided", clash.line.includes("1w"));
ok("size multiplier is never zero — this cannot refuse", ladderConflict(L("bear"), "long").sizeMult > 0);

check("a neutral ladder neither helps nor hurts", ladderConflict(L("neutral"), "long").level, "neutral");
check("no ladder is neutral", ladderConflict(null, "long").level, "neutral");
check("no ladder does not resize", ladderConflict(null, "long").sizeMult, 1);
check("a short against a bull ladder conflicts", ladderConflict(L("bull"), "short").level, "conflict");

const led = conflictLedger([]);
check("the ledger starts seeded from the shadow measurement", led.againstN, LADDER_EVIDENCE.againstN);
check("and is not yet gateable", led.gateable, false);
check("needing 27 more disagreements", led.needed, GATE_N_REQUIRED - LADDER_EVIDENCE.againstN);
ok("and it says so plainly", /more disagreements needed/.test(led.line));
const grown = conflictLedger(Array.from({ length: 30 }, () => ({ agreed: false, resultR: -0.5 })));
ok("enough live disagreements makes it gateable", grown.gateable);
ok("and still routes through the sweep script", /sweep-gates/.test(grown.line));


// ── The card headline: one line, not a paragraph ──────────────────────────
//
// The scanner printed `line` — five sentences — on EVERY card, so two shorts
// against a bull ladder showed the identical red paragraph twice. A wall of
// repeated red text is how a warning carrying a measured -0.69R/card gets
// tuned out, so the card now shows `headline` and keeps `line` on hover.
{
  const ladder = (direction, decidedBy = "1y") => ({ direction, decidedBy, reads: [] });
  const cases = [
    ["conflict", ladderConflict(ladder("bull"), "short")],
    ["agree", ladderConflict(ladder("bear"), "short")],
    ["neutral", ladderConflict(ladder("neutral"), "short")],
    ["absent", ladderConflict(null, "short")],
  ];
  for (const [name, c] of cases) {
    check(`${name}: has a headline`, typeof c.headline === "string" && c.headline.length > 0, true);
    check(`${name}: headline fits one line`, c.headline.length <= 130, true);
    check(`${name}: headline is shorter than the reasoning`, c.headline.length < c.line.length, true);
  }

  const warn = cases[0][1];
  // The three things the trader needs in the glance: the fact, the measured
  // cost, and the action.
  check("conflict headline names the ladder direction", /bull/.test(warn.headline), true);
  check("conflict headline carries the measurement", /-0\.69R/.test(warn.headline), true);
  check("conflict headline carries the sample size", /n=13/.test(warn.headline), true);
  check("conflict headline says what to do", /[Hh]alf size/.test(warn.headline), true);
  // And it must never read as a refusal — n=13 does not support one.
  check("conflict headline is not a refusal", /do not trade|refuse|blocked/i.test(warn.headline), false);
}

// ── The 2026-09-24 bounce: why the desk showed no sign ────────────────────
//
// QQQ ran ~$3 in ten minutes off the low. The desk was drawing MNQ SHORT and
// never suggested the other side. It was not a scoring failure — the scanner
// grades BOTH sides every poll — it was a VISIBILITY failure: the long was
// graded, refused on the absolute HTF gate, and then hidden entirely, because
// "Path grades only" drops anything non-actionable.
//
// The release needs four things. On a fast bounce two of them CANNOT be true
// yet: structure BOS and both LTF reads are computed from 15m swings and need
// several bars, so a ten-minute move confirms them only after it is over. The
// gate is built to catch a regime change, and by construction it is late to a
// quick reversal. That is correct behaviour for a GATE and useless as a
// SIGNAL — so the progress is now recorded and shown instead of discarded.
{
  const bear = { topDown: "bear", mid: "bear", ltf: "bear", lastBOS: { direction: "bear" } };
  const raidAndDisplace = {
    sweep: { latest: { index: 98, side: "sellside" } },
    displacement: { latest: { index: 99, direction: "bull" } },
  };

  const r = biasDisrespect(bear, raidAndDisplace, "bull", 100);
  check("the bounce does NOT release the gate", r.disrespected, false);
  check("but it is 2 of 4", r.checks.filter((c) => c.pass).length, 2);
  check("the raid counts", r.checks.find((c) => c.id === "manipulation").pass, true);
  check("the displacement counts", r.checks.find((c) => c.id === "distribution").pass, true);
  check("structure has not caught up", r.checks.find((c) => c.id === "structure").pass, false);
  check("nor have the LTF reads", r.checks.find((c) => c.id === "ltf").pass, false);
  check("and it names what is still missing", /Structure broken/.test(r.reason), true);

  // Nothing yet is NOT the same as two of four. The scanner shows the second
  // and not the first, so they have to be distinguishable.
  const quiet = biasDisrespect(
    bear,
    { sweep: { latest: null }, displacement: { latest: null } },
    "bull",
    100,
  );
  check("a quiet tape is 0 of 4", quiet.checks.filter((c) => c.pass).length, 0);

  // A lone sweep is one check. One is noise — sellside gets swept all
  // session — which is why the watch bar is two, not one.
  const sweepOnly = biasDisrespect(
    bear,
    { sweep: { latest: { index: 98, side: "sellside" } }, displacement: { latest: null } },
    "bull",
    100,
  );
  check("a lone raid is only 1 of 4", sweepOnly.checks.filter((c) => c.pass).length, 1);

  // The full signature still releases — the gate is unchanged.
  const flipped = { topDown: "bear", mid: "bull", ltf: "bull", lastBOS: { direction: "bull" } };
  const full = biasDisrespect(flipped, raidAndDisplace, "bull", 100);
  check("the full four still releases the gate", full.disrespected, true);
  check("and names the released direction", full.direction, "bull");

  // With-bias sides never claim release credit.
  check(
    "a with-bias side is not 'disrespected'",
    biasDisrespect(bear, raidAndDisplace, "bear", 100).checks.length,
    0,
  );
}

// ── scoreGap: why the number is where it is ───────────────────────────────
//
// "MNQ ran with a clean sweep, a priced target, a sensible stop and the HTF
// agreeing, and the score sat at 0.71 the whole way." Three facts explain it,
// and none of them was written down anywhere:
//   - the score grades FORMATION, not progress, so it cannot move because
//     price moves;
//   - structureQ is a ratio over ten keys and four of them (opening_bias,
//     weekly_pd, pd, cisd) are location facts, not trade-quality facts;
//   - a strategy that is neither complete nor near-complete is CLAMPED.
{
  const ALL = { htfOk: true, killzoneOk: true, conditionsOk: true };
  const clean = [
    "sweep_significant", "displacement", "structure", "mss",
    "mid_bias", "htf2_bias", "daily_bias", "ifvg",
  ];

  const cont = scoreGap("continuation", clean, ALL);
  check("a clean setup scores well on a fitting template", cont.now > 0.8, true);
  check("and there is still headroom", cont.ceiling > cont.now, true);
  check("not clamped when the template is complete", cont.clamped, false);
  check("the missing components are named", cont.wouldMove.length > 0, true);
  check("each would actually raise the score", cont.wouldMove.every((w) => w.worth > 0), true);

  // The point the trader needs: what is missing is not about the trade.
  const names = cont.wouldMove.map((w) => w.key);
  const contextKeys = ["pd", "weekly_pd", "opening_bias", "cisd"];
  check(
    "the gap is location/context keys, not trade-quality ones",
    names.some((k) => contextKeys.includes(k)),
    true,
  );
  check("and the line says exactly that", /does not move because price does/.test(cont.line), true);

  // THE CLAMP — the other way a score gets stuck.
  const mech = scoreGap("mechanical", clean, ALL);
  check("a template missing its must is clamped", mech.clamped, true);
  check("and floored under the action floor", mech.now < 0.65, true);
  check("the line names the clamp, not the components", /completeness clamp/.test(mech.line), true);
  check("the single missing must is worth a lot", mech.wouldMove[0].worth > 0.2, true);

  // Everything present => no headroom, said plainly rather than invented.
  const full = scoreGap(
    "continuation",
    [
      "sweep_significant", "displacement", "structure", "mss", "mid_bias",
      "htf2_bias", "daily_bias", "ifvg", "cisd", "weekly_pd", "pd",
      "opening_bias", "order_block", "smt", "mechanical_model", "ote",
    ],
    ALL,
  );
  check("at the ceiling the gap is ~0", full.gap < 0.01, true);
  check("and it says it is at the ceiling", /ceiling/.test(full.line), true);

  // Measured by DIFFERENCING the real engine, so it cannot drift from it.
  for (const w of cont.wouldMove) {
    const after = scoreGap("continuation", [...clean, w.key], ALL).now;
    check(
      `adding ${w.key} moves the score by its stated worth`,
      Math.abs(after - cont.now - w.worth) < 0.0015,
      true,
    );
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
