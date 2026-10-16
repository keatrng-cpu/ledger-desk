/**
 * Shadow panel — one on the desk, beside the Rule 1 ticket. Display only.
 *
 * Reads the card's existing q_v2. Does not recompute it, and does not gate,
 * size, or fire. After 09:00 CT the day's ticket stays, dimmed, until the
 * next weekday session opens at 08:30 CT.
 */
import { useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";
import type { QV2 } from "@/lib/trading/q-v2";
import type { Rule1Ticket } from "@/lib/trading/rule1";
import type { SetupCandidate } from "@/lib/trading/scanner";
import { cn } from "@/lib/utils";
import {
  bandRelation,
  optionLine,
  qv2Delta,
  readCardQV2,
  rule1Lines,
  rule1Phase,
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

function LiveBadge({ band }: { band: string }) {
  const execute = band === "A+" || band === "A" || band === "A-" || band === "A−";
  return (
    <span
      className={cn(
        "inline-flex min-h-6 items-center rounded-full border px-2.5 py-1 font-mono text-[14px] font-bold uppercase leading-none",
        execute && "border-[color-mix(in_oklab,var(--color-primary)_45%,var(--color-border))] text-[var(--color-primary)]",
        band === "B+" && "border-[color-mix(in_oklab,var(--color-warn)_45%,var(--color-border))] text-[var(--color-warn)]",
        !execute && band !== "B+" && "border-[var(--color-border)] text-[var(--color-subtle)]",
      )}
    >
      {band}
    </span>
  );
}

function ShadowBadge({ band, vetoed }: { band: string; vetoed: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex min-h-6 items-center gap-1 rounded-full border border-dashed px-2.5 py-1 font-mono text-[14px] font-bold uppercase leading-none opacity-70",
        vetoed
          ? "border-[var(--color-down)] text-[var(--color-down)] line-through"
          : "border-[var(--shadow-border)] text-[var(--shadow-fg)]",
      )}
    >
      <span className="text-[10px] font-semibold tracking-wide">v2</span>
      {band}
    </span>
  );
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
  const lines = rule1Lines(ticket);
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
      {lines.length > 0 && (
        <dl className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 font-mono text-[13px]">
          {lines.map((line) => (
            <div key={line.id} className="contents">
              <dt
                className={cn(
                  "text-[12px] font-bold uppercase tracking-wide",
                  line.id === "stop" && "text-[var(--level-stop)]",
                  line.id === "entry" && "text-[var(--level-entry)]",
                  line.id === "target" && "font-bold text-[var(--level-target)]",
                  line.id !== "stop" && line.id !== "entry" && line.id !== "target" && "text-[var(--color-subtle)]",
                )}
              >
                {line.label}
              </dt>
              <dd
                className={cn(
                  "text-right tabular",
                  line.id === "stop" && "font-semibold text-[var(--level-stop)]",
                  line.id === "entry" && "font-semibold text-[var(--level-entry)]",
                  line.id === "target" && "font-bold text-[var(--level-target)]",
                  line.id !== "stop" && line.id !== "entry" && line.id !== "target" && "text-[var(--color-fg)]",
                )}
              >
                {line.value}
              </dd>
            </div>
          ))}
        </dl>
      )}
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
        <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--shadow-fg)]">Shadow</span>
        <span className="text-[12px] text-[var(--color-muted)]">not traded</span>
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
                  <LiveBadge band={live.band} />
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
                  <ShadowBadge band={qV2.band} vetoed={qV2.vetoed} />
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
