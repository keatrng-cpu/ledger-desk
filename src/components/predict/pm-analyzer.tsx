/**
 * PM ANALYZER — The Mead Hall + Predict, one view (Keaton, 2026-10-06).
 *
 *   Top     3D Mead Hall as the live display, fed ONLY by the signal board:
 *           getPredictionSignals → SignalBoard → hallLayout(board)
 *             jumbotron = #1 ranked · rune board = next 5 ·
 *             crowd = CrowdRead from real price velocity (never random)
 *   Below   one desk panel per market: A–F grade + reasons, implied after
 *           fees, spread / liquidity, move since open + velocity, time to
 *           settle, freshness, edge read (or "no edge read"), paper ticket,
 *           paper record with hit-rate / calibration rings.
 *   Fold    the sports scanner (GO ledger) — its scan rows are the REAL model
 *           inputs (modelInputsFromScanRows) sent to getPredictionSignals.
 *
 * PAPER ONLY. paperTicketFromSignal → this device's paper book. No order path.
 * Palette: pine / iron / brass (MEAD) — no team colours or chants.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Beer, Camera, RefreshCw, Ticket } from "lucide-react";
import { getPredictionSignals } from "@/lib/predict/predict-server";
import {
  modelInputsFromScanRows,
  paperTicketFromSignal,
  scorePaper,
  walkForward,
  durationWords,
  NO_EDGE_READ,
  NO_GRADE_LABEL,
  TOO_FEW,
  gradeLabel,
  type MarketSignal,
  type ModelInput,
  type PaperTicket,
  type PaperScore,
  type SignalBoard,
  type Side,
} from "@/lib/predict/signals";
import type { ScanRow } from "@/lib/predict/scanner";
import { addPaper, loadPaper, subscribePaper } from "@/lib/predict/pm-paper-store";
import { MeadScene, type Reaction, type TicketSide } from "@/components/mead/mead-scene";
import { MEAD, categoryLabel, eventLabel } from "@/components/mead/mead-screens";
import { createSignalHallFeed, crowdLabel, EMPTY_FEED, signalToHallMarket, type HallFeedState, type SignalHallFeed } from "@/components/mead/mead-signal-feed";
import { PredictTab } from "./predict-tab";

const BTN =
  "inline-flex items-center gap-1 rounded border px-2 py-1 text-[11px] focus:outline-none focus-visible:ring-1 disabled:opacity-40";
const BTN_STYLE = { borderColor: "rgba(196,163,90,0.45)", color: MEAD.white, background: "rgba(10,22,16,0.7)" } as const;
const PANEL = "min-w-0 rounded-lg border p-3";
const PANEL_STYLE = { borderColor: "rgba(196,163,90,0.35)", background: `linear-gradient(180deg, ${MEAD.pineDeep}, ${MEAD.pineInk})`, color: MEAD.white } as const;
const LABEL = "text-[10px] font-semibold uppercase tracking-wide";
const MUTED = { color: "#a7c4b5" } as const;
const REACT_COLOR: Record<Reaction, string> = { cheer: "#22c55e", groan: "#ef4444", hail: MEAD.brass };
const GRADE_COLOR: Record<string, string> = { A: "#86efac", B: MEAD.brass, C: "#cbd5e1", D: "#fca5a5", F: "#f87171" };

const pct = (x: number | null | undefined, d = 1) => (x == null ? "—" : `${(x * 100).toFixed(d)}%`);
const cents = (x: number | null | undefined) => (x == null ? "—" : `${Math.round(x * 100)}¢`);
const signedC = (x: number | null | undefined, d = 1) => (x == null ? "—" : `${x >= 0 ? "+" : "−"}${Math.abs(x * 100).toFixed(d)}¢`);
const clock = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit" }) : "—";

/** Signal board poll (30s — Kalshi rate-limits shared IPs). Models come from a ref so the loop never restarts. */
function useSignalHall(models: React.MutableRefObject<Record<string, ModelInput>>): [HallFeedState, SignalHallFeed | null] {
  const feed = useRef<SignalHallFeed | null>(null);
  const [state, setState] = useState<HallFeedState>(EMPTY_FEED);
  useEffect(() => {
    const f = createSignalHallFeed({
      load: () => {
        const m = models.current;
        return getPredictionSignals({ data: Object.keys(m).length ? { models: m } : {} }) as Promise<SignalBoard>;
      },
      every: 30_000,
    });
    feed.current = f;
    const off = f.subscribe(setState);
    return () => {
      off();
      f.dispose();
      feed.current = null;
    };
  }, [models]);
  return [state, feed.current];
}

