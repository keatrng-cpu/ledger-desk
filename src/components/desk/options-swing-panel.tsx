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
import {
  closeRhFill,
  loadRhIncome,
  logRhFill,
  readRhIncome,
  subscribeRhIncome,
  type RhFill,
  type RhIncomeRead,
} from "@/lib/trading/rh-income";
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
              {usd(card.ticket.estDebitTotal)} · cut {usd(card.ticket.workingStop)} · ceiling{" "}
              {usd(card.ticket.maxLoss)}
            </span>
          </p>
          <p className="mt-0.5 text-[11px] text-[var(--color-muted)]">{card.ticket.strikeNote}</p>
          {/* How the size was decided. "ceiling" means no priced stop yet —
              the real risk has not been solved for. The ticket carried this
              and the card never showed it. */}
          <p
            className={cn(
              "mt-0.5 text-[10px] leading-snug",
              card.ticket.sizedFrom === "ceiling" ? "text-[var(--color-warn)]" : "text-[var(--color-subtle)]",
            )}
          >
            Sized from the {card.ticket.sizedFrom === "level" ? "futures invalidation (the rule)" : "debit ceiling — no priced stop yet"}
            {card.ticket.sizeNote ? ` · ${card.ticket.sizeNote}` : ""}
          </p>
          <p className="mt-0.5 text-[11px] text-[var(--color-fg)]">Hold {card.ticket.hold}</p>
          <p className="text-[11px] text-[var(--color-muted)]">Invalid: {card.ticket.invalidation}</p>
          <p className="text-[11px] text-[var(--color-warn)]">{card.ticket.cutRule}</p>
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
            <th className="font-medium" title="Fits inside the $1,000 ticket ceiling">≤ $1,000</th>
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
  const [income, setIncome] = useState<RhIncomeRead>(() => readRhIncome());
  const [fills, setFills] = useState<RhFill[]>([]);
  useEffect(() => {
    const sync = () => {
      setIncome(readRhIncome());
      setFills(loadRhIncome().fills.slice(0, 6));
    };
    sync();
    return subscribeRhIncome(sync);
  }, []);

  const book = useMemo(() => evaluateOptionsDesk(desk, sleeve), [desk, sleeve]);
  const posture = useDeskSynapse((s) => s.posture);
  const tradeFeed = useDeskSynapse((s) => s.feeds.trade);
  const pathFeed = useDeskSynapse((s) => s.feeds.path);
  const playbook = useMemo(() => optionsDeskPlaybook(), []);

  // COMMIT ON BLUR / ENTER, never per keystroke. Saving (and clamping) on
  // every key turned typing "15" into 1% then 5%, "55" into a 25% loss
  // budget, and a cleared box into $200. The field is a draft until the
  // trader is done with it.
  const [eqDraft, setEqDraft] = useState<string | null>(null);
  const [riskDraft, setRiskDraft] = useState<string | null>(null);
  const onEquity = (v: string) => {
    const n = Number(v.replace(/[^0-9.]/g, ""));
    if (!v.trim() || !Number.isFinite(n) || n <= 0) return;
    setSleeve(saveRhSleeve({ equity: n }));
  };
  const onRisk = (v: string) => {
    const pct = Number(v.replace(/[^0-9.]/g, ""));
    if (!v.trim() || !Number.isFinite(pct) || pct <= 0) return;
    // The loss is capped at 15% of the debit (CLAUDE.md) — the field cannot
    // raise it past that.
    setSleeve(saveRhSleeve({ riskPct: Math.min(pct, 15) / 100 }));
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
              ≤ $1,000 debit · loss capped 15% of the debit · exit on the futures level · Databento $199/mo first · not the $100k book
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
          Debit ceiling $
          <input
            type="number"
            min={200}
            max={25000}
            step={100}
            value={eqDraft ?? sleeve.equity}
            onChange={(e) => setEqDraft(e.target.value)}
            onBlur={() => {
              if (eqDraft != null) onEquity(eqDraft);
              setEqDraft(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            }}
            className="mt-0.5 block w-24 rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 font-mono text-[12px] text-[var(--color-fg)]"
          />
        </label>
        <label className="text-[10px] uppercase text-[var(--color-subtle)]">
          Loss cap % of debit
          <input
            type="number"
            min={5}
            max={15}
            step={1}
            value={riskDraft ?? Math.round(sleeve.riskPct * 100)}
            onChange={(e) => setRiskDraft(e.target.value)}
            onBlur={() => {
              if (riskDraft != null) onRisk(riskDraft);
              setRiskDraft(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            }}
            className="mt-0.5 block w-16 rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 font-mono text-[12px] text-[var(--color-fg)]"
          />
        </label>
        <p className="pb-1 font-mono text-[12px] text-[var(--color-fg)]">
          Max debit {usd(book.maxDebit)}{" "}
          <span className="text-[var(--color-subtle)]">= 1 thesis · never both QQQ and SPY</span>
        </p>
      </div>

      <div className="mb-3 grid gap-2 sm:grid-cols-3">
        <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2">
          <p className="text-[10px] uppercase text-[var(--color-subtle)]">Week vs Databento</p>
          <p className="font-mono text-sm text-[var(--color-fg)]">
            {usd(income.weekPnl)} / {usd(income.weekFloor)}
          </p>
          <p className="text-[10px] text-[var(--color-muted)]">{income.weekKey} · $50 covers rent</p>
        </div>
        <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2">
          <p className="text-[10px] uppercase text-[var(--color-subtle)]">Month rent</p>
          <p className="font-mono text-sm text-[var(--color-fg)]">
            {usd(income.monthPnl)} / {usd(income.monthRent)}
          </p>
          <p className="text-[10px] text-[var(--color-muted)]">
            {income.monthCovered ? "Databento paid" : "Not break-even yet"}
          </p>
        </div>
        <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2">
          <p className="text-[10px] uppercase text-[var(--color-subtle)]">Stretch</p>
          <p className="font-mono text-sm text-[var(--color-fg)]">{usd(income.stretch)}/wk</p>
          <p className="text-[10px] text-[var(--color-muted)]">Not a take-mandate</p>
        </div>
      </div>
      <p className="mb-3 text-[11px] text-[var(--color-muted)]">{income.honest}</p>

      <div className="mb-3 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2">
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-subtle)]">
          SMC sequence · {desk.smcMaster.thesis}
        </p>
        <div className="grid gap-1 sm:grid-cols-2">
          {([desk.smcMaster.left, desk.smcMaster.right] as const).map((b) => (
            <p key={b.symbol} className="font-mono text-[10px] text-[var(--color-muted)]">
              <span className="text-[var(--color-fg)]">{b.symbol}</span> {b.word} {b.mustPass}/{b.mustNeed}
              {b.layers
                .filter((l) => l.must)
                .map((l) => (
                  <span
                    key={l.id}
                    className={
                      l.state === "pass"
                        ? " text-[var(--color-up)]"
                        : l.state === "fail"
                          ? " text-[var(--color-down)]"
                          : " text-[var(--color-warn)]"
                    }
                  >
                    {" "}
                    {l.state === "pass" ? "●" : l.state === "fail" ? "×" : "○"}
                    {l.label.split(" ")[0]}
                  </span>
                ))}
            </p>
          ))}
        </div>
        <p className="mt-1 text-[10px] text-[var(--color-subtle)]">{desk.smcMaster.vsSchools}</p>
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
          <>
            <p className="mt-1 text-[11px] text-[var(--color-muted)]">{book.best.ticket.robinhood}</p>
            <button
              type="button"
              className="mt-2 rounded border border-[var(--color-border)] px-2 py-1 font-mono text-[11px] text-[var(--color-fg)]"
              onClick={() => {
                const t = book.best!.ticket!;
                // Ask for the CONTRACT, pre-filled with the plan's own
                // numbers. An estimate recorded as a fill is the one thing
                // this journal must never contain, and the overnight board
                // cannot grade expiry risk without the real DTE.
                const dteRaw = window.prompt(
                  `DTE of the contract you actually filled (plan target: ${t.dteTarget})`,
                  String(t.dteTarget),
                );
                if (dteRaw === null) return;
                const deltaRaw = window.prompt(
                  `Delta of that contract (plan band: ${t.deltaMin.toFixed(2)}–${t.deltaMax.toFixed(2)})`,
                  ((t.deltaMin + t.deltaMax) / 2).toFixed(2),
                );
                if (deltaRaw === null) return;
                const debitRaw = window.prompt(
                  `Debit actually paid, $ (est ${usd(t.estDebitTotal)})`,
                  String(t.estDebitTotal),
                );
                if (debitRaw === null) return;
                const dte = Number(dteRaw);
                const delta = Number(deltaRaw);
                const debit = Number(debitRaw);
                logRhFill({
                  underlier: t.underlier,
                  side: t.side,
                  debit: Number.isFinite(debit) && debit > 0 ? debit : t.estDebitTotal,
                  dte: Number.isFinite(dte) && dte >= 0 ? dte : undefined,
                  delta: Number.isFinite(delta) && delta > 0 ? delta : undefined,
                  note: `${book.best!.name} · cut $${t.workingStop}`,
                });
              }}
            >
              Log RH fill @ {usd(book.best.ticket.estDebitTotal)}
            </button>
          </>
        )}
      </div>

      {fills.length === 0 && (
        <p className="mb-3 rounded-[var(--radius-md)] border border-[color-mix(in_oklab,var(--color-warn)_45%,transparent)] px-3 py-2 text-[11px] leading-snug text-[var(--color-warn)]">
          Sleeve journal is empty. Every number this desk gives you about YOUR
          trading — the week against the Databento rent, the loss preview, the
          discretion multiplier, the n≥20 A+ unlock — is computed from these
          fills. Until they are in, the brain is advising a trader it has never
          seen, and the 4-for-4 that proves the direction call works is
          invisible to every part of the system that could learn from it.
        </p>
      )}

      {fills.length > 0 && (
        <div className="mb-3 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2">
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-subtle)]">
            Sleeve journal
          </p>
          <ul className="space-y-1">
            {fills.map((f) => (
              <li key={f.id} className="flex flex-wrap items-center gap-2 font-mono text-[11px] text-[var(--color-muted)]">
                <span className="text-[var(--color-fg)]">
                  {f.underlier} {f.side} · debit {usd(f.debit)}
                </span>
                {f.closedAt ? (
                  <span className={(f.pnl ?? 0) >= 0 ? "text-[var(--color-up)]" : "text-[var(--color-down)]"}>
                    {usd(f.pnl ?? 0)}
                  </span>
                ) : (
                  <button
                    type="button"
                    className="rounded border border-[var(--color-border)] px-1.5 py-0.5 text-[10px]"
                    onClick={() => {
                      // No default answer and no silent zero. Cancel returned
                      // null and an empty box "", both of which Number() turns
                      // into 0 — booking a −100% loss — and the prefilled
                      // debit × 0.75 booked a −25% result nobody typed.
                      const raw = window.prompt("Exit credit $ (what RH actually paid you back)", "");
                      if (raw == null || raw.trim() === "") return;
                      const n = Number(raw.replace(/[^0-9.]/g, ""));
                      if (Number.isFinite(n) && n >= 0) closeRhFill(f.id, n);
                    }}
                  >
                    Close
                  </button>
                )}
                <span className="text-[10px]">{f.note}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

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
