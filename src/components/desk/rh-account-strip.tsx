/**
 * The RH account line, plus the one Connect Robinhood control.
 * The connect link is always shown. The account line is display-only.
 */
import { useEffect, useState } from "react";
import { Wallet } from "lucide-react";
import { useRhAccount } from "@/components/desk/use-entry-state";
import { readRhAccount, reportRhAccount, type ManagerRhAccount } from "@/lib/ui/rh-account";
import { RH_PREFERRED_ACCOUNT_MASK_LAST4 } from "@/lib/execution/manager-account";
import { rhLinkStatus } from "@/lib/execution/rh-server";
import { cn } from "@/lib/utils";

const usd = (n: number) => (Number.isFinite(n) ? `$${n.toFixed(2)}` : "unknown");

/** Live read from /api/rh/account (real BP/cash + today's realized P&L). */
interface LiveRead {
  ok: boolean;
  linked: boolean;
  account?: ManagerRhAccount | null;
  dayRealized?: number | null;
  dayRealizedPct?: number | null;
}

const REFRESH_MS = 30_000;

export function RhAccountStrip({ className }: { className?: string }) {
  const a = useRhAccount();
  const r = a ? readRhAccount(a) : null;
  const c = r?.blocked ? "#ef4444" : "var(--color-primary)";
  const [linked, setLinked] = useState<boolean | null>(null);
  const [live, setLive] = useState<LiveRead | null>(null);

  useEffect(() => {
    void rhLinkStatus()
      .then((s) => setLinked(s.linked))
      .catch(() => setLinked(false));
  }, []);

  // Poll the live broker read and push it through reportRhAccount so the chip
  // (and the Now hero, which reads the same block) show real BP/cash, not the
  // baked-in snapshot. Stops erroring quietly when not connected.
  useEffect(() => {
    let alive = true;
    const pull = async () => {
      try {
        const res = await fetch("/api/rh/account", { headers: { accept: "application/json" } });
        const json = (await res.json()) as LiveRead;
        if (!alive) return;
        setLive(json);
        if (json.linked) setLinked(true);
        if (json.ok && json.account) reportRhAccount(json.account);
      } catch {
        /* keep the last value */
      }
    };
    void pull();
    const id = setInterval(() => void pull(), REFRESH_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const dayPnl = live?.dayRealized ?? null;

  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      {a && r && (
        <div
          role="status"
          className={cn(
            "inline-flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-full border px-3 py-1 text-[12px] font-semibold",
            r.blocked && "pulse-veto",
          )}
          style={{ color: c, borderColor: c, background: `color-mix(in oklab, ${c} 12%, transparent)` }}
          title={`Robinhood ${r.who} · cash ${usd(a.cashUsd)} · options BP ${usd(a.optionsBuyingPowerUsd)} · envelope $${a.envelopeMinUsd}–$${a.envelopeMaxUsd}${a.agenticAllowed ? "" : " · not accessible to the agent"}${a.isSnapshot ? " · SNAPSHOT, not a live read" : ""}. Display only.`}
        >
          <Wallet className="h-3.5 w-3.5" aria-hidden />
          <span className="font-mono">RH {r.who}</span>
          <span className="font-mono">· {r.line}</span>
          <span className="font-mono text-[11px] font-normal opacity-80">· cash {usd(a.cashUsd)}</span>
          {dayPnl != null && Number.isFinite(dayPnl) && (
            <span
              className="font-mono text-[11px] font-bold"
              style={{ color: dayPnl >= 0 ? "var(--color-primary)" : "#ef4444" }}
              title={live?.dayRealizedPct != null ? `today realized ${(live.dayRealizedPct * 100).toFixed(1)}%` : "today realized P&L (Robinhood)"}
            >
              · today {dayPnl >= 0 ? "+" : "−"}${Math.abs(dayPnl).toFixed(0)}
            </span>
          )}
          {a.isSnapshot ? (
            <span className="rounded bg-current/10 px-1.5 text-[10px] font-bold uppercase tracking-wide opacity-90">{r.freshness}</span>
          ) : live?.linked ? (
            <span className="rounded bg-current/15 px-1.5 text-[10px] font-bold uppercase tracking-wide opacity-90" title={`live read ${r.freshness}`}>live</span>
          ) : null}
          {r.wrongAccount && (
            <span className="text-[10px] font-bold uppercase text-[var(--color-warn)]">display only · trade account is ••••{RH_PREFERRED_ACCOUNT_MASK_LAST4}</span>
          )}
        </div>
      )}
      <a
        href="/api/rh/connect"
        className="inline-flex items-center gap-1.5 rounded-full border border-[var(--color-primary)] bg-[color-mix(in_oklab,var(--color-primary)_16%,var(--color-surface))] px-3 py-1 text-[12px] font-semibold text-[var(--color-fg)] hover:bg-[color-mix(in_oklab,var(--color-primary)_28%,var(--color-surface))]"
      >
        {linked ? "Robinhood connected" : "Connect Robinhood"}
      </a>
    </div>
  );
}
