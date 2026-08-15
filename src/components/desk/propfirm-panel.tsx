import { useCallback, useEffect, useMemo, useState } from "react";
import { Building2, TriangleAlert } from "lucide-react";
import type { SetupCandidate } from "@/lib/trading/scanner";
import { buildPaperLevels } from "@/lib/trading/paper-manager";
import {
  loadPropAccount,
  savePropAccount,
  derivePropAccount,
  stateAgeHours,
  type PropAccountState,
} from "@/lib/propfirm/account";
import { rulesFor, knownFirms, type PropPhase } from "@/lib/propfirm/rules";
import { scorePropTrade, MAX_STATE_AGE_HOURS } from "@/lib/propfirm/score";
import { cn } from "@/lib/utils";

const fieldClass =
  "w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2.5 py-1.5 font-mono text-xs text-[var(--color-fg)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)]";

function money(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const sign = n < 0 ? "−" : "";
  return `${sign}$${Math.abs(n).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

/**
 * Room meter — how much of the trailing-drawdown cushion is left.
 *
 * Deliberately the largest thing on the panel. On an evaluation this single
 * number decides everything: it caps size, and touching zero ends the account.
 * Equity, P&L and win rate are all downstream of it.
 */
function RoomBar({ roomUsd, trailUsd }: { roomUsd: number; trailUsd: number }) {
  const frac = trailUsd > 0 ? Math.max(0, Math.min(1, roomUsd / trailUsd)) : 0;
  const tone =
    frac > 0.6
      ? "var(--color-up)"
      : frac > 0.3
        ? "var(--color-warn)"
        : "var(--color-down)";
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-2 text-xs">
        <span className="text-[var(--color-subtle)]">Trail room left</span>
        <span className="font-mono font-semibold" style={{ color: tone }}>
          {money(roomUsd)} / {money(trailUsd)}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-[var(--color-surface-2)]">
        <div
          className="h-full rounded-full transition-[width]"
          style={{ width: `${frac * 100}%`, background: tone }}
        />
      </div>
    </div>
  );
}

/**
 * Prop-firm execution panel.
 *
 * Scores the SAME candidates the scanner produced against a prop account's
 * own constraints. It never re-grades a setup and never promotes one — it only
 * answers "can this account afford it, at what size, and what will the firm's
 * rules do to me if I take it."
 *
 * Every figure is hand-entered because prop firms disable API keys on
 * evaluation and funded accounts, so there is nothing to read. That makes
 * staleness a first-class concern rather than a detail: a threshold computed
 * from a peak the owner typed three days ago looks exactly as authoritative as
 * a fresh one, so the panel refuses to size against it.
 */
export function PropFirmPanel({
  candidates,
  equity,
}: {
  candidates: SetupCandidate[];
  equity: number;
}) {
  const [state, setState] = useState<PropAccountState>(() => loadPropAccount());
  const [editing, setEditing] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  // Re-read on cross-tab / cross-component updates.
  useEffect(() => {
    const onChange = () => setState(loadPropAccount());
    window.addEventListener("ledger-propfirm", onChange);
    return () => window.removeEventListener("ledger-propfirm", onChange);
  }, []);

  // Keep the staleness read honest without a render loop.
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  const firms = knownFirms();
  const rules = useMemo(
    () => rulesFor(firms[0] ?? "", state.phase, state.sizeUsd),
    [firms, state.phase, state.sizeUsd],
  );
  const derived = useMemo(
    () => derivePropAccount(state, rules),
    [state, rules],
  );
  const ageH = stateAgeHours(state, now);
  const stale = ageH > MAX_STATE_AGE_HOURS;

  const commit = useCallback((next: PropAccountState) => {
    savePropAccount(next);
    setState({ ...next, updatedAt: Date.now() });
  }, []);

  const scored = useMemo(() => {
    return candidates
      .filter((c) => c.grade !== "skip")
      .map((c) => {
        let levels;
        try {
          levels = buildPaperLevels(c, equity);
        } catch {
          return null;
        }
        if (!levels?.entry || !levels?.stop) return null;
        const r =
          levels.riskPts > 0
            ? Math.abs(levels.tp1 - levels.entry) / levels.riskPts
            : null;
        const verdict = scorePropTrade({
          trade: {
            symbol: levels.symbol,
            riskPts: levels.riskPts,
            discretionaryContracts: levels.contracts,
            rMultiple: r,
          },
          rules,
          state,
          derived,
          stateAgeHours: ageH,
        });
        return { candidate: c, levels, verdict };
      })
      .filter((x): x is NonNullable<typeof x> => x != null);
  }, [candidates, equity, rules, state, derived, ageH]);

  /* ---------- Nothing to size against yet ---------- */
  if (!rules) {
    // Two genuinely different situations. Saying "add a cited row" when the
    // row exists and the owner simply has not picked a phase would send them
    // into the source for no reason.
    const unset = state.phase === "none";
    return (
      <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-1)] p-4">
        <div className="flex items-start gap-2">
          <Building2 className="mt-0.5 size-4 shrink-0 text-[var(--color-subtle)]" />
          <div className="min-w-0 text-xs">
            <p className="font-semibold text-[var(--color-fg)]">
              {unset ? "Pick your account phase" : "No confirmed rule set for this account"}
            </p>
            <p className="mt-1 text-[var(--color-subtle)]">
              {unset ? (
                <>
                  Evaluation and funded accounts have different trails, caps and
                  payout rules — the sizing is not the same, so the phase has to
                  be chosen rather than assumed.
                </>
              ) : (
                <>
                  No confirmed rules for a $
                  {state.sizeUsd.toLocaleString()} {state.phase} account. Sizing
                  against a trailing drawdown needs the firm&apos;s exact trail,
                  target and contract cap, and those are never guessed here — a
                  cited row has to be added to{" "}
                  <code className="font-mono">src/lib/propfirm/rules.ts</code>{" "}
                  first. Accounts bought before 2026-03-01 are on Apex&apos;s
                  retired legacy line and are deliberately not covered.
                </>
              )}
            </p>
            <div className="mt-2 flex gap-2">
              {(["evaluation", "funded"] as const).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => commit({ ...state, phase: p })}
                  className={cn(
                    "rounded-[var(--radius-md)] border px-2 py-1 text-[11px]",
                    state.phase === p
                      ? "border-[var(--color-primary)] text-[var(--color-primary)]"
                      : "border-[var(--color-border)] text-[var(--color-fg)] hover:bg-[var(--color-surface-2)]",
                  )}
                >
                  {p === "evaluation" ? "Evaluation" : "Funded (PA)"}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* ---------------- Account state ---------------- */}
      <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-1)] p-3">
        <div className="mb-3 flex items-baseline justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-xs font-semibold text-[var(--color-fg)]">
              {rules.firm} · {rules.product}
            </p>
            <p className="text-[10px] text-[var(--color-subtle)]">
              rules confirmed {rules.confirmedOn}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setEditing((v) => !v)}
            className="shrink-0 rounded-[var(--radius-md)] border border-[var(--color-border)] px-2 py-1 text-[11px] text-[var(--color-fg)] hover:bg-[var(--color-surface-2)]"
          >
            {editing ? "Done" : "Update figures"}
          </button>
        </div>

        {stale && (
          <div className="mb-3 flex items-start gap-2 rounded-[var(--radius-md)] border border-[var(--color-down)] bg-[var(--color-surface-2)] p-2">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-[var(--color-down)]" />
            <p className="text-[11px] text-[var(--color-fg)]">
              {Number.isFinite(ageH)
                ? `Figures are ${Math.round(ageH)}h old.`
                : "Figures have never been entered."}{" "}
              Sizing is disabled until you re-enter balance and peak — a
              threshold from a stale peak looks authoritative and is not.
            </p>
          </div>
        )}

        {editing ? (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <label className="text-[11px] text-[var(--color-subtle)]">
              Phase
              <select
                className={fieldClass}
                value={state.phase}
                onChange={(e) =>
                  commit({ ...state, phase: e.target.value as PropPhase })
                }
              >
                <option value="none">—</option>
                <option value="evaluation">Evaluation</option>
                <option value="funded">Funded (PA)</option>
              </select>
            </label>
            <label className="text-[11px] text-[var(--color-subtle)]">
              Balance
              <input
                type="number"
                className={fieldClass}
                value={state.balanceUsd || ""}
                onChange={(e) =>
                  commit({ ...state, balanceUsd: Number(e.target.value) })
                }
              />
            </label>
            <label className="text-[11px] text-[var(--color-subtle)]">
              Peak (all-time)
              <input
                type="number"
                className={fieldClass}
                value={state.peakUsd || ""}
                onChange={(e) =>
                  commit({ ...state, peakUsd: Number(e.target.value) })
                }
              />
            </label>
            <label className="text-[11px] text-[var(--color-subtle)]">
              Days traded
              <input
                type="number"
                className={fieldClass}
                value={state.daysTraded || ""}
                onChange={(e) =>
                  commit({ ...state, daysTraded: Number(e.target.value) })
                }
              />
            </label>
          </div>
        ) : (
          <div className="space-y-3">
            {derived.roomUsd != null && (
              <RoomBar roomUsd={derived.roomUsd} trailUsd={rules.trailUsd} />
            )}
            <div className="grid grid-cols-3 gap-2 text-center">
              <Stat label="Balance" value={money(state.balanceUsd)} />
              <Stat label="Threshold" value={money(derived.thresholdUsd)} />
              <Stat
                label={rules.phase === "evaluation" ? "To pass" : "To payout"}
                value={money(derived.toGoUsd)}
              />
            </div>
          </div>
        )}
      </div>

      {/* ---------------- Per-setup verdicts ---------------- */}
      {scored.length === 0 ? (
        <p className="px-1 text-[11px] text-[var(--color-subtle)]">
          No gradeable setups on the board right now.
        </p>
      ) : (
        <div className="space-y-2">
          {scored.map(({ candidate, verdict }) => (
            <div
              key={candidate.id}
              className={cn(
                "rounded-[var(--radius-md)] border p-3",
                verdict.eligible
                  ? "border-[var(--color-border)] bg-[var(--color-surface-1)]"
                  : "border-[var(--color-border)] bg-[var(--color-surface-2)] opacity-80",
              )}
            >
              <div className="flex items-baseline justify-between gap-2">
                <p className="truncate text-xs font-semibold text-[var(--color-fg)]">
                  {candidate.symbol} {candidate.side.toUpperCase()}{" "}
                  <span className="font-normal text-[var(--color-subtle)]">
                    {candidate.grade} · {(candidate.confluence * 100).toFixed(0)}%
                  </span>
                </p>
                <span
                  className={cn(
                    "shrink-0 font-mono text-xs font-semibold",
                    verdict.eligible
                      ? "text-[var(--color-up)]"
                      : "text-[var(--color-down)]",
                  )}
                >
                  {verdict.eligible ? `${verdict.contracts} ct` : "NO SIZE"}
                </span>
              </div>

              <p className="mt-1 font-mono text-[11px] text-[var(--color-subtle)]">
                {verdict.note}
              </p>

              {verdict.eligible && (
                <p className="mt-1 text-[10px] text-[var(--color-subtle)]">
                  bound by: {verdict.limitedBy}
                </p>
              )}

              {verdict.blockers.map((b) => (
                <p
                  key={b}
                  className="mt-1 text-[11px] text-[var(--color-down)]"
                >
                  {b}
                </p>
              ))}
              {verdict.warnings.map((w) => (
                <p
                  key={w}
                  className="mt-1 text-[11px] text-[var(--color-warn)]"
                >
                  {w}
                </p>
              ))}
            </div>
          ))}
        </div>
      )}

      {rules.caveats.length > 0 && (
        <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] p-2">
          <p className="text-[10px] font-semibold text-[var(--color-subtle)]">
            Unconfirmed in the firm&apos;s published rules — verify before
            relying on these:
          </p>
          {rules.caveats.map((c) => (
            <p key={c} className="mt-0.5 text-[10px] text-[var(--color-subtle)]">
              · {c}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] px-2 py-1.5">
      <p className="text-[10px] text-[var(--color-subtle)]">{label}</p>
      <p className="font-mono text-xs font-semibold text-[var(--color-fg)]">
        {value}
      </p>
    </div>
  );
}
