/**
 * How a caption is spoken. Presentation only.
 *
 * The words stay the caption. Digits are not added and not dropped. What changes
 * is delivery: who is speaking, and what the line is already about. A raid is
 * brighter and quicker, a fill lifts, a stop falls, a structure word is leaned
 * on. The room does not write a new line to get the tone.
 */

import type { Character } from "./orchestrator";

export type Pattern = "lecture" | "clip" | "flat" | "verdict" | "operator";
export type Tone = "raid" | "fill" | "stop" | "verdict" | "structure" | "figure" | "open" | "calm";

export interface VoiceCast {
  pitch: number;
  rate: number;
  /** Quiet between phrases, in ms. The pattern, not a timer that decides a line. */
  pause: number;
  pattern: Pattern;
  /** Female lean so Gemma and Nova are not handed a male neural voice. */
  lean: "female" | "male";
  hints: readonly string[];
}

export const VOICE_CAST: Record<Character, VoiceCast> = {
  Gemma: { pitch: 1.04, rate: 0.92, pause: 280, pattern: "lecture", lean: "female", hints: ["aria", "jenny", "samantha", "sonia", "libby", "natasha"] },
  Jax: { pitch: 0.96, rate: 1.02, pause: 140, pattern: "clip", lean: "male", hints: ["guy", "davis", "daniel", "ryan", "brandon"] },
  Nova: { pitch: 1.01, rate: 0.9, pause: 240, pattern: "flat", lean: "female", hints: ["jenny", "sonia", "libby", "karen", "moira"] },
  Sterling: { pitch: 0.91, rate: 0.84, pause: 380, pattern: "verdict", lean: "male", hints: ["davis", "ryan", "rishi", "daniel", "guy"] },
  Vince: { pitch: 0.98, rate: 0.94, pause: 180, pattern: "operator", lean: "male", hints: ["brandon", "tony", "alex", "aaron", "daniel"] },
};

export interface SpokenPhrase {
  text: string;
  pitch: number;
  rate: number;
  gap: number;
  tone: Tone;
}

const SPELL: readonly [RegExp, string][] = [
  [/\bMNQ\b/g, "M N Q"],
  [/\bNQ\b/g, "N Q"],
  [/\bES\b/g, "E S"],
  [/\bQQQ\b/g, "Q Q Q"],
  [/\bSPY\b/g, "S P Y"],
  [/\bDTE\b/g, "D T E"],
  [/\bSMC\b/g, "S M C"],
  [/\bICT\b/g, "I C T"],
];

