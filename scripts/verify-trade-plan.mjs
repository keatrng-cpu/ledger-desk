/**
 * Verification for the numeric trade plan (src/lib/trading/trade-plan.ts) and
 * the chart projection (src/components/desk/setup-chart.tsx).
 *
 * This is the arithmetic a trader sizes off. A stop on the wrong side of the
 * raid, or an R computed against the wrong leg, is not a cosmetic bug — it is
 * a wrong position size on every trade that follows.
 *
 * The projection is tested too, because a chart can be wrong in a way the eye
 * does not catch: a target cropped out of frame makes a trade look tighter
 * than it is.
 *
 * Run: npx tsx scripts/verify-trade-plan.mjs
 */

const { sizeFromStop } = await import("../src/lib/trading/sleeve-sizing.ts");
const { buildTradePlan, planEntryText, planRiskText, MIN_RISK_ATR } = await import(
  "../src/lib/trading/trade-plan.ts"
);
const { buildScale } = await import("../src/components/desk/setup-chart.tsx");

let pass = 0;
let fail = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    pass++;
    console.log(`  ok   ${label}`);
  } else {
    fail++;
    console.log(`  FAIL ${label}\n         expected: ${e}\n         actual:   ${a}`);
  }
}
function truthy(label, v) {
  if (v) {
    pass++;
    console.log(`  ok   ${label}`);
  } else {
    fail++;
    console.log(`  FAIL ${label} (got ${v})`);
  }
}

const arr = (o) => ({
  kind: "ifvg",
  tf: "15m",
  side: "bear",
  top: 24200,
  bottom: 24180,
  mid: 24190,
  t: 1_700_000_000_000,
  at: "09:45",
  state: "fresh",
  label: "IFVG",
  ...o,
});

/* ── Short: the desk's gold-standard book ────────────────────────────────── */

console.log("\nshort plan");

const short = buildTradePlan({
  symbol: "MNQ",
  side: "short",
  price: 24188,
  entryArray: arr({}),
  sweepExtreme: 24215, // raid wick above the array
  sweepT: 1_699_999_000_000,
  dol: { name: "PDL", price: 24030, reachProbability: 0.68, side: "below" },
  range: { high: 24260, low: 23980, eq: 24120 },
  arrays: [],
});

truthy("a complete tape prices a plan", short !== null);
check("entry is the array midpoint (CE)", short.entry, 24190);
check("entry zone is the array", short.entryZone, { top: 24200, bottom: 24180 });
// pad = max((24200-24180)*0.25, 0.25) = 5 -> stop = max(24215, 24200) + 5
check("stop sits beyond the RAID wick, not the array", short.stop, 24220);
check("risk is entry->stop", short.riskPts, 30);
check("T1 is the named draw", short.t1, 24030);
check("T2 is the range low (ERL)", short.t2, 23980);
check("R to T1", short.rr1, Math.round((160 / 30) * 100) / 100);
check("R to T2", short.rr2, Math.round((210 / 30) * 100) / 100);
check("sweep is carried for drawing", short.sweep, { price: 24215, t: 1_699_999_000_000 });
check("risk is under the MNQ cap", short.riskOverCap, false);

/* ── Long: mirrored, and the mirror is where sign errors hide ────────────── */

console.log("\nlong plan");

const long = buildTradePlan({
  symbol: "MNQ",
  side: "long",
  price: 24192,
  entryArray: arr({ side: "bull" }),
  sweepExtreme: 24165, // raid wick BELOW the array
  sweepT: 1_699_999_000_000,
  dol: { name: "PDH", price: 24330, reachProbability: 0.6, side: "above" },
  range: { high: 24400, low: 23980, eq: 24190 },
  arrays: [],
});

check("long stop is BELOW the raid wick", long.stop, 24160);
check("long risk", long.riskPts, 30);
check("long T1 is above entry", long.t1, 24330);
check("long T2 is the range high", long.t2, 24400);
check("long R to T1", long.rr1, Math.round((140 / 30) * 100) / 100);

/* ── Refusals: derive or return null, never invent ───────────────────────── */

console.log("\nrefusals");

