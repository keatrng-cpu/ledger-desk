/**
 * Is anything this desk records actually being kept?
 *
 * THE SILENT FAILURE THIS EXISTS TO EXPOSE
 * `@/lib/db` falls back to PGLite when `DATABASE_URL` is unset — and that
 * PGLite instance is constructed with no `dataDir`, i.e. purely IN-MEMORY.
 * On a serverless host every cold start gets a brand-new empty database, so
 * the journal, the paper mirror, snapshots, analytics and the alert log are
 * all destroyed within minutes, repeatedly, while every screen still renders
 * perfectly. You would only discover it by noticing your trade history keeps
 * resetting to zero.
 *
 * That is precisely the kind of failure that must be loud. This reports the
 * backend so the UI can say so plainly.
 *
 * Not auth-gated on purpose: whether storage is durable is a property of the
 * deployment, not of a user, and a signed-out founder staring at a desk that
 * is quietly discarding everything deserves to be told.
 */

import { createServerFn } from "@tanstack/react-start";
import { dbSource, databaseUrlVar } from "@/lib/db";

export interface StorageHealth {
  /** "neon" = durable Postgres. "pglite" = in-memory fallback. */
  backend: "neon" | "pglite";
  /** True when writes survive a restart. */
  durable: boolean;
  /** True when running a real deployment rather than local dev. */
  deployed: boolean;
  /** Which env var supplied the connection string, when durable. */
  via: string | null;
  /** Present only when there is something to worry about. */
  warning: string | null;
}

export const getStorageHealth = createServerFn({ method: "GET" }).handler(
  async (): Promise<StorageHealth> => {
    const durable = dbSource === "neon";
    // Vercel/Netlify/CI all set NODE_ENV=production for a deployed build.
    const deployed = process.env.NODE_ENV === "production";

    return {
      backend: dbSource,
      durable,
      deployed,
      via: databaseUrlVar ?? null,
      warning: durable
        ? null
        : deployed
          ? "NOT SAVING — no Postgres connection string found, so this deployment is running the ephemeral fallback and every trade, snapshot and metric is discarded on each cold start. Set DATABASE_URL (or connect Vercel's Supabase/Neon integration, which supplies POSTGRES_URL automatically) in the host's environment settings."
          : "Local embedded database (.pglite on disk). It survives restarts now, but it is per-machine and not a deployment. Set DATABASE_URL to share one record across devices.",
    };
  },
);
