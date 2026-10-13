import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "tsx/esm/api";
register();
const sm = await import("../src/lib/trading/smc-master.ts");
const card = JSON.parse(readFileSync(new URL("./fixtures/card-2026-10-13-1201ct-mnq-short-noplan.json", import.meta.url)));
test("12:01 CT: brain's draw = Midnight open 30675 from wire.draws (it said 'Draw on liquidity' missing)", () => {
  const price = card.quotes.left.price;
  const pick = sm.brainDrawPick(card.wire.draws, "short", price);
  assert.equal(pick.name, "Midnight open"); assert.equal(pick.price, 30675);
});
test("brain draw and completePlan's target pool agree on the same list", async () => {
  const ex = await import("../src/lib/smc/exec-context.ts");
  const price = card.quotes.left.price;
  const draws = card.wire.draws;
  const pick = sm.brainDrawPick(draws, "short", price);
  const p = ex.planAt("MNQ", "short", { lo: 30738, hi: 30742, ce: 30740 }, 30770, "x", price, draws, 60, "t");
  assert.equal(p.t1, pick.price);
});
test("nothing on the side → null (layer waits/fails, no invented magnet); swept draws skipped", () => {
  const d = [{ name: "A", price: 110, side: "above", scope: null, touches: 0, ageBars: null, distanceAtr: 1, swept: false, rank: 0.9 },
             { name: "B", price: 90, side: "below", scope: null, touches: 0, ageBars: null, distanceAtr: 1, swept: true, rank: 0.9 }];
  assert.equal(sm.brainDrawPick(d, "short", 100), null);
  assert.equal(sm.brainDrawPick(d, "long", 100).name, "A");
  assert.equal(sm.brainDrawPick(d, null, 100), null);
});
