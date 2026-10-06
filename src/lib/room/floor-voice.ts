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
  Nova: ["jenny", "aria", "victoria", "tessa", "serena", "zira", "susan", "samantha"],
  Jax: ["google uk english male", "daniel", "ryan", "guy", "alex", "aaron"],
  Sterling: ["davis", "rishi", "fred", "daniel", "guy", "google uk english male"],
  Vince: ["brandon", "tony", "tom", "alex", "aaron", "daniel"],
};

export const VOICE_CAST: Record<Character, VoiceCast> = {
  Gemma: { rate: 0.96, pattern: "lecture", lean: "female" },
  Jax: { rate: 1.02, pattern: "clip", lean: "male" },
  Nova: { rate: 0.94, pattern: "flat", lean: "female" },
  Sterling: { rate: 0.92, pattern: "verdict", lean: "male" },
  Vince: { rate: 0.98, pattern: "operator", lean: "male" },
};

const CREW: readonly Character[] = ["Gemma", "Nova", "Jax", "Sterling", "Vince"];

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

const SPELL: readonly [RegExp, string][] = [
  [/\bMNQ\b/g, "M N Q"],
  [/\bMES\b/g, "M E S"],
  [/\bNQ\b/g, "N Q"],
  [/\bES\b/g, "E S"],
  [/\bQQQ\b/g, "Q Q Q"],
  [/\bSPY\b/g, "S P Y"],
  [/DTE\b/g, " D T E"],
  [/\bSMC\b/g, "S M C"],
  [/\bICT\b/g, "I C T"],
  [/\bTJR\b/g, "T J R"],
  [/\bSMT\b/g, "S M T"],
  [/\bIFVG\b/g, "I F V G"],
  [/\bFVG\b/g, "F V G"],
  [/\bCE\b/g, "C E"],
  [/\bEV\b/g, "E V"],
  [/\bATR\b/g, "A T R"],
  [/\bATM\b/g, "A T M"],
  [/\bOTM\b/g, "O T M"],
  [/\bHTF\b/g, "H T F"],
  [/\bLTF\b/g, "L T F"],
  [/\bMSS\b/g, "M S S"],
  [/\bBOS\b/g, "B O S"],
  [/\bDOL\b/g, "D O L"],
  [/\bBSL\b/g, "B S L"],
  [/\bSSL\b/g, "S S L"],
  [/\bIRL\b/g, "I R L"],
  [/\bERL\b/g, "E R L"],
  [/\bP([DW])([HL])\b/g, "P $1 $2"],
  [/\bPD\b/g, "P D"],
  [/\bCPI\b/g, "C P I"],
  [/\bPCE\b/g, "P C E"],
  [/\bNFP\b/g, "N F P"],
  [/\bFOMC\b/g, "F O M C"],
  [/\bRH\b/g, "R H"],
  [/\bET\b/g, "E T"],
  [/\bNY AM\b/g, "New York A M"],
  [/\bBE\b/g, "break-even"],
];

/** A file path or a code name, said the way a person on the desk would say it. Digits are untouched. */
function sayCode(s: string): string {
  let t = s;
  // exec/limits.ts → "the limits file"
  t = t.replace(/\b(?:[\w-]+\/)*([A-Za-z][\w-]*)\.(?:tsx?|mjs|json)\b/g, (_m, base: string) => `the ${base.replace(/[-_]/g, " ")} file`);
  // OTM_1 → "OTM 1"
  t = t.replace(/\b([A-Z]+)_(\d+)\b/g, "$1 $2");
  // SERVER_RUNNER_BUILT → "server runner built"
  t = t.replace(/\b[A-Z][A-Z]+(?:_[A-Z]+)+\b/g, (m) => m.toLowerCase().replace(/_/g, " "));
  // t1_pays → "t1 pays"
  t = t.replace(/\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/g, (m) => m.replace(/_/g, " "));
  // maxCashFracPerTrade → "max cash frac per trade"
  t = t.replace(/\b[a-z]+(?:[A-Z][a-z]+)+\b/g, (m) => m.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase());
  return t;
}

