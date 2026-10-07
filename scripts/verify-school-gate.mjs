/**
 * School gate stays off until it is measured. School prices are narration.
 * The resting price stays CE.
 *
 *   npx tsx scripts/verify-school-gate.mjs
 */
import { SCHOOL_GATE, schoolGate } from "../src/lib/trading/school-brief.ts";
import { schoolPlanPrices } from "../src/lib/trading/school-ticket.ts";

let pass = 0;
let fail = 0;
const check = (name, ok, detail = "") => {
  if (ok) pass++;
  else fail++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : ` — ${detail}`}`);
};

check("the school gate ships off", SCHOOL_GATE.enabled === false, String(SCHOOL_GATE.enabled));

const missing = [{ school: "tjr", verdict: "missing", next: "the sweep", bias: { dir: "short" }, checks: [], lacking: 1 }];
check("off, a failed must does not refuse", schoolGate("tjr", missing).ok === true, "");
const on = schoolGate("tjr", missing, true);
check("on, a failed must refuses in the school's words", on.ok === false && /sweep/.test(on.reason ?? ""), on.reason);
check("on, a fit does not refuse", schoolGate("tjr", [{ school: "tjr", verdict: "fits", next: null }], true).ok === true, "");
check("a model with no school is not refused", schoolGate("continuation", missing, true).ok === true, "");

const line = schoolPlanPrices({ side: "long", entry: 105, stop: 100, entryZone: { top: 110, bottom: 100 } });
check("the rest stays at CE", line.startsWith("Rest stays at CE 105.00."), line);
check("TJR names the gap edge", line.includes("TJR gap edge 100.00."), line);
check("ICT names the OTE band", line.includes("ICT OTE 102.10–103.80."), line);
check("Patty names the overlap", line.includes("Patty breaker–FVG overlap 100.00–110.00."), line);
const bare = schoolPlanPrices({ side: "short", entry: 50, stop: 52, entryZone: null });
check("a card without a zone does not invent a school price", /not on this card/.test(bare) && bare.includes("CE 50.00"), bare);
check("no plan says nothing is rested", schoolPlanPrices(null) === "No plan on the card. Nothing is rested.", schoolPlanPrices(null));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
