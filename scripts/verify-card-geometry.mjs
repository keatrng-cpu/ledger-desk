/**
 * The card's own geometry, pinned against the four real cards that exposed it.
 *
 * On 2026-09-25 the board printed an A+ 0.80 whose levels were 0.11R, an
 * A+ 0.78 at 0.31R with a stop 8.4x the instrument cap, and a B 0.82 short
 * whose invalidation sat BELOW its entry. The only takeable geometry on the
 * screen belonged to the lowest-graded card. Those four are the fixtures, with
 * their real numbers, so a regression has to reproduce the exact screen that
 * caused this module to exist.
 *
 * Run: npx tsx scripts/verify-card-geometry.mjs
 */

const { readCardGeometry, zoneMid, firstLevel, THIN_RR } = await import(
  "../src/lib/trading/card-geometry.ts"
);

let pass = 0;
let fail = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : ` — got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`);
};
const near = (a, b, tol = 0.01) => a != null && Math.abs(a - b) < tol;

console.log("parsing what the card prints");
{
  // The card shows a zone AND an "opt" price. The opt price is the one the
  // card tells you to use, so it must win over the midpoint.
  check("opt price beats the zone midpoint", zoneMid("30746.88 – 30801.67 (OTE, opt 30773.96)"), 30773.96);
  check("a plain zone gives its midpoint", zoneMid("30708.00 – 30760.75 (CE 30734.38)"), 30734.375);
  check("a single price is itself", zoneMid("7784.06"), 7784.06);
  check("no number is null, not zero", zoneMid("await array"), null);
  check("invalidation prose yields its level", firstLevel("Below PDL 30370.75 / sweep"), 30370.75);
  check("target prose yields its level", firstLevel("Swing low (internal SSL) 30900.00 · 90%"), 30900);
  check("prose with no price is null", firstLevel("Beyond the sweep extreme"), null);
}

console.log("\nthe four real cards from 2026-09-25");
{
  // 1. MNQ LONG, A+ 0.78 — 403pt stop against a 126pt target.
  const a = readCardGeometry({
    symbol: "MNQ",
    side: "long",
    entryZone: "30746.88 – 30801.67 (OTE, opt 30773.96)",
    invalidation: "Below PDL 30370.75 / sweep",
    target: "Swing low (internal SSL) 30900.00 · 90%",
    atr: 12,
  });
  check("MNQ long risk is 403.21pt", near(a.riskPts, 403.21), true);
  check("and reward 126.04pt", near(a.rewardPts, 126.04), true);
  check("so 0.31R", near(a.rr, 0.3126, 0.001), true);
  // Over-cap is reported before sub-1R: a stop this wide is not a bad ratio,
  // it is the wrong stop, and saying "improve your target" would be advice
  // toward the wrong repair.
  check("it refuses on the CAP, not the ratio", a.verdict, "over-cap");
  check("and refuses", a.refuse, true);
  check("naming the multiple", /8\.4x/.test(a.line), true);
  check("and naming the real cause", /structural landmark/.test(a.line), true);

  // 2. ES LONG, A+ 0.80 — the worst of them at 0.11R.
  const b = readCardGeometry({
    symbol: "ES",
    side: "long",
    entryZone: "7783.47 – 7784.67 (OTE, opt 7784.06)",
    invalidation: "Below PDL 7707.25 / sweep",
    target: "NY 8:30 open 7792.75 · 80%",
    atr: 4,
  });
  check("ES long risk is 76.81pt", near(b.riskPts, 76.81), true);
  check("reward only 8.69pt", near(b.rewardPts, 8.69), true);
  check("0.11R", near(b.rr, 0.1131, 0.001), true);
  check("refused", b.refuse, true);

  // 3. MNQ SHORT, B 0.82 — the stop is BELOW the entry on a short.
  const c = readCardGeometry({
    symbol: "MNQ",
    side: "short",
    entryZone: "30930.85 – 30952.30 (OTE, opt 30941.70)",
    invalidation: "Above PDH 30827.50 / sweep",
    target: "PDH (external BSL) +1 30827.50 · 55%",
    atr: 12,
  });
  check("an inverted stop is detected", c.verdict, "inverted");
  check("risk is negative, not abs()'d away", c.riskPts < 0, true);
  check("refused", c.refuse, true);
  check("and it says price traded through it", /already traded through/.test(c.line), true);
  check("it does NOT report an R:R for an inverted stop", c.rr, null);

  // 4. ES SHORT, B+ 0.73 — the only takeable card, and the lowest-graded.
  const d = readCardGeometry({
    symbol: "ES",
    side: "short",
    entryZone: "7770.13 – 7776.15 (OTE, opt 7773.18)",
    invalidation: "Above PDH 7783.50 / sweep",
    target: "EQL ×2 (internal) 7761.13 · 92%",
    atr: 4,
  });
  check("ES short risk 10.32pt", near(d.riskPts, 10.32), true);
  check("reward 12.05pt", near(d.rewardPts, 12.05), true);
  check("1.17R", near(d.rr, 1.168, 0.005), true);
  check("NOT refused", d.refuse, false);
  // 1.17R clears the 1:1 floor and leaves little for slippage.
  check("but flagged thin", d.verdict, "thin");

  // The finding that made this urgent, asserted as a test.
  check(
    "the only takeable card was the LOWEST graded one",
    [a.refuse, b.refuse, c.refuse, d.refuse],
    [true, true, true, false],
  );
}

