/**
 * The Predict tab — a live scanner over event contracts (Robinhood/Kalshi).
 *
 * GO flashes green only when every must-layer in scanner.ts passes: the
 * contract costs less than the conservative reference after fees, with none
 * of the evidence's warning signs. It is a price comparison against an
 * estimate (the book without its margin before the game, ESPN's live model
 * during it) — never a call on who wins — and the GO ledger settles every GO
 * from the final score so the record can say whether the comparison pays.
 * Every number per game, the round-trip math and the evidence fold underneath.
 * Refreshes only while this tab is open and visible (10s default).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Beer, Percent, RefreshCw } from "lucide-react";
import { getPredictBoard, type PredictBoard } from "@/lib/predict/predict-server";
import { LEAGUES, type League } from "@/lib/predict/board";
import { VENUES, type VenueId } from "@/lib/predict/math";
import { readJournal, subscribePredict } from "@/lib/predict/journal";
import { scanBoard, scanStats, type ScanRow } from "@/lib/predict/scanner";
import { goStats, recordGo, resolveGo } from "@/lib/predict/go-ledger";
import { PREDICT_EVIDENCE } from "@/lib/predict/evidence";
import { BTN, CARD, GameCard, JournalCard, RoundTripCalc, VenuePicker, type LogSeed } from "./predict-parts";
import { ScannerList, StatsStrip } from "./predict-scanner";

const INTERVALS = [10_000, 20_000, 60_000] as const;
/** A contract that already alerted stays quiet this long, so a flickering quote cannot chatter. */
const REALERT_MS = 5 * 60_000;
const SUMMARY = "cursor-pointer text-[11px] font-semibold uppercase tracking-wide text-[var(--color-muted)]";

/** A short tone — created only after a click arms it (browser audio rule). */
function tone(ctx: AudioContext | null): void {
  if (!ctx) return;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.frequency.value = 880;
  g.gain.value = 0.07;
  o.connect(g);
  g.connect(ctx.destination);
  o.start();
  o.stop(ctx.currentTime + 0.25);
}

/** Phone-friendly GO notice: a buzz, and a system notification where the browser allows one. */
function notify(body: string): void {
  if (typeof window === "undefined") return;
  try {
    navigator.vibrate?.([200, 100, 200]);
  } catch {
    /* no vibration on this device */
  }
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  const direct = () => {
    try {
      const n = new Notification("Predict GO", { body });
      void n;
    } catch {
      /* Android Chrome only shows notifications through a service worker */
    }
  };
  const sw = navigator.serviceWorker;
  if (!sw?.getRegistration) return direct();
  void sw
    .getRegistration()
    .then((reg) => (reg ? reg.showNotification("Predict GO", { body }) : direct()))
    .catch(direct);
}

