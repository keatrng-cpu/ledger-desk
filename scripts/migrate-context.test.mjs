/** scripts/migrate.mjs: deploy previews (Netlify CONTEXT != production) must never migrate the prod database. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
const SCRIPT = fileURLToPath(new URL("./migrate.mjs", import.meta.url));
// A connection string to a closed local port: if the migrator ever tried to connect it would fail (exit 1), never touch a real database.
const DEAD = "postgres://nobody:nothing@127.0.0.1:1/none";
const URL_VARS = ["POSTGRES_URL_NON_POOLING", "DATABASE_URL_UNPOOLED", "SUPABASE_DATABASE_URL", "NETLIFY_DATABASE_URL_UNPOOLED", "DATABASE_URL", "NETLIFY_DATABASE_URL", "POSTGRES_URL", "SUPABASE_DB_URL"];
function run(context) {
  const env = { PATH: process.env.PATH, HOME: process.env.HOME, PGCONNECT_TIMEOUT: "2" };
  for (const k of URL_VARS) env[k] = DEAD;
  if (context !== undefined) env.CONTEXT = context;
  return spawnSync(process.execPath, [SCRIPT], { env, encoding: "utf8", timeout: 30_000 });
}
test("guard sits near the top, before any connection code", () => {
  const src = readFileSync(SCRIPT, "utf8");
  const g = src.indexOf("if (process.env.CONTEXT && process.env.CONTEXT !== 'production') process.exit(0)");
  assert.ok(g > 0, "guard line present verbatim");
  assert.ok(g < src.indexOf("MIGRATION_URL_VARS"), "guard runs before the connection string is resolved");
});
for (const ctx of ["deploy-preview", "branch-deploy", "dev"]) {
  test(`CONTEXT=${ctx}: exits 0 without connecting`, () => {
    const r = run(ctx);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout + r.stderr, "", "no migrate output: nothing was attempted");
  });
}
test("CONTEXT=production: still migrates (tries the connection; the dead URL fails it)", () => {
  const r = run("production");
  assert.notEqual(r.status, 0, "production must not be skipped by the guard");
});
test("CONTEXT unset (local / CI): unchanged behaviour (tries the connection)", () => {
  const r = run(undefined);
  assert.notEqual(r.status, 0);
});