console.log("\nthe boundaries");
{
  const at1R = readCardGeometry({
    symbol: "ES", side: "long",
    entryZone: "7800", invalidation: "7790", target: "7810", atr: 4,
  });
  check("exactly 1.00R is not refused", at1R.refuse, false);
  check("but is thin", at1R.verdict, "thin");

  const under = readCardGeometry({
    symbol: "ES", side: "long",
    entryZone: "7800", invalidation: "7790", target: "7809.9", atr: 4,
  });
  check("a hair under 1R is refused", under.refuse, true);
  check("and named as sub-1R", under.verdict, "sub-1r");

  const good = readCardGeometry({
    symbol: "ES", side: "long",
    entryZone: "7800", invalidation: "7790", target: "7820", atr: 4,
  });
  check("2R is clean", good.verdict, "ok");
  check("and prints the ratio", /2\.00R/.test(good.line), true);
  check(`THIN_RR is ${THIN_RR}`, THIN_RR, 1.25);

  const noTarget = readCardGeometry({
    symbol: "ES", side: "long",
    entryZone: "7800", invalidation: "7790", target: "External buyside", atr: 4,
  });
  check("no readable target gives no R:R", noTarget.rr, null);
  check("and does not refuse on that alone", noTarget.refuse, false);

  const nothing = readCardGeometry({
    symbol: "ES", side: "long",
    entryZone: "await array", invalidation: "Beyond the sweep extreme", target: null,
  });
  check("unreadable levels do not refuse", nothing.refuse, false);
  check("and say there is nothing to size from", /nothing to size from/.test(nothing.line), true);
}

console.log("\nthe cap is ATR-relative, per the same helper the desk uses");
{
  const calm = readCardGeometry({
    symbol: "MNQ", side: "long",
    entryZone: "20000", invalidation: "19940", target: "20200", atr: 8,
  });
  const wild = readCardGeometry({
    symbol: "MNQ", side: "long",
    entryZone: "20000", invalidation: "19940", target: "20200", atr: 40,
  });
  // 60pt risk: over the legacy 48 cap in a calm tape, inside 4xATR when the
  // instrument is actually moving 40 points an hour.
  check("60pt is over cap when ATR is 8", calm.verdict, "over-cap");
  check("and fine when ATR is 40", wild.verdict, "ok");
  check("the cap widens with ATR, never below the legacy floor", wild.capPts >= 48, true);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
