/**
 * The overnight board — the 15:00 ET decision, drawn like the Now desk.
 *
 * Same spine as "The trade, drawn": a verdict word, must-layers as pass /
 * wait / fail pills, the one blocking layer spelled out, numeric cells, and
 * an evidence line. Different vocabulary on purpose — HOLD / TRIM / FLATTEN
 * can never be misread as an entry signal.
 *
 * The red banner is not decoration. "You cannot trade this for 17h15m" is
 * the single fact most likely to be forgotten at 15:00, and it is the one
 * that makes the working stop imaginary.
 */

import { useEffect, useMemo, useState } from "react";
import { MoonStar } from "lucide-react";
import type { DeskPayload } from "@/lib/trading/build-desk";
import { gradeOvernight, type OvernightLayer, type OvernightRead } from "@/lib/trading/overnight-swing";
import { loadRhSleeve, subscribeRhSleeve, type RhSleeve } from "@/lib/trading/options-sleeve";
import { loadRhIncome, subscribeRhIncome } from "@/lib/trading/rh-income";

function wordTone(w: OvernightRead["word"]): string {
  if (w === "HOLD") return "bg-[color-mix(in_oklab,var(--color-up)_22%,transparent)] text-[var(--color-up)]";
  if (w === "TRIM") return "bg-[color-mix(in_oklab,var(--color-warn)_22%,transparent)] text-[var(--color-warn)]";
  return "bg-[color-mix(in_oklab,var(--color-down)_22%,transparent)] text-[var(--color-down)]";
}

