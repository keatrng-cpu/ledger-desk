/**
 * How a caption is spoken. Presentation only.
 *
 * The words stay the caption. Digits are not added and not dropped. What changes
 * is delivery: a breath at the comma, a person's pace, a pitch that settles
 * instead of one flat note. A browser neural voice is preferred when the
 * machine has one; pitch stays near 1 so a missing voice does not squeak.
 */

import type { Character } from "./orchestrator";

export type Pattern = "lecture" | "clip" | "flat" | "verdict" | "operator";

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
  Gemma: { pitch: 1.04, rate: 0.94, pause: 240, pattern: "lecture", lean: "female", hints: ["aria", "jenny", "samantha", "sonia", "libby", "natasha"] },
  Jax: { pitch: 0.97, rate: 1.04, pause: 80, pattern: "clip", lean: "male", hints: ["guy", "davis", "daniel", "ryan", "brandon"] },
  Nova: { pitch: 1.02, rate: 0.91, pause: 200, pattern: "flat", lean: "female", hints: ["jenny", "sonia", "libby", "karen", "moira"] },
  Sterling: { pitch: 0.92, rate: 0.86, pause: 320, pattern: "verdict", lean: "male", hints: ["davis", "ryan", "rishi", "daniel", "guy"] },
  Vince: { pitch: 0.98, rate: 0.96, pause: 140, pattern: "operator", lean: "male", hints: ["brandon", "tony", "alex", "aaron", "daniel"] },
};

export interface SpokenPhrase {
  text: string;
  pitch: number;
  rate: number;
  gap: number;
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

/**
 * One caption, broken into breaths. The pattern is the person:
 * Gemma lectures and settles, Jax clips the end, Nova flattens on a number,
 * Sterling waits then drops the verdict, Vince slows on the figure.
 */
export function phrasePlan(who: Character, raw: string): SpokenPhrase[] {
  const cast = VOICE_CAST[who];
  const bits = splitPhrases(speakable(raw));
  return bits.map((bit, i) => {
    const last = i === bits.length - 1;
    const hasDigit = /\d/.test(bit);
    const question = /\?\s*$/.test(bit);
    let pitch = cast.pitch;
    let rate = cast.rate;
    let gap = last ? 0 : cast.pause;
    if (cast.pattern === "lecture") {
      pitch += i === 0 ? 0.03 : last ? -0.04 : 0;
      if (last) rate -= 0.05;
    } else if (cast.pattern === "clip") {
      rate += Math.min(0.06, i * 0.03);
      if (last) pitch -= 0.04;
      gap = last ? 0 : cast.pause;
    } else if (cast.pattern === "flat") {
      if (hasDigit) {
        pitch -= 0.02;
        rate -= 0.04;
        gap = last ? 0 : cast.pause + 40;
      }
    } else if (cast.pattern === "verdict") {
      if (last) {
        pitch -= 0.05;
        rate -= 0.06;
      }
    } else if (hasDigit) {
      rate -= 0.04;
    }
    if (question) pitch += 0.05;
    return {
      text: bit,
      pitch: clamp(pitch, 0.85, 1.15),
      rate: clamp(rate, 0.82, 1.12),
      gap,
    };
  });
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
