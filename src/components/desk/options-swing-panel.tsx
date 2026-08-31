import { useEffect, useMemo, useState } from "react";
import {
  CalendarClock,
  CheckCircle2,
  Circle,
  Layers,
  ShieldAlert,
  Sparkles,
  XCircle,
} from "lucide-react";
import type { DeskPayload } from "@/lib/trading/build-desk";
import {
  evaluateOptionsDesk,
  optionsDeskPlaybook,
  type RhStrategyCard,
  type RhVerdict,
  type UnderlierQuote,
} from "@/lib/trading/options-desk";
import {
  loadRhSleeve,
  saveRhSleeve,
  subscribeRhSleeve,
  type RhSleeve,
} from "@/lib/trading/options-sleeve";
import { cn } from "@/lib/utils";
import { useDeskSynapse } from "@/lib/trading/desk-synapse";

function verdictClass(v: RhVerdict): string {
  if (v === "ARMED")
    return "border-[color-mix(in_oklab,var(--color-up)_45%,var(--color-border))] bg-[color-mix(in_oklab,var(--color-up)_12%,transparent)] text-[var(--color-up)]";
  if (v === "WATCH")
    return "border-[color-mix(in_oklab,var(--color-warn)_45%,var(--color-border))] bg-[color-mix(in_oklab,var(--color-warn)_12%,transparent)] text-[var(--color-warn)]";
  return "border-[var(--color-border)] bg-[var(--color-surface-2)] text-[var(--color-muted)]";
}

function usd(n: number): string {
  return `$${Math.round(n).toLocaleString()}`;
}

