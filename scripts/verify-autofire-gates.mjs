/**
 * Apex autofire refuses in every phase — pinned.
 *
 * Apex's current Prohibited Activities text prohibits automation on all
 * account types, evaluations included. The send path used to read the
 * evaluation as the one phase where it was "explicitly permitted", and with
 * APEX_ACCOUNT_PHASE=evaluation + TRADOVATE_AUTOFIRE_ENABLED=true it would
 * have sent a live order with no human click. This proves it no longer can:
 * the gates run for real (autofire-gates.ts imports nothing with a side
 * effect, so no database boots), and the earlier refusals are shown to be
 * exactly what they were.
 *
 * The source-text checks at the end exist because the dangerous version of
 * this bug is a COMMENT: the next person to read "explicitly permitted during
 * eval" over the gate would flip the constant back.
 *
 * Run: npx tsx scripts/verify-autofire-gates.mjs
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(join(ROOT, p), "utf8");

const gates = await import("../src/lib/execution/autofire-gates.ts");

let pass = 0;
let fail = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : ` — got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`);
};

const QUALIFIED = { actionable: true, confluence: 0.9 };

console.log("the configuration that used to fire now refuses");
{
  check("the written-confirmation switch is off in code", gates.APEX_AUTOMATION_CONFIRMED_IN_WRITING, false);
  const g = gates.evaluateAutofireGates(QUALIFIED, "evaluation", true);
  check("evaluation + switch on + actionable + 0.90 → refused", g.ok, false);
  check("with Apex's reason: all account types", /all account types/.test(g.reason ?? ""), true);
  check("…until Apex confirms in writing", /confirms otherwise in writing/.test(g.reason ?? ""), true);
  check("…and semi-automatic is the only compliant mode", /semi-automatic/.test(g.reason ?? "") && /clicks every/.test(g.reason ?? ""), true);
  check("the reason is the one exported for the panel", g.reason, gates.APEX_AUTOMATION_PROHIBITED_REASON);
  check("a perfect 1.00 candidate refuses too", gates.evaluateAutofireGates({ actionable: true, confluence: 1 }, "evaluation", true).ok, false);
}

console.log("\nthe earlier gates refuse exactly as before");
{
  const funded = gates.evaluateAutofireGates(QUALIFIED, "funded", true);
  check("funded refuses at the phase gate", [funded.ok, /phase is "funded"/.test(funded.reason)], [false, true]);
  const none = gates.evaluateAutofireGates(QUALIFIED, "none", true);
  check("unset refuses at the phase gate, never read as permission", [none.ok, /never be read as permission/.test(none.reason)], [false, true]);
  const off = gates.evaluateAutofireGates(QUALIFIED, "evaluation", false);
  check("switch off refuses on the switch", off.reason, "TRADOVATE_AUTOFIRE_ENABLED is not true.");
  const idle = gates.evaluateAutofireGates({ actionable: false, confluence: 0.9 }, "evaluation", true);
  check("not actionable refuses on actionability", /not actionable/.test(idle.reason), true);
  const low = gates.evaluateAutofireGates({ actionable: true, confluence: 0.84 }, "evaluation", true);
  check("below the floor refuses on confluence", low.reason, "Confluence 0.84 < autofire floor 0.85.");
  check("the floor is still 0.85", gates.AUTOFIRE_CONFLUENCE_FLOOR, 0.85);
  check("the phase reason no longer implies the evaluation is exempt", /banned on a funded Apex account;/.test(funded.reason), false);
}

console.log("\none copy of the gates, and no comment that says otherwise");
{
  const autofire = read("src/lib/execution/apex-autofire.ts");
  const execGate = read("src/lib/execution/execution-gate.ts");
  check("apex-autofire.ts routes through autofire-gates.ts", /from "\.\/autofire-gates"/.test(autofire), true);
  check("and defines no second evaluateAutofireGates", /function evaluateAutofireGates/.test(autofire), false);
  check("and defines no second floor", /const AUTOFIRE_CONFLUENCE_FLOOR/.test(autofire), false);
  const claim = /explicitly permitted during|IS explicitly permitted|permitted during (the )?eval/i;
  check("apex-autofire.ts no longer claims eval automation is permitted", claim.test(autofire), false);
  check("execution-gate.ts no longer claims it either", claim.test(execGate), false);
  check("the env var names are unchanged (autofire switch)", /boolEnv\("TRADOVATE_AUTOFIRE_ENABLED"\)/.test(autofire), true);
  check("the env var names are unchanged (phase)", /env\("APEX_ACCOUNT_PHASE"\)/.test(execGate), true);
  check(
    "the confirmation switch is a code constant, not an env read",
    /process\.env\s*\[|process\.env\.[A-Z_]/.test(read("src/lib/execution/autofire-gates.ts")),
    false,
  );
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
