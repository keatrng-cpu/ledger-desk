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
import type { HtfBiasRead } from "@/lib/trading/structure";
import type { MarketNarrative } from "@/lib/trading/market-narrative";
import {
  scoreCanonStack,
  canonInputForCandidate,
  type CanonStack,
} from "@/lib/trading/smc-canon";
import {
  discretionFor,
  type DiscretionPayload,
} from "@/lib/journal/discretion-server";
import type { DiscretionResult } from "@/lib/journal/discretion";

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

/**
 * SMC/ICT canon grade — the independent "is the STORY complete" read,
 * distinct from the raw engine confluence number. A candidate can carry a
 * high engine score off shared structure points while its own canon
 * sequence (sweep -> confirmation -> POI -> killzone) is still missing a
 * must-have — this badge is what makes that visible on the card instead of
 * only inside the veteran-brain panel for one desk-wide pick.
 */
function CanonBadge({ stack }: { stack: CanonStack }) {
  const tone =
    stack.grade === "A+" || stack.grade === "A"
      ? "up"
      : stack.grade === "A-" || stack.grade === "B"
        ? "primary"
        : "down";
  return (
    <span
      title={`${stack.thesis} — ${stack.mustHits}/${stack.mustNeed} must-have`}
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 font-mono text-[9px] font-semibold",
        tone === "up" &&
          "border-[color-mix(in_oklab,var(--color-up)_45%,var(--color-border))] text-[var(--color-up)]",
        tone === "primary" &&
          "border-[color-mix(in_oklab,var(--color-primary)_45%,var(--color-border))] text-[var(--color-primary)]",
        tone === "down" &&
          "border-[color-mix(in_oklab,var(--color-down)_40%,var(--color-border))] text-[var(--color-down)]",
      )}
    >
      SMC {stack.grade} · {stack.mustHits}/{stack.mustNeed}
    </span>
  );
}

/**
 * Real measured-history sizing factor (journal/discretion.ts), keyed to
 * THIS candidate's own strategy — the same number that actually scales
 * sizeContracts() on log, not a display-only estimate. Hidden below
 * MIN_EFFECTIVE_N (insufficient-data) to match the LogSetupDialog readout —
 * a strategy with no real sample yet should read as silent, not as ×1.00.
 */
