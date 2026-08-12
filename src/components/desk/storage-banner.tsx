import { useEffect, useState } from "react";
import { AlertOctagon, Database } from "lucide-react";
import {
  getStorageHealth,
  type StorageHealth,
} from "@/lib/journal/storage-health";
import { BUILD_ID } from "@/lib/build-id";
import { cn } from "@/lib/utils";

/**
 * Two things that must never fail quietly, in one strip:
 *
 * 1. STORAGE. Without DATABASE_URL the app runs an in-memory database, so a
 *    deployed desk throws away every trade on each cold start while looking
 *    completely normal. Silent data loss deserves the loudest banner here.
 * 2. BUILD IDENTITY. The stamp is generated at build time
 *    (scripts/gen-build-id.mjs). If what you see here does not match the
 *    commit you deployed, the page really is cached — and that is now a
 *    one-glance check instead of an investigation.
 */
export function StorageBanner() {
  const [health, setHealth] = useState<StorageHealth | null>(null);

  useEffect(() => {
    void getStorageHealth()
      .then(setHealth)
      .catch(() => undefined);
  }, []);

  // Nothing wrong, or not known yet: show only the build stamp.
  if (!health || health.durable) {
    return (
      <div className="flex items-center justify-end gap-1.5 px-1 py-1 font-mono text-[10px] text-[var(--color-subtle)]">
        <Database className="h-3 w-3 text-[var(--color-up)]" />
        <span>{health?.durable ? "postgres" : "…"}</span>
        <span className="text-[var(--color-border-strong)]">·</span>
        <span title="Generated at build time — mismatch with your deploy means the page is cached">
          build {BUILD_ID}
        </span>
      </div>
    );
  }

  const critical = health.deployed;
  return (
    <div
      role="alert"
      className={cn(
        "mb-2 flex items-start gap-2 rounded-[var(--radius-md)] border px-3 py-2 text-xs",
        critical
          ? "border-[var(--color-down)] bg-[color-mix(in_oklab,var(--color-down)_12%,transparent)] text-[var(--color-down)]"
          : "border-[color-mix(in_oklab,var(--color-warn)_35%,var(--color-border))] text-[var(--color-warn)]",
      )}
    >
      <AlertOctagon className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="min-w-0">
        <p className="font-semibold">
          {critical ? "NOT SAVING YOUR DATA" : "In-memory database (dev)"}
        </p>
        <p className="mt-0.5 leading-relaxed opacity-90">{health.warning}</p>
        <p className="mt-1 font-mono text-[10px] opacity-70">
          backend {health.backend} · build {BUILD_ID}
        </p>
      </div>
    </div>
  );
}
