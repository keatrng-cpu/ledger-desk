import { useEffect, useMemo, useState } from "react";
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
import { HIGH_CONFLUENCE_THRESHOLD, type ScanResult, type SetupCandidate } from "@/lib/trading/scanner";
import { readCardGeometry } from "@/lib/trading/card-geometry";
import { atrOf } from "@/lib/trading/draw";
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
import {
  ghostForCandidate,
  subscribeGhosts,
  type GhostTrade,
} from "@/lib/trading/ghost-book";
import { anticipate } from "@/lib/trading/setup-anticipation";
import type { DrawRead } from "@/lib/trading/draw";
import { cardFreshness, nextLook } from "@/lib/trading/card-freshness";
import { ladderConflict } from "@/lib/trading/ladder-conflict";
import type { TfLadder } from "@/lib/trading/tf-ladder";
import {
  CHART_TFS,
  TF_MARKS,
  TF_ROLE,
  autoTf,
  allSeries,
  marksFor,
  resolveTf,
  type ChartTf,
} from "@/lib/trading/chart-timeframes";
import { scoreDrivers, topDrivers, scoreGap } from "@/lib/trading/score-drivers";
import { SetupMiniChart } from "./setup-mini-chart";
import type { OhlcBar } from "@/lib/market/types";
import type { LiquidityTarget } from "@/lib/trading/draw";

/**
 * Everything a card needs to draw ITS OWN setup, keyed by symbol upstream.
 *
 * WHY THIS IS A PROP AND NOT A FETCH
 * The scanner is a pure render of `ScanResult`. It has never held bars, a
 * quote, or the live sequence, and it should not start: the desk build already
 * owns all three and any second read of them could disagree with the grade on
 * the card. So the tape is handed down from the route that already has it, and
 * every field is optional — a scanner mounted without it (tests, replays,
 * anywhere the desk payload is not in hand) renders exactly the cards it
 * rendered before this existed.
 *
 * `zone`, `sweepLevel` and `deadLayers` come from `smcMaster` — the same object
 * the gate is computed from — because a markup derived from anything else could
 * draw an entry array the sequence never priced.
 */
export interface CardTape {
  bars?: OhlcBar[];
  /**
   * The ladder's 1m series for this book (`desk.mtf[side].minute`), so the
   * card's chart can offer 1m and 5m. It is only ~8h deep, which is why
   * `seriesFor` carries a coverage sentence rather than letting a short window
   * pass for a long one. Absent, the fast rungs grey out instead of being
   * faked from 15m.
   */
  minute?: OhlcBar[];
  /** Freshest quote for this book. Decides `live` versus `armed`. */
  price?: number | null;
  /** Named draw, used only when the candidate does not carry its own. */
  draw?: LiquidityTarget | null;
  pools?: CardPools | null;
  sequence?: CardSequence | null;
  /**
   * The whole draw read, not just the primary. `nextLook` needs the
   * alternates to offer a continuation pool and a reversal pool once a card
   * is spent.
   */
  draws?: DrawRead | null;
  /**
   * This book's timeframe ladder, for the directional cross-check. The
   * engine's HTF gate and the ladder can permit opposite things, and the
   * disagreement measured -0.69R/card on NY AM shadows (n=13) against
   * +0.08R when they agreed. A warning, never a refusal.
   */
  ladder?: TfLadder | null;
}

/**
 * The pools, so the raid can be DRAWN before it happens.
 *
 * Both sides are carried because the tape is keyed by symbol and the card
 * picks by its own side: a long is waiting on SSL, a short on BSL. `lastSide`
 * and `lastLevel` are the raid that already printed — they replace the
 * anticipated pool only when the raid was on the side this card needs, because
 * a BSL raid says nothing about the SSL a long is still waiting for.
 */
export interface CardPools {
  /** Nearest unswept buy-side pool. */
  bsl: number | null;
  /** Nearest unswept sell-side pool. */
  ssl: number | null;
  lastSide: "bsl" | "ssl" | "none";
  lastLevel: number | null;
}

/**
 * The live sequence for this book, straight off smc-master.
 *
 * `side` is carried and checked rather than assumed: smc-master grades ONE
 * side per book, so a card on the other side would otherwise inherit an entry
 * array and a set of failed layers belonging to the opposite trade. On a
 * two-sided session that is not a cosmetic mismatch — it is a markup drawn for
 * a trade nobody is proposing.
 */
export interface CardSequence {
  side: "long" | "short" | null;
  /** The entry array's edges, from the priced plan. */
  zone: { top: number; bottom: number } | null;
  /** smc-master's dealing range, for the EQ mark and the premium/discount tint. */
  dealing?: { high: number; low: number; eq: number } | null;
  /**
   * The priced plan. Entry and stop are drawn only when it exists; the zone
   * and T1 are what `card-freshness.ts` needs to tell a LIVE card from one
   * whose move has already happened.
   */
  plan?: {
    entry: number;
    stop: number;
    entryZone: { top: number; bottom: number } | null;
    t1: number | null;
  } | null;
  /** Layer ids failed for the session — drawn struck through, not dashed. */
  dead: string[];
  /**
   * smc-master's own verdict and layer grades, carried whole.
   *
   * The markup used to recompute "is the sequence complete" from the canon
   * stack's five musts while the desk gates on nine. The flash therefore fired
   * on a weaker gate than TAKE — inside Judas, below the floor, with the R:R
   * unpriced. Nothing downstream recomputes this any more; it is handed over.
   */
  word: "TAKE" | "WAIT" | "STAND";
  mustPass: number;
  mustNeed: number;
  states: Record<string, "pass" | "wait" | "fail">;
}

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

