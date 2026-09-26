/**
 * The Investments tab — years, on a desk built for minutes.
 *
 * Layout order is the argument, top to bottom:
 *   1. THE SWEEP. What this month actually sends to shares, priced through
 *      the waterfall, with every step shown. This is first because it is
 *      the only thing on the tab that moves money.
 *   2. THE RENT LINE. At the current run rate the data bill eats 88% of
 *      gross, so the highest-value action on this page is not an
 *      allocation — it is cancelling a subscription. The tab says so.
 *   3. THE BOOK. Three sleeves, drift, and a refusal to invent rebalancing
 *      work on a book too small for it to mean anything.
 *   4. THE RESEARCH. One card per name, verdict on the left, the caveat
 *      always visible — never a score.
 *
 * Nothing here reads the PATH board, the SMC word, the killzone or the
 * Judas window, and nothing here flashes. The other tabs are allowed to
 * shout; this one is deliberately quiet, because every mechanism that makes
 * a trader fast is a mechanism that makes an investor poor.
 */

import { useEffect, useMemo, useState } from "react";
import { Landmark, TriangleAlert, Ban, Info } from "lucide-react";
import {
  planSweep,
  rentVsSweep,
  DATA_RENT_MONTHLY_USD,
  SLEEVE_TARGET_USD,
  type SweepPlan,
} from "@/lib/invest/policy";
import { buildBook, rebalanceCheck, verdictFor, SLEEVE_TARGET } from "@/lib/invest/book";
import { ALL_DOSSIERS, RISK_FREE } from "@/lib/invest/dossiers";
import { canAdd, fundamentalsFor, snapshotCapturedAt, WASH_SALE_BANNED, type InvestVerdict, type Sleeve } from "@/lib/invest/universe";
import {
  addShares,
  loadPositions,
  loadSweeps,
  logSweep,
  closedMonths,
  subscribeInvest,
  totalSwept,
} from "@/lib/invest/store";
import { impliedGrowth, sensitivity, qualityRead, trendRead, BASE_RATES, HORIZON_EVIDENCE } from "@/lib/invest/factors";
import { evidenceSummary, evidenceFor } from "@/lib/invest/evidence";

const VERDICT_CLS: Record<InvestVerdict, string> = {
  CORE: "border-[color-mix(in_oklab,var(--color-up)_50%,transparent)] bg-[color-mix(in_oklab,var(--color-up)_12%,transparent)] text-[var(--color-up)]",
  ADD: "border-[color-mix(in_oklab,var(--color-up)_35%,transparent)] bg-[color-mix(in_oklab,var(--color-up)_8%,transparent)] text-[var(--color-up)]",
  HOLD: "border-[var(--color-border)] bg-[var(--color-surface-2)] text-[var(--color-muted)]",
  TRIM: "border-[color-mix(in_oklab,var(--color-warn)_50%,transparent)] bg-[color-mix(in_oklab,var(--color-warn)_12%,transparent)] text-[var(--color-warn)]",
  OUT: "border-[color-mix(in_oklab,var(--color-down)_50%,transparent)] bg-[color-mix(in_oklab,var(--color-down)_12%,transparent)] text-[var(--color-down)]",
};

const usd = (n: number) => `${n < 0 ? "-" : ""}$${Math.abs(n).toFixed(2)}`;
const pct = (n: number | null) => (n == null ? "—" : `${(n * 100).toFixed(1)}%`);

function Card({ title, children, tone }: { title: string; children: React.ReactNode; tone?: "warn" }) {
  return (
    <section
      className={`rounded-lg border p-3 ${
        tone === "warn"
          ? "border-[color-mix(in_oklab,var(--color-warn)_45%,transparent)] bg-[color-mix(in_oklab,var(--color-warn)_7%,transparent)]"
          : "border-[var(--color-border)] bg-[var(--color-surface-1)]"
      }`}
    >
      <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-muted)]">
        {title}
      </h3>
      {children}
    </section>
  );
}

/** The month that just closed, "YYYY-MM" in ET — the default for logging. */
function priorMonthKey(now = new Date()): string {
  const et = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
  et.setDate(1);
  et.setMonth(et.getMonth() - 1);
  return `${et.getFullYear()}-${String(et.getMonth() + 1).padStart(2, "0")}`;
}

