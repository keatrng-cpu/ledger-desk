/**
 * Market Beast — an event-triggered bias overlay (display-only, never a signal).
 *
 * Fires a transient animation when the desk's bias changes:
 *   bull turn  → a green bull charges across the screen ("BULL RUN")
 *   bear turn  → a big red bear rears and growls ("BEAR")
 *   LTF flip   → the two clash and the winner knocks the other off ("BULLS/BEARS WIN")
 *
 * It is purely cosmetic: it reads a bias string the desk already computes and
 * draws over the top. It never reads or writes a plan, a grade, a gate or an
 * order. CSS does all the motion (styles.css .ld-beast*), GPU-composited and
 * disabled under prefers-reduced-motion (falls back to the banner alone).
 *
 * Idle cost is zero — nothing animates until an event id changes.
 */
import { memo, useEffect, useRef, useState } from "react";

export type BeastKind = "run" | "growl" | "clash";
export interface BeastEvent {
  kind: BeastKind;
  /** For a clash: which side won (the new bias). */
  winner?: "bull" | "bear";
  /** Bump to replay even when kind is unchanged. */
  id: number;
}

const DUR: Record<BeastKind, number> = { run: 1800, growl: 2000, clash: 2200 };

function layerClass(ev: BeastEvent | null): string {
  if (!ev) return "ld-beast-layer";
  if (ev.kind === "run") return "ld-beast-layer ld-beast-run";
  if (ev.kind === "growl") return "ld-beast-layer ld-beast-growl";
  return `ld-beast-layer ld-beast-clash ${ev.winner === "bear" ? "ld-beast-clash-bear" : "ld-beast-clash-bull"}`;
}

function bannerFor(ev: BeastEvent | null): { text: string; cls: string } | null {
  if (!ev) return null;
  if (ev.kind === "run") return { text: "Bull run", cls: "up" };
  if (ev.kind === "growl") return { text: "Bear", cls: "down" };
  return ev.winner === "bear" ? { text: "Bears win", cls: "down" } : { text: "Bulls win", cls: "up" };
}

/**
 * The overlay. Pass a fresh `event` (new id) to play; it clears itself.
 * memo'd: the desk re-renders on every quote tick, but this only needs to react
 * when a new event arrives, so unchanged props skip it entirely.
 */
export const MarketBeast = memo(function MarketBeast({ event }: { event: BeastEvent | null }) {
  const [active, setActive] = useState<BeastEvent | null>(null);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    if (!event) return;
    setActive(event);
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setActive(null), DUR[event.kind] + 150);
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, [event]);

  if (!active) return null;
  const banner = bannerFor(active);
  return (
    <div className={layerClass(active)} aria-hidden="true">
      {/* Realistic energy sprites (glow on black); `screen` blend drops the black. */}
      <div className="ld-beast bull">
        <img src="/beast/bull.jpg" alt="" draggable={false} />
      </div>
      <div className="ld-beast bear">
        <img src="/beast/bear.jpg" alt="" draggable={false} />
      </div>

      <div className="ld-beast-impact" />
      {banner ? <div className={`ld-beast-banner ${banner.cls}`}>{banner.text}</div> : null}
    </div>
  );
});

/** Normalize whatever the desk calls the bias into "bull" | "bear" | null. */
export function toSide(bias: unknown): "bull" | "bear" | null {
  const s = typeof bias === "string" ? bias.toLowerCase()
    : bias && typeof bias === "object" ? String((bias as { dir?: unknown; bias?: unknown }).dir ?? (bias as { bias?: unknown }).bias ?? "").toLowerCase()
    : "";
  if (s.includes("bull") || s === "up" || s === "long") return "bull";
  if (s.includes("bear") || s === "down" || s === "short") return "bear";
  return null;
}

/**
 * Turn a single bias signal into beast events from its transitions:
 *   neutral/unknown → bull  → run ("BULL RUN")
 *   neutral/unknown → bear  → growl ("BEAR")
 *   bull ⇄ bear (a real reversal) → clash, winner = the new side ("BULLS/BEARS WIN")
 * The first render never fires. Pass the primary book's HTF bias; anything the
 * desk's bias field holds is accepted (see toSide) and an unreadable value is inert.
 */
export function useBiasBeast(bias: unknown): BeastEvent | null {
  const [event, setEvent] = useState<BeastEvent | null>(null);
  const prev = useRef<"bull" | "bear" | null | undefined>(undefined);
  const nextId = useRef(1);

  const side = toSide(bias);
  useEffect(() => {
    const was = prev.current;
    if (was !== undefined && side !== was && side != null) {
      if (was === "bull" || was === "bear") {
        setEvent({ kind: "clash", winner: side, id: nextId.current++ }); // reversal
      } else {
        setEvent({ kind: side === "bull" ? "run" : "growl", id: nextId.current++ }); // turn from neutral
      }
    }
    prev.current = side;
  }, [side]);

  return event;
}
