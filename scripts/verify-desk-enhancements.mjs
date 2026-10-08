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
  if (ok) pass++; else fail++;
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

console.log("\nladder conflict — warn on direction, never refuse, never resize");
// 2026-10-01: the four-year measurement (scripts/measure-tf-tiers.mjs) found
// cards against Tier 1 paid the same R as aligned ones (−0.139 vs −0.137,
// n=1617/1857) while moving their way less often (45.5% vs 52.4%). So the
// half size the n=13 shadow read justified is gone; the warning stays.
const L = (direction, decidedBy = "1d") => ({ direction, decidedBy, reads: [], symbol: "MNQ" });
const agree = ladderConflict(L("bull"), "long");
check("agreement is agreement", agree.level, "agree");
check("and does not size up", agree.sizeMult, 1);
ok("and says it is not a reason to size up", /not a reason to size up/.test(agree.line));

const clash = ladderConflict(L("bear", "1w"), "long");
check("disagreement is conflict", clash.level, "conflict");
check("no size cut — four years found no R cost", clash.sizeMult, 1);
ok("it warns", clash.warn);
ok("it explicitly is NOT a refusal", /NOT a refusal/.test(clash.line));
ok("it names the n in the disagreeing bucket", clash.line.includes(String(LADDER_EVIDENCE.againstN)));
ok("it names the rung that decided", clash.line.includes("1w"));
ok("it states the direction gap it warns about", clash.line.includes(String(LADDER_EVIDENCE.againstDirHit)) && clash.line.includes(String(LADDER_EVIDENCE.withDirHit)));
ok("the evidence is the four-year sample, not the n=13 shadow read", LADDER_EVIDENCE.againstN >= 1000);

check("a neutral ladder neither helps nor hurts", ladderConflict(L("neutral"), "long").level, "neutral");
check("no ladder is neutral", ladderConflict(null, "long").level, "neutral");
check("no ladder does not resize", ladderConflict(null, "long").sizeMult, 1);
check("a short against a bull ladder conflicts", ladderConflict(L("bull"), "short").level, "conflict");

const led = conflictLedger([]);
check("the ledger starts seeded from the four-year measurement", led.againstN, LADDER_EVIDENCE.againstN);
check("past the observation floor", led.needed, 0);
check("but not gateable — the sides do not separate in R", led.gateable, false);
ok("and it says so plainly", /no separation/.test(led.line));
const grown = conflictLedger(Array.from({ length: 30 }, () => ({ agreed: false, resultR: -0.5 })));
check("thirty live losses do not outweigh four years", grown.gateable, false);
const decisive = conflictLedger(Array.from({ length: 3000 }, () => ({ agreed: false, resultR: -1 })));
ok("a decisive live record that separates becomes arguable", decisive.gateable);
ok("and still routes through the sweep script", /sweep-gates/.test(decisive.line));
const fresh = conflictLedger([], false);
ok("an unseeded ledger still needs the floor first", fresh.needed === GATE_N_REQUIRED && !fresh.gateable);


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
  check("conflict headline carries the measurement", warn.headline.includes(`${LADDER_EVIDENCE.againstDirHit}%`), true);
  check("conflict headline carries the sample size", warn.headline.includes(`n=${LADDER_EVIDENCE.againstN}`), true);
  check("conflict headline says what to do", /look again/i.test(warn.headline), true);
  // And it must never read as a refusal or a size cut — four years support neither.
  check("conflict headline is not a refusal", /do not trade|refuse|blocked/i.test(warn.headline), false);
  check("conflict headline does not cut size", /half size/i.test(warn.headline), false);
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

