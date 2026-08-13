import { useCallback, useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
  BookOpen,
  Crosshair,
  FlaskConical,
  LineChart,
  Loader2,
  RefreshCw,
  Shield,
  Swords,
  Target,
  TrendingUp,
  Brain,
  Layers,
} from "lucide-react";
import { AplusOps } from "@/components/dashboard/aplus-ops";
import { DualIndexCharts } from "@/components/dashboard/dual-index-charts";
import { BridgeStatus } from "@/components/bridge/bridge-status";
import { HaltBanner } from "@/components/journal/halt-banner";
import { JournalPanel } from "@/components/journal/journal-panel";
import { LogSetupDialog } from "@/components/journal/log-setup-dialog";
import { PaperBookPanel } from "@/components/desk/paper-book-panel";
import {
  openPaperTradeInstant,
  managePaperTradesAgainstPrice,
  listOpenPaperTrades,
  closeOpenAtStructureLow,
  reconcilePaperBookToMemory,
  buildPaperLevels,
  type PaperTrade,
} from "@/lib/trading/paper-manager";
import { ReplayReport } from "@/components/lab/replay-report";
import { HtfBiasBoard } from "@/components/desk/htf-bias-board";
import { LiquidityPanel } from "@/components/desk/liquidity-panel";
import { PremarketPanel } from "@/components/desk/premarket-panel";
import { RiskPanel } from "@/components/desk/risk-panel";
import { SessionHud } from "@/components/desk/session-hud";
import { SetupScanner } from "@/components/desk/setup-scanner";
import { ProfitPathPanel } from "@/components/desk/profit-path";
import { TradezellaChat } from "@/components/desk/tradezella-chat";
import { TradingCoach } from "@/components/desk/trading-coach";
import { VeteranBrainPanel } from "@/components/desk/veteran-brain";
import { SmcPlaybook } from "@/components/desk/smc-playbook";
import { OptionsSwingPanel } from "@/components/desk/options-swing-panel";
import { MarketNarrativePanel } from "@/components/desk/market-narrative-panel";
import { evaluateOptionsSwing } from "@/lib/trading/options-swing";
import { useDeskSynapse, getDeskSynapse } from "@/lib/trading/desk-synapse";
import {
  getPaperAccount,
  formatPaperChip,
  resetPaperAccount,
} from "@/lib/trading/paper-account";
import {
  fetchYearStudySeed,
  hydrateFromYearStudy,
} from "@/lib/trading/bt-seed";
import { SynapseRail } from "@/components/desk/synapse-rail";
import { runVeteranBrain } from "@/lib/trading/veteran-brain";
import { loadDeskMemory } from "@/lib/trading/desk-memory";
import { Button } from "@/components/ui/button";
import {
  fetchTradingDesk,
  type DeskPayload,
} from "@/lib/trading/build-desk";
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
import { SnapshotReview } from "@/components/desk/snapshot-review";
import { ShadowOrderReview } from "@/components/desk/shadow-order-review";
import { AlertsPanel } from "@/components/desk/alerts-panel";
import {
  raiseSetupArmedAlert,
  raisePositionFlattenedAlert,
  raiseNewsBlackoutAlert,
  checkScheduledJobs,
} from "@/lib/alerts/trigger-server";
import { StorageBanner } from "@/components/desk/storage-banner";
import type { RiskState } from "@/lib/journal/risk";
import type { SetupCandidate } from "@/lib/trading/scanner";
import { APLUS_RULES } from "@/lib/aplus/config";
import { formatUtcClock } from "@/lib/market/yahoo";
import { cn } from "@/lib/utils";
import { BUILD_ID, BUILD_LABEL, BUILD_MARKER } from "@/lib/build-id";

export const Route = createFileRoute("/")({
  component: MasterplacePage,
});

