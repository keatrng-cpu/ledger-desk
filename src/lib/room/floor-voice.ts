/**
 * How a caption is spoken. Presentation only.
 *
 * Each person has one designated voice, chosen once from the browser and kept.
 * Pitch stays next to a normal speaking voice. Dropping it is what makes the
 * engine rasp. Tone is a small change of pace, not a new voice and not a new line.
 * Digits are not added and not dropped. Units, signs, strikes and code names are
 * said the way a person on the desk says them ("5m" is five minutes, "782C" is
 * the 782 call, "+$128" is plus 128 dollars).
 */

import type { Character } from "./orchestrator";
import { chunkSpoken, spokenDigest, spokenForm } from "./spoken-form";

export type Pattern = "lecture" | "clip" | "flat" | "verdict" | "operator";
export type Tone = "raid" | "fill" | "stop" | "verdict" | "structure" | "figure" | "open" | "calm";

export interface VoiceCast {
  /** Pace only. Pitch is 1. A shifted pitch is the rasp. */
  rate: number;
  pattern: Pattern;
  lean: "female" | "male";
}

/** Named voices, best first. The first one this browser actually has is theirs. */
export const VOICE_SLOT: Record<Character, readonly string[]> = {
  Gemma: ["google uk english female", "samantha", "sonia", "libby", "aria", "karen", "moira", "fiona"],
  Nova: ["jenny", "aria", "libby", "sonia", "samantha", "google uk english female", "karen", "moira", "fiona"],
  Jax: ["google uk english male", "daniel", "ryan", "guy", "alex", "aaron"],
  Sterling: ["guy", "ryan", "daniel", "davis", "brandon", "alex", "google uk english male"],
  Vince: ["brandon", "tony", "tom", "alex", "aaron", "daniel"],
};

export const VOICE_CAST: Record<Character, VoiceCast> = {
  Gemma: { rate: 1.08, pattern: "lecture", lean: "female" },
  Jax: { rate: 1.16, pattern: "clip", lean: "male" },
  Nova: { rate: 1.12, pattern: "flat", lean: "female" },
  Sterling: { rate: 1.1, pattern: "verdict", lean: "male" },
  Vince: { rate: 1.1, pattern: "operator", lean: "male" },
};

/** Sterling and Nova pick before the others, so a smooth voice is not taken out from under them. */
const CREW: readonly Character[] = ["Gemma", "Nova", "Sterling", "Vince", "Jax"];

export interface SpokenPhrase {
  text: string;
  pitch: number;
  rate: number;
  gap: number;
  tone: Tone;
}

export interface VoiceOption {
  name: string;
  voiceURI: string;
  lang: string;
}

/**
 * The caption, shaped so a voice says it the way a trader would. Same numbers, same claim.
 * The work is in spoken-form.ts (money as dollars and cents, units as words, signs said, code names as words, jargon expanded); the
 * invariant that no number moves is `numbersHeld` there. `digitsHeld` below is the stricter digit-for-digit check that still holds
 * for any caption without money in it.
 */
