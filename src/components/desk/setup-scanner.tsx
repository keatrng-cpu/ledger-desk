import { useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  NotebookPen,
  Target,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { APLUS_RULES } from "@/lib/aplus/config";
import type { ScanResult, SetupCandidate } from "@/lib/trading/scanner";
import { strategyLabel } from "@/lib/trading/strategies";
import { cn } from "@/lib/utils";
import { useDeskSynapse } from "@/lib/trading/desk-synapse";

function GradeBadge({ g }: { g: SetupCandidate["grade"] }) {
  return (
    <span
      className={cn(
        "rounded-full border px-2 py-0.5 font-mono text-[10px] font-semibold uppercase",
        g === "A+" &&
          "border-[color-mix(in_oklab,var(--color-up)_45%,var(--color-border))] text-[var(--color-up)]",
        g === "A-" &&
          "border-[color-mix(in_oklab,var(--color-primary)_45%,var(--color-border))] text-[var(--color-primary)]",
        g === "B" &&
          "border-[color-mix(in_oklab,var(--color-warn)_45%,var(--color-border))] text-[var(--color-warn)]",
        g === "skip" && "border-[var(--color-border)] text-[var(--color-subtle)]",
      )}
    >
      {g}
    </span>
  );
}

function StratChip({ id, primary }: { id: string; primary?: boolean }) {
  return (
    <span
      className={cn(
        "rounded-full border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide",
        primary
          ? "border-[color-mix(in_oklab,var(--color-primary)_50%,var(--color-border))] bg-[color-mix(in_oklab,var(--color-primary)_12%,transparent)] text-[var(--color-primary)]"
          : "border-[var(--color-border)] text-[var(--color-muted)]",
      )}
    >
      {strategyLabel(id)}
    </span>
  );
}

export type LogMode = "paper" | "live";

/**
 * Score meter — turns a bare number into a judgement.
 *
 * "0.89" means nothing without the two thresholds that decide what happens to
 * it. Drawing the floor and the A+ line ON the bar answers "is this good?" at
 * a glance, which the number alone never did.
 */
function ScoreMeter({ score }: { score: number }) {
  const pct = Math.max(0, Math.min(1, score)) * 100;
  const floor = APLUS_RULES.confluenceFloor * 100;
  const aplus = APLUS_RULES.aPlusThreshold * 100;
  const tone =
    score >= APLUS_RULES.aPlusThreshold
      ? "var(--color-up)"
      : score >= APLUS_RULES.confluenceFloor
        ? "var(--color-primary)"
        : "var(--color-warn)";

  return (
    <div className="mt-1.5">
      <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-[var(--color-surface-2)]">
        <div
          className="absolute inset-y-0 left-0 rounded-full transition-[width]"
          style={{ width: `${pct}%`, background: tone }}
        />
        {/* Threshold ticks sit ON the bar so the number is self-explaining. */}
        <div
          className="absolute inset-y-0 w-px bg-[var(--color-border-strong)]"
          style={{ left: `${floor}%` }}
          title={`PATH floor ${APLUS_RULES.confluenceFloor}`}
        />
        <div
          className="absolute inset-y-0 w-px bg-[var(--color-border-strong)]"
          style={{ left: `${aplus}%` }}
          title={`A+ ${APLUS_RULES.aPlusThreshold}`}
        />
      </div>
      <div className="mt-1 flex justify-between font-mono text-[9px] text-[var(--color-subtle)]">
        <span>floor {APLUS_RULES.confluenceFloor}</span>
        <span>A+ {APLUS_RULES.aPlusThreshold}</span>
      </div>
    </div>
  );
}

/**
 * The gates that actually stop a trade, stated once and loudly.
 *
 * These used to render as grey 10px micro-text ("dead · normal vol · HTF ok ·
 * KZ ok · cond block") in which a real blocker was indistinguishable from a
 * passing check. A blocked setup is the single most important thing the card
 * can say, so blockers are now the only thing shown — and only when they
 * exist.
 */
function BlockerStrip({
  c,
  entryAllowed,
}: {
  c: SetupCandidate;
  entryAllowed: boolean;
}) {
  const blocks: string[] = [];
  if (!c.htfOk) blocks.push("HTF bias conflict");
  if (!c.conditionsOk) blocks.push(`conditions (${c.regime || "regime"})`);
  if (!c.killzoneOk) blocks.push("outside killzone");
  if (!entryAllowed) blocks.push("risk governor");
  if (!blocks.length) return null;

  return (
    <div className="mb-2 flex items-start gap-1.5 rounded-[var(--radius-sm)] border border-[color-mix(in_oklab,var(--color-warn)_40%,var(--color-border))] bg-[color-mix(in_oklab,var(--color-warn)_8%,transparent)] px-2.5 py-1.5">
      <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-[var(--color-warn)]" />
      <p className="text-[11px] leading-snug text-[var(--color-warn)]">
        Blocked — {blocks.join(" · ")}
      </p>
    </div>
  );
}

function SetupCard({
  c,
  onLog,
  entryAllowed = true,
}: {
  c: SetupCandidate;
  onLog?: (c: SetupCandidate, mode: LogMode) => void;
  entryAllowed?: boolean;
}) {
  const [showDetail, setShowDetail] = useState(false);
  return (
    <article
      className={cn(
        "rounded-[var(--radius-md)] border bg-[var(--color-surface)] p-3 sm:p-4",
        c.actionable
          ? "border-[color-mix(in_oklab,var(--color-up)_35%,var(--color-border))]"
          : "border-[var(--color-border)]",
      )}
    >
      {/* ROW 1 — the decision line. Symbol, side, grade and score together,
          because those four are what decide whether to read any further. */}
      <div className="mb-2 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-semibold text-[var(--color-fg)]">
              {c.symbol}{" "}
              <span
                className={
                  c.side === "long"
                    ? "text-[var(--color-up)]"
                    : "text-[var(--color-down)]"
                }
              >
                {c.side.toUpperCase()}
              </span>
            </h3>
            <GradeBadge g={c.grade} />
            {c.actionable && entryAllowed && (
              <span className="inline-flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-[var(--color-up)]">
                <CheckCircle2 className="h-3 w-3" /> actionable
              </span>
            )}
          </div>
          <p className="mt-0.5 truncate text-xs text-[var(--color-subtle)]">
            {c.title}
          </p>
        </div>
        <div className="shrink-0 text-right font-mono">
          <p className="text-2xl font-semibold leading-none tabular text-[var(--color-fg)]">
            {c.confluence.toFixed(2)}
          </p>
          <p className="mt-0.5 text-[9px] uppercase tracking-wider text-[var(--color-subtle)]">
            engine
          </p>
        </div>
      </div>

      <ScoreMeter score={c.confluence} />

      <div className="mt-2.5" />
      <BlockerStrip c={c} entryAllowed={entryAllowed} />

      {/* ROW 2 — the plan. Three numbers a trader acts on, evenly weighted. */}
      <div className="mb-2 grid grid-cols-3 gap-2 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2.5 py-2 text-xs">
        {(
          [
            ["Entry", c.entryZone],
            ["Invalidation", c.invalidation],
            ["Target", c.targets[0] ?? "—"],
          ] as const
        ).map(([label, value]) => (
          <div key={label} className="min-w-0">
            <p className="text-[9px] uppercase tracking-wider text-[var(--color-subtle)]">
              {label}
            </p>
            <p className="mt-0.5 break-words font-mono text-[11px] leading-snug text-[var(--color-fg)]">
              {value}
            </p>
          </div>
        ))}
      </div>

      {/* ROW 3 — actions, full width and unambiguous. The paper button used to
          render its label twice ("Log paper 📝 Paper"). */}
      {onLog && (
        <div className="mb-2 grid grid-cols-2 gap-2">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => onLog(c, "paper")}
            title="One-click PAPER entry — auto size, auto manage exits on live data"
            className="border-[color-mix(in_oklab,var(--color-primary)_35%,var(--color-border))]"
          >
            <NotebookPen className="mr-1 h-3.5 w-3.5" />
            Log paper
          </Button>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => onLog(c, "live")}
            title={
              entryAllowed
                ? "Log as LIVE trade"
                : "Risk gate active — still journalable as live intent"
            }
            className="text-[var(--color-warn)]"
          >
            Log live
          </Button>
        </div>
      )}

      {/* The specific level this setup is drawn toward, and the empirical
          evidence for it — not just "a level exists up there". */}
      {c.draw && (
        <div className="mb-2 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-bg)]/40 px-2.5 py-2">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-[10px] uppercase tracking-wider text-[var(--color-subtle)]">
              Likely draw
            </p>
            <p className="font-mono text-[11px] text-[var(--color-fg)]">
              {c.draw.name} {c.draw.price.toFixed(2)}
              <span
                className={cn(
                  "ml-2",
                  c.draw.reachProbability >= 0.5
                    ? "text-[var(--color-up)]"
                    : "text-[var(--color-warn)]",
                )}
              >
                {(c.draw.reachProbability * 100).toFixed(0)}% reach
              </span>
              <span className="ml-2 text-[var(--color-subtle)]">
                {c.draw.distanceAtr.toFixed(2)} ATR
              </span>
            </p>
          </div>
          <p className="mt-0.5 text-[10px] leading-relaxed text-[var(--color-subtle)]">
            {c.draw.why.slice(0, 3).join(" · ")}
          </p>
        </div>
      )}

      {/* ROW 4 — everything else, collapsed.
          The card previously rendered up to 9 strategy chips and 10 raw
          snake_case component keys inline, which is where the "unorganized,
          hard to read" problem came from: the noise had the same visual
          weight as the trade plan. It is all still here, one click away. */}
      <button
        type="button"
        onClick={() => setShowDetail((v) => !v)}
        className="flex w-full items-center justify-between rounded-[var(--radius-sm)] px-1 py-1 text-left text-[10px] text-[var(--color-subtle)] transition-colors hover:text-[var(--color-fg)]"
      >
        <span className="truncate">
          {c.strategyPrimary ? strategyLabel(c.strategyPrimary) : "untagged"}
          {c.strategies.length > 1 ? ` +${c.strategies.length - 1} models` : ""}
          {" · "}
          {c.reasons.length} present · {c.missing.length} missing
        </span>
        {showDetail ? (
          <ChevronUp className="ml-2 h-3 w-3 shrink-0" />
        ) : (
          <ChevronDown className="ml-2 h-3 w-3 shrink-0" />
        )}
      </button>

      {showDetail && (
        <div className="mt-2 space-y-2.5 border-t border-[var(--color-border)] pt-2.5">
          <div className="flex flex-wrap gap-1">
            {c.strategyPrimary && <StratChip id={c.strategyPrimary} primary />}
            {c.strategies
              .filter((s) => s !== c.strategyPrimary)
              .map((s) => (
                <StratChip key={s} id={s} />
              ))}
          </div>

          {c.strategyWhy.length > 0 && (
            <p className="text-[11px] text-[var(--color-muted)]">
              {c.strategyWhy[0]}
            </p>
          )}

          <p className="font-mono text-[10px] text-[var(--color-subtle)]">
            {c.regime} · {c.volatility} vol · HTF {c.htfOk ? "ok" : "block"} · KZ{" "}
            {c.killzoneOk ? "ok" : "out"} · cond {c.conditionsOk ? "ok" : "block"}
          </p>

          {c.targets.length > 1 && (
            <p className="font-mono text-[10px] text-[var(--color-subtle)]">
              further targets · {c.targets.slice(1).join(" · ")}
            </p>
          )}

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div>
              <p className="mb-1 text-[10px] font-medium uppercase tracking-wider text-[var(--color-up)]">
                Present ({c.reasons.length})
              </p>
              <ul className="space-y-0.5 text-[11px] text-[var(--color-muted)]">
                {c.reasons.map((r) => (
                  <li key={r} className="flex gap-1.5">
                    <span className="text-[var(--color-up)]">+</span>
                    {r}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className="mb-1 text-[10px] font-medium uppercase tracking-wider text-[var(--color-down)]">
                Missing ({c.missing.length})
              </p>
              <ul className="space-y-0.5 text-[11px] text-[var(--color-muted)]">
                {c.missing.map((r) => (
                  <li key={r} className="flex gap-1.5">
                    <span className="text-[var(--color-down)]">−</span>
                    {r}
                  </li>
                ))}
                {!c.missing.length && (
                  <li className="text-[var(--color-subtle)]">— full stack —</li>
                )}
              </ul>
            </div>
          </div>
        </div>
      )}
    </article>
  );
}

export function SetupScanner({
  scan,
  onLog,
  entryAllowed = true,
}: {
  scan: ScanResult;
  onLog?: (c: SetupCandidate, mode: LogMode) => void;
  entryAllowed?: boolean;
}) {
  const fusedSetups = useDeskSynapse((s) => s.fusedSetups);
  const boosts = useDeskSynapse((s) => s.strategyBoosts);
  const rankCandidates = useDeskSynapse((s) => s.rankCandidates);
  const tradeFeed = useDeskSynapse((s) => s.feeds.trade);

  const [pathOnly, setPathOnly] = useState(true);
  const shown = pathOnly
    ? rankCandidates(scan.candidates).filter(
        (c) => c.actionable || c.pathBand === "A+" || c.pathBand === "A" || c.pathBand === "A-" || c.pathBand === "B+" || c.grade === "A+" || c.grade === "A-",
      )
    : scan.candidates;
  const display = pathOnly && shown.length === 0 ? scan.candidates.slice(0, 4) : shown;

  return (
    <section>
      <header className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold tracking-tight text-[var(--color-fg)]">
            2 · Active setup scanner
          </h2>
          <p className="text-xs text-[var(--color-subtle)]">
            Profit path: action only A/A+ (calib floor 0.65) · incomplete veto · full catalog · test floor {scan.floor} · A+ ≥ {scan.aPlus}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setPathOnly((v) => !v)}
            className={
              pathOnly
                ? "rounded-full border border-[color-mix(in_oklab,var(--color-up)_40%,var(--color-border))] bg-[color-mix(in_oklab,var(--color-up)_10%,transparent)] px-2.5 py-1 text-[11px] font-medium text-[var(--color-up)]"
                : "rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1 text-[11px] text-[var(--color-muted)]"
            }
          >
            {pathOnly ? "Path grades only" : "Show all grades"}
          </button>
          <div className="flex items-center gap-1.5 rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1 text-[11px] text-[var(--color-muted)]">
            <Target className="h-3.5 w-3.5 text-[var(--color-primary)]" />
            {scan.smt.state.replace(/_/g, " ")}
          </div>
        </div>
      </header>

      <div className="mb-3 flex flex-wrap gap-1.5">
        {scan.catalog.map((id) => (
          <span
            key={id}
            className="rounded-full border border-[var(--color-border)] px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-[var(--color-subtle)]"
          >
            {strategyLabel(id)}
          </span>
        ))}
      </div>

      <div className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2 text-xs text-[var(--color-muted)]">
          <span className="font-medium text-[var(--color-primary)]">SMT · </span>
          {scan.smt.note}
        </div>
        <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2 text-xs text-[var(--color-muted)]">
          <span className="font-medium text-[var(--color-primary)]">
            Conditions ·{" "}
          </span>
          L {scan.conditions.left.regime}/{scan.conditions.left.volatility}
          {scan.conditions.left.tradeable ? " ok" : " BLOCK"} · R{" "}
          {scan.conditions.right.regime}/{scan.conditions.right.volatility}
          {scan.conditions.right.tradeable ? " ok" : " BLOCK"}
        </div>
      </div>

      {scan.blocked.length > 0 && (
        <div className="mb-3 flex items-start gap-2 rounded-[var(--radius-md)] border border-[color-mix(in_oklab,var(--color-warn)_35%,var(--color-border))] bg-[color-mix(in_oklab,var(--color-warn)_8%,transparent)] px-3 py-2 text-xs text-[var(--color-warn)]">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <div>
            {scan.blocked.map((b) => (
              <p key={b}>{b}</p>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {display.map((c) => (
          <SetupCard
            key={c.id}
            c={c}
            onLog={onLog}
            entryAllowed={entryAllowed}
          />
        ))}
      </div>
    </section>
  );
}
