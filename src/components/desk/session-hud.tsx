import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
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
import { weekAheadFocusLine } from "@/lib/trading/week-ahead";
import { monthAheadFocusLine } from "@/lib/trading/month-ahead";
import { pricePathHudLine, pricePathVerdict } from "@/components/desk/price-path-board";
import { shockSiren } from "@/lib/alerts/path-alarm";
import { cn } from "@/lib/utils";

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
        {price.toLocaleString(undefined, { maximumFractionDigits: 2 })}
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
  const { clock, risk, scan, quotes, left, right, brief, smtStack } = desk;
  const [ghosts, setGhosts] = useState<GhostTrade[]>(() => todayGhosts());
  const [lastDebrief, setLastDebrief] = useState(() =>
    typeof window !== "undefined" ? loadLastDebrief() : null,
  );
  const [paperReady, setPaperReady] = useState(false);
  useEffect(() => subscribeGhosts(() => setGhosts(todayGhosts())), []);
  useEffect(
    () =>
      subscribeDebriefs(() => setLastDebrief(loadLastDebrief())),
    [],
  );
  useEffect(() => setPaperReady(true), []);

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
  const pathV = pricePathVerdict(desk, paperReady);

  // Tape circuit breaker: siren ONCE on the transition into a shock, and a
  // live countdown so the strip re-renders every second while locked.
  const shock = desk.shock;
  const lastShockAt = useRef<number | null>(null);
  useEffect(() => {
    if (shock?.active && shock.at && lastShockAt.current !== shock.at) {
      lastShockAt.current = shock.at;
      try {
        shockSiren();
      } catch {
        /* audio blocked before a user gesture — the strip still shows */
      }
    }
    if (!shock?.active) lastShockAt.current = shock?.at ?? lastShockAt.current;
  }, [shock?.active, shock?.at]);
  const [, forceTick] = useState(0);
  useEffect(() => {
    if (!paperReady || (!shock?.active && !shock?.tail)) return;
    const id = setInterval(() => forceTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [paperReady, shock?.active, shock?.tail]);
  // Date.now() only after mount — during SSR/first hydration paperReady is
  // false, so the countdown text is absent on both server and client (no
  // hydration mismatch); it appears once the client takes over.
  const shockLeftMs =
    !paperReady
      ? 0
      : shock?.active && shock.lockUntilMs
        ? shock.lockUntilMs - Date.now()
        : shock?.tail && shock.tailUntilMs
          ? shock.tailUntilMs - Date.now()
          : 0;
  const shockMmss =
    shockLeftMs > 0
      ? `${Math.floor(shockLeftMs / 60_000)}:${String(Math.floor((shockLeftMs % 60_000) / 1000)).padStart(2, "0")}`
      : "0:00";

  /**
   * ONE verdict, in the order a trader needs it: a position you HOLD first,
   * then a TAKE, then a stand-down, then the wait.
   *
   * Hindsight used to outrank all of it. A debrief under two hours old, or the
   * focus card's ghost resolving won/lost, took the headline — so the HUD
   * could be reporting a shadow trade nobody took while a TAKE printed. And a
   * ghost that "filled" said IN PLAY · "Do not add" without checking whether
   * the trader ever took it. Hindsight now rides in the detail line, labelled
   * as hindsight; IN PLAY is only ever a position that exists.
   */
  const focus = useMemo((): {
    mode: "go" | "live" | "wait" | "stand" | "done" | "failed";
    line: string;
    detail: string;
  } => {
    const freshDebrief =
      lastDebrief && Date.now() - lastDebrief.at < 2 * 3600_000
        ? lastDebrief
        : null;
    const hindsight =
      freshDebrief && (freshDebrief.result === "win" || freshDebrief.result === "loss")
        ? `Last trade · ${freshDebrief.headline}`
        : (ghost?.status === "won" || ghost?.status === "lost") && ghost.analysis
          ? `Shadow (${ghost.taken ? "taken" : "not taken"}) · ${ghost.analysis.headline}`
          : null;

    if (pathV.word === "MANAGE") {
      return { mode: "live" as const, line: pathV.line, detail: "Do not add. Let the plan work." };
    }
    if (ghost?.status === "filled" && ghost.taken) {
      return {
        mode: "live" as const,
        line: `${ghost.symbol} ${ghost.side.toUpperCase()} in play · stop ${ghost.stop.toFixed(2)} · tp ${ghost.tp1.toFixed(2)}`,
        detail: "Do not add. Let the plan work.",
      };
    }
    // ONE verdict. The GO pill used to read `best.actionable` on its own,
    // which ignores Judas, news, the SMC sequence, the 0.65 floor and the
    // one-book rule that the draw line already applies — so the HUD could
    // say GO and TAKE/STAND different things at the same time.
    if (pathV.word === "TAKE") {
      return {
        mode: "go" as const,
        line: pathV.line,
        detail: best?.strategyWhy[0] ?? best?.reasons[0] ?? scan.focus,
      };
    }
    if (brief?.verdict === "stand_down") {
      return {
        mode: "stand" as const,
        line: brief.headline,
        detail: hindsight ?? brief.standDownReasons[0] ?? brief.reasons[0] ?? "",
      };
    }
    return {
      mode: "wait" as const,
      line: pathV.line,
      detail: hindsight ?? best?.missing.slice(0, 2).join(" · ") ?? "",
    };
  }, [ghost, brief, best, scan.focus, lastDebrief, pathV.word, pathV.line]);

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
          ? "INVALID"
          : focus.mode === "live"
            ? "IN PLAY"
            : focus.mode === "stand"
              ? "STAND"
              : "WAIT";

  return (
    <div className="sticky top-[var(--grok-banner-h,0px)] z-20 -mx-4 border-b border-[var(--color-border)] bg-[color-mix(in_oklab,var(--color-bg)_94%,transparent)] px-4 py-2 backdrop-blur-md sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
      {synthetic && (
        <div className="mx-auto mb-2 flex max-w-7xl items-center gap-2 rounded-[var(--radius-md)] border border-[var(--color-down)] bg-[color-mix(in_oklab,var(--color-down)_18%,transparent)] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-down)]">
          <AlertOctagon className="h-3.5 w-3.5 shrink-0" />
          SYNTHETIC DATA — no live feed; structure/scanner untrustworthy
        </div>
      )}
      {paperReady && shock?.active && (
        <div className="mx-auto mb-2 flex max-w-7xl items-center gap-2 rounded-[var(--radius-md)] border border-[var(--color-down)] bg-[color-mix(in_oklab,var(--color-down)_22%,transparent)] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-down)]">
          <AlertOctagon className="h-3.5 w-3.5 shrink-0" />
          {shock.line} · STAND DOWN {shockMmss} — impulse is the news, not the model. Second impulse only.
        </div>
      )}
      {paperReady && !shock?.active && shock?.tail && (
        <div className="mx-auto mb-2 flex max-w-7xl items-center gap-2 rounded-[var(--radius-md)] border border-[color-mix(in_oklab,var(--color-warn)_45%,var(--color-border))] bg-[color-mix(in_oklab,var(--color-warn)_10%,transparent)] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-warn)]">
          <AlertOctagon className="h-3.5 w-3.5 shrink-0" />
          Post-shock tail {shockMmss} — A+ only, fresh sequence after the shock. {shock.line}
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

        {monthAheadFocusLine(desk.monthAhead) && (
          <div className="hidden max-w-[180px] truncate rounded-full border border-[color-mix(in_oklab,var(--color-warn)_35%,var(--color-border))] px-3 py-1.5 text-[11px] text-[var(--color-warn)] xl:block">
            {monthAheadFocusLine(desk.monthAhead)}
          </div>
        )}

        {weekAheadFocusLine(desk.weekAhead) && (
          <div className="hidden max-w-[220px] truncate rounded-full border border-[color-mix(in_oklab,var(--color-warn)_35%,var(--color-border))] px-3 py-1.5 text-[11px] text-[var(--color-warn)] lg:block">
            {weekAheadFocusLine(desk.weekAhead)}
          </div>
        )}

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
        <span
          className={cn(
            "font-mono text-[11px] font-semibold",
            pathV.word === "TAKE" && "text-[var(--color-up)]",
            pathV.word === "MANAGE" && "text-[var(--color-warn)]",
            pathV.word === "STAND" && "text-[var(--color-muted)]",
          )}
        >
          {pricePathHudLine(desk, paperReady)}
        </span>
        {smtNote && (
          <>
            <span className="text-[var(--color-border-strong)]">·</span>
            <span className={smtBear ? "text-[var(--color-down)]" : "text-[var(--color-up)]"}>
              {smtNote.length > 64 ? `${smtNote.slice(0, 64)}…` : smtNote}
            </span>
          </>
        )}
      </div>

      {children}
    </div>
  );
}