check("no side -> no plan", buildTradePlan({ symbol: "MNQ", side: null, price: 24188, entryArray: arr({}), sweepExtreme: null, sweepT: null, dol: null, range: null }), null);
check("no entry array -> no plan", buildTradePlan({ symbol: "MNQ", side: "short", price: 24188, entryArray: null, sweepExtreme: 24215, sweepT: null, dol: null, range: null }), null);
check("no price -> no plan", buildTradePlan({ symbol: "MNQ", side: "short", price: 0, entryArray: arr({}), sweepExtreme: null, sweepT: null, dol: null, range: null }), null);

// A draw BEHIND the entry is where price came from, not a target.
const behind = buildTradePlan({
  symbol: "MNQ",
  side: "short",
  price: 24188,
  entryArray: arr({}),
  sweepExtreme: 24215,
  sweepT: null,
  dol: { name: "PDH", price: 24400, reachProbability: 0.7, side: "above" },
  range: null,
});
check("a draw behind the entry is NOT taken as T1", behind.t1, null);
check("...and R is null rather than a made-up number", behind.rr1, null);

// No raid: stop falls back to the array's far edge, still on the right side.
const noRaid = buildTradePlan({
  symbol: "MNQ",
  side: "short",
  price: 24188,
  entryArray: arr({}),
  sweepExtreme: null,
  sweepT: null,
  dol: null,
  range: null,
});
check("no raid -> stop beyond the array edge", noRaid.stop, 24205);
truthy("no raid -> stop is still above a short entry", noRaid.stop > noRaid.entry);
check("no raid -> no sweep to draw", noRaid.sweep, null);

// A degenerate array cannot be sized.
check(
  "zero-width array -> no plan (never an infinite R)",
  buildTradePlan({
    symbol: "MNQ",
    side: "short",
    price: 24190,
    entryArray: arr({ top: 24190, bottom: 24190, mid: 24190 }),
    sweepExtreme: 24190,
    sweepT: null,
    dol: null,
    range: null,
  }),
  null,
);

/* ── Risk cap ────────────────────────────────────────────────────────────── */

console.log("\nrisk cap");

const wide = buildTradePlan({
  symbol: "MNQ",
  side: "short",
  price: 24000,
  entryArray: arr({ top: 24100, bottom: 23900, mid: 24000 }),
  sweepExtreme: 24300,
  sweepT: null,
  dol: { name: "PDL", price: 23500, reachProbability: 0.5, side: "below" },
  range: null,
});
truthy("a 350pt stop is flagged over the MNQ cap", wide.riskOverCap);
truthy("...but the plan is still produced, not suppressed", wide.stop > wide.entry);

/* ── Prose is a VIEW of the numbers ──────────────────────────────────────── */

console.log("\nprose derives from the plan");

check("entry text", planEntryText(short), "24180.00–24200.00 · CE 24190.00");
truthy("risk text carries R", planRiskText(short).includes("5.33R"));
truthy("over-cap is stated in the text", planRiskText(wide).includes("OVER CAP"));

/* ── Projection: every plan level must be in frame ───────────────────────── */

console.log("\nchart projection");

const bars = Array.from({ length: 60 }, (_, i) => ({
  t: 1_700_000_000_000 + i * 900_000,
  o: 24190,
  h: 24200,
  l: 24180,
  c: 24195,
  v: 10,
}));

const scale = buildScale(bars, short);
truthy("a scale is produced", scale !== null);
truthy("stop is inside the canvas", scale.y(short.stop) > 0 && scale.y(short.stop) < 340);
truthy("T2 is inside the canvas", scale.y(short.t2) > 0 && scale.y(short.t2) < 340);
truthy(
  "price axis is inverted (higher price = smaller y)",
  scale.y(short.stop) < scale.y(short.t1),
);
truthy("bars alone still scale when there is no plan", buildScale(bars, null) !== null);
check("no bars -> no scale", buildScale([], short), null);

// The failure this guards against: a far target silently cropped.
const far = { ...short, t2: 20000, levels: [...short.levels, { kind: "t2", price: 20000, label: "far" }] };
const farScale = buildScale(bars, far);
truthy("a distant target expands the frame rather than being cropped", farScale.lo < 20000);


