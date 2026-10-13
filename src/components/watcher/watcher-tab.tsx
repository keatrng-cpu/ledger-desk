/** Watcher tab — read-only view of the live desk-watcher (RH options placed from the desk). No order buttons. */
import { useEffect, useState } from "react";
import { weekLine } from "@/lib/execution/weekly-lock";

type Gate = { name: string; ok: boolean | null; why: string };
type Pos = {
  contract: { symbol?: string; exp?: string; strike?: number; type?: string }; qty: number; ordered?: number; filled: boolean;
  entry: number | null; mark: number | null; pnl_pct: number | null; pnl_usd: number | null; fut_symbol?: string; fut_side?: string;
  fut_px: number | null; stop: number | null; t1: number | null; t2: number | null; dist_stop: number | null; dist_t1: number | null;
  dist_t2: number | null; trim_at_pct: number; trimmed: boolean; exit_status?: string | null; exit_why?: string | null;
};
type Fire = { at: number; signal: string; card: Record<string, unknown>; contract: Pos["contract"]; ordered: number; limit: number; debit: number; fill?: number | null };
type Skip = { at: number; signal: string; band?: string; q?: number; why: [string, string][] };
type Status = {
  heartbeat: number; mode?: string; live: boolean; fire_enabled: boolean; stop_file: boolean; account: string; rules_version?: number;
  rules_hash?: string; rules_pin?: string | null; sole_blocker?: { signal?: string; band?: string; q?: number; q_raw?: number | null; line: string; at?: number } | null;
  card: Record<string, unknown>; gates: Gate[]; gates_at?: number; position: Pos | null;
  day: { date: string; entries: number; cap: number; bplus_entries: number; lost: boolean; fires: Fire[]; skips: Skip[] };
  week?: { key?: string | null; pnl?: number | null; peak?: number | null; locked?: boolean | null; state?: string | null } | null;
};
type Resp = { ok: boolean; status: Status | null; heartbeatAgeS: number | null; stale?: boolean; note?: string; error?: string };

const t = (s?: number) => (s ? new Date(s * 1000).toLocaleTimeString("en-US", { timeZone: "America/Chicago", hour12: false }) + " CT" : "—");
const n = (v: unknown, d = 2) => (typeof v === "number" && Number.isFinite(v) ? v.toFixed(d) : "—");
const cls = (ok: boolean | null) => (ok === true ? "text-emerald-400" : ok === false ? "text-rose-400" : "text-amber-300");