function LayerPill({ layer }: { layer: OvernightLayer }) {
  const tone =
    layer.state === "pass"
      ? "text-[var(--color-up)] border-[color-mix(in_oklab,var(--color-up)_45%,transparent)]"
      : layer.state === "fail"
        ? "text-[var(--color-down)] border-[color-mix(in_oklab,var(--color-down)_45%,transparent)]"
        : "text-[var(--color-warn)] border-[color-mix(in_oklab,var(--color-warn)_45%,transparent)]";
  const mark = layer.state === "pass" ? "✓" : layer.state === "fail" ? "✕" : "○";
  return (
    <li
      title={layer.detail}
      className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${tone} ${layer.must ? "" : "opacity-60"}`}
    >
      <span aria-hidden>{mark} </span>
      {layer.label}
    </li>
  );
}

function Cell({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "up" | "down" | "warn" }) {
  const color =
    tone === "up" ? "var(--color-up)" : tone === "down" ? "var(--color-down)" : tone === "warn" ? "var(--color-warn)" : "var(--color-fg)";
  return (
    <div className="bg-[var(--color-surface)] px-3 py-2">
      <div className="text-[9px] uppercase tracking-wide text-[var(--color-subtle)]">{label}</div>
      <div className="tabular text-sm font-semibold" style={{ color }}>
        {value}
      </div>
      {sub && <div className="tabular text-[9px] text-[var(--color-muted)]">{sub}</div>}
    </div>
  );
}

export function OvernightBoard({ desk }: { desk: DeskPayload }) {
  const [sleeve, setSleeve] = useState<RhSleeve>(() => loadRhSleeve());
  const [fills, setFills] = useState(() => loadRhIncome().fills);
  const [showEvidence, setShowEvidence] = useState(false);
  // The board is a function of the wall clock, so it re-grades on the desk
  // poll (desk.fetchedAt changes) — no timer of its own.
  useEffect(() => subscribeRhSleeve(setSleeve), []);
  useEffect(() => subscribeRhIncome(() => setFills(loadRhIncome().fills)), []);

  const read = useMemo(() => {
    // The spot must belong to the ticket being graded — the gap arithmetic
    // is delta x move x spot, so the wrong underlier's price is the wrong
    // answer, not a rounding error. SPX/XSP quote off the SPY proxy x10 /
    // x1 respectively; only SPY and QQQ have live spots here.
    const open = fills.find((f) => !f.closedAt);
    const sym = (open?.underlier ?? "QQQ").toUpperCase();
    const spy = desk.proxies?.SPY?.price ?? null;
    const qqq = desk.proxies?.QQQ?.price ?? null;
    const spot =
      sym === "QQQ" ? qqq
      : sym === "SPY" || sym === "XSP" ? spy
      : sym === "SPX" && spy != null ? spy * 10
      : null;
    return gradeOvernight({ desk, now: Date.parse(desk.fetchedAt) || 0, sleeve, fills, spot });
  }, [desk, sleeve, fills]);

  const m = read.mechanics;
  const pos = read.position;

  return (
    <section className="flex flex-col gap-2">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <MoonStar className="h-4 w-4 text-[var(--color-primary)]" aria-hidden />
          <h2 className="text-sm font-semibold tracking-tight">Overnight — the 15:00 decision</h2>
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${wordTone(read.word)}`}>{read.word}</span>
          <span className="tabular text-[10px] text-[var(--color-muted)]">
            {read.mustPass}/{read.mustNeed} · {read.windowLabel}
          </span>
        </div>
        <button
          type="button"
          onClick={() => setShowEvidence((s) => !s)}
          aria-expanded={showEvidence}
          className="rounded-[var(--radius-sm)] border border-[var(--color-border)] px-2 py-1 text-[10px] text-[var(--color-muted)] hover:text-[var(--color-fg)]"
        >
          {showEvidence ? "Hide evidence" : "Why these gates?"}
        </button>
      </header>

      {/* The fact most likely to be forgotten at 15:00. */}
      <p
        role={m.overnightTradable ? undefined : "alert"}
        className={`rounded-[var(--radius-md)] border px-3 py-1.5 text-xs font-medium ${
          m.overnightTradable
            ? "border-[color-mix(in_oklab,var(--color-warn)_45%,transparent)] text-[var(--color-warn)]"
            : "border-[color-mix(in_oklab,var(--color-down)_55%,transparent)] bg-[color-mix(in_oklab,var(--color-down)_12%,transparent)] text-[var(--color-down)]"
        }`}
      >
        {m.overnightTradable
          ? `Tradable overnight — next print ${m.nextTradable}. Limit orders only; a resting limit in a thin book is a request, not a stop.`
          : `No exit for ${m.unmanageableLabel} — next print ${m.nextTradable}. The −25% working stop does not exist in that window.`}
        {m.weekend ? " Weekend hold: 65h15m and two news cycles." : ""}
      </p>

      <ol className="flex flex-wrap items-center gap-1" aria-label="Overnight layers">
        {read.layers.map((l) => (
          <LayerPill key={l.id} layer={l} />
        ))}
      </ol>

      <p className="rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 py-2 text-xs text-[var(--color-muted)]">
        <span className="font-medium text-[var(--color-warn)]">{read.missing}</span>
        {read.missingDetail ? ` — ${read.missingDetail}` : ""}
      </p>

      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-[var(--radius-md)] bg-[var(--color-border)] sm:grid-cols-4">
        <Cell
          label="Ticket"
          value={pos ? `${pos.underlier} ${pos.side}` : "none open"}
          sub={pos ? `$${Math.round(pos.debit).toLocaleString()} debit${pos.dte != null ? ` · ${pos.dte}DTE` : " · DTE unknown"}` : "grading the mechanics"}
          tone={pos ? undefined : "warn"}
        />
        <Cell label="Blind for" value={m.unmanageableLabel} sub={m.nextTradable} tone="down" />
        <Cell
          label="Gap that breaks it"
          value={m.breakGapPct != null ? `${m.breakGapPct.toFixed(2)}%` : "—"}
          sub={m.breakGapFrequency ?? "needs delta + spot on the ticket"}
          tone={m.breakGapPct != null && m.breakGapPct < 1 ? "down" : undefined}
        />
        <Cell
          label="Theta charged"
          value={`${m.thetaDays}d`}
          sub={m.weekend ? "weekend ≈ 1.25 business days, not 3" : "one business day"}
        />
      </div>

      <div className="rounded-[var(--radius-md)] border border-[color-mix(in_oklab,var(--color-primary)_30%,var(--color-border))] px-3 py-2">
        <p className="text-[11px] font-medium text-[var(--color-fg)]">{read.vehicle.headline}</p>
        <p className="mt-0.5 text-[11px] leading-snug text-[var(--color-muted)]">{read.vehicle.detail}</p>
        {read.vehicle.stopPts != null && (
          <p className="tabular mt-1 text-[10px] text-[var(--color-subtle)]">
            Working stop {read.vehicle.stopPts} ES pt ≈ ${read.vehicle.riskDollars} on 1 MES · flat at the 09:30 open, not after it.
          </p>
        )}
      </div>

      {showEvidence && (
        <ul className="flex flex-col gap-1 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-2)] p-3 text-[11px] leading-snug text-[var(--color-muted)]">
          {read.evidence.map((e, i) => (
            <li key={i}>· {e}</li>
          ))}
          <li className="mt-1 border-t border-[var(--color-border)] pt-2 text-[10px] text-[var(--color-subtle)]">
            Broker mechanics verified 2026-09-22 and re-verifiable: Robinhood ETF options 09:30–16:15 ET, no extended-hours options; SPX/XSP/VIX/RUT on Cboe GTH 20:15–09:25 ET, limit only; OCC auto-exercise at $0.01 ITM; broker force-sale from 15:30 ET on expiry day; PDT eliminated 2026-06-04 (FINRA 26-10).
          </li>
        </ul>
      )}
    </section>
  );
}
