import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { register } from "tsx/esm/api";

register();
const view = await import("../src/components/desk/shadow-view.ts");
const hash = await import("../src/lib/desk/rules-hash.ts");
const rule1 = await import("../src/lib/trading/rule1.ts");
const bars = JSON.parse(readFileSync("tests/fixtures/bars-1m-2026-10-13.json", "utf8"));

function ticket(sym) {
  const m1 = bars[sym];
  for (const b of m1) {
    const { min, day } = rule1.ctParts(b.t);
    if (day !== "2026-10-13" || min < 510 || min > 545) continue;
    const tk = rule1.rule1Ticket(sym, m1, b.t + 60_000);
    if (tk) return tk;
  }
  return null;
}

test("rules hash unchanged", () => {
  const rules = JSON.parse(readFileSync("shared/desk-rules.json", "utf8"));
  assert.equal(JSON.stringify(rules).includes("rule1"), false);
  assert.equal(hash.RULES_HASH, "a4bfcb65c88badcd");
});

test("q_v2 is read off the card, not recomputed", () => {
  const src = readFileSync("src/components/desk/shadow-panel.tsx", "utf8") + readFileSync("src/components/desk/shadow-view.ts", "utf8");
  assert.equal(src.includes("computeQV2"), false);
  assert.equal(src.includes("recordShadowOrder"), false);
  assert.equal(view.readCardQV2({ q_v2: { q: 0.71, band: "A-", deltas: [{ source: "keySweep", delta: 0.04 }], mode: "shadow", version: 2, vetoed: false } }).band, "A-");
  assert.equal(view.readCardQV2({}), null);
  assert.equal(view.readCardQV2({ q_v2: { band: "A" } }), null);
  assert.ok(Math.abs(view.qv2Delta(0.71, 0.74) - 0.03) < 1e-9);
  assert.equal(view.bandRelation("A-", "A"), "raise");
  assert.equal(view.bandRelation("A+", "B+"), "lower");
  assert.equal(view.bandRelation("A", "A"), "agree");
});

test("Rule 1 lines omit fields that are not on the ticket", () => {
  const tk = ticket("MNQ");
  assert.ok(tk);
  const ids = view.rule1Lines(tk).map((l) => l.id);
  for (const id of ["sweep", "displacement", "entry", "stop", "target"]) assert.ok(ids.includes(id), id);
  const partial = { ...tk, stop: Number.NaN, target: Number.NaN, runner: null, bodyAtr: Number.NaN, dispAt: Number.NaN, bonus: false };
  const left = view.rule1Lines(partial).map((l) => l.id);
  assert.deepEqual(left.includes("stop"), false);
  assert.deepEqual(left.includes("target"), false);
  assert.deepEqual(left.includes("displacement"), false);
  assert.ok(left.includes("sweep"));
  assert.ok(left.includes("entry"));
});

test("window, closed, and next session open", () => {
  const at = Date.parse("2026-10-13T13:40:00Z");
  assert.equal(view.ctParts(at).day, "2026-10-13");
  assert.equal(view.ctParts(at).min, 520);
  assert.equal(view.rule1Phase(at, at), "window");
  assert.equal(view.rule1Phase(Date.parse("2026-10-13T14:30:00Z"), at), "closed");
  assert.equal(view.rule1Phase(Date.parse("2026-10-14T13:29:00Z"), at), "closed");
  assert.equal(view.rule1Phase(Date.parse("2026-10-14T13:30:00Z"), at), "hidden");
  const fri = Date.parse("2026-10-16T13:40:00Z");
  assert.equal(view.rule1Phase(Date.parse("2026-10-17T18:00:00Z"), fri), "closed");
  assert.equal(view.rule1Phase(Date.parse("2026-10-19T13:30:00Z"), fri), "hidden");
  assert.equal(view.rule1Phase(at, null), "absent");
});

test("shadow R matches scripts/rule1.py outcome on the 10/13 fixture", () => {
  const py = JSON.parse(execFileSync("python3", ["-c", `
import json,sys
sys.path.insert(0,"scripts")
import rule1 as R
b=json.load(open("tests/fixtures/bars-1m-2026-10-13.json"))
print(json.dumps([{ "symbol": r["symbol"], "fired": r["fired"], "R": r.get("R"), "exit": r.get("exit") } for r in R.replay(b,"2026-10-13")]))
`], { encoding: "utf8" }));
  for (const row of py) {
    if (!row.fired) continue;
    const tk = ticket(row.symbol);
    const out = view.rule1ShadowOutcome(tk, bars[row.symbol]);
    assert.equal(out.r, row.R, row.symbol);
    assert.equal(out.exit, row.exit, row.symbol);
  }
  assert.equal(view.rule1ShadowOutcome(ticket("MNQ"), []).exit, "nodata");
});
