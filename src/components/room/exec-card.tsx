/**
 * The Floor's Execution card: where the room's decisions meet a broker.
 *
 * Off by default. Shadow records the decision and sends nothing. Live is Robinhood Agentic ••6158.
 * This card never talks to Alpaca.
 */

import { useEffect, useState } from "react";
import { OctagonX, ShieldCheck } from "lucide-react";
import { parseOcc } from "@/lib/room/exec/occ";
import type { AuditRow, ExecPhase } from "@/lib/room/exec/types";
import { useExecStore } from "./exec-bridge";
import { flattenBroker } from "./room-engine";
import { rhLinkStatus } from "@/lib/execution/rh-server";

const CARD = "min-w-0 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-1)] p-3";
const HEAD = "mb-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-muted)]";
const BTN =
  "inline-flex items-center gap-1 rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-[11px] text-[var(--color-fg)] hover:border-[var(--color-primary)] focus:outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-primary)] disabled:opacity-40";

const PHASES: { id: ExecPhase; label: string; blurb: string }[] = [
  { id: "off", label: "Off", blurb: "Nothing is sent. The room keeps its own book. The account is still Robinhood Agentic ••6158." },
  { id: "shadow", label: "Shadow", blurb: "The decision is written down and nothing is sent. Robinhood is not touched." },
  { id: "paper", label: "Paper", blurb: "The room's own book only. Nothing is sent to a broker, and Alpaca is not one." },
  { id: "live", label: "Live", blurb: "Robinhood Agentic ••6158. A setup that clears is reviewed, then placed on that account." },
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

/**
 * `collapsed`: the Floor folds an unauthorised card into its one "sign in"
 * card. The card still mounts and polls (so it reappears the moment status
 * loads) — it just draws nothing.
 */
export function ExecCard({ collapsed = false }: { collapsed?: boolean } = {}) {
  const status = useExecStore((s) => s.status);
  const last = useExecStore((s) => s.last);
  const error = useExecStore((s) => s.error);
  const refresh = useExecStore((s) => s.refresh);
  const setPhase = useExecStore((s) => s.setPhase);
  const setKill = useExecStore((s) => s.setKill);

  const [link, setLink] = useState<{ linked: boolean; account: string } | null>(null);

  useEffect(() => {
    void refresh();
    void rhLinkStatus()
      .then(setLink)
      .catch(() => setLink(null));
    const id = window.setInterval(() => void refresh(), 30_000);
    return () => window.clearInterval(id);
  }, [refresh]);

  const wanted: ExecPhase = status?.wanted ?? "off";
  const rows = (last?.rows ?? status?.rows ?? []).slice(0, 12);
  const ev = last?.evidence ?? status?.evidence ?? null;
  const readiness = last?.readiness ?? status?.readiness ?? null;
  const blurb = PHASES.find((p) => p.id === wanted)?.blurb ?? "";
  const fmt = (x: number | null | undefined, d = 1, unit = "%") => (x == null ? "—" : `${x.toFixed(d)}${unit}`);

  if (collapsed) {
    return (
      <a className={BTN} href="/api/rh/connect">
        {link?.linked ? "Robinhood connected" : "Connect Robinhood"}
      </a>
    );
  }
  return (
    <div className={CARD}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className={`${HEAD} mb-0 flex items-center gap-1.5`}>
          <ShieldCheck className="h-3.5 w-3.5" aria-hidden /> Execution — Robinhood Agentic ••6158
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
            title={p.id === "live" && !readiness?.ok ? "Shut until the Robinhood lines below are ticked" : p.blurb}
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
        <button
          type="button"
          className={`${BTN} border-[var(--color-down)] text-[var(--color-down)]`}
          disabled={!status}
          onClick={() => {
            void flattenBroker();
          }}
        >
          Flatten all
        </button>
        <a className={BTN} href="/api/rh/connect">
          {link?.linked ? "Reconnect Robinhood" : "Connect Robinhood"}
        </a>
      </div>

      <p className="mt-2 text-[11px] leading-snug text-[var(--color-muted)]">{blurb}</p>
      <p className="mt-1 text-[11px] leading-snug text-[var(--color-fg)]">
        {link?.linked
          ? `Robinhood ${link.account} is signed in on the server. Opening the desk again does not ask you to connect.`
          : "Connect Robinhood once. The site keeps that sign-in. You do not paste a token, and you do not connect again each time you open the desk."}
      </p>
      <p className="mt-1 font-mono text-[10px] text-[var(--color-subtle)]">
        {status ? `Robinhood Agentic ••6158 · armed ${status.keys.live ? "yes" : "no"} · not Alpaca` : "—"}
        {last ? ` · ${last.role}${last.env ? ` · ${last.env}` : ""} · step ${etTime(last.atMs)} ET` : ""}
        {last?.account ? ` · acct $${Math.round(last.account.equity).toLocaleString()} (cash $${Math.round(last.account.cash).toLocaleString()})` : ""}
      </p>
      {status && (
        <p className={`mt-1 text-[10px] leading-snug ${status.netMs ? "text-[var(--color-subtle)]" : "text-[var(--color-down)]"}`}>
          Safety net (cron /api/cron/exec-flatten — from 15:30 ET, closes the Robinhood positions this desk opened, tab shut or not):{" "}
          {status.netMs
            ? `last ran ${new Date(status.netMs).toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false })} ET.`
            : `never ran. Schedule it and set CRON_USER_ID=${status.userId} (this trader's id) on the server — until then a position outlives a closed tab.`}
        </p>
      )}
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
          <div className={HEAD}>Robinhood checklist — {readiness?.ok ? "cleared" : "shut"}</div>
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
