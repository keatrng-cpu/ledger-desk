import { test } from "node:test";
import assert from "node:assert/strict";
import { register } from "tsx/esm/api";
register();
const s = await import("../src/lib/smc/seq/scenarios.ts");
const S = (id, dist, prior) => ({ id, dist, sweep: "high", trigger: null, invalid: "", draws: [], prior });
const read = { mode: "shadow", symbol: "ES", ranked: [S("S1-bear", "down", 0.4), S("S2-bear", "down", 0.3), S("S1'-bull", "up", 0.2), S("S2'-bull", "up", 0.1)] };
const map = { range: { eq: 6700 } };
const t930 = Date.parse("2026-10-15T13:30:00Z"); // 09:30 ET
test("open body-closes through the flip against the plan: re-rank on that 1m close", () => {
  const bars = [{ t: t930, o: 6698, c: 6699 }, { t: t930 + 60_000, o: 6699, c: 6703 }];
  const r = s.rerankOnOpen(read, map, bars, t930 + 120_000);   // the second bar has JUST closed
  assert.equal(r.rerank.atT, t930 + 60_000); assert.equal(r.ranked[0].dist, "up"); assert.equal(r.rerank.from, "S1-bear");
});
test("still-forming bar does not count; agreeing close does not re-rank", () => {
  assert.equal(s.rerankOnOpen(read, map, [{ t: t930, o: 6699, c: 6703 }], t930 + 30_000).rerank, undefined);
  assert.equal(s.rerankOnOpen(read, map, [{ t: t930, o: 6701, c: 6697 }], t930 + 60_000).rerank, undefined);
});
test("premarket bars never re-rank", () => {
  assert.equal(s.rerankOnOpen(read, map, [{ t: t930 - 600_000, o: 6699, c: 6703 }], t930 + 60_000).rerank, undefined);
});
