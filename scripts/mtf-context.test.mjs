import { test } from "node:test";
import assert from "node:assert/strict";
import { register } from "tsx/esm/api";
register();
const m = await import("../src/lib/smc/mtf-context.ts");
const T0 = Date.UTC(2026, 9, 12, 13, 30);
function series(n, stepMs, f) { const out = []; for (let i = 0; i < n; i++) { const c = f(i); out.push({ t: T0 + i * stepMs, o: c - 1, h: c + 2, l: c - 2, c }); } return out; }
test("every rung read, alignment in [0,1], wire shape", () => {
  const up = (i) => 100 + i * 3;
  const ctx = m.buildMtfContext(
    { symbol: "MES", minute: series(300, 60e3, up), bars15: series(400, 900e3, up) },
    { symbol: "MNQ", minute: series(300, 60e3, up), bars15: series(400, 900e3, up) },
  );
  assert.equal(ctx.books.length, 2);
  const tfs = ctx.books[0].rungs.map((r) => r.tf);
  for (const tf of ["1m", "5m", "15m", "1h", "4h"]) assert.ok(tfs.includes(tf), tf);
  for (const b of ctx.books) for (const s of ["long", "short"]) assert.ok(b.align[s].score >= 0 && b.align[s].score <= 1);
  const w = m.wireMtf(ctx);
  assert.ok(Array.isArray(w.books) && Array.isArray(w.smt));
});
test("smtFightsContinuation: failing book's continuation only", () => {
  const ctx = { books: [], smt: [], smtLead: { tf: "5m", kind: "bearish", leader: "MNQ", failing: "MES", ageBars: 1 } };
  assert.ok(m.smtFightsContinuation(ctx, "MES", "long"));
  assert.equal(m.smtFightsContinuation(ctx, "MES", "short"), null);
  assert.equal(m.smtFightsContinuation(ctx, "MNQ", "long"), null);
});
