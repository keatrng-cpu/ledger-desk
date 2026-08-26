import { Clock3, Radio } from "lucide-react";
import { LIVE_PULSE_CONTRACT, ritualWindow } from "@/lib/trading/live-session";
import { useEffect, useState } from "react";

export function LiveSessionCard() {
  const [w, setW] = useState(() => ritualWindow());
  useEffect(() => {
    const id = window.setInterval(() => setW(ritualWindow()), 20_000);
    return () => window.clearInterval(id);
  }, []);

  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
      <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--color-subtle)]">
        <Radio className="h-3.5 w-3.5 text-[var(--color-primary)]" />
        Live desk loop · Grok + you
      </p>
      <p className="mt-1 text-sm font-medium text-[var(--color-fg)]">
        {w.label}
        <span className="ml-2 font-normal text-[var(--color-muted)]">
          {w.local} · {w.et}
        </span>
      </p>
      <p className="mt-1 text-xs text-[var(--color-muted)]">{w.grokMode}</p>
      <ol className="mt-2 space-y-0.5 text-[11px] text-[var(--color-fg)]">
        <li>1. 08:20 CDT — Grok auto-briefs (HTF, liquidity, news, one-book).</li>
        <li>2. 08:30–09:00 CDT — you ping “update”; Grok grades TAKE/STAND every 2–5m.</li>
        <li>3. Computer alarm fires only on A+ / A / A- PATH (Arm it in the HUD).</li>
      </ol>
      <p className="mt-2 flex items-start gap-1.5 text-[10px] leading-relaxed text-[var(--color-subtle)]">
        <Clock3 className="mt-0.5 h-3 w-3 shrink-0" />
        {LIVE_PULSE_CONTRACT}
      </p>
    </div>
  );
}
