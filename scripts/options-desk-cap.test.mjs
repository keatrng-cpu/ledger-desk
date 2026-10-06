/**
 * Options desk debit ceiling must never exceed the RH gate envelope.
 * A $1,000 sleeve sizer used to print 5 DTE ~$575 singles the RH $550 gate
 * refuses — clamp at evaluateOptionsDesk so display + sizing agree.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { register } from "tsx/esm/api";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

register();

const {
  estimateDebitContract,
  contractsWithinRisk,
  brakeIsClock,
  evaluateOptionsDesk,
  optionsDeskPlaybook,
  IV,
} = await import("../src/lib/trading/options-desk.ts");
const { rhTicketCapUsd, rhRiskBudgetUsd, RH_SLEEVE_DEFAULT } = await import(
  "../src/lib/trading/options-sleeve.ts"
);
const { RH_MAX_DEBIT_TOTAL } = await import("../src/lib/execution/rh-autofire-gates.ts");

const ROOT = fileURLToPath(new URL("..", import.meta.url));

/** Mirror evaluateOptionsDesk's effCap path used when no priced level exists. */
function ceilingTicketTotal(spot, dte, delta, iv, cap, riskBudget) {
  const single = estimateDebitContract(spot, dte, delta, iv);
  const effCap = brakeIsClock(dte) ? Math.min(cap, riskBudget) : cap;
  const n = contractsWithinRisk(single, effCap, riskBudget);
  if (single <= effCap && n >= 1) return { single, total: n * single, n, effCap };
  return { single, total: 0, n, effCap };
}

function biasBook(symbol, last, changePct) {
  return {
    symbol,
    topDown: "bear",
    daily: "bear",
    mid: "bear",
    ltf: "bear",
    confidence: 0.7,
    summary: "",
    swings: [],
    lastBOS: null,
    dealing: { zone: "discount" },
    liquidity: [],
    pdh: null,
    pdl: null,
    dayOpen: null,
    pwh: null,
    pwl: null,
    midnightOpen: null,
    nyOpen830: null,
    nyOpen930: null,
    changePct,
    last,
    sessionStance: "bear",
    sessionStrength: 0.5,
    reversalAlert: null,
  };
}

test("evaluateOptionsDesk clamps maxDebit to RH_MAX_DEBIT_TOTAL", () => {
  const desk = {
    clock: { etHour: 10, etMinute: 30, session: "ny_am" },
    news: { verdict: "clear", reason: "" },
    bias: {
      left: biasBook("MNQ", 20_000, -0.4),
      right: biasBook("ES", 5800, -0.2),
    },
    quotes: {
      left: { symbol: "MNQ", price: 20_000 },
      right: { symbol: "ES", price: 5800 },
    },
    proxies: { SPY: null, QQQ: null },
    scan: { smt: { state: "none", edge: "none", note: "" }, candidates: [] },
    smtStack: { primary: null },
    smcMaster: {
      left: { symbol: "MNQ", word: "WAIT", missing: "retrace", plan: null },
      right: { symbol: "ES", word: "WAIT", missing: "retrace", plan: null },
      oneBook: { word: "WAIT" },
      thesis: "WAIT",
    },
    weekAhead: { today: { kind: "normal" } },
  };

  const sleeve = { ...RH_SLEEVE_DEFAULT, equity: 1_000 };
  assert.equal(rhTicketCapUsd(sleeve), 1_000, "sleeve equity still $1,000");

  const book = evaluateOptionsDesk(/** @type {any} */ (desk), sleeve);
  assert.equal(book.maxDebit, RH_MAX_DEBIT_TOTAL, "on-screen maxDebit equals RH gate");
  assert.equal(book.maxDebit, 550);

  const sleeveGate = book.gates.find((g) => g.id === "sleeve");
  assert.ok(sleeveGate, "sleeve gate present");
  assert.match(
    sleeveGate.label,
    new RegExp(`Ticket ≤ \\$${RH_MAX_DEBIT_TOTAL.toLocaleString()}`),
    "checklist ceiling reads the constant",
  );
});

test("sizer never produces a ticket above RH_MAX_DEBIT_TOTAL (incl. 1–10 DTE ~$555–$600)", () => {
  const sleeveCap = rhTicketCapUsd(RH_SLEEVE_DEFAULT);
  const cap = Math.min(sleeveCap, RH_MAX_DEBIT_TOTAL);
  const budget = rhRiskBudgetUsd(RH_SLEEVE_DEFAULT);
  assert.equal(cap, RH_MAX_DEBIT_TOTAL);

  // Unclamped sleeve would accept SPY 5 DTE ~$575 — the bug Accuracy Review named.
  const unclamped = ceilingTicketTotal(580, 5, 0.5, IV.SPY, sleeveCap, budget);
  assert.ok(
    unclamped.single >= 555 && unclamped.single <= 600,
    `expected ~$555–$600 5 DTE single, got $${unclamped.single}`,
  );
  assert.ok(
    unclamped.total > RH_MAX_DEBIT_TOTAL,
    `unclamped sleeve still builds $${unclamped.total} (> $${RH_MAX_DEBIT_TOTAL}) — precondition`,
  );

  // With the RH clamp, that ticket is refused (falls to spread/STAND).
  const clamped = ceilingTicketTotal(580, 5, 0.5, IV.SPY, cap, budget);
  assert.ok(
    clamped.total === 0 || clamped.total <= RH_MAX_DEBIT_TOTAL,
    `clamped sizer total $${clamped.total} must be ≤ $${RH_MAX_DEBIT_TOTAL}`,
  );
  assert.ok(clamped.single > cap, "the ~$575 single exceeds the clamped cap");
  assert.equal(clamped.n, 0);

  // Sweep 1–10 DTE for SPY/QQQ ATM-ish deltas — no ceiling ticket above the gate.
  for (const dte of [1, 2, 3, 5, 7, 10]) {
    for (const [spot, iv] of [
      [580, IV.SPY],
      [480, IV.QQQ],
    ]) {
      for (const delta of [0.35, 0.4, 0.5]) {
        const r = ceilingTicketTotal(spot, dte, delta, iv, cap, budget);
        assert.ok(
          r.total <= RH_MAX_DEBIT_TOTAL + 1e-9,
          `${dte}DTE Δ${delta} total $${r.total} exceeds $${RH_MAX_DEBIT_TOTAL}`,
        );
      }
    }
  }
});

test("playbook and source clamp read RH_MAX_DEBIT_TOTAL, not a hardcoded $1,000", () => {
  const pb = optionsDeskPlaybook();
  assert.match(pb[0], new RegExp(`Ticket ceiling \\$${RH_MAX_DEBIT_TOTAL}`));
  assert.doesNotMatch(pb[0], /\$1,000/);

  const src = readFileSync(join(ROOT, "src/lib/trading/options-desk.ts"), "utf8");
  assert.match(
    src,
    /const cap = Math\.min\(rhTicketCapUsd\(sleeve\),\s*RH_MAX_DEBIT_TOTAL\)/,
    "evaluateOptionsDesk clamps cap to RH_MAX_DEBIT_TOTAL",
  );
  assert.doesNotMatch(
    src,
    /Ticket ceiling \$1,000/,
    "no hardcoded Ticket ceiling $1,000 remains",
  );
  assert.match(src, /0DTE gamma on a \$\$\{RH_MAX_DEBIT_TOTAL\} ticket/);
});