export function WatcherTab() {
  const [r, setR] = useState<Resp | null>(null);
  useEffect(() => {
    let live = true;
    const load = () => fetch("/api/desk/watcher", { cache: "no-store" }).then((x) => x.json()).then((j) => live && setR(j)).catch(() => live && setR({ ok: false, status: null, heartbeatAgeS: null, error: "unreachable" }));
    load(); const id = setInterval(load, 5000);
    return () => { live = false; clearInterval(id); };
  }, []);
  if (!r) return <div className="text-sm text-[var(--color-muted)]">Loading watcher…</div>;
  const s = r.status;
  if (!s) return <div className="text-sm text-[var(--color-muted)]">{r.error ?? r.note ?? "No watcher status yet."}</div>;
  const c = s.card ?? {}; const p = s.position;
  return (
    <div className="space-y-4 text-sm">
      <section className="rounded border border-[var(--color-border)] p-3">
        <div className="flex flex-wrap gap-4">
          <span className={r.stale ? "text-rose-400" : "text-emerald-400"}>● {r.stale ? "STALE" : "LIVE"} heartbeat {t(s.heartbeat)} ({n(r.heartbeatAgeS, 0)}s ago)</span>
          <span>mode {s.mode ?? "—"}</span><span>LIVE={String(s.live)}</span><span>FIRE={String(s.fire_enabled)}</span>
          <span className={s.stop_file ? "text-rose-400" : ""}>STOP file {s.stop_file ? "PRESENT" : "absent"}</span>
          <span>acct {s.account}</span><span>rules v{s.rules_version ?? "—"} {s.rules_hash ?? ""}{s.rules_pin && s.rules_pin !== s.rules_hash ? ` (pin ${s.rules_pin})` : ""}</span>
        </div>
      </section>
      <section className="rounded border border-[var(--color-border)] p-3">
        <h3 className="mb-2 font-semibold">Card being evaluated</h3>
        <div className="mb-2">{String(c.symbol ?? "—")} {String(c.side ?? "")} · {String(c.band ?? "—")} q {n(c.q)} · entry {n(c.entry)} stop {n(c.stop_px)} T1 {n(c.first_target)} T2 {n(c.t2)} · R:R {n(c.card_rr)} · disp {n(c.disp_strength)} · floor {String(c.verdict ?? "—")} · brain {String(c.brain_word ?? "—")} · held {n(c.band_persist_s, 1)}s{c.size_cut ? " · size cut" : ""}</div>
        {s.sole_blocker ? (
          <div className="text-xs font-medium" data-testid="sole-blocker">
            Top card {s.sole_blocker.band ?? "—"} q {s.sole_blocker.q ?? "—"}{s.sole_blocker.q_raw != null && s.sole_blocker.q_raw !== s.sole_blocker.q ? ` (pre-clamp ${s.sole_blocker.q_raw})` : ""}: {s.sole_blocker.line}
          </div>
        ) : null}
        <div className="text-xs text-[var(--color-muted)]">gates at {t(s.gates_at)}</div>
        <ul className="mt-1 space-y-0.5">
          {s.gates.map((g) => (<li key={g.name}><span className={cls(g.ok)}>{g.ok === true ? "PASS" : g.ok === false ? "FAIL" : "UNVERIFIED"}</span> <b>{g.name}</b> <span className="text-[var(--color-muted)]">{g.why}</span></li>))}
        </ul>
      </section>
      <section className="rounded border border-[var(--color-border)] p-3">
        <h3 className="mb-2 font-semibold">Live position</h3>
        {!p ? <div className="text-[var(--color-muted)]">Flat.</div> : (
          <div className="space-y-1">
            <div>{p.qty}/{p.ordered ?? p.qty}× {p.contract.symbol} {p.contract.exp} {p.contract.strike}{(p.contract.type ?? "").slice(0, 1).toUpperCase()} · {p.filled ? "filled" : "working"} @ {n(p.entry)}</div>
            <div>mark {n(p.mark)} · PnL <span className={(p.pnl_pct ?? 0) >= 0 ? "text-emerald-400" : "text-rose-400"}>{p.pnl_pct == null ? "—" : (p.pnl_pct * 100).toFixed(1) + "%"} / ${n(p.pnl_usd)}</span> · trim at +{(p.trim_at_pct * 100).toFixed(0)}% {p.trimmed ? "(trimmed)" : ""}</div>
            <div>{p.fut_symbol} {n(p.fut_px)} · to stop {n(p.dist_stop)} ({n(p.stop)}) · to T1 {n(p.dist_t1)} ({n(p.t1)}) · to T2 {n(p.dist_t2)} ({n(p.t2)})</div>
            <div>exit status: {p.exit_status ?? "—"} {p.exit_why ? `— ${p.exit_why}` : ""}</div>
          </div>)}
      </section>
      <section className="rounded border border-[var(--color-border)] p-3">
        <h3 className="mb-1 font-semibold" data-testid="watcher-week">{weekLine(s.week)}{s.week?.key ? ` (week of ${s.week.key})` : ""}</h3>
        <h3 className="mb-2 font-semibold">Day {s.day.date} · entries {s.day.entries}/{s.day.cap}{s.day.lost ? " · loss recorded (no B+)" : ""}</h3>
        <div className="font-medium">Fires</div>
        {s.day.fires.length === 0 ? <div className="text-[var(--color-muted)]">None.</div> : s.day.fires.map((f) => (
          <div key={f.signal + f.at}>{t(f.at)} · {String(f.card.band)} {String(f.card.symbol)} {String(f.card.side)} q {n(f.card.q)} · entry {n(f.card.entry)} stop {n(f.card.stop_px)} T1 {n(f.card.first_target)} · {f.ordered}× {f.contract.symbol} {f.contract.strike}{(f.contract.type ?? "").slice(0, 1).toUpperCase()} {f.contract.exp} @ {n(f.limit)} · debit ${n(f.debit, 0)}{f.fill != null ? ` · fill ${n(f.fill)}` : ""}</div>))}
        <div className="mt-2 font-medium">Skips</div>
        {s.day.skips.length === 0 ? <div className="text-[var(--color-muted)]">None.</div> : [...s.day.skips].reverse().map((k) => (
          <div key={k.signal + k.at}>{t(k.at)} · {k.band} q {n(k.q)} · {k.why.map(([g, w]) => `${g}: ${w}`).join(" | ")}</div>))}
      </section>
    </div>
  );
}
