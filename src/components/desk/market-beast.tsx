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
      {/* BULL */}
      <div className="ld-beast bull" style={{ left: 0 }}>
        <svg viewBox="0 0 240 150" xmlns="http://www.w3.org/2000/svg">
          <g className="torso">
            <path className="fill" d="M40 70 q30 -28 86 -24 q34 2 60 14 q22 10 22 24 q0 10 -12 12 l-16 2 q4 14 -2 24 l-14 0 q-2 -12 -8 -18 q-30 8 -62 2 q-4 10 -10 16 l-14 0 q-2 -14 2 -24 q-22 -8 -24 -34 q0 -6 4 -12 z" />
            <path className="fill" d="M196 72 q22 -2 32 10 q8 10 2 22 q-6 10 -20 10 q-14 0 -22 -12 q-6 -10 -2 -20 q4 -8 10 -10 z" />
            <path className="stroke" fill="none" strokeWidth="6" strokeLinecap="round" d="M214 70 q10 -16 2 -30 M230 86 q18 -8 20 -26" />
            <circle cx="214" cy="86" r="3" fill="#09090b" />
            <circle cx="232" cy="104" r="2.4" fill="#09090b" />
          </g>
          <g className="legBack"><rect className="fill" x="58" y="96" width="11" height="40" rx="5" /></g>
          <g className="legBack"><rect className="fill" x="78" y="98" width="11" height="40" rx="5" /></g>
          <g className="legFront"><rect className="fill" x="150" y="96" width="11" height="42" rx="5" /></g>
          <g className="legFront"><rect className="fill" x="170" y="98" width="11" height="40" rx="5" /></g>
          <path className="stroke" fill="none" strokeWidth="5" strokeLinecap="round" d="M40 72 q-18 6 -20 26 q-1 10 6 16" />
        </svg>
      </div>
      <div className="ld-beast-dust d1" style={{ left: "4vw" }} />
      <div className="ld-beast-dust d2" style={{ left: "7vw" }} />
      <div className="ld-beast-dust d3" style={{ left: "10vw" }} />

      {/* BEAR */}
      <div className="ld-beast bear" style={{ left: "50%", transform: "translateX(-50%)" }}>
        <svg viewBox="0 0 220 180" xmlns="http://www.w3.org/2000/svg">
          <path className="fill" d="M70 176 q-14 -40 -8 -78 q6 -42 48 -46 q42 -4 52 36 q8 34 -2 88 l-18 0 q-6 -34 -4 -58 q-20 10 -40 2 q0 30 -6 56 z" />
          <circle className="fill" cx="112" cy="44" r="30" />
          <circle className="fill" cx="90" cy="20" r="10" /><circle className="fill" cx="134" cy="20" r="10" />
          <path className="fill" d="M98 50 q14 8 30 0 q2 10 -2 16 l-26 0 q-4 -8 -2 -16z" />
          <g className="jaw">
            <path className="fill" d="M100 66 q12 10 24 0 q0 10 -12 12 q-12 -2 -12 -12z" />
            <path d="M102 66 l3 6 l3 -6z" fill="#fff" /><path d="M114 66 l3 6 l3 -6z" fill="#fff" />
          </g>
          <path className="stroke" strokeWidth="4" strokeLinecap="round" d="M98 40 l10 4 M126 40 l-10 4" />
          <circle cx="103" cy="46" r="3" fill="#09090b" /><circle cx="121" cy="46" r="3" fill="#09090b" />
          <g className="arm">
            <path className="fill" d="M150 70 q30 -10 40 8 q6 12 -4 22 l-10 -6 q4 -8 -2 -12 q-12 -6 -28 2z" />
            <path className="stroke" strokeWidth="4" strokeLinecap="round" fill="none" d="M186 92 l10 8 M182 98 l9 9 M177 103 l7 10" />
          </g>
        </svg>
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