function GhostBanner({ g }: { g: GhostTrade }) {
  const a = g.analysis;
  // Outcome words say WHAT happened to the thesis, never "failed":
  //   won      -> target printed after a fill            (direction right, filled)
  //   missed   -> target printed with NO fill            (direction right, not filled)
  //   lost     -> the invalidation traded after a fill   (a confluence was disrespected)
  //   expired  -> invalidation traded with no fill, or the window closed
  // A miss is not a loss and an invalidation is not "wrong direction" — it is
  // the sweep / HTF / array that price refused to respect. Name that.
  const won = g.status === "won";
  const lost = g.status === "lost";
  const thesisBroke =
    g.status === "expired" && /invalidation/i.test(a?.tag ?? "");
  const missed = g.status === "missed";
  const disrespected = a?.whatFailed?.[0] ?? "invalidation traded";
  const tone = won || missed ? "up" : lost || thesisBroke ? "down" : "warn";
  const label =
    won
      ? `HIT TARGET${g.r != null ? `  ${g.r >= 0 ? "+" : ""}${g.r.toFixed(2)}R` : ""}`
      : lost
        ? `INVALIDATED — ${disrespected}${g.r != null ? `  ${g.r.toFixed(2)}R` : ""}`
        : g.status === "filled"
          ? "IN PLAY — filled, managing"
          : missed
            ? `DIRECTION RIGHT · no fill — ${a?.tag ?? "target printed without you"}`
            : thesisBroke
              ? `THESIS INVALIDATED · never filled — ${disrespected}`
              : `EXPIRED · never filled — ${a?.tag ?? "window closed"}`;
  return (
    <div
      className={cn(
        "mb-2 rounded-[var(--radius-sm)] border px-2.5 py-2",
        tone === "up" &&
          "border-[color-mix(in_oklab,var(--color-up)_45%,var(--color-border))] bg-[color-mix(in_oklab,var(--color-up)_10%,transparent)]",
        tone === "down" &&
          "border-[color-mix(in_oklab,var(--color-down)_45%,var(--color-border))] bg-[color-mix(in_oklab,var(--color-down)_10%,transparent)]",
        tone === "warn" &&
          "border-[color-mix(in_oklab,var(--color-warn)_40%,var(--color-border))] bg-[color-mix(in_oklab,var(--color-warn)_8%,transparent)]",
      )}
    >
      <p
        className={cn(
          "text-[11px] font-semibold uppercase tracking-wide",
          tone === "up" && "text-[var(--color-up)]",
          tone === "down" && "text-[var(--color-down)]",
          tone === "warn" && "text-[var(--color-warn)]",
        )}
      >
        {label}
      </p>
      {a && (
        <div className="mt-1 space-y-1 text-[11px] leading-snug text-[var(--color-fg)]">
          <p className="font-medium">{a.headline}</p>
          {a.why.slice(0, 4).map((w) => (
            <p key={w} className="text-[var(--color-muted)]">
              {w}
            </p>
          ))}
          {a.next && (
            <p className="font-medium text-[var(--color-fg)]">NOW · {a.next}</p>
          )}
          <p className="text-[var(--color-subtle)]">{a.lesson}</p>
        </div>
      )}
    </div>
  );
}

function useGhost(c: SetupCandidate): GhostTrade | null {
  const [g, setG] = useState<GhostTrade | null>(() => ghostForCandidate(c));
  useEffect(() => {
    const sync = () => setG(ghostForCandidate(c));
    sync();
    return subscribeGhosts(sync);
  }, [c.symbol, c.side, c.completeStrategy, c.strategyPrimary]);
  return g;
}

