import { type ReactNode, useEffect, useMemo, useState } from "react";
import {
  AlertOctagon,
  Clock,
  Crosshair,
  Radio,
  ShieldAlert,
  Zap,
} from "lucide-react";
import type { DeskPayload } from "@/lib/trading/build-desk";
import { NewsChip } from "@/components/desk/news-chip";
import {
  subscribeGhosts,
  todayGhosts,
  type GhostTrade,
} from "@/lib/trading/ghost-book";
import { loadLastDebrief, subscribeDebriefs } from "@/lib/trading/trade-debrief";
import { cn } from "@/lib/utils";

function px(n: number): string {
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function QuoteChip({
  symbol,
  price,
  changePct,
  source,
  lagSec,
}: {
  symbol: string;
  price: number;
  changePct: number;
  source: string;
  lagSec: number;
}) {
  const up = changePct >= 0;
  const tag =
    source === "live_gateway"
      ? "LIVE"
      : source === "yahoo"
        ? "Y!"
        : source === "databento"
          ? "DB"
          : "SYN";
  return (
    <span className="font-mono text-[11px] text-[var(--color-fg)]" title={`${source} · lag ${Math.round(lagSec)}s`}>
      {symbol}{" "}
      <span className={up ? "text-[var(--color-up)]" : "text-[var(--color-down)]"}>
        {px(price)}
        <span className="ml-1 text-[10px]">
          {up ? "+" : ""}
          {changePct.toFixed(2)}%
        </span>
      </span>
      <span className="ml-1 text-[9px] uppercase tracking-wide text-[var(--color-subtle)]">
        {tag}
      </span>
    </span>
  );
}


function matchingGhost(desk: DeskPayload, ghosts: GhostTrade[]): GhostTrade | null {
  const focus = desk.scan.candidates.find((c) => c.actionable) ?? desk.scan.candidates[0];
  if (!focus) return ghosts[0] ?? null;
  return (
    ghosts.find(
      (g) => g.symbol === focus.symbol && g.side === focus.side,
    ) ?? null
  );
}

export function SessionHud({
  desk,
  wallNow,
  children,
}: {
  desk: DeskPayload;
  wallNow: string;
  children?: ReactNode;
}) {
  const { clock, risk, scan, quotes, left, right, bias, brief, smtStack } = desk;
  const [ghosts, setGhosts] = useState<GhostTrade[]>(() => todayGhosts());
  const [lastDebrief, setLastDebrief] = useState(() =>
    typeof window !== "undefined" ? loadLastDebrief() : null,
  );
  useEffect(() => subscribeGhosts(() => setGhosts(todayGhosts())), []);
  useEffect(
    () =>
      subscribeDebriefs(() => setLastDebrief(loadLastDebrief())),
    [],
  );

  const ghost = matchingGhost(desk, ghosts);
  const worstLagSec = Math.max(quotes.left.lagSec, quotes.right.lagSec);
  const synthetic =
    left.source === "synthetic" ||
    right.source === "synthetic" ||
    quotes.left.source === "synthetic" ||
    quotes.right.source === "synthetic";

  const best =
    scan.candidates.find((c) => c.actionable) ?? scan.candidates[0] ?? null;
  const smtNote = smtStack?.primary.active
    ? smtStack.primary.note
    : scan.smt.edge !== "none"
      ? scan.smt.note
      : "";
  const smtBear = /bear/i.test(smtNote);

  const focus = useMemo(() => {
    const freshDebrief =
      lastDebrief && Date.now() - lastDebrief.at < 2 * 3600_000
        ? lastDebrief
        : null;
    if (freshDebrief && (freshDebrief.result === "win" || freshDebrief.result === "loss")) {
      return {
        mode: (freshDebrief.result === "win" ? "done" : "failed") as "done" | "failed",
        line: freshDebrief.headline,
        detail: freshDebrief.lesson,
      };
    }
    if (ghost?.status === "won" && ghost.analysis) {
      return {
        mode: "done" as const,
        line: ghost.analysis.headline,
        detail: ghost.analysis.lesson,
      };
    }
    if (ghost?.status === "lost" && ghost.analysis) {
      return {
        mode: "failed" as const,
        line: ghost.analysis.headline,
        detail: ghost.analysis.lesson,
      };
    }
    if (ghost?.status === "filled") {
      return {
        mode: "live" as const,
        line: `${ghost.symbol} ${ghost.side.toUpperCase()} in play · stop ${ghost.stop.toFixed(2)} · tp ${ghost.tp1.toFixed(2)}`,
        detail: "Do not add. Let the plan work.",
      };
    }
    if (brief?.verdict === "stand_down") {
      return {
        mode: "stand" as const,
        line: brief.headline,
        detail: brief.standDownReasons[0] ?? brief.reasons[0] ?? "",
      };
    }
    if (best?.actionable && clock.inTradeWindow) {
      return {
        mode: "go" as const,
        line: `${best.symbol} ${best.side.toUpperCase()} ${best.grade} ${best.confluence.toFixed(2)} · ${best.strategyPrimary ?? "model"}`,
        detail: best.strategyWhy[0] ?? best.reasons[0] ?? scan.focus,
      };
    }
    const raw = (scan.focus || "").replace(/^Focus:\s*/i, "");
    return {
      mode: "wait" as const,
      line: raw || "Stand down — no PATH card",
      detail: best?.missing.slice(0, 2).join(" · ") ?? "",
    };
  }, [ghost, brief, best, clock.inTradeWindow, scan.focus, lastDebrief]);

  const modeTone =
    focus.mode === "go" || focus.mode === "done"
      ? "up"
      : focus.mode === "failed" || focus.mode === "stand"
        ? "down"
        : focus.mode === "live"
          ? "warn"
          : "muted";

  const modeLabel =
    focus.mode === "go"
      ? "GO"
      : focus.mode === "done"
        ? "HIT"
        : focus.mode === "failed"
          ? "FAIL"
          : focus.mode === "live"
            ? "IN PLAY"
            : focus.mode === "stand"
              ? "STAND"
              : "WAIT";

  const leftSess = `${bias.left.sessionStance} ${Math.round((bias.left.sessionStrength ?? 0) * 100)}%`;
  const rightSess = `${bias.right.sessionStance} ${Math.round((bias.right.sessionStrength ?? 0) * 100)}%`;

  return (
    <div className="sticky top-[var(--grok-banner-h,0px)] z-20 -mx-4 border-b border-[var(--color-border)] bg-[color-mix(in_oklab,var(--color-bg)_94%,transparent)] px-4 py-2 backdrop-blur-md sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
      {synthetic && (
        <div className="mx-auto mb-2 flex max-w-7xl items-center gap-2 rounded-[var(--radius-md)] border border-[var(--color-down)] bg-[color-mix(in_oklab,var(--color-down)_18%,transparent)] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-down)]">
          <AlertOctagon className="h-3.5 w-3.5 shrink-0" />
          SYNTHETIC DATA — no live feed; structure/scanner untrustworthy
        </div>
      )}

      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-2 sm:gap-3">
        <div className="flex items-center gap-2 rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 font-mono text-[11px] text-[var(--color-fg)]">
          <Clock className="h-3.5 w-3.5 text-[var(--color-primary)]" />
          {clock.nowEt}
        </div>

        <div
          className={cn(
            "flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] font-medium",
            clock.inTradeWindow
              ? "border-[color-mix(in_oklab,var(--color-up)_40%,var(--color-border))] text-[var(--color-up)]"
              : "border-[var(--color-border)] text-[var(--color-subtle)]",
          )}
        >
          <Zap className="h-3.5 w-3.5" />
          {clock.killzoneLabel}
        </div>

        <NewsChip />

        <div className="hidden items-center gap-1.5 rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-[11px] text-[var(--color-muted)] sm:flex">
          <Crosshair className="h-3.5 w-3.5 text-[var(--color-primary)]" />
          {clock.sessionPhase}
        </div>

        <div className="flex items-center gap-1.5 rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 font-mono text-[11px] text-[var(--color-muted)]">
          <ShieldAlert className="h-3.5 w-3.5 text-[var(--color-warn)]" />
          Risk ${risk.riskDollars.toFixed(0)} · floor {risk.floor}
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2 font-mono text-[11px]">
          <QuoteChip
            symbol={quotes.left.symbol}
            price={quotes.left.price}
            changePct={quotes.left.changePct}
            source={quotes.left.source}
            lagSec={quotes.left.lagSec}
          />
          <span className="text-[var(--color-subtle)]">|</span>
          <QuoteChip
            symbol={quotes.right.symbol}
            price={quotes.right.price}
            changePct={quotes.right.changePct}
            source={quotes.right.source}
            lagSec={quotes.right.lagSec}
          />

          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-full border px-2 py-0.5",
              worstLagSec <= 15 &&
                "border-[color-mix(in_oklab,var(--color-up)_40%,var(--color-border))] text-[var(--color-up)]",
              worstLagSec > 15 &&
                worstLagSec <= 120 &&
                "border-[color-mix(in_oklab,var(--color-warn)_40%,var(--color-border))] text-[var(--color-warn)]",
              worstLagSec > 120 &&
                "border-[color-mix(in_oklab,var(--color-down)_50%,var(--color-border))] text-[var(--color-down)]",
            )}
            title="Worst quote lag vs exchange print time"
          >
            lag {Math.round(worstLagSec)}s
          </span>
          <span className="inline-flex items-center gap-1 text-[var(--color-subtle)]">
            <Radio className="h-3 w-3 text-[var(--color-up)]" />
            {wallNow}
          </span>
        </div>
      </div>

      <div className="mx-auto mt-1.5 flex max-w-7xl flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
        <span
          className={cn(
            "rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
            modeTone === "up" &&
              "border-[color-mix(in_oklab,var(--color-up)_45%,var(--color-border))] text-[var(--color-up)]",
            modeTone === "down" &&
              "border-[color-mix(in_oklab,var(--color-down)_45%,var(--color-border))] text-[var(--color-down)]",
            modeTone === "warn" &&
              "border-[color-mix(in_oklab,var(--color-warn)_45%,var(--color-border))] text-[var(--color-warn)]",
            modeTone === "muted" &&
              "border-[var(--color-border)] text-[var(--color-subtle)]",
          )}
        >
          {modeLabel}
        </span>
        <p className="min-w-0 flex-1 truncate text-[var(--color-fg)]">
          <span className="font-medium text-[var(--color-primary)]">Focus · </span>
          {focus.line}
          {focus.detail ? (
            <span className="text-[var(--color-muted)]"> — {focus.detail}</span>
          ) : null}
        </p>
      </div>

      <div className="mx-auto mt-1 flex max-w-7xl flex-wrap items-center gap-1.5 text-[10px] text-[var(--color-subtle)]">
        <span>
          HTF {bias.left.topDown}/{bias.right.topDown}
        </span>
        <span className="text-[var(--color-border-strong)]">·</span>
        <span>
          Sess {bias.left.symbol} {leftSess} / {bias.right.symbol} {rightSess}
        </span>
        {smtNote && (
          <>
            <span className="text-[var(--color-border-strong)]">·</span>
            <span className={smtBear ? "text-[var(--color-down)]" : "text-[var(--color-up)]"}>
              {smtNote.length > 88 ? `${smtNote.slice(0, 88)}…` : smtNote}
            </span>
          </>
        )}
        {brief && (
          <>
            <span className="text-[var(--color-border-strong)]">·</span>
            <span>
              Day {brief.score} {brief.verdict.replace("_", " ")}
            </span>
          </>
        )}
        {best?.targets[0] && focus.mode !== "done" && focus.mode !== "failed" && (
          <>
            <span className="text-[var(--color-border-strong)]">·</span>
            <span className="font-mono">
              {best.entryZone.split("(")[0]?.trim()} → {best.targets[0].match(/\d{3,}(?:\.\d+)?/)?.[0] ?? ""}
            </span>
          </>
        )}
        {ghost?.r != null && (ghost.status === "won" || ghost.status === "lost") && (
          <>
            <span className="text-[var(--color-border-strong)]">·</span>
            <span
              className={
                ghost.r >= 0 ? "text-[var(--color-up)]" : "text-[var(--color-down)]"
              }
            >
              Ghost {ghost.r >= 0 ? "+" : ""}
              {ghost.r.toFixed(2)}R
            </span>
          </>
        )}
      </div>

      {children}
    </div>
  );
}
