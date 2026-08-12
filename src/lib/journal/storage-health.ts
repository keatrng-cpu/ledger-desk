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
import { dbSource } from "@/lib/db";

export interface StorageHealth {
  /** "neon" = durable Postgres. "pglite" = in-memory fallback. */
  backend: "neon" | "pglite";
  /** True when writes survive a restart. */
  durable: boolean;
  /** True when running a real deployment rather than local dev. */
  deployed: boolean;
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
      warning: durable
        ? null
        : deployed
          ? "NOT SAVING — DATABASE_URL is unset, so this deployment is running the in-memory fallback. Every trade, snapshot and metric is discarded on each cold start. Set DATABASE_URL to a Postgres (Neon) connection string in the host's environment settings."
          : "Local in-memory database — data resets when the dev server restarts. Expected in dev; set DATABASE_URL to persist.",
    };
  },
);
