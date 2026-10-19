/**
 * RhJournalPanel — the live-trade auto-journal on the Review tab.
 *
 * Reads /api/rh/journal: each real Robinhood option round-trip (what the option
 * was), the card that suggested it (band / side / entry→target / why), and what
 * happened (realized $, ROI, hold, killzone). "Reconcile now" pulls the latest
 * fills and re-binds. Read-only — nothing here places an order.
 */
import { useCallback, useEffect, useState } from "react";
import { Activity, RefreshCw, Target, TrendingDown, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";

interface Agg { n: number; wins: number; winRate: number; realizedTotal: number; avgRealized: number; avgRoi: number; avgHoldSecs: number }
interface Analysis { overall: Agg; byBand: Record<string, Agg>; bySide: Record<string, Agg>; byKillzone: Record<string, Agg>; unbound: number }
interface Row {
  id: string; underlying: string; option_type: string | null; strike: number | null; side: string; contracts: number;
  debit: number | null; credit: number | null; realized: number | null; roi: number | null; hold_secs: number | null;
  status: string; win: boolean | null; killzone: string | null;
  card_match: string | null; card_band: string | null; card_side: string | null; card_symbol: string | null;
  plan_entry: number | null; plan_target: number | null; why: unknown; opened_at: string | null;
}
interface Journal { ok: boolean; count: number; analysis: Analysis; rows: Row[]; error?: string }

const money = (n: number | null | undefined) => (n == null ? "—" : `${n >= 0 ? "+" : "−"}$${Math.abs(n).toFixed(n >= 100 || n <= -100 ? 0 : 2)}`);
const pct = (n: number | null | undefined) => (n == null ? "—" : `${(n * 100).toFixed(0)}%`);
const held = (s: number | null) => (s == null ? "—" : s < 90 ? `${s}s` : `${Math.round(s / 60)}m`);

function etTime(iso: string | null): string {
  if (!iso) return "—";
  const t = new Date(iso);
  return Number.isFinite(t.getTime()) ? t.toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false }) : "—";
}

function whyLine(why: unknown): string {
  if (!why || typeof why !== "object") return "";
  const w = why as Record<string, unknown>;
  const s = (w.thesis ?? w.word ?? "") as string;
  if (typeof s === "string" && s.trim()) return s.slice(0, 120);
  const caps = w.capReasons;
  if (Array.isArray(caps) && caps.length) {
    const first = caps[0] as Record<string, unknown>;
    if (first && typeof first.why === "string") return first.why.slice(0, 120);
  }
  return "";
}

export function RhJournalPanel() {
  const [data, setData] = useState<Journal | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async (span = "week") => {
    try {
      const res = await fetch(`/api/rh/journal?span=${span}`, { headers: { accept: "application/json" } });
      setData((await res.json()) as Journal);
    } catch {
      setData({ ok: false, count: 0, analysis: emptyAnalysis(), rows: [], error: "could not read journal" });
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const reconcile = useCallback(async () => {
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch("/api/rh/journal", { method: "POST", headers: { accept: "application/json" } });
      const j = (await res.json()) as { ok: boolean; reason?: string; trips?: number; closed?: number; realizedTotal?: number; bound?: number };
      setNote(j.ok ? `reconciled ${j.trips ?? 0} round-trips · ${j.bound ?? 0} bound to a card · ${money(j.realizedTotal ?? 0)} realized` : j.reason ?? "reconcile failed");
      await load();
    } catch {
      setNote("reconcile failed");
    } finally {
      setBusy(false);
    }
  }, [load]);

  const a = data?.analysis?.overall;
  const rows = data?.rows ?? [];

  return (
    <section className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)]/50 p-3">
      <header className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-[var(--color-primary)]" aria-hidden />
          <h3 className="text-sm font-semibold text-[var(--color-fg)]">Live-trade journal</h3>
          <span className="text-[11px] text-[var(--color-muted)]">Robinhood fills · card · outcome</span>
        </div>
        <button
          type="button"
          onClick={() => void reconcile()}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-full border border-[var(--color-primary)] px-2.5 py-1 text-[11px] font-semibold text-[var(--color-fg)] hover:bg-[color-mix(in_oklab,var(--color-primary)_18%,transparent)] disabled:opacity-50"
        >
          <RefreshCw className={cn("h-3 w-3", busy && "animate-spin")} aria-hidden />
          {busy ? "Reconciling…" : "Reconcile now"}
        </button>
      </header>

      {note && <p className="mb-2 text-[11px] text-[var(--color-muted)]">{note}</p>}

      {/* learning aggregate */}
      {a && a.n > 0 && (
        <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="Realized" value={money(a.realizedTotal)} tone={a.realizedTotal >= 0 ? "up" : "down"} />
          <Stat label="Win rate" value={`${pct(a.winRate)} · ${a.wins}/${a.n}`} />
          <Stat label="Avg ROI" value={pct(a.avgRoi)} tone={a.avgRoi >= 0 ? "up" : "down"} />
          <Stat label="Avg hold" value={held(a.avgHoldSecs)} />
        </div>
      )}

      {a && a.n > 0 && (
        <div className="mb-3 flex flex-wrap gap-1.5 text-[10px]">
          {Object.entries(data!.analysis.byKillzone).filter(([k]) => k !== "—").map(([k, v]) => (
            <span key={k} className="rounded bg-[var(--color-bg)]/60 px-1.5 py-0.5 text-[var(--color-muted)]">
              {k}: {pct(v.winRate)} · {money(v.realizedTotal)} <span className="opacity-60">(n{v.n})</span>
            </span>
          ))}
          {data!.analysis.unbound > 0 && (
            <span className="rounded bg-[var(--color-warn)]/15 px-1.5 py-0.5 text-[var(--color-warn)]">{data!.analysis.unbound} unbound to a card</span>
          )}
        </div>
      )}

      {/* per-trade rows */}
      {rows.length === 0 ? (
        <p className="py-4 text-center text-[12px] text-[var(--color-muted)]">
          {data?.error ?? "No live trades journaled yet. Take a trade on the Agentic account, then Reconcile."}
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {rows.map((r) => <TradeRow key={r.id} r={r} />)}
        </ul>
      )}
    </section>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "up" | "down" }) {
  const color = tone === "up" ? "var(--color-primary)" : tone === "down" ? "#ef4444" : "var(--color-fg)";
  return (
    <div className="rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-bg)]/40 px-2.5 py-1.5">
      <div className="text-[10px] uppercase tracking-wide text-[var(--color-muted)]">{label}</div>
      <div className="font-mono text-sm font-bold" style={{ color }}>{value}</div>
    </div>
  );
}