export function PredictTab() {
  const [league, setLeague] = useState<League>("nfl");
  const [board, setBoard] = useState<PredictBoard | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [auto, setAuto] = useState(true);
  const [every, setEvery] = useState<number>(10_000);
  const [seed, setSeed] = useState<LogSeed | null>(null);
  const [version, setVersion] = useState(0);
  const [venue, setVenue] = useState<VenueId>("rh-rothera");
  const fees = VENUES[venue];
  const [rows, setRows] = useState<ScanRow[]>([]);
  const [armed, setArmed] = useState(false);
  const [goMsg, setGoMsg] = useState<string | null>(null);
  const audio = useRef<AudioContext | null>(null);
  const alerted = useRef<Map<string, number>>(new Map());
  const lastStamp = useRef<string | null>(null);
  const prevGaps = useRef<Map<string, number>>(new Map());
  const lastGaps = useRef<Map<string, number>>(new Map());
  const trails = useRef<Map<string, number[]>>(new Map());
  useEffect(() => subscribePredict(() => setVersion((n) => n + 1)), []);

  const load = useCallback((lg: League) => {
    setLoading(true);
    setErr(null);
    void getPredictBoard({ data: { league: lg } })
      .then(setBoard)
      .catch((e: unknown) => setErr(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    lastStamp.current = null;
    prevGaps.current = new Map();
    lastGaps.current = new Map();
    load(league);
  }, [league, load]);
  useEffect(() => {
    if (!auto) return;
    const id = setInterval(() => {
      if (typeof document === "undefined" || document.visibilityState === "visible") load(league);
    }, every);
    return () => clearInterval(id);
  }, [auto, every, league, load]);

  // Scan each board once. The live "held" layer compares against the PREVIOUS
  // refresh's gaps, so they are rotated only when a new board arrives.
  useEffect(() => {
    if (!board) return;
    const isNew = board.fetchedAt !== lastStamp.current;
    if (isNew) {
      prevGaps.current = lastGaps.current;
      lastStamp.current = board.fetchedAt;
    }
    const r = scanBoard(board.games, fees, prevGaps.current);
    setRows(r);
    if (!isNew) return;
    const gaps = new Map<string, number>();
    for (const x of r) {
      if (x.gap == null) continue;
      gaps.set(x.key, x.gap);
      trails.current.set(x.key, [...(trails.current.get(x.key) ?? []), x.gap].slice(-12));
    }
    lastGaps.current = gaps;
    resolveGo(board.games);
    recordGo(r, fees);
    const now = Date.now();
    const fresh = r.filter((x) => x.word === "GO" && now - (alerted.current.get(x.key) ?? 0) > REALERT_MS);
    if (!fresh.length) return;
    for (const x of fresh) alerted.current.set(x.key, now);
    const body = fresh.map((x) => `${x.team} ≤ ${Math.round((x.limit ?? 0) * 100)}¢ (${x.game})`).join(" · ");
    setGoMsg(`GO ${new Date().toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" })} ET: ${body}`);
    if (armed) {
      tone(audio.current);
      notify(body);
    }
  }, [board, fees, armed]);

  const arm = (on: boolean) => {
    setArmed(on);
    if (!on || typeof window === "undefined") return;
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (Ctx && !audio.current) audio.current = new Ctx();
    void audio.current?.resume();
    tone(audio.current);
    try {
      if ("Notification" in window && Notification.permission === "default") void Notification.requestPermission();
    } catch {
      /* permission prompt unavailable */
    }
  };

  const games = useMemo(() => board?.games ?? [], [board]);
  const stats = useMemo(() => scanStats(rows, games), [rows, games]);
  void version;
  const gs = goStats();
  const journal = readJournal();
  const marks = useMemo(() => {
    const m = new Map<string, number | null>();
    for (const b of games) for (const s of [b.away, b.home]) if (s.side) m.set(s.side.ticker, s.side.bid);
    return m;
  }, [games]);

  return (
    <div className="space-y-3">
      <header className="flex flex-wrap items-center gap-2">
        <Percent size={15} className="text-[var(--color-muted)]" />
        <h2 className="text-sm font-semibold">Predict</h2>
        <span className="text-[11px] text-[var(--color-muted)]">live scanner · event contracts vs the book and the live model</span>
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          {(Object.keys(LEAGUES) as League[]).map((l) => (
            <button key={l} type="button" aria-pressed={league === l} onClick={() => setLeague(l)} className={`${BTN} ${league === l ? "border-[var(--color-accent)]" : ""}`}>
              {LEAGUES[l].label}
            </button>
          ))}
          <label className="flex items-center gap-1 text-[11px] text-[var(--color-muted)]">
            <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} /> live
            <select value={every} onChange={(e) => setEvery(Number(e.target.value))} className="rounded border border-[var(--color-border)] bg-[var(--color-surface-2)] px-1 text-[11px] text-[var(--color-fg)]">
              {INTERVALS.map((ms) => (
                <option key={ms} value={ms}>
                  {ms / 1000}s
                </option>
              ))}
            </select>
          </label>
          <button type="button" className={`flex items-center gap-1 ${BTN}`} onClick={() => load(league)} disabled={loading}>
            <RefreshCw size={11} /> {loading ? "…" : "Refresh"}
          </button>
          <button type="button" className={`flex items-center gap-1 ${BTN}`} onClick={() => window.dispatchEvent(new CustomEvent("ledger:open-tab", { detail: "mead" }))} title="The same markets as a 3D sports bar — paper tickets only">
            <Beer size={11} /> Open Mead Hall
          </button>
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-2 text-[11px] text-[var(--color-muted)]">
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={armed} onChange={(e) => arm(e.target.checked)} /> beep + buzz on GO
        </label>
        <VenuePicker venue={venue} setVenue={setVenue} />
        <span className="text-[10px]">Phone: keep this tab open with the screen on — browsers pause background tabs.</span>
      </div>
      {goMsg && <p className="text-[11px] font-semibold text-[var(--color-up)]">{goMsg}</p>}
      {err && <p className="text-[11px] text-[var(--color-warn)]">Board unavailable — {err}</p>}
      {board?.failed.length ? <p className="text-[11px] text-[var(--color-warn)]">Did not load: {board.failed.join(" · ")}</p> : null}

      <StatsStrip stats={stats} goStats={gs} journal={journal} fetchedAt={board?.fetchedAt ?? null} />
      <ScannerList rows={rows} stats={stats} onLog={setSeed} />
      <JournalCard seed={seed} clearSeed={() => setSeed(null)} marks={marks} version={version} fees={fees} />

      <details className={CARD}>
        <summary className={SUMMARY}>Every game — all the numbers ({games.length})</summary>
        <div className="mt-2 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {games.map((b) => (
            <GameCard key={b.game.id} b={b} onLog={setSeed} trails={trails.current} fees={fees} />
          ))}
        </div>
      </details>
      <details className={CARD}>
        <summary className={SUMMARY}>Round trip — what selling before the final costs</summary>
        <div className="mt-2">
          <RoundTripCalc fees={fees} />
        </div>
      </details>
      <details className={CARD}>
        <summary className={SUMMARY}>Evidence — read before the first trade</summary>
        <ul className="mt-2 space-y-1 text-[11px] leading-relaxed">
          {PREDICT_EVIDENCE.map((e) => (
            <li key={e.id}>
              <span className="font-medium text-[var(--color-fg)]">{e.headline} </span>
              <span className="text-[var(--color-muted)]">{e.detail} </span>
              {e.url && (
                <a href={e.url} target="_blank" rel="noopener noreferrer" className="text-[var(--color-accent)] underline underline-offset-2">
                  source
                </a>
              )}
            </li>
          ))}
        </ul>
        <p className="mt-1 text-[10px] text-[var(--color-muted)]">
          {fees.source} (checked {fees.checkedAt}). GO compares a price with an estimate after fees; it does not pick winners. Not financial advice.
        </p>
      </details>
      {board && <p className="text-[10px] leading-relaxed text-[var(--color-muted)]">{board.note}</p>}
    </div>
  );
}