/** The caption, shaped so a voice can say it. Same digits, same claim. */
export function speakable(raw: string): string {
  let s = raw;
  s = s.replace(/E\[R\]/g, "expected R");
  s = s.replace(/(\d)\s*[-–]\s*(\d)/g, "$1 to $2");
  s = s.replace(/\b([A-D])\+/g, "$1 plus");
  s = s.replace(/\b([A-D])[−-]/g, "$1 minus");
  s = s.replace(/%/g, " percent");
  s = s.replace(/\$(\d)/g, "$1 dollars ");
  s = s.replace(/&/g, " and ");
  s = s.replace(/\//g, ", ");
  s = s.replace(/[—–]/g, ", ");
  for (const [re, to] of SPELL) s = s.replace(re, to);
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

/** Digits in the spoken form are a subset of the caption's digits, in order. */
export function digitsHeld(raw: string, spoken: string): boolean {
  const want = raw.match(/\d/g) ?? [];
  const got = spoken.match(/\d/g) ?? [];
  if (got.length !== want.length) return false;
  return got.every((d, i) => d === want[i]);
}

/**
 * Tone from the caption and the animation the room already chose.
 * First match wins: a stop is not also a raid.
 */
export function toneOf(text: string, animation?: string): Tone {
  const t = text.toLowerCase();
  if (/\b(stop|stopped|halt|halted|loss|invalid|stopped out)\b/.test(t)) return "stop";
  if (/\b(fill|filled|target|banked|winner|paid|take profit)\b/.test(t) || animation === "THUMBS_UP" || animation === "APPROVING") return "fill";
  if (/\b(raid|raided|sweep|swept|judas|stop hunt|liquidity grab)\b/.test(t) || animation === "SHOUTING") return "raid";
  if (/\b(no trade|stand down|the rule|pass|not a trade|decline)\b/.test(t) || animation === "CROSSING_ARMS") return "verdict";
  if (/\b(premium|discount|draw|fvg|order block|equilibrium|poi|dealing range|imbalance|breaker)\b/.test(t)) return "structure";
  if (/\b(open|bell|cash open)\b/.test(t)) return "open";
  if (/\d/.test(t)) return "figure";
  return "calm";
}

function splitPhrases(text: string): string[] {
  const parts = text
    .split(/(?<=[.!?;:])\s+|(?<=,)\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.length ? parts : [text];
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

const TONE_SHIFT: Record<Tone, { pitch: number; rate: number; pause: number; last: number }> = {
  raid: { pitch: 0.06, rate: 0.06, pause: -60, last: 0.04 },
  fill: { pitch: 0.04, rate: -0.02, pause: 40, last: 0.05 },
  stop: { pitch: -0.08, rate: -0.08, pause: 160, last: -0.06 },
  verdict: { pitch: -0.03, rate: -0.05, pause: 160, last: -0.07 },
  structure: { pitch: 0.02, rate: -0.04, pause: 80, last: -0.02 },
  figure: { pitch: -0.01, rate: -0.05, pause: 40, last: 0 },
  open: { pitch: 0.05, rate: 0.02, pause: -20, last: 0.03 },
  calm: { pitch: 0, rate: 0, pause: 0, last: 0 },
};

/**
 * One caption, broken into breaths. The person sets the pace. The tone sets
 * the color: a raid rises, a fill lifts, a stop falls and waits, a structure
 * word is the slow beat.
 */
export function phrasePlan(who: Character, raw: string, animation?: string): SpokenPhrase[] {
  const cast = VOICE_CAST[who];
  const tone = toneOf(raw, animation);
  const shift = TONE_SHIFT[tone];
  const bits = splitPhrases(speakable(raw));
  return bits.map((bit, i) => {
    const last = i === bits.length - 1;
    const hasDigit = /\d/.test(bit);
    const question = /\?\s*$/.test(bit);
    const structureBeat = tone === "structure" && /\b(premium|discount|draw|fvg|order block|equilibrium|poi|imbalance|breaker)\b/i.test(bit);
    let pitch = cast.pitch + shift.pitch;
    let rate = cast.rate + shift.rate;
    let gap = last ? 0 : Math.max(60, cast.pause + shift.pause);
    if (cast.pattern === "lecture") {
      pitch += i === 0 ? 0.03 : last ? -0.04 : 0;
      if (last) rate -= 0.04;
    } else if (cast.pattern === "clip") {
      rate += Math.min(0.05, i * 0.02);
      if (last) pitch -= 0.03;
    } else if (cast.pattern === "verdict" && last) {
      pitch -= 0.04;
      rate -= 0.05;
    }
    if (last) pitch += shift.last;
    if (hasDigit) rate -= 0.04;
    if (structureBeat) {
      rate -= 0.06;
      pitch += 0.03;
    }
    if (question) pitch += 0.05;
    return {
      text: bit,
      pitch: clamp(pitch, 0.82, 1.16),
      rate: clamp(rate, 0.78, 1.12),
      gap,
      tone,
    };
  });
}

/** How long the caption should stay up so the next person does not start over it. */
export function speakHoldSec(who: Character, text: string, animation?: string): number {
  const parts = phrasePlan(who, text, animation);
  let ms = 360;
  for (const p of parts) {
    const words = p.text.split(/\s+/).length;
    ms += (words / (2.15 * p.rate)) * 1000 + p.gap + 220;
  }
  return Math.min(16, Math.max(3.4, ms / 1000));
}

const FEMALE = /female|woman|aria|jenny|sonia|libby|samantha|natasha|michelle|karen|moira|zira|susan/;
const MALE = /male|man|guy|davis|ryan|brandon|daniel|tony|rishi|aaron|alex|fred/;
const NATURAL = /natural|neural|premium|enhanced/;

/** Higher is a voice a person would rather hear than the compact default. */
export function voiceScore(name: string, lang: string, lean: "female" | "male", hints: readonly string[]): number {
  const n = name.toLowerCase();
  let s = 0;
  if (NATURAL.test(n)) s += 60;
  if (/compact|espeak/.test(n)) s -= 50;
  if (hints.some((h) => n.includes(h))) s += 30;
  if (lean === "female" ? FEMALE.test(n) : MALE.test(n)) s += 16;
  if (lean === "female" && MALE.test(n) && !FEMALE.test(n)) s -= 24;
  if (lean === "male" && FEMALE.test(n) && !MALE.test(n)) s -= 12;
  if (/^en([-_]|$)/i.test(lang)) s += 10;
  return s;
}
