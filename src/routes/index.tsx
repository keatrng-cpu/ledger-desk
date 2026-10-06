import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
  Landmark,
  BookOpen,
  Crosshair,
  FlaskConical,
  LineChart,
  Loader2,
  RefreshCw,
  Swords,
  TrendingUp,
  Brain,
  Layers,
  GraduationCap,
  Newspaper,
  Percent,
  MessagesSquare,
  Building2,
} from "lucide-react";
import { AplusOps } from "@/components/dashboard/aplus-ops";
import { DualIndexCharts } from "@/components/dashboard/dual-index-charts";
import { BridgeStatus } from "@/components/bridge/bridge-status";
import { HaltBanner } from "@/components/journal/halt-banner";
import { JournalPanel } from "@/components/journal/journal-panel";
import { DisciplinePanel } from "@/components/journal/discipline-panel";
import { TakeMomentsPanel } from "@/components/desk/take-moments-panel";
import { markTakeAction, observeTakeMoments, tickMomentOutcomes } from "@/lib/trading/take-moments";
import { LogSetupDialog } from "@/components/journal/log-setup-dialog";
import { PaperBookPanel } from "@/components/desk/paper-book-panel";
import { TradeDebriefPanel } from "@/components/desk/trade-debrief-panel";
import {
  openPaperTradeInstant,
  managePaperTradesAgainstPrice,
  listOpenPaperTrades,
  reconcilePaperBookToMemory,
  buildPaperLevels,
  paperAPlusCounters,
  type PaperTrade,
  type ManagePrice,
} from "@/lib/trading/paper-manager";
import { ReplayReport } from "@/components/lab/replay-report";
import { ApexSimPanel } from "@/components/lab/apex-sim-panel";
import { EvidenceTable } from "@/components/lab/evidence-table";
import { HtfBiasBoard } from "@/components/desk/htf-bias-board";
import { LiquidityPanel } from "@/components/desk/liquidity-panel";
import { PremarketPanel } from "@/components/desk/premarket-panel";
import { RiskPanel } from "@/components/desk/risk-panel";
import { SessionHud } from "@/components/desk/session-hud";
import {
  SetupScanner,
  type CardTape,
} from "@/components/desk/setup-scanner";
import { ProfitPathPanel } from "@/components/desk/profit-path";
import { TradezellaChat } from "@/components/desk/tradezella-chat";
import { TradingCoach } from "@/components/desk/trading-coach";
import { VeteranBrainPanel } from "@/components/desk/veteran-brain";
import { SmcPlaybook } from "@/components/desk/smc-playbook";
import { OptionsSwingPanel } from "@/components/desk/options-swing-panel";
import { MarketNarrativePanel } from "@/components/desk/market-narrative-panel";
import { PricePathBoard } from "@/components/desk/price-path-board";
import { SetupChartPanel } from "@/components/desk/setup-chart-panel";
import { LearnTab } from "@/components/learn/learn-tab";
import { InvestPanel } from "@/components/desk/invest-panel";
import { NewsTab } from "@/components/news/news-tab";
import { DiscussTab } from "@/components/desk/discuss-tab";
import { useRoomEngine } from "@/components/room/room-engine";
import { useDeskSynapse, getDeskSynapse, type SynapseTab } from "@/lib/trading/desk-synapse";
import { allSeries } from "@/lib/trading/chart-timeframes";
import { buildTradeNote, missingLayers } from "@/lib/trading/trade-note";
import {
  getPaperAccount,
  formatPaperChip,
  resetPaperAccount,
} from "@/lib/trading/paper-account";
import {
  fetchYearStudySeed,
  hydrateFromYearStudy,
} from "@/lib/trading/bt-seed";
import { SYNAPSE_TABS } from "@/components/desk/synapse-rail";
import { runVeteranBrain } from "@/lib/trading/veteran-brain";
import { loadDeskMemory, emptyDeskMemory } from "@/lib/trading/desk-memory";
import { Button } from "@/components/ui/button";
import {
  fetchTradingDesk,
  type DeskPayload,
} from "@/lib/trading/build-desk";
import { fetchLiveQuotes } from "@/lib/market/fetch-dual";
import { applyQuoteToLastBar, stampSeriesFromBars } from "@/lib/market/freshest";
import { etWallParts } from "@/lib/trading/sessions";
import { buildLiveSays } from "@/lib/trading/live-says";

import { getRiskState, getSettings } from "@/lib/journal/server";
import {
  getDiscretionState,
  discretionFor,
  type DiscretionPayload,
} from "@/lib/journal/discretion-server";
import { AnalyticsPanel } from "@/components/journal/analytics-panel";
import { captureSnapshot } from "@/lib/journal/snapshots";
import { mirrorPaperOpen, mirrorPaperClose } from "@/lib/journal/paper-mirror";
import { syncPaperBookToDb } from "@/lib/journal/paper-backfill";
import { recordShadowOrder } from "@/lib/execution/shadow";
import { orderIntentFromPaperLevels } from "@/lib/execution/order-intent";
import { observeAndTickGhosts, markGhostTaken } from "@/lib/trading/ghost-book";
import { hydrateShadowBook, observeShadowBook } from "@/lib/trading/shadow-store";
import { applyWordHysteresis, createHysteresisState } from "@/lib/trading/word-hysteresis";
import { ShadowBookPanel } from "@/components/desk/shadow-book-panel";
import { TradeLogPanel } from "@/components/desk/trade-log-panel";
import { CalibrationPanel } from "@/components/desk/calibration-panel";
import { recordPoll } from "@/lib/trading/take-census";
import { TakeCensusPanel } from "@/components/desk/take-census-panel";
import { TfLadderPanel } from "@/components/desk/tf-ladder-panel";
import { OvernightBoard } from "@/components/desk/overnight-board";
import { DECIDE_START_MIN, DECIDE_END_MIN } from "@/lib/trading/overnight-swing";
import { recordPrint } from "@/lib/market/print-bars";
import {
  tickPending,
  confirmPendingFill,
  releasePending,
  restLimit,
  restingFor,
  type PendingPrint,
  type PendingOrder,
} from "@/lib/trading/pending-order";
import { cardSizeRefusal, restableFromCard, withOrderLevels } from "@/lib/trading/card-plan";
import { pendingFillToast } from "@/components/desk/entry-trigger-panel";
import { considerEntryAlarm } from "@/lib/alerts/path-alarm";
import { SnapshotReview } from "@/components/desk/snapshot-review";
import { ShadowOrderReview } from "@/components/desk/shadow-order-review";
import { AlertsPanel } from "@/components/desk/alerts-panel";
import { PathAlarmBar } from "@/components/desk/path-alarm-bar";
import { LiveSessionCard } from "@/components/desk/live-session-card";
import { LiveSaysPanel } from "@/components/desk/live-says-panel";
import {
  considerPathAlarm,
  isHighProbPath,
} from "@/lib/alerts/path-alarm";
import {
  raiseSetupArmedAlert,
  raisePositionFlattenedAlert,
  raiseNewsBlackoutAlert,
  checkScheduledJobs,
} from "@/lib/alerts/trigger-server";
import { StorageBanner } from "@/components/desk/storage-banner";
import { PropFirmPanel } from "@/components/desk/propfirm-panel";
import { tryApexAutofire, AUTOFIRE_CONFLUENCE_FLOOR } from "@/lib/execution/apex-autofire";
import type { RiskState } from "@/lib/journal/risk";
import type { SetupCandidate } from "@/lib/trading/scanner";
import { APLUS_RULES } from "@/lib/aplus/config";
import { formatUtcClock } from "@/lib/market/yahoo";
import {
  brainLiveRisk,
  deskStaleLine,
  readRiskGoverned,
  riskEntryAllowed,
  riskEntryBlockedReason,
  riskUnknownLine,
  withClientTimeout,
  type RiskFetchState,
} from "@/lib/trading/desk-fetch-guard";
import { cn } from "@/lib/utils";
import { EntryHero } from "@/components/desk/entry-hero";
import { ScreenFlash } from "@/components/desk/screen-flash";
import { BUILD_ID, BUILD_LABEL, BUILD_MARKER } from "@/lib/build-id";
import {
  autoPaperShouldTake,
  rememberAutoPaperKey,
  releaseAutoPaperKey,
  noteAutoPaperSkip,
} from "@/lib/trading/auto-paper";
import { msUntilNextDeskPoll } from "@/lib/trading/desk-cadence";

// three.js (~600 KB) loads only when the Floor tab is opened; the room's
// engine (room-engine.ts) is plain TS and runs at page level below.
const TradingFloorTab = lazy(() => import("@/components/room/trading-floor-tab"));
// The Mead Hall (2026-10-06): the prediction-market sports bar — three.js too, so lazy like the Floor.
const MeadHallTab = lazy(() => import("@/components/mead/mead-hall-tab"));
// PM analyzer (2026-10-06, Keaton): Predict + Mead Hall merged — the hall on top
// (signal board → hallLayout), a desk panel per market below. three.js → lazy.
const PmAnalyzer = lazy(() => import("@/components/predict/pm-analyzer"));
// DEV capture only — Accuracy attachment re-render. `?capture=mead` mounts the
// Mead Hall without waiting on /api/desk. import.meta.env.DEV is statically
// false in production builds, so this is dead code there.
const isMeadCapture = () =>
  import.meta.env.DEV &&
  typeof window !== "undefined" &&
  new URLSearchParams(window.location.search).get("capture") === "mead";

export const Route = createFileRoute("/")({
  component: MasterplacePage,
});

/**
 * Turn a failed desk poll into one line a trader can act on.
 *
 * When Netlify's edge gives up on a silent streaming function it returns a
 * 504 whose body is a small HTML page ("Inactivity Timeout ... Too much time
 * has passed without sending any data for document"). The server-function
 * client surfaces that body as the error message, and until 2026-09-19 the
 * desk printed it verbatim — a screen of raw HTML tags in the error banner.
 * The condition it describes is ordinary (an upstream market-data fetch ran
 * long) and self-healing (the next poll usually succeeds), so it should read
 * that way.
 */
function describeDeskError(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e ?? "");
  if (/timed out after/i.test(raw)) {
    return "Desk build timed out waiting on the server — market data or risk/auth may be slow. Retrying on the next poll.";
  }
  if (/inactivity timeout|<html|<head|<title/i.test(raw) || /\b504\b/.test(raw)) {
    return "Desk build ran long and the edge gave up (504) — market data upstream was slow. Retrying on the next poll.";
  }
  if (/failed to fetch|networkerror|load failed/i.test(raw)) {
    return "Network dropped mid-poll — retrying on the next poll.";
  }
  return raw.length > 240 ? `${raw.slice(0, 240)}…` : raw || "Desk load failed";
}

/** Slightly above Netlify/Pro edge (~26s) so a real 504 still surfaces; below "forever". */
const DESK_CLIENT_TIMEOUT_MS = 35_000;
/** Risk/auth/DB must not hold the desk hostage on cold start. */
const RISK_CLIENT_TIMEOUT_MS = 12_000;
/**
 * The quote poll had no bound of its own: one hung fetchLiveQuotes froze the
 * poll (inFlight never cleared) while the HUD kept the last quotes. 8s is well
 * past a healthy 1-2s quote read and short enough that the poll recovers.
 */
