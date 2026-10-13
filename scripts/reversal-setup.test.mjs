import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "tsx/esm/api";
register();
const m = await import("../src/lib/smc/mtf-context.ts");
// Live MNQ card 2026-10-13 ~10:59 ET: 15m/30m/1h BSL sweep 30774.25, 1m–5m all
// bear CHoCH/BOS, MNQ long killed — yet the card read ES long.
const card = JSON.parse(readFileSync(new URL("./fixtures/card-2026-10-13-mnq-bsl-sweep.json", import.meta.url)));
const parse = (b) => ({
  symbol: b.symbol,
  align: b.align,
  ltfReversals: b.ltfReversals ?? [],
  ltfReversal: b.ltfReversal ?? null,
  rungs: b.rungs.map((r) => {
    const s = r.structure?.match(/^(BOS|CHoCH) (bull|bear) (\d+)b$/);
    const w = r.sweep?.match(/^(SSL|BSL) ([\d.]+) (\d+)b$/);
    return {
      tf: r.tf, bias: r.bias, bars: 0, arrays: r.arrays,
      structure: s ? { kind: s[1], dir: s[2], ageBars: +s[3] } : null,
      sweep: w ? { side: w[1] === "SSL" ? "sellside" : "buyside", level: +w[2], ageBars: +w[3] } : null,
    };
  }),
});
const mnq = parse(card.wire.mtf.books.find((b) => b.symbol === "MNQ"));
test("fixture: MNQ long is killed", () => {
  assert.ok(mnq.ltfReversals.some((r) => r.against === "long" && !r.rearmed));
});
test("fix 26: HTF BSL sweep + LTF bear CHoCH releases the MNQ short", () => {
  const r = m.reversalSetupOf(mnq).find((x) => x.side === "short");
  assert.ok(r?.htfRelease);
  assert.match(r.why[0], /BSL sweep 30774.25/);
});
test("fix 27: 1m–5m all broke bear → reversal setup", () => {
  const r = m.reversalSetupOf(mnq).find((x) => x.side === "short");
  assert.ok(r.ltfBreaks >= m.LTF_BREAKS_FOR_REVERSAL);
});
test("no release for the long (no SSL HTF sweep)", () => {
  assert.equal(m.reversalSetupOf(mnq).find((x) => x.side === "long")?.htfRelease ?? false, false);
});