/* ── rings + record ─────────────────────────────────────────────────────── */

function Ring({ value, label, sub, color }: { value: number | null; label: string; sub: string; color: string }) {
  const r = 26;
  const c = 2 * Math.PI * r;
  const v = value == null ? 0 : Math.max(0, Math.min(1, value));
  return (
    <div className="flex items-center gap-2" title={sub}>
      <svg width="64" height="64" viewBox="0 0 64 64" aria-label={`${label} ${value == null ? TOO_FEW : pct(value, 0)}`}>
        <circle cx="32" cy="32" r={r} fill="none" stroke="rgba(107,114,128,0.45)" strokeWidth="6" />
        {value != null && (
          <circle cx="32" cy="32" r={r} fill="none" stroke={color} strokeWidth="6" strokeLinecap="round" strokeDasharray={`${c * v} ${c}`} transform="rotate(-90 32 32)" />
        )}
        <text x="32" y="36" textAnchor="middle" fontSize="12" fontWeight="800" fill={value == null ? "#94a3b8" : MEAD.white}>
          {value == null ? "n/a" : pct(value, 0)}
        </text>
      </svg>
      <div className="min-w-0 text-[11px] leading-tight">
        <div className="font-bold" style={{ color: MEAD.brass }}>
          {label}
        </div>
        <div style={MUTED}>{sub}</div>
      </div>
    </div>
  );
}

/**
 * Calibration ring (Accuracy should-fix):
 *   Prefer scorer Murphy REL — ring fill = 1 − REL (higher = better calibrated).
 *   Else derived calibration gap over buckets with read === "ok" only (never thin bins).
 */
function calibrationScore(score: PaperScore): { value: number | null; label: string; sub: string } {
  const need = `${TOO_FEW} (need ${score.minSample.overall})`;
  if (score.overall.read === "ok") {
    const rel = score.overall.murphy.reliability;
    return {
      value: Math.max(0, Math.min(1, 1 - rel)),
      label: "Calibration (1−Murphy REL)",
      sub: `Murphy REL ${rel} · Brier ${score.overall.brier} ±${score.overall.brierCi95} · lower REL is better`,
    };
  }
  // Derived fallback — only weight ok buckets (should-fix c). Still null until overall is ok.
  let n = 0;
  let gapSum = 0;
  for (const b of score.calibration) {
    if (b.read !== "ok" || b.gap == null || !b.n) continue;
    n += b.n;
    gapSum += b.n * Math.abs(b.gap);
  }
  const derived = n ? 1 - gapSum / n : null;
  // Suppress ring until overall sample is ok (same gate as before); label stays honest.
  return {
    value: null,
    label: "Calibration gap (derived)",
    sub: derived == null ? need : `ok-bucket gap ready · overall ${need}`,
  };
}