function StrategyCard({ card }: { card: RhStrategyCard }) {
  return (
    <article className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2.5">
      <header className="mb-1.5 flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-[var(--color-fg)]">{card.name}</p>
          <p className="text-[10px] text-[var(--color-subtle)]">
            {card.horizon} · {card.whyHighProb}
          </p>
        </div>
        <span
          className={cn(
            "shrink-0 rounded-full border px-2 py-0.5 font-mono text-[10px] font-bold",
            verdictClass(card.verdict),
          )}
        >
          {card.verdict}
        </span>
      </header>

      {card.ticket && (
        <div className="mb-2 rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1.5">
          <p className="font-mono text-[12px] text-[var(--color-fg)]">
            {card.ticket.product === "debit_spread" ? "SPREAD" : "BUY"} {card.ticket.contracts}{" "}
            {card.ticket.underlier} {card.ticket.side.toUpperCase()}
            <span className="text-[var(--color-muted)]">
              {" "}
              · DTE {card.ticket.dteTarget} · Δ {card.ticket.deltaMin}–{card.ticket.deltaMax} · pay{" "}
              {usd(card.ticket.estDebitTotal)} · max loss {usd(card.ticket.maxLoss)}
            </span>
          </p>
          <p className="mt-0.5 text-[11px] text-[var(--color-muted)]">{card.ticket.strikeNote}</p>
          <p className="mt-0.5 text-[11px] text-[var(--color-fg)]">Hold {card.ticket.hold}</p>
          <p className="text-[11px] text-[var(--color-muted)]">Invalid: {card.ticket.invalidation}</p>
          <ul className="mt-1 space-y-0.5 text-[11px] text-[var(--color-muted)]">
            {card.ticket.targets.map((t) => (
              <li key={t}>→ {t}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid gap-2 sm:grid-cols-2">
        <ul className="space-y-0.5 text-[11px] text-[var(--color-muted)]">
          {(card.reasons.length ? card.reasons : ["—"]).map((r) => (
            <li key={r} className="flex gap-1">
              <Circle className="mt-1 h-2 w-2 shrink-0 text-[var(--color-up)]" />
              {r}
            </li>
          ))}
        </ul>
        <ul className="space-y-0.5 text-[11px] text-[var(--color-muted)]">
          {(card.blocks.length ? card.blocks : ["None"]).map((r) => (
            <li key={r} className="flex gap-1">
              <Circle className="mt-1 h-2 w-2 shrink-0 text-[var(--color-down)]" />
              {r}
            </li>
          ))}
        </ul>
      </div>
    </article>
  );
}

function QuoteSheet({ q, primary }: { q: UnderlierQuote; primary: boolean }) {
  return (
    <div
      className={cn(
        "rounded-[var(--radius-md)] border px-3 py-2",
        primary
          ? "border-[color-mix(in_oklab,var(--color-primary)_40%,var(--color-border))]"
          : "border-[var(--color-border)]",
      )}
    >
      <p className="text-sm font-semibold text-[var(--color-fg)]">
        {q.underlier}{" "}
        <span className="font-mono text-[11px] text-[var(--color-muted)]">
          ~{q.spotEst.toFixed(2)} ← {q.proxy}
        </span>
        {primary ? (
          <span className="ml-2 text-[10px] uppercase text-[var(--color-primary)]">primary</span>
        ) : null}
      </p>
      <p className="text-[11px] text-[var(--color-muted)]">
        HTF {q.htf} · {q.dealing ?? "n/a"} · sess {q.session} · {q.changePct >= 0 ? "+" : ""}
        {q.changePct.toFixed(2)}% · {q.role} · IV {(q.ivUsed * 100).toFixed(0)}%
      </p>
      <table className="mt-1.5 w-full text-left text-[10px] text-[var(--color-muted)]">
        <thead>
          <tr className="text-[var(--color-subtle)]">
            <th className="font-medium">Tenor</th>
            <th className="font-medium">Single</th>
            <th className="font-medium">Spread</th>
            <th className="font-medium">$150</th>
          </tr>
        </thead>
        <tbody>
          {q.menu.map((m) => (
            <tr key={m.label}>
              <td className="py-0.5 text-[var(--color-fg)]">{m.label}</td>
              <td>{usd(m.single)}</td>
              <td>{usd(m.spread)}</td>
              <td className={m.fitsSingle || m.fitsSpread ? "text-[var(--color-up)]" : "text-[var(--color-down)]"}>
                {m.fitsSingle ? "1-lot" : m.fitsSpread ? "vertical" : "too rich"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function OptionsSwingPanel({ desk }: { desk: DeskPayload }) {
  const [sleeve, setSleeve] = useState<RhSleeve>(() => loadRhSleeve());
  useEffect(() => subscribeRhSleeve(setSleeve), []);

  const book = useMemo(() => evaluateOptionsDesk(desk, sleeve), [desk, sleeve]);
  const posture = useDeskSynapse((s) => s.posture);
  const tradeFeed = useDeskSynapse((s) => s.feeds.trade);
  const pathFeed = useDeskSynapse((s) => s.feeds.path);
  const playbook = useMemo(() => optionsDeskPlaybook(), []);

  const onEquity = (v: string) => {
    const n = Number(v.replace(/[^0-9.]/g, ""));
    if (!Number.isFinite(n)) return;
    setSleeve(saveRhSleeve({ equity: n }));
  };
  const onRisk = (v: string) => {
    const n = Number(v.replace(/[^0-9.]/g, "")) / 100;
    if (!Number.isFinite(n)) return;
    setSleeve(saveRhSleeve({ riskPct: n }));
  };

  return (
    <section className="rounded-[var(--radius-lg)] border border-[color-mix(in_oklab,var(--color-primary)_28%,var(--color-border))] bg-[var(--color-surface)] p-3 sm:p-4">
      <header className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div className="flex items-start gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-[var(--radius-md)] bg-[color-mix(in_oklab,var(--color-primary)_14%,transparent)] text-[var(--color-primary)]">
            <Layers className="h-4 w-4" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-[var(--color-fg)]">
              Robinhood · QQQ / SPY sleeve
            </h2>
            <p className="text-[11px] text-[var(--color-subtle)]">
              Not the $100k futures book · long debit / vertical only · estimates from ES/NQ
            </p>
          </div>
        </div>
        <span
          className={cn(
            "rounded-full border px-2.5 py-1 font-mono text-[11px] font-bold tracking-wide",
            verdictClass(book.best?.verdict ?? "STAND"),
          )}
        >
          {book.best ? `${book.best.verdict} · ${book.best.ticket?.underlier}` : "STAND"}
        </span>
      </header>

      <div className="mb-3 flex flex-wrap items-end gap-3 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2">
        <label className="text-[10px] uppercase text-[var(--color-subtle)]">
          Capital
          <input
            type="number"
            min={200}
            max={25000}
            step={100}
            value={sleeve.equity}
            onChange={(e) => onEquity(e.target.value)}
            className="mt-0.5 block w-24 rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 font-mono text-[12px] text-[var(--color-fg)]"
          />
        </label>
        <label className="text-[10px] uppercase text-[var(--color-subtle)]">
          Risk %
          <input
            type="number"
            min={5}
            max={25}
            step={1}
            value={Math.round(sleeve.riskPct * 100)}
            onChange={(e) => onRisk(e.target.value)}
            className="mt-0.5 block w-16 rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 font-mono text-[12px] text-[var(--color-fg)]"
          />
        </label>
        <p className="pb-1 font-mono text-[12px] text-[var(--color-fg)]">
          Max debit {usd(book.maxDebit)}{" "}
          <span className="text-[var(--color-subtle)]">= 1 thesis · never both QQQ and SPY</span>
        </p>
      </div>

      <p className="mb-2 text-[11px] text-[var(--color-muted)]">
        Cross-tab: {posture.verdict} · {tradeFeed[0] ?? "—"} · {pathFeed[0] ?? "—"}
      </p>

      <div
        className={cn(
          "mb-3 rounded-[var(--radius-md)] border px-3 py-2.5",
          book.best
            ? "border-[color-mix(in_oklab,var(--color-up)_40%,var(--color-border))] bg-[color-mix(in_oklab,var(--color-up)_10%,var(--color-surface-2))]"
            : "border-[var(--color-border)] bg-[var(--color-surface-2)]",
        )}
      >
        <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-primary)]">
          <CalendarClock className="h-3.5 w-3.5" />
          {book.best ? "Best RH ticket" : "No high-prob ticket"}
        </p>
        <p className="mt-1 text-sm font-medium text-[var(--color-fg)]">{book.focus}</p>
        {book.best?.ticket && (
          <p className="mt-1 text-[11px] text-[var(--color-muted)]">{book.best.ticket.robinhood}</p>
        )}
      </div>

      <div className="mb-3 grid gap-2 sm:grid-cols-2">
        <QuoteSheet q={book.quotes.qqq} primary={book.primary === "QQQ"} />
        <QuoteSheet q={book.quotes.spy} primary={book.primary === "SPY"} />
      </div>

      <div className="mb-3">
        <p className="mb-1.5 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-subtle)]">
          <ShieldAlert className="h-3 w-3" />
          Shared gates
        </p>
        <ul className="grid gap-1 sm:grid-cols-2">
          {book.gates.map((c) => (
            <li
              key={c.id}
              className="flex items-center gap-2 rounded border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2 py-1.5 text-[11px]"
            >
              {c.ok ? (
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-[var(--color-up)]" />
              ) : (
                <XCircle className="h-3.5 w-3.5 shrink-0 text-[var(--color-down)]" />
              )}
              <span className={c.ok ? "text-[var(--color-fg)]" : "text-[var(--color-muted)]"}>
                {c.label}
              </span>
            </li>
          ))}
        </ul>
      </div>

      <div className="mb-3">
        <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-subtle)]">
          Day book
        </p>
        <div className="space-y-2">
          {book.day.map((c) => (
            <StrategyCard key={c.id} card={c} />
          ))}
        </div>
      </div>

      <div className="mb-3">
        <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-subtle)]">
          Swing book
        </p>
        <div className="space-y-2">
          {book.swing.map((c) => (
            <StrategyCard key={c.id} card={c} />
          ))}
        </div>
      </div>

      <div className="rounded-[var(--radius-md)] border border-[color-mix(in_oklab,var(--color-primary)_22%,var(--color-border))] bg-[color-mix(in_oklab,var(--color-primary)_6%,transparent)] px-3 py-2">
        <p className="mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-primary)]">
          <Sparkles className="h-3 w-3" />
          Playbook
        </p>
        <ul className="space-y-0.5 text-[11px] text-[var(--color-muted)]">
          {playbook.map((p) => (
            <li key={p}>· {p}</li>
          ))}
        </ul>
      </div>
    </section>
  );
}
