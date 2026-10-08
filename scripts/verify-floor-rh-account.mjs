/**
 * Floor RH account awareness (Keaton 2026-10-06): seats know the RH Individual
 * account on the desk — cash vs BP, the $150–$550 envelope, the armed path.
 *
 * Run: npx tsx scripts/verify-floor-rh-account.mjs
 */
const research = await import("../src/lib/room/research.ts");
const acct = await import("../src/lib/execution/rh-account.ts");

let pass = 0;
let fail = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : ` — got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`);
};

const SNAP = acct.RH_DESK_ACCOUNT_SNAPSHOT;
console.log("desk snapshot = Keaton screenshot 2026-10-06");
check("cash / BP / unsettled", [SNAP.cash, SNAP.buyingPower, SNAP.unsettledFunds], [984.12, 11.56, 972.56]);
check("day change", [SNAP.dayChangeUsd, SNAP.dayChangePct], [-179.84, -15.45]);
check("snapshot is context only (not get_portfolio)", SNAP.source, "desk_snapshot");

console.log("\nrhAccountNote / rhArmedPathNote lines");
const note = research.rhAccountNote(SNAP).line;
check("note names cash $984.12", note.includes("$984.12"), true);
check("note names BP $11.56", note.includes("$11.56"), true);
check("note names envelope $50–$550", note.includes("$50–$550"), true);
check("note says nothing can place", /nothing .* can place/.test(note), true);
check("note carries today −$179.84 (−15.45%)", note.includes("$179.84") && note.includes("15.45%"), true);
const armed = research.rhArmedPathNote(SNAP, SNAP.asOfMs).line;
check("armed path: shut on BP", /shut on BP/.test(armed) && armed.includes("$50"), true);
check("armed path: agent can't trade Individual", /can't trade that account/.test(armed), true);
check("no account → refuses blind", /get_portfolio/.test(research.rhAccountNote(null).line), true);
const funded = { ...SNAP, buyingPower: 900, optionsBuyingPower: null, unsettledFunds: 0, agenticAllowed: true, source: "get_portfolio" };
check("funded note offers room up to $550", research.rhAccountNote(funded).line.includes("$550.00"), true);

console.log("\nresearch shelf: every seat carries the account");
const shelf = research.researchShelf(SNAP, SNAP.asOfMs);
for (const who of ["Nova", "Vince", "Sterling", "Gemma", "Jax"]) {
  check(`${who} shelf has rh_account`, shelf[who].some((n) => n.id === "rh_account"), true);
}
check("Sterling shelf has rh_armed_path", shelf.Sterling.some((n) => n.id === "rh_armed_path"), true);
check("legacy shelf() unchanged (no account key)", research.researchShelf().Nova.some((n) => n.id === "rh_account"), false);

console.log("\nmeeting: Sterling flags the armed path on an ARMED Floor");
{
  const { buildMeeting } = await import("../src/lib/room/meeting.ts");
  const tape = { price: 500, rsi: 50, vix: 16, trend: "CHOPPY", volume_spike: false };
  const base = {
    input: { portfolio: { cash: 1000, open_positions: [] }, market_data: { QQQ: tape, SPY: tape } },
    desk: null, ledger: null, beat: "chop", exit: null, entry: null,
    card: { verdict: "ARMED", deskContracts: 2 }, refusal: null, refusalGate: null, gates: [],
    focus: { underlier: "QQQ", type: "CALL", offset: "ATM", quote: null, exp: "2026-10-06" },
    etMin: 600, etDate: "2026-10-06", seed: 1, nowMs: SNAP.asOfMs, errors: [], agenda: null,
    holds: {}, lenses: null, lab: null,
  };
  const places = { Jax: "JAX'S_DESK", Nova: "NOVA'S_DESK", Sterling: "STERLING_DESK", Gemma: "GEMMA_DESK", Vince: "VINCE_DESK" };
  let lines = [];
  try {
    lines = buildMeeting({ ...base, rhAccount: SNAP }, places, null, null);
  } catch (e) {
    console.log("  (chop beat needs more facts:", String(e).slice(0, 80), ")");
  }
  const said = lines.map((l) => l.text).join(" | ");
  check("Sterling says the RH path is shut on BP", lines.some((l) => l.character === "Sterling" && /shut on BP/.test(l.text)), true);
  const without = (() => { try { return buildMeeting(base, places, null, null); } catch { return []; } })();
  check("no account key → no RH account line", without.some((l) => /shut on BP/.test(l.text)), false);
  if (!lines.length) console.log("  lines:", said);
}

console.log(`\nfloor-rh-account: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
