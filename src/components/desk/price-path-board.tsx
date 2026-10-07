import { StateWord } from "@/components/desk/state-word";
/**
 * Instant "where is price going" — HTF + dealing + draw + PATH, both books.
 * One glance. Not a trigger. Hard gates still live on the scanner.
 */
import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import type { DeskPayload } from "@/lib/trading/build-desk";
import type { DrawRead, LiquidityTarget } from "@/lib/trading/draw";
import type { HtfBiasRead } from "@/lib/trading/structure";
import type { SetupCandidate } from "@/lib/trading/scanner";
import type { SmcMasterBook } from "@/lib/trading/smc-master";
import { MustRing } from "@/components/desk/viz/must-ring";
import { FitGauge } from "@/components/desk/viz/fit-gauge";
import { PriceLadder, ladderFrom } from "@/components/desk/viz/price-ladder";
import { Plain } from "@/components/desk/plain-text";
import { isHighProbPath } from "@/lib/alerts/path-alarm";
import { etWallParts, isJudasWindow, sessionLive} from "@/lib/trading/sessions";
import { readJudas } from "@/lib/trading/judas-window";
import { allSeries } from "@/lib/trading/chart-timeframes";
import { bookTakenToday, listOpenPaperTrades } from "@/lib/trading/paper-manager";
import { cn } from "@/lib/utils";

