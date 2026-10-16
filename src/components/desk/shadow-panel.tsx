/**
 * Shadow panel — one on the desk, beside the Rule 1 ticket. Display only.
 *
 * Reads the card's existing q_v2. Does not recompute it, and does not gate,
 * size, or fire. After 09:00 CT the day's ticket stays, dimmed, until the
 * next weekday session opens at 08:30 CT. A cash holiday in the week-ahead
 * plan is not that session.
 */
import { useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";
import type { QV2 } from "@/lib/trading/q-v2";
import type { Rule1Ticket } from "@/lib/trading/rule1";
import type { SetupCandidate } from "@/lib/trading/scanner";
import { cn } from "@/lib/utils";
import { GradeBadge } from "./grade-badge";
import { LevelsBlock } from "./levels-block";
import {
  bandRelation,
  displayDelta,
  optionLine,
  qv2Delta,
  readCardQV2,
  rule1Phase,
  rule1Rows,
  rule1ShadowOutcome,
  shadowClock,
  type ShadowBar,
} from "./shadow-view";

export interface ShadowPanelProps {
  live: { q: number; band: string; symbol?: string; side?: "long" | "short" } | null;
  /** Card q_v2 (desk-listen / build-desk). Never recomputed here. */
  qV2: QV2 | null;
  /** Today's Rule 1 tickets. Hidden once the next session opens. */
  rule1: Rule1Ticket[];
  /** False below 1024px, true at desktop, unless the caller sets it. */
  defaultOpen?: boolean;
  density?: "card" | "floor";
  nowMs: number;
  minuteBySymbol?: Record<string, ShadowBar[]>;
}

const EMPTY_RULE = "Rule 1: no sweep in 08:30–09:00 CT window";
const EMPTY_Q = "q_v2: not computed";

function fmtDelta(n: number): string {
  const sign = n > 0 ? "+" : n < 0 ? "−" : "";
  return `${sign}${Math.abs(n).toFixed(2)}`;
}

function TicketBlock({
  ticket,
  phase,
  bars,
  diverges,
}: {
  ticket: Rule1Ticket;
  phase: "window" | "closed";
  bars: ShadowBar[] | undefined;
  diverges: boolean;
}) {
  const rows = rule1Rows(ticket);
  const opt = optionLine(ticket);
  const outcome = phase === "closed" ? rule1ShadowOutcome(ticket, bars) : null;
  const clock = shadowClock(ticket.at);
  return (
    <div className={cn("min-w-0", phase === "closed" && "opacity-60")}>
      <p className="text-[13px] text-[var(--color-fg)]">
        Rule 1 v{ticket.version} · {ticket.symbol}{" "}
        <span className={ticket.side === "long" ? "text-[var(--color-up)]" : "text-[var(--color-down)]"}>{ticket.side}</span>
        {ticket.bonus ? <span className="text-[var(--color-warn)]"> ★ bonus</span> : null}
        {clock ? <span className="text-[var(--color-muted)]"> · {clock}</span> : null}
      </p>
      {phase === "closed" && (
        <p className="mt-0.5 text-[12px] font-semibold uppercase tracking-[0.14em] text-[var(--color-muted)]">window closed</p>
      )}
      {diverges && <p className="mt-0.5 text-[13px] text-[var(--color-warn)]">Rule 1 takes the other side</p>}
      <LevelsBlock mode="table" rows={rows} />
      {opt && <p className="mt-1 font-mono text-[13px] text-[var(--color-fg)]">{opt}</p>}
      {outcome && (
        <p className="mt-1 font-mono text-[13px] text-[var(--color-fg)]">
          shadow R{" "}
          {outcome.r == null ? (
            <span className="text-[var(--color-muted)]">no later bars</span>
          ) : (
            <span className={outcome.r >= 0 ? "text-[var(--color-up)]" : "text-[var(--color-down)]"}>
              {outcome.r >= 0 ? "+" : ""}
              {outcome.r.toFixed(3)} {outcome.exit}
            </span>
          )}
        </p>
      )}
    </div>
  );
}

export function ShadowPanel({ live, qV2, rule1, defaultOpen, density = "card", nowMs, minuteBySymbol }: ShadowPanelProps) {
  const [open, setOpen] = useState(defaultOpen ?? false);
  const [deltasOpen, setDeltasOpen] = useState(false);
  useEffect(() => {
    if (defaultOpen != null) {
      setOpen(defaultOpen);
      return;
    }
    const mq = window.matchMedia("(min-width: 1024px)");
    const apply = () => setOpen(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [defaultOpen]);

  // Not filtered to live.symbol. This is the one desk panel, not a row on
  // each card, so a Rule 1 ticket on the other index stays visible.
  const shown = rule1
    .map((ticket) => ({ ticket, phase: rule1Phase(nowMs, ticket.at) }))
    .filter((row): row is { ticket: Rule1Ticket; phase: "window" | "closed" } => row.phase === "window" || row.phase === "closed");
  const diverges = shown.some(
    (row) => live?.symbol != null && row.ticket.symbol === live.symbol && live.side != null && row.ticket.side !== live.side,
  );
  const relation = live && qV2 ? bandRelation(live.band, qV2.band) : "agree";
  const delta = live && qV2 ? qv2Delta(live.q, qV2.q) : null;
  const versions = [
    qV2 && qV2.version ? `v${qV2.version}` : null,
    shown[0] ? `Rule 1 v${shown[0].ticket.version}` : null,
  ].filter(Boolean);

  return (
    <section
      aria-label="Shadow"
      data-testid="shadow-panel"
      data-shadow-open={open ? "true" : "false"}
      className={cn(
        "rounded-[var(--radius-sm)] border border-dashed px-3 py-2",
        diverges ? "border-[var(--color-warn)]" : "border-[var(--shadow-border)]",
      )}
      style={{ background: "var(--shadow-bg)", color: "var(--shadow-fg)" }}
    >
      <button
        type="button"
        className="flex min-h-11 w-full items-center gap-2 text-left"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="text-[11px] font-bold tracking-[0.14em] text-[var(--shadow-fg)]">Shadow — not traded</span>
        {versions.length > 0 && <span className="font-mono text-[12px] text-[var(--color-subtle)]">{versions.join(" · ")}</span>}
        <ChevronDown className={cn("ml-auto h-4 w-4 shrink-0 text-[var(--shadow-fg)]", open && "rotate-180")} />
      </button>
      {open && (
        <div className={cn("mt-2 grid gap-3", density === "card" && "lg:grid-cols-2")}>
          <div className="min-w-0">
            {qV2 && live ? (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  {live.symbol && <span className="text-[13px] font-semibold text-[var(--color-fg)]">{live.symbol}</span>}
                  <GradeBadge g={live.band} size="md" />
                  <span
                    aria-hidden
                    className={cn(
                      "font-mono text-[14px]",
                      relation === "raise" && "text-[var(--color-up)]",
                      relation === "lower" && "text-[var(--color-warn)]",
                      relation === "agree" && "text-[var(--color-muted)]",
                      qV2.vetoed && "text-[var(--color-down)]",
                    )}
                  >
                    →
                  </span>
                  <GradeBadge g={qV2.band} size="md" shadow vetoed={qV2.vetoed} />
                  {qV2.vetoed && (
                    <span className="text-[12px] font-semibold uppercase tracking-wide text-[var(--color-down)] line-through">vetoed</span>
                  )}
                </div>
                <p className="mt-1 font-mono text-[13px] text-[var(--color-fg)]">
                  q {live.q.toFixed(2)} → {qV2.q.toFixed(2)}
                  {delta != null && (
                    <span
                      className={cn(
                        "ml-2 rounded-full border border-[var(--color-border)] px-1.5 py-0.5 text-[12px]",
                        delta > 0 && "text-[var(--color-up)]",
                        delta < 0 && "text-[var(--color-down)]",
                        delta === 0 && "text-[var(--color-muted)]",
                      )}
                    >
                      Δ {delta > 0 ? "+" : ""}
                      {delta.toFixed(2)}
                    </span>
                  )}
                </p>
                {qV2.deltas.length > 0 && (
                  <div className="mt-1">
                    <button
                      type="button"
                      className="inline-flex min-h-11 items-center gap-1 font-mono text-[12px] text-[var(--color-muted)]"
                      aria-expanded={deltasOpen}
                      onClick={() => setDeltasOpen((v) => !v)}
                    >
                      deltas
                      <ChevronDown className={cn("h-3.5 w-3.5", deltasOpen && "rotate-180")} />
                    </button>
                    {deltasOpen && (
                      <ul className="space-y-0.5 font-mono text-[13px]">
                        {qV2.deltas.map((row, i) => {
                          const shown = displayDelta(row.source, row.delta);
                          return (
                            <li key={`${row.source}-${i}`} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3">
                              <span className="text-[var(--color-subtle)]">
                                {row.source}
                                {row.note ? <span className="text-[var(--color-muted)]"> · {row.note}</span> : null}
                              </span>
                              <span
                                className={cn(
                                  "tabular-nums",
                                  shown > 0 && "text-[var(--color-up)]",
                                  shown < 0 && "text-[var(--color-down)]",
                                  shown === 0 && "text-[var(--color-muted)]",
                                )}
                                title={shown !== row.delta ? `stored ${row.delta}` : undefined}
                              >
                                {fmtDelta(shown)}
                              </span>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                )}
              </>
            ) : (
              <p className="text-[13px] text-[var(--color-muted)]">{EMPTY_Q}</p>
            )}
          </div>
          <div className="min-w-0 space-y-3">
            {shown.length === 0 && <p className="text-[13px] text-[var(--color-muted)]">{EMPTY_RULE}</p>}
            {shown.map(({ ticket, phase }) => (
              <TicketBlock
                key={`${ticket.symbol}-${ticket.at}`}
                ticket={ticket}
                phase={phase}
                bars={minuteBySymbol?.[ticket.symbol]}
                diverges={live?.symbol === ticket.symbol && live.side != null && ticket.side !== live.side}
              />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

export type ShadowPreview = {
  live: ShadowPanelProps["live"];
  qV2: QV2 | null;
  rule1: Rule1Ticket[];
  nowMs: number;
  minuteBySymbol?: Record<string, ShadowBar[]>;
  forceOpen?: boolean;
};

/** Local screenshot hook. Stripped from production builds. */
export function devShadowPreview(): ShadowPreview | null {
  if (!import.meta.env.DEV || typeof window === "undefined") return null;
  return (window as Window & { __SHADOW_PREVIEW__?: ShadowPreview }).__SHADOW_PREVIEW__ ?? null;
}

/** One panel for the desk. q_v2 is the lead card's existing field. */
export function ShadowDesk({
  lead,
  rule1,
  nowMs,
  minuteBySymbol,
}: {
  lead: SetupCandidate | null;
  rule1: Rule1Ticket[];
  nowMs: number;
  minuteBySymbol?: Record<string, ShadowBar[]>;
}) {
  const preview = devShadowPreview();
  const card = preview ? null : lead;
  const qV2 = preview ? preview.qV2 : readCardQV2(card);
  const live = preview
    ? preview.live
    : card
      ? {
          // confluence is bestModel.fit, clamped to [0, 0.99] — the same 0–1 scale as q_v2.q.
          q: card.confluence,
          band: String(card.pathBand ?? card.grade),
          symbol: card.symbol,
          side: card.side === "short" ? ("short" as const) : ("long" as const),
        }
      : null;
  return (
    <div className="mb-3">
      {preview && (
        <p className="mb-1 text-[12px] text-[var(--color-muted)]" data-testid="shadow-preview-note">
          Shadow preview — not the live tape
        </p>
      )}
      <ShadowPanel
        live={live}
        qV2={qV2}
        rule1={preview ? preview.rule1 : rule1}
        nowMs={preview ? preview.nowMs : nowMs}
        minuteBySymbol={preview ? preview.minuteBySymbol : minuteBySymbol}
        defaultOpen={preview?.forceOpen ? true : undefined}
      />
    </div>
  );
}