function Record({ tickets, title, compact = false }: { tickets: PaperTicket[]; title: string; compact?: boolean }) {
  const score = useMemo(() => scorePaper(tickets), [tickets]);
  const wf = useMemo(() => (compact ? null : walkForward(tickets)), [tickets, compact]);
  const o = score.overall;
  const ok = o.read === "ok" ? o : null;
  const cal = calibrationScore(score);
  const settledLabel = score.settled === 0 ? "unsettled" : `${score.settled} settled`;
  return (
    <div className="space-y-2">
      <div className={LABEL} style={MUTED}>
        {title} · {score.tickets} paper · {score.open} open · {settledLabel}
        {score.excludedPostOutcome ? ` · ${score.excludedPostOutcome} excluded (post-outcome)` : ""}
      </div>
      {score.settled === 0 && (
        <div className="text-[11px]" style={MUTED}>
          unsettled — no settlements yet
        </div>
      )}
      <div className="flex flex-wrap gap-4">
        <Ring value={ok ? ok.hitRate : null} label="Hit rate" sub={ok ? `${ok.n} scored · net ${signedC(ok.netPerContract)}/contract after fees` : `${TOO_FEW} (need ${score.minSample.overall})`} color="#22c55e" />
        <Ring value={cal.value} label={cal.label} sub={cal.sub} color={MEAD.brass} />
      </div>
      {!compact && (
        <>
          <div className="text-[11px]" style={MUTED}>
            {score.verdict}
          </div>
          {ok && (
            <div className="text-[11px]" style={MUTED}>
              Murphy: reliability {ok.murphy.reliability} − resolution {ok.murphy.resolution} + uncertainty {ok.murphy.uncertainty} = {ok.murphy.reconstructed} (residual {ok.murphy.residual}) · base rate {pct(ok.baseRate)}
            </div>
          )}
          <div className="grid grid-cols-5 gap-1 sm:grid-cols-10" aria-label="Calibration buckets">
            {score.calibration.map((b) => (
              <div key={b.lo} className="rounded p-1 text-center text-[10px]" style={{ background: "rgba(255,255,255,0.05)" }} title={b.read === "ok" ? `forecast ${pct(b.meanForecast)} · observed ${pct(b.observed)} · gap ${pct(b.gap)}` : `${TOO_FEW} (${b.n})`}>
                <div style={MUTED}>
                  {Math.round(b.lo * 100)}–{Math.round(b.hi * 100)}
                </div>
                <div className="font-bold">{b.read === "ok" ? pct(b.observed, 0) : `n ${b.n}`}</div>
              </div>
            ))}
          </div>
          {wf && (
            <div className="text-[11px]" style={MUTED}>
              Walk-forward:{" "}
              {wf.pooled.read === "ok"
                ? `${wf.pooled.n} tested · Brier raw ${wf.pooled.brierRaw} → recalibrated ${wf.pooled.brierRecalibrated} (Δ ${wf.pooled.delta})`
                : `${TOO_FEW} (${wf.pooled.n}/${wf.pooled.need})`}{" "}
              · {wf.method}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* ── desk panel ─────────────────────────────────────────────────────────── */

function Stat({ k, v, sub }: { k: string; v: string; sub?: string }) {
  return (
    <div className="rounded p-1.5" style={{ background: "rgba(0,0,0,0.25)" }}>
      <div className={LABEL} style={MUTED}>
        {k}
      </div>
      <div className="text-[13px] font-black">{v}</div>
      {sub && (
        <div className="text-[10px] leading-tight" style={MUTED}>
          {sub}
        </div>
      )}
    </div>
  );
}

function slotName(rank: number): string {
  return rank === 0 ? "JUMBOTRON" : rank <= 5 ? `RUNE BOARD ${rank}` : `#${rank + 1}`;
}

function DeskPanel({ s, rank, tickets, focus }: { s: MarketSignal; rank: number; tickets: PaperTicket[]; focus: boolean }) {
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const mine = useMemo(() => tickets.filter((t) => t.marketId === s.id), [tickets, s.id]);
  const paper = (side: Side) => {
    const t = paperTicketFromSignal(s, { side });
    if (!t) return setMsg({ ok: false, text: `No ${side.toUpperCase()} ask in this read — nothing to paper.` });
    const r = addPaper(t);
    setMsg(
      r.ok
        ? { ok: true, text: `Paper ${side.toUpperCase()} at ${cents(t.entryPrice)} (forecast ${pct(t.forecast)} · ${t.forecastSource}). No order was sent anywhere.` }
        : { ok: false, text: r.why },
    );
  };
  const e = s.edge;
  const mv = s.move;
  const hasYes = s.prices.yesAsk != null;
  const hasNo = s.prices.noAsk != null;
  return (
    <section id={`pm-${s.id}`} className={PANEL} style={{ ...PANEL_STYLE, boxShadow: focus ? `0 0 0 2px ${MEAD.brass}` : undefined }} data-testid="pm-desk-panel">
      <div className="mb-2 flex items-start gap-3">
        <div
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border-2 text-2xl font-black"
          style={{
            borderColor: s.grade != null ? GRADE_COLOR[s.grade] : "rgba(148,163,184,0.55)",
            color: s.grade != null ? GRADE_COLOR[s.grade] : "#94a3b8",
            fontSize: s.grade != null ? undefined : 11,
          }}
          title={s.grade != null ? `${gradeLabel(s.grade)} · setup score ${s.score}/100` : `${gradeLabel(s.grade)} — setup score ${s.score}/100${s.ungradedReason ? ` · ${s.ungradedReason}` : ""}`}
        >
          {s.grade != null ? s.grade : "—"}
        </div>
        <div className="min-w-0 flex-1">
          <div className={LABEL} style={{ color: MEAD.brass }}>
            {slotName(rank)} · {categoryLabel(signalToHallMarket(s))} · score {s.score}
            {s.nfl ? " · NFL" : ""}
          </div>
          <div className="truncate text-[15px] font-black">{s.outcome}</div>
          <div className="truncate text-[11px]" style={MUTED}>
            {eventLabel(signalToHallMarket(s))} · {s.id}
          </div>
        </div>
      </div>

      <ul className="mb-2 space-y-0.5 text-[11px]">
        {s.reasons.map((r, i) => (
          <li key={i} className="flex gap-1.5">
            <span className="w-8 shrink-0 text-right font-mono" style={{ color: r.effect === "up" ? "#86efac" : r.effect === "info" ? "#94a3b8" : "#fca5a5" }}>
              {r.effect === "cap" ? "cap" : r.effect === "info" ? "·" : `${r.points >= 0 ? "+" : ""}${r.points}`}
            </span>
            <span>{r.text}</span>
          </li>
        ))}
      </ul>

      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
        <Stat k="YES needs (after fees)" v={pct(s.implied.feeAdjustedYes)} sub={`mid ${pct(s.implied.mid)} · fee ${cents(s.implied.feeYes)} + slip ${cents(s.implied.slippage)}`} />
        <Stat k="NO needs (after fees)" v={pct(s.implied.feeAdjustedNo)} sub={s.implied.noTradeBand ? `no-trade band ${pct(s.implied.noTradeBand[0], 0)}–${pct(s.implied.noTradeBand[1], 0)}` : "no band (one side missing)"} />
        <Stat k="Spread" v={s.spread.cents == null ? "—" : `${s.spread.cents}¢`} sub={`${pct(s.spread.pctOfMid)} of mid · overround ${signedC(s.implied.overround)}`} />
        <Stat
          k="Liquidity"
          v={`${s.liquidity.word} · ${s.liquidity.score}`}
          sub={`size ${s.liquidity.bidSize ?? "—"}×${s.liquidity.askSize ?? "—"} · 24h vol ${s.liquidity.volume24h ?? "—"} · OI ${s.liquidity.openInterest ?? "—"}${s.liquidity.missing.length ? ` · missing ${s.liquidity.missing.join(", ")}` : ""}`}
        />
        <Stat
          k="Move since open"
          v={signedC(mv.sinceOpen)}
          sub={
            mv.basis === "none"
              ? mv.reason ?? "no real reference trade"
              : `from ${cents(mv.openPrice)} (${mv.basis === "candles_open" ? "first trade" : "prev-day last"}) · ${mv.velocityCentsPerHour == null ? "velocity —" : `${mv.velocityCentsPerHour >= 0 ? "+" : ""}${mv.velocityCentsPerHour.toFixed(1)}¢/h over ${mv.velocityWindowHours ?? "—"}h`} · ${mv.points} pts`
          }
        />
        <Stat k="Time to settle" v={s.settlement.words} sub={`${s.settlement.phase.replace("_", " ")} · closes ${durationWords(s.settlement.msToClose)}`} />
        <Stat
          k="Freshness"
          v={s.freshness.word}
          sub={`read ${clock(s.freshness.asOf)} · ${s.freshness.ageMs == null ? "age —" : `${Math.round(s.freshness.ageMs / 1000)}s old at read`} · ${s.freshness.priceBasis}${s.freshness.staleReason ? ` · ${s.freshness.staleReason}` : ""}`}
        />
        <Stat
          k="Edge read"
          v={e.status === "edge" ? `${signedC(e.netPerContract)} ${e.side.toUpperCase()}` : NO_EDGE_READ}
          sub={e.status === "edge" ? `model ${pct(e.modelProb)} · ${e.modelSource} · net of fees + slippage` : e.reason}
        />
        <Stat k="Book" v={`Y ${cents(s.prices.yesBid)}/${cents(s.prices.yesAsk)}`} sub={`N ${cents(s.prices.noBid)}/${cents(s.prices.noAsk)} · last ${cents(s.prices.last)}`} />
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <Ticket className="h-3.5 w-3.5" style={{ color: MEAD.brass }} />
        <span className={LABEL} style={{ color: MEAD.brass }}>
          Paper ticket
        </span>
        <button type="button" className={BTN} style={{ ...BTN_STYLE, borderColor: "#22c55e" }} disabled={!hasYes} onClick={() => paper("yes")}>
          YES {cents(s.prices.yesAsk)}
        </button>
        <button type="button" className={BTN} style={{ ...BTN_STYLE, borderColor: "#ef4444" }} disabled={!hasNo} onClick={() => paper("no")}>
          NO {cents(s.prices.noAsk)}
        </button>
        <span className="text-[10px]" style={MUTED}>
          graded side {s.gradedSide.toUpperCase()} · paper only
        </span>
      </div>
      {msg && <div className={`mt-1 text-[11px] ${msg.ok ? "text-green-300" : "text-red-300"}`}>{msg.text}</div>}
      <div className="mt-2 border-t pt-2" style={{ borderColor: "rgba(196,163,90,0.2)" }}>
        <Record tickets={mine} title="This market's paper record" compact />
      </div>
    </section>
  );
}

/* ── the analyzer ───────────────────────────────────────────────────────── */

export default function PmAnalyzer() {
  const host = useRef<HTMLDivElement | null>(null);
  const scene = useRef<MeadScene | null>(null);
  const models = useRef<Record<string, ModelInput>>({});
  const [modelCount, setModelCount] = useState(0);
  const [state, feed] = useSignalHall(models);
  const [ready, setReady] = useState(false);
  const [webglErr, setWebglErr] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);
  const [hover, setHover] = useState<string | null>(null);
  const [flash, setFlash] = useState<{ r: Reaction; line: string } | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [tickets, setTickets] = useState<PaperTicket[]>([]);
  useEffect(() => {
    setTickets(loadPaper());
    return subscribePaper(() => setTickets(loadPaper()));
  }, []);

  /** Hall YES/NO tap → jump to that market's desk panel (the ticket is placed from the panel). */
  const onTicket = useCallback((id: string, _side: TicketSide) => {
    setFocusId(id);
    window.setTimeout(() => document.getElementById(`pm-${id}`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 30);
  }, []);

  useEffect(() => {
    if (!host.current) return;
    try {
      scene.current = new MeadScene(host.current, {
        crowdDriven: true,
        onFocusChange: setFocused,
        onHover: setHover,
        onTicket,
        onReaction: (r, line) => setFlash({ r, line }),
      });
      setReady(true);
    } catch (e) {
      setWebglErr(e instanceof Error ? e.message : String(e));
    }
    return () => {
      scene.current?.dispose();
      scene.current = null;
    };
  }, [onTicket]);

  useEffect(() => {
    if (!scene.current || state.status === "idle") return;
    scene.current.setFeed(state.hall);
    if (state.layout && state.board && !state.held) scene.current.setCrowd(state.layout.crowd, state.board.asOf);
  }, [state, ready]);

  useEffect(() => {
    if (!flash) return;
    const id = window.setTimeout(() => setFlash(null), 1600);
    return () => window.clearTimeout(id);
  }, [flash]);

  const onScanRows = useCallback((rows: ScanRow[], asOf: string) => {
    const m = modelInputsFromScanRows(rows, asOf);
    for (const k of Object.keys(m)) m[k] = { ...m[k], source: m[k].source.slice(0, 120) };
    models.current = m;
    setModelCount(Object.keys(m).length);
  }, []);

  const b = state.board;
  const ordered = state.ordered;
  const shown = showAll ? ordered : ordered.slice(0, 6);
  const focusIdx = focusId ? ordered.findIndex((s) => s.id === focusId) : -1;
  const extra = !showAll && focusIdx >= 6 ? [ordered[focusIdx]] : [];

  return (
    <div className="space-y-3" data-testid="pm-analyzer">
      <div className="flex flex-wrap items-center gap-2">
        <Beer className="h-5 w-5" style={{ color: MEAD.brass }} />
        <h2 className="text-lg font-black tracking-wide" style={{ color: MEAD.brass }}>
          PREDICT · ANALYZER <span className="text-[var(--color-muted)]">— Mead Hall + desk</span>
        </h2>
        <span className="rounded-full border px-2 py-0.5 text-[10px] font-bold" style={{ borderColor: "var(--color-border)", color: "var(--color-muted)" }} title={state.hall.note}>
          {state.status === "live" ? `${state.held || b?.stale ? "STALE · " : ""}${b?.label ?? "Kalshi"}` : state.status.toUpperCase()}
        </span>
        <span className="rounded-full px-2 py-0.5 text-[10px] font-bold" style={{ background: "rgba(196,163,90,0.15)", color: MEAD.brass }}>
          PAPER ONLY
        </span>
        <span className="ml-auto text-[11px] text-[var(--color-muted)]">
          {b ? `${b.signals.length} markets · A${b.counts.A} B${b.counts.B} C${b.counts.C} D${b.counts.D} F${b.counts.F} · ${b.ungraded} ${NO_GRADE_LABEL} · ${b.noEdgeCount} no edge read · ${modelCount} model inputs` : "—"}
          {b?.candles ? ` · candles ${b.candles.read}/${b.candles.tried}` : ""} · {clock(b?.asOf)}
        </span>
        <button type="button" className={BTN} style={BTN_STYLE} onClick={() => feed?.refresh()} title="Re-read the signal board">
          <RefreshCw className="h-3 w-3" /> Refresh
        </button>
      </div>
      {(state.error || b?.reason) && <p className="text-[11px] text-[var(--color-warn)]">{state.error ?? b?.reason}</p>}

      <div
        className="relative overflow-hidden rounded-xl border-2"
        style={{ borderColor: focused ? MEAD.brass : "var(--color-border)", boxShadow: flash ? `inset 0 0 60px 10px ${REACT_COLOR[flash.r]}88` : undefined, transition: "box-shadow 300ms" }}
      >
        <div ref={host} className="h-[54vh] min-h-[380px] w-full" style={{ background: MEAD.pineInk }} data-testid="pm-hall-canvas" />
        {webglErr && <div className="absolute inset-0 flex items-center justify-center p-4 text-sm text-red-300">3D unavailable: {webglErr}. The desk panels below still work.</div>}
        <div className="pointer-events-none absolute left-2 top-2 flex flex-col gap-1">
          <span className="rounded bg-black/60 px-2 py-0.5 text-[11px] text-white">
            {focused ? "WASD walks Keaton · drag to look · wheel zooms · Esc releases" : "Jumbotron = #1 · Rune Board = next 5 · tap a market to open its desk panel"}
          </span>
          <span className="rounded bg-black/60 px-2 py-0.5 text-[11px]" style={{ color: MEAD.brass }}>
            {crowdLabel(state.layout?.crowd)}
          </span>
          {hover && <span className="rounded bg-black/70 px-2 py-0.5 text-[11px]" style={{ color: MEAD.brass }}>{hover}</span>}
        </div>
        {flash && (
          <div className="pointer-events-none absolute left-1/2 top-6 -translate-x-1/2 rounded-full px-4 py-1 text-xl font-black" style={{ background: REACT_COLOR[flash.r], color: flash.r === "hail" ? MEAD.pineInk : "#fff" }}>
            {flash.line}
          </div>
        )}
        {focused && (
          <button type="button" className="absolute right-2 top-2 rounded bg-black/60 px-2 py-0.5 text-[11px] text-white underline" onClick={() => scene.current?.releaseFocus()}>
            Release (Esc)
          </button>
        )}
        <div className="absolute bottom-2 right-2 flex flex-wrap gap-1">
          {(["overview", "jumbotron", "board", "bar"] as const).map((w) => (
            <button key={w} type="button" className={BTN} style={BTN_STYLE} onClick={() => scene.current?.look(w)}>
              <Camera className="h-3 w-3" /> {w === "board" ? "Rune Board" : w[0].toUpperCase() + w.slice(1)}
            </button>
          ))}
        </div>
      </div>

      <section className={PANEL} style={PANEL_STYLE}>
        <Record tickets={tickets} title="Paper record — all analyzer tickets" />
        <p className="mt-2 text-[10px]" style={MUTED}>
          Paper tickets stay unsettled until a real settled-market read is wired; until then rings read “{TOO_FEW}”. Measure before trusting.
        </p>
      </section>

      {state.status !== "live" && !ordered.length && (
        <div className="text-[12px] text-[var(--color-muted)]">{state.status === "loading" || state.status === "idle" ? "Reading the signal board…" : state.hall.note || "No priced markets right now."}</div>
      )}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {[...shown, ...extra].map((s) => (
          <DeskPanel key={s.id} s={s} rank={ordered.indexOf(s)} tickets={tickets} focus={s.id === focusId} />
        ))}
      </div>
      {ordered.length > 6 && (
        <button type="button" className={BTN} style={BTN_STYLE} onClick={() => setShowAll((v) => !v)}>
          {showAll ? "Show hall markets only (6)" : `Show every market (${ordered.length})`}
        </button>
      )}

      <details className="rounded-lg border border-[var(--color-border)] p-3">
        <summary className="cursor-pointer text-[11px] font-semibold uppercase tracking-wide text-[var(--color-muted)]">
          Sports scanner + GO ledger — the model inputs behind “edge” ({modelCount})
        </summary>
        <p className="mt-1 text-[10px] text-[var(--color-muted)]">
          Its conservative reference (DraftKings no-vig / ESPN live) is sent to the signal engine as the model input per ticker. Without one, a market reads “{NO_EDGE_READ}” and shows {NO_GRADE_LABEL} (no letter).
        </p>
        <div className="mt-2">
          <PredictTab embedded onScanRows={onScanRows} />
        </div>
      </details>
    </div>
  );
}
