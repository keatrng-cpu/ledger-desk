/**
 * How a caption is spoken. Presentation only.
 *
 * The words stay the caption. Digits are not added and not dropped. What changes
 * is delivery: a breath at the sentence (a long run also breathes at its commas),
 * a person's pace, a pitch that settles instead of one flat note, and the beat
 * between two speakers so nobody talks over anybody. Units, signs, strikes and
 * code names are said the way a person on the desk says them ("5m" is five
 * minutes, "782C" is the 782 call, "+$128" is plus 128 dollars). A browser
 * neural voice is preferred when the machine has one; pitch stays near 1 so a
 * missing voice does not squeak.
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

/** A long run of words breathes at its commas; a short sentence is one breath, so the voice keeps its own prosody. */
const LONG_PHRASE_WORDS = 18;

function splitPhrases(text: string): string[] {
  const sentences = text
    .split(/(?<=[.!?;:])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const out: string[] = [];
  for (const sentence of sentences) {
    if (sentence.split(/\s+/).length <= LONG_PHRASE_WORDS) {
      out.push(sentence);
      continue;
    }
    // Too long for one breath: break at commas, but never leave a two-word scrap on its own.
    let cur = "";
    for (const part of sentence.split(/(?<=,)\s+/)) {
      const next = cur ? `${cur} ${part}` : part;
      if (cur && next.split(/\s+/).length > LONG_PHRASE_WORDS / 2 + 3 && part.split(/\s+/).length > 2) {
        out.push(cur);
        cur = part;
      } else cur = next;
    }
    if (cur) out.push(cur);
  }
  return out.length ? out : [text];
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

/** The smallest piece of a line the handoff needs: who said it and what. */
export interface Turn {
  character: Character;
  text: string;
}

/**
 * The quiet between one line and the next, in ms, once the first voice has FINISHED. Turn-taking, not a timer:
 * the next person never starts while the last one is still talking (the scene holds the line until the voice ends).
 * A person carrying on is a short breath; an answer to a question comes quick; Sterling lets the room land
 * before a verdict; the end of an exchange leaves a real pause before the next one starts.
 */
export function handoffMs(prev: Turn | null, next: Turn | null): number {
  if (!prev) return 0;
  if (!next) return 900;
  if (next.character === prev.character) return 240;
  let ms = 420;
  if (/\?\s*$/.test(prev.text)) ms = 260;
  // Named in the reply ("Jax, …" / "…, Nova."): the answer is already queued up.
  if (new RegExp(`(^|[\\s,])${prev.character}\\b`).test(next.text)) ms = Math.min(ms, 320);
  if (next.character === "Sterling") ms += 220;
  if (next.character === "Jax") ms -= 80;
  return Math.max(200, ms);
}

/** How long a line should take to say in this person's voice, in ms — the scene's ceiling on waiting for it. */
export function sayMs(who: Character, raw: string): number {
  const parts = phrasePlan(who, raw);
  let ms = 0;
  for (const p of parts) ms += (p.text.split(/\s+/).length * 400) / p.rate + p.gap;
  return Math.round(ms);
}

