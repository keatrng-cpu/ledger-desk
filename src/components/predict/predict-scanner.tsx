/**
 * The Predict scanner as setup squares — the four setups closest to GO,
 * always shown, the way the desk shows a trade that is almost ready: the
 * word (GO flashes green, LIMIT holds amber, SETUP x/8 otherwise), a bar per
 * must-layer, what it still needs and how far away it is, the entry range,
 * the target range and the reason. The rest fold underneath.
 */

import { useState } from "react";
import { readiness, topSetups, type ScanRow, type ScanStats } from "@/lib/predict/scanner";
import type { GoStats } from "@/lib/predict/go-ledger";
import type { JournalRead } from "@/lib/predict/journal";
import { BTN, CARD, H3, type LogSeed } from "./predict-parts";

const c = (x: number | null | undefined) => (x == null ? "—" : `${Math.round(x * 100)}¢`);
const pc = (x: number | null | undefined) => (x == null ? "—" : `${(x * 100).toFixed(1)}%`);
const sc = (x: number | null | undefined) => (x == null ? "—" : `${x >= 0 ? "+" : "−"}${Math.abs(x * 100).toFixed(1)}¢`);

const LAYER_NAME: Record<string, string> = {
  reference: "fair value",
  price: "price",
  longshot: "not a longshot",
  late: "not late-game dog",
  liquidity: "spread + depth",
  second: "second market",
  qb: "QB settled",
  held: "gap held",
};

function Light({ word }: { word: ScanRow["word"] }) {
  if (word === "GO") {
    return (
      <span className="relative flex h-3 w-3 shrink-0" aria-hidden>
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--color-up)] opacity-75" />
        <span className="relative inline-flex h-3 w-3 rounded-full bg-[var(--color-up)]" />
      </span>
    );
  }
  return <span className={`inline-flex h-3 w-3 shrink-0 rounded-full ${word === "LIMIT" ? "bg-[var(--color-warn)]" : "bg-[var(--color-muted)]"}`} aria-hidden />;
}

function seedOf(r: ScanRow): LogSeed {
  return { league: r.league, game: r.game, ticker: r.key, team: r.team, entry: r.ask ?? 0, reference: r.fairLo, referenceName: r.refName };
}

