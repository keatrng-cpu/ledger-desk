/**
 * The Predict tab — Robinhood/Kalshi sports contracts, priced against
 * independent references, with the costs and the trader's own record.
 *
 * WHAT IT DOES
 *   - Every game in the league with its Kalshi bid/ask for both teams.
 *   - The reference: DraftKings' moneyline with the bookmaker margin removed
 *     before the game; ESPN's live win probability during it.
 *   - Per side, what buying at the ask is worth IF the reference is right,
 *     after Kalshi's fee and Robinhood's commission. Positive = the contract
 *     costs less than the reference says it is worth.
 *   - A round-trip calculator for "buy, then sell before the final", with the
 *     break-even exit and the martingale shape of any sell-into-a-rise rule.
 *   - The trader's own fills, cut by entry price.
 *
 * WHAT IT WILL NOT DO
 * Call a winner, flash a buy, or score an exit rule as if timing were an
 * edge. The references are estimates; the evidence card says what the
 * research found about prices like these. Refreshes every 20s only while the
 * tab is open and the switch is on.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Percent, RefreshCw } from "lucide-react";
import { getPredictBoard, type PredictBoard } from "@/lib/predict/predict-server";
import { LEAGUES, type League } from "@/lib/predict/board";
import { VENUES, type VenueId } from "@/lib/predict/math";
import { sideEdge } from "@/lib/predict/board";
import { subscribePredict } from "@/lib/predict/journal";
import { BTN, CARD, GameCard, H3, JournalCard, RoundTripCalc, VenuePicker, type LogSeed } from "./predict-parts";
import { PREDICT_EVIDENCE } from "@/lib/predict/evidence";

/** Choices, not a default poll: the board only refreshes while this tab is open. */
const INTERVALS = [10_000, 20_000, 60_000] as const;

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
  o.stop(ctx.currentTime + 0.2);
}

