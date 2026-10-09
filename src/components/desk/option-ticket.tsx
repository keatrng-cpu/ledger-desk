/**
 * The one ticket.
 *
 * The product is ONE QQQ or SPY option, entered on an array, aimed at a draw,
 * so the first paint of the session is that ticket and nothing else: the
 * direction the raid named, the counter-bias note, the entry, the target, the
 * contract, and the conditions the buy line is predicated on.
 *
 * It renders ONLY what the live desk already decided. The four facts come from
 * `ticket-facts.ts` (one reader, so this card, the Now board, the brain and
 * Vince cannot print different entry prices), and whether the ticket may be
 * handed comes from `options-desk.ts` ticketHolds — the same function
 * `gateHand` uses, not a second copy of it.
 *
 * NO BUY LINE unless every one of these is true: the four conditions, a live
 * ask inside the envelope, and the brain on this book and not standing. A
 * model debit is a shape for the tab; an empty entry is not a ticket.
 */

import { AlertTriangle, Check, CircleDashed, Crosshair, X } from "lucide-react";
import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { RH_MAX_DEBIT_TOTAL, RH_MIN_DEBIT_TOTAL } from "@/lib/execution/rh-autofire-gates";
import type { DeskPayload } from "@/lib/trading/build-desk";
import {
  evaluateOptionsDesk,
  ticketHolds,
  type OptionsDesk,
  type RhStrategyCard,
} from "@/lib/trading/options-desk";
import { loadRhSleeve } from "@/lib/trading/options-sleeve";
import { factsForUnderlier, fourFacts, type CounterRead, type FourFacts } from "@/lib/trading/ticket-facts";

function usd(n: number): string {
  return `$${Math.round(n).toLocaleString()}`;
}

/** The handed ticket, or the nearest card that at least has one. */
function pickCard(book: OptionsDesk): RhStrategyCard | null {
  if (book.best) return book.best;
  const withTicket = book.cards.filter((c) => c.ticket).sort((a, b) => b.score - a.score);
  return withTicket[0] ?? null;
}

function Row({
  label,
  children,
  tone,
}: {
  label: string;
  children: React.ReactNode;
  tone?: "ok" | "warn" | "bad";
}) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 border-t border-[var(--color-border)] px-3 py-2 first:border-t-0">
      <span className="w-[6.5rem] shrink-0 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-subtle)]">
        {label}
      </span>
      <span
        className={cn(
          "min-w-0 flex-1 text-[12px] leading-snug",
          tone === "ok"
            ? "text-[var(--color-up)]"
            : tone === "bad"
              ? "text-[var(--color-down)]"
              : tone === "warn"
                ? "text-[var(--color-warn)]"
                : "text-[var(--color-fg)]",
        )}
      >
        {children}
      </span>
    </div>
  );
}

const COUNTER_TONE: Record<CounterRead, "ok" | "warn" | undefined> = {
  agrees: "ok",
  disrespected: "warn",
  unread: undefined,
};

function CounterChip({ frame, read }: { frame: string; read: CounterRead }) {
  return (
    <span
      className={cn(
        "mr-1.5 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[10px]",
        read === "agrees"
          ? "border-[color-mix(in_oklab,var(--color-up)_45%,var(--color-border))] text-[var(--color-up)]"
          : read === "disrespected"
            ? "border-[color-mix(in_oklab,var(--color-warn)_45%,var(--color-border))] text-[var(--color-warn)]"
            : "border-[var(--color-border)] text-[var(--color-muted)]",
      )}
    >
      {frame} {read}
    </span>
  );
}

