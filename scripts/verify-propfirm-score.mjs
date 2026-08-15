/**
 * Synthetic verification for propfirm/score.ts.
 *
 * Uses FICTIONAL rule rows on purpose — this proves the constraint logic is
 * correct independently of any firm's real numbers, so that when a real cited
 * row lands in rules.ts the only thing being trusted is the citation, not the
 * arithmetic.
 *
 * Run: npx tsx scripts/verify-propfirm-score.mjs
 */

const { scorePropTrade, MAX_ROOM_FRACTION_PER_TRADE, MAX_STATE_AGE_HOURS } =
  await import("../src/lib/propfirm/score.ts");
const { derivePropAccount } = await import("../src/lib/propfirm/account.ts");

let pass = 0;
let fail = 0;
function check(label, actual, expected) {
  if (actual === expected) {
    pass++;
    console.log(`  ok: ${label}`);
  } else {
    fail++;
    console.error(`  FAIL: ${label} — expected ${expected}, got ${actual}`);
  }
}

// --- Fictional product: $50k, $2,500 trail, intraday, target $3,000.
const RULES = {
  firm: "TestFirm",
  phase: "evaluation",
  sizeUsd: 50_000,
  product: "TEST 50k",
  trailUsd: 2_500,
  trailIncludesUnrealized: true,
  trailStopsAtProfitUsd: null,
  profitTargetUsd: 3_000,
  payoutFloorUsd: null,
  maxContracts: 10,
  maxMicroContracts: 100,
  minTradingDays: 7,
  maxSingleDayShare: 0.3,
  dailyLossLimitUsd: null,
  source: "fictional — verification only",
  confirmedOn: "n/a",
  caveats: [],
};

function state(over = {}) {
  return {
    phase: "evaluation",
    sizeUsd: 50_000,
    balanceUsd: 50_000,
    peakUsd: 50_000,
    daysTraded: 10,
    history: [],
    updatedAt: Date.now(),
    ...over,
  };
}

/** MNQ pointValue = 2, so 10pt risk = $20/contract. */
const TRADE = {
  symbol: "MNQ",
  riskPts: 10,
  discretionaryContracts: 50,
  rMultiple: 2,
};

function run(st, rules = RULES, trade = TRADE, ageHours = 0) {
  return scorePropTrade({
    trade,
    rules,
    state: st,
    derived: derivePropAccount(st, rules),
    stateAgeHours: ageHours,
  });
}

console.log("=== Sizing is bound by TRAIL ROOM, not equity ===");
{
  // Fresh account: balance 50k, peak 50k -> room = 50000 - 47500 = 2500.
  // Budget = 2500 * 0.2 = 500. At $20/contract -> 25 contracts.
  const v = run(state());
  check("eligible", v.eligible, true);
  check("sized by room (500/20)", v.contracts, 25);
  check("limitedBy", v.limitedBy, "trail-room");
  check("risk = 25 * 20", v.riskUsd, 500);
}

console.log("=== Same balance, HIGHER peak -> less room -> smaller size ===");
{
  // Peak 51k -> threshold 48.5k -> room = 50000-48500 = 1500.
  // Budget 300 -> 15 contracts. Identical balance, half the size.
  const v = run(state({ peakUsd: 51_000 }));
  check("room shrank size to 15", v.contracts, 15);
  check("still trail-room bound", v.limitedBy, "trail-room");
}

console.log("=== Firm contract cap can bind before room ===");
{
  // Big room, tiny per-contract risk -> cap at maxMicroContracts (100).
  const v = run(
    state({ balanceUsd: 60_000, peakUsd: 60_000 }),
    RULES,
    { ...TRADE, riskPts: 1, discretionaryContracts: 500 },
  );
  check("capped at micro limit", v.contracts, 100);
  check("limitedBy max-contracts", v.limitedBy, "max-contracts");
}

console.log("=== Prop layer NEVER sizes above what the setup earned ===");
{
  const v = run(state(), RULES, { ...TRADE, discretionaryContracts: 3 });
  check("capped by discretionary", v.contracts, 3);
  check("limitedBy discretionary", v.limitedBy, "discretionary");
}

console.log("=== Near the target, size DOWN to finish rather than maximise ===");
{
  // balance 52,900 -> $100 still needed. At 2R on $20/contract = $40/contract,
  // 3 contracts covers it, far below the room cap.
  const v = run(state({ balanceUsd: 52_900, peakUsd: 52_900 }));
  check("sized to finish", v.contracts, 3);
  check("limitedBy target-proximity", v.limitedBy, "target-proximity");
  check(
    "explains itself",
    v.warnings.some((w) => w.includes("Sized to finish")),
    true,
  );
}

console.log("=== Intraday trail earns an explicit give-back warning ===");
{
  const v = run(state());
  check(
    "warns about unrealized peak moving threshold",
    v.warnings.some((w) => w.includes("permanently")),
    true,
  );
  const noTrail = run(state(), { ...RULES, trailIncludesUnrealized: false });
  check(
    "no such warning when trail is closed-balance only",
    noTrail.warnings.some((w) => w.includes("permanently")),
    false,
  );
}

console.log("=== Consistency rule: winning too fast is flagged ===");
{
  // profit 2000, best day 1500 = 75% > 30% cap.
  const v = run(
    state({
      balanceUsd: 52_000,
      peakUsd: 52_000,
      history: [{ day: "2026-08-14", pnlUsd: 1_500 }],
    }),
  );
  check(
    "flags an already-breached consistency share",
    v.warnings.some((w) => w.includes("Consistency rule already breached")),
    true,
  );
}

