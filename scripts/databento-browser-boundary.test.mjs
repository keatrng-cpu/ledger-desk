import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { register } from "tsx/esm/api";

register();
const { aggregateBars, frontQuarterly } = await import("../src/lib/market/bars.ts");
const { fetchDatabentoBars } = await import("../src/lib/market/databento.ts");

test("databento keeps Node fs/path behind the async server boundary", () => {
  const source = readFileSync("src/lib/market/databento.ts", "utf8");
  assert.doesNotMatch(source, /^import .*from ["']node:(?:fs|path)["'];?$/m);
  assert.match(source, /if \(typeof window !== ["']undefined["']\) return ["']["'];/);
  assert.match(source, /import\(["']node:fs["']\)/);
  assert.match(source, /import\(["']node:path["']\)/);
  assert.match(source, /export async function hasDatabentoKey/);
  assert.doesNotMatch(source, /cachedApiKey\s*=\s*["']["']/);
  assert.match(source, /if \(parsed\) \{\s*cachedApiKey = \{ value: parsed,/);
  assert.match(source, /cachedApiKey\.expiresAt > now/);
});

test("client-reachable hashers stay independent of node:crypto", () => {
  const consumers = [
    "src/lib/desk/rules-hash.ts",
    "src/lib/journal/attest.ts",
  ];

  for (const path of consumers) {
    const source = readFileSync(path, "utf8");
    assert.match(source, /from ["']@\/lib\/hash\/sha256["']/, path);
    assert.doesNotMatch(source, /["']node:crypto["']/, path);
  }

  const implementation = readFileSync("src/lib/hash/sha256.ts", "utf8");
  assert.match(implementation, /from ["']@noble\/hashes\/sha2\.js["']/);
  assert.doesNotMatch(implementation, /["']node:crypto["']/);
});

test("client-reachable synchronous consumers use the pure bars module", () => {
  for (const path of [
    "src/lib/trading/build-desk.ts",
    "src/lib/trading/session-backtest.ts",
    "src/lib/trading/ltf-lead.ts",
    "src/lib/trading/ltf-reaction.ts",
  ]) {
    const source = readFileSync(path, "utf8");
    assert.match(source, /market\/bars|\.\/bars|\.\.\/market\/bars/, path);
  }

  const freshest = readFileSync("src/lib/market/freshest.ts", "utf8");
  assert.match(freshest, /export \{ aggregateBars \} from ["']\.\/bars["']/);
  assert.doesNotMatch(freshest, /export function aggregateBars/);

  const buildDesk = readFileSync("src/lib/trading/build-desk.ts", "utf8");
  const backtest = readFileSync("src/lib/trading/session-backtest.ts", "utf8");
  const liveLadder = readFileSync("src/lib/market/live-ladder.ts", "utf8");
  assert.match(buildDesk, /await hasDatabentoKey\(\)/);
  assert.match(backtest, /await hasDatabentoKey\(\)/);
  assert.match(liveLadder, /await hasDatabentoKey\(\)/);
});

test("pure bar helpers preserve contract roll and OHLC aggregation", () => {
  assert.equal(frontQuarterly("ES", new Date("2026-09-09T12:00:00Z")), "ESU6");
  assert.equal(frontQuarterly("ES", new Date("2026-09-10T12:00:00Z")), "ESZ6");

  assert.deepEqual(
    aggregateBars(
      [
        { t: 0, o: 10, h: 12, l: 9, c: 11, v: 2 },
        { t: 60_000, o: 11, h: 14, l: 10, c: 13, v: 3 },
        { t: 120_000, o: 13, h: 15, l: 12, c: 14, v: 5 },
      ],
      2,
    ),
    [
      { t: 0, o: 10, h: 14, l: 9, c: 13, v: 5 },
      { t: 120_000, o: 13, h: 15, l: 12, c: 14, v: 5 },
    ],
  );
});

test("an environment key still drives the real Databento fetch path", async () => {
  const oldKey = process.env.DATABENTO_API_KEY;
  const oldFetch = globalThis.fetch;
  const rows = Array.from({ length: 30 }, (_, i) => {
    const px = 5_000 + i;
    return `${new Date(Date.UTC(2026, 9, 16, 14, i)).toISOString()},${px},${px + 2},${px - 2},${px + 1},10`;
  });
  let authorization = "";

  process.env.DATABENTO_API_KEY = "test-key";
  globalThis.fetch = async (_url, init) => {
    authorization = new Headers(init?.headers).get("authorization") ?? "";
    return new Response(
      ["ts_event,open,high,low,close,volume", ...rows].join("\n"),
      { status: 200, headers: { "content-type": "text/csv" } },
    );
  };

  try {
    const series = await fetchDatabentoBars("ES", "1d", 1);
    assert.equal(authorization, "Basic dGVzdC1rZXk6");
    assert.equal(series?.source, "databento");
    assert.equal(series?.bars.length, 30);
  } finally {
    globalThis.fetch = oldFetch;
    if (oldKey === undefined) delete process.env.DATABENTO_API_KEY;
    else process.env.DATABENTO_API_KEY = oldKey;
  }
});
