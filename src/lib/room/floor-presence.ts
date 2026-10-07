/**
 * What a person's face and hands do with the line they are actually saying.
 * Presentation only. It does not place, size, or refuse a trade.
 *
 * The office mesh is still the Blender GLB (scripts/blender/build_floor.py).
 * ACE, Spline, ComfyUI, Tripo, and Godot are not on this host, so the cues
 * below are the ones the floor can run.
 */

export type Viseme = "rest" | "aa" | "ee" | "oh" | "mm";
export type Brow = "rest" | "up" | "down";
export type Look = "ahead" | "down" | "board";
export type Gesture =
  | "POINTING"
  | "GESTICURING_AT_WALL"
  | "WRITING_ON_WHITEBOARD"
  | "NODDING"
  | "CROSSING_ARMS"
  | "FACEPALM"
  | "CHEER"
  | "THUMBS_UP"
  | "LEAN_BACK"
  | "ANALYZING"
  | "WATCH"
  | "CHECKING_TABLET"
  | "EXPLAINING"
  | "PACING";

export function visemeAt(text: string, t: number): Viseme {
  const letters = text.toLowerCase().replace(/[^a-z]/g, "");
  if (!letters) return "rest";
  const ch = letters[Math.floor(Math.max(0, t) * 10) % letters.length]!;
  if ("mbp".includes(ch)) return "mm";
  if ("iy".includes(ch)) return "ee";
  if ("ou".includes(ch)) return "oh";
  if (ch === "a" || ch === "e") return "aa";
  return "ee";
}

export function visemeScale(v: Viseme): { x: number; y: number; drop: number } {
  if (v === "mm") return { x: 1.15, y: 0.35, drop: -0.004 };
  if (v === "ee") return { x: 1.45, y: 0.7, drop: 0 };
  if (v === "oh") return { x: 0.72, y: 1.45, drop: -0.002 };
  if (v === "aa") return { x: 1.1, y: 1.7, drop: -0.006 };
  return { x: 1, y: 1, drop: 0 };
}

function hash(who: string): number {
  let h = 0;
  for (let i = 0; i < who.length; i++) h = (h * 33 + who.charCodeAt(i)) % 997;
  return h / 997;
}

/** First matching cue. Order is the priority: a loss face beats a point. */
export function gestureFor(who: string, text: string | null): Gesture | null {
  if (!text) return null;
  const s = text.toLowerCase();
  if (/noise|wide|stale|past the \d+s feed/.test(s)) return "FACEPALM";
  if (/cost \d+|stopped out|loss/.test(s)) return "FACEPALM";
  if (/\bpaid\b|target hit/.test(s)) return "CHEER";
  if (/do not chase|stop beyond/.test(s)) return "CROSSING_ARMS";
  if (/sweep|raid|liquidity/.test(s)) return "POINTING";
  if (/shift|mss|displacement|\bbos\b/.test(s)) return "GESTICURING_AT_WALL";
  if (/inverse|ifvg|gap tap|\b1m\b|\b5m\b/.test(s)) return "POINTING";
  if (/whiteboard|\bentry\b|\bce\b/.test(s)) return "WRITING_ON_WHITEBOARD";
  if (/order block|breaker|\bote\b/.test(s)) return "POINTING";
  if (/premium|discount/.test(s)) return "ANALYZING";
  if (/buying power|\bdebit\b/.test(s)) return "CHECKING_TABLET";
  if (/backtest|journal/.test(s)) return "CHECKING_TABLET";
  if (/higher timeframe|\bladder\b|\bchart\b/.test(s)) return "WATCH";
  if (/silver bullet|london|new york open/.test(s)) return "EXPLAINING";
  if (/\bfits\b|agree|take it|not a gate/.test(s)) return "NODDING";
  if (who === "Sterling" && /\bnote\b/.test(s)) return "CROSSING_ARMS";
  if (who === "Gemma" && (/lunch|killzone|kill zone|session/.test(s))) return "LEAN_BACK";
  if (who === "Nova" && (/school|sequence|\bict\b|\btjr\b|patty|blake/.test(s))) return "ANALYZING";
  if (who === "Jax" && (/leader|\bsmt\b|\bnq\b|\bes\b/.test(s))) return "POINTING";
  if (who === "Vince" && (/place|agentic|\bsent\b/.test(s))) return "THUMBS_UP";
  if (who === "Gemma" && /accumulation|manipulation|distribution/.test(s)) return "PACING";
  return null;
}

export function presenceOf(who: string, text: string | null, t: number, speaking: boolean): {
  viseme: Viseme;
  brow: Brow;
  look: Look;
  blink: boolean;
  tense: boolean;
} {
  const s = (text ?? "").toLowerCase();
  const tense = /noise|loss|cost \d+|stopped|stale|wide/.test(s);
  const up = /paid|displacement|sweep|target/.test(s);
  const phase = (t + hash(who) * 3) % (tense ? 2.1 : 4.8);
  return {
    viseme: speaking && text ? visemeAt(text, t) : "rest",
    brow: tense ? "down" : up ? "up" : "rest",
    look: tense ? "down" : /chart|board|whiteboard|sweep|shift/.test(s) ? "board" : "ahead",
    blink: phase < 0.12,
    tense,
  };
}