function TradeRow({ r }: { r: Row }) {
  const win = r.win === true;
  const bound = r.card_match && r.card_match !== "none";
  const contract = `${r.underlying} ${r.strike ?? "?"}${(r.option_type ?? "")[0]?.toUpperCase() ?? ""} ×${r.contracts}`;
  const why = whyLine(r.why);
  return (
    <li className="rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-bg)]/40 px-2.5 py-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 font-mono text-[12px]">
          {r.side === "long" ? <TrendingUp className="h-3.5 w-3.5 text-[var(--color-primary)]" aria-hidden /> : <TrendingDown className="h-3.5 w-3.5 text-[#ef4444]" aria-hidden />}
          <span className="font-semibold text-[var(--color-fg)]">{contract}</span>
          <span className="text-[var(--color-muted)]">{r.debit != null ? r.debit.toFixed(2) : "—"}→{r.credit != null ? r.credit.toFixed(2) : "—"}</span>
        </div>
        <span className="font-mono text-[13px] font-bold" style={{ color: win ? "var(--color-primary)" : r.realized != null && r.realized < 0 ? "#ef4444" : "var(--color-muted)" }}>
          {money(r.realized)} {r.roi != null && <span className="text-[10px] opacity-70">({pct(r.roi)})</span>}
        </span>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-[var(--color-muted)]">
        <span>{etTime(r.opened_at)} ET</span>
        {r.killzone && <span className="rounded bg-[var(--color-bg)]/70 px-1">{r.killzone}</span>}
        <span>· held {held(r.hold_secs)}</span>
        {bound ? (
          <>
            <span className="rounded bg-[color-mix(in_oklab,var(--color-primary)_18%,transparent)] px-1 font-semibold text-[var(--color-primary)]">
              {r.card_band ?? "card"} {r.card_symbol ?? ""} {r.card_side ?? ""}
            </span>
            {r.plan_entry != null && (
              <span className="inline-flex items-center gap-0.5"><Target className="h-3 w-3" aria-hidden />{r.plan_entry}{r.plan_target != null ? `→${r.plan_target}` : ""}</span>
            )}
          </>
        ) : (
          <span className="rounded bg-[var(--color-warn)]/15 px-1 text-[var(--color-warn)]">no card bound</span>
        )}
      </div>
      {why && <p className="mt-1 text-[10px] italic text-[var(--color-muted)]">“{why}”</p>}
    </li>
  );
}

function emptyAgg(): Agg { return { n: 0, wins: 0, winRate: 0, realizedTotal: 0, avgRealized: 0, avgRoi: 0, avgHoldSecs: 0 }; }
function emptyAnalysis(): Analysis { return { overall: emptyAgg(), byBand: {}, bySide: {}, byKillzone: {}, unbound: 0 }; }