console.log("\nscanner vetoes survive into the final candidate — the engine, not the helper");
{
  /**
   * Found 2026-09-30: the with-bias fade veto and (new, same day) the
   * inducement veto both mutate a candidate's actionable/confluence/grade/
   * pathBand INSIDE scanner.ts. `applyProfitPathToCandidate` runs
   * immediately after and recomputes all four of those fields from
   * components/htfOk/killzoneOk/conditionsOk alone — it never reads the
   * candidate's incoming value of any of them. So a veto applied BEFORE
   * that call is silently discarded, every time, and nothing above (which
   * unit-tests biasDisrespect() and scoreGap() directly, not this survival
   * property) would ever have caught it. This differential check runs the
   * real scanSetups() — the same function the desk calls — against real
   * bars, and confirms both vetoes' effects are still present on the
   * candidate that comes out the other end.
   */
  const { analyzeStructure, smtDivergenceStack } = await import("../src/lib/trading/structure.ts");
  const { scanSetups } = await import("../src/lib/trading/scanner.ts");
  const { buildSmcTape } = await import("../src/lib/trading/smc-board.ts");
  const { detectInducement, detectMitigationBlock } = await import("../src/lib/trading/detectors.ts");
  const { getSessionClock } = await import("../src/lib/trading/sessions.ts");
  const { readFileSync, existsSync } = await import("node:fs");

  if (!existsSync("src/data/history-4y.json")) {
    console.log("  skip — src/data/history-4y.json missing; run capture-history.mjs");
  } else {
    const H = JSON.parse(readFileSync("src/data/history-4y.json", "utf8"));
    const MNQ = H.bars.MNQ ?? [];
    const ES = H.bars.ES ?? [];

    function scanAt(i) {
      const slice = MNQ.slice(Math.max(0, i - 799), i + 1);
      let pi = 0;
      while (pi < ES.length && ES[pi].t <= MNQ[i].t) pi++;
      const peer = ES.slice(Math.max(0, pi - 800), pi);
      if (slice.length < 200 || peer.length < 200) return null;
      const clock = getSessionClock(new Date(MNQ[i].t));
      const biasL = analyzeStructure("MNQ", slice, 0);
      const biasR = analyzeStructure("ES", peer, 0);
      const smtStack = smtDivergenceStack(slice, peer);
      const smc = { left: buildSmcTape(slice), right: buildSmcTape(peer) };
      const scan = scanSetups(biasL, biasR, clock, smtStack.primary, slice, peer, smc);
      return { scan, biasL, biasR, slice, peer };
    }

    let withBiasChecked = 0;
    let inducementChecked = 0;
    let mitigationChecked = 0;
    // Every 11th bar, not every bar: this is the same cost trade-off
    // verify-session-event.mjs makes on the same 93,830-bar tape — a sample
    // large enough to hit real instances of both conditions, cheap enough to
    // run inside the normal pre-push budget.
    for (let i = 900; i < MNQ.length; i += 11) {
      const r = scanAt(i);
      if (!r) continue;
      for (const c of r.scan.candidates) {
        const isLeft = c.symbol === r.biasL.symbol;
        const bias = isLeft ? r.biasL : r.biasR;
        const bars = isLeft ? r.slice : r.peer;
        const need = c.side === "long" ? "bull" : "bear";

        // With-bias fade condition, computed independently here the same
        // way scanner.ts computes it — never by reading scanner.ts's own
        // intermediate state, or this could pass by construction.
        const session = bias.sessionStance ?? "neutral";
        const strong = (bias.sessionStrength ?? 0) >= 0.28;
        if (strong && session !== "neutral" && session !== need) {
          withBiasChecked++;
          ok(
            `with-bias fade: ${c.symbol} ${c.side} @ bar ${i} is a note, not a refusal`,
            !c.missing.includes("LTF delivery against") &&
              !(c.vetoes ?? []).some((v) => v.startsWith("LTF delivery")) &&
              c.reasons.some((r) => r.startsWith("LTF delivery against")),
          );
        }

        // Inducement condition, likewise computed independently.
        const ind = detectInducement(bars, c.side === "short" ? "short" : "long");
        if (ind.inducement) {
          inducementChecked++;
          ok(
            `inducement: ${c.symbol} ${c.side} @ bar ${i} is a note, not a refusal`,
            !c.missing.some((m) => m.startsWith("inducement")) &&
              !(c.vetoes ?? []).some((v) => v.startsWith("inducement")) &&
              c.reasons.some((r) => r.startsWith("inducement")),
          );
        }

        // Mitigation condition (added 2026-09-30 alongside the fixed dead
        // "mitigation" component), likewise computed independently.
        const mit = detectMitigationBlock(bars, c.side === "short" ? "short" : "long");
        if (mit.present) {
          mitigationChecked++;
          ok(
            `mitigation: ${c.symbol} ${c.side} @ bar ${i} is a note, not a refusal`,
            !c.missing.some((m) => m.startsWith("mitigation block")) &&
              !(c.vetoes ?? []).some((v) => v.startsWith("mitigation")) &&
              c.reasons.some((r) => r.startsWith("mitigation block")),
          );
        }
      }
      if (withBiasChecked >= 12 && inducementChecked >= 12 && mitigationChecked >= 12) break;
    }

    // Prove these were real hits, not a loop that never found its condition
    // — the exact failure mode that would make every check above pass
    // vacuously and mean nothing.
    ok(`found real with-bias-fade instances to test (${withBiasChecked})`, withBiasChecked > 0);
    ok(`found real inducement instances to test (${inducementChecked})`, inducementChecked > 0);
    ok(`found real mitigation instances to test (${mitigationChecked})`, mitigationChecked > 0);
  }
}

