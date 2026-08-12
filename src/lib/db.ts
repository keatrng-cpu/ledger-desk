/** Which database backend is active. */
export type DbSource = "neon" | "pglite";

/**
 * Connection-string env vars, in priority order.
 *
 * WHY MORE THAN ONE: the managed integrations do not agree on a name, and
 * requiring exactly `DATABASE_URL` is how a correctly-provisioned database
 * still leaves the app silently running the throwaway in-memory fallback.
 *   - Vercel's Supabase/Neon integrations inject `POSTGRES_URL` (pooled) and
 *     `POSTGRES_URL_NON_POOLING` (direct).
 *   - Netlify's Neon extension injects `NETLIFY_DATABASE_URL`.
 *   - Supabase's own docs use `SUPABASE_DB_URL`.
 * Connect any of those and this app persists with ZERO manual env entry.
 *
 * Pooled first for runtime: serverless opens many short-lived connections and
 * a direct connection pool exhausts Postgres' connection limit fast.
 */
const RUNTIME_URL_VARS = [
  "DATABASE_URL",
  "POSTGRES_URL",
  "SUPABASE_DB_URL",
  "NETLIFY_DATABASE_URL",
  "POSTGRES_URL_NON_POOLING",
  "POSTGRES_PRISMA_URL",
] as const;

function firstConfigured(names: readonly string[]): {
  url: string | undefined;
  via: string | undefined;
} {
  if (typeof process === "undefined") return { url: undefined, via: undefined };
  for (const name of names) {
    const raw = process.env[name];
    // An empty/whitespace value (an easy misconfig in deploy UIs) means unset —
    // otherwise production silently runs on the throwaway fallback.
    if (raw && raw.trim()) return { url: raw.trim(), via: name };
  }
  return { url: undefined, via: undefined };
}

const resolved = firstConfigured(RUNTIME_URL_VARS);
const databaseUrl = resolved.url;

/** Which env var supplied the connection string (for storage-health / debug). */
export const databaseUrlVar: string | undefined = resolved.via;

/**
 * Active backend: real Postgres (Neon/Supabase/any) when one of
 * RUNTIME_URL_VARS is set, otherwise the embedded PGLite fallback so the app
 * still runs with nothing configured.
 *
 * The fallback now persists to disk locally (see PGLITE_DIR), but a serverless
 * filesystem is ephemeral and per-instance — a DEPLOYED build on the fallback
 * is still losing data on every cold start, which storage-health.ts reports
 * and the UI banner shows in red.
 */
export const dbSource: DbSource = databaseUrl ? "neon" : "pglite";

/**
 * Minimal shared SQL surface, satisfied by both Neon and PGLite. Both the
 * tagged-template and `.query()` forms resolve to an array of row objects:
 *
 *   const sql = await getSql();
 *   const rows = await sql`select * from todos where id = ${id}`; // parameterized
 *   const rows2 = await sql.query("select * from todos where id = $1", [id]);
 */
