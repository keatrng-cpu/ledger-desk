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
import { isHighProbPath } from "@/lib/alerts/path-alarm";
import { isJudasWindow } from "@/lib/trading/sessions";
import { listOpenPaperTrades } from "@/lib/trading/paper-manager";
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
    return <p className="text-[11px] text-[var(--color-subtle)]">No magnet</p>;
  }
  const pts = Math.abs(t.price - last);
  const Arrow = t.side === "below" ? ArrowDown : ArrowUp;
  return (
    <p className={cn("flex items-baseline gap-1.5 font-mono text-sm", tone(t.side))}>
      <Arrow className="h-3.5 w-3.5 shrink-0" />
      <span className="font-semibold">{px(t.price)}</span>
      <span className="text-[11px] text-[var(--color-fg)]">{t.name}</span>
      <span className="text-[10px] text-[var(--color-muted)]">
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
}: {
  bias: HtfBiasRead;
  draw: DrawRead;
  last: number;
  path: SetupCandidate | undefined;
  preferred: boolean;
}) {
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
      <p className="mb-1.5 text-[10px] text-[var(--color-muted)]">
        <span className={fight ? "text-[var(--color-warn)]" : ""}>
          {bias.dealing?.zone ?? "n/a"}
        </span>
        {" · sess "}
        <span className={tone(bias.sessionStance)}>{bias.sessionStance}</span>
        {fight ? " · location fights HTF" : aligned ? " · draw agrees" : ""}
        {preferred ? " · ONE BOOK" : ""}
      </p>
      <p className="text-[9px] font-semibold uppercase tracking-wide text-[var(--color-subtle)]">
        Draw
      </p>
      <DrawLine t={draw.primary} last={last} />
      {draw.primary && (draw.primary.side === "below" ? draw.above : draw.below) && (
        <p className="mt-0.5 text-[10px] text-[var(--color-subtle)]">
          Opp{" "}
          {px((draw.primary.side === "below" ? draw.above : draw.below)!.price)}{" "}
          {(draw.primary.side === "below" ? draw.above : draw.below)!.name}
        </p>
      )}
      <p className="mt-1.5 text-[11px] text-[var(--color-muted)]">
        {path ? (
          <>
            PATH {path.side} {path.pathBand || path.grade} Q {path.confluence.toFixed(2)}
            {path.actionable ? "" : " · not armed"}
          </>
        ) : (
          "No PATH card"
        )}
      </p>
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
  if (isJudasWindow(clock.etHour, clock.etMinute)) {
    return { word: "STAND", line: "Judas 9:30–9:45 — name the raid", book: null };
  }
  if (!clock.inTradeWindow) {
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

  if (path && book) {
    const bias = desk.bias[book];
    const draw = desk.draws[book].primary;
    const cand = path.symbol === bias.symbol ? path : desk.scan.candidates.find((c) => c.symbol === bias.symbol);
    const take = cand && isHighProbPath(cand) && cand.htfOk;
    if (take && cand) {
      return {
        word: "TAKE",
        line: `${cand.symbol} ${cand.side.toUpperCase()} ${cand.pathBand || cand.grade} → ${draw ? `${draw.name} ${px(draw.price)}` : cand.targets[0] ?? "structure"} · one book`,
        book,
      };
    }
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
        <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-subtle)]">
          Where price is going
        </p>
        <span
          className={cn(
            "rounded-full border px-2.5 py-0.5 font-mono text-[11px] font-bold",
            v.word === "TAKE" &&
              "border-[color-mix(in_oklab,var(--color-up)_45%,var(--color-border))] text-[var(--color-up)]",
            v.word === "STAND" &&
              "border-[var(--color-border)] text-[var(--color-muted)]",
            v.word === "MANAGE" &&
              "border-[color-mix(in_oklab,var(--color-warn)_45%,var(--color-border))] text-[var(--color-warn)]",
          )}
        >
          {v.word}
        </span>
      </header>
      <p className="mb-2 text-sm font-medium text-[var(--color-fg)]">{v.line}</p>
      {smt && (
        <p className="mb-2 truncate text-[11px] text-[var(--color-muted)]">SMT {smt}</p>
      )}
      <div className="grid gap-2 sm:grid-cols-2">
        <BookCol
          bias={desk.bias.left}
          draw={desk.draws.left}
          last={desk.quotes.left.price}
          path={leftPath}
          preferred={v.book === "left"}
        />
        <BookCol
          bias={desk.bias.right}
          draw={desk.draws.right}
          last={desk.quotes.right.price}
          path={rightPath}
          preferred={v.book === "right"}
        />
      </div>
      {desk.draws.left.note && (
        <p className="mt-2 text-[10px] text-[var(--color-subtle)]">{desk.draws.left.note}</p>
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
