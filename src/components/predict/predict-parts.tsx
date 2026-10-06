/**
 * Pieces of the Predict tab: a game card, the round-trip calculator, and the
 * journal. Quiet styling like the Invest tab — no flashing green on a "gap";
 * a gap is a comparison against an estimate, not a signal.
 */

import { useState } from "react";
import type { BoardGame, SideRead } from "@/lib/predict/board";
import { disagreement, gameLine, inactivesLine, lateUnderdog, qbFlag, sideEdge, threeWay, weatherFlag } from "@/lib/predict/board";
import { exitRuleShape, feePerContract, makerFee, roundTrip, sideFee, LONGSHOT_BELOW, VENUES, type FeeModel, type VenueId } from "@/lib/predict/math";
import { limitPriceFor } from "@/lib/predict/sizing";
import { closeTrade, deleteTrade, feesFor, loadTrades, logEntry, readJournal, tradePnl, type PredictTrade } from "@/lib/predict/journal";

export const CARD = "min-w-0 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-1)] p-3";
export const H3 = "mb-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-muted)]";
export const BTN =
  "rounded border border-[var(--color-border)] px-2 py-1 text-[11px] text-[var(--color-fg)] hover:border-[var(--color-accent)] focus:outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-accent)] disabled:opacity-40";
export const INPUT =
  "rounded border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2 py-1 text-xs text-[var(--color-fg)] focus:outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-accent)]";

const c = (p: number | null | undefined) => (p == null ? "—" : `${Math.round(p * 100)}¢`);
const pc = (p: number | null | undefined) => (p == null ? "—" : `${(p * 100).toFixed(1)}%`);
const cents = (d: number | null | undefined) => (d == null ? "—" : `${d >= 0 ? "+" : "−"}${Math.abs(d * 100).toFixed(1)}¢`);
const vol = (v: number | null) => (v == null ? "—" : v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `${Math.round(v / 1e3)}K` : String(Math.round(v)));

export interface LogSeed {
  league: string;
  game: string;
  ticker: string;
  team: string;
  entry: number;
  reference: number | null;
  referenceName: string | null;
}

