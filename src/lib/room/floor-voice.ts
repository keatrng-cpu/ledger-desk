/**
 * How a caption is spoken. Presentation only.
 *
 * Each person has one designated voice, chosen once from the browser and kept: an AMERICAN voice (en-US) when the browser has
 * any, the best one of their gender, a different one for each person when there are enough.
 * Two ways to speak, chosen by the voice. A legacy or network voice (David, Zira, eSpeak) rasps when pitch moves or when it is
 * asked to sit on punctuation, so it keeps the conservative plan: pitch near 1, pace only, commas and full stops stripped.
 * A natural voice (Edge's Aria / Jenny / Guy / Davis, macOS Samantha / Ava Premium, any "Natural" / "Neural" / "Online" voice)
 * takes all of it: each person has their own pitch and pace, tone moves both further, a question lifts, a stop slows and drops,
 * sentences are separated by pauses that follow the punctuation, and a hair of deterministic variation keeps a repeated line
 * from sounding stamped. Tone is still never a new line: digits are not added and not dropped.
 * Digits are not added and not dropped. Units, signs, strikes and code names are
 * said the way a person on the desk says them ("5m" is five minutes, "782C" is
 * the 782 call, "+$128" is plus 128 dollars).
 */

import type { Character } from "./orchestrator";
import { chunkSpoken, spokenDigest, spokenForm } from "./spoken-form";

export type Pattern = "lecture" | "clip" | "flat" | "verdict" | "operator";
export type Tone = "raid" | "fill" | "stop" | "verdict" | "structure" | "figure" | "open" | "calm";

export interface VoiceCast {
  /** Pace only, for a legacy voice. Pitch is 1. A shifted pitch is the rasp. */
  rate: number;
  pattern: Pattern;
  lean: "female" | "male";
  /** A natural voice's own register: pace, pitch, and how far tone and questions move them (1 = the table below). */
  natural: { rate: number; pitch: number; bounce: number };
}

/** Named voices, best first. The first one this browser actually has is theirs. */
/** American voices only (the British ones: Sonia, Libby, Ryan, Daniel, Oliver, George and the Google UK pair were here first). */
export const VOICE_SLOT: Record<Character, readonly string[]> = {
  Gemma: ["aria", "jenny", "michelle", "ava", "emma", "samantha", "allison", "sara", "kathy"],
  Nova: ["jenny", "michelle", "ana", "aria", "ava", "samantha", "allison", "emma"],
  Jax: ["guy", "tony", "jason", "davis", "andrew", "brandon", "aaron", "alex"],
  Sterling: ["davis", "andrew", "christopher", "brian", "eric", "roger", "guy", "brandon", "alex"],
  Vince: ["tony", "jason", "eric", "brandon", "steffan", "aaron", "alex", "guy"],
};

export const VOICE_CAST: Record<Character, VoiceCast> = {
  // Gemma explains: warm, a little higher, unhurried, expressive.
  Gemma: { rate: 1.08, pattern: "lecture", lean: "female", natural: { rate: 1.04, pitch: 1.05, bounce: 1.1 } },
  // Jax is the clip: fast, bright, big swings.
  Jax: { rate: 1.16, pattern: "clip", lean: "male", natural: { rate: 1.18, pitch: 1.03, bounce: 1.35 } },
  // Nova reads numbers: even, precise, little swing.
  Nova: { rate: 1.12, pattern: "flat", lean: "female", natural: { rate: 1.08, pitch: 1.0, bounce: 0.6 } },
  // Sterling gives the verdict: slow, low, weight on the end.
  Sterling: { rate: 1.1, pattern: "verdict", lean: "male", natural: { rate: 0.96, pitch: 0.9, bounce: 0.7 } },
  // Vince operates: crisp, mid-low, measured.
  Vince: { rate: 1.1, pattern: "operator", lean: "male", natural: { rate: 1.06, pitch: 0.96, bounce: 0.85 } },
};

/** What the engine will say with, set by the sound layer once the cast is chosen: a natural cast speaks the natural plan. */
let NATURAL_CAST = false;
export function setVoiceQuality(natural: boolean): void {
  NATURAL_CAST = natural;
}
export function voiceQuality(): boolean {
  return NATURAL_CAST;
}

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
export function phrasePlan(who: Character, raw: string, animation?: string, opts?: { natural?: boolean; shared?: boolean }): SpokenPhrase[] {
  const cast = VOICE_CAST[who];
  const tone = toneOf(raw, animation);
  const shift = TONE_SHIFT[tone];
  // A long caption is said as its digest (no long asides); the caption on screen keeps them. A short one is said whole.
  const text = spokenDigest(raw);
  if (!text) return [];
  if (opts?.natural ?? NATURAL_CAST) return naturalPlan(cast, tone, text);
  // One breath for a short caption. A long one is said as sentences: a network voice stops an utterance near fifteen seconds, and an
  // unbroken run has no breath. A question lifts its own piece a hair; the pitch stays inside the band that does not rasp.
  const pieces = chunkSpoken(text);
  // Two people who must share one voice (the browser has fewer voices of their gender than there are people) would sound the
  // same. Each takes their own register instead, a modest step either way of pitch 1, wider than the rasp-safe band but far
  // short of a different voice; people with a voice of their own keep the conservative band.
  const base = opts?.shared ? 1 + (cast.natural.pitch - 1) * 0.7 : 1;
  const lo = opts?.shared ? 0.92 : 0.98;
  const hi = opts?.shared ? 1.08 : 1.03;
  return pieces.map((piece, i) => ({
    text: forTheEar(piece),
    pitch: clamp(base + shift.pitch + (piece.endsWith("?") ? 0.02 : 0), lo, hi),
    rate: clamp(cast.rate + shift.rate, 1.02, 1.22),
    gap: i < pieces.length - 1 ? 40 : 0,
    tone,
  }));
}

