/**
 * The Investments tab — years, on a desk built for minutes.
 *
 * Layout order is the argument, top to bottom:
 *   1. THE SWEEP. What this month sends to shares, priced through the
 *      waterfall. First because it is the only thing here that moves money.
 *      The rent line follows it whenever the data bill is the story.
 *   2. THE HABIT. Every logged month, the months skipped, the rate ladder,
 *      swept cash not yet bought, and where it goes next.
 *   3. THE BOOK. Lots, real closes, sells, dividends, the benchmark that
 *      uses the same dollars on the same days, and the tax year.
 *   4. WHAT IT OWNS. The funds opened up: overlap with QQQ, tech weight,
 *      fees, and the dry-powder rule against VTI's own closes.
 *   5. THE RESEARCH, the kill rules, and the screen.
 *   6. The limits (folded) and where the record lives.
 *
 * Nothing here reads the PATH board, the SMC word, the killzone or the
 * Judas window, and nothing here flashes. The other tabs are allowed to
 * shout; this one is deliberately quiet, because every mechanism that makes
 * a trader fast is a mechanism that makes an investor poor.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Landmark } from "lucide-react";
import { rateLadder } from "@/lib/invest/policy";
import { deployQueue } from "@/lib/invest/policy";
import {
  buildBook,
  dryPowderTrigger,
  nextBuy,
  rebalanceCheck,
  shadowBenchmark,
  type Position,
} from "@/lib/invest/book";
import { heldPositions, sweepFundedUsd } from "@/lib/invest/ledger";
import { lookThrough } from "@/lib/invest/exposure";
import { ALL_DOSSIERS } from "@/lib/invest/dossiers";
import { etToday, loadLedger, subscribeInvest } from "@/lib/invest/store";
import { syncInvestLedger, type SyncState } from "@/lib/invest/sync";
import { getInvestMarks } from "@/lib/invest/marks-server";
import { MARKS_MAX_TICKERS, type InvestMarks } from "@/lib/invest/marks";
import { latestJudgement, subscribeKill } from "@/lib/invest/kill-store";
import { uncoveredUnderliers } from "@/lib/invest/rh-bridge";
import { snapshotCapturedAt } from "@/lib/invest/universe";
import { KillWatchPanel } from "@/components/desk/kill-watch-panel";
import { SweepCard } from "@/components/invest/sweep-card";
import { HabitCard } from "@/components/invest/habit-card";
import { BookCard } from "@/components/invest/book-card";
import { ExposureCard } from "@/components/invest/exposure-card";
import { ResearchCard, type Judged } from "@/components/invest/research-card";
import { ScreenTable } from "@/components/invest/screen-table";
import { LimitsCard } from "@/components/invest/limits-card";
import { DataCard } from "@/components/invest/data-card";
import { IpoCard } from "@/components/invest/ipo-card";
import { Note } from "@/components/invest/ui";

const MARKS_CACHE = "ledger.invest.marks.v1";

function readMarksCache(): InvestMarks | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(MARKS_CACHE);
    return raw ? (JSON.parse(raw) as InvestMarks) : null;
  } catch {
    return null;
  }
}

function writeMarksCache(m: InvestMarks): void {
  try {
    window.localStorage.setItem(MARKS_CACHE, JSON.stringify(m));
  } catch {
    /* a cache miss next visit is harmless */
  }
}

