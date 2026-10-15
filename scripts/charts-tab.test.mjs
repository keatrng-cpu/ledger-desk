import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { register } from "tsx/esm/api";
register();
const tc = await import("../src/lib/desk/trade-charts.ts");

const row = (id, fill_t, R) => ({ id, day: fill_t.slice(0, 10), symbol: "ES", side: "long", source: "live_rh", fill_t, R, png: `${fill_t.slice(0, 10)}/${id}.png`, json: `${fill_t.slice(0, 10)}/${id}.json` });

test("charts tab: newest first + win/loss filter", () => {
  const rows = [row("a", "2026-10-14T07:31:16-05:00", 0.4), row("b", "2026-10-15T13:02:10-05:00", -1), row("c", "2026-10-15T08:00:00-04:00", 0)];
  assert.deepEqual(tc.filterRows(rows, "all").map((r) => r.id), ["b", "c", "a"]);
  assert.deepEqual(tc.filterRows(rows, "win").map((r) => r.id), ["a"]);
  assert.deepEqual(tc.filterRows(rows, "loss").map((r) => r.id), ["b"]);
});

test("charts tab: only same-origin /trade-charts/<day>/<name>.png|json is fetched", () => {
  assert.equal(tc.chartUrl("2026-10-15/sig-85e8feddd99efe46.png"), "/trade-charts/2026-10-15/sig-85e8feddd99efe46.png");
  for (const bad of ["../.env", "2026-10-15/../../x.png", "https://evil/x.png", "2026-10-15/.x.json", "2026-10-15/a.js"]) assert.equal(tc.chartUrl(bad), "");
});

test("charts tab: read-only, published folder light and secret-free", () => {
  const src = readFileSync(new URL("../src/components/charts/charts-tab.tsx", import.meta.url), "utf8");
  assert.ok(!/method:\s*["'](POST|PUT|DELETE|PATCH)/i.test(src) && !/\/api\//.test(src), "static GETs only");
  const dir = new URL("../public/trade-charts/", import.meta.url).pathname;
  if (!existsSync(dir)) return;
  let total = 0; const walk = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); const s = statSync(p); if (s.isDirectory()) walk(p); else { total += s.size; assert.ok(s.size <= 450_000, `${f} over cap`); if (f.endsWith(".json")) assert.ok(!/account|token|secret|password|api_key/i.test(readFileSync(p, "utf8")), `${f} leaks`); } } };
  walk(dir); assert.ok(total <= 20_000_000, `public/trade-charts ${total} bytes`);
  const idx = JSON.parse(readFileSync(join(dir, "index.json"), "utf8"));
  assert.ok(idx.trades.length > 0 && idx.trades.every((t) => tc.chartUrl(t.png) && tc.chartUrl(t.json)));
});