function SetupCard({
  c,
  onLog,
  noteFor,
  entryAllowed = true,
  canon,
  discretion,
  tape,
}: {
  c: SetupCandidate;
  onLog?: (c: SetupCandidate, mode: LogMode) => void;
  /**
   * Builds the pre-filled trade note for this card (Stage 0).
   *
   * A function rather than a string because the note is only wanted when the
   * button is pressed, and building one per card per render would serialise
   * every plan on the board for nothing.
   */
  noteFor?: (c: SetupCandidate) => string;
  entryAllowed?: boolean;
  /** Per-candidate SMC/ICT canon grade — see canonInputForCandidate. */
  canon?: CanonStack;
  /** Per-candidate real discretion factor — see journal/discretion.ts. */
  discretion?: DiscretionResult;
  /** This book's bars and live sequence, for the card's own markup chart. */
  tape?: CardTape;
}) {
  const [noteCopied, setNoteCopied] = useState(false);
  // Read from the card's OWN printed strings, not from the plan — the failure
  // being guarded against is a trader acting on what is on screen.
  const geo = useMemo(
    () =>
      readCardGeometry({
        symbol: c.symbol,
        side: c.side === "short" ? "short" : "long",
        entryZone: c.entryZone,
        invalidation: c.invalidation,
        target: c.targets?.[0] ?? null,
        // ATR from the card's own bars, so the cap is this instrument's at
        // this volatility rather than the legacy fixed point number.
        atr: tape?.bars?.length ? atrOf(tape.bars, 14) : null,
      }),
    [c.symbol, c.side, c.entryZone, c.invalidation, c.targets, tape],
  );
  const [showDetail, setShowDetail] = useState(false);
  /**
   * A rung the trader chose. Null means follow the desk.
   *
   * The pin is deliberately NOT cleared when the setup's state changes: a
   * trader who went to 4h to check bias should stay there until they say
   * otherwise. Auto-switching under someone mid-read is worse than showing
   * them a rung that is no longer the obvious one.
   */
  const [tfPin, setTfPin] = useState<ChartTf | null>(null);
  const ghost = useGhost(c);

  /**
   * The markup, computed once per card per poll.
   *
   * `anticipate` is pure and cheap, but the scanner renders a LIST and the desk
   * repaints every 20 seconds, so it is memoised on the three inputs that can
   * actually change it. The candidate's own draw wins over the book-level one:
   * `c.draw` is the level THIS setup is aimed at, and the book's primary draw
   * can point the other way on a two-sided session.
   */
  const anticipation = useMemo(() => {
    // The pool THIS card is waiting on. A long needs sell-side taken, a short
    // buy-side; the already-printed raid substitutes only when it was on that
    // same side.
    const want = c.side === "long" ? "ssl" : "bsl";
    const p = tape?.pools ?? null;
    const sweepLevel = !p
      ? null
      : p.lastSide === want && p.lastLevel != null
        ? p.lastLevel
        : want === "ssl"
          ? p.ssl
          : p.bsl;
    // Nothing from the sequence is inherited across sides — see CardSequence.
    const seq = tape?.sequence && tape.sequence.side === c.side ? tape.sequence : null;
    return anticipate({
      c,
      canon,
      sequence: seq
        ? { word: seq.word, mustPass: seq.mustPass, mustNeed: seq.mustNeed, states: seq.states }
        : null,
      entryAllowed,
      // `c.draw === null` is the scanner SAYING there is no draw in this
      // direction (scanner.ts pushes "no liquidity draw in trade direction"
      // alongside it). `??` could not tell that deliberate null from the
      // undefined of a book with too few bars, so it substituted the book's
      // primary magnet — which in that case points the wrong way by
      // construction, and the card drew a long a target below its entry.
      draw: c.draw !== undefined ? c.draw : (tape?.draw ?? null),
      price: tape?.price ?? null,
      zone: seq?.zone ?? null,
      sweepLevel,
      deadLayers: seq?.dead,
      // The standing pools, so the slow rungs have magnets to draw rather than
      // only the one raid. Both sides: a short reads the SSL it is aiming at
      // as much as the BSL it is waiting on.
      pools: p ? { bsl: p.bsl, ssl: p.ssl } : null,
      dealing: seq?.dealing ?? null,
      plan: seq?.plan ?? null,
    });
  }, [c, canon, tape]);
  const bars = tape?.bars;
  const zone =
    tape?.sequence && tape.sequence.side === c.side ? tape.sequence.zone : null;

  /**
   * The rung the desk would pick, and the one actually shown.
   *
   * The missing layer is taken from the sequence's own states so a card
   * waiting on a structure fact sends the trader to 1h rather than leaving
   * them staring at 15m for an hour.
   */
  const autoRung = useMemo(() => {
    const states = tape?.sequence?.states;
    const missing = states
      ? (Object.entries(states).find(([, v]) => v !== "pass")?.[0] ?? null)
      : null;
    return autoTf({
      entry: anticipation.entry,
      word: tape?.sequence?.word,
      missingLayer: missing,
    });
  }, [anticipation.entry, tape?.sequence?.states, tape?.sequence?.word]);

  // The wanted rung resolved against what actually has bars. Without this a
  // live card on a desk with no minute series would swap its chart for a
  // paragraph at the exact moment the chart matters most.
  const wanted = tfPin ?? autoRung.tf;

  /**
   * Bars for the chosen rung, built from the two real series this book
   * already carries. Nothing is fetched to switch timeframe.
   */
  const rungs = useMemo(
    () => allSeries(tape?.bars ?? [], tape?.minute ?? []),
    [tape?.bars, tape?.minute],
  );
  const resolved = resolveTf(wanted, rungs);
  const tf = resolved.tf;
  const tfSeries = rungs[tf];

  /**
   * What built this card's score, in marginal points against the real engine.
   * Keyed on the strategy actually graded, because the same components are
   * worth different amounts under different templates.
   */
  /**
   * Why the number is where it is, and what would move it.
   *
   * "Stuck at 0.71 the whole run" is the question this answers: the score
   * grades how the setup FORMED, not how the trade is going, so it does not
   * move because price does. Naming the ceiling and the missing pieces turns
   * a static number into a diagnostic.
   */
  const gap = useMemo(
    () =>
      scoreGap(c.completeStrategy || c.strategyPrimary || "", c.components ?? [], {
        htfOk: c.htfOk,
        killzoneOk: c.killzoneOk,
        conditionsOk: c.conditionsOk,
      }),
    [c.completeStrategy, c.strategyPrimary, c.components, c.htfOk, c.killzoneOk, c.conditionsOk],
  );

  const drivers = useMemo(
    () =>
      scoreDrivers(c.completeStrategy || c.strategyPrimary || "", c.components ?? [], {
        // The session flags the card was graded with. Without them the
        // counterfactual grades a different card: they move fit by up to 0.08
        // and decide which side of the not-complete floor a removal lands on.
        htfOk: c.htfOk,
        killzoneOk: c.killzoneOk,
        conditionsOk: c.conditionsOk,
      }),
    [c.completeStrategy, c.strategyPrimary, c.components, c.htfOk, c.killzoneOk, c.conditionsOk],
  );
  /**
   * Is this card carrying its own markup?
   *
   * It matters beyond the chart itself: the card's existing
   * `flash-high-confluence` pulse fires on the ENGINE score alone, which is the
   * exact signal this markup exists to stop a trader acting on. Where the chart
   * is drawn, the chart owns the flash — green only at `entry === "live"`, when
   * every must has printed and price is in the array. Where it is not drawn
   * (no bars) the old pulse is untouched.
   */
  const chartShown = anticipation.draw && bars != null && bars.length > 0;
  /** Context the chart draws under the tape — same source the marks use. */
  const seqForChart =
    tape?.sequence && tape.sequence.side === c.side ? tape.sequence : null;
  const drawForChart = c.draw !== undefined ? c.draw : (tape?.draw ?? null);

  /**
   * Is this card still describing a trade that has not happened yet?
   *
   * The board refreshes every 20s but a PATH card's levels were computed from
   * a bar close, so a card can keep showing "entry 30,640" long after price
   * has gone through T1 — the move it described is over and the card still
   * reads like an invitation. `cardFreshness` judges it against the SAME live
   * price the HUD renders, and `nextLook` offers the pools either side once it
   * is spent. Both return candidates, never a plan: a continuation still needs
   * its own array and its own invalidation, and reusing the spent card's
   * levels is exactly the late entry this guards against.
   */
  const freshness = useMemo(() => {
    const p = seqForChart?.plan;
    const live = tape?.price;
    if (!p || live == null || !Number.isFinite(live)) return null;
    return cardFreshness(
      {
        side: c.side,
        entry: p.entry,
        entryZone: p.entryZone,
        stop: p.stop,
        t1: p.t1,
      },
      live,
    );
  }, [seqForChart?.plan, tape?.price, c.side]);

  /**
   * Is this card's move already behind price?
   *
   * NOT while the trade is FILLED. A card in play showed "ENTRY GONE" above
   * "IN PLAY — filled, managing": two amber boxes, the first telling the
   * trader not to enter something they are already in, and the management
   * state pushed below it. The spent strip exists to stop a LATE ENTRY, and
   * once you are filled there is no entry left to be late to — what matters
   * then is the stop and the target, which is what the ghost banner carries.
   */
  /** smc-master's word for THIS side, or null when it has no read on it. */
  const seqWord =
    tape?.sequence && tape.sequence.side === c.side ? tape.sequence.word : null;

  const inPlay = ghost?.status === "filled";
  const spent = !inPlay && freshness != null && freshness.state !== "live";

  /**
   * Does the ladder agree with this side?
   *
   * `topDown` is the gate and stays the gate — this reads the ladder from the
   * top rung down and says so when it points the other way. The binary
   * disagreement is what carried information in the shadow measurement; the
   * graded alignment percentage did not, so only the disagreement is shown.
   */
  const conflict = useMemo(
    () => ladderConflict(tape?.ladder ?? null, c.side),
    [tape?.ladder, c.side],
  );

  const look = useMemo(() => {
    if (!spent || !tape?.draws || tape.price == null) return null;
    return nextLook(tape.draws, c.side, tape.price);
  }, [spent, tape?.draws, tape?.price, c.side]);

  /** The chosen rung may have no series even when the card qualifies. */
  const rungHasBars = tfSeries.bars.length > 0;
  /**
   * Marks this rung would actually draw. A rung can legitimately draw none —
   * 1m carries only array/entry/stop, and a card still waiting on its raid has
   * none of them. An unannotated chart then looks broken rather than early, so
   * the empty case is named.
   */
  const rungMarkCount = marksFor(tf, anticipation.marks).length;
  const done =
    ghost &&
    (ghost.status === "won" ||
      ghost.status === "lost" ||
      ghost.status === "missed" ||
      ghost.status === "expired");
  return (
    <article
      className={cn(
        "rounded-[var(--radius-md)] border bg-[var(--color-surface)] p-3 sm:p-4",
        ghost?.status === "won" &&
          "border-[color-mix(in_oklab,var(--color-up)_55%,var(--color-border))] bg-[color-mix(in_oklab,var(--color-up)_6%,var(--color-surface))]",
        ghost?.status === "lost" &&
          "border-[color-mix(in_oklab,var(--color-down)_50%,var(--color-border))]",
        !ghost?.status &&
          (c.actionable
            ? "border-[color-mix(in_oklab,var(--color-up)_35%,var(--color-border))]"
            : "border-[var(--color-border)]"),
        ghost?.status === "watching" && "border-[var(--color-border)]",
        ghost?.status === "filled" &&
          "border-[color-mix(in_oklab,var(--color-warn)_45%,var(--color-border))]",
        // High-confluence flash: only while the card is still a live decision
        // (no ghost yet, or still watching) — a resolved won/lost/missed card
        // flashing "hot" would be reporting urgency that already passed. And
        // never alongside the markup, which flashes on the sequence instead.
        c.confluence >= HIGH_CONFLUENCE_THRESHOLD &&
          !chartShown &&
          (!ghost || ghost.status === "watching") &&
          "flash-high-confluence",
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
            {ghost?.status === "won" && (
              <span className="inline-flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-[var(--color-up)]">
                <CheckCircle2 className="h-3 w-3" /> hit target
              </span>
            )}
            {ghost?.status === "lost" && (
              <span className="inline-flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-[var(--color-down)]">
                invalidated
              </span>
            )}
            {ghost?.status === "missed" && (
              <span className="inline-flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-[var(--color-up)]">
                direction right · no fill
              </span>
            )}
            {/* "ACTIONABLE" is the SCANNER's word, and it was printed as a
                green tick beside "SMC skip · 2/5" — a go signal sitting next
                to the gate that refuses it. Both are true of different
                things, and on one card they read as the desk contradicting
                itself. The tick is now reserved for the case where the
                sequence AGREES; otherwise it says whose opinion it is and
                wears the muted colour, because a green check is a
                permission and the sequence has not given one. */}
            {!done && c.actionable && entryAllowed && (
              seqWord === "TAKE" ? (
                <span className="inline-flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-[var(--color-up)]">
                  <CheckCircle2 className="h-3 w-3" /> actionable
                </span>
              ) : (
                <span
                  title={`The scanner grades this ${c.grade}, but the SMC sequence says ${seqWord ?? "no read"}. TAKE needs both.`}
                  className="inline-flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-[var(--color-subtle)]"
                >
                  engine only · SMC {seqWord?.toLowerCase() ?? "—"}
                </span>
              )
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
          <p
            className={cn(
              "text-2xl font-semibold leading-none tabular",
              c.confluence >= HIGH_CONFLUENCE_THRESHOLD
                ? "text-[var(--color-up)]"
                : "text-[var(--color-fg)]",
            )}
          >
            {c.confluence.toFixed(2)}
          </p>
          <p
            className={cn(
              "mt-0.5 text-[9px] uppercase tracking-wider",
              c.confluence >= HIGH_CONFLUENCE_THRESHOLD
                ? "font-semibold text-[var(--color-up)]"
                : "text-[var(--color-subtle)]",
            )}
          >
            {c.confluence >= HIGH_CONFLUENCE_THRESHOLD
              ? `≥${(HIGH_CONFLUENCE_THRESHOLD * 100).toFixed(0)}% engine`
              : "engine"}
          </p>
        </div>
      </div>

      <ScoreMeter score={c.confluence} />

      {/* ONE line: where the number can still go, and what is holding it.
          The full reasoning is on hover — this answers "why is it stuck"
          without re-filling the card with paragraphs. */}
      <p
        title={gap.line}
        className="mt-0.5 font-mono text-[9px] leading-snug text-[var(--color-subtle)]"
      >
        {gap.clamped ? (
          <span className="text-[var(--color-warn)]">
            held by the completeness clamp — {gap.wouldMove[0]?.label ?? "a must-layer"} missing
            (+{(gap.wouldMove[0]?.worth ?? 0).toFixed(2)})
          </span>
        ) : gap.gap <= 0.005 ? (
          <>at this strategy's ceiling on this tape — it moves only if a component is lost</>
        ) : (
          <>
            ceiling {gap.ceiling.toFixed(2)} here · {gap.wouldMove.length} missing worth{" "}
            {gap.gap.toFixed(2)}
            {gap.wouldMove[0] && ` · biggest ${gap.wouldMove[0].label} +${gap.wouldMove[0].worth.toFixed(2)}`}
          </>
        )}
      </p>

      {/* LADDER DISAGREEMENT. Above the chart because it changes whether to
          look at the chart at all. A suggested half size and a second look —
          n=13 in the losing bucket supports "be careful" and nothing more, so
          this never refuses and never touches the grade. */}
      {/* COUNTER-BIAS WATCH. The HTF gate is holding, and this says how close
          it is to releasing rather than only that it refused. Every figure
          here was already computed by biasDisrespect and thrown away. It is
          NOT a trade: the gate is absolute until all four print, and this card
          stays non-actionable. It is the sign the desk had and was not
          showing. */}
      {!c.actionable && (c.htfRelease?.met ?? 0) >= 2 && c.htfRelease && (
        <div className="mt-2 rounded-[var(--radius-sm)] border border-[color-mix(in_oklab,var(--color-accent)_50%,transparent)] bg-[color-mix(in_oklab,var(--color-accent)_8%,transparent)] px-2 py-1.5">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--color-accent)]">
            Counter-bias forming · {c.htfRelease.met}/{c.htfRelease.of} to release · not a trade
          </p>
          <ul className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5">
            {c.htfRelease.checks.map((x) => (
              <li
                key={x.id}
                className={cn(
                  "font-mono text-[9px]",
                  x.pass ? "text-[var(--color-up)]" : "text-[var(--color-subtle)]",
                )}
              >
                {x.pass ? "✓" : "○"} {x.label}
              </li>
            ))}
          </ul>
          <p className="mt-1 text-[10px] leading-snug text-[var(--color-fg)]">
            {c.htfRelease.reason}
          </p>
        </div>
      )}

      {conflict.warn && (
        // ONE line, with the full reasoning on hover. This printed five
        // sentences on every card — the identical paragraph twice when both
        // books were shorts against a bull ladder — which is how a warning
        // carrying a measured -0.69R/card gets tuned out.
        <div
          title={conflict.line}
          className="mt-2 flex items-baseline gap-1.5 rounded-[var(--radius-sm)] border border-[color-mix(in_oklab,var(--color-down)_55%,transparent)] bg-[color-mix(in_oklab,var(--color-down)_10%,transparent)] px-2 py-1"
        >
          <span className="shrink-0 text-[9px] font-semibold uppercase tracking-wider text-[var(--color-down)]">
            Ladder {conflict.sizeMult}×
          </span>
          <span className="text-[10px] leading-snug text-[var(--color-fg)]">
            {conflict.headline}
          </span>
        </div>
      )}

      {/* SPENT-CARD STRIP. A card whose move already happened is not a
          setup — it is history wearing a score. Say so above everything else
          on the card, and name what is worth looking at instead. */}
      {freshness && spent && (
        <div className="mt-2 rounded-[var(--radius-sm)] border border-[color-mix(in_oklab,var(--color-warn)_55%,transparent)] bg-[color-mix(in_oklab,var(--color-warn)_10%,transparent)] px-2 py-1.5">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--color-warn)]">
            {freshness.state === "target_hit"
              ? "Target already printed"
              : freshness.state === "entry_gone"
                ? "Entry gone"
                : "Side stale"}
          </p>
          <p className="mt-0.5 text-[10px] leading-snug text-[var(--color-fg)]">
            {freshness.line}
          </p>
          {look && (
            <p className="mt-1 border-t border-[color-mix(in_oklab,var(--color-warn)_30%,transparent)] pt-1 text-[10px] leading-snug text-[var(--color-subtle)]">
              {look.line}
              {/* Candidates, not plans — each needs a fresh array and a fresh
                  invalidation before it is a trade. */}
              <span className="ml-1 text-[var(--color-subtle)]">
                Re-run the sequence; do not reuse these levels.
              </span>
            </p>
          )}
        </div>
      )}

      <div className="mt-2.5" />
      {ghost && ghost.status !== "watching" ? (
        <GhostBanner g={ghost} />
      ) : (
        <BlockerStrip c={c} entryAllowed={entryAllowed} />
      )}

      {/* THE MARKUP — this card's own setup, drawn the way an SMC trader marks
          one before it exists: the pool, the raid, the displacement and the
          entry array all on the chart, each carrying whether it has PRINTED, is
          AWAITED, or is DEAD for the session. Two qualifying cards means two
          charts, so ES short and MNQ long are each drawn as their own setup
          rather than sharing one picture of whichever book the desk picked.
          `anticipation.draw` is the threshold (setup-anticipation.ts), and no
          bars means no chart — the card is then exactly what it was before. */}
      {chartShown && bars && (
        <div className="mb-2">
          {/* THE RUNG SWITCH. Five timeframes off two real series — nothing is
              fetched to change it. A rung whose series is absent is disabled
              rather than silently falling back, because a 1m button that
              quietly shows 15m is the worst of both. */}
          <div className="mb-1 flex items-center gap-1">
            {CHART_TFS.map((t) => {
              const has = rungs[t].bars.length > 0;
              const active = t === tf;
              const isAuto = !tfPin && t === autoRung.tf;
              return (
                <button
                  key={t}
                  type="button"
                  disabled={!has}
                  // Toggle against the PIN, not against the resolved rung.
                  // When resolveTf substitutes (wanted 1m, no minute series →
                  // 15m), the 15m button is highlighted; comparing to the
                  // resolved rung made that click UNPIN instead of pinning.
                  onClick={() => setTfPin(tfPin === t ? null : t)}
                  title={
                    has
                      ? `${TF_ROLE[t]}${isAuto ? ` — the desk picked this: ${autoRung.why}` : ""}`
                      : `No series for ${t} on this book.`
                  }
                  className={cn(
                    "rounded-[var(--radius-sm)] border px-1.5 py-0.5 font-mono text-[9px] leading-none transition-colors",
                    active
                      ? "border-[var(--color-accent)] bg-[var(--color-accent)]/12 text-[var(--color-accent)]"
                      : has
                        ? "border-[var(--color-border)] text-[var(--color-subtle)] hover:text-[var(--color-fg)]"
                        : "cursor-not-allowed border-[var(--color-border)]/50 text-[var(--color-subtle)]/35",
                  )}
                >
                  {t}
                  {isAuto && <span aria-hidden> •</span>}
                </button>
              );
            })}
            {tfPin && (
              <button
                type="button"
                onClick={() => setTfPin(null)}
                title="Follow the desk again"
                className="ml-auto rounded-[var(--radius-sm)] px-1 py-0.5 font-mono text-[9px] leading-none text-[var(--color-subtle)] hover:text-[var(--color-fg)]"
              >
                auto
              </button>
            )}
          </div>

          {rungHasBars ? (
            <SetupMiniChart
              bars={tfSeries.bars}
              a={anticipation}
              zone={zone}
              tf={tf}
              drivers={drivers}
              lastBarPartial={tfSeries.lastBarPartial}
              range={seqForChart?.dealing ?? null}
              drawPrice={drawForChart?.price ?? null}
              cePrice={seqForChart?.plan?.entry ?? null}
            />
          ) : (
            <p className="rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2 py-3 text-[10px] leading-snug text-[var(--color-subtle)]">
              {tfSeries.coverage}
            </p>
          )}

          {/* What this rung is read for, and what it is actually covering.
              The coverage line matters most on 5m, where the window is the 1m
              window (~8h) and not the days a 5m chart usually implies. */}
          <p className="mt-1 text-[9px] leading-snug text-[var(--color-subtle)]">
            <span className="text-[var(--color-fg)]">{TF_MARKS[tf].reads}</span>
            {resolved.substituted && (
              <span className="text-[var(--color-warn)]"> {resolved.why}</span>
            )}
            {rungHasBars && <> {tfSeries.coverage}</>}
            {rungHasBars && rungMarkCount === 0 && (
              <>
                {" "}
                <span className="text-[var(--color-subtle)]">
                  Nothing to mark here yet — this rung draws{" "}
                  {TF_MARKS[tf].kinds.join(", ")}, and the sequence has not
                  priced any of them.
                </span>
              </>
            )}
          </p>

          {/* THE SCORE, ITEMISED. Marginal points against the real engine, so
              the figures answer "how much of this score rests on that mark?"
              A redundant any-of member shows 0 and says so rather than
              double-counting a point with its sibling. */}
          {TF_MARKS[tf].context.includes("score_drivers") && drivers.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5">
              {topDrivers(drivers, 6).map((d) => (
                <span
                  key={d.key}
                  title={`${d.what || d.label} — worth ${d.pts100.toFixed(1)} pts of this score (${d.channel}).`}
                  className="font-mono text-[9px] leading-none text-[var(--color-subtle)]"
                >
                  {d.label}
                  <span className="text-[var(--color-fg)]"> {d.pts100.toFixed(0)}p</span>
                </span>
              ))}
              {drivers.some((d) => d.channel === "anyof-redundant") && (
                <span
                  title="Present on the tape but marginally free — a sibling already satisfies the same any-of group, so removing it would not move the score."
                  className="font-mono text-[9px] leading-none text-[var(--color-subtle)]/70"
                >
                  +
                  {drivers.filter((d) => d.channel === "anyof-redundant").length} redundant
                </span>
              )}
            </div>
          )}
        </div>
      )}

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

      {/*
        THE GEOMETRY OF THE LEVELS THIS CARD IS PRINTING.

        On 2026-09-25 the board showed an A+ 0.80 card whose own numbers were
        0.11R, an A+ 0.78 at 0.31R with a stop 8.4x the instrument cap, and a
        B 0.82 short whose invalidation sat BELOW its entry. The only takeable
        geometry on the screen belonged to the lowest-graded card.

        The confluence score says how much structure is present. It has never
        said whether the levels form a trade, and `scanner.ts` builds
        `invalidation` as PDL/PDH — a structural landmark that is not measured
        from the entry and can sit on the wrong side of it entirely.

        So the check is against exactly what the trader can see, and it sits
        directly above the buttons, because that is where the money is lost.
      */}
      {geo.line && (
        <div
          className={
            geo.refuse
              ? "mb-2 rounded-[var(--radius-sm)] border border-[var(--color-down)] bg-[color-mix(in_oklab,var(--color-down)_10%,transparent)] px-2.5 py-2"
              : "mb-2 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-bg)]/40 px-2.5 py-1.5"
          }
        >
          <p
            className={
              geo.refuse
                ? "text-[10px] font-semibold leading-snug text-[var(--color-down)]"
                : "text-[10px] leading-snug text-[var(--color-subtle)]"
            }
          >
            {geo.refuse ? "DO NOT SIZE FROM THIS CARD — " : "Geometry · "}
            {geo.line}
          </p>
        </div>
      )}

      {/* ROW 3 — actions, full width and unambiguous. The paper button used to
          render its label twice ("Log paper 📝 Paper"). */}
      {onLog && !done && (
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

      {/*
        STAGE 0 — the row that does not exist yet.

        `src/data/trade-log.json` contains ONE trade against 2,188 backtested
        ones. The reason is not discipline: logging means hand-typing twenty
        fields into log-trade.mjs's template, after the session, about a trade
        that is already over. The live book is on Robinhood, which has no API
        this desk can reach, so the honest fix is to write the note FOR the
        trader and leave only the fields the desk cannot know.

        Copies a pre-filled note to the clipboard. The desk fills the date,
        time, symbol, side, every plan level, the word it printed and which
        must-layers were short. It leaves entry_fill, exit_fill, exit_reason
        and pnl EMPTY, because an invented fill in a log is worse than no log.
      */}
      {noteFor && (
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard?.writeText(noteFor(c));
            setNoteCopied(true);
            window.setTimeout(() => setNoteCopied(false), 2200);
          }}
          className="mb-2 w-full rounded-[var(--radius-sm)] border border-dashed border-[var(--color-border)] px-2.5 py-1.5 text-left text-[10px] leading-snug text-[var(--color-subtle)] hover:border-[var(--color-primary)] hover:text-[var(--color-fg)]"
          title="Copies a note with every field the desk knows already filled in. Paste to a file and run: npx tsx scripts/log-trade.mjs <file>"
        >
          {noteCopied ? (
            <span className="text-[var(--color-up)]">
              Copied — paste to a file, fill the 4 blanks, then{" "}
              <code>npx tsx scripts/log-trade.mjs &lt;file&gt;</code>
            </span>
          ) : (
            <>
              Copy trade note{" "}
              <span className="text-[var(--color-muted)]">
                — pre-filled; you add the fills only
              </span>
            </>
          )}
        </button>
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
  noteFor,
  entryAllowed = true,
  bias,
  narrative,
  clock,
  discretion,
  tape,
}: {
  scan: ScanResult;
  onLog?: (c: SetupCandidate, mode: LogMode) => void;
  /** Stage 0 — see SetupCard. Threaded straight through. */
  noteFor?: (c: SetupCandidate) => string;
  entryAllowed?: boolean;
  /** Per-book HTF read — matched to each candidate by symbol for its own canon grade. */
  bias?: { left: HtfBiasRead; right: HtfBiasRead };
  /** Per-book liquidity/confirmation narrative — same matching. */
  narrative?: { left: MarketNarrative; right: MarketNarrative };
  clock?: { inTradeWindow: boolean; killzoneLabel: string };
  /** Real per-strategy sizing factor (journal/discretion.ts via getDiscretionState). */
  discretion?: DiscretionPayload | null;
  /**
   * Bars and live sequence per SYMBOL, for each card's own markup chart.
   * Omitted anywhere the desk payload is not in hand; the cards then render
   * exactly as they did before the markup existed.
   */
  tape?: Record<string, CardTape>;
}) {
  const fusedSetups = useDeskSynapse((s) => s.fusedSetups);
  const boosts = useDeskSynapse((s) => s.strategyBoosts);
  const rankCandidates = useDeskSynapse((s) => s.rankCandidates);
  const tradeFeed = useDeskSynapse((s) => s.feeds.trade);

  const [pathOnly, setPathOnly] = useState(true);
  /**
   * A counter-bias side that is PART WAY to releasing the HTF gate.
   *
   * "Path grades only" hid these completely: the gated side is not actionable
   * and does not carry a PATH band, so a reversal with the raid and the
   * displacement already printed was filtered out and the trader saw no sign
   * the desk had even considered it. That is the miss — the desk graded the
   * long, refused it, and said nothing.
   *
   * Two of four is the bar. One check is noise (a lone sweep happens all
   * session); two means manipulation AND distribution have printed and only
   * the lagging confirmations — structure and the LTF reads — are outstanding.
   * Showing it changes NO gate: it is still not actionable, and it is badged
   * as a watch.
   */
  const formingReversal = (c: SetupCandidate) =>
    !c.actionable && (c.htfRelease?.met ?? 0) >= 2;

  const shown = pathOnly
    ? rankCandidates(scan.candidates).filter(
        (c) => c.actionable || formingReversal(c) || c.pathBand === "A+" || c.pathBand === "A" || c.pathBand === "A-" || c.pathBand === "B+" || c.grade === "A+" || c.grade === "A-",
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
            noteFor={noteFor}
            entryAllowed={entryAllowed}
            canon={guidedById.get(c.id)?.canon}
            discretion={guidedById.get(c.id)?.disc}
            tape={tape?.[c.symbol]}
          />
        ))}
      </div>
    </section>
  );
}