/** The caption, shaped so a voice can say it. Same digits, same claim. */
export function speakable(raw: string): string {
  let s = sayCode(raw);
  s = s.replace(/E\[R\]/g, "expected R");
  s = s.replace(/P\(T(\d)\)/g, "the odds of T$1");
  // Money with its sign: "+$128" → "plus 128 dollars", "−$1,000" → "minus 1,000 dollars". The comma stays inside the number.
  s = s.replace(/([+−]?)\$(\d[\d,]*(?:\.\d+)?)/g, (_m, sign: string, n: string) => `${sign === "+" ? "plus " : sign === "−" ? "minus " : ""}${n.replace(/,$/, "")} dollars${n.endsWith(",") ? "," : ""}`);
  s = s.replace(/(^|[\s(])\+(?=\d)/g, "$1plus ");
  s = s.replace(/(^|[\s(])[−](?=\d)/g, "$1minus ");
  s = s.replace(/(\d)\s*[-–]\s*(\d)/g, "$1 to $2");
  s = s.replace(/\b([A-D])\+/g, "$1 plus");
  s = s.replace(/\b([A-D])[−-](?=\s|$|[.,;:!?])/g, "$1 minus");
  s = s.replace(/(\d)\+/g, "$1 plus");
  // Options and units.
  s = s.replace(/(\d)C\b/g, "$1 call");
  s = s.replace(/(\d)P\b/g, "$1 put");
  s = s.replace(/(\d)\s*×\s+(?=[A-Z])/g, "$1 ");
  s = s.replace(/(\d)\s*×/g, "$1 times");
  s = s.replace(/(\d)R\b/g, "$1 R");
  s = s.replace(/(\d)pt\b/g, "$1 points");
  s = s.replace(/(\d)¢/g, "$1 cents");
  s = s.replace(/(\d)Δ/g, "$1 delta");
  s = s.replace(/P\(T(\d)\|fill\)/g, "the odds of T$1 if filled");
  s = s.replace(/(\d) (call|put)-(\d+)\b/g, "$1 $2 number $3");
  s = s.replace(/\b1 min\b/g, "1 minute");
  s = s.replace(/(\d) min\b/g, "$1 minutes");
  s = s.replace(/(\d) s\b/g, "$1 seconds");
  s = s.replace(/\b(\d+)m\b/g, "$1 minute");
  s = s.replace(/\b(\d+)h\b/g, "$1 hour");
  s = s.replace(/\b1 pts\b/g, "1 point");
  s = s.replace(/\bpts\b/g, "points");
  s = s.replace(/(\d)\s*\/\s*(\d)/g, "$1 of $2");
  s = s.replace(/( R|\d)\/(card|fill|t|trade|mo|month|wk|week|day|session)\b/g, "$1 per $2");
  s = s.replace(/(\d+):(\d)(?!\d)/g, "$1 to $2");
  s = s.replace(/%/g, " percent");
  s = s.replace(/≥\s*/g, "at least ");
  s = s.replace(/≤\s*/g, "at most ");
  s = s.replace(/[≈~]\s*(?=\d)/g, "about ");
  s = s.replace(/\s*→\s*/g, ", then ");
  s = s.replace(/\bvs\.?\s/g, "versus ");
  s = s.replace(/\bavg\b/g, "average");
  s = s.replace(/\bn\/a\b/g, "not available");
  s = s.replace(/&/g, " and ");
  s = s.replace(/\//g, ", ");
  s = s.replace(/\s*·\s*/g, ", ");
  // A clipped caption ends on a full stop in the voice: it settles instead of hanging.
  s = s.replace(/\s*…\s*$/g, ".");
  s = s.replace(/\s*…\s+(?=[A-Z])/g, ". ");
  s = s.replace(/\s*…\s*/g, ", ");
  // An em dash is a breath (a phrase boundary), not a comma squeezed into the clause.
  s = s.replace(/\s*[—–]\s*/g, "; ");
  s = s.replace(/[()]/g, ", ");
  for (const [re, to] of SPELL) s = s.replace(re, to);
  s = s.replace(/\s+([,;.!?])/g, "$1");
  s = s.replace(/([,;])(?:\s*[,;])+/g, "$1");
  s = s.replace(/[,;]\s*([.!?])/g, "$1");
  s = s.replace(/[,;]\s*$/, ".");
  s = s.replace(/^[\s,;]+/, "");
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

/**
 * One caption, one breath. Restarting the engine on every comma is the rasp.
 * The person sets the pace. The tone nudges it. Pitch stays near 1.
 */
export function phrasePlan(who: Character, raw: string, animation?: string): SpokenPhrase[] {
  const cast = VOICE_CAST[who];
  const tone = toneOf(raw, animation);
  const shift = TONE_SHIFT[tone];
  const text = speakable(raw);
  if (!text) return [];
  return [
    {
      text,
      pitch: clamp(1 + shift.pitch, 0.98, 1.03),
      rate: clamp(cast.rate + shift.rate, 0.9, 1.05),
      gap: 0,
      tone,
    },
  ];
}

/** How long the caption should stay up so the next person does not start over it. */
export function speakHoldSec(who: Character, text: string, animation?: string): number {
  const parts = phrasePlan(who, text, animation);
  let ms = 480;
  for (const p of parts) {
    const words = p.text.split(/\s+/).length;
    ms += (words / (2.2 * p.rate)) * 1000;
  }
  return Math.min(16, Math.max(3.4, ms / 1000));
}

const RASPY = /compact|espeak|android|whisper|novelty/;
const SMOOTH = /natural|neural|premium|enhanced/;

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

function slotRank(name: string, hints: readonly string[]): number {
  const n = name.toLowerCase();
  if (RASPY.test(n)) return -100;
  let s = 0;
  const idx = hints.findIndex((h) => n.includes(h));
  if (idx >= 0) s += 120 - idx * 10;
  if (SMOOTH.test(n)) s += 40;
  if (/^google us english$/.test(n.trim())) s -= 25;
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
    if (voice && voiceGender(voice.name) === VOICE_CAST[who].lean && !used.has(uri!)) {
      out[who] = uri!;
      used.add(uri!);
    }
  }
  const rankedFor = (who: Character, freeOnly: boolean) => {
    const lean = VOICE_CAST[who].lean;
    const hints = VOICE_SLOT[who];
    return pool
      .filter((v) => voiceGender(v.name) === lean && !RASPY.test(v.name) && (!freeOnly || !used.has(v.voiceURI)))
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
  return out;
}
