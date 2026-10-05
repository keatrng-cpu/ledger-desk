/**
 * The Floor's Execution card: where the room's decisions meet a broker.
 *
 * Off by default. Shadow records every decision beside the broker's real quote and sends nothing. Paper sends
 * through the gates to Alpaca's PAPER account. Live is a checklist the trader clears by committing code — the
 * button stays disabled until every line is ticked, and the card says which line is not. Every number here is
 * counted by the server from the audit table (src/lib/room/exec/gates.ts evidenceOf); none comes from a model.
 */

import { useEffect } from "react";
import { OctagonX, ShieldCheck } from "lucide-react";
import { parseOcc } from "@/lib/room/exec/occ";
import type { AuditRow, ExecPhase } from "@/lib/room/exec/types";
import { useExecStore } from "./exec-bridge";
import { flattenBroker } from "./room-engine";

const CARD = "min-w-0 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-1)] p-3";
const HEAD = "mb-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-muted)]";
const BTN =
  "inline-flex items-center gap-1 rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-[11px] text-[var(--color-fg)] hover:border-[var(--color-primary)] focus:outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-primary)] disabled:opacity-40";

const PHASES: { id: ExecPhase; label: string; blurb: string }[] = [
  { id: "off", label: "Off", blurb: "Nothing is sent. The room is a paper book." },
  { id: "shadow", label: "Shadow", blurb: "Every decision is recorded beside the broker's real quote and what each gate would have said. Nothing is sent — this is the evidence the model's prices are judged on." },
  { id: "paper", label: "Paper", blurb: "Orders go to Alpaca's PAPER account through the gates: a marketable limit, cancelled if unfilled after 20 s, exits that escalate to market. One device at a time sends." },
  { id: "live", label: "Live", blurb: "Real money. Shut until every line of the checklist is ticked." },
];

const STATUS_COLOR: Record<string, string> = {
  filled: "var(--color-up)",
  working: "var(--color-primary)",
  reserved: "var(--color-primary)",
  refused: "var(--color-down)",
  rejected: "var(--color-down)",
  error: "var(--color-down)",
  cancelled: "var(--color-muted)",
  shadow: "var(--color-muted)",
};

const etTime = (ms: number) => new Date(ms).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });

function contractLabel(sym: string): string {
  const o = parseOcc(sym);
  return o ? `${o.underlier} ${o.strike}${o.type === "CALL" ? "C" : "P"} ${o.exp.slice(5).replace("-", "/")}` : sym;
}

function OrderRow({ r }: { r: AuditRow }) {
  const slip = r.filledAvgPx != null && r.quote ? r.filledAvgPx - (r.side === "buy" ? r.quote.ask : r.quote.bid) : null;
  return (
    <li className="space-y-0.5 border-b border-[var(--color-border)] pb-1 last:border-0">
      <div className="flex flex-wrap items-center gap-x-2 font-mono text-[11px]">
        <span className="text-[var(--color-muted)]">{etTime(r.atMs)}</span>
        <span className="font-semibold">{r.side === "buy" ? "BUY" : "SELL"}</span>
        <span>
          {r.qty}× {contractLabel(r.symbol)}
        </span>
        <span className="text-[var(--color-muted)]">{r.limitPx != null ? `lmt ${r.limitPx.toFixed(2)}` : r.status === "shadow" ? "—" : "mkt"}</span>
        {r.filledAvgPx != null && r.filledQty > 0 && (
          <span>
            filled {r.filledQty}@{r.filledAvgPx.toFixed(2)}
            {slip != null ? ` (${slip >= 0 ? "+" : "−"}${Math.abs(slip).toFixed(2)} vs quote)` : ""}
          </span>
        )}
        <span className="ml-auto rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase" style={{ color: STATUS_COLOR[r.status] ?? "var(--color-muted)", border: `1px solid ${STATUS_COLOR[r.status] ?? "var(--color-border)"}` }}>
          {r.phase === "shadow" ? "shadow" : r.status}
        </span>
      </div>
      {r.reasons.length > 0 && <div className="text-[10px] leading-snug text-[var(--color-muted)]">{r.reasons.join(" · ")}</div>}
    </li>
  );
}