export function InvestPanel() {
  const [version, setVersion] = useState(0);
  const [killVersion, setKillVersion] = useState(0);
  useEffect(() => subscribeInvest(() => setVersion((n) => n + 1)), []);
  useEffect(() => subscribeKill(() => setKillVersion((n) => n + 1)), []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const ledger = useMemo(() => loadLedger(), [version]);
  const today = etToday();
  const held = useMemo(() => heldPositions(ledger, today), [ledger, today]);
  const heldSet = useMemo(() => new Set(held.map((h) => h.ticker)), [held]);
  const ladder = rateLadder(ledger.sweeps);

  /* ---- sync ---------------------------------------------------------- */
  const [sync, setSync] = useState<SyncState | null>(null);
  const [syncing, setSyncing] = useState(false);
  const runSync = useCallback(() => {
    setSyncing(true);
    void syncInvestLedger()
      .then(setSync)
      .finally(() => setSyncing(false));
  }, []);
  useEffect(() => runSync(), [runSync]);
  const onWrite = useCallback(() => {
    setVersion((n) => n + 1);
    runSync();
  }, [runSync]);

  /* ---- marks: once per visit and on request, never polled ------------- */
  const [marks, setMarks] = useState<InvestMarks | null>(() => readMarksCache());
  const [marksState, setMarksState] = useState<{ loading: boolean; error: string | null }>({ loading: false, error: null });
  const wanted = useMemo(() => [...new Set([...held.map((h) => h.ticker), "VTI"])].slice(0, MARKS_MAX_TICKERS), [held]);
  const since = useMemo(() => held.flatMap((h) => h.lots.map((l) => l.date)).sort()[0], [held]);
  const earliestLot = useMemo(() => ledger.lots.map((l) => l.date).sort()[0], [ledger]);
  const fetchMarks = useCallback(() => {
    setMarksState({ loading: true, error: null });
    void getInvestMarks({ data: { tickers: wanted, historyFor: ["VTI"], since: earliestLot ?? since } })
      .then((m) => {
        setMarks(m);
        writeMarksCache(m);
        setMarksState({ loading: false, error: null });
      })
      .catch((e: unknown) => setMarksState({ loading: false, error: e instanceof Error ? e.message : String(e) }));
  }, [wanted, since, earliestLot]);
  const wantedKey = wanted.join(",");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => fetchMarks(), [wantedKey]);

  const prices = useMemo(() => {
    const out: Record<string, number> = {};
    for (const m of marks?.marks ?? []) if (m.last) out[m.ticker] = m.last.price;
    return out;
  }, [marks]);
  const vti = marks?.marks.find((m) => m.ticker === "VTI") ?? null;
  const missing = held.filter((h) => prices[h.ticker] == null).map((h) => h.ticker);
  const marksMsg = marksState.loading
    ? "fetching closes…"
    : marksState.error
      ? `marks unavailable (${marksState.error.slice(0, 60)}) — valued at cost`
      : marks
        ? `Yahoo closes · ${new Date(marks.fetchedAt).toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })} ET${
            missing.length ? ` · at cost: ${missing.join(", ")}` : ""
          }`
        : "valued at cost until closes load";

  /* ---- the book and everything read from it --------------------------- */
  const positions: Position[] = held.map((h) => ({
    ticker: h.ticker,
    sleeve: h.sleeve,
    shares: h.shares,
    costUsd: h.costUsd,
    openedAt: h.openedAt,
  }));
  const book = useMemo(() => buildBook(positions, prices, Date.now()), [held, prices]); // eslint-disable-line react-hooks/exhaustive-deps
  const reb = rebalanceCheck(book);
  const exposure = useMemo(
    () => lookThrough(book.positions.map((p) => ({ ticker: p.ticker, valueUsd: p.valueUsd }))),
    [book],
  );
  const weights = useMemo(() => new Map(book.positions.map((p) => [p.ticker, p.weight])), [book]);
  const closes = useMemo(() => new Map(Object.entries(prices)), [prices]);
  const vtiCloses = useMemo(() => (vti?.closes ?? []).map(([date, close]) => ({ date, close })), [vti]);
  const dry = dryPowderTrigger(vtiCloses);
  const shadow = useMemo(
    () =>
      shadowBenchmark(
        ledger.lots,
        book.totalUsd,
        ledger.sales.reduce((s, x) => s + x.proceedsUsd, 0),
        new Map(vti?.closes ?? []),
        vti?.last?.price ?? null,
        today,
      ),
    [ledger, book, vti, today],
  );
  const queue = deployQueue(ledger.sweeps, sweepFundedUsd(ledger), Date.now());
  const next = nextBuy(book, queue.waitingUsd, heldSet);

  /* ---- human kill-rule judgements (never a model's) ------------------- */
  const judgements = useMemo(() => {
    const out = new Map<string, Judged>();
    for (const d of ALL_DOSSIERS) {
      const j = latestJudgement(d.ticker);
      if (j) out.set(d.ticker, { tripped: j.tripped, judgedAt: j.judgedAt, note: j.note });
    }
    return out;
  }, [killVersion]); // eslint-disable-line react-hooks/exhaustive-deps

  const uncovered = useMemo(() => uncoveredUnderliers(), [version]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-3">
      <header className="flex flex-wrap items-center gap-2">
        <Landmark size={15} className="text-[var(--color-muted)]" />
        <h2 className="text-sm font-semibold">Investments</h2>
        <span className="text-[11px] text-[var(--color-muted)]">years · shares held · funded by a cut of realized options P&amp;L</span>
      </header>

      <p className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] p-2.5 text-[11px] leading-relaxed text-[var(--color-muted)]">
        This tab never reads the PATH word, the 0.65 floor, the killzone or the Judas window, and it never flashes. Futures is
        hours, the options sleeve is days, this is years — the only wire between them is the monthly sweep below, and it runs one
        way.
      </p>

      {uncovered.length > 0 && (
        <Note tone="warn">
          The RH journal shows options on {uncovered.map((u) => `${u.underlier} (${u.lastAt.slice(0, 10)})`).join(", ")} in the last
          61 days. Those tickers are banned from this book too until the window passes — a buy of the same security inside it
          risks a wash-sale entanglement with the sleeve.
        </Note>
      )}

      <SweepCard closedMonths={ledger.sweeps.length} rate={ladder} onWrite={onWrite} />
      <HabitCard ledger={ledger} ladder={ladder} next={next} onWrite={onWrite} />
      <BookCard
        ledger={ledger}
        book={book}
        reb={reb}
        marks={marks}
        marksMsg={marksMsg}
        onRefreshMarks={fetchMarks}
        shadow={shadow}
        waitingUsd={queue.waitingUsd}
        onWrite={onWrite}
      />
      <ExposureCard read={exposure} dry={dry} />
      <ResearchCard
        weights={weights}
        held={heldSet}
        exposure={exposure}
        judgements={judgements}
        closes={closes}
        belowMeaningful={book.positions.length > 0 && book.belowMeaningful}
      />
      {/* The kill rules, checked on demand with a weekly floor — a
          multi-year holding does not need a poll, and each run spends API
          budget. A person, never the model, marks a rule tripped. */}
      <KillWatchPanel />
      <ScreenTable />
      <IpoCard />
      <LimitsCard />
      <DataCard sync={sync} syncing={syncing} onSync={runSync} entries={ledger.entries.length} onWrite={onWrite} />

      <p className="text-[10px] leading-relaxed text-[var(--color-muted)]">
        Fundamentals are a committed snapshot ({snapshotCapturedAt()}), not a live feed — a free Alpha Vantage key allows 25
        requests a day, so this book refreshes on purpose rather than on a poll (<code>npm run capture:invest</code>). Marks are
        Yahoo daily closes fetched when you open the tab. Nothing on this page is tax or investment advice; the wash-sale rules
        encoded here are conservative defaults and the filed position belongs to a CPA.
      </p>
    </div>
  );
}