export interface Sql {
  <T = Record<string, unknown>>(
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<T[]>;
  query<T = Record<string, unknown>>(
    text: string,
    params?: unknown[],
  ): Promise<T[]>;
}

/**
 * Init state lives on globalThis as promises: dev HMR creates new instances of
 * this module, and two instances racing module-level state would open a second
 * pool or run two concurrent PGLite migration passes (whose duplicate
 * `_migrations` insert rejects — and would get memoized, poisoning every later
 * `getSql()`). A failed init clears its slot so the next call retries.
 */
const globalRef = globalThis as typeof globalThis & {
  __pgSqlPromise__?: Promise<Sql>;
  __pgliteInstance__?: Promise<import("@electric-sql/pglite").PGlite>;
  __pgliteMigrateChain__?: Promise<void>;
};

/**
 * Result-type parity: Postgres sends every value as text plus a type OID — the
 * JS value is the DRIVER's parsing choice, and pg and PGLite disagree (pg:
 * int8 -> string, date -> local-midnight Date; PGLite: int8 -> BigInt, which
 * JSON.stringify rejects, date -> UTC Date). Normalize both so preview and
 * production return identical, JSON-safe shapes:
 *   int8/bigint (incl. count(*)) -> number (past 2^53 loses precision — cast
 *                                   `::text` if you ever need huge integers)
 *   date                         -> 'YYYY-MM-DD' string
 *   interval                     -> Postgres interval text
 * numeric already comes back as a string on both (arbitrary precision).
 */
const OID_INT8 = 20;
const OID_DATE = 1082;
const OID_INTERVAL = 1186;
const identity = (v: string) => v;

type Run = <T>(text: string, params: unknown[]) => Promise<T[]>;

/** Wrap a query runner in the tagged-template + `.query()` `Sql` surface. */
function toSql(run: Run): Sql {
  const sql = (async <T = Record<string, unknown>>(
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<T[]> => {
    // Rebuild with $1, $2, … placeholders so values stay parameterized.
    let text = strings[0];
    for (let i = 0; i < values.length; i += 1) text += `$${i + 1}${strings[i + 1]}`;
    return run<T>(text, values);
  }) as unknown as Sql;
  sql.query = <T = Record<string, unknown>>(text: string, params: unknown[] = []) =>
    run<T>(text, params);
  return sql;
}

function createNeonSql(): Promise<Sql> {
  globalRef.__pgSqlPromise__ ??= (async () => {
    // Regular Postgres driver: node-postgres (`pg`) — works directly with Neon's
    // pooled endpoint. One pool per process; warm serverless instances reuse it.
    const { Pool, types } = await import("pg");
    types.setTypeParser(OID_INT8, Number);
    types.setTypeParser(OID_DATE, identity);
    types.setTypeParser(OID_INTERVAL, identity);
    const pool = new Pool({ connectionString: databaseUrl });
    return toSql(async <T>(text: string, params: unknown[]) => {
      const res = await pool.query(text, params);
      return res.rows as T[];
    });
  })().catch((err) => {
    globalRef.__pgSqlPromise__ = undefined;
    throw err;
  });
  return globalRef.__pgSqlPromise__;
}

/**
 * Where the PGLite fallback keeps its data.
 *
 * Constructing PGLite with no `dataDir` gives a purely IN-MEMORY database, so
 * every process restart destroyed the journal, the paper mirror, snapshots and
 * analytics — silently, because the app still renders perfectly on an empty
 * DB. Locally that meant losing the record on every dev-server restart.
 *
 * A dataDir fixes local development completely. It does NOT make a serverless
 * deployment durable: the filesystem there is ephemeral and per-instance, so a
 * deployed build still needs DATABASE_URL. `storage-health.ts` reports exactly
 * that, and the UI banner says so.
 *
 * Override with PGLITE_DATA_DIR; set it to ":memory:" to opt back into the old
 * throwaway behavior (useful for tests that want a guaranteed-clean DB).
 */
const PGLITE_DIR = process.env.PGLITE_DATA_DIR?.trim() || ".pglite";

async function createPgliteSql(): Promise<Sql> {
  // Embedded Postgres, imported on demand so it never loads on the Neon path.
  // One instance per process, shared across HMR module instances.
  globalRef.__pgliteInstance__ ??= (async () => {
    const { PGlite } = await import("@electric-sql/pglite");
    const memoryOnly = PGLITE_DIR === ":memory:";
    const pg = new PGlite({
      // Persist to disk so the record survives a restart. Serverless hosts get
      // a fresh filesystem per instance, which is why DATABASE_URL still
      // matters there — see storage-health.ts.
      ...(memoryOnly ? {} : { dataDir: PGLITE_DIR }),
      parsers: {
        [OID_INT8]: Number,
        [OID_DATE]: identity,
        [OID_INTERVAL]: identity,
      },
    });
    await pg.waitReady;
    await pg.exec(
      "create table if not exists _migrations (name text primary key, applied_at timestamptz not null default now())",
    );
    return pg;
  })().catch((err) => {
    globalRef.__pgliteInstance__ = undefined;
    throw err;
  });
  const pg = await globalRef.__pgliteInstance__;

  // Apply migrations/ (the single schema source) so preview matches production.
  // SQL is inlined by the bundler via import.meta.glob (no runtime fs); applied
  // files are tracked in _migrations. Runs once per module instance — so an HMR
  // reload after adding a migration file applies it live — with passes
  // serialized on a global chain so concurrent callers never double-apply.
  const migrate = async (): Promise<void> => {
    const migrations = import.meta.glob("/migrations/*.sql", {
      query: "?raw",
      import: "default",
      eager: true,
    }) as Record<string, string>;
    const doneRows = await pg.query<{ name: string }>(
      "select name from _migrations",
    );
    const done = new Set(doneRows.rows.map((r) => r.name));
    for (const [path, text] of Object.entries(migrations).sort(([a], [b]) =>
      a.localeCompare(b),
    )) {
      const name = path.split("/").pop() as string;
      if (done.has(name)) continue;
      // Apply + record atomically (parity with scripts/migrate.mjs) so a failed
      // statement can't leave a file half-applied but untracked.
      await pg.transaction(async (tx) => {
        await tx.exec(text);
        await tx.query("insert into _migrations (name) values ($1)", [name]);
      });
    }
  };
  const pass = (globalRef.__pgliteMigrateChain__ ?? Promise.resolve())
    .catch(() => undefined) // an earlier failed pass must not wedge the chain
    .then(migrate);
  globalRef.__pgliteMigrateChain__ = pass;
  await pass;

  return toSql(async <T>(text: string, params: unknown[]) => {
    const result = await pg.query<T>(text, params);
    return result.rows;
  });
}

let sqlPromise: Promise<Sql> | null = null;

async function createSql(): Promise<Sql> {
  if (typeof window !== "undefined") {
    throw new Error(
      "@/lib/db is server-only — call getSql() from a createServerFn handler " +
        "or a server route loader, never from client code.",
    );
  }
  return dbSource === "neon" ? createNeonSql() : createPgliteSql();
}

/**
 * Get the shared, **server-only** SQL client. Neon when `DATABASE_URL` is set,
 * otherwise the local PGLite fallback. Memoized — safe to call per request.
 *
 * Schema comes from `migrations/*.sql`, auto-applied before the first query on
 * both backends — define tables there, never inline in server functions.
 */
export function getSql(): Promise<Sql> {
  sqlPromise ??= createSql().catch((err) => {
    sqlPromise = null; // don't memoize failures — let the next call retry
    throw err;
  });
  return sqlPromise;
}

/**
 * The shared PGLite instance (preview only), with `migrations/*.sql` applied.
 * Lets Better Auth persist to the SAME embedded DB as app data in preview (via a
 * Kysely dialect). Throws when `DATABASE_URL` is set (that path uses Neon).
 */
export async function getPglite(): Promise<import("@electric-sql/pglite").PGlite> {
  if (dbSource !== "pglite") {
    throw new Error("getPglite() is only available on the PGLite fallback (no DATABASE_URL)");
  }
  await getSql();
  const pg = await globalRef.__pgliteInstance__;
  if (!pg) throw new Error("PGLite instance failed to initialize");
  return pg;
}

/**
 * Finish DB bootstrap before the server handles traffic.
 *
 * - **PGLite** (preview / no `DATABASE_URL`): open the in-memory DB and apply
 *   `migrations/*.sql`. Idempotent — concurrent callers share one promise.
 * - **Neon**: no-op (pool is created lazily on first query).
 *
 * Vite `configureServer` awaits this at dev startup; production imports of this
 * module kick it off immediately (see bottom of file).
 */
export function ensureDbReady(): Promise<void> {
  if (dbSource !== "pglite") return Promise.resolve();
  return getSql().then(() => undefined);
}

// Server-only eager start: kick PGLite bootstrap as soon as this module loads in
// Node. Client bundles never hit this path (`getSql` throws in the browser).
const globalBoot = globalThis as typeof globalThis & {
  __pgBootstrapPromise__?: Promise<void>;
};
if (typeof window === "undefined" && dbSource === "pglite") {
  globalBoot.__pgBootstrapPromise__ ??= ensureDbReady().catch((err) => {
    globalBoot.__pgBootstrapPromise__ = undefined;
    console.error("[db] PGLite bootstrap failed:", err);
    throw err;
  });
}
