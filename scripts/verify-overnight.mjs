/**
 * The overnight board's gates, against hand-built situations.
 *
 * Each case is a decision the trader could actually face at 15:00 ET. The
 * board is what stops a mechanically indefensible hold, so its refusals have
 * to be exactly right — a false HOLD is a position carried through 17 hours
 * with no exit.
 *
 * Run: npx tsx scripts/verify-overnight.mjs
 */
const { gradeOvernight, overnightMechanics, positionFromFills, MIN_OVERNIGHT_DTE, MIN_OVERNIGHT_DELTA } =
  await import("../src/lib/trading/overnight-swing.ts");
const { etWallToEpochMs } = await import("../src/lib/trading/sessions.ts");

let pass = 0;
let fail = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : ` — got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`);
};

const SLEEVE = { equity: 1000, riskPct: 0.15 }; // the real sleeve: $150 cap
// A sleeve large enough that a deep-ITM ticket is affordable at all. Used
// only to prove the HOLD path exists — on the real $1,000 sleeve it does not,
// which is itself a case below.
const BIG = { equity: 25000, riskPct: 0.25 }; // $6,250 cap
const WED = etWallToEpochMs("2026-09-23", "15:10"); // a Wednesday, inside the window
const FRI = etWallToEpochMs("2026-09-25", "15:10"); // Friday — the weekend hold
const MORNING = etWallToEpochMs("2026-09-23", "10:00"); // outside the window

function desk(over = {}) {
  return {
    fetchedAt: "2026-09-23T19:10:00.000Z",
    clock: { isWeekday: true, etHour: 15, etMinute: 10 },
    bias: {
      left: { symbol: "MNQ", topDown: "bull", mid: "bull", daily: "bull", dealing: { zone: "discount" } },
      right: { symbol: "ES", topDown: "bull", mid: "bull", daily: "bull", dealing: { zone: "discount" } },
    },
    news: { verdict: "clear", reason: "", nextEvent: null },
    proxies: { QQQ: { price: 600 }, SPY: { price: 660 } },
    ladder: null,
    ...over,
  };
}

/**
 * A REAL deep-ITM ticket. A 0.75-delta QQQ call at spot 600 carries ~$45,000
 * of delta notional and costs thousands — most of it intrinsic, which is
 * exactly why a 1% gap is ~11% of the debit rather than all of it. A $140
 * ticket at that delta does not exist, and the board correctly refuses the
 * cheap leveraged structures that do.
 */
const goodTicket = { underlier: "QQQ", side: "call", debit: 4300, dte: 21, delta: 0.75 };

console.log("mechanics");
{
  const m = overnightMechanics(WED, "QQQ", null);
  check("QQQ weeknight blind window is 17h15m", [m.unmanageableLabel, m.overnightTradable], ["17h15m", false]);
  const f = overnightMechanics(FRI, "QQQ", null);
  check("Friday is a 65h15m weekend hold", [f.unmanageableLabel, f.weekend], ["65h15m", true]);
  const x = overnightMechanics(WED, "XSP", null);
  check("XSP trades the Cboe overnight session", [x.overnightTradable, x.unmanageableLabel], [true, "4h00m"]);
  check("XSP names the 20:15 reopen", /20:15/.test(x.nextTradable), true);
  check("weekend theta is 1.25 business days, not 3", [overnightMechanics(WED, "QQQ", null).thetaDays, f.thetaDays], [1, 1.25]);
}

