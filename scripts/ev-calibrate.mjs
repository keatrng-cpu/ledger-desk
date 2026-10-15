#!/usr/bin/env node
// evFire calibration table (nightly): P(T1 before stop, flat 14:50 CT) by (q bucket, rungs>=5, htf not opposing),
// shrunk to the global rate with a prior. Input: JSONL of {day, q, rungs, htfOk, hitT1} (shadow/replay outcomes).
// Keeps the last calibration.windowDays trading days. Writes shared/ev-calibration.json; prints the table hash to pin
// in shared/desk-rules.json evFire.calibration.tableHash. Usage: node scripts/ev-calibrate.mjs samples.jsonl [out.json]
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
const RULES = JSON.parse(readFileSync(new URL("../shared/desk-rules.json", import.meta.url)));
const C = RULES.evFire.calibration;
export const keyOf = (q, rungs, htfOk) => `${Math.min(Math.floor(q / C.bucket + 1e-9), Math.floor(0.75 / C.bucket))}|${rungs >= 5 ? 1 : 0}|${htfOk ? 1 : 0}`;
export function buildTable(samples, asOf = null) {
  const days = [...new Set(samples.map((s) => s.day))].sort().slice(-C.windowDays);
  const keep = samples.filter((s) => days.includes(s.day));
  const n = keep.length, g = n ? keep.filter((s) => s.hitT1).length / n : 0;
  const cells = {};
  for (const s of keep) { const k = keyOf(s.q, s.rungs, s.htfOk); (cells[k] ??= [0, 0]); cells[k][0] += s.hitT1 ? 1 : 0; cells[k][1] += 1; }
  const p = Object.fromEntries(Object.entries(cells).sort().map(([k, [h, m]]) => [k, { n: m, hits: h, p: +((h + C.prior * g) / (m + C.prior)).toFixed(4) }]));
  const body = { version: 1, asOf, days: days.length ? [days[0], days.at(-1), days.length] : null, n, global: +g.toFixed(4), prior: C.prior, bucket: C.bucket, trained: n >= C.minSamples, cells: p };
  return { ...body, hash: tableHash(body) };
}
export function tableHash(t) {
  const { hash: _h, ...b } = t;
  return createHash("sha256").update(canon(b)).digest("hex").slice(0, 16);
}
/** Sorted-key compact JSON (same bytes as Python json.dumps(sort_keys=True, separators=(",", ":"))). */
export function canon(v) {
  if (Array.isArray(v)) return `[${v.map(canon).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(",")}}`;
  return JSON.stringify(v);
}
if (import.meta.url === `file://${process.argv[1]}`) {
  const [inp, out = new URL("../shared/ev-calibration.json", import.meta.url).pathname] = process.argv.slice(2);
  const samples = readFileSync(inp, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const t = buildTable(samples, new Date().toISOString().slice(0, 10));
  writeFileSync(out, JSON.stringify(t, null, 1) + "\n");
  console.log(JSON.stringify({ out, n: t.n, trained: t.trained, hash: t.hash }));
}
