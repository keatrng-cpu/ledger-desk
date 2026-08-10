import { useCallback, useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
  BookOpen,
  ChevronDown,
  ChevronUp,
  Loader2,
  RefreshCw,
  Swords,
} from "lucide-react";
import { AplusOps } from "@/components/dashboard/aplus-ops";
import { DualIndexCharts } from "@/components/dashboard/dual-index-charts";
import { BridgeStatus } from "@/components/bridge/bridge-status";
import { HaltBanner } from "@/components/journal/halt-banner";
import { JournalPanel } from "@/components/journal/journal-panel";
import { LogSetupDialog } from "@/components/journal/log-setup-dialog";
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

export const Route = createFileRoute("/")({
  component: MasterplacePage,
});

const DESK_POLL_MS = 30_000;

function MasterplacePage() {
  const [desk, setDesk] = useState<DeskPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [wallNow, setWallNow] = useState(() => formatUtcClock(Date.now()));
  const [showLab, setShowLab] = useState(false);
  const [risk, setRisk] = useState<RiskState | null>(null);
  // APLUS_RULES is `as const`, so widen off the literal type before setState.
  const [equity, setEquity] = useState<number>(APLUS_RULES.accountEquity);
  const [logCandidate, setLogCandidate] = useState<SetupCandidate | null>(null);
  const [logMode, setLogMode] = useState<"paper" | "live">("paper");

  /**
   * Risk state is auth-scoped and fetched separately from the (unauthenticated)
   * desk build. Signed-out / preview sessions simply get no governor UI rather
   * than an error — but note the desk NEVER shows entries as allowed while the
   * governor is unknown-and-halted, because `entryAllowed` defaults to true only
   * when there is no risk state at all (nothing logged yet = nothing to halt).
   */
  const loadRisk = useCallback(async () => {
    try {
      const [rs, s] = await Promise.all([getRiskState(), getSettings()]);
      setRisk(rs);
      setEquity(s.equity);
    } catch {
      /* signed out / no DB — governor UI stays hidden */
    }
  }, []);

  const entryAllowed = risk
    ? !risk.dailyHaltHit && !risk.weeklyHaltHit && !risk.killzoneCapHit
    : true;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchTradingDesk({
        data: { left: "MNQ", right: "ES" },
      });
      if (!res.ok) {
        setError(res.error);
      } else {
        setDesk(res);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Desk load failed");
    } finally {
      setLoading(false);
    }
    // Governor rides the same poll as the desk so the banner never lags behind
    // the tape it is gating.
    void loadRisk();
  }, [loadRisk]);

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

  return (
    <div className="min-h-dvh bg-[var(--color-bg)]">
      <div
        className="pointer-events-none fixed inset-0 opacity-[0.3]"
        style={{
          backgroundImage:
            "radial-gradient(ellipse 70% 40% at 50% -10%, color-mix(in oklab, var(--color-primary) 14%, transparent), transparent)",
        }}
        aria-hidden
      />

      <div className="relative mx-auto max-w-7xl px-4 pb-20 pt-[calc(var(--grok-banner-h,0px)+0.75rem)] sm:px-6 lg:px-8">
        {/* Brand header */}
        <header className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="mb-1.5 flex items-center gap-2 text-[var(--color-primary)]">
              <Swords className="h-5 w-5" aria-hidden />
              <span className="text-xs font-semibold uppercase tracking-[0.14em]">
                Ledger Masterplace
              </span>
            </div>
            <h1 className="text-2xl font-semibold tracking-tight text-[var(--color-fg)] sm:text-3xl">
              Private trading desk
            </h1>
            <p className="mt-1 max-w-2xl text-sm text-[var(--color-muted)]">
              Everything in one place: HTF bias, premarket, dual MNQ/ES tape,
              liquidity, confluence scanner, risk, and a coach Grok + Claude can
              extend — organized for selectivity, not noise.
            </p>
          </div>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={loading}
            onClick={() => void load()}
          >
            {loading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            Refresh desk
          </Button>
        </header>

        {desk && <SessionHud desk={desk} wallNow={wallNow} />}
        {risk && <HaltBanner risk={risk} />}

        {loading && !desk && (
          <div className="mt-10 flex items-center justify-center gap-2 text-sm text-[var(--color-muted)]">
            <Loader2 className="h-4 w-4 animate-spin text-[var(--color-primary)]" />
            Building structure desk from live tape…
          </div>
        )}

        {error && !desk && (
          <p className="mt-6 rounded-[var(--radius-md)] border border-[var(--color-down)]/30 px-4 py-3 text-sm text-[var(--color-down)]">
            {error}
          </p>
        )}

        {desk && (
          <div className="mt-5 space-y-8">
            {/* Nav anchors */}
            <nav
              className="flex flex-wrap gap-1.5"
              aria-label="Desk sections"
            >
              {[
                ["#htf", "1 Bias"],
                ["#scanner", "2 Setups"],
                ["#path", "Path 70%"],
                ["#tz", "TZ Lab"],
                ["#charts", "3 Charts"],
                ["#liquidity", "4 Liquidity"],
                ["#journal", "5 Journal"],
                ["#risk", "6 Risk"],
                ["#coach", "7 Coach"],
                ["#lab", "Lab"],
              ].map(([href, label]) => (
                <a
                  key={href}
                  href={href}
                  className="rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1 text-[11px] font-medium text-[var(--color-muted)] transition-colors hover:border-[var(--color-border-strong)] hover:text-[var(--color-fg)]"
                >
                  {label}
                </a>
              ))}
            </nav>

            <div id="htf">
              <HtfBiasBoard left={desk.bias.left} right={desk.bias.right} />
            </div>

            <PremarketPanel desk={desk} />

            <div id="scanner">
              <SetupScanner
                scan={desk.scan}
                onLog={(c, mode) => {
                  setLogMode(mode);
                  setLogCandidate(c);
                }}
                entryAllowed={entryAllowed}
              />
            </div>

            <div id="path" className="space-y-3">
              <ProfitPathPanel equity={equity} />
            </div>

            <div id="tz" className="space-y-3">
              <TradezellaChat
                desk={desk}
                onLog={(c, mode) => {
                  setLogMode(mode);
                  setLogCandidate(c);
                }}
              />
            </div>

            <div id="charts">
              <header className="mb-3">
                <h2 className="text-sm font-semibold tracking-tight text-[var(--color-fg)]">
                  3 · Dual tape (MNQ mini · ES)
                </h2>
                <p className="text-xs text-[var(--color-subtle)]">
                  Live Yahoo prints · mark PDH/PDL, EQH/EQL, and dealing range from
                  section 4
                </p>
              </header>
              <DualIndexCharts />
            </div>

            <div id="liquidity">
              <LiquidityPanel desk={desk} />
            </div>

            <div id="journal">
              <JournalPanel onChanged={() => void loadRisk()} />
            </div>

            <div
              id="risk"
              className="grid grid-cols-1 gap-4 lg:grid-cols-2"
            >
              <RiskPanel desk={desk} />
              <div id="coach">
                <TradingCoach desk={desk} />
              </div>
            </div>

            {/* Collapsible lab: deep aplus ops */}
            <div id="lab" className="border-t border-[var(--color-border)] pt-6">
              <button
                type="button"
                onClick={() => setShowLab((v) => !v)}
                className="mb-4 flex w-full items-center justify-between gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 text-left transition-colors hover:border-[var(--color-border-strong)]"
              >
                <span className="flex items-center gap-2 text-sm font-medium text-[var(--color-fg)]">
                  <BookOpen className="h-4 w-4 text-[var(--color-primary)]" />
                  Lab — deep aplus backtest / rules (Trading-Automation)
                </span>
                {showLab ? (
                  <ChevronUp className="h-4 w-4 text-[var(--color-subtle)]" />
                ) : (
                  <ChevronDown className="h-4 w-4 text-[var(--color-subtle)]" />
                )}
              </button>
              {showLab && (
                <div className="space-y-6">
                  <AplusOps />
                  <ReplayReport />
                  <BridgeStatus />
                </div>
              )}
            </div>
          </div>
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

        <footer className="mt-12 border-t border-[var(--color-border)] pt-6 text-center text-xs text-[var(--color-subtle)]">
          Private masterplace · rules from Trading-Automation · structure is
          deterministic · Grok & Claude explain, never override risk gates · last
          desk build {desk ? new Date(desk.fetchedAt).toLocaleString() : "—"}
        </footer>
      </div>
    </div>
  );
}