function DiscretionBadge({ d }: { d: DiscretionResult }) {
  if (d.verdict === "insufficient-data") return null;
  const tone =
    d.verdict === "favor"
      ? "up"
      : d.verdict === "demote"
        ? "down"
        : d.verdict === "caution"
          ? "warn"
          : "primary";
  return (
    <span
      title={d.reason}
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 font-mono text-[9px] font-semibold",
        tone === "up" &&
          "border-[color-mix(in_oklab,var(--color-up)_45%,var(--color-border))] text-[var(--color-up)]",
        tone === "down" &&
          "border-[color-mix(in_oklab,var(--color-down)_40%,var(--color-border))] text-[var(--color-down)]",
        tone === "warn" &&
          "border-[color-mix(in_oklab,var(--color-warn)_40%,var(--color-border))] text-[var(--color-warn)]",
        tone === "primary" &&
          "border-[color-mix(in_oklab,var(--color-primary)_45%,var(--color-border))] text-[var(--color-primary)]",
      )}
    >
      ×{d.factor.toFixed(2)} {d.verdict} (n={d.effectiveN.toFixed(0)})
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
  canon,
  discretion,
}: {
  c: SetupCandidate;
  onLog?: (c: SetupCandidate, mode: LogMode) => void;
  entryAllowed?: boolean;
  /** Per-candidate SMC/ICT canon grade — see canonInputForCandidate. */
  canon?: CanonStack;
  /** Per-candidate real discretion factor — see journal/discretion.ts. */
  discretion?: DiscretionResult;
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
            {/* A counter-HTF trade must never look like a with-bias one. The
                gate released because the bias was disrespected and price
                distributed the other way — say so on the face of the card. */}
            {c.htfDisrespected && (
              <span
                title="HTF bias was disrespected: liquidity raid + displacement + structure break + both lower timeframes flipped. The gate released; this trades against the stale HTF read."
                className="inline-flex items-center gap-1 rounded-full border border-[color-mix(in_oklab,var(--color-warn)_50%,var(--color-border))] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-[var(--color-warn)]"
              >
                HTF flipped
              </span>
            )}
            {c.missing.includes("LTF delivery against") && (
              <span
                title="Session is delivering the other way. Do not fade a live impulse with leftover HTF components."
                className="inline-flex items-center gap-1 rounded-full border border-[color-mix(in_oklab,var(--color-down)_50%,var(--color-border))] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-[var(--color-down)]"
              >
                Fade LTF — off
              </span>
            )}
          </div>
          <p className="mt-0.5 truncate text-xs text-[var(--color-subtle)]">
            {c.title}
          </p>
          {/* The brain's two independent reads on THIS candidate: is the
              canon story complete (structure/rules), and does real
              live+paper+backtest history favor or demote its strategy
              (journal/discretion.ts — the same number that scales size on
              log). Neither gates the card; both are the "guidance" the
              engine score alone can't show. */}
          {(canon || discretion) && (
            <div className="mt-1.5 flex flex-wrap items-center gap-1">
              {canon && <CanonBadge stack={canon} />}
              {discretion && <DiscretionBadge d={discretion} />}
            </div>
          )}
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

/** How much a candidate's guided sort key moves per canon grade. */
const CANON_SORT_BONUS: Record<CanonStack["grade"], number> = {
  "A+": 0.06,
  A: 0.03,
  "A-": 0,
  B: -0.04,
  skip: -0.12,
};

export function SetupScanner({
  scan,
  onLog,
  entryAllowed = true,
  bias,
  narrative,
  clock,
  discretion,
}: {
  scan: ScanResult;
  onLog?: (c: SetupCandidate, mode: LogMode) => void;
  entryAllowed?: boolean;
  /** Per-book HTF read — matched to each candidate by symbol for its own canon grade. */
  bias?: { left: HtfBiasRead; right: HtfBiasRead };
  /** Per-book liquidity/confirmation narrative — same matching. */
  narrative?: { left: MarketNarrative; right: MarketNarrative };
  clock?: { inTradeWindow: boolean; killzoneLabel: string };
  /** Real per-strategy sizing factor (journal/discretion.ts via getDiscretionState). */
  discretion?: DiscretionPayload | null;
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
  const ranked = pathOnly && shown.length === 0 ? scan.candidates.slice(0, 4) : shown;

  /**
   * Per-candidate canon grade + real discretion, computed once here so both
   * the card render and the guided sort below use the identical numbers —
   * two consumers of one computation, not two computations that could drift.
   */
  const guided = ranked.map((c) => {
    const isRightBook = bias != null && c.symbol === bias.right.symbol;
    const book = bias ? (isRightBook ? bias.right : bias.left) : undefined;
    const narr = narrative ? (isRightBook ? narrative.right : narrative.left) : null;
    const canon =
      book && clock
        ? scoreCanonStack(canonInputForCandidate(c, book, narr, clock))
        : undefined;
    const disc = discretionFor(discretion, c.completeStrategy || c.strategyPrimary);
    return { c, canon, disc };
  });

  /**
   * The guided order: real history and canon completeness can move a
   * candidate up or down the list, not just decorate it — this is the
   * literal "brain guiding the card" the desk poll used to skip. Confluence
   * stays the dominant term (rules decide); canon and discretion are bounded
   * nudges layered on top of the existing cross-tab synapse rank, same
   * pattern as sizeContracts' discretionMult clamp.
   */
  const display = [...guided]
    .sort((a, b) => {
      const scoreA =
        a.c.confluence +
        (a.canon ? CANON_SORT_BONUS[a.canon.grade] : 0) +
        (a.disc.factor - 1) * 0.15;
      const scoreB =
        b.c.confluence +
        (b.canon ? CANON_SORT_BONUS[b.canon.grade] : 0) +
        (b.disc.factor - 1) * 0.15;
      return scoreB - scoreA;
    })
    .map((g) => g.c);
  const guidedById = new Map(guided.map((g) => [g.c.id, g]));

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
            canon={guidedById.get(c.id)?.canon}
            discretion={guidedById.get(c.id)?.disc}
          />
        ))}
      </div>
    </section>
  );
}
