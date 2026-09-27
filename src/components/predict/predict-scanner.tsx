/**
 * The Predict scanner card list — GO rows flash green, LIMIT rows hold amber,
 * STAND rows fold away with the one missing layer. Built for a phone: one
 * column, the word first, then the entry, the target, the reason.
 */

import { useState } from "react";
import type { ScanRow, ScanStats } from "@/lib/predict/scanner";
import type { GoStats } from "@/lib/predict/go-ledger";
import type { JournalRead } from "@/lib/predict/journal";
import { BTN, CARD, H3, type LogSeed } from "./predict-parts";

const c = (x: number | null | undefined) => (x == null ? "—" : `${Math.round(x * 100)}¢`);
const sc = (x: number | null | undefined) => (x == null ? "—" : `${x >= 0 ? "+" : "−"}${Math.abs(x * 100).toFixed(1)}¢`);

function Light({ word }: { word: ScanRow["word"] }) {
  if (word === "GO") {
    return (
      <span className="relative flex h-3 w-3 shrink-0" aria-hidden>
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--color-up)] opacity-75" />
        <span className="relative inline-flex h-3 w-3 rounded-full bg-[var(--color-up)]" />
      </span>
    );
  }
  return <span className={`inline-flex h-3 w-3 shrink-0 rounded-full ${word === "LIMIT" ? "bg-[var(--color-warn)]" : "bg-[var(--color-border)]"}`} aria-hidden />;
}

function seedOf(r: ScanRow): LogSeed {
  return { league: r.league, game: r.game, ticker: r.key, team: r.team, entry: r.ask ?? 0, reference: r.fairLo, referenceName: r.refName };
}

function ScanCard({ r, onLog }: { r: ScanRow; onLog: (s: LogSeed) => void }) {
  const go = r.word === "GO";
  return (
    <div
      className={`rounded-md border p-2 text-[11px] leading-snug tabular-nums ${
        go
          ? "border-[var(--color-up)] bg-[color-mix(in_oklab,var(--color-up)_12%,transparent)]"
          : "border-[color-mix(in_oklab,var(--color-warn)_55%,transparent)]"
      }`}
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
        <Light word={r.word} />
        <span className={`font-bold ${go ? "text-[var(--color-up)]" : "text-[var(--color-warn)]"}`}>{go ? (r.phase === "in" ? "LIVE GO" : "GO") : "LIMIT"}</span>
        <span className="text-xs font-semibold">{r.team}</span>
        <span className="text-[var(--color-muted)]">
          {r.game} · {r.clock}
        </span>
        <span className="ml-auto font-semibold">{sc(r.gap)}/contract</span>
      </div>
      <div className="mt-1">
        <span className="text-[var(--color-muted)]">Entry </span>
        {go ? (
          <>
            buy at <span className="font-semibold">≤ {c(r.limit)}</span> (ask {c(r.ask)} · bid {c(r.bid)})
          </>
        ) : (
          <>
            rest a limit at <span className="font-semibold">{c(r.bid)}–{c(r.limit)}</span> (ask {c(r.ask)} is too high)
          </>
        )}
      </div>
      <div>
        <span className="text-[var(--color-muted)]">Target </span>
        {r.target ? (
          <>
            sell at <span className="font-semibold">≥ {c(r.target[0])}{r.target[1] > r.target[0] ? `–${c(r.target[1])}` : ""}</span> (fair after the exit fee), or hold
          </>
        ) : (
          "hold to settlement"
        )}
        {r.winPays != null && <span className="text-[var(--color-muted)]"> · a win pays {c(r.winPays)}/contract</span>}
      </div>
      <div className="mt-0.5 text-[10px] text-[var(--color-muted)]">{r.analysis}</div>
      <div className="mt-1 flex items-center gap-2">
        <button type="button" className={BTN} onClick={() => onLog(seedOf(r))} disabled={r.ask == null}>
          Log fill
        </button>
        <span className="text-[10px] text-[var(--color-muted)]">Check Robinhood's price is ≤ {c(r.limit)} before buying — its quote can sit a cent or two off Kalshi's.</span>
      </div>
    </div>
  );
}

export function StatsStrip({ stats, goStats, journal, fetchedAt }: { stats: ScanStats; goStats: GoStats; journal: JournalRead; fetchedAt: string | null }) {
  const chip = "rounded border border-[var(--color-border)] px-2 py-0.5";
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-[10px] tabular-nums text-[var(--color-muted)]">
      <span className={`${chip} ${stats.go ? "border-[var(--color-up)] text-[var(--color-up)]" : ""}`}>{stats.go} GO</span>
      <span className={chip}>{stats.limit} LIMIT</span>
      <span className={chip}>
        {stats.scanned} sides · {stats.live} live
      </span>
      {stats.marketVsBook != null && <span className={chip}>Kalshi sits {(stats.marketVsBook * 100).toFixed(1)}¢ from the book on average</span>}
      <span className={chip}>{goStats.line}</span>
      <span className={chip}>you: {journal.closed ? `${journal.closed} closed · net ${journal.net >= 0 ? "+" : "−"}$${Math.abs(journal.net).toFixed(2)}` : "no closed trades"}</span>
      {fetchedAt && (
        <span className={chip}>
          updated {new Date(fetchedAt).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit", second: "2-digit" })} ET
        </span>
      )}
    </div>
  );
}

export function ScannerList({ rows, stats, onLog }: { rows: ScanRow[]; stats: ScanStats; onLog: (s: LogSeed) => void }) {
  const [showStand, setShowStand] = useState(false);
  const act = rows.filter((r) => r.word !== "STAND");
  const stand = rows.filter((r) => r.word === "STAND");
  return (
    <section className={CARD}>
      <h3 className={H3}>Scanner · green = every layer passes</h3>
      <div className="space-y-2">
        {act.map((r) => (
          <ScanCard key={r.key} r={r} onLog={onLog} />
        ))}
        {!act.length && (
          <p className="text-[11px] text-[var(--color-muted)]">
            Nothing clears every layer right now — no light is the scanner working, not failing.
            {stats.closest && (
              <>
                {" "}
                Closest: <span className="text-[var(--color-fg)]">{stats.closest.team}</span> ({stats.closest.game}) {sc(stats.closest.gap)}/contract — {stats.closest.missing}.
              </>
            )}
          </p>
        )}
      </div>
      {stand.length > 0 && (
        <>
          <button type="button" className={`mt-2 ${BTN}`} onClick={() => setShowStand(!showStand)}>
            {showStand ? "Hide" : "Show"} {stand.length} STAND
          </button>
          {showStand && (
            <ul className="mt-1 space-y-0.5 text-[10px] tabular-nums">
              {stand.map((r) => (
                <li key={r.key} className="flex flex-wrap gap-x-1.5 border-t border-[var(--color-border)] pt-0.5">
                  <span className="font-semibold">{r.team}</span>
                  <span className="text-[var(--color-muted)]">
                    {r.game} · {r.phase === "in" ? r.clock : "pre"} · ask {c(r.ask)} · {sc(r.gap)} · needs ≤ {c(r.limit)}
                  </span>
                  <span className="text-[var(--color-warn)]">{r.missing}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
