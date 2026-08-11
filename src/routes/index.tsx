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

  const loadRisk = useCallback(async () => {
    try {
      const [rs] = await Promise.all([getRiskState(), getSettings()]);
      publishRisk(rs);
      setRisk(rs);
      // Paper book equity is client desk-memory — never overwrite with server settings $100k
      setEquity(getPaperAccount().equity);
      return rs;
    } catch {
      setEquity(getPaperAccount().equity);
      return null;
    }
  }, [publishRisk]);

  const entryAllowed = risk
    ? !risk.dailyHaltHit && !risk.weeklyHaltHit && !risk.killzoneCapHit
    : true;

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
        const res = openPaperTradeInstant(c, {
          lastPrice,
          killzone: desk?.clock.killzone,
        });
        if (res.ok) {
          setPaperToast(
            `PAPER IN · ${res.trade.displaySymbol} ${res.trade.side.toUpperCase()} ${res.trade.contracts}ct @ ${res.trade.entry} · SL ${res.trade.stop} · TP1 ${res.trade.tp1}`,
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
    [desk],
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
    const { closed } = managePaperTradesAgainstPrice(prices);
    if (closed.length) {
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
      const { closed } = managePaperTradesAgainstPrice(prices);
      if (closed.length) {
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
                  <SectionHead
                    n="2"
                    title="PATH setups"
                    sub={`Only ≥${APLUS_RULES.confluenceFloor} + HTF · Log paper/live or skip`}
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
                  <SetupScanner
                    scan={desk.scan}
                    onLog={onLog}
                    entryAllowed={entryAllowed}
                  />
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
                  <RiskPanel desk={desk} />
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
                  <ReplayReport />
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
            onLogged={() => void loadRisk()}
            defaultMode={logMode}
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