console.log("=== HARD REFUSALS ===");
{
  check("no rules -> refuse", run(state(), null).eligible, false);
  check("phase none -> refuse", run(state({ phase: "none" })).eligible, false);
  check(
    "zero balance -> refuse",
    run(state({ balanceUsd: 0 })).eligible,
    false,
  );
  check(
    "peak below balance (typo) -> refuse",
    run(state({ balanceUsd: 55_000, peakUsd: 50_000 })).eligible,
    false,
  );
  check(
    "stale state -> refuse",
    run(state(), RULES, TRADE, MAX_STATE_AGE_HOURS + 1).eligible,
    false,
  );
  check(
    "never-entered state -> refuse",
    run(state(), RULES, TRADE, Infinity).eligible,
    false,
  );
}

console.log("=== Balance at/below threshold -> refuse, never size ===");
{
  // peak 53k -> threshold 50.5k; balance 50k is BELOW it.
  const v = run(state({ balanceUsd: 50_000, peakUsd: 53_000 }));
  check("refused", v.eligible, false);
  check("zero contracts", v.contracts, 0);
  check(
    "says the account is on the line",
    v.blockers.some((b) => b.includes("threshold")),
    true,
  );
}

console.log("=== Room too thin to trade -> refuse rather than trickle ===");
{
  // peak 52,300 -> threshold 49,800; balance 50,100 -> room 300.
  // Floor is 2500 * 0.15 = 375, so 300 is below it.
  const v = run(state({ balanceUsd: 50_100, peakUsd: 52_300 }));
  check("refused on thin room", v.eligible, false);
  check(
    "names the floor",
    v.blockers.some((b) => b.includes("Too thin")),
    true,
  );
}

console.log("=== Cannot afford one contract -> refuse, not round up to 1 ===");
{
  // Deliberately contrasts with sizeContracts(), which floors at 1.
  // room 2500 -> budget 500; one contract at 400pt risk = $800 > 500.
  const v = run(state(), RULES, { ...TRADE, riskPts: 400 });
  check("refused", v.eligible, false);
  check("did NOT round up to 1", v.contracts, 0);
}

console.log("=== Daily loss limit is respected when the firm sets one ===");
{
  const withLimit = { ...RULES, dailyLossLimitUsd: 300 };
  // Already down 200 today -> only 100 left; 25 contracts risks 500.
  const v = run(
    state({ history: [{ day: "2026-08-15", pnlUsd: -200 }] }),
    withLimit,
  );
  check("refused against remaining daily limit", v.eligible, false);
}

console.log("=== Minimum trading days is surfaced, not silently ignored ===");
{
  const v = run(state({ daysTraded: 2 }));
  check(
    "warns days remaining",
    v.warnings.some((w) => w.includes("more trading day")),
    true,
  );
}

console.log("=== House ceiling: risk never exceeds the room fraction ===");
{
  for (const peak of [50_000, 50_500, 51_000, 51_800]) {
    const v = run(state({ peakUsd: peak }));
    if (!v.eligible) continue;
    const ok = v.roomAtRiskShare <= MAX_ROOM_FRACTION_PER_TRADE + 1e-9;
    check(`peak ${peak}: room-at-risk within ceiling`, ok, true);
  }
}

console.log("=== REAL Apex row: sanity-check the shipped numbers ===");
{
  const { rulesFor } = await import("../src/lib/propfirm/rules.ts");
  const evalRules = rulesFor("Apex", "evaluation", 50_000);
  check("Apex 50k eval row exists", evalRules != null, true);
  check("trail is the CURRENT $2,000, not legacy $2,500", evalRules.trailUsd, 2_000);
  check("profit target $3,000", evalRules.profitTargetUsd, 3_000);
  check("micro cap 60", evalRules.maxMicroContracts, 60);
  check("no consistency rule during eval", evalRules.maxSingleDayShare, null);
  check("no daily loss limit on intraday eval", evalRules.dailyLossLimitUsd, null);
  check("trail never stops on Tradovate eval", evalRules.trailStopsAtProfitUsd, null);
  check("peak includes unrealized", evalRules.trailIncludesUnrealized, true);

  // Fresh 50k: threshold 48,000 -> room 2,000 -> budget 400 -> MNQ @ $20/ct = 20.
  const fresh = state();
  const v = scorePropTrade({
    trade: TRADE,
    rules: evalRules,
    state: fresh,
    derived: derivePropAccount(fresh, evalRules),
    stateAgeHours: 0,
  });
  check("fresh account sizes to 20 MNQ", v.contracts, 20);
  check("risk $400 of $2,000 room", v.riskUsd, 400);
  check("needs $3,000 to pass", derivePropAccount(fresh, evalRules).toGoUsd, 3_000);

  const pa = rulesFor("Apex", "funded", 50_000);
  check("Apex 50k PA row exists", pa != null, true);
  check("PA consistency is 50%, not legacy 30%", pa.maxSingleDayShare, 0.5);
  check("PA trail locks at start+$2,100 peak", pa.trailStopsAtProfitUsd, 2_100);
  check("PA min 5 qualifying days", pa.minTradingDays, 5);
  check("PA contract cap 4", pa.maxContracts, 4);

  // The legacy generation must NOT resolve — encoding it would size a current
  // account against a trail that never governs it.
  check(
    "unknown size refuses rather than guessing",
    rulesFor("Apex", "evaluation", 100_000),
    null,
  );
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