export function PredictTab() {
  const [league, setLeague] = useState<League>("nfl");
  const [board, setBoard] = useState<PredictBoard | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [auto, setAuto] = useState(true);
  const [seed, setSeed] = useState<LogSeed | null>(null);
  const [version, setVersion] = useState(0);
  const [view, setView] = useState<"live" | "all">("all");
  const [every, setEvery] = useState<number>(20_000);
  const [venue, setVenue] = useState<VenueId>("rh-rothera");
  const fees = VENUES[venue];
  // Gap alert: opt-in, live games only, fires once per side per crossing.
  const [alertOn, setAlertOn] = useState(false);
  const [alertCents, setAlertCents] = useState("3");
  const audio = useRef<AudioContext | null>(null);
  const fired = useRef<Set<string>>(new Set());
  const trails = useRef<Map<string, number[]>>(new Map());
  const lastStamp = useRef<string | null>(null);
  const [alertMsg, setAlertMsg] = useState<string | null>(null);
  useEffect(() => subscribePredict(() => setVersion((n) => n + 1)), []);

  const load = useCallback(
    (lg: League) => {
      setLoading(true);
      setErr(null);
      void getPredictBoard({ data: { league: lg } })
        .then(setBoard)
        .catch((e: unknown) => setErr(e instanceof Error ? e.message : String(e)))
        .finally(() => setLoading(false));
    },
    [],
  );
  useEffect(() => load(league), [league, load]);
  useEffect(() => {
    if (!auto) return;
    const id = setInterval(() => {
      if (typeof document === "undefined" || document.visibilityState === "visible") load(league);
    }, every);
    return () => clearInterval(id);
  }, [auto, every, league, load]);

  // Each new board: extend every side's gap trail, and sound the armed alert
  // when a LIVE side's gap after fees crosses the threshold. A side re-arms
  // only after its gap falls a cent below the line — no chattering.
  useEffect(() => {
    if (!board || board.fetchedAt === lastStamp.current) return;
    lastStamp.current = board.fetchedAt;
    const line = (Number(alertCents) || 0) / 100;
    const hits: string[] = [];
    for (const b of board.games) {
      for (const s of [b.away, b.home]) {
        const side = s.side;
        const e = sideEdge(s, fees);
        if (!side || e == null) continue;
        const arr = trails.current.get(side.ticker) ?? [];
        arr.push(e);
        trails.current.set(side.ticker, arr.slice(-12));
        if (b.game.state !== "in") continue;
        const key = side.ticker;
        const held = arr.length >= 2 && arr[arr.length - 2] >= line;
        if (e >= line && held && !fired.current.has(key)) {
          fired.current.add(key);
          hits.push(`${s.team.code} ${Math.round((side.ask ?? 0) * 100)}¢ vs ESPN ${((s.reference ?? 0) * 100).toFixed(0)}% (+${(e * 100).toFixed(1)}¢)`);
        } else if (e < line - 0.01) {
          fired.current.delete(key);
        }
      }
    }
    if (hits.length) {
      setAlertMsg(`Gap ≥ ${alertCents}¢ after fees, held two refreshes: ${hits.join(" · ")} — a comparison with ESPN's model, not a call.`);
      if (alertOn) tone(audio.current);
    }
  }, [board, alertCents, alertOn, fees]);

  const games = (board?.games ?? []).filter((b) => (view === "live" ? b.game.state === "in" : true));
  const marks = useMemo(() => {
    const m = new Map<string, number | null>();
    for (const b of board?.games ?? []) for (const s of [b.away, b.home]) if (s.side) m.set(s.side.ticker, s.side.bid);
    return m;
  }, [board]);
  const counts = useMemo(() => {
    const gs = board?.games ?? [];
    return {
      live: gs.filter((b) => b.game.state === "in").length,
      pre: gs.filter((b) => b.game.state === "pre").length,
      gaps: gs.flatMap((b) => [b.away, b.home]).filter((s) => (sideEdge(s, fees) ?? -1) > 0.005).length,
    };
  }, [board, fees]);

  return (
    <div className="space-y-3">
      <header className="flex flex-wrap items-center gap-2">
        <Percent size={15} className="text-[var(--color-muted)]" />
        <h2 className="text-sm font-semibold">Predict</h2>
        <span className="text-[11px] text-[var(--color-muted)]">event contracts · priced against the book and the live model</span>
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          {(Object.keys(LEAGUES) as League[]).map((l) => (
            <button key={l} type="button" aria-pressed={league === l} onClick={() => setLeague(l)} className={`${BTN} ${league === l ? "border-[var(--color-accent)]" : ""}`}>
              {LEAGUES[l].label}
            </button>
          ))}
          <label className="flex items-center gap-1 text-[11px] text-[var(--color-muted)]">
            <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} /> auto
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
        </div>
      </header>

      <section className={`${CARD} border-[color-mix(in_oklab,var(--color-warn)_40%,transparent)]`}>
        <h3 className={H3}>Read this before the first trade</h3>
        <ul className="space-y-1 text-[11px] leading-relaxed">
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
        <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] text-[var(--color-muted)]">
          <VenuePicker venue={venue} setVenue={setVenue} />
          <span>
            {fees.source} (checked {fees.checkedAt}). Not financial advice; the tab compares prices, it does not pick winners.
          </span>
        </div>
      </section>

      <div className="flex flex-wrap items-center gap-2 text-[11px] text-[var(--color-muted)]">
        {board && (
          <span>
            {counts.live} live · {counts.pre} upcoming · {counts.gaps} side{counts.gaps === 1 ? "" : "s"} priced below the reference after fees · updated{" "}
            {new Date(board.fetchedAt).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit", second: "2-digit" })} ET
          </span>
        )}
        <span className="ml-auto flex gap-1">
          <button type="button" aria-pressed={view === "all"} className={`${BTN} ${view === "all" ? "border-[var(--color-accent)]" : ""}`} onClick={() => setView("all")}>
            All games
          </button>
          <button type="button" aria-pressed={view === "live"} className={`${BTN} ${view === "live" ? "border-[var(--color-accent)]" : ""}`} onClick={() => setView("live")}>
            Live only
          </button>
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-[11px] text-[var(--color-muted)]">
        <label className="flex items-center gap-1">
          <input
            type="checkbox"
            checked={alertOn}
            onChange={(e) => {
              setAlertOn(e.target.checked);
              if (e.target.checked && typeof window !== "undefined") {
                const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
                if (Ctx && !audio.current) audio.current = new Ctx();
                void audio.current?.resume();
                tone(audio.current);
              }
            }}
          />
          beep when a live side's gap after fees reaches
        </label>
        <input value={alertCents} onChange={(e) => setAlertCents(e.target.value)} inputMode="decimal" className="w-10 rounded border border-[var(--color-border)] bg-[var(--color-surface-2)] px-1 text-[11px] text-[var(--color-fg)]" />
        <span>¢</span>
        {alertMsg && <span className="w-full text-[var(--color-fg)]">{alertMsg}</span>}
      </div>
      {err && <p className="text-[11px] text-[var(--color-warn)]">Board unavailable — {err}</p>}
      {board?.failed.length ? <p className="text-[11px] text-[var(--color-warn)]">Did not load: {board.failed.join(" · ")}</p> : null}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {games.map((b) => (
          <GameCard key={b.game.id} b={b} onLog={setSeed} trails={trails.current} fees={fees} />
        ))}
        {board && games.length === 0 && <p className="text-[11px] text-[var(--color-muted)]">{view === "live" ? "No game in progress." : "No games on the board."}</p>}
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <RoundTripCalc fees={fees} />
        <JournalCard seed={seed} clearSeed={() => setSeed(null)} marks={marks} version={version} fees={fees} />
      </div>

      {board && <p className="text-[10px] leading-relaxed text-[var(--color-muted)]">{board.note}</p>}
    </div>
  );
}
