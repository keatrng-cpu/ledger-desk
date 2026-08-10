import { useCallback, useEffect, useState } from "react";
import { Loader2, Shield } from "lucide-react";
import type { DeskPayload } from "@/lib/trading/build-desk";
import { APLUS_RULES } from "@/lib/aplus/config";
import { PATH_MONTH_CAP, APLUS_PROBE_RISK } from "@/lib/trading/profit-rules";
import { getPaperAccount, formatPaperChip, resetPaperAccount } from "@/lib/trading/paper-account";
import { useDeskSynapse } from "@/lib/trading/desk-synapse";
import { getRiskState } from "@/lib/journal/server";
import type { RiskState } from "@/lib/journal/risk";
import { cn } from "@/lib/utils";

const RISK_POLL_MS = 30_000;

function money(n: number): string {
  const sign = n < 0 ? "−" : "";
  return `${sign}$${Math.abs(n).toFixed(2)}`;
}

/**
 * Loss-limit meter: fills as realized losses approach the halt limit.
 * Gains show an empty bar (no loss burned).
 */
function LimitBar({
  label,
  pnl,
  limit,
  halted,
}: {
  label: string;
  pnl: number;
  limit: number;
  halted: boolean;
}) {
  const burned = Math.max(0, -pnl);
  const frac = limit > 0 ? Math.min(1, burned / limit) : 0;
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-2 text-xs">
        <span className="text-[var(--color-subtle)]">{label}</span>
        <span
          className={cn(
            "font-mono",
            pnl > 0 && "text-[var(--color-up)]",
            pnl < 0 && !halted && "text-[var(--color-warn)]",
            halted && "text-[var(--color-down)]",
            pnl === 0 && "text-[var(--color-muted)]",
          )}
        >
          {money(pnl)} / −${limit.toFixed(0)}
        </span>
      </div>
      <div
        className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--color-surface-2)]"
        role="progressbar"
        aria-valuenow={Math.round(frac * 100)}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className={cn(
            "h-full rounded-full transition-all",
            halted
              ? "bg-[var(--color-down)]"
              : frac >= 0.75
                ? "bg-[var(--color-warn)]"
                : "bg-[var(--color-primary)]",
          )}
          style={{ width: `${Math.max(frac * 100, frac > 0 ? 4 : 0)}%` }}
        />
      </div>
    </div>
  );
}