/** A small, stable hash: the variation below is the same every time for the same line, different between lines. */
function hash01(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10_000) / 10_000;
}

/** Where tone moves a natural voice (the legacy table above barely moves anything: that voice rasps). */
const NATURAL_SHIFT: Record<Tone, { pitch: number; rate: number }> = {
  raid: { pitch: 0.06, rate: 0.08 },
  fill: { pitch: 0.05, rate: 0.03 },
  stop: { pitch: -0.06, rate: -0.09 },
  verdict: { pitch: -0.04, rate: -0.07 },
  structure: { pitch: 0, rate: -0.03 },
  figure: { pitch: 0.01, rate: -0.04 },
  open: { pitch: 0.04, rate: 0.03 },
  calm: { pitch: 0, rate: 0 },
};

/** The pause after a piece follows how it ends: a full stop breathes, a comma barely does. */
function pauseAfter(piece: string): number {
  const end = piece.trim().slice(-1);
  if (end === "." || end === "?") return 260;
  if (end === "!") return 210;
  if (end === ":" || end === ";") return 190;
  if (/[—–-]$/.test(piece.trim())) return 160;
  if (end === ",") return 110;
  return 120;
}

/**
 * The plan for a natural voice. Same words as the conservative plan (the digest, the chunks, no number moved); what changes is
 * how they are said: this person's own pitch and pace, tone moving both further, a question lifting its last piece, an
 * exclamation brightening, the first piece a touch slower (onset) and the last slower and lower (finality), figures slowed,
 * pitch drifting down across a run of sentences the way a speaker's does, pauses that follow the punctuation, and a hair of
 * stable variation so the same sentence is not stamped out identically.
 */
function naturalPlan(cast: VoiceCast, tone: Tone, text: string): SpokenPhrase[] {
  const n = cast.natural;
  const sh = NATURAL_SHIFT[tone];
  // A natural voice takes a sentence at a time (each ends where a speaker would breathe, and a question can lift on its own);
  // a decimal point or a thousands comma is not a sentence end.
  const sentences = text.split(/(?<=[.?!])\s+(?=[A-Z0-9$"'(])/).map((s) => s.trim()).filter(Boolean);
  const pieces = sentences.length > 1 ? sentences : chunkSpoken(text);
  return pieces.map((piece, i) => {
    const last = i === pieces.length - 1;
    const u1 = hash01(piece) * 2 - 1;
    const u2 = hash01(piece + "~") * 2 - 1;
    const question = piece.trim().endsWith("?");
    const bang = piece.trim().endsWith("!");
    const hasFigure = /\d/.test(piece);
    let pitch = n.pitch + sh.pitch * n.bounce;
    pitch *= 1 - 0.012 * Math.min(i, 5);
    if (question) pitch += 0.07 * n.bounce;
    if (bang) pitch += 0.04 * n.bounce;
    if (last && !question) pitch -= 0.02 * n.bounce;
    pitch += 0.012 * u1;
    let rate = n.rate + sh.rate * n.bounce;
    if (i === 0) rate -= 0.02;
    if (last && pieces.length > 1) rate -= 0.03;
    if (hasFigure) rate -= 0.03;
    if (bang) rate += 0.04 * n.bounce;
    rate += 0.02 * u2;
    return {
      text: piece.replace(/\s+/g, " ").trim(),
      pitch: clamp(pitch, 0.82, 1.2),
      rate: clamp(rate, 0.85, 1.3),
      gap: last ? 0 : pauseAfter(piece),
      tone,
    };
  });
}

/** True for a voice that takes pitch, pace and punctuation without rasping: the neural / natural / premium kind. */
export function isNaturalVoice(name: string | null | undefined): boolean {
  const n = (name ?? "").toLowerCase();
  if (!n || RASPY.test(n) || robotic(n)) return false;
  return SMOOTH.test(n) || /online|siri/.test(n);
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
  "ana", "ashley", "jane", "elizabeth", "monica", "cora", "jessa", "amber", "nancy",
  "samantha", "victoria", "karen", "moira", "fiona", "tessa", "serena", "zira", "susan",
  "allison", "ava", "kate", "joanna", "salli", "ivy", "kimberly", "kendra", "emma", "amy",
  "nicole", "olivia", "libby", "sonia", "aria", "jenny", "michelle", "natasha", "hazel",
  "heather", "linda", "veena", "nora", "sara", "kathy", "catherine",
];
const MALE_NAMES = [
  "andrew", "christopher", "eric", "roger", "steffan", "jason", "chris", "kevin", "jacob", "nathan", "gary",
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
  // American voices when the browser has two or more (it needs room to give each person their own); else any English.
  const us = en.filter((v) => /^en[-_]US$/i.test(v.lang));
  const pool = (us.length >= 2 ? us : en.length ? en : options).slice().sort((a, b) => a.voiceURI.localeCompare(b.voiceURI));
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
