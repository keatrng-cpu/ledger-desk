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

import { useCallback, useEffect, useMemo, useState } from "react";
import { Percent, RefreshCw } from "lucide-react";
import { getPredictBoard, type PredictBoard } from "@/lib/predict/predict-server";
import { LEAGUES, type League } from "@/lib/predict/board";
import { DEFAULT_FEES } from "@/lib/predict/math";
import { subscribePredict } from "@/lib/predict/journal";
import { BTN, CARD, GameCard, H3, JournalCard, RoundTripCalc, type LogSeed } from "./predict-parts";
import { PREDICT_EVIDENCE } from "@/lib/predict/evidence";

const REFRESH_MS = 20_000;

export function PredictTab() {
  const [league, setLeague] = useState<League>("nfl");
  const [board, setBoard] = useState<PredictBoard | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [auto, setAuto] = useState(true);
  const [seed, setSeed] = useState<LogSeed | null>(null);
  const [version, setVersion] = useState(0);
  const [view, setView] = useState<"live" | "all">("all");
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
    }, REFRESH_MS);
    return () => clearInterval(id);
  }, [auto, league, load]);

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
      gaps: gs.flatMap((b) => [b.away, b.home]).filter((s) => (s.edge ?? -1) > 0.005).length,
    };
  }, [board]);

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
            <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} /> auto 20s
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
        <p className="mt-1 text-[10px] text-[var(--color-muted)]">
          Fees modelled: {DEFAULT_FEES.source} (checked {DEFAULT_FEES.checkedAt}). Not financial advice; the tab compares prices, it does not pick winners.
        </p>
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
      {err && <p className="text-[11px] text-[var(--color-warn)]">Board unavailable — {err}</p>}
      {board?.failed.length ? <p className="text-[11px] text-[var(--color-warn)]">Did not load: {board.failed.join(" · ")}</p> : null}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {games.map((b) => (
          <GameCard key={b.game.id} b={b} onLog={setSeed} />
        ))}
        {board && games.length === 0 && <p className="text-[11px] text-[var(--color-muted)]">{view === "live" ? "No game in progress." : "No games on the board."}</p>}
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <RoundTripCalc />
        <JournalCard seed={seed} clearSeed={() => setSeed(null)} marks={marks} version={version} />
      </div>

      {board && <p className="text-[10px] leading-relaxed text-[var(--color-muted)]">{board.note}</p>}
    </div>
  );
}