export function RiskPanel({ desk }: { desk: DeskPayload }) {
  const memory = useDeskSynapse((s) => s.memory);
  const publishMemory = useDeskSynapse((s) => s.publishMemory);
  const paper = getPaperAccount(memory);

  const r = desk.risk;
  const [live, setLive] = useState<RiskState | null>(null);
  const [liveError, setLiveError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLive(await getRiskState());
      setLiveError(null);
    } catch (e) {
      setLiveError(e instanceof Error ? e.message : "Risk state unavailable");
    }
  }, []);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, RISK_POLL_MS);
    return () => window.clearInterval(id);
  }, [load]);

  const equity = live?.equity ?? r.equity;
  const riskDollars = equity * r.riskPct;

  const rows = [
    ["Account equity", `$${equity.toLocaleString()}`],
    ["Paper equity", `$${Math.round(paper.equity).toLocaleString()} (start $${paper.startEquity.toLocaleString()} · peak $${Math.round(paper.peakEquity).toLocaleString()} · DD ${paper.drawdownPct}%)`],
    ["Paper book", `PATH ${paper.pathTaken} · WR ${paper.winRate != null ? (paper.winRate * 100).toFixed(0) + "%" : "—"} · ΣR ${paper.sumR.toFixed(2)} · PnL $${paper.sumUsd.toFixed(0)}`],
    ["Risk / trade", `A+ 3% · A 2% · A- 1% · B+ 0.5% · B paper · C journal (default ${(r.riskPct * 100).toFixed(0)}%)`],
    ["$ risk band", `$${(equity * 0.01).toFixed(0)}–$${(equity * APLUS_RULES.riskPctCeiling).toFixed(0)} on $${equity.toLocaleString()}`],
    ["Ceiling", `${(APLUS_RULES.riskPctCeiling * 100).toFixed(0)}% hard cap (A+)`],
    ["R:R band", `${APLUS_RULES.minRr}:1 – 1:${APLUS_RULES.tpMaxR}`],
    [
      "Take risk off",
      APLUS_RULES.scaleOut.enabled
        ? `${(APLUS_RULES.scaleOut.tp1Fraction * 100).toFixed(0)}% @ +1R → BE stop → runner +2R`
        : "Off",
    ],
    ["One book/day", "MNQ or ES — never both same bias"],
    ["blake longs", "Demoted to B+/paper until WR recovers"],
    ["Primary model", "mechanical (+ SMT/TJR companion)"],
    ["PATH / month", `Cap ${PATH_MONTH_CAP} · then A+ only`],
    ["A+ size", `${(APLUS_PROBE_RISK * 100).toFixed(0)}% probe until n≥20 WR≥65%`],
    ["Setups / killzone", String(r.maxSetups)],
    ["Daily halt", `${(r.dailyLimitPct * 100).toFixed(0)}%`],
    ["Weekly halt", `${(r.weeklyLimitPct * 100).toFixed(0)}%`],
    ["Micros preferred", r.micros ? "MNQ / MES" : "Minis"],
    ["Confluence floor", String(r.floor)],
    ["A+ tag", `≥ ${APLUS_RULES.aPlusThreshold}`],
  ] as const;

  return (
    <section className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3 sm:p-4">
      <header className="mb-3 flex items-center gap-2">
        <Shield className="h-4 w-4 text-[var(--color-primary)]" />
        <div>
          <h2 className="text-sm font-semibold text-[var(--color-fg)]">
            5 · Risk governor
          </h2>
          <p className="text-xs text-[var(--color-subtle)]">
            Non-negotiables from Trading-Automation — AI cannot override
          </p>
        </div>
      </header>

      {/* Live state — realized PnL vs halts, killzone entries, open trades */}
      {live ? (
        <div className="mb-4 space-y-3">
          <LimitBar
            label="Day PnL vs −2% halt"
            pnl={live.dayPnl}
            limit={live.dailyLimit}
            halted={live.dailyHaltHit}
          />
          <LimitBar
            label="Week PnL vs −5% halt"
            pnl={live.weekPnl}
            limit={live.weeklyLimit}
            halted={live.weeklyHaltHit}
          />
          <div className="flex flex-wrap gap-2 font-mono text-[11px]">
            <span
              className={cn(
                "rounded-full border px-2.5 py-1",
                live.killzoneCapHit
                  ? "border-[color-mix(in_oklab,var(--color-warn)_55%,var(--color-border))] text-[var(--color-warn)]"
                  : "border-[var(--color-border)] text-[var(--color-muted)]",
              )}
            >
              {live.entriesThisKillzone}/{live.killzoneCap} entries ·{" "}
              {live.killzoneLabel}
            </span>
            <span className="rounded-full border border-[var(--color-border)] px-2.5 py-1 text-[var(--color-muted)]">
              {live.openTrades} open trade{live.openTrades === 1 ? "" : "s"}
            </span>
            {(live.dailyHaltHit || live.weeklyHaltHit) && (
              <span className="rounded-full border border-[color-mix(in_oklab,var(--color-down)_55%,var(--color-border))] px-2.5 py-1 font-semibold text-[var(--color-down)]">
                HALTED — no new entries
              </span>
            )}
          </div>
        </div>
      ) : (
        <div className="mb-4 flex items-center gap-2 text-xs text-[var(--color-subtle)]">
          {liveError ? (
            <span className="text-[var(--color-warn)]">{liveError}</span>
          ) : (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Loading realized PnL + governor state…
            </>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 gap-x-4 gap-y-1.5 font-mono text-xs sm:grid-cols-2">
        {rows.map(([k, v]) => (
          <div
            key={k}
            className="flex justify-between gap-3 border-b border-[var(--color-border)] py-1.5"
          >
            <span className="text-[var(--color-subtle)]">{k}</span>
            <span className="text-right text-[var(--color-fg)]">{v}</span>
          </div>
        ))}
      </div>
      <p className="mt-3 text-xs leading-relaxed text-[var(--color-muted)]">
        One idea per instrument. Zero trades on a quiet day is correct. Live
        trading stays locked until mode + credentials + risk ack.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-[var(--color-border)] pt-3">
        <button
          type="button"
          className="rounded border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2.5 py-1.5 text-[11px] text-[var(--color-muted)] hover:text-[var(--color-fg)]"
          onClick={() => {
            if (typeof window !== "undefined" && window.confirm("Reset paper account to $100,000 and clear PATH stats?")) {
              resetPaperAccount();
              publishMemory();
              window.dispatchEvent(new Event("ledger-memory"));
            }
          }}
        >
          Reset paper book to $100k
        </button>
        <span className="text-[10px] text-[var(--color-subtle)]">
          Equity & stats persist in this browser
        </span>
      </div>
    </section>
  );
}