/* ================================================================== */
/* Wave 2 — the Wave-1 detectors, WIRED. Differential, real engine.    */
/* ================================================================== */
console.log("\nitem 6 — the mechanical window is wall-clock, not a flat bar count");
{
  /**
   * `pairedDisplacement` used the flat `MM_DISPLACE_WITHIN` (6), which is a
   * handful of candles on 5m and NINETY MINUTES on the 15m series the desk
   * grades. `mechanicalWindowBars` takes the minimum of 30 wall-clock minutes
   * and that 6, so no series gets a LOOSER window than before.
   *
   * NEGATIVE CONTROL: put `MM_DISPLACE_WITHIN` back in `pairedDisplacement`
   * and "the 15m window tightened" fails (it reads 6).
   */
  const { mechanicalWindowBars, MM_DISPLACE_WITHIN, MM_DISPLACE_WITHIN_MINUTES, MM_WINDOW } =
    await import("../src/lib/trading/detectors.ts");
  const series = (stepMin, n = 40) =>
    Array.from({ length: n }, (_, i) => ({ t: i * stepMin * 60000, o: 1, h: 2, l: 0, c: 1, v: 1 }));

  check("on 15m the window is 2 bars, not 6", mechanicalWindowBars(series(15)), 2);
  check("on 5m it is the original handful", mechanicalWindowBars(series(5)), 6);
  check("on 1m it is capped by the bar count, never looser", mechanicalWindowBars(series(1)), MM_DISPLACE_WITHIN);
  check("on 30m it is one bar, never zero", mechanicalWindowBars(series(30)), 1);
  check("an unreadable spacing falls back to today's behaviour", mechanicalWindowBars([]), MM_DISPLACE_WITHIN);
  check("the minutes figure is the trader's 30", MM_DISPLACE_WITHIN_MINUTES, 30);
  ok("no series is ever given a LOOSER window", [1, 2, 3, 5, 15, 30, 60].every((m) => mechanicalWindowBars(series(m)) <= MM_DISPLACE_WITHIN));
  check("the mode is minutes", MM_WINDOW.mode, "minutes");

  // And it is the window `pairedDisplacement` actually uses now.
  const { readFileSync } = await import("node:fs");
  const src = readFileSync("src/lib/trading/raid-pair.ts", "utf8");
  const fn = src.slice(src.indexOf("export function pairedDisplacement"), src.indexOf("export function displacementLeftArray"));
  ok("the 15m window tightened — pairedDisplacement reads the helper", /mechanicalWindowBars\(bars\)/.test(fn));
  ok("and no longer the flat bar count", !/MM_DISPLACE_WITHIN/.test(fn));
}

