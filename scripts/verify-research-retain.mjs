/**
 * The research note records the desk. It does not score, and it does not send.
 *   npx tsx scripts/verify-research-retain.mjs
 */
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const { researchLine } = await import("../src/lib/trading/research-retain.ts");
const { APLUS_RULES } = await import("../src/lib/aplus/config.ts");
const { FACTOR_FLOOR, FACTOR_CEILING } = await import("../src/lib/journal/discretion.ts");
const { QUOTE_EXECUTION_MAX_LAG_SEC } = await import("../src/lib/market/types.ts");

let fail = 0;
const check = (name, ok, detail = "") => {
  if (!ok) fail++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : ` — ${detail}`}`);
};

const retain = readFileSync(new URL("../brainlab/retain.py", import.meta.url), "utf8");
const pyNum = (name) => {
  const m = new RegExp(`^${name}\\s*=\\s*([0-9.]+)`, "m").exec(retain);
  return m ? Number(m[1]) : null;
};

check("PATH floor is the desk's", pyNum("PATH_FLOOR") === APLUS_RULES.confluenceFloor, `${pyNum("PATH_FLOOR")} vs ${APLUS_RULES.confluenceFloor}`);
check("stale-print cut is the desk's", pyNum("QUOTE_MAX_LAG_SEC") === QUOTE_EXECUTION_MAX_LAG_SEC);
check("discretion floor is the desk's", pyNum("FACTOR_FLOOR") === FACTOR_FLOOR);
check("discretion ceiling is the desk's", pyNum("FACTOR_CEILING") === FACTOR_CEILING);
check("no crew and no model client", !/crewai|kickoff|openai|anthropic/.test(retain));
check("no outbound post", !/requests\.|urllib|httpx|netlify\.app/.test(retain));

const base = {
  day: "2026-10-07",
  symbol: "MNQ",
  side: "short",
  confluence: 0.72,
  pathBand: "A",
  smcWord: "TAKE",
  smcMissing: "",
  retrace: "pass",
  entry: 20110.5,
  stop: 20140.25,
  t1: 20070.0,
  draw: "Asia low",
  quoteSource: "live_gateway",
  quoteLagSec: 2,
  quotePrice: 20112.0,
  discretionMult: 0.82,
  discretionVerdict: "caution",
};

const snake = (f) => ({
  day: f.day,
  symbol: f.symbol,
  side: f.side,
  confluence: f.confluence,
  path_band: f.pathBand,
  smc_word: f.smcWord,
  smc_missing: f.smcMissing,
  retrace: f.retrace,
  entry: f.entry,
  stop: f.stop,
  t1: f.t1,
  draw: f.draw,
  quote_source: f.quoteSource,
  quote_lag_sec: f.quoteLagSec,
  quote_price: f.quotePrice,
  discretion_mult: f.discretionMult,
  discretion_verdict: f.discretionVerdict,
});

function py(facts) {
  const r = spawnSync(
    "python3",
    [
      "-c",
      "import json,sys; sys.path.insert(0,'brainlab'); from retain import classify; print(json.dumps(classify(json.load(sys.stdin))))",
    ],
    { input: JSON.stringify(snake(facts)), encoding: "utf8" },
  );
  if (r.status !== 0) return { error: r.stderr || r.stdout };
  return JSON.parse(r.stdout);
}

const cases = [
  ["a live TAKE with a touch is a note and not an order", base, "note"],
  ["under the floor is research, not an entry", { ...base, confluence: 0.64 }, "stand"],
  ["a synthetic print is not an entry", { ...base, quoteSource: "synthetic", quoteLagSec: 0 }, "stand"],
  ["a 10 minute print is not an entry", { ...base, quoteLagSec: 600 }, "stand"],
  ["SMC wait is not an entry", { ...base, smcWord: "WAIT", smcMissing: "displacement" }, "stand"],
  ["an armed limit is not a fill", { ...base, retrace: "wait" }, "stand"],
  ["a TAKE with no plan has nothing to manage", { ...base, entry: null, stop: null, t1: null }, "stand"],
];

for (const [name, facts, status] of cases) {
  const ts = researchLine(facts);
  const pyNote = py(facts);
  check(
    name,
    ts.status === status && ts.sent === false && pyNote.status === status && pyNote.sent === false && ts.summary === pyNote.summary,
    `ts ${ts.status} py ${pyNote.status || pyNote.error} same=${ts.summary === pyNote.summary}`,
  );
}

const sized = researchLine({ ...base, discretionMult: 2 });
check("discretion cannot lever the note past the ceiling", sized.summary.includes("×1.15") && !sized.summary.includes("×2.00"));
check("the note names the entry, the stop, and the first exit", researchLine(base).summary.includes("Entry 20110.50") && researchLine(base).summary.includes("Stop 20140.25") && researchLine(base).summary.includes("First exit 20070.00"));
check("the armed note still names the levels", researchLine({ ...base, retrace: "wait" }).summary.includes("armed") && researchLine({ ...base, retrace: "wait" }).summary.includes("not a fill"));

const dir = mkdtempSync(join(tmpdir(), "retain-"));
const written = spawnSync(
  "python3",
  [
    "-c",
    "import json,sys; from pathlib import Path; sys.path.insert(0,'brainlab'); from retain import write_note; print(json.dumps(write_note(json.load(sys.stdin), Path(sys.argv[1]))))",
    dir,
  ],
  { input: JSON.stringify(snake(base)), encoding: "utf8" },
);
check("the markdown writes and still says it does not send", written.status === 0 && written.stdout.includes('"sent": false'), written.stderr);
if (written.status === 0) {
  const path = JSON.parse(written.stdout).path;
  const body = readFileSync(path, "utf8");
  check("the file is a note, not a receipt", body.includes("sent: false") && body.includes("The desk places. This note does not.") && !/LIVE_ORDER|SIMULATION_SUCCESS/.test(body));
}

console.log(fail ? `\n${fail} failed` : "\nall passed");
process.exit(fail ? 1 : 0);
