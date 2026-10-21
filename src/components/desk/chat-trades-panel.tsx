/**
 * ChatTradesPanel — trades Keaton + the assistant took from chat, on the Review tab next to
 * the RH journal. Each row: setup, contract, entry/exits, P&L, trigger, and a marked-up
 * closed-bar chart (entry/exit markers, stop, T1, runner, swept level). Shadow priors below.
 * Read-only. Nothing here gates, sizes or places.
 */
import { useEffect, useState } from "react";
import type { ChatPrior, ChatTrade } from "@/lib/trading/chat-trades";

type Row = ChatTrade & { chartSvg: string | null };
interface Resp { ok: boolean; source: string; trades: Row[]; priors: ChatPrior[]; error?: string }

export function ChatTradesPanel() {
  const [d, setD] = useState<Resp | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => { void fetch("/api/desk/chat-trades").then((r) => r.json()).then(setD).catch(() => setD(null)); }, []);
  if (!d?.ok) return null;
  const total = d.trades.reduce((s, t) => s + (t.pnl ?? 0), 0);
  return (
    <section className="rounded-lg border border-border/60 p-3 space-y-2">
      <header className="flex items-center justify-between text-sm font-semibold">
        <span>Chat trades (Keaton + assistant) · shadow</span>
        <span className={total >= 0 ? "text-emerald-400" : "text-red-400"}>{d.trades.length} trades · {total >= 0 ? "+" : "−"}${Math.abs(total).toFixed(0)} · {d.source}</span>
      </header>
      {[...d.trades].reverse().map((t) => (
        <div key={t.id} className="text-xs border-t border-border/40 pt-2">
          <button type="button" className="w-full text-left flex justify-between" onClick={() => setOpen(open === t.id ? null : t.id)}>
            <span>{t.day} {t.entry_ct ?? ""} CT · <b>{t.setup}</b> · {t.qty}x {t.contract} @{t.entry}</span>
            <span className={(t.pnl ?? 0) >= 0 ? "text-emerald-400" : "text-red-400"}>{t.pnl == null ? "—" : `${t.pnl >= 0 ? "+" : "−"}$${Math.abs(t.pnl)}`}</span>
          </button>
          <div className="text-muted-foreground">{t.trigger}</div>
          {open === t.id && (t.chartSvg ? <div className="mt-2 overflow-x-auto" dangerouslySetInnerHTML={{ __html: t.chartSvg }} /> : <div className="mt-1 italic">no closed bars stored for {t.day}</div>)}
        </div>
      ))}
      <footer className="text-[11px] text-muted-foreground border-t border-border/40 pt-2">
        Chat priors (shadow, informs Brain/Floor only): {d.priors.map((p) => `${p.tag} ${p.wins}/${p.n} avg $${p.avgPnl.toFixed(0)}`).join(" · ")}
      </footer>
    </section>
  );
}