const DESK_POLL_MS = 30_000;

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

  const levels = buildPaperLevels(candidate, equity, lastPrice);
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
 * The remaining 2 of 4 B4 real-time alerts (halt_hit is wired directly in
 * journal/server.ts's openTrade; position_flattened is wired in
 * mirrorClosedPaperTrades above). Both dedupe server-side by their own key
 * (setup: per candidate id; news: per calendar event), so calling this every
 * 30s poll is correct and produces at most one notification each.
 */
function raiseDeskAlerts(desk: DeskPayload): void {
  const armed = desk.scan.candidates.find((c) => c.actionable);
  if (armed) {
    void raiseSetupArmedAlert({
      data: {
        symbol: armed.symbol,
        side: armed.side,
        candidateId: armed.id,
        grade: armed.grade,
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

type DeskCategory =
  | "brain"
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
  icon: typeof Target;
}[] = [
  {
    id: "brain",
    label: "Veteran",
    short: "Brain",
    hint: "Memory · discretion · TAKE/SKIP",
    icon: Brain,
  },
  {
    id: "trade",
    label: "Trade now",
    short: "Trade",
    hint: "Bias · setups · go / no-go",
    icon: Crosshair,
  },
  {
    id: "swing",
    label: "Options",
    short: "Swing",
    hint: "Robinhood · when time occurs",
    icon: Layers,
  },
  {
    id: "path",
    label: "Path 0.70",
    short: "Path",
    hint: "WR · grades · journal",
    icon: TrendingUp,
  },
  {
    id: "backtest",
    label: "Backtest",
    short: "BT",
    hint: "Week PnL · PATH takes",
    icon: Target,
  },
  {
    id: "tape",
    label: "Tape",
    short: "Tape",
    hint: "MNQ/ES · liquidity",
    icon: LineChart,
  },
  {
    id: "risk",
    label: "Risk",
    short: "Risk",
    hint: "Limits · coach",
    icon: Shield,
  },
  {
    id: "lab",
    label: "Lab",
    short: "Lab",
    hint: "Deep rules · replay",
    icon: FlaskConical,
  },
];

function MasterplacePage() {
  const [desk, setDesk] = useState<DeskPayload | null>(null);
  const publishDesk = useDeskSynapse((s) => s.publishDesk);
  const publishRisk = useDeskSynapse((s) => s.publishRisk);
  const publishMemory = useDeskSynapse((s) => s.publishMemory);
  const synapsePosture = useDeskSynapse((s) => s.posture);
  const fusedSetups = useDeskSynapse((s) => s.fusedSetups);
  const memoryBook = useDeskSynapse((s) => s.memory);
  const paper = getPaperAccount(memoryBook);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [wallNow, setWallNow] = useState(() => formatUtcClock(Date.now()));
  const [cat, setCat] = useState<DeskCategory>("brain");
  const [risk, setRisk] = useState<RiskState | null>(null);
  const [equity, setEquity] = useState<number>(() => getPaperAccount().equity);
  const [logCandidate, setLogCandidate] = useState<SetupCandidate | null>(null);
  const [paperToast, setPaperToast] = useState<string | null>(null);
  const [lastPaperClosed, setLastPaperClosed] = useState<PaperTrade | null>(null);
  const [logMode, setLogMode] = useState<"paper" | "live">("paper");

  // Three states, not two, so the entry gate cannot fail OPEN while loading:
  // a user genuinely halted from a prior session must not see a green light
  // during the load window on refresh. "no-session" (signed-out preview) has
  // no governor at all, so it falls back to allowed — the server still
  // authoritatively rejects the write either way.
  const [riskFetchState, setRiskFetchState] = useState<
    "loading" | "no-session" | "ok"
  >("loading");

  // Real per-strategy sizing/verdict factor from journal/discretion.ts — see
  // that file for what feeds it. null while loading or signed out; every
  // consumer must go through discretionFor(), which degrades to neutral
  // (×1.0) rather than block on a miss.
  const [discretion, setDiscretion] = useState<DiscretionPayload | null>(
    null,
  );

  const loadRisk = useCallback(async () => {
    try {
      const [rs, , disc] = await Promise.all([
        getRiskState(),
        getSettings(),
        getDiscretionState(),
      ]);
      publishRisk(rs);
      setRisk(rs);
      setDiscretion(disc);
      // Paper book equity is client desk-memory — never overwrite with server settings $100k
      setEquity(getPaperAccount().equity);
      setRiskFetchState("ok");
      return rs;
    } catch {
      setEquity(getPaperAccount().equity);
      setRiskFetchState("no-session");
      setDiscretion(null);
      return null;
    }
  }, [publishRisk]);

  const entryAllowed =
    riskFetchState === "loading"
      ? false
      : riskFetchState === "no-session" || !risk
        ? true
        : !risk.dailyHaltHit && !risk.weeklyHaltHit && !risk.killzoneCapHit;

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

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [res, rs] = await Promise.all([
        fetchTradingDesk({
          data: { left: "MNQ", right: "ES" },
        }),
        loadRisk(),
      ]);
      if (!res.ok) {
        setError(res.error);
      } else {
        setDesk(res);
        publishDesk(res, rs);
        try {
          reconcilePaperBookToMemory();
        } catch {
          /* */
        }
        publishMemory();
        setEquity(getPaperAccount().equity);
        recordArmedShadow(res, getPaperAccount().equity);
        raiseDeskAlerts(res);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Desk load failed");
    } finally {
      setLoading(false);
    }
  }, [loadRisk, publishDesk]);

  
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
    void load();
  }, [load]);

  useEffect(() => {
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, DESK_POLL_MS);
    return () => window.clearInterval(id);
  }, [load]);

  useEffect(() => {
    const id = window.setInterval(
      () => setWallNow(formatUtcClock(Date.now())),
      1000,
    );
    return () => window.clearInterval(id);
  }, []);

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

  const onLog = useCallback(
    (c: SetupCandidate, mode: "paper" | "live") => {
      if (mode === "paper") {
        const lastPrice =
          desk?.left.symbol === c.symbol
            ? desk.quotes.left.price
            : desk?.right.symbol === c.symbol
              ? desk.quotes.right.price
              : desk?.quotes.left.price;
        // Real measured-edge multiplier (journal/discretion.ts), keyed off the
        // same strategy field paper-manager.ts already attributes trades to.
        // Applied silently to size — paper stays one-click/frictionless by
        // design, so the enforcement here IS the size, not a confirm dialog.
        const disc = discretionFor(
          discretion,
          c.completeStrategy || c.strategyPrimary,
        );
        const res = openPaperTradeInstant(c, {
          lastPrice,
          killzone: desk?.clock.killzone,
          discretionMult: disc.factor,
        });
        if (res.ok) {
          // Mirror the localStorage book into desk_trades so analytics, CSV
          // export and the unlock evidence see it. Fire-and-forget: a failure
          // (signed out, no DB) must never block the working paper book.
          void mirrorPaperOpen({
            data: {
              id: res.trade.id,
              // `symbol` is the resolved contract (ES -> MES when micros are
              // on); `displaySymbol` is the label. Sending the label made the
              // server price a micro at full-size — a 10x PnL error.
              symbol: res.trade.symbol,
              side: res.trade.side,
              entry: res.trade.entry,
              stop: res.trade.stop,
              target: res.trade.tp1 ?? null,
              contracts: res.trade.contracts,
              openedAt: new Date(res.trade.openedAt).toISOString(),
              prescore: res.trade.score ?? null,
              grade: res.trade.grade ?? null,
              killzone: desk?.clock.killzone ?? null,
              strategy: res.trade.strategy ?? null,
              regime: c.regime ?? null,
              reason: res.trade.reason ?? null,
            },
          }).catch(() => undefined);
          setPaperToast(
            `PAPER IN · ${res.trade.displaySymbol} ${res.trade.side.toUpperCase()} ${res.trade.contracts}ct @ ${res.trade.entry} · SL ${res.trade.stop} · TP1 ${res.trade.tp1}` +
              (disc.factor !== 1.0
                ? ` · discretion ×${disc.factor.toFixed(2)} (${disc.verdict}, n=${disc.effectiveN.toFixed(0)})`
                : ""),
          );
          setEquity(getPaperAccount().equity);
          try {
            getDeskSynapse().publishMemory();
          } catch {
            /* */
          }
          window.setTimeout(() => setPaperToast(null), 6000);
        } else {
          setPaperToast(`Paper log failed: ${res.error}`);
          window.setTimeout(() => setPaperToast(null), 6000);
        }
        return;
      }
      setLogMode(mode);
      setLogCandidate(c);
    },
    [desk, discretion],
  );

  useEffect(() => {
    if (!desk) return;
    // Last print only — HTF bar H/L false-stops new paper trades
    const prices: Record<string, { last: number; high: number; low: number }> = {
      [desk.left.symbol]: {
        last: desk.quotes.left.price,
        high: desk.quotes.left.price,
        low: desk.quotes.left.price,
      },
      [desk.right.symbol]: {
        last: desk.quotes.right.price,
        high: desk.quotes.right.price,
        low: desk.quotes.right.price,
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
  // Structure TP: ES session low 7763 — close remaining short size when mark tags it
  useEffect(() => {
    if (!desk) return;
    const esPx =
      desk.left.symbol === "ES"
        ? desk.quotes.left.price
        : desk.right.symbol === "ES"
          ? desk.quotes.right.price
          : null;
    if (esPx == null) return;
    const closed = closeOpenAtStructureLow(7763, {
      ES: esPx,
      MES: esPx,
      [desk.left.symbol]: desk.quotes.left.price,
      [desk.right.symbol]: desk.quotes.right.price,
    });
    if (closed.length) {
      mirrorClosedPaperTrades(closed);
      reconcilePaperBookToMemory();
      publishMemory();
      const last = closed[closed.length - 1]!;
      setLastPaperClosed(last);
      setPaperToast(
        `PAPER OUT · structure 7763 · R ${last.rMultiple?.toFixed(2)} · $${last.pnlUsd?.toFixed(0)}`,
      );
      setEquity(getPaperAccount().equity);
      window.setTimeout(() => setPaperToast(null), 8000);
    }
  }, [desk?.fetchedAt, desk?.quotes.left.price, desk?.quotes.right.price]);

  // Re-check open paper exits every 5s while positions exist (don't wait full desk poll)
  useEffect(() => {
    if (!desk) return;
    if (!listOpenPaperTrades().length) return;
    const id = window.setInterval(() => {
      if (!listOpenPaperTrades().length) return;
      const prices: Record<string, { last: number; high: number; low: number }> = {
        [desk.left.symbol]: {
          last: desk.quotes.left.price,
          high: desk.quotes.left.price,
          low: desk.quotes.left.price,
        },
        [desk.right.symbol]: {
          last: desk.quotes.right.price,
          high: desk.quotes.right.price,
          low: desk.quotes.right.price,
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
      const { closed } = managePaperTradesAgainstPrice(prices, {
        draws: {
          [desk.left.symbol]: desk.draws.left,
          [desk.right.symbol]: desk.draws.right,
        },
      });
      if (closed.length) {
        mirrorClosedPaperTrades(closed);
        const last = closed[closed.length - 1]!;
        setLastPaperClosed(last);
        setPaperToast(
          `PAPER OUT · ${last.displaySymbol} ${last.exitReason} · R ${last.rMultiple?.toFixed(2)} · $${last.pnlUsd?.toFixed(0)}`,
        );
        setEquity(getPaperAccount().equity);
      }
    }, 5000);
    return () => window.clearInterval(id);
  }, [desk, desk?.fetchedAt]);


  const active = CATEGORIES.find((c) => c.id === cat)!;

  // Profitability snapshot chips from desk
  const best =
    (fusedSetups[0] &&
      desk?.scan.candidates.find((c) => c.id === fusedSetups[0]!.id)) ||
    desk?.scan.candidates.find((c) => c.actionable);
  const focusLine = desk?.scan.focus?.slice(0, 90);
  const brainSnap = desk
    ? runVeteranBrain(
        desk,
        typeof window !== "undefined" ? loadDeskMemory() : undefined,
        undefined,
        risk
          ? {
              dailyHaltHit: risk.dailyHaltHit,
              weeklyHaltHit: risk.weeklyHaltHit,
              killzoneCapHit: risk.killzoneCapHit,
            }
            : null,
        discretion?.byStrategy,
      )
    : null;
  const swingSnap = desk ? evaluateOptionsSwing(desk) : null;


  return (
    <div className="min-h-dvh bg-[var(--color-bg)]">
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
        {desk && <SessionHud desk={desk} wallNow={wallNow} />}
        {/* Storage + build identity: silent data loss and a stale page are the
            two failures that look like nothing is wrong. */}
        <StorageBanner />
        {risk && <HaltBanner risk={risk} />}

        {/* One-line profitability status */}
        {desk && (
          <div className="mt-2 flex flex-wrap items-center gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-[11px]">
            <span className="font-semibold uppercase tracking-wide text-[var(--color-subtle)]">
              Now
            </span>
            <span className="text-[var(--color-fg)]">
              {desk.clock.killzoneLabel}
            </span>
            <span className="text-[var(--color-border-strong)]">·</span>
            <span
              className={
                desk.clock.inTradeWindow
                  ? "text-[var(--color-up)]"
                  : "text-[var(--color-subtle)]"
              }
            >
              {desk.clock.inTradeWindow ? "Window open" : "No entry window"}
            </span>
            <span className="text-[var(--color-border-strong)]">·</span>
            <span className="text-[var(--color-muted)]">
              HTF {desk.bias.left.topDown}/{desk.bias.right.topDown}
            </span>
            {best ? (
              <>
                <span className="text-[var(--color-border-strong)]">·</span>
                <span className="font-mono text-[var(--color-up)]">
                  {best.symbol} {best.side} {best.grade}{" "}
                  {best.confluence.toFixed(2)}
                </span>
              </>
            ) : (
              <>
                <span className="text-[var(--color-border-strong)]">·</span>
                <span className="text-[var(--color-subtle)]">No PATH setup</span>
              </>
            )}
            {!entryAllowed && (
              <>
                <span className="text-[var(--color-border-strong)]">·</span>
                <span className="font-semibold text-[var(--color-down)]">
                  HALTED
                </span>
              </>
            )}
            {focusLine && (
              <span className="hidden max-w-md truncate text-[var(--color-subtle)] lg:inline">
                · {focusLine}
              </span>
            )}
            {brainSnap && (
              <>
                <span className="text-[var(--color-border-strong)]">·</span>
                <button
                  type="button"
                  onClick={() => setCat("brain")}
                  className={
                    brainSnap.verdict === "TAKE"
                      ? "font-mono font-semibold text-[var(--color-up)]"
                      : brainSnap.verdict === "REDUCE"
                        ? "font-mono font-semibold text-[var(--color-warn)]"
                        : "font-mono font-semibold text-[var(--color-subtle)]"
                  }
                  title={brainSnap.headline}
                >
                  Brain {brainSnap.verdict} ×{brainSnap.sizeMult}
                </button>
              </>
            )}
            {swingSnap && (
              <>
                <span className="text-[var(--color-border-strong)]">·</span>
                <button
                  type="button"
                  onClick={() => setCat("swing")}
                  className={
                    swingSnap.timeOccurs
                      ? "font-mono font-semibold text-[var(--color-primary)]"
                      : "font-mono font-semibold text-[var(--color-subtle)]"
                  }
                  title={swingSnap.focus}
                >
                  RH {swingSnap.verdict}
                </button>
              </>
            )}
            {fusedSetups[0] && (
              <>
                <span className="text-[var(--color-border-strong)]">·</span>
                <span
                  className="hidden font-mono text-[var(--color-primary)] sm:inline"
                  title={fusedSetups[0].reasons.join(" · ")}
                >
                  Fused {fusedSetups[0].symbol} {fusedSetups[0].side}{" "}
                  {fusedSetups[0].fusedScore.toFixed(2)}
                </span>
              </>
            )}
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

        {desk && (
          <>
            {/* Category nav — sticky, profitability-first */}
            <nav
              className="sticky top-[var(--grok-banner-h,0px)] z-20 -mx-1 mt-3 mb-4 overflow-x-auto bg-[color-mix(in_oklab,var(--color-bg)_92%,transparent)] px-1 py-2 backdrop-blur-md"
              aria-label="Profit categories"
            >
              <div className="flex min-w-max gap-1.5 sm:min-w-0 sm:flex-wrap">
                {CATEGORIES.map((c) => {
                  const Icon = c.icon;
                  const on = cat === c.id;
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => setCat(c.id)}
                      className={cn(
                        "flex items-center gap-1.5 rounded-full border px-3 py-2 text-left transition-colors",
                        on
                          ? "border-[var(--color-primary)] bg-[color-mix(in_oklab,var(--color-primary)_14%,var(--color-surface))] text-[var(--color-fg)]"
                          : "border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-muted)] hover:border-[var(--color-border-strong)] hover:text-[var(--color-fg)]",
                      )}
                    >
                      <Icon
                        className={cn(
                          "h-3.5 w-3.5 shrink-0",
                          on
                            ? "text-[var(--color-primary)]"
                            : "text-[var(--color-subtle)]",
                        )}
                      />
                      <span className="text-xs font-semibold">
                        <span className="sm:hidden">{c.short}</span>
                        <span className="hidden sm:inline">{c.label}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
              <p className="mt-1.5 px-1 text-[10px] text-[var(--color-subtle)]">
                <span className="font-medium text-[var(--color-muted)]">
                  {active.label}
                </span>
                {" — "}
                {active.hint}
              </p>
            </nav>

            {/* Category panels — only one active for focus */}
            <div className="min-h-[50vh]">
              <SynapseRail tab={cat} />

              {cat === "brain" && (
                <div className="space-y-5">
                  <SectionHead
                    n="V"
                    title="Veteran brain"
                    sub="SMC/ICT discretion · remembers backtests & journal · never overrides hard gates"
                  />
                  <VeteranBrainPanel desk={desk} risk={risk} />
                  <TradingCoach desk={desk} />
                </div>
              )}

              {cat === "trade" && (
                <div className="space-y-5">
                  <SectionHead
                    n="1"
                    title="Bias & window"
                    sub="Top-down gate first — no LTF without HTF"
                  />
                  <HtfBiasBoard
                    left={desk.bias.left}
                    right={desk.bias.right}
                  />
                  <PremarketPanel desk={desk} />
                  {/* The setups come DIRECTLY under the header that names
                      them. Previously this header was followed by the market
                      narrative and the whole paper book, with the actual
                      SetupScanner last on the tab — so the one thing the
                      "Trade now" tab exists for was the furthest thing from
                      the top, and section 2's header labelled something else
                      entirely. */}
                  <SectionHead
                    n="2"
                    title="PATH setups"
                    sub={`Only ≥${APLUS_RULES.confluenceFloor} + HTF · Log paper/live or skip`}
                  />
                  <SetupScanner
                    scan={desk.scan}
                    onLog={onLog}
                    entryAllowed={entryAllowed}
                    bias={desk.bias}
                    narrative={desk.narrative}
                    clock={{
                      inTradeWindow: desk.clock.inTradeWindow,
                      killzoneLabel: desk.clock.killzoneLabel,
                    }}
                    discretion={discretion}
                  />

                  <SectionHead
                    n="3"
                    title="Open positions"
                    sub="Live-managed paper book — scale-outs, BE stops, time stops"
                  />
                  <PaperBookPanel
                    lastClosed={lastPaperClosed}
                    liveMarks={
                      desk
                        ? {
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
                          }
                        : undefined
                    }
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

                  {desk.narrative && (
                    <>
                      <SectionHead
                        n="4"
                        title="Market narrative"
                        sub="Why price is where it is — context, not a trigger"
                      />
                      <MarketNarrativePanel
                        left={desk.narrative.left}
                        right={desk.narrative.right}
                        leftLabel={desk.left.symbol}
                        rightLabel={desk.right.symbol}
                        summary={desk.narrative.summary}
                      />
                    </>
                  )}
                </div>
              )}

              {cat === "swing" && (
                <div className="space-y-5">
                  <SectionHead
                    n="S"
                    title="Options swing"
                    sub="Robinhood long debit · arms only when HTF + Mon–Thu + news clear"
                  />
                  <OptionsSwingPanel desk={desk} />
                </div>
              )}

              {cat === "path" && (
                <div className="space-y-5">
                  <SectionHead
                    n="A"
                    title="Path to 0.70 WR"
                    sub="Grade filter · expectancy · only A-path counts"
                  />
                  <ProfitPathPanel equity={equity} />
                  <SectionHead
                    n="B"
                    title="Journal"
                    sub="Paper first · skips are edge"
                  />
                  <JournalPanel onChanged={() => void loadRisk()} />
                </div>
              )}

              {cat === "backtest" && (
                <div className="space-y-4">
                  <SectionHead
                    n="BT"
                    title="Real-data backtest"
                    sub="Ask week/month · PATH auto-taken · R + $ PnL"
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
                  <DualIndexCharts />
                  <LiquidityPanel desk={desk} />
                </div>
              )}

              {cat === "risk" && (
                <div className="space-y-5">
                  <SectionHead
                    n="R"
                    title="Risk governor"
                    sub={`Paper $${Math.round(paper.equity).toLocaleString()} · WR ${paper.winRate != null ? (paper.winRate * 100).toFixed(0) + "%" : "—"} · ΣR ${paper.sumR.toFixed(1)} · A+3/A2/A-1/B+0.5`}
                  />
                  <RiskPanel desk={desk} liveRisk={risk} />
                  {/* Push subscribe control — the alerts pipeline existed
                      fully built with zero callers until 2026-08-12. */}
                  <AlertsPanel />
                  {/* Live and paper analytics — separate reports, explicit
                      switch, never blended into a single number. */}
                  <AnalyticsPanel />
                </div>
              )}

              {cat === "lab" && (
                <div className="space-y-6">
                  <SectionHead
                    n="L"
                    title="Deep lab"
                    sub="Rules catalog · replay · bridge — not for session noise"
                  />
                  <div className="flex items-start gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-xs text-[var(--color-muted)]">
                    <BookOpen className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--color-primary)]" />
                    Use during review, not mid-killzone. Live path stays in Trade
                    / Path / Backtest.
                  </div>
                  <AplusOps />
                  <SmcPlaybook />
                  <ReplayReport />
                  {/* Decision-time context — captureSnapshot had been writing
                      this on every log with nothing able to read it back. */}
                  <SnapshotReview />
                  {/* Shadow log — recordArmedShadow (this file's poll loop)
                      is the producer; this was the missing reader. */}
                  <ShadowOrderReview />
                  <BridgeStatus />
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