// ── The stop floor: 0.25 x ATR(14) ────────────────────────────────────────
//
// Found 2026-09-24 on the live desk: a rendered plan showed "T2 28.3R", which
// works back to riskPts 1.31 on ES — five ticks. trade-plan guarded riskPts>0
// and had a MAXIMUM but no minimum, so a thin-but-nonzero entry array put the
// stop inside the spread.
//
// The floor was chosen by sweeping ATR multiples against 387 resolved shadow
// trades, not picked:
//     0.10 ATR  rejects 13, they won 0    kept +0.088R
//     0.20 ATR  rejects 27, they won 0    kept +0.128R
//     0.25 ATR  rejects 31, they won 0    kept +0.132R   <- chosen
//     0.30 ATR  rejects 41, they won 4.9% kept +0.110R
// 0.25 is the last multiple where the rejected set wins NOTHING, and it is
// where what remains scores best. Beyond it the floor starts eating winners.
{
  const bars = [];
  // A flat-ish tape so ATR is a known quantity: every bar 10 wide.
  for (let i = 0; i < 60; i++) bars.push({ t: i * 900000, o: 100, h: 105, l: 95, c: 100, v: 1 });

  const base = {
    symbol: "MNQ", side: "long", price: 100,
    // `mid` is the entry (consequent encroachment); without it buildTradePlan
    // returns null and the test measures nothing.
    entryArray: { top: 100.5, bottom: 99.5, mid: 100, kind: "fvg", tf: "15m", state: "fresh", side: "bull", t: 40 },
    sweepExtreme: null, sweepT: null, dol: null,
    range: { high: 120, low: 80, eq: 100 }, bars,
  };

  const tight = buildTradePlan(base);
  check("a plan off a 1pt array is built at all", tight != null, true);
  if (tight) {
    check("and flagged as too tight against ATR", tight.riskTooTight, true);
    check("carrying the ATR it was judged against", tight.riskAtr != null && tight.riskAtr > 0, true);
    check("the floor is 0.25 ATR", tight.riskPts < tight.riskAtr * MIN_RISK_ATR, true);
  }

  // A wide array clears it.
  const wide = buildTradePlan({
    ...base,
    entryArray: { ...base.entryArray, top: 106, bottom: 94, mid: 100 },
  });
  check("a wide array is not flagged", wide != null && wide.riskTooTight, false);

  // THE MONEY PATH: sizing refuses rather than solving a huge position from a
  // stop that will not survive the session.
  const sized = sizeFromStop({
    plan: { symbol: "ES", side: "long", entry: 7742.13, stop: 7740.82, riskPts: 1.31, riskTooTight: true, riskAtr: 5.18 },
    delta: 0.5, premiumUsd: 200, dte: 21, riskBudgetUsd: 150,
  });
  check("sizing refuses a too-tight stop", sized.contracts, 0);
  check("and says so rather than returning a silent zero", /TOO TIGHT/.test(sized.lines.join(" ")), true);
  check("naming what it measured", /0 of 31/.test(sized.lines.join(" ")), true);

  // Without the flag the same geometry still sizes — the refusal is the FLAG,
  // not a second opinion computed here.
  // 20pt on ES at 0.5 delta prices at $100/contract against a $150 budget —
  // affordable. (42pt would cost $210 and be legitimately unsizeable, which
  // would have tested the wrong refusal.)
  const ok2 = sizeFromStop({
    plan: { symbol: "ES", side: "long", entry: 7742.13, stop: 7722.13, riskPts: 20, riskTooTight: false, riskAtr: 5.18 },
    delta: 0.5, premiumUsd: 200, dte: 21, riskBudgetUsd: 150,
  });
  check("a normal stop still sizes", ok2.contracts > 0, true);

  // No bars => no ATR => no claim either way. A fabricated floor is worse
  // than none.
  const noBars = buildTradePlan({ ...base, bars: undefined });
  check("without bars it makes no tightness claim", noBars != null && noBars.riskTooTight, false);
  check("and reports no ATR", noBars != null && noBars.riskAtr, null);
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