console.log("gates");
{
  const r = gradeOvernight({ desk: desk(), now: WED, sleeve: BIG, position: goodTicket, spot: 600 });
  check("a real deep-ITM 21DTE Δ.75 inside the cap HOLDs", r.word, "HOLD");
  check("it is in the decision window", r.inWindow, true);
  // 0.75 x 1% x 600 x 100 = $450 per 1% move; 25% of the $4,300 debit is
  // $1,075, so it takes a ~2.4% gap — outside a normal night.
  check("the gap that breaks it is computed and survivable", r.mechanics.breakGapPct != null && r.mechanics.breakGapPct > 2, true);
}
{
  const r = gradeOvernight({ desk: desk(), now: WED, sleeve: BIG, position: { ...goodTicket, dte: 1 }, spot: 600 });
  check("1 DTE is FLATTEN on the expiry gate", [r.word, r.missing], ["FLATTEN", "Clear of expiry"]);
  check("it names the broker liquidation", /force-sell|15:30/.test(r.missingDetail), true);
}
{
  const r = gradeOvernight({ desk: desk(), now: WED, sleeve: BIG, position: { ...goodTicket, dte: 3, delta: 0.45 }, spot: 600 });
  check("Δ.45 fails the structure floor", [r.word, r.missing], ["FLATTEN", `DTE ≥ ${MIN_OVERNIGHT_DTE} · Δ ≥ ${MIN_OVERNIGHT_DELTA}`]);
}
{
  const r = gradeOvernight({ desk: desk(), now: WED, sleeve: SLEEVE, position: goodTicket, spot: 600 });
  check("the real $1,000 sleeve cannot afford the only structure that survives", [r.word, r.missing], ["FLATTEN", "Inside the ticket cap"]);
  check("and it says so in dollars", /over the \$150 cap/.test(r.missingDetail), true);
}
{
  const d = desk({ news: { verdict: "clear", reason: "", nextEvent: { name: "CPI", timeEt: "08:30", minutesAway: 1040, impact: "high", date: "2026-09-24" } } });
  const r = gradeOvernight({ desk: d, now: WED, sleeve: BIG, position: goodTicket, spot: 600 });
  check("a high-impact print inside the blind window is FLATTEN", [r.word, r.missing], ["FLATTEN", "No event while blind"]);
  check("it names the release", /CPI/.test(r.missingDetail), true);
}
{
  const d = desk({ news: { verdict: "blackout", reason: "FOMC ±15m", nextEvent: null } });
  const r = gradeOvernight({ desk: d, now: WED, sleeve: BIG, position: goodTicket, spot: 600 });
  check("an active blackout is FLATTEN", r.word, "FLATTEN");
}
{
  const d = desk({
    bias: {
      left: { symbol: "MNQ", topDown: "bear", mid: "bear", daily: "bear", dealing: { zone: "premium" } },
      right: { symbol: "ES", topDown: "bear", mid: "bear", daily: "bear", dealing: { zone: "premium" } },
    },
  });
  const r = gradeOvernight({ desk: d, now: WED, sleeve: BIG, position: goodTicket, spot: 600 });
  check("HTF bear under a call is FLATTEN", [r.word, r.missing], ["FLATTEN", "Direction survives the night"]);
  const put = gradeOvernight({ desk: d, now: WED, sleeve: BIG, position: { ...goodTicket, side: "put" }, spot: 600 });
  check("a put with HTF bear is only TRIM — the drift is long-biased", [put.word, put.missing], ["TRIM", "Direction survives the night"]);
  check("the put warning cites the drift", /long-biased/.test(put.missingDetail), true);
}
{
  const r = gradeOvernight({ desk: desk(), now: WED, sleeve: SLEEVE, position: null, fills: [] });
  check("no ticket reads FLATTEN, not TRIM", [r.word, r.missing], ["FLATTEN", "Flat — nothing to carry"]);
  check("and it says what opening one would need", /15× the ticket cap/.test(r.missingDetail), true);
}
{
  const r = gradeOvernight({ desk: desk({ clock: { isWeekday: true, etHour: 10, etMinute: 0 } }), now: MORNING, sleeve: BIG, position: goodTicket, spot: 600 });
  check("outside the window it still grades, and says so", [r.inWindow, /opens 15:00/.test(r.windowLabel)], [false, true]);
}
{
  const r = gradeOvernight({ desk: desk(), now: WED, sleeve: BIG, position: { ...goodTicket, underlier: "XSP" }, spot: 660 });
  check("XSP passes the manageability layer", r.layers.find((l) => l.id === "manageable").state, "pass");
  check("and the vehicle line points at the option rail, not MES", /manageable option rail/.test(r.vehicle.headline), true);
}

console.log("position parsing");
{
  const p = positionFromFills([
    { id: "1", openedAt: "2026-09-23T14:00:00Z", underlier: "qqq", side: "call", debit: 140, note: "21dte d.75 path" },
  ]);
  check("DTE and delta parse out of the note when the fields are absent", [p.dte, p.delta, p.underlier], [21, 0.75, "QQQ"]);
  const q = positionFromFills([
    { id: "1", openedAt: "2026-09-23T14:00:00Z", underlier: "QQQ", side: "call", debit: 140, note: "21dte d.75", dte: 30, delta: 0.8 },
  ]);
  check("structured fields win over the note", [q.dte, q.delta], [30, 0.8]);
  check("a closed fill is not a position", positionFromFills([{ id: "1", openedAt: "x", closedAt: "y", underlier: "QQQ", side: "call", debit: 1, note: "" }]), null);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
