import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "tsx/esm/api";
register();
const r = await import("../src/lib/trading/rule1.ts");
const d = await import("../src/lib/trading/rule1-d70.ts");
const h = await import("../src/lib/desk/rules-hash.ts");
const ms = await import("../src/lib/smc/master-seat.ts");
const bars = JSON.parse(readFileSync("tests/fixtures/bars-1m-2026-10-13.json", "utf8"));
const walk = (sym) => {
  const m1 = bars[sym];
  for (const b of m1) { const { min, day } = r.ctParts(b.t); if (day !== "2026-10-13" || min < 510 || min > 545) continue; const tk = r.rule1Ticket(sym, m1, b.t + 60_000); if (tk) return tk; }
  return null;
};
test("10/13 MNQ Rule 1: shadow Δ0.7 0DTE ticket sits next to the current ticket, current ticket unchanged", () => {
  const tk = walk("MNQ"); const t = tk.ticketD70;
  assert.equal(t.mode, "shadow"); assert.equal(t.live, false);
  assert.equal(t.d70.delta, 0.7); assert.equal(t.d70.dte, 0); assert.equal(t.d70.right, "call"); assert.equal(t.atm.delta, 0.5);
  assert.ok(t.d70.strike < t.atm.strike, "Δ0.7 call is in the money vs ATM");
  assert.ok(t.d70.premium > t.atm.premium);
  for (const l of [t.d70, t.atm]) { assert.ok(l.capBlocked || (l.contracts >= 1 && l.contracts <= 4 && l.debit <= 650)); }
  assert.equal(tk.option.delta, 0.6);   // the existing shadow ticket is untouched
});
test("Δ0.7 leg: model delta is 0.70 for calls and puts; a 1-lot over the cap is a no-trade on legAt", () => {
  for (const side of ["long", "short"]) {
    const l = d.legAt(0.7, "ES", side, 6700, 6, 525, null);
    assert.equal(l.dte, 0); assert.equal(l.right, side === "long" ? "call" : "put");
    assert.ok(side === "long" ? l.strike < 6700 * 0.0917 : l.strike > 6700 * 0.0917);
  }
  const big = d.legAt(0.7, "NQ", "long", 25000, 400, 520, 2000);
  assert.equal(big.capBlocked, true); assert.equal(big.contracts, 0); assert.equal(big.debit, 0);
});
test("shadow step-down: when Δ0.7 1-lot is over $650, pick Δ0.6 then ATM (overnight line 156)", () => {
  // Find an underlier price where Δ0.7 1-lot > $650 but a cheaper delta fits.
  let stepped = null;
  for (let S = 400; S <= 1200; S += 10) {
    const d70 = d.legAt(0.7, "NQ", "long", 25000, 80, 520, S);
    const d60 = d.legAt(0.6, "NQ", "long", 25000, 80, 520, S);
    if (d70 && d60 && d70.capBlocked && !d60.capBlocked) {
      stepped = d.pickShadowLeg("NQ", "long", 25000, 80, 520, S);
      assert.equal(stepped.delta, 0.6);
      assert.equal(stepped.steppedFrom, 0.7);
      assert.equal(stepped.capBlocked, false);
      assert.ok(stepped.contracts >= 1 && stepped.debit <= 650);
      const full = d.rule1D70("NQ", "long", 25000, 80, 520, S);
      assert.equal(full.d70.delta, 0.6);
      assert.equal(full.d70.steppedFrom, 0.7);
      assert.equal(full.atm.delta, 0.5);
      const line = d.rule1D70Line({ symbol: "NQ", side: "long", ticketD70: full });
      assert.ok(line.includes("Δ0.7→0.6") && line.includes("(shadow, no order)"));
      assert.equal((line.match(/Δ0\.7→0\.6/g) || []).length, 1);
      assert.equal(line.includes("(stepped"), false);
      break;
    }
  }
  assert.ok(stepped, "expected a price where Δ0.7 is over the cap and Δ0.6 fits");

  // When every step (incl. ATM) is over the cap, still capBlocked / no trade.
  const allBlocked = d.pickShadowLeg("NQ", "long", 25000, 400, 520, 2000);
  assert.equal(allBlocked.capBlocked, true);
  assert.equal(allBlocked.contracts, 0);
});
test("shadow step-down: when Δ0.7 and Δ0.6 are over $650, pick ATM (overnight line 156)", () => {
  let stepped = null;
  for (const atr of [40, 60, 80, 100]) {
    for (let S = 400; S <= 3000; S += 5) {
      const d70 = d.legAt(0.7, "NQ", "long", 25000, atr, 520, S);
      const d60 = d.legAt(0.6, "NQ", "long", 25000, atr, 520, S);
      const atm = d.legAt(0.5, "NQ", "long", 25000, atr, 520, S);
      if (d70 && d60 && atm && d70.capBlocked && d60.capBlocked && !atm.capBlocked) {
        stepped = d.pickShadowLeg("NQ", "long", 25000, atr, 520, S);
        assert.equal(stepped.delta, 0.5);
        assert.equal(stepped.steppedFrom, 0.7);
        assert.equal(stepped.capBlocked, false);
        assert.ok(stepped.contracts >= 1 && stepped.debit <= 650);
        const full = d.rule1D70("NQ", "long", 25000, atr, 520, S);
        assert.equal(full.d70.delta, 0.5);
        assert.equal(full.d70.steppedFrom, 0.7);
        assert.equal(full.atm.delta, 0.5);
        const line = d.rule1D70Line({ symbol: "NQ", side: "long", ticketD70: full });
        assert.ok(line.includes("Δ0.7→0.5") && line.includes("(shadow, no order)"));
        // Step tag appears once (not also as "(stepped Δ…)" inside the leg text).
        assert.equal((line.match(/Δ0\.7→0\.5/g) || []).length, 1);
        break;
      }
    }
    if (stepped) break;
  }
  assert.ok(stepped, "expected a price where Δ0.7 and Δ0.6 are over the cap and ATM fits");
});
test("brain seat shows the line (narrative only, verdict/checks unchanged)", () => {
  const tk = walk("MNQ");
  const base = { card: { symbol: "MNQ", side: "long", band: "B+", q: 0.6, actionable: true, entry: 1, entryResting: false, stopPx: 0.5, target: 2, rr: 2, chop: false, bias1h: "bull", bias4h: "bull", dispScore: 0.6, ltfKilled: false, reversal: null }, brainWord: "WAIT", brainBook: null, floorVerdict: "WATCH", align: 1, smtLead: null, shockActive: false, topDraw: null, governor: "normal" };
  const a = ms.masterSeat(base), b = ms.masterSeat({ ...base, rule1: [tk] });
  assert.equal(a.verdict, b.verdict); assert.deepEqual(a.checks, b.checks);
  assert.ok(b.narrative.some((x) => x.startsWith("Rule1 shadow MNQ long:") && x.includes("0DTE") && x.includes("(shadow, no order)")));
});
test("rules hash unchanged: the Δ0.7 config is outside shared/desk-rules.json", () => {
  const rules = readFileSync("shared/desk-rules.json", "utf8");
  assert.equal(rules.includes("rule1-d70") || rules.includes("ticketD70"), false);
  assert.equal(h.RULES_HASH, "00abb519533e1350");
  assert.equal(JSON.parse(readFileSync("shared/rule1-d70.json", "utf8")).live, false);
  assert.deepEqual(JSON.parse(readFileSync("shared/rule1-d70.json", "utf8")).stepDownDeltas, [0.6, 0.5]);
});