function SideRow({
  s,
  onLog,
  gameName,
  league,
  trail,
  fees,
  late,
  flags,
}: {
  s: SideRead;
  onLog: (seed: LogSeed) => void;
  gameName: string;
  league: string;
  trail?: number[];
  fees: FeeModel;
  late: boolean;
  flags: (string | null)[];
}) {
  const k = s.side;
  const edge = sideEdge(s, fees);
  const ref = s.reference;
  // Resting a limit at the bid instead of paying the ask (maker fees where the venue has them).
  const atBid = k?.bid != null && ref != null && k.bid > 0 && k.bid < 1 ? ref - k.bid - makerFee(k.bid, 100, fees) / 100 : null;
  const limit = ref != null ? limitPriceFor(ref, 100, 1, fees) : null;
  const breakeven = k?.ask != null && k.ask > 0 && k.ask < 1 ? k.ask + feePerContract(k.ask, 100, fees) : null;
  const move = s.book != null && s.bookOpen != null ? s.book - s.bookOpen : null;
  return (
    <div className="grid grid-cols-[3.2rem_1fr_auto] items-center gap-x-2 border-t border-[var(--color-border)] py-1 text-[11px] tabular-nums first:border-t-0">
      <div>
        <div className="font-semibold">{s.team.code}</div>
        <div className="text-[9px] text-[var(--color-muted)]">{s.team.record ?? ""}</div>
      </div>
      <div className="min-w-0">
        <div>
          <span className="text-[var(--color-muted)]">bid </span>
          {c(k?.bid)} <span className="text-[var(--color-muted)]">ask </span>
          <span className="font-medium">{c(k?.ask)}</span>
          <span className="text-[var(--color-muted)]">
            {" "}
            · last {c(k?.last)} · vol {vol(k?.volume ?? null)}
            {k?.askSize != null ? ` · ${vol(k.askSize)} at the ask` : ""}
          </span>
        </div>
        <div className="text-[10px] text-[var(--color-muted)]">
          {threeWay(s)}
          {s.poly?.ask != null ? ` · Polymarket ${c(s.poly.bid)}/${c(s.poly.ask)}` : ""}
          {s.bookRange ? ` · book ${pc(s.bookRange[0])}–${pc(s.bookRange[1])} across 3 de-vig methods` : ""}
          {move != null && Math.abs(move) >= 0.005 ? ` · line ${move > 0 ? "+" : "−"}${Math.abs(move * 100).toFixed(1)} pts since open` : ""}
        </div>
        {ref != null && k?.ask != null && (
          <div className="text-[10px] text-[var(--color-muted)]">
            break-even at the ask <span className="text-[var(--color-fg)]">{pc(breakeven)}</span>
            {atBid != null && <> · resting at the bid {cents(atBid)}</>}
            {" · "}
            {limit != null ? (
              <>
                limit to clear fees + 1¢: <span className="font-medium text-[var(--color-fg)]">≤ {c(limit)}</span>
              </>
            ) : (
              "no price clears fees + 1¢"
            )}
          </div>
        )}
        <div className="text-[10px] text-[var(--color-muted)]">
          {s.referenceName ? `vs ${s.referenceName} ${pc(s.reference)}` : "no reference"}
          {edge != null && (
            <span className={edge > 0.005 ? "text-[var(--color-fg)]" : ""}>
              {" "}
              · buy at ask vs it: <span className="font-medium">{cents(edge)}</span>/contract after {fees.label} fees
            </span>
          )}
          {late && <span className="text-[var(--color-warn)]"> · late-game underdog — historically overpriced in the final minutes</span>}
          {s.spread != null && s.spread >= 0.03 && <span className="text-[var(--color-warn)]"> · wide spread {c(s.spread)}</span>}
          {s.longshot && <span className="text-[var(--color-warn)]"> · longshot zone (&lt;{Math.round(LONGSHOT_BELOW * 100)}¢)</span>}
          {flags
            .filter(Boolean)
            .map((f) => (
              <span key={f} className="text-[var(--color-warn)]">
                {" "}
                · {f}
              </span>
            ))}
        </div>
        {trail && trail.length >= 2 && (
          <div className="text-[10px] text-[var(--color-muted)]">
            gap trail: {trail.slice(-6).map((x) => `${x >= 0 ? "+" : "−"}${Math.abs(x * 100).toFixed(1)}`).join(" → ")}¢
          </div>
        )}
      </div>
      <button
        type="button"
        className={BTN}
        disabled={!k?.ask}
        onClick={() =>
          k?.ask &&
          onLog({ league, game: gameName, ticker: k.ticker, team: s.team.code, entry: k.ask, reference: s.reference, referenceName: s.referenceName })
        }
      >
        Log
      </button>
    </div>
  );
}

export function GameCard({
  b,
  onLog,
  trails,
  fees,
}: {
  b: BoardGame;
  onLog: (seed: LogSeed) => void;
  trails?: Map<string, number[]>;
  fees: FeeModel;
}) {
  const g = b.game;
  const name = `${g.away.code} @ ${g.home.code}`;
  const live = g.state === "in";
  return (
    <section className={CARD}>
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-x-2">
        <p className="text-xs font-semibold">
          {name}
          {g.state !== "pre" && (
            <span className="tabular-nums">
              {" "}
              · {g.away.score ?? 0}–{g.home.score ?? 0}
            </span>
          )}
        </p>
        <p className={`text-[10px] ${live ? "text-[var(--color-warn)]" : "text-[var(--color-muted)]"}`}>
          {g.detail}
          {live && g.possession ? ` · ball ${g.possession}` : ""}
          {live && g.downDistance ? ` · ${g.downDistance}` : ""}
        </p>
      </div>
      <p className="mb-1 text-[10px] text-[var(--color-muted)]">
        {g.spreadLine ?? "no line"}
        {g.overUnder != null ? ` · O/U ${g.overUnder}` : ""}
        {b.overround != null ? ` · book margin ${(b.overround * 100).toFixed(1)}%` : ""}
        {g.weather ? ` · ${g.weather}` : ""}
        {inactivesLine(b) ? ` · ${inactivesLine(b)}` : ""}
      </p>
      {weatherFlag(b) && <p className="mb-1 text-[10px] text-[var(--color-warn)]">{weatherFlag(b)}</p>}
      <SideRow
        s={b.away}
        onLog={onLog}
        gameName={name}
        league={b.league}
        trail={b.away.side ? trails?.get(b.away.side.ticker) : undefined}
        fees={fees}
        late={lateUnderdog(b, b.away)}
        flags={[qbFlag(b, g.away.code), disagreement(b, b.away)]}
      />
      <SideRow
        s={b.home}
        onLog={onLog}
        gameName={name}
        league={b.league}
        trail={b.home.side ? trails?.get(b.home.side.ticker) : undefined}
        fees={fees}
        late={lateUnderdog(b, b.home)}
        flags={[qbFlag(b, g.home.code), disagreement(b, b.home)]}
      />
      {Object.values(b.injuries).some((x) => x.length) && (
        <p className="mt-1 text-[10px] leading-snug text-[var(--color-muted)]">
          <span className="text-[var(--color-fg)]">Injuries · </span>
          {[g.away.code, g.home.code]
            .filter((code) => b.injuries[code]?.length)
            .map((code) => `${code}: ${b.injuries[code].join(", ")}`)
            .join(" · ")}
        </p>
      )}
      <p className="mt-1 text-[10px] leading-snug text-[var(--color-muted)]">{gameLine(b, fees)}</p>
    </section>
  );
}