function px(n: number): string {
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function tone(b: string): string {
  if (b === "bull" || b === "above") return "text-[var(--color-up)]";
  if (b === "bear" || b === "below") return "text-[var(--color-down)]";
  return "text-[var(--color-subtle)]";
}

function DrawLine({ t, last }: { t: LiquidityTarget | null; last: number }) {
  if (!t) {
    return <p className="text-[13px] text-[var(--color-muted)]">No magnet</p>;
  }
  const pts = Math.abs(t.price - last);
  const Arrow = t.side === "below" ? ArrowDown : ArrowUp;
  return (
    <p className={cn("flex flex-wrap items-baseline gap-x-1.5 font-mono text-base", tone(t.side))}>
      <Arrow className="h-4 w-4 shrink-0 self-center" />
      <span className="font-semibold">{px(t.price)}</span>
      <Plain className="text-[13px] text-[var(--color-fg)]">{t.name}</Plain>
      <span className="text-[12px] text-[var(--color-muted)]">
        {pts.toFixed(1)}pt · {(t.reachProbability * 100).toFixed(0)}%
      </span>
    </p>
  );
}

function BookCol({
  bias,
  draw,
  last,
  path,
  preferred,
  seq,
}: {
  bias: HtfBiasRead;
  draw: DrawRead;
  last: number;
  path: SetupCandidate | undefined;
  preferred: boolean;
  /** This book's SMC sequence — its must-layers draw the ring (replaces the ●○× row). */
  seq: SmcMasterBook | undefined;
}) {
  // The numeric plan for the ladder: the card's own priced plan first (same
  // object the ticket and paper book read), else the sequence's plan for this
  // book when it is on the card's side. No plan → the original text grid.
  const ladderPlan = path?.plan ?? (seq?.plan && (!path || seq.plan.side === path.side) ? seq.plan : null);
  const fight =
    (bias.topDown === "bear" && bias.dealing?.zone === "discount") ||
    (bias.topDown === "bull" && bias.dealing?.zone === "premium");
  const aligned =
    (bias.topDown === "bear" && draw.primary?.side === "below") ||
    (bias.topDown === "bull" && draw.primary?.side === "above");

  return (
    <div
      className={cn(
        "rounded-[var(--radius-md)] border px-3 py-2.5",
        preferred
          ? "border-[color-mix(in_oklab,var(--color-primary)_45%,var(--color-border))] bg-[color-mix(in_oklab,var(--color-primary)_8%,var(--color-surface))]"
          : "border-[var(--color-border)] bg-[var(--color-surface)]",
      )}
    >
      <div className="mb-1 flex items-center justify-between gap-2">
        <p className="font-mono text-sm font-semibold text-[var(--color-fg)]">
          {bias.symbol}{" "}
          <span className="text-[11px] font-normal text-[var(--color-muted)]">{px(last)}</span>
        </p>
        <span className={cn("font-mono text-[11px] font-bold uppercase", tone(bias.topDown))}>
          HTF {bias.topDown}
        </span>
      </div>
      {seq && (
        <div className="mb-2 flex items-center gap-3">
          <MustRing layers={seq.layers} size={68} />
          <div className="min-w-0 flex-1">
            <FitGauge fit={path?.confluence ?? null} vetoes={path?.vetoes} compact />
            {seq.word !== "TAKE" && (
              <p className="mt-0.5 text-[12px] leading-snug text-[var(--color-muted)]">
                <span className="font-semibold text-[var(--color-warn)]">
                  <Plain>{seq.missing}</Plain>
                </span>
                {seq.missingDetail ? (
                  <>
                    {" — "}
                    <Plain>{seq.missingDetail}</Plain>
                  </>
                ) : null}
              </p>
            )}
          </div>
        </div>
      )}
      <p className="mb-1.5 text-[12px] text-[var(--color-muted)]">
        <span className={fight ? "text-[var(--color-warn)]" : ""}>
          {bias.dealing?.zone ?? "n/a"}
        </span>
        {" · sess "}
        <span className={tone(bias.sessionStance)}>{bias.sessionStance}</span>
        {fight ? " · location fights HTF" : aligned ? " · draw agrees" : ""}
        {preferred ? " · ONE BOOK" : ""}
      </p>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-muted)]">
        Draw
      </p>
      <DrawLine t={draw.primary} last={last} />
      {draw.primary && (draw.primary.side === "below" ? draw.above : draw.below) && (
        <p className="mt-0.5 text-[12px] text-[var(--color-muted)]">
          Opp{" "}
          {px((draw.primary.side === "below" ? draw.above : draw.below)!.price)}{" "}
          {(draw.primary.side === "below" ? draw.above : draw.below)!.name}
        </p>
      )}
      <p
        className={cn(
          "mt-1.5 text-[13px]",
          // Was `confluence >= HIGH_CONFLUENCE_THRESHOLD` (0.9) — a raw score
          // gate a real A+/A/A- TAKE routinely sits under, since 0.75 (the
          // A+ tag) is well below it: an actionable A+ at Q 0.76 never
          // flashed. `actionable` is the same gate-cleared check the chart's
          // own flash already uses (chart-overlay.ts: word === "TAKE"), so
          // this board and the chart agree on what "hot" means, and
          // flash-take (not the weaker flash-high-confluence glow — see
          // styles.css) is the class the codebase already reserves for a
          // real, gate-cleared signal.
          path?.actionable
            ? "flash-take rounded-[var(--radius-sm)] font-semibold text-[var(--color-up)]"
            : "text-[var(--color-muted)]",
        )}
      >
        {path ? (
          <>
            PATH {path.side} {path.pathBand || path.grade} Q {path.confluence.toFixed(2)}
            {path.actionable ? "" : " · not armed"}
          </>
        ) : (
          "No PATH card"
        )}
      </p>
      {/* FORMING REVERSAL, ON THE TOP BOARD TOO. Before this, the only place
          "the counter-bias gate is most of the way to releasing" showed at
          all was a per-candidate panel buried in the scanner list below —
          the board a trader glances at first said only "not armed" for a
          setup that had already printed the raid and the displacement and
          was two lagging swing-confirmations away from a real release. Same
          data (scanner.ts's biasDisrespect, carried on the candidate as
          htfRelease), surfaced where the eye actually goes. Never green,
          never a trade — see setup-scanner.tsx's identical panel. */}
      {path && !path.actionable && (path.htfRelease?.met ?? 0) >= 2 && path.htfRelease && (
        <p
          className="mt-1 rounded-[var(--radius-sm)] border border-[color-mix(in_oklab,var(--color-accent)_50%,transparent)] bg-[color-mix(in_oklab,var(--color-accent)_8%,transparent)] px-1.5 py-1 text-[10px] font-semibold text-[var(--color-accent)]"
          title={path.htfRelease.reason}
        >
          Bias forming to flip · {path.htfRelease.met}/{path.htfRelease.of} · not a trade
        </p>
      )}
      {/* Entry + Target here too, not only on the scanner card below — this
          section is the one place meant to hold everything needed to read
          the trade: bias (above), circumstances (the must-layer dots in the
          header), and now entry/target, so nothing requires cross-referencing
          a second component to answer "where do I get in, where do I get out". */}
      {path && ladderPlan ? (
        <div className="mt-2 border-t border-[var(--color-border)] pt-2">
          <PriceLadder {...ladderFrom(ladderPlan)} price={last} height={170} />
        </div>
      ) : path ? (
        <div className="mt-1.5 grid grid-cols-2 gap-2 border-t border-[var(--color-border)] pt-1.5 font-mono text-[12px]">
          <div className="min-w-0">
            <p className="text-[11px] uppercase tracking-wider text-[var(--color-muted)]">Entry · unpriced</p>
            <p className="mt-0.5 break-words text-[var(--color-fg)]">
              <Plain>{path.entryZone}</Plain>
            </p>
          </div>
          <div className="min-w-0">
            <p className="text-[11px] uppercase tracking-wider text-[var(--color-muted)]">Target</p>
            <p className="mt-0.5 break-words text-[var(--color-fg)]">
              <Plain>{path.targets[0] ?? "—"}</Plain>
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function bookForSymbol(desk: DeskPayload, symbol: string): "left" | "right" | null {
  if (symbol === desk.bias.left.symbol || symbol.replace(/^M/, "") === desk.bias.left.symbol.replace(/^M/, "")) {
    return "left";
  }
  if (symbol === desk.bias.right.symbol || symbol.replace(/^M/, "") === desk.bias.right.symbol.replace(/^M/, "")) {
    return "right";
  }
  return null;
}

export function pricePathVerdict(
  desk: DeskPayload,
  paperReady = false,
): {
  word: "TAKE" | "STAND" | "MANAGE";
  line: string;
  book: "left" | "right" | null;
} {
  const clock = desk.clock;
  const opens = paperReady ? listOpenPaperTrades() : [];
  if (opens[0]) {
    const t = opens[0];
    const book = bookForSymbol(desk, t.displaySymbol) ?? bookForSymbol(desk, t.symbol);
    const draw = book ? desk.draws[book].primary : null;
    return {
      word: "MANAGE",
      line: `${t.displaySymbol} ${t.side.toUpperCase()} in play · stop ${px(t.workingStop)} · tp ${px(t.tp1)}${draw ? ` · draw ${draw.name} ${px(draw.price)}` : ""} · one book`,
      book,
    };
  }

  const path = desk.scan.candidates.find((c) => isHighProbPath(c));
  if (desk.news?.verdict === "blackout") {
    return { word: "STAND", line: desk.news.reason || "News blackout", book: null };
  }
  // Time gates from the WALL clock, not the desk build's clock: the desk is
  // rebuilt every 20s (longer when the tab is hidden), so at 09:45:00 the
  // stale build would keep saying "Judas" for up to a poll while the quote
  // ticked live underneath it.
  const wall = etWallParts(Date.now());
  if (isJudasWindow(wall.hour, wall.minute)) {
    // The same read the sequence, the alarm and the paper book use
    // (judas-window.ts): the window stays shut until the open's raid has
    // RESOLVED on a sub-15m rung, and then only for the side it points to.
    // A blanket STAND here let the alarm beep a TAKE while the board said
    // "STAND · Judas" — the desk contradicting itself at 09:3x.
    const clockJ = { etHour: wall.hour, etMinute: wall.minute };
    const reads = [
      readJudas(allSeries(desk.left?.bars ?? [], desk.mtf?.left?.minute ?? []), clockJ, null),
      readJudas(allSeries(desk.right?.bars ?? [], desk.mtf?.right?.minute ?? []), clockJ, null),
    ];
    const released = reads.find((r) => !r.blocked);
    if (!released) {
      const left = 45 - wall.minute;
      return {
        word: "STAND",
        line: `Judas 9:30–9:45 — ${reads[0]!.reason} · ${left}m to go`,
        book: null,
      };
    }
  }
  if (!sessionLive(clock)) {
    const l = desk.draws.left.primary;
    const r = desk.draws.right.primary;
    return {
      word: "STAND",
      line: `Window closed. Magnets ${desk.bias.left.symbol} ${l ? px(l.price) : "—"} / ${desk.bias.right.symbol} ${r ? px(r.price) : "—"}`,
      book: null,
    };
  }

  const leftPath = desk.scan.candidates.find(
    (c) => c.symbol === desk.bias.left.symbol && isHighProbPath(c),
  );
  const rightPath = desk.scan.candidates.find(
    (c) => c.symbol === desk.bias.right.symbol && isHighProbPath(c),
  );

  const scoreBook = (side: "left" | "right") => {
    const bias = desk.bias[side];
    const draw = desk.draws[side].primary;
    const cand = side === "left" ? leftPath : rightPath;
    let s = 0;
    if (bias.topDown !== "neutral") s += 1;
    if (
      draw &&
      ((bias.topDown === "bear" && draw.side === "below") ||
        (bias.topDown === "bull" && draw.side === "above"))
    )
      s += 2;
    if (cand?.actionable) s += 3;
    if (cand && !cand.htfOk) s -= 2;
    return s;
  };
  const leftS = scoreBook("left");
  const rightS = scoreBook("right");
  const book: "left" | "right" | null =
    leftS === 0 && rightS === 0 ? null : leftS >= rightS ? "left" : "right";

  // Quote freshness vetoes a TAKE immediately, even between desk polls: the
  // 1-2s quote poll patches lagSec into desk.quotes long before the next
  // 20s build recomputes `actionable`.
  const worstLag = Math.max(desk.quotes.left.lagSec ?? 0, desk.quotes.right.lagSec ?? 0);
  const staleQuote = worstLag > 120;

  // One book per day. The paper book is the record; if MNQ already printed a
  // fill today, an ES TAKE is the same idea at double risk — say so.
  const taken = paperReady ? bookTakenToday() : null;

  if (path && book) {
    const bias = desk.bias[book];
    const draw = desk.draws[book].primary;
    const cand = path.symbol === bias.symbol ? path : desk.scan.candidates.find((c) => c.symbol === bias.symbol);
    const seq = desk.smcMaster[book];
    const take = cand && isHighProbPath(cand) && cand.htfOk && seq.word === "TAKE";
    if (take && cand) {
      if (staleQuote) {
        return {
          word: "STAND",
          line: `${cand.symbol} ${cand.side.toUpperCase()} sequence complete — quote ${Math.round(worstLag)}s old, no fill on a stale print`,
          book,
        };
      }
      if (taken && taken.book !== cand.symbol.replace(/^M/, "")) {
        return {
          word: "STAND",
          line: `${cand.symbol} ${cand.side.toUpperCase()} sequence complete — one book: ${taken.symbol} already traded today`,
          book,
        };
      }
      return {
        word: "TAKE",
        line: `${cand.symbol} ${cand.side.toUpperCase()} ${cand.pathBand || cand.grade} → ${draw ? `${draw.name} ${px(draw.price)}` : cand.targets[0] ?? "structure"} · SMC ${seq.mustPass}/${seq.mustNeed} · one book`,
        book,
      };
    }
    // Not TAKE: name the layer that is holding it, with the tape reason.
    // "No A+/A/A- PATH" was printed here even while an A+ PATH existed and
    // the real blocker was a must-layer — the trader could not tell which.
    const head = seq.word === "WAIT" ? "WAIT" : "STAND";
    return {
      word: "STAND",
      line: `${head} ${seq.symbol}${seq.side ? ` ${seq.side.toUpperCase()}` : ""} · ${seq.missing} — ${seq.missingDetail}`,
      book,
    };
  }

  // No PATH on either book: still tell the trader what the sequence is
  // waiting on for the preferred book, not just "no PATH".
  const seq = book ? desk.smcMaster[book] : desk.smcMaster.oneBook;
  if (seq && seq.word !== "TAKE") {
    return {
      word: "STAND",
      line: `${seq.symbol}${seq.side ? ` ${seq.side.toUpperCase()}` : ""} · ${seq.missing} — ${seq.missingDetail}`,
      book,
    };
  }
  const missing =
    path?.missing[0] ??
    (desk.brief?.verdict === "stand_down" ? desk.brief.headline : "No A+/A/A− PATH");
  return { word: "STAND", line: missing, book };
}

export function PricePathBoard({ desk }: { desk: DeskPayload }) {
  const [paperReady, setPaperReady] = useState(false);
  useEffect(() => setPaperReady(true), []);
  const v = pricePathVerdict(desk, paperReady);
  const leftPath = desk.scan.candidates.find((c) => c.symbol === desk.bias.left.symbol);
  const rightPath = desk.scan.candidates.find((c) => c.symbol === desk.bias.right.symbol);
  const smt = desk.smtStack?.primary.active
    ? desk.smtStack.primary.note
    : desk.scan.smt.edge !== "none"
      ? desk.scan.smt.note
      : null;

  return (
    <section className="rounded-[var(--radius-lg)] border border-[color-mix(in_oklab,var(--color-primary)_30%,var(--color-border))] bg-[var(--color-surface)] p-3">
      <header className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-[12px] font-semibold uppercase tracking-wide text-[var(--color-muted)]">
          Where price is going
        </p>
        <StateWord raw={v.word} />
      </header>
      <p className="mb-2 font-mono text-[13px] text-[var(--color-muted)]">
        <Plain>{desk.smcMaster.thesis}</Plain>
      </p>
      {/* The ●○× must-layer row per book is now the ring inside each book
          column below (hover a segment for the layer and its detail). */}
      <p className="mb-2 text-[15px] font-medium text-[var(--color-fg)]">
        <Plain>{v.line}</Plain>
      </p>
      {smt && (
        <p className="mb-2 truncate text-[13px] text-[var(--color-muted)]" title={smt}>
          <Plain>{`SMT ${smt}`}</Plain>
        </p>
      )}
      <div className="grid gap-2 sm:grid-cols-2">
        <BookCol
          bias={desk.bias.left}
          draw={desk.draws.left}
          last={desk.quotes.left.price}
          path={leftPath}
          preferred={v.book === "left"}
          seq={desk.smcMaster?.left}
        />
        <BookCol
          bias={desk.bias.right}
          draw={desk.draws.right}
          last={desk.quotes.right.price}
          path={rightPath}
          preferred={v.book === "right"}
          seq={desk.smcMaster?.right}
        />
      </div>
      {desk.draws.left.note && (
        <p className="mt-2 text-[12px] text-[var(--color-muted)]">
          <Plain>{desk.draws.left.note}</Plain>
        </p>
      )}
    </section>
  );
}

/** HUD one-liner so draw is visible on every tab. */
export function pricePathHudLine(desk: DeskPayload, paperReady = false): string {
  const parts: string[] = [];
  for (const side of ["left", "right"] as const) {
    const d = desk.draws[side].primary;
    const b = desk.bias[side];
    if (!d) continue;
    const arrow = d.side === "below" ? "↓" : "↑";
    parts.push(`${b.symbol} ${arrow}${px(d.price)} ${d.name}`);
  }
  const v = pricePathVerdict(desk, paperReady);
  return `${v.word} · ${parts.join(" · ")}`;
}