const QUOTE_CLIENT_TIMEOUT_MS = 8_000;
/** Live gateway tick is already in Postgres — 1s is free. */
const QUOTE_LIVE_MS = 1_000;
/** Yahoo delayed print. Match the tape, don't hammer the free host. */
const QUOTE_YAHOO_MS = 2_000;


/**
 * Mirror closed paper trades into desk_trades. Used by EVERY close path —
 * the desk poll, the 5s manage tick, and the structure-TP close. Missing it
 * on any one path leaves those rows `status='open'` in the durable record
 * forever while the localStorage book shows them closed.
 * Fire-and-forget: never blocks or breaks the working book.
 */
function mirrorClosedPaperTrades(closed: PaperTrade[]): void {
  for (const t of closed) {
    if (t.exit == null) continue;
    void mirrorPaperClose({
      data: {
        id: t.id,
        exit: t.exit,
        closedAt: new Date(t.closedAt ?? Date.now()).toISOString(),
        contracts: t.contracts,
        reason: t.exitReason ?? "paper exit",
        // Every leg, so Postgres prices the scale-out the way the book did.
        legs: (t.scaleLegs ?? [])
          .filter((l) => l.price > 0 && l.contracts > 0)
          .map((l) => ({ price: l.price, contracts: l.contracts })),
      },
    }).catch(() => undefined);

    // "Position flattened" (B4) is specifically the time/context-stop close
    // (management.ts's shouldFlatten, tagged exitReason "flat_*") — NOT a
    // normal stop or target hit, which is the plan working as intended and
    // not alert-worthy. See send-server.ts's positionFlattenedAlert doc.
    if (t.exitReason?.startsWith("flat_")) {
      const r = t.rMultiple ?? null;
      void raisePositionFlattenedAlert({
        data: {
          tradeId: t.id,
          symbol: t.displaySymbol,
          side: t.side,
          reason: t.manageNote || t.exitReason,
          r,
        },
      }).catch(() => undefined);
    }
  }
}

/**
 * ROADMAP E4 — record the order the desk WOULD have placed for the current
 * best ACTIONABLE candidate, on every desk poll. This was built (shadow.ts)
 * but never called from anywhere — a fully orphaned table, per the 2026-08-12
 * audit. Wiring it here is exactly what its own docstring prescribes: "the
 * 30s poll is the natural home."
 *
 * Idempotent by design: clientOrderId is derived from
 * symbol+side+strategy+killzone+day, so re-polling the SAME armed setup
 * writes the row once (on-conflict-do-nothing), not once per poll. A new
 * killzone, a new day, or a genuinely different strategy/side gets a new row.
 * Fire-and-forget and silently no-ops when signed out (authMiddleware) — this
 * is a research record, never a blocker for anything else on the page.
 */
function recordArmedShadow(desk: DeskPayload, equity: number): void {
  const candidate = desk.scan.candidates.find((c) => c.actionable);
  if (!candidate) return;

  const lastPrice =
    desk.left.symbol === candidate.symbol
      ? desk.quotes.left.price
      : desk.right.symbol === candidate.symbol
        ? desk.quotes.right.price
        : desk.quotes.left.price;

  // Size the record off the SAME book the ticket would be sized off. Rule 5's
  // A+ probe reads `counters`, and `buildPaperLevels` otherwise resolves them
  // itself on the way past — two reads of one sample that can disagree the
  // moment either side gains its own source. Naming it here keeps the shadow
  // row and the paper ticket on one book and makes which book visible at the
  // call site. That book is this browser's paper localStorage, not the
  // server's `desk_trades`: this poll holds no authoritative counters, and an
  // unknown history must stay locked rather than be read as an unlock.
  const levels = buildPaperLevels(
    candidate,
    equity,
    lastPrice,
    undefined,
    paperAPlusCounters(),
  );
  if (!levels.entry || !levels.stop) return;

  const dayKey = new Date().toISOString().slice(0, 10);
  const strategy = candidate.completeStrategy || candidate.strategyPrimary || "unknown";
  const killzone = desk.clock.killzone || "nokz";
  const clientOrderId = `shadow-${levels.symbol}-${levels.side}-${strategy}-${killzone}-${dayKey}`;

  // orderIntentFromPaperLevels throws (OrderIntentError) on invalid geometry —
  // never let a bad candidate break the poll loop over a record nobody is
  // blocked on.
  try {
    const intent = orderIntentFromPaperLevels(levels, {
      clientOrderId,
      equity,
      killzone: desk.clock.killzone,
      strategy,
      score: candidate.confluence,
      note: candidate.title,
    });
    void recordShadowOrder({ data: { intent, source: "desk" } }).catch(
      () => undefined,
    );
  } catch {
    /* invalid geometry on this poll tick — skip, try again next poll */
  }
}

/**
 * ROADMAP addendum, 2026-08-14 — Apex evaluation-phase autofire. Rides the
 * SAME poll tick and the SAME best-actionable-candidate lookup as
 * `recordArmedShadow` above; this is a cheap client-side pre-filter only
 * (actionable + confluence floor) to avoid a round-trip on every poll for a
 * candidate that obviously will not qualify — it is NOT the real gate. The
 * real gate (Apex account phase, the autofire switch, halts, pathTakeGate,
 * per-account trailing-drawdown) lives entirely in `tryApexAutofire` on the
 * server, because the phase-lock reads `process.env` and must never be
 * evaluated in the browser bundle (see that file's header). This function
 * fires on every poll where a qualifying candidate is present; the server
 * fn is what actually decides whether anything gets sent, and it refuses
 * far more often than it sends by design.
 *
 * Fire-and-forget, same as every other poll-loop side effect on this page —
 * a slow or failed autofire attempt must never block the desk from
 * rendering. Result is logged (not toasted): the journal panel and the
 * shadow-order review already surface a fired trade, and a page-load toast
 * for something that happens with no click would be easy to miss/dismiss
 * without reading — console is the honest channel until this has run for
 * real and earns a dedicated UI treatment.
 */
function maybeAutofire(desk: DeskPayload, equity: number): void {
  const candidate = desk.scan.candidates.find(
    (c) => c.actionable && c.confluence >= AUTOFIRE_CONFLUENCE_FLOOR,
  );
  if (!candidate) return;

  const lastPrice =
    desk.left.symbol === candidate.symbol
      ? desk.quotes.left.price
      : desk.right.symbol === candidate.symbol
        ? desk.quotes.right.price
        : desk.quotes.left.price;

  void tryApexAutofire({
    data: {
      candidate,
      equity,
      killzone: desk.clock.killzone,
      lastPrice,
    },
  })
    .then((res) => {
      // Only the firing case is logged — a routine refusal (switch off,
      // wrong phase, gate unmet) happens on most polls by design and would
      // just be console noise, same restraint `recordArmedShadow` uses.
      if (res.fired) {
        console.info("[apex-autofire]", res.reason);
      }
    })
    .catch(() => undefined);
}

/**
 * Everything a paper FILL owes the rest of the desk, in one place: the ghost
 * book learns the card was taken, and the localStorage book is mirrored into
 * desk_trades so analytics, CSV and the A+ unlock see it. Fire-and-forget —
 * a signed-out or DB-less desk must never block the working paper book.
 *
 * It used to live only in the one-click path, so a resting-limit fill (the
 * path the entry rule actually prescribes) was never mirrored at all.
 */
function bookPaperFill(desk: DeskPayload, c: SetupCandidate, trade: PaperTrade): void {
  markGhostTaken(c.symbol, c.side);
  void mirrorPaperOpen({
    data: {
      id: trade.id,
      // `symbol` is the resolved contract (ES -> MES when micros are on);
      // sending the label made the server price a micro at full size.
      symbol: trade.symbol,
      side: trade.side,
      entry: trade.entry,
      stop: trade.stop,
      target: trade.tp1 ?? null,
      contracts: trade.contracts,
      openedAt: new Date(trade.openedAt).toISOString(),
      prescore: trade.score ?? null,
      // The CARD's band, never the sizing grade — rule 5 rewrites the sizing
      // grade on an A+ card, and the unlock counts card bands.
      grade: trade.cardBand || trade.pathBand || trade.grade || null,
      killzone: desk.clock.killzone ?? null,
      strategy: trade.strategy ?? null,
      regime: c.regime ?? null,
      reason: trade.reason ?? null,
    },
  }).catch(() => undefined);
}

/**
 * Rest a paper limit at the card's priced CE — what "Log paper" does now.
 *
 * It used to book an instant fill at the entry zone's midpoint, a price that
 * had often not traded: a click before the retrace wrote a fill the tape
 * never offered. CLAUDE.md's entry rule is "rest the limit at CE — never pay
 * the print", so the paper button now does exactly that and the poll loop
 * (fillRestingLimits) books the fill when the tape reaches it.
 */
function restPaperLimit(
  c: SetupCandidate,
  discretionMult: number,
): { ok: true; order: PendingOrder; already: boolean } | { ok: false; error: string } {
  const rest = restableFromCard(c);
  if (!rest) {
    return {
      ok: false,
      error: `${c.symbol} ${c.side}: no priced plan on this side yet — nothing to rest. The sequence prices one once there is an entry array and a raid.`,
    };
  }
  const refusal = cardSizeRefusal(c);
  if (refusal) return { ok: false, error: `DO NOT SIZE — ${refusal}` };
  if (listOpenPaperTrades().some((t) => t.displaySymbol === c.symbol || t.symbol === c.symbol)) {
    return { ok: false, error: `${c.symbol} already has an open paper trade — one position per book.` };
  }
  const live = restingFor(c.symbol);
  if (live && live.side === rest.side && Math.abs(live.limit - rest.entry) < 1e-6) {
    return { ok: true, order: live, already: true };
  }
  const order = restLimit(rest, {
    grade: String(c.pathBand || c.grade),
    strategy: c.completeStrategy || c.strategyPrimary || "sequence",
    now: Date.now(),
    discretionMult,
  });
  return { ok: true, order, already: false };
}

/**
 * Fill any resting limit the live print has reached.
 *
 * The fill price is the LIMIT, never the print — an order resting at
 * 24180.25 does not fill at 24179.00 because the tape traded through it. The
 * paper open is booked with `lastPrice` set to that limit, so
 * `buildPaperLevels` (which prefers the entry zone's mid) lands on the same
 * number the trader committed to.
 *
 * The pooled "+0.35R resting vs +0.007R chasing" figure that first motivated
 * this turned out to be a London-killzone artifact (entry-trigger.ts), so the
 * mechanism stands on its own logic rather than on that number: the plan
 * named a price, and this fills there or not at all.
 */
