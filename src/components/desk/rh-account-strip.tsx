/**
 * The RH account line: "RH Individual ••••7477 · BP $11.56 · below $150
 * envelope, arm blocked · snapshot 10/05 21:45 ET". Text is Trading Stand's
 * managerAccountLine; red (the veto red the flash uses) when the envelope
 * cannot fill. Renders nothing when there is no account block.
 */
import { Wallet } from "lucide-react";
import { useRhAccount } from "@/components/desk/use-entry-state";
import { readRhAccount } from "@/lib/ui/rh-account";
import { RH_PREFERRED_ACCOUNT_MASK_LAST4 } from "@/lib/execution/manager-account";

const usd = (n: number) => (Number.isFinite(n) ? `$${n.toFixed(2)}` : "unknown");
import { cn } from "@/lib/utils";

export function RhAccountStrip({ className }: { className?: string }) {
  const a = useRhAccount();
  if (!a) return null;
  const r = readRhAccount(a);
  const c = r.blocked ? "#ef4444" : "var(--color-primary)";
  return (
    <div
      role="status"
      className={cn(
        "inline-flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-full border px-3 py-1 text-[12px] font-semibold",
        r.blocked && "pulse-veto",
        className,
      )}
      style={{ color: c, borderColor: c, background: `color-mix(in oklab, ${c} 12%, transparent)` }}
      title={`Robinhood ${r.who} · cash ${usd(a.cashUsd)} · options BP ${usd(a.optionsBuyingPowerUsd)} · envelope $${a.envelopeMinUsd}–$${a.envelopeMaxUsd}${a.agenticAllowed ? "" : " · not accessible to the agent"}${a.isSnapshot ? " · SNAPSHOT, not a live read" : ""}. Display only.`}
    >
      <Wallet className="h-3.5 w-3.5" aria-hidden />
      <span className="font-mono">RH {r.who}</span>
      <span className="font-mono">· {r.line}</span>
      <span className="font-mono text-[11px] font-normal opacity-80">
        · cash {usd(a.cashUsd)}
      </span>
      {a.isSnapshot && (
        <span className="rounded bg-current/10 px-1.5 text-[10px] font-bold uppercase tracking-wide opacity-90">
          {r.freshness}
        </span>
      )}
      {r.wrongAccount && (
        <span className="text-[10px] font-bold uppercase text-[var(--color-warn)]">display only · trade account is ••••{RH_PREFERRED_ACCOUNT_MASK_LAST4}</span>
      )}
    </div>
  );
}
