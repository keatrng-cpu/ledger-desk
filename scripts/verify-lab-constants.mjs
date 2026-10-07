/**
 * The Python lab copies numbers from the desk (brainlab/gate.py, rhread.py). A copy that drifts is a lab that says "usable" about a ticket the desk
 * would refuse. This reads the Python constants as text and compares each to its TypeScript source, so a change on either side fails here.
 *
 *   npx tsx scripts/verify-lab-constants.mjs
 *
 * Also pins that the lab has no order call and no stored credentials, and that its tools are vetted: the dev requirements name the REAL package
 * (smartmoneyconcepts, not the non-existent "smart-money-concepts") and say why the others were not installed.
 */
import { readFileSync, readdirSync } from "node:fs";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const gate = read("brainlab/gate.py");
const num = (name, src = gate) => {
  const m = new RegExp(`^${name}\\s*=\\s*([0-9_.]+)`, "m").exec(src);
  return m ? Number(m[1].replace(/_/g, "")) : null;
};

const { EXEC_LIMITS } = await import("../src/lib/room/exec/limits.ts");
const G = await import("../src/lib/execution/rh-autofire-gates.ts");
const { ROOM_MANDATE } = await import("../src/lib/room/mandate.ts");

let pass = 0;
let fail = 0;
const check = (name, ok, detail = "") => {
  if (ok) pass++;
  else fail++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : ` — ${detail}`}`);
};
const same = (name, py, ts) => check(`${name}: Python ${py} = TypeScript ${ts}`, py === ts, `${py} vs ${ts}`);

console.log("every number the lab copies is the desk's");
same("spread cap (share of mid)", num("MAX_SPREAD_FRAC"), EXEC_LIMITS.maxSpreadFrac);
same("marketable-limit slip ($)", num("ENTRY_SLIP_USD"), EXEC_LIMITS.entrySlipUsd);
same("quote age (ms)", num("MAX_QUOTE_AGE_MS"), EXEC_LIMITS.maxQuoteAgeSec * 1000);
same("debit floor ($)", num("MIN_DEBIT"), G.RH_MIN_DEBIT_TOTAL);
same("debit cap ($)", num("MAX_DEBIT"), G.RH_MAX_DEBIT_TOTAL);
same("fewest contracts", num("MIN_QTY"), G.RH_MIN_CONTRACTS);
same("most contracts", num("MAX_QTY"), G.RH_MAX_CONTRACTS);
same("a B+ card's contracts", num("BPLUS_QTY"), G.RH_BPLUS_MAX_CONTRACTS);
check("allowed DTE", /ALLOWED_DTE\s*=\s*\(0,\s*1\)/.test(gate) && JSON.stringify(ROOM_MANDATE.dteAllowed) === "[0,1]", `${ROOM_MANDATE.dteAllowed}`);
check("the option contract multiplier is 100", num("CONTRACT_MULTIPLIER") === 100);
check("the trade account the lab reads is the one the desk trades", new RegExp(`TRADE_ACCOUNT\\s*=\\s*"${G.RH_PREFERRED_ACCOUNT_NUMBER}"`).test(read("brainlab/rhread.py")), G.RH_PREFERRED_ACCOUNT_NUMBER);
check("the lab's noise cut is the desk's measurement bar (|z| >= 2)", num("NOISE_Z") === 2);

console.log("what the lab must never have");
{
  const py = readdirSync(new URL("../brainlab/", import.meta.url)).filter((f) => f.endsWith(".py") && f !== "selfcheck.py");
  const blob = py.map((f) => read(`brainlab/${f}`)).join("\n");
  check("no order call anywhere in the lab", !/order_buy|order_sell|place_option|order_send|\.orders\.|submit_order/.test(blob));
  check("no password, key or seed written as a literal (they come from the environment)", !/(PASSWORD|SECRET|API_KEY|MFA_SEED|TOTP)\s*=\s*["'][^"']{3,}["']/.test(blob));
  check("the Robinhood session is never written to disk", /store_session=False/.test(read("brainlab/rhread.py")) && !/pickle_name|store_session=True/.test(blob));
  check("the credentials come from the environment or the git-ignored brainlab/.env", /ROBINHOOD_USERNAME/.test(read("brainlab/rhread.py")) && /brainlab\/\.env|\.env/.test(read(".gitignore")) && !/ROBINHOOD_PASSWORD=\S/.test(read("brainlab/.env.example")));
  check("the .env example holds names only, and warns against storing the MFA seed", /Do NOT store the MFA seed/.test(read("brainlab/.env.example")));
  check("Chroma telemetry is off", /anonymized_telemetry=False/.test(read("brainlab/memory.py")));
}

console.log("the tools were vetted");
{
  const dev = read("brainlab/requirements-dev.txt");
  check("the SMC library is the real package at a pinned version", /^smartmoneyconcepts==0\.0\.\d+/m.test(dev) && !/^smart-money-concepts/m.test(dev));
  check("bandit is pinned", /^bandit==\d+\.\d+\.\d+/m.test(dev));
  check("the ones not installed are named with their reason", ["pydash", "ccxt", "backtrader", "vectorbt", "fvg-detector", "pylimits"].every((p) => dev.includes(p)));
  check("nothing unvetted is in the runtime requirements either (each line is a known package)", read("brainlab/requirements.txt").split(/\r?\n/).filter(Boolean).every((l) => /^(yfinance|pandas|pandas-ta-classic|chromadb|streamlit|pydantic|numpy|scipy|SQLAlchemy|websocket-client|GitPython|robin_stocks)\b/.test(l)));
}

console.log(`\nlab-constants: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
