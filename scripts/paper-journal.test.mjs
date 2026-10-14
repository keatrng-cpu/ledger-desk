import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "tsx/esm/api";
register();
const p = await import("../src/lib/desk/paper-journal.ts");
test("paper rows must carry source=paper-futures and a futures symbol", () => {
  assert.equal(p.safePaperRow({ id: "a", source: "live", symbol: "ES", side: "long" }).ok, false);
  assert.equal(p.safePaperRow({ id: "a", source: "paper-futures", symbol: "SPY", side: "long" }).ok, false);
  assert.equal(p.safePaperRow({ id: "a", source: "paper-futures", symbol: "ES", side: "long" }).ok, true);
});
test("paper auth: dedicated token only, no CRON_SECRET fallback", () => {
  assert.equal(p.paperAuthorized("Bearer x", { CRON_SECRET: "x" }), false);
  assert.equal(p.paperAuthorized("Bearer k", { PAPER_JOURNAL_TOKEN: "k" }), true);
  assert.equal(p.paperAuthorized("Bearer z", { PAPER_JOURNAL_TOKEN: "k" }), false);
});
test("live learning reads exclude paper; band edges stay floored at baseline", () => {
  const s = readFileSync(new URL("../src/lib/desk/learning.ts", import.meta.url), "utf8");
  assert.match(s, /status in \('win','loss','timeout','right','wrong','flat'\) and source <> 'paper-futures'/);
  assert.match(s, /Math\.max\(lo, Math\.min\(hi, to\)\)/);
  assert.doesNotMatch(readFileSync(new URL("../src/lib/desk/paper-journal.ts", import.meta.url), "utf8"), /desk_card_snap|desk_calibration/);
});
test("GET and POST both require the paper token; unset token fails closed", () => {
  assert.equal(p.paperAuthorized("Bearer k", {}), false);
  assert.equal(p.paperAuthorized(null, { PAPER_JOURNAL_TOKEN: "k" }), false);
  assert.equal(p.paperAuthorized("Bearer ", { PAPER_JOURNAL_TOKEN: "" }), false);
  const r = readFileSync(new URL("../src/routes/api/desk/paper-journal.ts", import.meta.url), "utf8");
  assert.match(r, /async function get\(\{ request \}[^]*?if \(!paperAuthorized\(request\.headers\.get\("authorization"\)\)\) return jsonResponse\(\{ ok: false, error: "Unauthorized" \}, 401/);
  assert.equal((r.match(/paperAuthorized\(request/g) || []).length, 2);
});
