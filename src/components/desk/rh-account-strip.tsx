/**
 * The RH account line, plus the one Connect Robinhood control.
 * The connect link is always shown. The account line is display-only.
 */
import { useEffect, useState } from "react";
import { Wallet } from "lucide-react";
import { useRhAccount } from "@/components/desk/use-entry-state";
import { readRhAccount } from "@/lib/ui/rh-account";
import { RH_PREFERRED_ACCOUNT_MASK_LAST4 } from "@/lib/execution/manager-account";
import { rhLinkStatus } from "@/lib/execution/rh-server";
import { cn } from "@/lib/utils";

const usd = (n: number) => (Number.isFinite(n) ? `$${n.toFixed(2)}` : "unknown");

export function RhAccountStrip({ className }: { className?: string }) {
  const a = useRhAccount();
  const r = a ? readRhAccount(a) : null;
  const c = r?.blocked ? "#ef4444" : "var(--color-primary)";
  const [linked, setLinked] = useState<boolean | null>(null);

  useEffect(() => {
    void rhLinkStatus()
      .then((s) => setLinked(s.linked))
      .catch(() => setLinked(false));
  }, []);

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
          {a.isSnapshot && (
            <span className="rounded bg-current/10 px-1.5 text-[10px] font-bold uppercase tracking-wide opacity-90">{r.freshness}</span>
          )}
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