export function ExecCard() {
  const status = useExecStore((s) => s.status);
  const last = useExecStore((s) => s.last);
  const error = useExecStore((s) => s.error);
  const refresh = useExecStore((s) => s.refresh);
  const setPhase = useExecStore((s) => s.setPhase);
  const setKill = useExecStore((s) => s.setKill);

  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => void refresh(), 30_000);
    return () => window.clearInterval(id);
  }, [refresh]);

  const wanted: ExecPhase = status?.wanted ?? "off";
  const rows = (last?.rows ?? status?.rows ?? []).slice(0, 12);
  const ev = last?.evidence ?? status?.evidence ?? null;
  const readiness = last?.readiness ?? status?.readiness ?? null;
  const blurb = PHASES.find((p) => p.id === wanted)?.blurb ?? "";
  const fmt = (x: number | null | undefined, d = 1, unit = "%") => (x == null ? "—" : `${x.toFixed(d)}${unit}`);

  return (
    <div className={CARD}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className={`${HEAD} mb-0 flex items-center gap-1.5`}>
          <ShieldCheck className="h-3.5 w-3.5" aria-hidden /> Execution — orders to a broker
        </div>
        <span className="rounded border border-[var(--color-border)] px-2 py-0.5 font-mono text-[11px] uppercase">{wanted}</span>
      </div>

      {error && !status && <p className="mt-2 text-[11px] text-[var(--color-down)]">Execution status unavailable: {error}. Sign in (account chip, top right) and check the database.</p>}

      <div className="mt-2 flex flex-wrap items-center gap-1.5" role="group" aria-label="Execution phase">
        {PHASES.map((p) => (
          <button
            key={p.id}
            type="button"
            className={`${BTN} ${wanted === p.id ? "border-[var(--color-primary)]" : ""}`}
            aria-pressed={wanted === p.id}
            disabled={!status || (p.id === "live" && !readiness?.ok)}
            title={p.id === "live" && !readiness?.ok ? "Shut until every line of the checklist below is ticked" : p.blurb}
            onClick={() => {
              void setPhase(p.id).then((r) => {
                if (!r.ok) window.alert(r.why);
              });
            }}
          >
            {p.label}
          </button>
        ))}
        <span className="mx-1 h-4 w-px bg-[var(--color-border)]" aria-hidden />
        <button
          type="button"
          className={`${BTN} ${status?.killed ? "border-[var(--color-down)] text-[var(--color-down)]" : ""}`}
          aria-pressed={Boolean(status?.killed)}
          disabled={!status}
          onClick={() => void setKill(!status?.killed, "kill switch")}
          title="Stops NEW entries. Exits keep running — a kill never traps an open position."
        >
          <OctagonX className="h-3 w-3" aria-hidden /> {status?.killed ? "Kill ON — release" : "Kill switch"}
        </button>
        {(wanted === "paper" || wanted === "live") && (
          <button
            type="button"
            className={`${BTN} border-[var(--color-down)] text-[var(--color-down)]`}
            onClick={() => {
              if (window.confirm("Close everything this system has bought at the broker, now, stepping down to market if it does not fill? New entries also stop (the kill switch goes on). The room's paper book keeps its positions until its own exit rules close them.")) void flattenBroker();
            }}
          >
            Flatten all
          </button>
        )}
      </div>

      <p className="mt-2 text-[11px] leading-snug text-[var(--color-muted)]">{blurb}</p>
      <p className="mt-1 font-mono text-[10px] text-[var(--color-subtle)]">
        {status ? `keys: paper ${status.keys.paper ? "set" : "missing"} · live ${status.keys.live ? "set" : "missing"} · quotes: ${status.feed}${status.feed !== "opra" ? " (free, modified — never prices live)" : ""}` : "—"}
        {last ? ` · ${last.role}${last.env ? ` · ${last.env}` : ""} · step ${etTime(last.atMs)} ET` : ""}
        {last?.account ? ` · acct $${Math.round(last.account.equity).toLocaleString()} (cash $${Math.round(last.account.cash).toLocaleString()})` : ""}
      </p>
      {last && last.notes.length > 0 && <p className="mt-1 text-[10px] leading-snug text-[var(--color-muted)]">{last.notes.slice(0, 3).join(" · ")}</p>}
      {status?.killed && <p className="mt-1 text-[11px] font-semibold text-[var(--color-down)]">Kill switch on{status.killReason ? ` — ${status.killReason}` : ""}: no new entries.</p>}

      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <div>
          <div className={HEAD}>The paper record (counted from the audit table)</div>
          {ev ? (
            <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5 text-[11px]">
              <dt className="text-[var(--color-muted)]">Shadow decisions recorded</dt>
              <dd className="font-mono">{ev.shadowN}</dd>
              <dt className="text-[var(--color-muted)]">Model vs real quote (median gap)</dt>
              <dd className="font-mono">
                {fmt(ev.medianQuoteErrPct)} <span className="text-[var(--color-subtle)]">n={ev.quoteErrN}</span>
              </dd>
              <dt className="text-[var(--color-muted)]">Paper fills through the broker</dt>
              <dd className="font-mono">{ev.paperFills}</dd>
              <dt className="text-[var(--color-muted)]">Paper round trips</dt>
              <dd className="font-mono">{ev.paperRoundTrips}</dd>
              <dt className="text-[var(--color-muted)]">Entry fill vs quoted ask (median)</dt>
              <dd className="font-mono">
                {fmt(ev.medianEntrySlipPct, 2)} <span className="text-[var(--color-subtle)]">n={ev.entrySlipN}</span>
              </dd>
              <dt className="text-[var(--color-muted)]">Unreconciled orders</dt>
              <dd className="font-mono">{ev.unreconciled}</dd>
              <dt className="text-[var(--color-muted)]">Broker errors + rejects</dt>
              <dd className="font-mono">{fmt(ev.errorRatePct)}</dd>
            </dl>
          ) : (
            <p className="text-[11px] text-[var(--color-muted)]">No record yet.</p>
          )}
        </div>
        <div>
          <div className={HEAD}>Live checklist — {readiness?.ok ? "cleared" : "shut"}</div>
          <ul className="space-y-0.5 text-[11px]">
            {(readiness?.items ?? []).map((i) => (
              <li key={i.id} className={i.ok ? "text-[var(--color-muted)]" : "text-[var(--color-fg)]"}>
                <span className={i.ok ? "text-[var(--color-up)]" : "text-[var(--color-down)]"}>{i.ok ? "✓" : "✗"}</span> {i.label}
                {!i.ok && <span className="block pl-4 text-[10px] leading-snug text-[var(--color-muted)]">{i.detail}</span>}
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="mt-3">
        <div className={HEAD}>Orders and shadow decisions</div>
        {rows.length ? (
          <ul className="space-y-1.5">
            {rows.map((r) => (
              <OrderRow key={r.clientOrderId} r={r} />
            ))}
          </ul>
        ) : (
          <p className="text-[11px] text-[var(--color-muted)]">Nothing yet. Orders and shadow decisions appear here the moment the room acts.</p>
        )}
      </div>
    </div>
  );
}
