/**
 * Accuracy 10/19 (display only — no gate, no hash change):
 *  1. the swing ticket's "no ticket" block names the real refusal: contractsWithinRisk(premium, 650, 150) = 0 is the
 *     $150 sleeve risk budget with no priced level, not "too rich for $650";
 *  2. blocks the Floor borrows from the swing card (smt_lead, 5 DTE) when no day card is WATCH/ARMED read "swing card: …".
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { register } from "tsx/esm/api";
import { readFileSync } from "node:fs";
register();
const O = await import("../src/lib/trading/options-desk.ts");
const { swingLabeled } = await import("../src/lib/trading/desk-listen.ts");

test("swing no-ticket block: risk budget (0 within risk), not 'too rich for $650'", () => {
  // find a spot where the 5 DTE single fits $650 but one contract's loss at the brake is over $150
  let spot = null;
  for (let s = 100; s <= 2000 && spot == null; s += 5) {
    const prem = O.estimateDebitContract(s, 5, 0.35, O.IV.QQQ);
    if (!O.brakeIsClock(5) && prem <= 650 && O.contractsWithinRisk(prem, 650, 150) === 0) spot = s;
  }
  assert.ok(spot != null, "a risk-refused, debit-fitting 5 DTE premium exists");
  const why = O.swingNoTicketWhy({ underlier: "QQQ", dte: 5, spot, delta: 0.35, iv: O.IV.QQQ, cap: 650, riskBudget: 150, hasLevel: false });
  assert.match(why, /\$150 sleeve risk budget/);
  assert.match(why, /0 contracts within risk/);
  assert.match(why, /no priced level/);
  assert.doesNotMatch(why, /too rich/);
  // a premium genuinely over the debit cap still says "too rich"
  const rich = O.swingNoTicketWhy({ underlier: "QQQ", dte: 5, spot: 50_000, delta: 0.35, iv: O.IV.QQQ, cap: 650, riskBudget: 150, hasLevel: false });
  assert.ok(O.brakeIsClock(5) ? /risk budget/.test(rich) : /too rich for \$650/.test(rich));
  const src = readFileSync(new URL("../src/lib/trading/options-desk.ts", import.meta.url), "utf8");
  assert.ok(!src.includes("too rich for $${cap} — would need a lottery Δ"), "the old always-'too rich' line is gone");
  assert.ok(src.includes("blocks.push(swingNoTicketWhy({"));
});

test("Floor blocks borrowed from the swing card are labelled 'swing card:'", () => {
  const b = ["5 DTE QQQ: no ticket — …", "Brain is standing. SMT does not take the other book."];
  assert.deepEqual(swingLabeled(b, true), ["swing card: 5 DTE QQQ: no ticket — …", "swing card: Brain is standing. SMT does not take the other book."]);
  assert.deepEqual(swingLabeled(b, false), b);                                   // day cards untouched
  assert.deepEqual(swingLabeled(["swing card: x"], true), ["swing card: x"]);    // never double-prefixed
  // no 1h/4h substring is introduced (the watcher's htf text scan reads these strings)
  assert.ok(!/1h|4h|one-hour|four-hour/i.test(swingLabeled(["x"], true)[0]));
  const dl = readFileSync(new URL("../src/lib/trading/desk-listen.ts", import.meta.url), "utf8");
  assert.equal((dl.match(/blocks: \[\.\.\.tk\.blocks, \.\.\.shownBlocks\]\.slice\(0, 4\)/g) ?? []).length, 2);
  assert.ok(dl.includes('shown.horizon === "swing" || floor.swing.includes(shown)'));
});
