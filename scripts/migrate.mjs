#!/usr/bin/env node
/**
 * Deploy-time database migrator (node-postgres, `pg`).
 *
 * Runs during `npm run build` — on every Vercel deploy — applying pending files
 * in ../migrations to DATABASE_URL. Each file is applied in one transaction and
 * recorded in a `_migrations` table, so it runs once and is safe to re-run.
 *
 * No DATABASE_URL (local / preview builds) -> skip; the PGLite fallback applies
 * the same files at startup instead (see src/lib/db.ts).
 */
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";

/**
 * Connection string for MIGRATIONS, in priority order.
 *
 * Direct (non-pooling) first, deliberately: DDL through a transaction-mode
 * pooler like pgbouncer is unreliable — prepared statements and session state
 * do not survive it, which is how a migration half-applies. Runtime queries
 * want the opposite (pooled), so src/lib/db.ts orders these differently on
 * purpose.
 *
 * Accepting the managed-integration names means connecting Vercel's Supabase
 * or Neon integration migrates on the next build with no manual env entry.
 */
const MIGRATION_URL_VARS = [
  "POSTGRES_URL_NON_POOLING",
  "DATABASE_URL_UNPOOLED",
  "DATABASE_URL",
  "SUPABASE_DB_URL",
  "NETLIFY_DATABASE_URL_UNPOOLED",
  "NETLIFY_DATABASE_URL",
  "POSTGRES_URL",
];

let databaseUrl;
let urlVar;
for (const name of MIGRATION_URL_VARS) {
  const raw = process.env[name];
  if (raw && raw.trim()) {
    databaseUrl = raw.trim();
    urlVar = name;
    break;
  }
}

if (!databaseUrl) {
  console.log(
    `[migrate] no connection string (checked ${MIGRATION_URL_VARS.join(", ")}) — skipping; the PGLite fallback migrates itself.`,
  );
  process.exit(0);
}
console.log(`[migrate] using ${urlVar}`);

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");

async function main() {
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
  const client = await pool.connect();
  try {
    await client.query(
      "CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())",
    );
    const applied = new Set(
      (await client.query("SELECT name FROM _migrations")).rows.map((r) => r.name),
    );

    let files;
    try {
      files = (await readdir(migrationsDir)).filter((f) => f.endsWith(".sql")).sort();
    } catch {
      console.log("[migrate] no migrations/ directory — nothing to do.");
      return;
    }

    let count = 0;
    for (const name of files) {
      if (applied.has(name)) continue;
      const text = await readFile(join(migrationsDir, name), "utf8");
      try {
        await client.query("BEGIN");
        // pg's simple-query protocol runs a whole multi-statement file at once.
        await client.query(text);
        await client.query("INSERT INTO _migrations (name) VALUES ($1)", [name]);
        await client.query("COMMIT");
      } catch (err) {
        console.error(`[migrate] error applying ${name}`);
        try {
          await client.query("ROLLBACK");
        } catch {
          // ROLLBACK fails when the connection died — keep the original error.
        }
        throw err;
      }
      console.log(`[migrate] applied ${name}`);
      count += 1;
    }
    console.log(count ? `[migrate] done — ${count} migration(s) applied.` : "[migrate] up to date.");
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error("[migrate] failed:", err?.message || err);
  // pg errors carry the context needed to debug a bad SQL file.
  for (const key of ["code", "detail", "hint", "position", "where"]) {
    if (err?.[key] != null) console.error(`[migrate]   ${key}: ${err[key]}`);
  }
  process.exit(1);
});