export function VenuePicker({ venue, setVenue }: { venue: VenueId; setVenue: (v: VenueId) => void }) {
  return (
    <label className="flex items-center gap-1 text-[11px] text-[var(--color-muted)]">
      fees as
      <select
        value={venue}
        onChange={(e) => setVenue(e.target.value as VenueId)}
        className="rounded border border-[var(--color-border)] bg-[var(--color-surface-2)] px-1 text-[11px] text-[var(--color-fg)]"
      >
        {(Object.keys(VENUES) as VenueId[]).map((v) => (
          <option key={v} value={v}>
            {VENUES[v].label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function RoundTripCalc({ fees }: { fees: FeeModel }) {
  const [entry, setEntry] = useState("25");
  const [target, setTarget] = useState("40");
  const [n, setN] = useState("100");
  const e = Number(entry) / 100;
  const t = Number(target) / 100;
  const k = Math.max(1, Math.round(Number(n) || 0));
  const valid = e > 0 && e < 1 && t > 0 && t < 1;
  const rt = valid ? roundTrip(e, t, k, fees) : null;
  const shape = valid && t > e ? exitRuleShape(e, t, fees, k) : null;
  return (
    <section className={CARD}>
      <h3 className={H3}>Round trip · buy, then sell before the final · {fees.label}</h3>
      <div className="mb-2 flex flex-wrap items-end gap-2 text-[11px] text-[var(--color-muted)]">
        <label>
          Buy at ¢
          <input value={entry} onChange={(x) => setEntry(x.target.value)} inputMode="numeric" className={`ml-1 w-14 ${INPUT}`} />
        </label>
        <label>
          Sell at ¢
          <input value={target} onChange={(x) => setTarget(x.target.value)} inputMode="numeric" className={`ml-1 w-14 ${INPUT}`} />
        </label>
        <label>
          Contracts
          <input value={n} onChange={(x) => setN(x.target.value)} inputMode="numeric" className={`ml-1 w-16 ${INPUT}`} />
        </label>
      </div>
      {rt ? (
        <div className="space-y-1 text-[11px] leading-relaxed">
          <p className="tabular-nums">
            Cost ${rt.cost.toFixed(2)} · proceeds ${rt.proceeds.toFixed(2)} · fees ${rt.fees.toFixed(2)} (both sides) ·{" "}
            <span className={rt.pnl >= 0 ? "text-[var(--color-up)]" : "text-[var(--color-down)]"}>
              net {rt.pnl >= 0 ? "+" : "−"}${Math.abs(rt.pnl).toFixed(2)}
            </span>
          </p>
          <p className="text-[var(--color-muted)]">
            Break-even exit after fees: <span className="text-[var(--color-fg)]">{Math.round(rt.breakevenExit * 100)}¢</span> — the price has to
            clear this, plus whatever the spread costs you when you sell into the bid.
          </p>
          {shape && (
            <p className="text-[var(--color-muted)]">
              If {Math.round(e * 100)}¢ was a fair price, it reaches {Math.round(t * 100)}¢ before the game ends about{" "}
              <span className="text-[var(--color-fg)]">{(shape.pHit * 100).toFixed(0)}%</span> of the time (at most — a touchdown can leap past
              it). You win ${shape.winIfHit.toFixed(2)} when it does and lose ${Math.abs(shape.lossIfMiss).toFixed(2)} when it doesn't:
              expected <span className="text-[var(--color-fg)]">{shape.ev >= 0 ? "+" : "−"}${Math.abs(shape.ev).toFixed(2)}</span> (
              {(shape.evPct * 100).toFixed(1)}% of the stake) before the spread — the fees. Selling into a rise does not create an edge;
              only a mispriced ENTRY does.
            </p>
          )}
        </div>
      ) : (
        <p className="text-[11px] text-[var(--color-muted)]">Prices in cents, 1–99.</p>
      )}
    </section>
  );
}

export function JournalCard({
  seed,
  clearSeed,
  marks,
  version,
  fees,
}: {
  seed: LogSeed | null;
  clearSeed: () => void;
  marks: Map<string, number | null>;
  version: number;
  fees: FeeModel;
}) {
  const [contracts, setContracts] = useState("10");
  const [price, setPrice] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [exitPx, setExitPx] = useState<Record<string, string>>({});
  void version;
  const j = readJournal();
  const px = price !== "" ? Number(price) / 100 : (seed?.entry ?? NaN);
  return (
    <section className={CARD}>
      <h3 className={H3}>Your record · event contracts</h3>
      {seed && (
        <div className="mb-2 flex flex-wrap items-end gap-2 rounded border border-[var(--color-border)] p-2 text-[11px]">
          <span>
            <span className="font-semibold">{seed.team}</span> <span className="text-[var(--color-muted)]">{seed.game}</span>
          </span>
          <label className="text-[var(--color-muted)]">
            Contracts
            <input value={contracts} onChange={(x) => setContracts(x.target.value)} inputMode="numeric" className={`ml-1 w-16 ${INPUT}`} />
          </label>
          <label className="text-[var(--color-muted)]">
            Filled at ¢
            <input value={price} onChange={(x) => setPrice(x.target.value)} placeholder={String(Math.round(seed.entry * 100))} inputMode="numeric" className={`ml-1 w-14 ${INPUT}`} />
          </label>
          <button
            type="button"
            className={BTN}
            onClick={() => {
              const r = logEntry({
                league: seed.league,
                game: seed.game,
                ticker: seed.ticker,
                team: seed.team,
                contracts: Math.round(Number(contracts)),
                entry: px,
                referenceAtEntry: seed.reference,
                referenceName: seed.referenceName,
                venue: fees.id,
              });
              setMsg(
                r.ok
                  ? `Logged ${contracts} ${seed.team} at ${Math.round(px * 100)}¢ (${fees.label}). Fees on the way in: $${sideFee(px, Number(contracts), fees).toFixed(2)}.`
                  : r.why,
              );
              if (r.ok) {
                clearSeed();
                setPrice("");
              }
            }}
          >
            Record the fill
          </button>
          <button type="button" className={BTN} onClick={clearSeed}>
            Cancel
          </button>
          <span className="w-full text-[10px] text-[var(--color-muted)]">
            Record what Robinhood actually filled — not the board's ask — so the record is true.
          </span>
        </div>
      )}
      {msg && <p className="mb-1 text-[11px] text-[var(--color-muted)]">{msg}</p>}
      {j.open.length > 0 && (
        <ul className="mb-2 space-y-1">
          {j.open.map((t: PredictTrade) => {
            const mark = marks.get(t.ticker) ?? null;
            const tf = feesFor(t);
            const unreal =
              mark != null
                ? Math.round((mark * t.contracts - sideFee(mark, t.contracts, tf) - t.entry * t.contracts - sideFee(t.entry, t.contracts, tf)) * 100) / 100
                : null;
            return (
              <li key={t.id} className="flex flex-wrap items-center gap-2 border-t border-[var(--color-border)] pt-1 text-[11px] tabular-nums first:border-t-0">
                <span className="font-semibold">{t.team}</span>
                <span className="text-[var(--color-muted)]">
                  {t.game} · {t.contracts} @ {c(t.entry)}
                  {mark != null ? ` · bid now ${c(mark)}` : ""}
                </span>
                {unreal != null && (
                  <span className={unreal >= 0 ? "text-[var(--color-up)]" : "text-[var(--color-down)]"}>
                    {unreal >= 0 ? "+" : "−"}${Math.abs(unreal).toFixed(2)} if sold now
                  </span>
                )}
                <input
                  value={exitPx[t.id] ?? ""}
                  onChange={(x) => setExitPx({ ...exitPx, [t.id]: x.target.value })}
                  placeholder="sold ¢"
                  inputMode="numeric"
                  className={`w-16 ${INPUT}`}
                />
                <button type="button" className={BTN} onClick={() => setMsg(closeTrade(t.id, { exit: Number(exitPx[t.id]) / 100 }).why)} disabled={!exitPx[t.id]}>
                  Sold
                </button>
                <button type="button" className={BTN} onClick={() => setMsg(closeTrade(t.id, { settled: 1 }).why)}>
                  Won
                </button>
                <button type="button" className={BTN} onClick={() => setMsg(closeTrade(t.id, { settled: 0 }).why)}>
                  Lost
                </button>
                <button type="button" className="text-[10px] text-[var(--color-muted)] underline" onClick={() => deleteTrade(t.id)}>
                  delete
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <p className="text-[11px] leading-relaxed text-[var(--color-muted)]">{j.line}</p>
      {j.closed === 0 && (
        <table className="mt-1 w-full text-[11px] tabular-nums" aria-label="Example row — what your record will look like">
          <thead className="text-[10px] uppercase text-[var(--color-muted)]">
            <tr className="text-left">
              <th className="py-1 font-medium">Entry price</th>
              <th className="text-right font-medium">Trades</th>
              <th className="text-right font-medium">Won</th>
              <th className="text-right font-medium">Net after fees</th>
              <th className="text-right font-medium">Return</th>
            </tr>
          </thead>
          <tbody>
            {/* ILLUSTRATIVE, NOT A TRADE: shows the shape of a row until the first close. */}
            <tr className="border-t border-dashed border-[var(--color-border)] italic text-[var(--color-subtle)] opacity-60">
              <td className="py-1">
                <span className="mr-1.5 rounded border border-[var(--color-border)] px-1 text-[9px] font-bold not-italic uppercase">Example</span>
                60–80¢
              </td>
              <td className="text-right">1</td>
              <td className="text-right">1</td>
              <td className="text-right">$2.60</td>
              <td className="text-right">37.1%</td>
            </tr>
          </tbody>
        </table>
      )}
      {j.closed > 0 && (
        <table className="mt-1 w-full text-[11px] tabular-nums">
          <thead className="text-[10px] uppercase text-[var(--color-muted)]">
            <tr className="text-left">
              <th className="py-1 font-medium">Entry price</th>
              <th className="text-right font-medium">Trades</th>
              <th className="text-right font-medium">Won</th>
              <th className="text-right font-medium">Net after fees</th>
              <th className="text-right font-medium">Return</th>
            </tr>
          </thead>
          <tbody>
            {j.buckets
              .filter((b) => b.n > 0)
              .map((b) => (
                <tr key={b.label} className="border-t border-[var(--color-border)]">
                  <td className="py-1">{b.label}</td>
                  <td className="text-right">{b.n}</td>
                  <td className="text-right">{b.wins}</td>
                  <td className={`text-right ${b.net < 0 ? "text-[var(--color-down)]" : ""}`}>${b.net.toFixed(2)}</td>
                  <td className="text-right">{b.staked > 0 ? `${((b.net / b.staked) * 100).toFixed(1)}%` : "—"}</td>
                </tr>
              ))}
          </tbody>
        </table>
      )}
      {j.closed > 0 && (
        <p className="mt-1 text-[10px] text-[var(--color-muted)]">
          Last closed:{" "}
          {loadRecent()
            .slice(0, 3)
            .map((t) => `${t.team} ${c(t.entry)}→${t.exit != null ? c(t.exit) : t.settled ? "won" : "lost"} (${(tradePnl(t) ?? 0) >= 0 ? "+" : "−"}$${Math.abs(tradePnl(t) ?? 0).toFixed(2)})`)
            .join(" · ")}
        </p>
      )}
    </section>
  );
}

function loadRecent(): PredictTrade[] {
  return loadTrades().filter((t) => t.exit != null || t.settled != null);
}