export function speakable(raw: string): string {
  return spokenForm(raw);
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

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/** Pace only, and a hair of pitch. Anything lower buzzes the browser voice. */
const TONE_SHIFT: Record<Tone, { pitch: number; rate: number }> = {
  raid: { pitch: 0.02, rate: 0.03 },
  fill: { pitch: 0.01, rate: 0 },
  stop: { pitch: -0.02, rate: -0.04 },
  verdict: { pitch: 0, rate: -0.03 },
  structure: { pitch: 0, rate: -0.02 },
  figure: { pitch: 0, rate: -0.02 },
  open: { pitch: 0.01, rate: 0.01 },
  calm: { pitch: 0, rate: 0 },
};

/** Commas and periods make the browser sit. The words stay; the dwell does not. A question mark stays so the lift still hears it. */
function forTheEar(s: string): string {
  return s
    // A comma between digits is the thousands separator ("1,143"): without it an engine can say "eleven forty-three".
    .replace(/,(?!\d)/g, "")
    .replace(/\.(?=\s|$)/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * One caption, one breath. Restarting the engine on every comma is the rasp.
 * The person sets the pace. The tone nudges it. Pitch stays near 1.
 */
export function phrasePlan(who: Character, raw: string, animation?: string): SpokenPhrase[] {
  const cast = VOICE_CAST[who];
  const tone = toneOf(raw, animation);
  const shift = TONE_SHIFT[tone];
  // A long caption is said as its digest (no long asides); the caption on screen keeps them. A short one is said whole.
  const text = spokenDigest(raw);
  if (!text) return [];
  // One breath for a short caption. A long one is said as sentences: a network voice stops an utterance near fifteen seconds, and an
  // unbroken run has no breath. A question lifts its own piece a hair; the pitch stays inside the band that does not rasp.
  const pieces = chunkSpoken(text);
  return pieces.map((piece, i) => ({
    text: forTheEar(piece),
    pitch: clamp(1 + shift.pitch + (piece.endsWith("?") ? 0.02 : 0), 0.98, 1.03),
    rate: clamp(cast.rate + shift.rate, 1.02, 1.22),
    gap: i < pieces.length - 1 ? 40 : 0,
    tone,
  }));
}

/** How long the caption should stay up so the next person does not start over it. */
export function speakHoldSec(who: Character, text: string, animation?: string): number {
  const parts = phrasePlan(who, text, animation);
  let ms = 480;
  for (const p of parts) {
    const words = p.text.split(/\s+/).length;
    ms += (words / (2.2 * p.rate)) * 1000 + p.gap;
  }
  return Math.min(16, Math.max(3.4, ms / 1000));
}

const RASPY = /compact|espeak|android|whisper|novelty/;
const SMOOTH = /natural|neural|premium|enhanced/;
/** The old desktop voices. A newer voice of the same gender is used instead. */
const ROBOTIC = /\b(zira|susan|fred|david|mark|hazel)\b|google us english/;

const FEMALE_NAMES = [
  "samantha", "victoria", "karen", "moira", "fiona", "tessa", "serena", "zira", "susan",
  "allison", "ava", "kate", "joanna", "salli", "ivy", "kimberly", "kendra", "emma", "amy",
  "nicole", "olivia", "libby", "sonia", "aria", "jenny", "michelle", "natasha", "hazel",
  "heather", "linda", "veena", "nora", "sara", "kathy", "catherine",
];
const MALE_NAMES = [
  "daniel", "alex", "fred", "rishi", "aaron", "guy", "davis", "ryan", "brandon", "tony",
  "tom", "david", "james", "george", "reed", "matthew", "justin", "joey", "brian",
  "russell", "oliver", "arthur", "gordon", "lee",
];

function tokens(name: string): string[] {
  return name.toLowerCase().split(/[^a-z]+/).filter(Boolean);
}

/** Female, male, or unknown. "Female" does not count as male. */
export function voiceGender(name: string): "female" | "male" | null {
  const parts = tokens(name);
  if (parts.includes("female") || parts.includes("woman")) return "female";
  if (parts.includes("male") || parts.includes("man")) return "male";
  const f = FEMALE_NAMES.some((n) => parts.includes(n));
  const m = MALE_NAMES.some((n) => parts.includes(n));
  if (f && !m) return "female";
  if (m && !f) return "male";
  return null;
}

function robotic(name: string): boolean {
  return ROBOTIC.test(name.toLowerCase());
}

function betterThanRobotic(pool: readonly VoiceOption[], lean: "female" | "male"): boolean {
  return pool.some((v) => voiceGender(v.name) === lean && !RASPY.test(v.name) && !robotic(v.name));
}

function slotRank(name: string, hints: readonly string[]): number {
  const n = name.toLowerCase();
  if (RASPY.test(n)) return -100;
  let s = 0;
  const idx = hints.findIndex((h) => n.includes(h));
  if (idx >= 0) s += 120 - idx * 10;
  if (SMOOTH.test(n)) s += 40;
  if (robotic(n)) s -= 80;
  return s;
}

/**
 * One voice per person, same result every call. Gender is the gate: Gemma and
 * Nova only get a female voice, Jax, Sterling and Vince only a male one. A
 * saved URI is kept only when it is still installed and the gender matches.
 * Two people may share a voice of the right gender. They never take the wrong one.
 */
export function assignVoices(
  options: readonly VoiceOption[],
  saved?: Partial<Record<Character, string>>,
): Record<Character, string | null> {
  const en = options.filter((v) => /^en([-_]|$)/i.test(v.lang));
  const pool = (en.length ? en : options).slice().sort((a, b) => a.voiceURI.localeCompare(b.voiceURI));
  const byUri = new Map(pool.map((v) => [v.voiceURI, v]));
  const used = new Set<string>();
  const out: Record<Character, string | null> = { Gemma: null, Nova: null, Jax: null, Sterling: null, Vince: null };
  for (const who of CREW) {
    const uri = saved?.[who];
    const voice = uri ? byUri.get(uri) : undefined;
    if (voice && voiceGender(voice.name) === VOICE_CAST[who].lean && !used.has(uri!) && !(robotic(voice.name) && betterThanRobotic(pool, VOICE_CAST[who].lean))) {
      out[who] = uri!;
      used.add(uri!);
    }
  }
  const rankedFor = (who: Character, freeOnly: boolean) => {
    const lean = VOICE_CAST[who].lean;
    const hints = VOICE_SLOT[who];
    return pool
      .filter((v) => voiceGender(v.name) === lean && !RASPY.test(v.name) && !robotic(v.name) && (!freeOnly || !used.has(v.voiceURI)))
      .sort((a, b) => slotRank(b.name, hints) - slotRank(a.name, hints) || a.name.localeCompare(b.name));
  };
  for (const who of CREW) {
    if (out[who]) continue;
    const pick = rankedFor(who, true)[0];
    if (pick) {
      out[who] = pick.voiceURI;
      used.add(pick.voiceURI);
    }
  }
  for (const who of CREW) {
    if (out[who]) continue;
    const pick = rankedFor(who, false)[0];
    if (pick) out[who] = pick.voiceURI;
  }
  for (const who of CREW) {
    if (out[who]) continue;
    const lean = VOICE_CAST[who].lean;
    const hints = VOICE_SLOT[who];
    const pick = pool
      .filter((v) => voiceGender(v.name) === lean && !RASPY.test(v.name))
      .sort((a, b) => slotRank(b.name, hints) - slotRank(a.name, hints) || a.name.localeCompare(b.name))[0];
    if (pick) out[who] = pick.voiceURI;
  }
  return out;
}