function fillRestingLimits(desk: DeskPayload): string | null {
  // Each print carries its OWN age. tickPending refuses to register a touch
  // from a quote older than the execution budget, which is the whole point:
  // before 2026-09-23 this passed bare numbers and a limit could "fill" on a
  // ten-minute-old Yahoo print at a level the tape had long since left.
  const prices: Record<string, PendingPrint> = {
    [desk.left.symbol]: { price: desk.quotes.left.price, lagSec: desk.quotes.left.lagSec },
    [desk.right.symbol]: { price: desk.quotes.right.price, lagSec: desk.quotes.right.lagSec },
  };
  const { touched, expired, stale } = tickPending(prices, Date.now());
  for (const o of expired) {
    console.info("[pending] expired", o.symbol, o.limit, o.note);
  }
  // A limit the tape reached on a print too old to act on. The order is still
  // resting; say why nothing happened rather than showing silence.
  if (!touched.length && stale.length) {
    const st = stale[0]!;
    return `Limit at ${st.order.limit.toFixed(2)} was reached, but ${st.reason} — still resting, nothing booked.`;
  }
  if (!touched.length) return null;
  const o = touched[0]!;
  const card = desk.scan.candidates.find(
    (c) => c.symbol === o.symbol && c.side === o.side,
  );
  if (!card) {
    return `Limit at ${o.limit.toFixed(2)} touched, but the ${o.symbol} ${o.side} card is gone — not booked. Re-grade before entering by hand.`;
  }
  // One position per book. A resting order on a book that already holds a
  // paper trade would be a second entry on the same idea.
  const open = listOpenPaperTrades().find(
    (t) => t.displaySymbol === o.symbol || t.symbol === o.symbol,
  );
  if (open) {
    releasePending(o.id, `already holding ${open.displaySymbol} ${open.side} — one position per book`, Date.now());
    return `Limit at ${o.limit.toFixed(2)} touched, but ${open.displaySymbol} ${open.side} is already open — not booked.`;
  }
  // The ORDER's levels, not whatever the card says now. The toast promises
  // the order's stop and T1, and a card re-graded since the order rested can
  // carry a different plan.
  const candidate = withOrderLevels(card, o);
  const lagSec =
    o.symbol === desk.left.symbol ? desk.quotes.left.lagSec : desk.quotes.right.lagSec;
  const wall = etWallParts(Date.now());
  const res = openPaperTradeInstant(candidate, {
    lastPrice: o.limit,
    killzone: desk.clock.killzone,
    lagSec,
    et: { hour: wall.hour, minute: wall.minute },
    newsVerdict: desk.news?.verdict,
    discretionMult: o.discretionMult,
    // The sub-15m rungs, so the Judas release can resolve. Without them the
    // fill path refuses the whole 09:30-09:45 window, as it always did.
    rungs: allSeries(
      o.symbol === desk.left.symbol ? desk.left.bars : desk.right.bars,
      (o.symbol === desk.left.symbol ? desk.mtf?.left?.minute : desk.mtf?.right?.minute) ?? [],
    ),
  });
  if (res.ok) {
    // Only NOW is it a fill. Before this the order stayed in `touched`, so a
    // refusal by the paper book leaves it resting instead of consuming it —
    // the rollback that did not exist when this wrote `filled` up front.
    confirmPendingFill(o.id, Date.now());
    bookPaperFill(desk, card, res.trade);
    return pendingFillToast(o);
  }
  releasePending(o.id, `paper book refused: ${res.error}`, Date.now());
  return `Limit at ${o.limit.toFixed(2)} touched but the paper book refused it: ${res.error}. The order is still resting.`;
}

/**
 * The remaining 2 of 4 B4 real-time alerts (halt_hit is wired directly in
 * journal/server.ts's openTrade; position_flattened is wired in
 * mirrorClosedPaperTrades above). Both dedupe server-side by their own key
 * (setup: per candidate id; news: per calendar event), so calling this every
 * 30s poll is correct and produces at most one notification each.
 */
function raiseDeskAlerts(desk: DeskPayload): void {
  // EVERY high-prob card whose own book and side the sequence calls TAKE.
  // This took only the first high-prob card, so a TAKE on the other book
  // never beeped; and it pushed "setup armed" to the phone with no TAKE
  // check at all — a buzz for a card the desk was standing down.
  const root = (s: string) => s.replace(/^M/, "");
  const takes = desk.scan.candidates.filter((c) => {
    if (!isHighProbPath(c)) return false;
    const book = [desk.smcMaster.left, desk.smcMaster.right].find(
      (b) => root(b.symbol) === root(c.symbol),
    );
    return book?.word === "TAKE" && book.side === c.side;
  });
  for (const armed of takes) {
    considerPathAlarm(desk, armed);
    void raiseSetupArmedAlert({
      data: {
        symbol: armed.symbol,
        side: armed.side,
        candidateId: armed.id,
        grade: armed.pathBand || armed.grade,
        confluence: armed.confluence,
        killzone: desk.clock.killzone,
      },
    }).catch(() => undefined);
  }

  const next = desk.news.nextEvent;
  if (next && next.impact === "high" && next.minutesAway >= 0 && next.minutesAway <= 20) {
    void raiseNewsBlackoutAlert({
      data: {
        startsAt: `${next.date}T${next.timeEt}`,
        event: next.name,
        impact: next.impact,
      },
    }).catch(() => undefined);
  }

  // The 3 scheduled summaries (checklist/review/weekly) — see
  // trigger-server.ts's header for why this is a client poll, not a real
  // cron, and what that trades away.
  void checkScheduledJobs().catch(() => undefined);
}

function quoteDelayMs(
  left: { source: string; lagSec: number },
  right: { source: string; lagSec: number },
): number {
  const live =
    (left.source === "live_gateway" && left.lagSec <= 5) ||
    (right.source === "live_gateway" && right.lagSec <= 5);
  return live ? QUOTE_LIVE_MS : QUOTE_YAHOO_MS;
}

/**
 * The 1-2s quote poll, patched onto the desk the 20s build produced.
 *
 * 2026-09-23: this is the door the server-side synthetic guard does NOT
 * close. `loadQuote` (fetch-dual.ts) falls back to `syntheticQuote()` — a
 * hardcoded constant stamped `lagSec: 0` — and while `fetchDualIndexes`
 * checks `source !== "synthetic"` before using it, `fetchLiveQuotes` returns
 * it straight through. So every one to two seconds the client could write
 * that constant into `desk.quotes` AND, via applyQuoteToLastBar, into the
 * last BAR — re-injecting it into the very payload build-desk had just
 * gated, at zero apparent lag.
 *
 * A synthetic quote is not a price. Refusing it here keeps the previous
 * real one and its real (growing) lag, which is what the freshness gates
 * are built to read.
 */
function patchDeskQuotes(
  prev: DeskPayload,
  leftQ: DeskPayload["quotes"]["left"],
  rightQ: DeskPayload["quotes"]["right"],
): DeskPayload {
  if (leftQ.source === "synthetic" || rightQ.source === "synthetic") return prev;
  const leftBars = applyQuoteToLastBar(prev.left.bars, leftQ, prev.left.interval);
  const rightBars = applyQuoteToLastBar(prev.right.bars, rightQ, prev.right.interval);
  const left = stampSeriesFromBars(prev.left, leftBars);
  const right = stampSeriesFromBars(prev.right, rightBars);
  left.price = leftQ.price;
  left.changePct = leftQ.changePct;
  left.marketTimeMs = leftQ.marketTimeMs;
  left.marketTimeIso = leftQ.marketTimeIso;
  right.price = rightQ.price;
  right.changePct = rightQ.changePct;
  right.marketTimeMs = rightQ.marketTimeMs;
  right.marketTimeIso = rightQ.marketTimeIso;
  const next: DeskPayload = {
    ...prev,
    quotes: { left: leftQ, right: rightQ },
    left,
    right,
  };
  next.liveSays = buildLiveSays(next);
  return next;
}

function managePricesFromDesk(desk: DeskPayload): Record<string, ManagePrice> {
  const prices: Record<string, ManagePrice> = {
    [desk.left.symbol]: {
      last: desk.quotes.left.price,
      high: desk.quotes.left.price,
      low: desk.quotes.left.price,
      lagSec: desk.quotes.left.lagSec,
    },
    [desk.right.symbol]: {
      last: desk.quotes.right.price,
      high: desk.quotes.right.price,
      low: desk.quotes.right.price,
      lagSec: desk.quotes.right.lagSec,
    },
  };
  if (desk.left.symbol === "ES") prices.MES = prices[desk.left.symbol]!;
  if (desk.right.symbol === "ES") prices.MES = prices[desk.right.symbol]!;
  if (desk.left.symbol === "NQ" || desk.left.symbol === "MNQ") {
    prices.MNQ = prices[desk.left.symbol]!;
    prices.NQ = prices[desk.left.symbol]!;
  }
  if (desk.right.symbol === "NQ" || desk.right.symbol === "MNQ") {
    prices.MNQ = prices[desk.right.symbol]!;
    prices.NQ = prices[desk.right.symbol]!;
  }
  return prices;
}

type DeskCategory =
  | "news"
  | "predict"
  | "mead"
  | "discuss"
  | "floor"
  | "brain"
  | "learn"
  | "invest"
  | "trade"
  | "swing"
  | "path"
  | "backtest"
  | "tape"
  | "risk"
  | "lab";

const CATEGORIES: {
  id: DeskCategory;
  label: string;
  short: string;
  hint: string;
  icon: typeof Crosshair;
}[] = [
  {
    id: "trade",
    label: "Now",
    short: "Now",
    hint: "Draw · PATH · paper",
    icon: Crosshair,
  },
  // Beside Now because the day's schedule is the first thing a session needs:
  // what releases, which heavyweights report, and what the tape just heard.
  {
    id: "news",
    label: "News",
    short: "News",
    hint: "Schedule · headlines · filings",
    icon: Newspaper,
  },
  {
    id: "swing",
    label: "Options",
    short: "Opt",
    hint: "QQQ/SPY · $1k · 15%",
    icon: Layers,
  },
  // Event contracts (Robinhood / Kalshi): its own clock — minutes to a game.
  {
    id: "predict",
    label: "Predict",
    short: "Pred",
    hint: "PM analyzer · Mead Hall + desk · paper",
    icon: Percent,
  },
  // "mead" is no longer its own tab: the Mead Hall lives at the top of the
  // Predict analyzer. The id stays as an alias (ledger:open-tab "mead" → Predict).
  {
    id: "tape",
    label: "Charts",
    short: "Tape",
    hint: "MNQ/ES · levels",
    icon: LineChart,
  },
  {
    id: "brain",
    label: "Brain",
    short: "Brain",
    hint: "TAKE / STAND",
    icon: Brain,
  },
  // Its own tab (trader's call 2026-09-28): 6 fixed ET checkpoints where Grok
  // and Claude read the same snapshot independently, then each reply once —
  // a confidence check beside Brain's on-demand coach, never a gate.
  {
    id: "discuss",
    label: "Discuss",
    short: "Talk",
    hint: "Grok + Claude · 6 checkpoints",
    icon: MessagesSquare,
  },
  // The 3D room (2026-10-04): five SMC personalities trade a PAPER QQQ/SPY
  // 0–1 DTE book off this desk's own cards and gates — a way to watch the
  // desk think, never a gate and never a broker.
  {
    id: "floor",
    label: "Floor",
    short: "Floor",
    hint: "3D room · 5 desks · paper QQQ/SPY",
    icon: Building2,
  },
  {
    id: "path",
    label: "Book",
    short: "Book",
    hint: "WR · journal · BT",
    icon: TrendingUp,
  },
  {
    id: "lab",
    label: "Lab",
    short: "Lab",
    hint: "Risk · rules · replay",
    icon: FlaskConical,
  },
  // Years, not minutes. Sits beside Learn because both are read between
  // sessions rather than during one — and because putting a five-year book
  // next to the PATH board is how a hold becomes a trade.
  {
    id: "invest",
    label: "Invest",
    short: "Inv",
    hint: "Shares · sweep · 2035",
    icon: Landmark,
  },
  // Last on purpose: the only tab that is not opened during a live session.
  {
    id: "learn",
    label: "Learn",
    short: "Learn",
    hint: "SMC · sequence · discretion",
    icon: GraduationCap,
  },
];