console.log("\nitem 5 — the gap rule is reported, and the DEFAULT IS NOT FLIPPED");
{
  /**
   * The gap rule measures 1.70x today's displacement rate and overlaps today's
   * events on 16% of a 10,840 union — a different detector, not a tweak, and
   * nothing in this repo compares the three on the four-year capture. So the
   * default stays "body" and the evidence is carried on the card instead.
   *
   * NEGATIVE CONTROL: set `DISPLACEMENT_RULE.rule = "gap"` in detectors.ts and
   * "the shipped default is still the body test" fails.
   */
  const { DISPLACEMENT_RULE, detectDisplacements } = await import("../src/lib/trading/detectors.ts");
  check("the shipped default is still the body test", DISPLACEMENT_RULE.rule, "body");

  const { readFileSync, existsSync } = await import("node:fs");
  if (!existsSync("src/data/history-4y.json")) {
    console.log("  skip — src/data/history-4y.json missing");
  } else {
    const H = JSON.parse(readFileSync("src/data/history-4y.json", "utf8"));
    const MNQ = (H.bars.MNQ ?? []).slice(0, 4000);
    const evs = detectDisplacements(MNQ);
    ok(`real displacements found (${evs.length})`, evs.length > 20);
    ok("every event says which test it satisfied", evs.every((d) => d.qualifiedBy === "body" || d.qualifiedBy === "gap" || d.qualifiedBy === "both"));
    ok("under the body rule every event passed the body test", evs.every((d) => d.bodyQualified));
    ok("gapHeld is false whenever there is no gap", evs.every((d) => d.gap != null || d.gapHeld === false));
    // The whole point of carrying it: body and gap genuinely disagree, so the
    // census has something to decide with.
    const withGap = evs.filter((d) => d.gap != null).length;
    const held = evs.filter((d) => d.gapHeld).length;
    ok(`body-qualified events that also left a gap (${withGap}/${evs.length})`, withGap > 0 && withGap < evs.length);
    ok(`...and whose gap still holds (${held})`, held >= 0);
  }
}

console.log("\nitem 7 — the finer tape's verdict is THREE-state, and no_tape is not a no");
{
  /**
   * "no_tape" means the question was not answered. Collapsed to true it arms
   * unverified raids; collapsed to false it shuts the desk off every time the
   * gateway is down and in every backtest — which would look like a quiet
   * session, not a blind one.
   *
   * NEGATIVE CONTROL: change the breakout branch in scanner.ts to also fire on
   * "no_tape" and "a blind tape does not refuse" fails on real tape.
   */
  const { confirmSweepOnTape, detectSweeps } = await import("../src/lib/trading/detectors.ts");
  const { readFileSync, existsSync } = await import("node:fs");

  if (!existsSync("src/data/history-4y.json")) {
    console.log("  skip — src/data/history-4y.json missing");
  } else {
    const H = JSON.parse(readFileSync("src/data/history-4y.json", "utf8"));
    const MNQ = (H.bars.MNQ ?? []).slice(0, 3000);
    const sweeps = detectSweeps(MNQ);
    ok(`real sweeps found (${sweeps.length})`, sweeps.length > 5);
    const noTape = sweeps.map((s) => confirmSweepOnTape(s, MNQ, null));
    ok("with no finer tape every verdict is no_tape", noTape.every((r) => r.verdict === "no_tape"));
    ok("and NONE of them reads as confirmed", noTape.every((r) => r.verdict !== "confirmed"));
    ok("the reason says the question could not be answered", /cannot be told from a breakout/.test(noTape[0].reason));

    // The scanner's own wiring: only `breakout` may remove a take.
    const scannerSrc = readFileSync("src/lib/trading/scanner.ts", "utf8");
    const block = scannerSrc.slice(
      scannerSrc.indexOf("ITEM 7 — A BREAKOUT ON THE FINER TAPE IS NOT A RAID"),
      scannerSrc.indexOf("ITEM 21 — A LATE TAPE CANNOT ARM"),
    );
    // The CODE ONLY. The slice starts INSIDE the doc comment, so drop
    // everything up to its terminator before stripping the rest — otherwise
    // the comment's own mention of no_tape answers the question for us.
    const code = block
      .slice(block.indexOf("*/") + 2)
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");
    ok("the refusal fires on breakout only", /verdict !== "breakout"/.test(code));
    ok("a blind tape does not refuse — no_tape never reaches actionable", !/no_tape/.test(code));
    ok("and the refusal is applied AFTER the path pass, where it is the last word", /for \(const c of pathCandidates\)/.test(code));
  }
}