/** The four conditions, plus the debit and the brain, each as its own line. */
function Conditions({
  facts,
  extra,
}: {
  facts: FourFacts;
  extra: { id: string; label: string; ok: boolean; detail: string }[];
}) {
  const all = [...facts.four, ...extra];
  return (
    <ul className="divide-y divide-[var(--color-border)]">
      {all.map((c) => (
        <li key={c.id} className="flex items-start gap-2 px-3 py-1.5">
          {c.ok ? (
            <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--color-up)]" />
          ) : (
            <X className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--color-down)]" />
          )}
          <span className="min-w-0">
            <span className={cn("text-[11px] font-medium", c.ok ? "text-[var(--color-fg)]" : "text-[var(--color-down)]")}>
              {c.label}
            </span>
            <span className="ml-1.5 text-[11px] leading-snug text-[var(--color-muted)]">{c.detail}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

export function OptionTicket({ desk }: { desk: DeskPayload }) {
  const book = useMemo(() => evaluateOptionsDesk(desk, loadRhSleeve()), [desk]);
  const card = pickCard(book);
  const t = card?.ticket ?? null;
  // The futures book the option expresses. With no ticket yet, the brain's own
  // one-book leg — so the four facts are never blank.
  const facts: FourFacts = useMemo(
    () =>
      t
        ? factsForUnderlier(desk, t.underlier)
        : fourFacts(desk, desk.smcMaster.oneBook?.symbol === desk.right.symbol ? "right" : "left"),
    [desk, t?.underlier],
  );

  const holds = card ? ticketHolds(desk, card) : [];
  const modelOnly = Boolean(t && t.pricedFrom !== "live_chain");
  const debitOk = Boolean(
    t && !modelOnly && t.estDebitTotal >= RH_MIN_DEBIT_TOTAL && t.estDebitTotal <= RH_MAX_DEBIT_TOTAL,
  );
  const brainBook = desk.smcMaster.oneBook;
  const brainOk = Boolean(
    brainBook &&
      brainBook.word !== "STAND" &&
      t &&
      (/ES/.test(brainBook.symbol) ? "SPY" : "QQQ") === t.underlier &&
      (brainBook.side === "long" ? "call" : "put") === t.side,
  );
  // The button exists only when all of it is true at once.
  const buyable = facts.fourOk && debitOk && brainOk && holds.length === 0 && card?.verdict === "ARMED";

  const extra = [
    {
      id: "debit",
      label: `Debit is a live ask $${RH_MIN_DEBIT_TOTAL}–$${RH_MAX_DEBIT_TOTAL}`,
      ok: debitOk,
      detail: !t
        ? "No ticket priced yet."
        : modelOnly
          ? "Model, not a contract. Nothing is sent and no buy line is drawn."
          : debitOk
            ? `${usd(t.estDebitTotal)} at the live ask.`
            : `${usd(t.estDebitTotal)} is outside the envelope.`,
    },
    {
      id: "brain",
      label: "Brain is on this book and not standing",
      ok: brainOk,
      detail: !brainBook
        ? "The brain has no one book."
        : brainBook.word === "STAND"
          ? `Brain is standing: ${brainBook.missing}.`
          : brainOk
            ? `${brainBook.symbol} ${brainBook.side} · ${brainBook.word}.`
            : `Brain is ${brainBook.symbol} ${brainBook.side ?? "flat"}; the ticket is ${t?.underlier ?? "—"} ${t?.side ?? "—"}.`,
    },
  ];

  return (
    <section className="overflow-hidden rounded-[var(--radius-lg)] border border-[color-mix(in_oklab,var(--color-primary)_32%,var(--color-border))] bg-[var(--color-surface)]">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--color-border)] bg-[color-mix(in_oklab,var(--color-primary)_7%,transparent)] px-3 py-2">
        <p className="flex items-center gap-1.5 text-sm font-semibold text-[var(--color-fg)]">
          <Crosshair className="h-4 w-4 text-[var(--color-primary)]" />
          The ticket
          <span className="ml-1 font-mono text-[11px] font-normal text-[var(--color-muted)]">
            {facts.symbol} {facts.side ?? "flat"} · {facts.word}
          </span>
        </p>
        <span
          className={cn(
            "rounded-full border px-2.5 py-0.5 font-mono text-[11px] font-bold",
            buyable
              ? "border-[color-mix(in_oklab,var(--color-up)_50%,var(--color-border))] bg-[color-mix(in_oklab,var(--color-up)_14%,transparent)] text-[var(--color-up)]"
              : "border-[var(--color-border)] bg-[var(--color-surface-2)] text-[var(--color-muted)]",
          )}
        >
          {buyable ? "BUY LINE OPEN" : (card?.verdict ?? "STAND")}
        </span>
      </header>

      <Row label="Direction" tone={facts.four[0]!.ok ? "ok" : facts.direction.raidSide ? "bad" : "warn"}>
        {facts.direction.text}
        {facts.direction.wick != null && (
          <span className="text-[var(--color-muted)]"> Wick {facts.direction.wick.toFixed(2)} — the stop sits beyond it.</span>
        )}
      </Row>

      <Row label="Counter-bias">
        <CounterChip frame="HTF" read={facts.counter.htf} />
        <CounterChip frame="MID" read={facts.counter.mid} />
        <span className="text-[var(--color-muted)]">{facts.counter.text}</span>
      </Row>

      <Row label="Entry" tone={facts.entry.inside ? "ok" : facts.entry.chase || facts.entry.px == null ? "bad" : "warn"}>
        {facts.entry.text}
        {facts.stop != null && (
          <span className="text-[var(--color-muted)]"> Invalidation {facts.stop.toFixed(2)}.</span>
        )}
      </Row>

      <Row label="Target" tone={facts.target.pays ? "ok" : facts.target.px == null ? "warn" : "bad"}>
        {facts.target.text}
      </Row>

      <Row label="Contract" tone={modelOnly ? "warn" : debitOk ? undefined : "bad"}>
        {!t ? (
          <>No contract priced. {book.focus}</>
        ) : (
          <>
            <span className="font-mono">
              {t.product === "debit_spread" ? "SPREAD" : "BUY"} {t.contracts} {t.underlier}{" "}
              {t.live ? t.live.strike.toFixed(0) : ""} {t.side.toUpperCase()} · DTE{" "}
              {t.live ? Math.max(0, Math.round((Date.parse(`${t.live.expiry}T20:00:00Z`) - Date.now()) / 86_400_000)) : t.dteTarget}{" "}
              · {usd(t.estDebitTotal)}
            </span>{" "}
            <span className={modelOnly ? "text-[var(--color-warn)]" : "text-[var(--color-muted)]"}>
              {modelOnly ? "model, not a contract" : `live ask ${t.live ? `$${t.live.ask.toFixed(2)}/share` : ""} · cut ${usd(t.workingStop)}`}
            </span>
            {!modelOnly ? null : <span className="text-[var(--color-warn)]"> — no buy line.</span>}
            <span className="block text-[11px] text-[var(--color-muted)]">{t.strikeNote}</span>
          </>
        )}
      </Row>

      <div className="border-t border-[var(--color-border)] bg-[var(--color-surface-2)]">
        <p className="px-3 pt-2 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-subtle)]">
          Before the button exists
        </p>
        <Conditions facts={facts} extra={extra} />
        {holds.length > 0 && (
          <p className="flex items-start gap-1.5 px-3 pb-2 text-[11px] leading-snug text-[var(--color-warn)]">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {holds.join(" ")}
          </p>
        )}
        {!buyable && holds.length === 0 && (
          <p className="flex items-start gap-1.5 px-3 pb-2 text-[11px] leading-snug text-[var(--color-muted)]">
            <CircleDashed className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {facts.missing === "Sequence complete" ? facts.missingDetail : `${facts.missing} — ${facts.missingDetail}`}
          </p>
        )}
      </div>
    </section>
  );
}