/** TAKE-hold state for word-hysteresis.ts — lives for the tab's lifetime. */
const wordHold = createHysteresisState();

function MasterplacePage() {
  const [desk, setDesk] = useState<DeskPayload | null>(null);
  const publishDesk = useDeskSynapse((s) => s.publishDesk);
  const publishRisk = useDeskSynapse((s) => s.publishRisk);
  const publishRiskGate = useDeskSynapse((s) => s.publishRiskGate);
  const publishMemory = useDeskSynapse((s) => s.publishMemory);
  const memoryBook = useDeskSynapse((s) => s.memory);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // Hydration guard for brainSnap below. `typeof window !== "undefined"` is
  // NOT sufficient here — it's already true on the client's very FIRST
  // render, before React has reconciled against the server HTML. So the SSR
  // pass reads no memory (no window), and the client's first paint reads
  // real localStorage, and their text output differs -> React error #418.
  // Gating on a useEffect-set flag instead means the client's first paint
  // matches the server's exactly (no memory either), and the real,
  // localStorage-derived numbers arrive one tick later via a normal
  // re-render, which is allowed to differ.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  // SSR-safe header numbers: default until mounted (matches the server paint),
  // real localStorage-backed values one tick later. Fixes React #418 — the
  // store seeds memory from localStorage at creation, so the client's first
  // render otherwise differs from the server's.
  const paper = getPaperAccount(mounted ? memoryBook : emptyDeskMemory());
  const [wallNow] = useState(() => formatUtcClock(Date.now()));
  const [cat, setCat] = useState<DeskCategory>("trade");
  // DEV capture only — Accuracy attachment re-render (set after mount: SSR-safe).
  const [captureMead, setCaptureMead] = useState(false);
  useEffect(() => {
    if (isMeadCapture()) {
      setCaptureMead(true);
      setCat("mead");
      setLoading(false);
    }
  }, []);
  // "Open Mead Hall" on the Predict tab asks for a tab by id (a window event, so Predict needs no prop).
  useEffect(() => {
    const on = (e: Event) => {
      const id = (e as CustomEvent<string>).detail;
      if (id === "mead") setCat("predict");
      else if (CATEGORIES.some((c) => c.id === id)) setCat(id as DeskCategory);
    };
    window.addEventListener("ledger:open-tab", on);
    return () => window.removeEventListener("ledger:open-tab", on);
  }, []);
  // The trading floor runs one paper cycle per desk refresh on every tab, so
  // its level stops and 11:00 time exit fire with the Floor tab closed.
  useRoomEngine(desk);
  const [risk, setRisk] = useState<RiskState | null>(null);
  const [equity, setEquity] = useState<number>(() => getPaperAccount().equity);
  const [logCandidate, setLogCandidate] = useState<SetupCandidate | null>(null);
  const [paperToast, setPaperToast] = useState<string | null>(null);
  const [lastPaperClosed, setLastPaperClosed] = useState<PaperTrade | null>(null);
  const [logMode, setLogMode] = useState<"paper" | "live">("paper");
  const deskRef = useRef<DeskPayload | null>(null);

  // Four states, so the entry gate cannot fail OPEN while loading OR when the
  // governor cannot be reached: a user genuinely halted from a prior session
  // must not see a green light during the load window on refresh, nor when a
  // risk read times out. "no-session" (signed-out preview) has no governor at
  // all, so it falls back to allowed — the server still authoritatively
  // rejects the write either way — and it is ONLY set on a genuine signed-out
  // answer ("Unauthorized"). A timeout / transport / DB error is "unknown":
  // entry blocked, last-known risk kept, and the banner says since when.
  // See src/lib/trading/desk-fetch-guard.ts.
  const [riskFetchState, setRiskFetchState] = useState<RiskFetchState>("loading");
  /** First failed risk read of the current outage (ms). null while the governor answers. */
  const [riskUnknownSince, setRiskUnknownSince] = useState<number | null>(null);
  /** Newest loadRisk call owns the gate; an older, slower answer is dropped. */
  const riskSeq = useRef(0);

  // Real per-strategy sizing/verdict factor from journal/discretion.ts — see
  // that file for what feeds it. null while loading or signed out; every
  // consumer must go through discretionFor(), which degrades to neutral
  // (×1.0) rather than block on a miss.
  const [discretion, setDiscretion] = useState<DiscretionPayload | null>(
    null,
  );

  const loadRisk = useCallback(async () => {
    const seq = ++riskSeq.current;
    // Each read is bounded on its own budget (a wedged Neon connect must not
    // hold the gate in "loading" forever) and settled separately: the
    // GOVERNOR (getRiskState) alone decides the gate state. A discretion or
    // settings miss degrades discretion to neutral; it never flips the gate.
    const [outcome, , discR] = await Promise.all([
      readRiskGoverned(() => getRiskState(), RISK_CLIENT_TIMEOUT_MS),
      withClientTimeout(getSettings(), RISK_CLIENT_TIMEOUT_MS, "Settings").catch(() => null),
      withClientTimeout(getDiscretionState(), RISK_CLIENT_TIMEOUT_MS, "Discretion").then(
        (v) => ({ ok: true as const, v }),
        () => ({ ok: false as const }),
      ),
    ]);
    if (seq !== riskSeq.current) return null; // a newer read owns the gate
    // Paper book equity is client desk-memory — never overwrite with server settings $100k
    setEquity(getPaperAccount().equity);
    if (outcome.state === "ok") {
      const rs = outcome.risk;
      publishRisk(rs);
      setRisk(rs);
      setDiscretion(discR.ok ? discR.v : null);
      setRiskFetchState("ok");
      setRiskUnknownSince(null);
      return rs;
    }
    if (outcome.state === "no-session") {
      // The server SAID nobody is signed in — the preview has no governor.
      // `risk` is deliberately NOT cleared: if this session already saw a
      // halt, riskEntryAllowed keeps entry blocked on it (re-review S7), and
      // the synapse keeps its "Risk halt" veto.
      setRiskFetchState("no-session");
      setRiskUnknownSince(null);
      setDiscretion(null);
      return null;
    }
    // Timeout / transport / DB: we do not know. Fail CLOSED. Do NOT publish
    // null — the synapse keeps the last-known risk (and its "Risk halt" veto),
    // `risk` keeps the last answer, and entry is blocked until the governor
    // answers again.
    setRiskFetchState("unknown");
    setRiskUnknownSince((prev) => prev ?? Date.now());
    return null;
  }, [publishRisk]);

  // Mirror the gate into the synapse so the brain/posture/feeds know when
  // `risk` is only last-known (re-review S4: "Risk unknown" veto).
  useEffect(() => {
    publishRiskGate(riskFetchState);
  }, [riskFetchState, publishRiskGate]);

  const entryAllowed = riskEntryAllowed(riskFetchState, risk);
  const entryBlockedReason = riskEntryBlockedReason(
    riskFetchState,
    risk,
    riskUnknownSince,
  );

  /**
   * Everything a scanner card needs to draw its OWN setup, keyed by symbol.
   *
   * The scanner has never held bars, a quote or the live sequence, and it must
   * not start fetching them: this route already has all three on the desk
   * payload, and a second read could produce a chart that disagrees with the
   * grade printed beside it. So they are handed down, from the same objects
   * the gate is computed from — quotes for `live` versus `armed`, the
   * narrative's pools for the raid that has to happen, smc-master for the
   * entry array and the layers already failed for the session.
   *
   * Memoised on `desk` alone. The scanner recomputes each card's anticipation
   * from this object, so a new identity every render would defeat that memo on
   * a list that repaints every 20 seconds.
   */
  const scannerTape = useMemo((): Record<string, CardTape> | undefined => {
    if (!desk) return undefined;
    const book = (side: "left" | "right"): CardTape => {
      const liq = desk.narrative[side].liquidity;
      const m = desk.smcMaster?.[side];
      return {
        bars: desk[side].bars,
        // The ladder's minute series, so the card's chart can offer 1m and 5m
        // without a second fetch. Roughly the last 8h; `seriesFor` states that
        // on the chart rather than letting a short window read as a long one.
        minute: desk.mtf?.[side]?.minute,
        price: desk.quotes[side].price ?? null,
        draw: desk.draws[side].primary,
        // The whole read, so a spent card can be offered a continuation or a
        // reversal candidate instead of a stale plan.
        draws: desk.draws[side],
        // The ladder for this book, for the directional cross-check.
        ladder: desk.ladder?.[side] ?? null,
        pools: {
          bsl: liq.nearestBsl,
          ssl: liq.nearestSsl,
          lastSide: liq.lastSweep,
          lastLevel: liq.lastSweepLevel,
        },
        sequence: m
          ? {
              side: m.side,
              zone: m.plan?.entryZone ?? null,
              dead: m.layers.filter((l) => l.state === "fail").map((l) => l.id),
              // The verdict and every layer grade, carried whole. The markup
              // must never recompute this: the canon stack it used to count
              // has five musts where smc-master gates on nine.
              word: m.word,
              mustPass: m.mustPass,
              mustNeed: m.mustNeed,
              states: Object.fromEntries(m.layers.map((l) => [l.id, l.state])),
              // Numerics the markup draws from. `dealing` is the range the
              // pd_half layer graded against; `plan` is the only source of a
              // priced entry and stop — the chart never derives either.
              dealing: m.dealing
                ? { high: m.dealing.high, low: m.dealing.low, eq: m.dealing.eq }
                : null,
              plan: m.plan
                ? {
                    entry: m.plan.entry,
                    stop: m.plan.stop,
                    entryZone: m.plan.entryZone ?? null,
                    t1: m.plan.t1 ?? null,
                  }
                : null,
            }
          : null,
      };
    };
    // Both books keyed by symbol. When one book is charted twice (same symbol
    // on both sides is not a state the desk builds) the later write wins, and
    // it is the same tape either way.
    return {
      [desk.left.symbol]: book("left"),
      [desk.right.symbol]: book("right"),
    };
  }, [desk]);

  /**
   * THE CENSUS — one row per book per poll.
   *
   * The 63-day replay prints zero takes on closed 15m bars, and nobody knows
   * whether that is a tight gate or the wrong clock. This records what the
   * sequence actually said on the LIVE poll, with the quote's age beside it,
   * so the question stops being a debate. `take-census.ts` fixed the
   * thresholds and the conclusions before this line existed.
   *
   * Keyed on `desk.fetchedAt`, so it fires once per desk refresh and not once
   * per render — a census that counted renders would measure the render rate.
   * Writes are swallowed inside recordPoll: a full quota costs a measurement,
   * never a session.
   */
  useEffect(() => {
    if (!desk) return;
    const t = Date.parse(desk.fetchedAt);
    if (!Number.isFinite(t)) return;
    const session = new Date(t).toLocaleDateString("en-CA", {
      timeZone: "America/New_York",
    });
    for (const side of ["left", "right"] as const) {
      const m = desk.smcMaster?.[side];
      if (!m) continue;
      const q = desk.quotes[side];
      recordPoll({
        t,
        session,
        symbol: desk[side].symbol,
        side: m.side ?? null,
        word: m.word,
        mustPass: m.mustPass,
        mustNeed: m.mustNeed,
        // The FIRST layer not passing — the thing being waited on.
        missingLayer: m.layers.find((l) => l.state !== "pass")?.id ?? null,
        lagSec: q?.lagSec ?? 9_999,
        source: q?.source ?? "unknown",
        // The scanner's number for THIS book, when the scan has one. Recorded
        // as a cross-reference only: the census is about the sequence WORD,
        // and a high score beside a STAND is exactly the disagreement worth
        // being able to look up later.
        confluence:
          desk.scan?.candidates?.find(
            (c) => c.symbol === desk[side].symbol && c.side === m.side,
          )?.confluence ?? null,
      });
    }
  }, [desk?.fetchedAt]);

  // D1 — the record used to split: paper works signed-OUT (localStorage) while
  // the mirror needs auth, so trades logged before signing in never reached
  // desk_trades. Backfill on mount and on every paper-book change; the server
  // side is idempotent, and syncPaperBookToDb never throws when signed out.
  useEffect(() => {
    const sync = () => void syncPaperBookToDb().catch(() => undefined);
    sync();
    if (typeof window === "undefined") return;
    window.addEventListener("ledger-paper", sync);
    return () => window.removeEventListener("ledger-paper", sync);
  }, []);

  // One desk build in flight at a time. The quote poll below already guards
  // this; the desk poll never did, so when a build ran past the 20s cadence
  // the next tick fired anyway and invocations stacked — each a full market
  // fetch, each slower than the last, until the edge timed one out.
  const deskInFlight = useRef(false);

  const load = useCallback(async () => {
    // DEV capture only — Accuracy attachment re-render: no desk fetch.
    if (isMeadCapture()) {
      setLoading(false);
      return;
    }
    if (deskInFlight.current) return;
    deskInFlight.current = true;
    setLoading(true);
    // The error is cleared on the next SUCCESS, not at the start of a retry,
    // so the "Desk stale" strip stays up while the retry is in flight.
    try {
      // Desk and risk used to share one Promise.all with no client timeout:
      // a hung getRiskState (Neon connect) or fetchTradingDesk left
      // loading=true / desk=null forever ("Building desk…") and deskInFlight
      // blocked every retry. Risk now runs on its own (bounded inside
      // loadRisk, which publishes to the synapse itself on success) and the
      // desk never waits on it. publishDesk below gets NO risk argument, so
      // the synapse keeps whatever risk it last had — a slow or failed risk
      // read can never wipe a known halt.
      void loadRisk();
      const res = await withClientTimeout(
        fetchTradingDesk({
          data: { left: "MNQ", right: "ES" },
        }),
        DESK_CLIENT_TIMEOUT_MS,
        "Desk build",
      );
      if (!res.ok) {
        setError(res.error);
      } else {
        // A printed TAKE holds through the array edge (word-hysteresis.ts)
        // before anything downstream reads the word.
        const held = applyWordHysteresis(res, wordHold);
        deskRef.current = held; // the quote poll patches from the newest build
        setDesk(held);
        setError(null);
        // No risk arg: keep the synapse's last-known risk (desk-synapse.ts
        // publishDesk keeps get().risk when risk is undefined).
        publishDesk(held);
        try {
          reconcilePaperBookToMemory();
        } catch {
          /* */
        }
        publishMemory();
        setEquity(getPaperAccount().equity);
        recordArmedShadow(held, getPaperAccount().equity);
        observeAndTickGhosts(held);
        // The refusals, paper-traded: opens the shadow legs for any PATH card
        // the sequence turned down and ticks the open ones on this build.
        try {
          observeShadowBook(held);
        } catch {
          /* never blocks the desk */
        }
        raiseDeskAlerts(held);
        // The touch is the moment worth being called to the screen: every
        // must-layer already passing and price now at the plan's price.
        try {
          considerEntryAlarm(held);
        } catch {
          /* */
        }
        try {
          const toast = fillRestingLimits(held);
          if (toast) setPaperToast(toast);
        } catch {
          /* */
        }
        maybeAutofire(held, getPaperAccount().equity);
      }
    } catch (e) {
      setError(describeDeskError(e));
    } finally {
      deskInFlight.current = false;
      setLoading(false);
    }
  }, [loadRisk, publishDesk]);

  // Pull the shadow ledger (other devices, other days) and the replay seed
  // once; the poll loop keeps it current from there.
  useEffect(() => {
    void hydrateShadowBook();
  }, []);

  useEffect(() => {
    // Boot: one-shot reconcile closed paper → memory (no event loop)
    try {
      reconcilePaperBookToMemory();
    } catch {
      /* */
    }
    publishMemory();
    setEquity(getPaperAccount().equity);

    // Memory updates only refresh UI — do NOT re-enter reconcile
    const onMemory = () => {
      publishMemory();
      setEquity(getPaperAccount().equity);
    };
    // Paper book changes: reconcile once then refresh
    const onPaper = () => {
      try {
        reconcilePaperBookToMemory();
      } catch {
        /* */
      }
      publishMemory();
      setEquity(getPaperAccount().equity);
    };
    window.addEventListener("ledger-memory", onMemory);
    window.addEventListener("ledger-paper", onPaper);
    window.addEventListener("focus", onPaper);
    return () => {
      window.removeEventListener("ledger-memory", onMemory);
      window.removeEventListener("ledger-paper", onPaper);
      window.removeEventListener("focus", onPaper);
    };
  }, [publishMemory]);

  // Auto-learn 2024 year study into brain rates (once)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const seed = await fetchYearStudySeed(2024);
      if (!seed || cancelled) return;
      // Force once when full year available so rates replace thin samples
      const force = (seed.monthsRun ?? 0) >= 12;
      hydrateFromYearStudy(seed, { force, applyEquity: false });
      publishMemory();
      setEquity(getPaperAccount().equity);
      window.dispatchEvent(new Event("ledger-memory"));
    })();
    return () => {
      cancelled = true;
    };
  }, [publishMemory]);

  // Keep React equity in sync with persistent paper book
  useEffect(() => {
    setEquity(paper.equity);
  }, [paper.equity]);

  useEffect(() => {
    deskRef.current = desk;
  }, [desk]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    // Rebuild just after candles close (desk-cadence.ts), not on a
    // free-running timer that could sit on a closed candle for ~20s.
    let id = 0;
    const schedule = () => {
      id = window.setTimeout(() => {
        if (document.visibilityState === "visible") void load();
        schedule();
      }, msUntilNextDeskPoll());
    };
    schedule();
    // The quote-poll effect below already does this (calls tick() the
    // instant the tab becomes visible again); without it, returning to a
    // backgrounded tab would show a stale desk build until the next
    // scheduled rebuild while the quotes above it were already live.
    const onVis = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.clearTimeout(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [load]);

  useEffect(() => {
    if (!desk) return;
    let cancelled = false;
    let inFlight = false;
    let delay = QUOTE_YAHOO_MS;
    let timer: number | null = null;

    const applyPaper = (next: DeskPayload) => {
      if (!listOpenPaperTrades().length) return;
      const { closed } = managePaperTradesAgainstPrice(managePricesFromDesk(next), {
        draws: {
          [next.left.symbol]: next.draws.left,
          [next.right.symbol]: next.draws.right,
        },
        bars15: {
          [next.left.symbol]: next.left.bars,
          [next.right.symbol]: next.right.bars,
        },
      });
      if (!closed.length) return;
      mirrorClosedPaperTrades(closed);
      const last = closed[closed.length - 1]!;
      setLastPaperClosed(last);
      setPaperToast(
        `PAPER OUT · ${last.displaySymbol} ${last.exitReason} · R ${last.rMultiple?.toFixed(2)} · $${last.pnlUsd?.toFixed(0)}`,
      );
      setEquity(getPaperAccount().equity);
      window.setTimeout(() => setPaperToast(null), 8000);
    };

    const tick = async () => {
      if (cancelled || inFlight || document.visibilityState === "hidden") return;
      inFlight = true;
      try {
        const res = await withClientTimeout(
          fetchLiveQuotes({
            data: { left: "MNQ", right: "ES" },
          }),
          QUOTE_CLIENT_TIMEOUT_MS,
          "Quotes",
        );
        if (!res.ok || cancelled) return;
        delay = quoteDelayMs(res.left, res.right);
        // Every print feeds the ladder's 30s rung (print-bars.ts).
        recordPrint(res.left.symbol, res.left.price, res.left.marketTimeMs);
        recordPrint(res.right.symbol, res.right.price, res.right.marketTimeMs);
        // The patch is computed from the LATEST desk (deskRef) and every
        // side effect runs here, in the poll — NOT inside a setDesk updater.
        // React runs updaters while rendering MasterplacePage, so the ghost
        // book's notify (and the paper/alarm/shadow writes) inside one fired
        // SessionHud's setState mid-render: "Cannot update a component
        // (SessionHud) while rendering a different component
        // (MasterplacePage)". Same calls, same order, same desk — just outside
        // render (and no longer double-run by StrictMode's updater replay).
        const prev = deskRef.current;
        if (!prev) return;
        const next = applyWordHysteresis(patchDeskQuotes(prev, res.left, res.right), wordHold);
        deskRef.current = next;
        setDesk(next);
        {
          try {
            observeAndTickGhosts(next);
          } catch {
            /* */
          }
          try {
            // The hesitation ledger: record the instant the desk says now
            // (take-moments.ts), and resolve older moments on the desk's own
            // bars — minute tape when the gateway is up, else the 15m.
            observeTakeMoments([next.smcMaster.left, next.smcMaster.right], {
              [next.left.symbol]: next.quotes.left.price,
              [next.right.symbol]: next.quotes.right.price,
            });
            tickMomentOutcomes({
              [next.left.symbol]: next.mtf?.left?.minute?.length ? next.mtf.left.minute : next.left.bars,
              [next.right.symbol]: next.mtf?.right?.minute?.length ? next.mtf.right.minute : next.right.bars,
            });
          } catch {
            /* the ledger must never break the quote poll */
          }
          try {
            observeShadowBook(next);
          } catch {
            /* */
          }
          try {
            const toast = fillRestingLimits(next);
            if (toast) setPaperToast(toast);
          } catch {
            /* a pending fill must never break the quote poll */
          }
          try {
            // THE TOUCH ALARM BELONGS ON THIS CLOCK, NOT THE 20s ONE.
            //
            // It was only evaluated in the desk poll, so with the gateway
            // delivering a print every second the desk checked "is price at
            // CE" twenty times less often than it knew. A wick into the array
            // and back out inside one 20s window — ordinary at the open —
            // filled a resting limit (that already ticked here) while never
            // calling the trader to the screen. The alarm is the mechanism
            // for the case where there is no resting order, which is most of
            // them, so it was the slow half of exactly the wrong pair.
            //
            // Cheap to run: it exits on the first guard unless armed, and
            // dedupes per plan per day, so 1,170 polls a session still make
            // at most one beep per plan.
            considerEntryAlarm(next);
          } catch {
            /* an alarm must never break the quote poll */
          }
        }
        applyPaper(next);
      } catch {
        /* keep last quotes */
      } finally {
        inFlight = false;
      }
    };

    const loop = () => {
      if (cancelled) return;
      timer = window.setTimeout(() => {
        void tick().finally(() => {
          if (!cancelled) loop();
        });
      }, delay);
    };

    void tick().finally(() => {
      if (!cancelled) loop();
    });
    const onVis = () => {
      if (document.visibilityState === "visible") void tick();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      cancelled = true;
      if (timer != null) window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVis);
    };
    // Start once a desk exists; do not reset on every quote patch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [desk ? "ready" : "boot"]);

  // Paper open/close → brain + synapse memory refresh
  useEffect(() => {
    const sync = () => {
      try {
        getDeskSynapse().publishMemory();
      } catch {
        /* */
      }
      setEquity(getPaperAccount().equity);
    };
    window.addEventListener("ledger-paper", sync);
    window.addEventListener("ledger-memory", sync);
    return () => {
      window.removeEventListener("ledger-paper", sync);
      window.removeEventListener("ledger-memory", sync);
    };
  }, []);
  /**
   * STAGE 0 — the pre-filled trade note.
   *
   * `src/data/trade-log.json` has ONE row against 2,188 backtested trades, and
   * the reason is friction, not discipline: logging meant hand-typing twenty
   * fields after the session about a trade already over. The live book is on
   * Robinhood, which has no API this desk can reach, so the fix is to write
   * the note FOR the trader and leave blank only what the desk cannot know.
   *
   * The numeric plan comes from smcMaster, matched by symbol AND side — the
   * board grades two books and picking the wrong one would write levels from
   * the other instrument into the log, which is worse than no note at all.
   */
  const noteFor = useCallback(
    (c: SetupCandidate) => {
      const books = [desk?.smcMaster?.left, desk?.smcMaster?.right];
      const book = books.find((b) => b?.symbol === c.symbol && b?.side === c.side) ?? null;
      return buildTradeNote({
        symbol: c.symbol,
        side: c.side === "short" ? "short" : "long",
        // The live sleeve expresses these through QQQ/SPY options; the futures
        // note is the same shape minus the option legs.
        book: "options",
        underlier: c.symbol === "ES" ? "SPY" : "QQQ",
        plan: book?.plan ?? null,
        deskWord: book?.word ?? null,
        layers: book?.layers ?? null,
        grade: String(c.pathBand ?? c.grade ?? ""),
        killzone: desk?.clock?.killzone ?? null,
      });
    },
    [desk],
  );


  const onLog = useCallback(
    (c: SetupCandidate, mode: "paper" | "live") => {
      if (mode === "paper") {
        // Real measured-edge multiplier (journal/discretion.ts), carried on
        // the resting order so the eventual fill is sized with it.
        const disc = discretionFor(
          discretion,
          c.completeStrategy || c.strategyPrimary,
        );
        const res = restPaperLimit(c, disc.factor);
        if (res.ok) {
          if (!res.already) markTakeAction(c.symbol, c.side === "short" ? "short" : "long", "rested");
          const o = res.order;
          setPaperToast(
            `${res.already ? "PAPER LIMIT ALREADY RESTING" : "PAPER LIMIT RESTING"} · ${c.symbol} ${c.side.toUpperCase()} @ ${o.limit.toFixed(2)} (CE) · SL ${o.stop.toFixed(2)}` +
              (o.t1 != null ? ` · T1 ${o.t1.toFixed(2)}` : "") +
              ` · fills on the touch, expires in ${Math.round((o.expiresAt - Date.now()) / 60_000)}m` +
              (disc.factor !== 1.0
                ? ` · discretion ×${disc.factor.toFixed(2)} (${disc.verdict}, n=${disc.effectiveN.toFixed(0)})`
                : ""),
          );
        } else {
          setPaperToast(`Paper not rested: ${res.error}`);
        }
        window.setTimeout(() => setPaperToast(null), 7000);
        return;
      }
      setLogMode(mode);
      setLogCandidate(c);
    },
    [desk, discretion],
  );

  // Auto paper: same onLog("paper") path as the Trade Now button, so equity,
  // desk-memory stats, debrief, journal mirror, and the veteran brain all
  // see the fill. Gate lives in autoPaperShouldTake (NY AM, PATH A+/A/A−).
  useEffect(() => {
    if (!desk) return;

    const tryAuto = () => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") {
        return;
      }
      const pick = autoPaperShouldTake(desk);
      if (!pick.take) {
        if (pick.skip) noteAutoPaperSkip(pick.skip);
        return;
      }
      const band = pick.take.pathBand || pick.take.grade;
      rememberAutoPaperKey(
        pick.take,
        `${pick.take.symbol} ${pick.take.side} ${band}`,
      );
      onLog(pick.take, "paper");
      // Success is an order resting at CE (or already filled), not an
      // instant open — the fill arrives through fillRestingLimits.
      if (!restingFor(pick.take.symbol) && listOpenPaperTrades().length === 0) {
        releaseAutoPaperKey();
        noteAutoPaperSkip("Paper limit not rested");
      }
    };

    tryAuto();
    document.addEventListener("visibilitychange", tryAuto);
    return () => document.removeEventListener("visibilitychange", tryAuto);
  }, [desk, onLog]);

  useEffect(() => {
    if (!desk) return;
    // Last print only — HTF bar H/L false-stops new paper trades.
    // `lagSec` rides along so paper-manager's freshness gate can refuse to
    // book a fill against a quote the desk itself would not let you ENTER on.
    const prices: Record<string, ManagePrice> = {
      [desk.left.symbol]: {
        last: desk.quotes.left.price,
        high: desk.quotes.left.price,
        low: desk.quotes.left.price,
        lagSec: desk.quotes.left.lagSec,
      },
      [desk.right.symbol]: {
        last: desk.quotes.right.price,
        high: desk.quotes.right.price,
        low: desk.quotes.right.price,
        lagSec: desk.quotes.right.lagSec,
      },
    };
    // micros / aliases so MES/MNQ paper books match ES/NQ prints
    if (desk.left.symbol === "ES") prices.MES = prices[desk.left.symbol]!;
    if (desk.right.symbol === "ES") prices.MES = prices[desk.right.symbol]!;
    if (desk.left.symbol === "NQ" || desk.left.symbol === "MNQ") {
      prices.MNQ = prices[desk.left.symbol]!;
      prices.NQ = prices[desk.left.symbol]!;
    }
    if (desk.right.symbol === "NQ" || desk.right.symbol === "MNQ") {
      prices.MNQ = prices[desk.right.symbol]!;
      prices.NQ = prices[desk.right.symbol]!;
    }
      const drawCtx = {
        draws: {
          [desk.left.symbol]: desk.draws.left,
          [desk.right.symbol]: desk.draws.right,
        },
        bars15: {
          [desk.left.symbol]: desk.left.bars,
          [desk.right.symbol]: desk.right.bars,
        },
      };
    const { closed } = managePaperTradesAgainstPrice(prices, drawCtx);
    if (closed.length) {
      mirrorClosedPaperTrades(closed);
      reconcilePaperBookToMemory();
      publishMemory();
      const last = closed[closed.length - 1]!;
      setLastPaperClosed(last);
      setPaperToast(
        `PAPER OUT · ${last.displaySymbol} ${last.exitReason} · R ${last.rMultiple?.toFixed(2)} · $${last.pnlUsd?.toFixed(0)}`,
      );
      setEquity(getPaperAccount().equity);
      window.setTimeout(() => setPaperToast(null), 8000);
    }
  }, [desk?.fetchedAt, desk?.quotes.left.price, desk?.quotes.right.price]);
  // REMOVED 2026-09-23. This effect ran `closeOpenAtStructureLow(7763, ...)` on
  // every quote tick with marks for BOTH books. 7763 was one session's ES low,
  // hardcoded, left in the permanent poll loop — and because the old function
  // closed a LONG whenever its mark sat above the level, an MNQ long at 30,800
  // satisfied `30800 >= 7762.75` and was flattened at its own mark the instant
  // it opened, booked as a structure take-profit. Every long on either book,
  // every session. See closeOpenAtStructureLevel in paper-manager.ts. A real
  // version of this belongs on the plan's own T1, per book, not on a constant
  // typed in during one afternoon.

  // Backup paper manage — quote tick is the fast path. This only exists so a
  // hung Yahoo poll cannot leave a stop unfilled for 20s. Reads deskRef so it
  // never closes over a stale quote.
  useEffect(() => {
    const id = window.setInterval(() => {
      const d = deskRef.current;
      if (!d || document.visibilityState !== "visible") return;
      if (!listOpenPaperTrades().length) return;
      const { closed } = managePaperTradesAgainstPrice(managePricesFromDesk(d), {
        draws: {
          [d.left.symbol]: d.draws.left,
          [d.right.symbol]: d.draws.right,
        },
        bars15: {
          [d.left.symbol]: d.left.bars,
          [d.right.symbol]: d.right.bars,
        },
      });
      if (!closed.length) return;
      mirrorClosedPaperTrades(closed);
      const last = closed[closed.length - 1]!;
      setLastPaperClosed(last);
      setPaperToast(
        `PAPER OUT · ${last.displaySymbol} ${last.exitReason} · R ${last.rMultiple?.toFixed(2)} · $${last.pnlUsd?.toFixed(0)}`,
      );
      setEquity(getPaperAccount().equity);
      window.setTimeout(() => setPaperToast(null), 8000);
    }, 3_000);
    return () => window.clearInterval(id);
  }, []);

  const active = CATEGORIES.find((c) => c.id === cat) ?? CATEGORIES[0]!;

  const brainSnap = desk
    ? runVeteranBrain(
        desk,
        mounted ? loadDeskMemory() : undefined,
        undefined,
        brainLiveRisk(riskFetchState, risk),
        discretion?.byStrategy,
      )
    : null;


  return (
    <div className="ld-readable min-h-dvh bg-[var(--color-bg)]">
      <div
        className="pointer-events-none fixed inset-0 opacity-[0.25]"
        style={{
          backgroundImage:
            "radial-gradient(ellipse 60% 35% at 50% -8%, color-mix(in oklab, var(--color-primary) 12%, transparent), transparent)",
        }}
        aria-hidden
      />

      <div className="relative mx-auto max-w-7xl px-3 pb-24 pt-[calc(var(--grok-banner-h,0px)+0.5rem)] sm:px-5 lg:px-8">
        {/* Compact brand */}
        <header className="mb-2 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 text-[var(--color-primary)]">
              <Swords className="h-4 w-4 shrink-0" aria-hidden />
              <span className="text-[11px] font-semibold uppercase tracking-[0.14em]">
                Ledger · profit desk
              </span>
              <span
                className="rounded bg-[var(--color-primary)] px-2 py-0.5 font-mono text-[10px] font-bold text-[var(--color-bg)]"
                title={BUILD_LABEL}
              >
                {BUILD_MARKER} · {BUILD_ID}
              </span>
            </div>
            <p className="mt-0.5 truncate text-xs text-[var(--color-subtle)]">
              Paper $
              {Math.round(paper.equity).toLocaleString()}
              {paper.paperTaken > 0
                ? ` · live ${paper.paperTaken} WR ${
                    paper.paperWinRate != null
                      ? (paper.paperWinRate * 100).toFixed(0) + "%"
                      : "—"
                  } · ΣR ${paper.paperSumR >= 0 ? "+" : ""}${paper.paperSumR.toFixed(1)} · PnL ${
                    paper.equity - paper.startEquity >= 0 ? "+" : ""
                  }$${Math.round(paper.equity - paper.startEquity).toLocaleString()}`
                : " · live paper 0 fills"}
              {paper.openPaperCount > 0
                ? ` · OPEN ${paper.openPaperCount}`
                : ""}
              {" · "}
              floor {APLUS_RULES.confluenceFloor} · PATH only
            </p>
          </div>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={loading}
            onClick={() => void load()}
            className="shrink-0"
          >
            {loading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            <span className="hidden sm:inline">Refresh</span>
          </Button>
        </header>

        {/* Always-on session / halt */}
        {paperToast && (
          <div className="mb-3 rounded-[var(--radius-md)] border border-[color-mix(in_oklab,var(--color-primary)_35%,var(--color-border))] bg-[color-mix(in_oklab,var(--color-primary)_12%,var(--color-surface))] px-3 py-2 font-mono text-xs text-[var(--color-fg)]">
            {paperToast}
          </div>
        )}
        {desk && (
          <SessionHud
            desk={desk}
            wallNow={wallNow}
            liveRisk={risk}
            onEntryChip={() => setCat("trade")}
            synapseTab={(SYNAPSE_TABS as string[]).includes(cat) ? (cat as SynapseTab) : "trade"}
            tabs={
              <nav aria-label="Profit categories">
                <div className="flex flex-wrap gap-1">
                  {CATEGORIES.map((c) => {
                    const Icon = c.icon;
                    const on = cat === c.id;
                    return (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => setCat(c.id)}
                        title={`${c.label} — ${c.hint}`}
                        aria-current={on ? "page" : undefined}
                        className={cn(
                          "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-left transition-colors",
                          on
                            ? "border-[var(--color-primary)] bg-[color-mix(in_oklab,var(--color-primary)_14%,var(--color-surface))] text-[var(--color-fg)]"
                            : "border-transparent text-[var(--color-muted)] hover:border-[var(--color-border-strong)] hover:text-[var(--color-fg)]",
                        )}
                      >
                        <Icon
                          className={cn(
                            "h-3.5 w-3.5 shrink-0",
                            on ? "text-[var(--color-primary)]" : "text-[var(--color-subtle)]",
                          )}
                        />
                        <span className="whitespace-nowrap text-[13px] font-semibold">
                          <span className="lg:hidden">{c.short}</span>
                          <span className="hidden lg:inline">{c.label}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </nav>
            }
          >
            <PathAlarmBar desk={desk} />
            <p className="mt-1.5 px-1 text-[12px] text-[var(--color-subtle)]">
              <span className="font-medium text-[var(--color-muted)]">{active.label}</span>
              {" — "}
              {active.hint}
            </p>
          </SessionHud>
        )}
        <ScreenFlash desk={desk} />
        <StorageBanner />
        {risk && <HaltBanner risk={risk} />}

        {/* DEV capture only — Accuracy attachment re-render */}
        {captureMead && !desk && (
          <div className="mt-3 min-h-[50vh]">
            <Suspense
              fallback={
                <div className="flex items-center gap-2 text-sm text-[var(--color-muted)]">
                  <Loader2 className="h-4 w-4 animate-spin text-[var(--color-primary)]" />
                  Opening the Mead Hall…
                </div>
              }
            >
              <MeadHallTab />
            </Suspense>
          </div>
        )}

        {loading && !desk && (
          <div className="mt-10 flex items-center justify-center gap-2 text-sm text-[var(--color-muted)]">
            <Loader2 className="h-4 w-4 animate-spin text-[var(--color-primary)]" />
            Building desk…
          </div>
        )}

        {error && !desk && (
          <p className="mt-6 rounded-[var(--radius-md)] border border-[var(--color-down)]/30 px-4 py-3 text-sm text-[var(--color-down)]">
            {error}
          </p>
        )}

        {/* A rebuild that fails AFTER the first desk used to show nothing:
            the old desk sat there looking current. Say it is stale, when it
            was built, and why. */}
        {error && desk && (
          <p
            role="status"
            className="mt-3 rounded-[var(--radius-md)] border border-[var(--color-warn)]/40 px-3 py-2 font-mono text-xs text-[var(--color-warn)]"
          >
            {deskStaleLine(desk.fetchedAt, error)}
          </p>
        )}

        {riskFetchState === "unknown" && (
          <p
            role="status"
            className="mt-3 rounded-[var(--radius-md)] border border-[var(--color-down)]/40 px-3 py-2 font-mono text-xs text-[var(--color-down)]"
          >
            Risk governor unreachable · {riskUnknownLine(riskUnknownSince)} · entry blocked until it answers
            {risk ? " · last known risk kept" : ""}
          </p>
        )}

        {desk && (
          <>
            <div className="mt-3 min-h-[50vh] space-y-4">
              {/* The Synapse box used to repeat here at the top of Options,
                  Charts, Brain, Book and Lab. It is now ONE header chip
                  (SessionHud → SynapseChip) that expands into the same box. */}

              {cat === "learn" && <LearnTab desk={desk} />}
              {/* The kill-rule check now lives inside the panel, beside the
                  research it checks. */}
              {cat === "invest" && <InvestPanel />}
              {cat === "news" && <NewsTab />}
              {(cat === "predict" || cat === "mead") && (
                <Suspense
                  fallback={
                    <div className="flex items-center gap-2 text-sm text-[var(--color-muted)]">
                      <Loader2 className="h-4 w-4 animate-spin text-[var(--color-primary)]" />
                      Opening the analyzer…
                    </div>
                  }
                >
                  <PmAnalyzer />
                </Suspense>
              )}
              {cat === "discuss" && <DiscussTab desk={desk} />}
              {cat === "floor" && (
                <Suspense
                  fallback={
                    <div className="flex items-center gap-2 text-sm text-[var(--color-muted)]">
                      <Loader2 className="h-4 w-4 animate-spin text-[var(--color-primary)]" />
                      Loading the floor…
                    </div>
                  }
                >
                  <TradingFloorTab desk={desk} />
                </Suspense>
              )}

              {cat === "brain" && (
                <div className="space-y-5">
                  <SectionHead
                    n="V"
                    title="Veteran brain"
                    sub="SMC/ICT discretion · remembers backtests & journal · never overrides hard gates"
                  />
                  <VeteranBrainPanel desk={desk} risk={risk} riskGate={riskFetchState} />
                  <TradingCoach desk={desk} />
                </div>
              )}

              {cat === "trade" && (
                <div className="space-y-4">
                  <EntryHero desk={desk} />
                  <PricePathBoard desk={desk} />
                  {/* 15:00–15:55 ET: the overnight decision is due, and the
                      trader is looking at the Now tab, not the Options tab. */}
                  {desk.clock.isWeekday &&
                    desk.clock.etHour * 60 + desk.clock.etMinute >= DECIDE_START_MIN &&
                    desk.clock.etHour * 60 + desk.clock.etMinute <= DECIDE_END_MIN && (
                      <OvernightBoard desk={desk} />
                    )}
                  {/*
                    PATH ABOVE THE CHART (trader's call 2026-09-25).

                    The cards are where the decision is made and where every
                    action lives — the entry price, the invalidation, the
                    target, Log paper, Log live, the trade note. The chart is
                    where the decision is CHECKED. Putting the check first
                    meant scrolling past a picture to reach the only thing on
                    the page with a button on it, on a desk whose measured
                    weakness is completing entries.
                  */}
                  <SectionHead
                    n="1"
                    title="PATH"
                    sub={`≥${APLUS_RULES.confluenceFloor} + HTF · one book · rest the limit at CE or skip`}
                  />
                  <SetupScanner
                    scan={desk.scan}
                    onLog={onLog}
                    noteFor={noteFor}
                    entryAllowed={entryAllowed}
                    entryBlockedReason={entryBlockedReason}
                    bias={desk.bias}
                    narrative={desk.narrative}
                    clock={{
                      inTradeWindow: desk.clock.inTradeWindow,
                      killzoneLabel: desk.clock.killzoneLabel,
                      // The tape-measured session and the ET clock, for the
                      // card's session readout and its evidence lookups.
                      killzone: desk.clock.killzone,
                      sessionSource: desk.clock.sessionSource,
                      sessionReason: desk.clock.sessionReason,
                      etHour: desk.clock.etHour,
                      etMinute: desk.clock.etMinute,
                      weekday: desk.clock.weekday,
                    }}
                    discretion={discretion}
                    tape={scannerTape}
                  />
                  {/* The destination board says WHERE price is going in words;
                      this says it in a picture, from the same plan object. It
                      now sits UNDER the cards: verdict, decide, then look. */}
                  <SetupChartPanel desk={desk} />
                  <SectionHead
                    n="2"
                    title="Paper"
                    sub="Live-managed · scale-outs, BE, time stops · auto paper NY AM"
                  />
                  <PaperBookPanel
                    lastClosed={lastPaperClosed}
                    liveMarks={{
                      [desk.left.symbol]: desk.quotes.left.price,
                      [desk.right.symbol]: desk.quotes.right.price,
                      ES:
                        desk.left.symbol === "ES"
                          ? desk.quotes.left.price
                          : desk.right.symbol === "ES"
                            ? desk.quotes.right.price
                            : undefined,
                      MES:
                        desk.left.symbol === "ES"
                          ? desk.quotes.left.price
                          : desk.right.symbol === "ES"
                            ? desk.quotes.right.price
                            : undefined,
                    }}
                    onClosed={(tr) => {
                      setLastPaperClosed(tr);
                      setPaperToast(
                        `PAPER OUT · ${tr.displaySymbol} ${tr.exitReason} @ ${tr.exit} · R ${tr.rMultiple?.toFixed(2)} · $${tr.pnlUsd?.toFixed(0)}`,
                      );
                      setEquity(getPaperAccount().equity);
                      try {
                        getDeskSynapse().publishMemory();
                      } catch {
                        /* */
                      }
                      window.setTimeout(() => setPaperToast(null), 8000);
                    }}
                  />
                  {/* Everything below is context, evidence and hindsight.
                      It is all still here and all one click away — it is just
                      no longer between the trader and the click. The order
                      above is the order the decision is actually made in:
                      verdict, picture, scanner. */}
                  <DeskFold
                    title="Timeframe ladder"
                    sub="Q → 1m in four tiers, closed candles only — the higher tier wins"
                  >
                    <TfLadderPanel desk={desk} />
                  </DeskFold>
                  <DeskFold
                    title="Shadow book"
                    sub="today's refusals, paper-traded both ways — evidence about the gates, never a fill"
                  >
                    <ShadowBookPanel mode="compact" />
                  </DeskFold>
                  <DeskFold title="Last trade debrief" sub="hindsight — it cannot change the next click">
                    <TradeDebriefPanel lastPaper={lastPaperClosed?.debrief} />
                  </DeskFold>
                  <DeskFold
                    title="Context"
                    sub="HTF · live · week/month · prop · narrative"
                  >
                    <HtfBiasBoard
                      left={desk.bias.left}
                      right={desk.bias.right}
                    />
                    <LiveSaysPanel says={desk.liveSays} />
                    <PremarketPanel desk={desk} />
                    <LiveSessionCard />
                    <PropFirmPanel
                      candidates={desk.scan.candidates}
                      equity={equity}
                    />
                    {desk.narrative && (
                      <MarketNarrativePanel
                        left={desk.narrative.left}
                        right={desk.narrative.right}
                        leftLabel={desk.left.symbol}
                        rightLabel={desk.right.symbol}
                        summary={desk.narrative.summary}
                      />
                    )}
                  </DeskFold>
                </div>
              )}

              {cat === "swing" && (
                <div className="space-y-5">
                  {/* One header: the sleeve panel's own ("Robinhood · QQQ / SPY
                      sleeve") — the duplicate SectionHead above it is gone. */}
                  {/* The overnight question is asked before the intraday
                      cards, because at 15:00 it is the only one left. */}
                  <OvernightBoard desk={desk} />
                  <OptionsSwingPanel desk={desk} />
                </div>
              )}

              {(cat === "path" || cat === "backtest") && (
                <div className="space-y-5">
                  <SectionHead
                    n="A"
                    title="Profit path"
                    sub="Expectancy first · income measured, not projected · only A-path counts"
                  />
                  <ProfitPathPanel equity={equity} />
                  <SectionHead
                    n="B"
                    title="Journal"
                    sub="Paper first · skips are edge"
                  />
                  <JournalPanel onChanged={() => void loadRisk()} />
                  <SectionHead
                    n="B1"
                    title="Discipline"
                    sub="Real fills, priced by the rule each one kept or broke · no score, no streak"
                  />
                  <DisciplinePanel />
                  <TakeMomentsPanel />
                  <SectionHead
                    n="B2"
                    title="Shadow book"
                    sub="The refusals, paper-traded · gate scorecard · the little things"
                  />
                  <ShadowBookPanel mode="full" />
                  <SectionHead
                    n="B3"
                    title="Logged trades"
                    sub="Real fills · discipline apart from setup · non-compliant rows excluded"
                  />
                  <TradeLogPanel />
                  <SectionHead
                    n="B4"
                    title="Live TAKE census"
                    sub="Is the gate tight, or is the 15m close the wrong clock · thresholds fixed in advance"
                  />
                  <TakeCensusPanel />
                  <SectionHead
                    n="B5"
                    title="Are the numbers true?"
                    sub="The desk's own figures graded against what happened · expectancy leads, hit rate follows"
                  />
                  <CalibrationPanel />
                  <SectionHead
                    n="C"
                    title="Real-data backtest"
                    sub="Ask week/month · PATH auto-taken · R + $ PnL · no lookahead"
                  />
                  <TradezellaChat desk={desk} onLog={onLog} />
                </div>
              )}

              {cat === "tape" && (
                <div className="space-y-5">
                  <SectionHead
                    n="T"
                    title="Dual tape"
                    sub="MNQ · ES · mark levels from liquidity"
                  />
                  <DualIndexCharts desk={desk} />
                  <LiquidityPanel desk={desk} />
                </div>
              )}

              {(cat === "lab" || cat === "risk") && (
                <div className="space-y-5">
                  {/* RiskPanel carries its own "Risk governor" header and the
                      paper equity / risk-ladder rows — no second heading. */}
                  <RiskPanel desk={desk} liveRisk={risk} />
                  <ApexSimPanel />
                  <EvidenceTable />
                  <AlertsPanel />
                  <AnalyticsPanel />
                  <DeskFold
                    title="Deep lab"
                    sub="Rules · replay · snapshots · shadow · bridge"
                  >
                    <div className="flex items-start gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg)]/40 px-3 py-2 text-xs text-[var(--color-muted)]">
                      <BookOpen className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--color-primary)]" />
                      Review after the session. Live path stays in Now / Book.
                    </div>
                    <AplusOps />
                    <SmcPlaybook stack={desk.smcMaster.oneBook?.canon} />
                    <ReplayReport />
                    <SnapshotReview />
                    <ShadowOrderReview />
                    <BridgeStatus />
                  </DeskFold>
                </div>
              )}
            </div>
          </>
        )}

        {logCandidate && (
          <LogSetupDialog
            candidate={logCandidate}
            equity={equity}
            killzone={desk?.clock.killzone}
            open={!!logCandidate}
            onOpenChange={(o) => !o && setLogCandidate(null)}
            onLogged={(trade) => {
              void loadRisk();
              if (trade.mode === "live") markTakeAction(trade.symbol, trade.side, "logged_live");
              // Freeze decision-time context against this trade. Reviewing a
              // loss later from a chart that already shows the outcome is
              // hindsight, not review.
              if (desk) {
                void captureSnapshot({
                  data: {
                    tradeId: trade.id,
                    symbol: trade.symbol,
                    killzone: desk.clock.killzone,
                    htfLeft: desk.bias.left.topDown,
                    htfRight: desk.bias.right.topDown,
                    newsVerdict: desk.news.verdict,
                    dataQualityOk: !desk.scan.blocked.some((b) =>
                      b.startsWith("Data quality"),
                    ),
                    bestPrescore: desk.scan.candidates[0]?.confluence ?? null,
                    actionableCount: desk.scan.candidates.filter(
                      (c) => c.actionable,
                    ).length,
                    payload: {
                      clock: desk.clock,
                      bias: desk.bias,
                      scan: desk.scan,
                      draws: desk.draws,
                      levels: desk.levels,
                      news: desk.news,
                      // The sequence's word, layers and plan — what TAKE/STAND
                      // actually rests on. The snapshot left it out.
                      smc: { left: desk.smcMaster.left, right: desk.smcMaster.right },
                    } as never,
                  },
                }).catch(() => undefined);
              }
            }}
            defaultMode={logMode}
            discretion={discretionFor(
              discretion,
              logCandidate.completeStrategy || logCandidate.strategyPrimary,
            )}
            // Veteran-brain vetoes (HTF conflict, blake_mech demotion — now
            // backed by real Postgres counts, halt state) for THIS exact
            // candidate, when the brief was computed against it. brainSnap is
            // desk-wide (one "rawBest" pick per render); only surface vetoes
            // when they actually apply to what's being logged, not desk-wide
            // noise for a different setup.
            brainVetoes={
              brainSnap?.setup?.id === logCandidate.id
                ? brainSnap.vetoes
                : undefined
            }
            // The sequence's read on THIS card's book and side, frozen at the
            // moment the dialog opens — recorded with a real fill as the
            // override record (desk word + the gates it went through).
            deskContext={(() => {
              const book = [desk?.smcMaster?.left, desk?.smcMaster?.right].find(
                (b) => b?.symbol === logCandidate.symbol && b?.side === logCandidate.side,
              );
              return {
                deskWord: book?.word ?? null,
                missingLayers: missingLayers(book?.layers),
                planEntry: book?.plan?.entry ?? null,
                planStop: book?.plan?.stop ?? null,
              };
            })()}
          />
        )}

        <footer className="mt-10 border-t border-[var(--color-border)] pt-4 text-center text-[10px] text-[var(--color-subtle)]">
          PATH ≥ {APLUS_RULES.confluenceFloor} · max{" "}
          {APLUS_RULES.maxSetupsPerSession}/KZ · micros · desk{" "}
          {desk ? new Date(desk.fetchedAt).toLocaleString() : "—"}
        </footer>
      </div>
    </div>
  );
}

function SectionHead({
  n,
  title,
  sub,
}: {
  n: string;
  title: string;
  sub: string;
}) {
  return (
    <header className="flex items-baseline gap-2 border-b border-[var(--color-border)] pb-2">
      <span className="font-mono text-[10px] font-semibold text-[var(--color-primary)]">
        {n}
      </span>
      <div className="min-w-0">
        <h2 className="text-sm font-semibold tracking-tight text-[var(--color-fg)]">
          {title}
        </h2>
        <p className="text-[11px] text-[var(--color-subtle)]">{sub}</p>
      </div>
    </header>
  );
}

function DeskFold({
  title,
  sub,
  children,
}: {
  title: string;
  sub?: string;
  children: ReactNode;
}) {
  return (
    <details className="group rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)]">
      <summary className="cursor-pointer list-none px-3 py-2 [&::-webkit-details-marker]:hidden">
        <span className="flex items-center justify-between gap-2">
          <span className="min-w-0">
            <span className="text-sm font-medium text-[var(--color-fg)]">
              {title}
            </span>
            {sub ? (
              <span className="ml-2 text-[11px] font-normal text-[var(--color-muted)]">
                {sub}
              </span>
            ) : null}
          </span>
          <span className="shrink-0 text-[10px] uppercase tracking-wide text-[var(--color-subtle)] group-open:hidden">
            show
          </span>
          <span className="hidden shrink-0 text-[10px] uppercase tracking-wide text-[var(--color-subtle)] group-open:inline">
            hide
          </span>
        </span>
      </summary>
      <div className="space-y-3 border-t border-[var(--color-border)] px-3 py-3">
        {children}
      </div>
    </details>
  );
}
