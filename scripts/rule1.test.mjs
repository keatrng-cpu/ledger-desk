import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { register } from "tsx/esm/api";
register();
const r = await import("../src/lib/trading/rule1.ts");
const h = await import("../src/lib/desk/rules-hash.ts");
const bars = JSON.parse(readFileSync("tests/fixtures/bars-1m-2026-10-13.json", "utf8"));
const walk = (sym) => {
  const m1 = bars[sym];
  for (const b of m1) { const { min, day } = r.ctParts(b.t); if (day !== "2026-10-13" || min < 510 || min > 545) continue; const tk = r.rule1Ticket(sym, m1, b.t + 60_000); if (tk) return tk; }
  return null;
};
test("10/13 replay: Rule 1 fires MNQ long at 08:40 CT off the ON low, ES does not", () => {
  const tk = walk("MNQ");
  assert.ok(tk); assert.equal(tk.side, "long"); assert.equal(tk.swept, "ONL"); assert.equal(r.ctParts(tk.at).min, 520); assert.equal(tk.bonus, true);
  assert.ok(Math.abs(tk.target - (tk.entry + 3 * tk.riskPts)) <= 0.02); assert.equal(tk.mode, "shadow");
  assert.ok(tk.option.delta >= 0.5 && tk.option.delta <= 0.7); assert.ok(tk.option.contracts >= 1 && tk.option.contracts <= 4); assert.ok(tk.option.premium * 100 * tk.option.contracts <= 650);
  assert.equal(walk("ES"), null);
});
test("TS ↔ Python parity on the 10/13 fixture", () => {
  const py = JSON.parse(execFileSync("python3", ["-c", `
import json,sys; sys.path.insert(0,'scripts'); import rule1 as R
b=json.load(open('tests/fixtures/bars-1m-2026-10-13.json'))
print(json.dumps({r['symbol']: r.get('ticket') for r in R.replay(b,'2026-10-13')}))`], { encoding: "utf8" }));
  for (const sym of ["MNQ", "ES"]) {
    const ts = walk(sym), p = py[sym] ?? null;
    if (!ts) { assert.equal(p, null); continue; }
    for (const k of ["side", "at", "swept", "level", "entry", "stop", "riskPts", "target", "runner", "bonus"]) assert.equal(ts[k], p[k], k);
    for (const k of ["strike", "contracts", "dte", "underlier", "right"]) assert.equal(ts.option[k], p.option[k], "option." + k);
    assert.ok(Math.abs(ts.option.premium - p.option.premium) <= 0.01);
  }
});
test("no ticket outside 08:30–09:00 CT and no look-ahead (bars after now are ignored)", () => {
  const m1 = bars.MNQ; const at = walk("MNQ").at;
  assert.equal(r.rule1Ticket("MNQ", m1, at - 60_000), null);
  assert.deepEqual(r.rule1Ticket("MNQ", m1.filter((b) => b.t < at), at), r.rule1Ticket("MNQ", m1, at));
});
test("rules hash unchanged: Rule 1 lives outside shared/desk-rules.json", () => {
  const rules = JSON.parse(readFileSync("shared/desk-rules.json", "utf8"));
  assert.equal(JSON.stringify(rules).includes("rule1"), false);
  assert.equal(h.RULES_HASH, "3de8579d25237421");
});
