/**
 * Alerts control — ROADMAP B4, missing half.
 *
 * `src/lib/alerts/client.ts` (subscribe/unsubscribe/status) and
 * `server.ts` (getAlertStatus/listRecentAlerts) have existed since the B4/B5
 * merge, fully built and tested, with zero callers anywhere in the app — the
 * 2026-08-12 audit found no button, toggle, or panel a user could ever click.
 * This is that control: subscribe/unsubscribe for this browser, plus the
 * recent alert_log so "what did the desk decide to tell me" has an answer
 * even on a browser that never enabled push.
 *
 * Self-fetching, no props required.
 */

import { useCallback, useEffect, useState } from "react";
import { Bell, BellOff, Loader2, RefreshCw } from "lucide-react";
import {
  enablePushAlerts,
  disablePushAlerts,
  isPushEnabled,
  pushSupport,
} from "@/lib/alerts/client";
import { getAlertStatus, listRecentAlerts } from "@/lib/alerts/server";
import type { AlertRecord } from "@/lib/alerts/types";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function AlertsPanel() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [subCount, setSubCount] = useState<number | null>(null);
  const [recent, setRecent] = useState<AlertRecord[] | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [on, status, log] = await Promise.all([
        isPushEnabled(),
        getAlertStatus(),
        listRecentAlerts({ data: { limit: 15 } }),
      ]);
      setEnabled(on);
      setSubCount(status.subscriptions);
      setRecent(log);
    } catch {
      // Signed out or DB unreachable — the toggle still renders, just inert.
      setEnabled(false);
      setRecent(null);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const toggle = useCallback(async () => {
    setBusy(true);
    setMessage(null);
    try {
      const res = enabled ? await disablePushAlerts() : await enablePushAlerts();
      if (!res.ok) {
        setMessage(res.reason ?? "Failed");
      }
      await refresh();
    } finally {
      setBusy(false);
    }
  }, [enabled, refresh]);

  const support = typeof window !== "undefined" ? pushSupport() : null;

  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-[var(--color-fg)]">
          {enabled ? (
            <Bell className="h-3.5 w-3.5 text-[var(--color-up)]" />
          ) : (
            <BellOff className="h-3.5 w-3.5 text-[var(--color-subtle)]" />
          )}
          Alerts — setup armed · halt · flatten · news blackout
        </h3>
        <Button variant="ghost" size="sm" onClick={() => void refresh()}>
          <RefreshCw className="h-3.5 w-3.5" />
        </Button>
      </div>

      {support && !support.supported ? (
        <p className="text-xs text-[var(--color-subtle)]">{support.reason}</p>
      ) : (
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={() => void toggle()} disabled={busy}>
            {busy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : enabled ? (
              "Turn off push alerts"
            ) : (
              "Turn on push alerts"
            )}
          </Button>
          {subCount != null && subCount > 0 && (
            <span className="text-[10px] text-[var(--color-subtle)]">
              {subCount} browser{subCount === 1 ? "" : "s"} subscribed
            </span>
          )}
        </div>
      )}
      {message && (
        <p className="mt-1.5 text-xs text-[var(--color-down)]">{message}</p>
      )}
      <p className="mt-1.5 text-[10px] leading-relaxed text-[var(--color-subtle)]">
        Fires on: a setup arming, a halt/killzone cap hit, a paper position
        auto-flattened by a time/context stop, and a high-impact news window
        ~15 min out. The 3 daily/weekly summaries (premarket checklist,
        session review, week close) check in on this browser's own poll —
        they need a tab open sometime in their target hour to fire, since
        this desk has no server-side cron running in production.
      </p>

      {recent && recent.length > 0 && (
        <div className="mt-3 border-t border-[var(--color-border)] pt-2">
          <p className="mb-1 text-[10px] font-medium uppercase tracking-wider text-[var(--color-subtle)]">
            Recent
          </p>
          <ul className="space-y-1">
            {recent.map((a) => (
              <li
                key={a.id}
                className={cn(
                  "font-mono text-[11px]",
                  a.delivered > 0
                    ? "text-[var(--color-fg)]"
                    : "text-[var(--color-subtle)]",
                )}
              >
                <span className="text-[var(--color-subtle)]">{fmtTime(a.createdAt)}</span>{" "}
                {a.title}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