console.log("\nitem 12 — the arming read is a FLAG, never a refusal");
{
  /**
   * `readArmingSweep` refuses 12.1% MNQ / 9.2% ES of same-polarity sweeps with
   * zero measurement behind it, and the 2026-09-21 precedent (18 gate
   * variants, 0 takes) shows how invisible that failure mode is.
   *
   * NEGATIVE CONTROL: make `polaritySweep` return `read.armingSweep`, or push
   * the arming reason into `missing`, and "an inducement-only raid still arms"
   * fails on real tape.
   */
  const { readArmingSweep } = await import("../src/lib/trading/detectors.ts");
  const { readFileSync, existsSync } = await import("node:fs");
  const raidPairSrc = readFileSync("src/lib/trading/raid-pair.ts", "utf8");
  ok("raid-pair does not import the arming read", !/readArmingSweep/.test(raidPairSrc.split("export function polaritySweep")[0].replace(/\/\*[\s\S]*?\*\//g, "")));

  if (!existsSync("src/data/history-4y.json")) {
    console.log("  skip — src/data/history-4y.json missing");
  } else {
    const { analyzeStructure, smtDivergenceStack } = await import("../src/lib/trading/structure.ts");
    const { scanSetups } = await import("../src/lib/trading/scanner.ts");
    const { buildSmcTape } = await import("../src/lib/trading/smc-board.ts");
    const { getSessionClock } = await import("../src/lib/trading/sessions.ts");
    const H = JSON.parse(readFileSync("src/data/history-4y.json", "utf8"));
    const MNQ = H.bars.MNQ ?? [];
    const ES = H.bars.ES ?? [];

    let armChecked = 0;
    let pi = 0;
    for (let i = 900; i < MNQ.length && armChecked < 10; i += 23) {
      while (pi < ES.length && ES[pi].t <= MNQ[i].t) pi++;
      const slice = MNQ.slice(Math.max(0, i - 799), i + 1);
      const peer = ES.slice(Math.max(0, pi - 800), pi);
      if (slice.length < 200 || peer.length < 200) continue;
      const clock = getSessionClock(new Date(MNQ[i].t));
      const biasL = analyzeStructure("MNQ", slice, 0);
      const biasR = analyzeStructure("ES", peer, 0);
      const smtStack = smtDivergenceStack(slice, peer);
      const smc = { left: buildSmcTape(slice), right: buildSmcTape(peer) };
      const sc = scanSetups(biasL, biasR, clock, smtStack.primary, slice, peer, smc, undefined, {
        left: slice,
        right: peer,
      });
      for (const c of sc.candidates) {
        const bars = c.symbol === "MNQ" ? slice : peer;
        const read = readArmingSweep(bars, c.side);
        if (!read.inducementOnly) continue;
        armChecked++;
        ok(
          `an inducement-only raid still arms: ${c.symbol} ${c.side} @ bar ${i}`,
          !c.missing.some((m) => /arming|inducement-only|unswept/i.test(m)) &&
            !(c.vetoes ?? []).some((v) => /arming/i.test(v)) &&
            c.arming?.inducementOnly === true &&
            c.reasons.some((r) => r.startsWith("arming:")),
        );
      }
    }
    ok(`found real inducement-only raids to test (${armChecked})`, armChecked > 0);
  }
}

console.log("\nitem 21 — the FORMING bar cannot create a sweep, a gap or a displacement");
{
  /**
   * `closedL`/`closedR` were computed in build-desk and never passed, so every
   * sweep, gap and displacement on the board was read off a bar with the live
   * print patched onto it. The differential below is the phantom the trader
   * described: closed bars quiet, and the FORMING bar alone wicking the prior
   * low and closing 2+ ATR down.
   *
   * NEGATIVE CONTROL: change `const cb = closed && closed.length ? closed :
   * bars` in scanner.ts to `const cb = bars` and "the phantom bar creates no
   * raid" fails.
   */
  const { scanSetups } = await import("../src/lib/trading/scanner.ts");
  const { analyzeStructure } = await import("../src/lib/trading/structure.ts");
  const { getSessionClock } = await import("../src/lib/trading/sessions.ts");
  const { tapeTrust, TAPE_MAX_BARS_BEHIND } = await import("../src/lib/market/tape-trust.ts");

  /*
   * A quiet closed series with ONE RECENT swing low, then the phantom.
   *
   * The swing low sits 10 bars from the end so it is inside
   * `GATE.recentSweepBars`; the phantom wicks under it and CLOSES BACK INSIDE,
   * which is the textbook sellside raid — precisely the thing a forming bar
   * must not be able to manufacture out of one live tick. Its lower wick is
   * also two thirds of its range, so it reads as a rejection block too.
   *
   * A first attempt put the swing low 40 bars back: the sweep was then too old
   * for `GATE.recentSweepBars`, `polaritySweep` returned null, and the fixture
   * produced no raid in EITHER series — a control that would have passed
   * vacuously. Hence the explicit "really does create structure" check.
   */
  const STEP = 900000;
  const t0 = Date.UTC(2026, 9, 7, 13, 30);
  const DIP_AT = 210;
  /*
   * Lows descend GRADUALLY to index 210, then rise. That matters: with
   * strictly falling lows no bar can sweep, because a sweep needs a prior
   * fractal swing LOW to wick through and a monotone descent has none. So
   * index 210 is the only swing low in the series and nothing in the series
   * has taken it. Highs mirror the shape, so there is no swing HIGH either
   * and no buyside sweep to confuse the differential.
   */
  const quiet = Array.from({ length: 220 }, (_, i) => {
    const low = i <= DIP_AT ? 24000 - i * 0.3 : 24000 - DIP_AT * 0.3 + (i - DIP_AT) * 3;
    return { t: t0 + i * STEP, o: low + 6, h: low + 16, l: low, c: low + 10, v: 1000 };
  });
  const poolLow = quiet[DIP_AT].l;
  // Wick 7 points under the only unswept pool, body back inside it. Lower wick
  // is over half the range, so it reads as a rejection block as well.
  const phantom = {
    t: t0 + 220 * STEP,
    o: poolLow + 23,
    h: poolLow + 29,
    l: poolLow - 7,
    c: poolLow + 13,
    v: 5000,
  };
  const withPhantom = [...quiet, phantom];

  // A live NY AM clock, so the dead-hour block is not what refuses here.
  const clock = getSessionClock(new Date(Date.UTC(2026, 9, 7, 14, 15)));
  const run = (bars, closed) =>
    scanSetups(
      analyzeStructure("MNQ", bars, 0),
      analyzeStructure("ES", bars, 0),
      clock,
      undefined,
      bars,
      bars,
      undefined,
      undefined,
      closed ? { left: closed, right: closed } : undefined,
    );

  const phantomCards = run(withPhantom, null).candidates;
  const closedCards = run(withPhantom, quiet).candidates;
  const comps = (cards) => new Set(cards.flatMap((c) => c.components));
  const phantomComps = comps(phantomCards);
  const closedComps = comps(closedCards);

  // Proof the fixture is real: the phantom bar DOES create a raid when it is
  // read as closed. Without this the next check could pass vacuously.
  const SIGNS = ["sweep_significant", "displacement", "cisd", "mss", "rejection"];
  ok(
    `the phantom bar really does create structure when read (${SIGNS.filter((k) => phantomComps.has(k)).join(",") || "none"})`,
    phantomComps.has("sweep_significant"),
  );
  ok(
    "the phantom bar creates no raid once it is excluded",
    !closedComps.has("sweep_significant"),
  );
  ok(
    "and the phantom's rejection wick is gone with it",
    !closedComps.has("rejection") || !phantomComps.has("rejection"),
  );
  ok(
    "detection genuinely differs between the two series",
    JSON.stringify([...phantomComps].sort()) !== JSON.stringify([...closedComps].sort()),
  );
  // Second control from the plan: once the SAME bar has genuinely closed it
  // must detect. Nothing here may become "the last bar never counts".
  const genuinelyClosed = run(withPhantom, withPhantom).candidates;
  ok(
    "the same bar, genuinely closed, still detects",
    JSON.stringify([...comps(genuinelyClosed)].sort()) === JSON.stringify([...phantomComps].sort()),
  );
  // Omitting `closed` is exactly today's behaviour.
  ok(
    "a caller that passes nothing behaves exactly as before",
    JSON.stringify(run(withPhantom, null).candidates.map((c) => c.components)) ===
      JSON.stringify(run(withPhantom, undefined).candidates.map((c) => c.components)),
  );

  // The freshness half: more than one closed bar behind and the card waits.
  check("the tolerance is the trader's one bar", TAPE_MAX_BARS_BEHIND, 1);
  const fresh = tapeTrust(quiet, { nowMs: quiet[quiet.length - 1].t + STEP + 1000, interval: "15m" });
  ok("a series on the bar that just closed is current", fresh.ok);
  const late = tapeTrust(quiet, { nowMs: quiet[quiet.length - 1].t + STEP * 4, interval: "15m" });
  ok("three buckets behind cannot arm", !late.ok);
  ok("and says so in one sentence", /TAPE LATE/.test(late.reason));
  const lagged = tapeTrust(quiet, { nowMs: quiet[quiet.length - 1].t + STEP + 1000, interval: "15m", lagSec: 3000 });
  ok("a fresh-looking series on a quiet feed still refuses", !lagged.ok);
  ok("synthetic never arms", !tapeTrust(quiet, { nowMs: quiet[quiet.length - 1].t + STEP, interval: "15m", source: "synthetic" }).ok);

  // The gate reaches the real candidate, AFTER the path pass. Same survival
  // property the vetoes above are tested for.
  const gated = scanSetups(
    analyzeStructure("MNQ", quiet, 0),
    analyzeStructure("ES", quiet, 0),
    clock,
    undefined,
    quiet,
    quiet,
    undefined,
    undefined,
    { left: quiet, right: quiet },
    { nowMs: quiet[quiet.length - 1].t + STEP * 6, interval: "15m" },
  );
  ok("a late tape stands every card down on the way out", gated.candidates.every((c) => !c.actionable));
  ok("and the reason is on the card", gated.candidates.every((c) => c.missing.some((m) => /TAPE LATE/.test(m))));
  // Declined on purpose: the 120 s quote gate is untouched.
  const { QUOTE_EXECUTION_MAX_LAG_SEC } = await import("../src/lib/market/types.ts");
  check("QUOTE_EXECUTION_MAX_LAG_SEC is still 120 — the relaxation was declined", QUOTE_EXECUTION_MAX_LAG_SEC, 120);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
