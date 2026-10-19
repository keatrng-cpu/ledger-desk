/**
 * Market Beast — event-triggered video overlay (display-only, never a signal).
 *
 * Real animated creatures (Grok image→video): a charging emerald bull, a rearing
 * red bear, and two clash clips (bull-wins / bear-wins). Fires when a trade setup
 * goes active — the setup's side charges the screen — and on a bias reversal the
 * two clash and the new side wins.
 *
 * Transparency: the clips are a glowing creature on black. `mix-blend-mode: screen`
 * drops the black over the dark desk, and a radial edge-mask feathers the frame so
 * there is no visible box. Partial opacity + the transient, charge-through motion
 * mean it never persistently covers a card. Disabled under prefers-reduced-motion.
 */
import { memo, useEffect, useRef, useState } from "react";

export type BeastKind = "run" | "growl" | "clash";
export interface BeastEvent {
  kind: BeastKind;
  /** For a clash: which side won (the new bias / setup side). */
  winner?: "bull" | "bear";
  /** Bump to replay even when kind is unchanged. */
  id: number;
}

const DUR: Record<BeastKind, number> = { run: 3500, growl: 3500, clash: 4000 };

function srcFor(ev: BeastEvent): string {
  if (ev.kind === "run") return "/beast/bull.mp4";
  if (ev.kind === "growl") return "/beast/bear.mp4";
  return ev.winner === "bear" ? "/beast/clash-bear.mp4" : "/beast/clash-bull.mp4";
}
function layerClass(ev: BeastEvent): string {
  if (ev.kind === "run") return "ld-beast-layer ld-beast-run";
  if (ev.kind === "growl") return "ld-beast-layer ld-beast-growl";
  return "ld-beast-layer ld-beast-clash";
}
function bannerFor(ev: BeastEvent): { text: string; cls: string } {
  if (ev.kind === "run") return { text: "Bull", cls: "up" };
  if (ev.kind === "growl") return { text: "Bear", cls: "down" };
  return ev.winner === "bear" ? { text: "Bears win", cls: "down" } : { text: "Bulls win", cls: "up" };
}

/** The overlay. Pass a fresh `event` (new id) to play; it clears itself. */
export const MarketBeast = memo(function MarketBeast({ event }: { event: BeastEvent | null }) {
  const [active, setActive] = useState<BeastEvent | null>(null);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    if (!event) return;
    setActive(event);
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setActive(null), DUR[event.kind] + 200);
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, [event]);

  if (!active) return null;
  const banner = bannerFor(active);
  return (
    <div className={layerClass(active)} aria-hidden="true">
      <div className="ld-beast">
        {/* key by id so a new event remounts the element and replays from frame 0 */}
        <video key={active.id} src={srcFor(active)} autoPlay muted playsInline preload="auto" />
      </div>
      <div className={`ld-beast-banner ${banner.cls}`}>{banner.text}</div>
    </div>
  );
});

/** Normalize whatever the desk calls a side/bias into "bull" | "bear" | null. */
export function toSide(bias: unknown): "bull" | "bear" | null {
  const s = typeof bias === "string" ? bias.toLowerCase()
    : bias && typeof bias === "object" ? String((bias as { dir?: unknown; bias?: unknown; side?: unknown }).dir ?? (bias as { bias?: unknown }).bias ?? (bias as { side?: unknown }).side ?? "").toLowerCase()
    : "";
  if (s.includes("bull") || s === "up" || s === "long") return "bull";
  if (s.includes("bear") || s === "down" || s === "short") return "bear";
  return null;
}

function useTransitions(key: unknown, side: "bull" | "bear" | null): BeastEvent | null {
  const [event, setEvent] = useState<BeastEvent | null>(null);
  const prevKey = useRef<unknown>(undefined);
  const prevSide = useRef<"bull" | "bear" | null>(null);
  const nextId = useRef(1);
  useEffect(() => {
    if (prevKey.current === undefined) {
      prevKey.current = key;
      prevSide.current = side;
      return; // never fire on mount
    }
    if (key !== prevKey.current && side != null) {
      const was = prevSide.current;
      if (was && was !== side) setEvent({ kind: "clash", winner: side, id: nextId.current++ }); // reversal
      else setEvent({ kind: side === "bull" ? "run" : "growl", id: nextId.current++ }); // new setup
    }
    prevKey.current = key;
    if (side != null) prevSide.current = side;
  }, [key, side]);
  return event;
}

/**
 * Fire when a trade setup goes active: the setup's side charges the screen; a
 * reversal from the last active side clashes. Pass a key that changes when a new
 * setup appears (e.g. the card's `at`/id, or `${symbol}:${side}:${entry}`) and the
 * setup's side. A null side (STAND / no setup) never fires.
 */
export function useSetupBeast(setupKey: unknown, side: unknown): BeastEvent | null {
  return useTransitions(setupKey ?? null, toSide(side));
}

/**
 * Fire on bias transitions (neutral→side charges; bull⇄bear reversal clashes).
 * Kept for a bias-driven trigger; `useSetupBeast` is the setup-driven one.
 */
export function useBiasBeast(bias: unknown): BeastEvent | null {
  const side = toSide(bias);
  return useTransitions(side, side);
}