function SetupSquare({ r, onLog }: { r: ScanRow; onLog: (s: LogSeed) => void }) {
  const x = readiness(r);
  const go = r.word === "GO";
  const lim = r.word === "LIMIT";
  const failing = r.layers.filter((l) => !l.ok);
  const priceFails = failing.some((l) => l.id === "price");
  const label = go ? (r.phase === "in" ? "LIVE GO" : "GO") : lim ? "LIMIT" : `SETUP ${x.passed}/${x.total}`;
  const tone = go
    ? "border-[var(--color-up)] bg-[color-mix(in_oklab,var(--color-up)_12%,transparent)]"
    : lim
      ? "border-[color-mix(in_oklab,var(--color-warn)_60%,transparent)]"
      : x.hard
        ? "border-[var(--color-border)] opacity-80"
        : "border-[color-mix(in_oklab,var(--color-warn)_35%,transparent)]";
  const needs = go
    ? "Every layer passes."
    : priceFails && x.priceAway != null && r.limit != null
      ? `ask ≤ ${c(r.limit)} — now ${c(r.ask)}, ${(x.priceAway * 100).toFixed(0)}¢ away${failing.length > 1 ? ` · also: ${failing.filter((l) => l.id !== "price").map((l) => LAYER_NAME[l.id]).join(", ")}` : ""}`
      : (r.missing ?? "");
  return (
    <div className={`flex min-w-0 flex-col gap-1 rounded-md border p-2 text-[11px] leading-snug tabular-nums ${tone}`}>
      <div className="flex items-center gap-1.5">
        <Light word={r.word} />
        <span className={`font-bold ${go ? "text-[var(--color-up)]" : lim ? "text-[var(--color-warn)]" : "text-[var(--color-fg)]"}`}>{label}</span>
        <span className="text-xs font-semibold">{r.team}</span>
        <span className={`ml-auto font-semibold ${(r.gap ?? -1) > 0 ? "text-[var(--color-up)]" : "text-[var(--color-muted)]"}`}>{sc(r.gap)}</span>
      </div>
      <div className="text-[10px] text-[var(--color-muted)]">
        {r.game} · {r.phase === "in" ? `LIVE ${r.clock}` : r.clock}
      </div>
      {r.consensus != null && (
        <div>
          <span className="text-[var(--color-muted)]">Win chance </span>
          <span className="font-semibold">{pc(r.consensus)}</span>
          {r.agreement != null && (
            <span className={r.agreement >= 0.05 ? "text-[var(--color-warn)]" : "text-[var(--color-muted)]"}>
              {" "}
              · estimates {r.agreement >= 0.05 ? "disagree by" : "within"} {(r.agreement * 100).toFixed(1)} pts
            </span>
          )}
        </div>
      )}
      <div className="flex gap-0.5" aria-label={`${x.passed} of ${x.total} layers pass`}>
        {r.layers.map((l) => (
          <span
            key={l.id}
            title={`${LAYER_NAME[l.id]}: ${l.ok ? "pass" : l.detail}`}
            className={`h-1.5 flex-1 rounded-sm ${l.ok ? "bg-[var(--color-up)]" : "bg-[var(--color-down)]"}`}
          />
        ))}
      </div>
      <div>
        <span className="text-[var(--color-muted)]">Needs </span>
        <span className={go ? "text-[var(--color-up)]" : ""}>{needs}</span>
      </div>
      <div>
        <span className="text-[var(--color-muted)]">Entry </span>
        {r.limit == null ? (
          "no price near the market clears fees"
        ) : go ? (
          <>
            buy <span className="font-semibold">≤ {c(r.limit)}</span> (ask {c(r.ask)} · bid {c(r.bid)})
          </>
        ) : lim ? (
          <>
            rest a limit <span className="font-semibold">{c(r.bid)}–{c(r.limit)}</span>
          </>
        ) : (
          <>
            <span className="font-semibold">≤ {c(r.limit)}</span> if it comes (ask {c(r.ask)} · bid {c(r.bid)})
          </>
        )}
      </div>
      <div>
        <span className="text-[var(--color-muted)]">Target </span>
        {r.target ? (
          <>
            sell <span className="font-semibold">≥ {c(r.target[0])}{r.target[1] > r.target[0] ? `–${c(r.target[1])}` : ""}</span> or hold
          </>
        ) : (
          "hold to settlement"
        )}
        {r.winPays != null && <span className="text-[var(--color-muted)]"> · win pays {c(r.winPays)}</span>}
      </div>
      <div className="line-clamp-3 text-[10px] text-[var(--color-muted)]" title={r.analysis}>
        {r.analysis}
      </div>
      <div className="mt-auto flex items-center gap-2 pt-1">
        <button type="button" className={BTN} onClick={() => onLog(seedOf(r))} disabled={r.ask == null}>
          Log fill
        </button>
        {!go && <span className="text-[10px] text-[var(--color-muted)]">not ready — {x.hard ? "blocked" : "watch it"}</span>}
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
  const [showRest, setShowRest] = useState(false);
  const top = topSetups(rows, 4);
  const shown = new Set(top.map((r) => r.key));
  const moreReady = rows.filter((r) => r.word !== "STAND" && !shown.has(r.key));
  const rest = rows.filter((r) => r.word === "STAND" && !shown.has(r.key));
  return (
    <section className={CARD}>
      <h3 className={H3}>
        Top setups · {stats.go ? `${stats.go} GO` : "no GO yet — the 4 closest, and what each still needs"}
      </h3>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {[...top, ...moreReady].map((r) => (
          <SetupSquare key={r.key} r={r} onLog={onLog} />
        ))}
      </div>
      {!top.length && <p className="text-[11px] text-[var(--color-muted)]">No priced sides on the board.</p>}
      <p className="mt-1 text-[10px] text-[var(--color-muted)]">
        Bars, left to right: fair value · price · not a longshot · not a late-game dog · spread + depth · second market · QB settled · gap held. Green = pass.
        GO needs all eight; only GO is a trade.
      </p>
      {rest.length > 0 && (
        <>
          <button type="button" className={`mt-2 ${BTN}`} onClick={() => setShowRest(!showRest)}>
            {showRest ? "Hide" : "Show"} {rest.length} more
          </button>
          {showRest && (
            <ul className="mt-1 space-y-0.5 text-[10px] tabular-nums">
              {rest.map((r) => (
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
