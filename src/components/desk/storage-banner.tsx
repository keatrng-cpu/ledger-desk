import { useEffect, useState } from "react";
import { AlertOctagon, Database, LogIn } from "lucide-react";
import { Link } from "@tanstack/react-router";
import {
  getStorageHealth,
  type StorageHealth,
} from "@/lib/journal/storage-health";
import { BUILD_ID } from "@/lib/build-id";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { SIGN_IN_PATH } from "@/lib/auth/gates";

/**
 * Signed-in/out chip for the SAME status strip storage and build identity
 * already sit on. `login.tsx`'s own comment says why this exists: "the route
 * gates.tsx has always pointed at and that never existed" — the /login route
 * DOES exist (email/password, enabled since 2026-09-19) but NOTHING in the
 * desk's own UI ever linked to it, so a trader browsing the desk (most of
 * which works signed out on purpose) had no way to discover that a handful
 * of features — the journal, the Invest ledger, kill-watch, the coach, and
 * Discuss — need a real session, and silently got "Unauthorized" from all of
 * them. Half of the 2026-09-19 fix; this is the other half.
 */
function AccountChip() {
  const { user, isPending } = useCurrentUserState();
  if (isPending) return null;
  if (user) {
    return (
      <span title={user.primaryEmail ?? user.displayName ?? user.id} className="text-[var(--color-up)]">
        {user.isDevFallback ? "dev user" : (user.primaryEmail ?? user.displayName ?? "signed in").split("@")[0]}
      </span>
    );
  }
  return (
    <Link
      to={SIGN_IN_PATH}
      className="flex items-center gap-1 text-[var(--color-warn)] hover:underline"
      title="Signed out — the journal, Invest ledger, kill-watch, the coach and Discuss all need this to persist or to call a paid API"
    >
      <LogIn className="h-3 w-3" /> sign in
    </Link>
  );
}

/**
 * Three things that must never fail quietly, in one strip:
 *
 * 1. STORAGE. Without DATABASE_URL the app runs an in-memory database, so a
 *    deployed desk throws away every trade on each cold start while looking
 *    completely normal. Silent data loss deserves the loudest banner here.
 * 2. BUILD IDENTITY. The stamp is generated at build time
 *    (scripts/gen-build-id.mjs). If what you see here does not match the
 *    commit you deployed, the page really is cached — and that is now a
 *    one-glance check instead of an investigation.
 * 3. ACCOUNT. See AccountChip above — the gap that made the journal sit at
 *    zero rows for months, the second time (this UI half was still missing).
 */
export function StorageBanner() {
  const [health, setHealth] = useState<StorageHealth | null>(null);

  useEffect(() => {
    void getStorageHealth()
      .then(setHealth)
      .catch(() => undefined);
  }, []);

  // Nothing wrong, or not known yet: show only the build stamp + account.
  if (!health || health.durable) {
    return (
      <div className="flex items-center justify-end gap-1.5 px-1 py-1 font-mono text-[10px] text-[var(--color-subtle)]">
        <Database className="h-3 w-3 text-[var(--color-up)]" />
        <span>{health?.durable ? `postgres · ${health.via ?? "?"}` : "…"}</span>
        <span className="text-[var(--color-border-strong)]">·</span>
        <span title="Generated at build time — mismatch with your deploy means the page is cached">
          build {BUILD_ID}
        </span>
        <span className="text-[var(--color-border-strong)]">·</span>
        <AccountChip />
      </div>
    );
  }

  const critical = health.deployed;
  // DEV (not deployed): the embedded database is a local file that survives
  // restarts — so it is neither "in-memory" nor an emergency. A small footer
  // badge, with the full note on hover. Was a full-width amber alert on every
  // tab titled "In-memory database" above text saying it is saved on disk.
  if (!critical) {
    return (
      <div
        role="status"
        className="pointer-events-auto fixed bottom-2 left-2 z-30 flex items-center gap-1.5 rounded-full border border-[color-mix(in_oklab,var(--color-warn)_35%,var(--color-border))] bg-[var(--color-surface)]/90 px-2.5 py-1 font-mono text-[10px] text-[var(--color-warn)] shadow backdrop-blur"
        title="Local embedded database (dev) — saved on this machine and survives restarts, but not shared across devices and not a deployment."
      >
        <Database className="h-3 w-3" aria-hidden />
        dev · local db ({health.backend}) · build {BUILD_ID}
        <span className="text-[var(--color-border-strong)]">·</span>
        <AccountChip />
      </div>
    );
  }
  return (
    <div
      role="alert"
      className="mb-2 flex items-start gap-2 rounded-[var(--radius-md)] border border-[var(--color-down)] bg-[color-mix(in_oklab,var(--color-down)_12%,transparent)] px-3 py-2 text-xs text-[var(--color-down)]"
    >
      <AlertOctagon className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="min-w-0">
        <p className="font-semibold">NOT SAVING YOUR DATA</p>
        <p className="mt-0.5 leading-relaxed opacity-90">{health.warning}</p>
        <p className="mt-1 font-mono text-[10px] opacity-70">
          backend {health.backend} · build {BUILD_ID}
        </p>
      </div>
    </div>
  );
}