export function InvestPanel() {
  // The store had writers (logSweep, addShares) that nothing called, so the
  // book was always empty and the sweep rate could never leave 20%. The
  // reads now follow the store's own event, and the two forms below write it.
  const [version, setVersion] = useState(0);
  useEffect(() => subscribeInvest(() => setVersion((n) => n + 1)), []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const positions = useMemo(() => loadPositions(), [version]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const sweeps = useMemo(() => loadSweeps(), [version]);
  const months = closedMonths();
  const swept = totalSwept();
  const [logMonth, setLogMonth] = useState(() => priorMonthKey());
  const [logMsg, setLogMsg] = useState<string | null>(null);
  const [buy, setBuy] = useState<{ ticker: string; sleeve: Sleeve; shares: string; cost: string }>({
    ticker: "",
    sleeve: "ballast",
    shares: "",
    cost: "",
  });
  const [buyMsg, setBuyMsg] = useState<string | null>(null);

  // The month is entered by hand, because it is a REALIZED, CLOSED number
  // that the desk cannot read from a broker it is not connected to.
  // Defaulting it to the live run rate would be inventing a fill.
  const [realized, setRealized] = useState<string>("");
  const [sleeve, setSleeve] = useState<string>(String(SLEEVE_TARGET_USD));
  const [monthClosed, setMonthClosed] = useState(false);

  const plan: SweepPlan = planSweep({
    realizedMonthUsd: Number(realized) || 0,
    monthClosed,
    sleeveEquityUsd: Number(sleeve) || 0,
    closedMonths: months,
  });
  const rent = rentVsSweep(plan);

  const book = useMemo(() => buildBook(positions, {}, Date.now()), [positions]);
  const reb = rebalanceCheck(book);

  return (
    <div className="space-y-3">
      <header className="flex items-center gap-2">
        <Landmark size={15} className="text-[var(--color-muted)]" />
        <h2 className="text-sm font-semibold">Investments</h2>
        <span className="text-[11px] text-[var(--color-muted)]">
          years · shares held · funded by a cut of realized options P&amp;L
        </span>
      </header>

      <p className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] p-2.5 text-[11px] leading-relaxed text-[var(--color-muted)]">
        This tab never reads the PATH word, the 0.65 floor, the killzone or the Judas window, and it
        never flashes. Futures is hours, the options sleeve is days, this is years — the only wire
        between them is the monthly sweep below, and it runs one way.
      </p>

      {/* 1 — THE SWEEP */}
      <Card title="This month's sweep">
        <div className="mb-3 grid grid-cols-3 gap-2">
          <label className="text-[11px] text-[var(--color-muted)]">
            Realized options P&amp;L
            <input
              value={realized}
              onChange={(e) => setRealized(e.target.value)}
              inputMode="decimal"
              placeholder="closed trades only"
              className="mt-1 w-full rounded border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2 py-1 text-xs text-[var(--color-fg)]"
            />
          </label>
          <label className="text-[11px] text-[var(--color-muted)]">
            Sleeve equity
            <input
              value={sleeve}
              onChange={(e) => setSleeve(e.target.value)}
              inputMode="decimal"
              className="mt-1 w-full rounded border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2 py-1 text-xs text-[var(--color-fg)]"
            />
          </label>
          <label className="flex items-end gap-1.5 pb-1 text-[11px] text-[var(--color-muted)]">
            <input
              type="checkbox"
              checked={monthClosed}
              onChange={(e) => setMonthClosed(e.target.checked)}
            />
            Month is closed
          </label>
        </div>

        <div className="mb-2 flex items-baseline gap-2">
          <span
            className={`rounded border px-2 py-0.5 text-xs font-semibold ${
              plan.verdict === "SWEEP"
                ? VERDICT_CLS.CORE
                : plan.verdict === "SHORT"
                  ? VERDICT_CLS.OUT
                  : VERDICT_CLS.HOLD
            }`}
          >
            {plan.verdict}
          </span>
          <span className="text-lg font-semibold tabular-nums">{usd(plan.sweepUsd)}</span>
          <span className="text-[11px] text-[var(--color-muted)]">
            to shares at the earned {Math.round(plan.rate * 100)}% ({months} closed month
            {months === 1 ? "" : "s"} logged)
          </span>
        </div>

        {plan.steps.length > 0 && (
          <ol className="mb-2 space-y-0.5">
            {plan.steps.map((s) => (
              <li key={s.label} className="flex justify-between gap-2 text-[11px] tabular-nums">
                <span className="text-[var(--color-muted)]">{s.label}</span>
                <span className="flex gap-3">
                  <span className={s.usd < 0 ? "text-[var(--color-down)]" : "text-[var(--color-fg)]"}>
                    {usd(s.usd)}
                  </span>
                  <span className="w-16 text-right text-[var(--color-muted)]">{s.note}</span>
                </span>
              </li>
            ))}
          </ol>
        )}
        <p className="text-[11px] leading-relaxed text-[var(--color-muted)]">{plan.note}</p>
        {/* Record the month — once, and only a CLOSED one. The rate ladder
            (20% → 30% after 20 months) reads this log and nothing else. */}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input
            value={logMonth}
            onChange={(e) => setLogMonth(e.target.value)}
            placeholder="YYYY-MM"
            className="w-24 rounded border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2 py-1 text-xs text-[var(--color-fg)]"
          />
          <button
            type="button"
            disabled={!monthClosed || !/^\d{4}-\d{2}$/.test(logMonth) || realized.trim() === ""}
            onClick={() => {
              const res = logSweep({
                month: logMonth,
                verdict: plan.verdict,
                realizedUsd: Number(realized) || 0,
                rentUsd: plan.rentCoveredUsd,
                restoreUsd: plan.restoreUsd,
                sweptUsd: plan.sweepUsd,
                rate: plan.rate,
                loggedAt: new Date().toISOString(),
                note: plan.note,
              });
              setLogMsg(res.logged ? `${logMonth} logged — ${usd(plan.sweepUsd)} to shares.` : res.why);
            }}
            className="rounded border border-[var(--color-border)] px-2 py-1 text-[11px] text-[var(--color-fg)] disabled:opacity-40"
          >
            Log this month
          </button>
          <span className="text-[10px] text-[var(--color-muted)]">
            {logMsg ?? "Tick “Month is closed” first. A month is priced once and never edited."}
          </span>
        </div>
      </Card>

      {/* 2 — THE RENT LINE */}
      {plan.rentAlarm && (
        <Card title="The bill is the story" tone="warn">
          <p className="flex gap-2 text-[11px] leading-relaxed">
            <TriangleAlert size={13} className="mt-0.5 shrink-0 text-[var(--color-warn)]" />
            <span>
              Databento is eating {Math.round(plan.rentDrag * 100)}% of gross. {rent.line}
            </span>
          </p>
        </Card>
      )}

      {/* 2b — WHAT THIS CAN AND CANNOT ANSWER */}
      <Card title="What this tab can and cannot predict">
        <div className="mb-2 space-y-1">
          {HORIZON_EVIDENCE.map((h) => (
            <p key={h.horizon} className="text-[11px] leading-relaxed">
              <span
                className={`mr-1.5 rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase ${
                  h.usable ? VERDICT_CLS.CORE : VERDICT_CLS.HOLD
                }`}
              >
                {h.horizon} · {h.window}
              </span>
              <span className="text-[var(--color-muted)]">{h.verdict}</span>
            </p>
          ))}
        </div>
        <div className="space-y-1 border-t border-[var(--color-border)] pt-2">
          {BASE_RATES.map((b) => (
            <p key={b.id} className="text-[11px] leading-relaxed text-[var(--color-muted)]">
              <a href={b.url} target="_blank" rel="noreferrer" className="underline">
                {b.source.split(",")[0]}
              </a>
              {" · "}
              {b.claim} <span className="text-[var(--color-warn)]">{b.soWhat}</span>
            </p>
          ))}
        </div>
        <p className="mt-2 border-t border-[var(--color-border)] pt-2 text-[11px] text-[var(--color-muted)]">
          {evidenceSummary().line}
        </p>
      </Card>

      {/* 3 — THE BOOK */}
      <Card title="The book">
        {/* Record a buy. Refuses the wash-sale list outright — the book may
            never hold what the options sleeve trades around. */}
        <div className="mb-2 flex flex-wrap items-end gap-2">
          <input
            value={buy.ticker}
            onChange={(e) => setBuy({ ...buy, ticker: e.target.value.toUpperCase().trim() })}
            placeholder="Ticker"
            className="w-20 rounded border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2 py-1 text-xs text-[var(--color-fg)]"
          />
          <select
            value={buy.sleeve}
            onChange={(e) => setBuy({ ...buy, sleeve: e.target.value as Sleeve })}
            className="rounded border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2 py-1 text-xs text-[var(--color-fg)]"
          >
            <option value="ballast">ballast</option>
            <option value="compounder">compounder</option>
            <option value="drypowder">dry powder</option>
          </select>
          <input
            value={buy.shares}
            onChange={(e) => setBuy({ ...buy, shares: e.target.value })}
            inputMode="decimal"
            placeholder="Shares"
            className="w-20 rounded border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2 py-1 text-xs text-[var(--color-fg)]"
          />
          <input
            value={buy.cost}
            onChange={(e) => setBuy({ ...buy, cost: e.target.value })}
            inputMode="decimal"
            placeholder="Total $ paid"
            className="w-24 rounded border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2 py-1 text-xs text-[var(--color-fg)]"
          />
          <button
            type="button"
            onClick={() => {
              const shares = Number(buy.shares);
              const cost = Number(buy.cost);
              if (!/^[A-Z.]{1,6}$/.test(buy.ticker)) return setBuyMsg("Ticker?");
              if (WASH_SALE_BANNED[buy.ticker]) {
                return setBuyMsg(`${buy.ticker} is BANNED here — ${WASH_SALE_BANNED[buy.ticker]} (IRC 1091 wash-sale entanglement with the options sleeve).`);
              }
              if (!(shares > 0) || !(cost > 0)) return setBuyMsg("Shares and the dollars actually paid, both > 0.");
              addShares({ ticker: buy.ticker, sleeve: buy.sleeve, shares, costUsd: cost, openedAt: new Date().toISOString() });
              setBuyMsg(`Recorded ${shares} ${buy.ticker} for ${usd(cost)}.`);
              setBuy({ ...buy, ticker: "", shares: "", cost: "" });
            }}
            className="rounded border border-[var(--color-border)] px-2 py-1 text-[11px] text-[var(--color-fg)]"
          >
            Record buy
          </button>
          {buyMsg && <span className="text-[10px] text-[var(--color-muted)]">{buyMsg}</span>}
        </div>
        <p className="mb-2 text-[10px] text-[var(--color-subtle)]">
          Positions are valued at COST — this tab has no live quotes for the book, and a guessed mark would be an
          invented number.
        </p>
        {book.positions.length === 0 ? (
          <p className="text-[11px] leading-relaxed text-[var(--color-muted)]">
            Nothing held yet. Total swept to date: {usd(swept)} across {sweeps.length} logged month
            {sweeps.length === 1 ? "" : "s"}. The first year of this book will look like a joke —
            that is the correct result, not a bug. The habit is the product.
          </p>
        ) : (
          <>
            <div className="mb-2 grid grid-cols-3 gap-2">
              {book.sleeves.map((s) => (
                <div key={s.sleeve} className="rounded border border-[var(--color-border)] p-1.5">
                  <div className="text-[10px] uppercase text-[var(--color-muted)]">{s.sleeve}</div>
                  <div className="text-xs tabular-nums">{usd(s.valueUsd)}</div>
                  <div className="text-[10px] tabular-nums text-[var(--color-muted)]">
                    {Math.round(s.weight * 100)}% / {Math.round(SLEEVE_TARGET[s.sleeve] * 100)}% target
                  </div>
                </div>
              ))}
            </div>
            <p className="text-[11px] text-[var(--color-muted)]">{book.note}</p>
            <p className="mt-1 text-[11px] text-[var(--color-muted)]">{reb.note}</p>
            {book.concentration.warn && (
              <p className="mt-1 flex gap-1.5 text-[11px] text-[var(--color-warn)]">
                <TriangleAlert size={12} className="mt-0.5 shrink-0" />
                {book.concentration.line}
              </p>
            )}
            {book.banned.map((b) => (
              <p key={b.ticker} className="mt-1 flex gap-1.5 text-[11px] text-[var(--color-down)]">
                <Ban size={12} className="mt-0.5 shrink-0" />
                {b.ticker} is wash-sale entangled with the options sleeve — {b.why}
              </p>
            ))}
          </>
        )}
      </Card>

      {/* 4 — THE RESEARCH */}
      <Card title={`Research · fundamentals captured ${snapshotCapturedAt()} · 10y ${RISK_FREE.yieldPct}%`}>
        <div className="space-y-1.5">
          {ALL_DOSSIERS.map((d) => {
            const held = book.positions.find((p) => p.ticker === d.ticker);
            const v = verdictFor(d, held?.weight ?? 0);
            const f = fundamentalsFor(d.ticker);
            const gate = canAdd(d);
            return (
              <details
                key={d.ticker}
                className="rounded border border-[var(--color-border)] bg-[var(--color-surface-2)] p-2"
              >
                <summary className="flex cursor-pointer items-center gap-2 text-xs">
                  <span className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold ${VERDICT_CLS[v.verdict]}`}>
                    {v.verdict}
                  </span>
                  <span className="font-medium">{d.ticker}</span>
                  <span className="truncate text-[11px] text-[var(--color-muted)]">{d.name}</span>
                  <span className="ml-auto shrink-0 text-[10px] uppercase text-[var(--color-muted)]">
                    {d.cycle} · cap {Math.round(d.maxWeight * 100)}%
                  </span>
                </summary>

                <div className="mt-2 space-y-1 text-[11px] leading-relaxed">
                  <p className="text-[var(--color-muted)]">{v.why}</p>
                  <p>
                    <span className="text-[var(--color-muted)]">Sells · </span>
                    {d.sells}
                  </p>
                  <p>
                    <span className="text-[var(--color-muted)]">Moat · </span>
                    {d.moat}
                  </p>
                  <p>
                    <span className="text-[var(--color-muted)]">2035 · </span>
                    {d.useIn2035}
                  </p>
                  {d.kind === "company" && (
                    <p>
                      <span className="text-[var(--color-muted)]">Who runs it · </span>
                      {d.governance.ceo || "UNCONFIRMED — read the proxy"}
                      {d.governance.ceoSince ? ` since ${d.governance.ceoSince}` : ""}
                      {d.governance.founderLed ? " (founder)" : ""}
                      {d.governance.dualClass ? " · dual-class, you do not get a vote" : ""}
                      {d.governance.successionNote ? ` — ${d.governance.successionNote}` : ""}
                    </p>
                  )}
                  <p>
                    <span className="text-[var(--color-muted)]">Kill rule · </span>
                    {d.killRule}
                  </p>
                  {d.regulatory && (
                    <p>
                      <span className="text-[var(--color-muted)]">Regulatory · </span>
                      {d.regulatory}
                    </p>
                  )}
                  {f && !f.pendingCapture && (
                    <p className="tabular-nums text-[var(--color-muted)]">
                      P/E {f.peTrailing ?? "—"} trail · {f.peForward ?? "—"} fwd · margin{" "}
                      {pct(f.profitMargin)} · rev {pct(f.revenueGrowthYoy)} · earnings{" "}
                      <span className={(f.earningsGrowthYoy ?? 0) < 0 ? "text-[var(--color-down)]" : ""}>
                        {pct(f.earningsGrowthYoy)}
                      </span>{" "}
                      · beta {f.beta ?? "—"} · insiders {f.insiderPct ?? "—"}% · inst{" "}
                      {f.institutionPct ?? "—"}%
                    </p>
                  )}
                  {d.kind === "company" &&
                    (() => {
                      const g = impliedGrowth(f);
                      if (g.growth == null) return null;
                      const band = sensitivity(f)
                        .map((x) => (x.growth == null ? "—" : `${(x.growth * 100).toFixed(1)}%`))
                        .join(" / ");
                      const q = qualityRead(f);
                      const t = trendRead(f);
                      return (
                        <>
                          <p className="rounded border border-[var(--color-border)] p-1.5">
                            <span className="text-[var(--color-muted)]">The price already assumes · </span>
                            <span className="font-semibold tabular-nums">
                              {(g.growth * 100).toFixed(1)}% earnings growth a year for {g.years} years
                            </span>{" "}
                            <span className="text-[var(--color-muted)]">
                              ({g.demand}) — {band} across a 3.5–5.5% equity risk premium. Not a forecast: this is
                              the assumption inside today's price, so you can disagree with it.
                            </span>
                          </p>
                          <p className="text-[var(--color-muted)]">
                            Quality · {q.legs.map((l) => `${l.label} ${l.reads}`).join(" · ")}
                          </p>
                          <p className="text-[var(--color-muted)]">Trend · {t.line}</p>
                        </>
                      );
                    })()}
                  {d.kind === "company" && evidenceFor(d.ticker, "governance.ceo") !== "verified" && (
                    <p className="text-[var(--color-warn)]">
                      Operator is asserted, not verified — no primary source attached. Settle it from the DEF 14A
                      proxy before treating it as checked.
                    </p>
                  )}
                  {d.caveat && (
                    <p className="flex gap-1.5 rounded border border-[var(--color-border)] p-1.5 text-[var(--color-warn)]">
                      <Info size={12} className="mt-0.5 shrink-0" />
                      {d.caveat}
                    </p>
                  )}
                  {!gate.canAdd && (
                    <p className="text-[var(--color-down)]">Blocked · {gate.reason}</p>
                  )}
                </div>
              </details>
            );
          })}
        </div>
      </Card>

      <p className="text-[10px] leading-relaxed text-[var(--color-muted)]">
        Fundamentals are a committed snapshot from {snapshotCapturedAt()}, not a live feed — a free
        Alpha Vantage key allows 25 requests a day, so this book refreshes on purpose rather than on
        a poll. Refresh with <code>scripts/capture-invest-universe.mjs</code>. Nothing on this page is
        tax or investment advice; the wash-sale rule encoded here is a conservative default and the
        filed position belongs to a CPA.
      </p>
    </div>
  );
}
