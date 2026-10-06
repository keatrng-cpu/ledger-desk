/**
 * The spoken form of a caption — pure, presentation only.
 *
 * A caption is written to be read: `$240.50`, `−0.244R`, `620s`, `782C`, `T1`, `HTF`, `exec/limits.ts`. A speech engine given that
 * text guesses, and the guesses were wrong in ways that changed what was said: `$12` was handed over as "1 dollars 2", `$1,000` as
 * "1 dollars ,000", a minus sign was dropped (so a loss was spoken as a gain), `620s` was "six twenty ess". This module turns the
 * caption into words an engine reads the way a trader would say them, and proves it kept every number.
 *
 * Contract:
 *  - NUMBERS ARE NEVER CHANGED. `numbersHeld(raw, spoken)` compares the numeric values on both sides (a sorted multiset), with the
 *    one allowed rewrite: money is spoken as dollars and cents (`$240.50` → "240 dollars 50 cents"), an ISO date as a month name
 *    (the month is then a word, not a digit). Anything else that moves a value fails the check.
 *  - SIGNS ARE KEPT. A `+` or `−` in front of a number is said ("plus", "minus").
 *  - NO NEW FACTS. Expansions are the desk's own vocabulary (HTF → "higher timeframe"); nothing is added that the caption did not say.
 *  - No clock, no network, no model, no randomness.
 */

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const MONTH_ABBR: Record<string, string> = { Jan: "January", Feb: "February", Mar: "March", Apr: "April", Jun: "June", Jul: "July", Aug: "August", Sep: "September", Sept: "September", Oct: "October", Nov: "November", Dec: "December" };
const WEEKDAY_ABBR: Record<string, string> = { Mon: "Monday", Tue: "Tuesday", Tues: "Tuesday", Wed: "Wednesday", Thu: "Thursday", Thur: "Thursday", Thurs: "Thursday", Fri: "Friday", Sat: "Saturday", Sun: "Sunday" };

/** Letters an engine would run together or mispronounce, and the words a trader says for them. */
export const SPOKEN_EXPAND: Readonly<Record<string, string>> = {
  MNQ: "M N Q",
  MES: "M E S",
  NQ: "N Q",
  ES: "E S",
  QQQ: "Q Q Q",
  SPY: "spy",
  VIX: "vix",
  DTE: "D T E",
  SMC: "S M C",
  ICT: "I C T",
  TJR: "T J R",
  SMT: "S M T",
  ET: "Eastern",
  EDT: "Eastern",
  EST: "Eastern",
  CT: "Central",
  CDT: "Central",
  CE: "C E",
  OTE: "O T E",
  EV: "E V",
  HTF: "higher timeframe",
  LTF: "lower timeframe",
  ATR: "A T R",
  ATM: "at the money",
  OTM: "out of the money",
  ITM: "in the money",
  IV: "implied vol",
  RSI: "R S I",
  CPI: "C P I",
  FVG: "fair value gap",
  IFVG: "inverse fair value gap",
  MSS: "market structure shift",
  BE: "breakeven",
  RR: "R R",
  OI: "open interest",
  WR: "win rate",
  PF: "profit factor",
  NY: "New York",
  AM: "A M",
  PM: "P M",
  FED: "Fed",
};

/**
 * ALL-CAPS words that are words, not letters: said as the word. Anything short and unknown is an initialism and is spelled
 * (the safe default for a ticker), so a shouted word has to be listed here or it comes out as letters.
 */
const CAPS_WORDS = new Set([
  "PATH", "NOW", "RUN", "IS", "ON", "OK", "OFF", "OUT", "ADD", "HOLD", "TRIM", "CORE", "TAKE", "WAIT", "STAND", "WATCH", "LIVE", "ALL",
  "NOT", "AND", "THE", "FOR", "OR", "IF", "NO", "YES", "BUT", "ONE", "TWO", "NEW", "OLD", "LOW", "HIGH", "BIG", "FLAT", "LONG", "SHORT",
  "STOP", "HALT", "FILL", "SELL", "BUY", "PUT", "PUTS", "CALL", "CALLS", "LATE", "LOSS", "WIN", "WINS", "GOOD", "BAD", "DONE", "SENT",
  "SKIP", "PASS", "FAIL", "OPEN", "MOVE", "PLAN", "RISK", "SIZE", "GATE", "LEFT", "FREE", "FULL", "HALF", "NEXT", "LAST", "ONLY", "EVEN",
  "MORE", "LESS", "NONE", "REAL", "SAFE", "SOFT", "HARD", "FAST", "SLOW", "DEAD", "GOAL", "RACE", "TEAM", "DAYS", "CASH", "DRAW", "BULL",
  "BEAR", "FADE", "RAID", "SEE", "GET", "SET", "ANY", "CAN", "DAY", "END", "FAR", "FEW", "GOT", "HAS", "HIT", "HOT", "LOT", "MAY", "NOR",
  "OUR", "OWN", "SAY", "SIX", "TEN", "TOO", "TOP", "TRY", "USE", "WAS", "WAY", "WHO", "WHY", "YET", "YOU", "WHAT", "WHEN", "WELL", "WILL",
  "WITH", "THIS", "THAT", "THEN", "THEY", "FROM", "HAVE", "JUST", "LIKE", "LOOK", "MAKE", "MUCH", "MUST", "NEED", "OVER", "SAME", "SOME",
  "SUCH", "TAKE", "TELL", "THAN", "THEM", "VERY", "WANT", "WERE", "BACK", "BOTH", "DOWN", "EACH", "FIRST", "STILL", "WALKED", "FORMING",
]);

/**
 * How a ticker is said where spelling it is wrong: a name that is a word (META, COST, GRID), a company everyone says by name (NVDA),
 * a ticker with no vowels to carry it. Every other ticker is spelled letter by letter, which is how a trader says an ETF.
 * A ticker of five letters or more that is not here would be lowercased as a shouted word — scripts/verify-spoken-form.mjs checks
 * every ticker in the research file and the dossiers against this table, so a new one cannot slip through.
 */
export const TICKER_SAY: Readonly<Record<string, string>> = {
  NVDA: "Nvidia", AAPL: "Apple", MSFT: "Microsoft", AMZN: "Amazon", GOOGL: "Alphabet", GOOG: "Alphabet", META: "Meta", TSLA: "Tesla",
  AVGO: "Broadcom", LLY: "Lilly", COST: "Costco", AMGN: "Amgen", PFE: "Pfizer", LMT: "Lockheed", NVO: "Novo Nordisk", ETN: "Eaton",
  CEG: "Constellation", CRWD: "CrowdStrike", PANW: "Palo Alto", ROK: "Rockwell", PWR: "Quanta", CCJ: "Cameco", LEU: "Centrus",
  OKLO: "Oklo", IONQ: "Ion Q", QBTS: "D-Wave", RKLB: "Rocket Lab", BLK: "BlackRock", SCHW: "Schwab", STT: "State Street", SYM: "Symbotic",
  GEV: "G E Vernova", FANUY: "Fanuc", SIEGY: "Siemens", GRID: "grid", HACK: "hack", PAVE: "pave", ROBO: "robo", SHLD: "shield", BUG: "bug",
};

/** A word in a code name, said as a person would say it. */
const CODE_WORD: Record<string, string> = { frac: "fraction", cfg: "config", exec: "execution", tf: "timeframe", max: "max", min: "min" };

const UNIT: Record<string, readonly [string, string]> = {
  s: ["second", "seconds"],
  sec: ["second", "seconds"],
  secs: ["second", "seconds"],
  ms: ["millisecond", "milliseconds"],
  m: ["minute", "minutes"],
  min: ["minute", "minutes"],
  mins: ["minute", "minutes"],
  h: ["hour", "hours"],
  hr: ["hour", "hours"],
  hrs: ["hour", "hours"],
  d: ["day", "days"],
  w: ["week", "weeks"],
  wk: ["week", "weeks"],
  pt: ["point", "points"],
  pts: ["point", "points"],
  bp: ["basis point", "basis points"],
  bps: ["basis point", "basis points"],
};
/** After a number that is one unit, these nouns want the singular ("a 15 minute close", "the 4 hour bias"). */
const ADJECTIVAL = /^(bias|chart|candle|bar|close|confirm|confirmation|tape|window|hold|rung|timeframe|structure|range|bucket|delay|clock|brake|horizon|data|high|low|trend|frame|view)\b/i;

const PER_UNIT = new Set(["card", "trade", "contract", "share", "week", "month", "day", "fill", "session", "bar", "hour", "minute", "year", "ticket", "leg", "plan", "setup"]);

const num = (s: string): number => Number(s.replace(/,/g, ""));
const plural = (n: string, one: string, many: string): string => (num(n) === 1 ? one : many);
const words = (s: string): string => s.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/_/g, " ").toLowerCase().split(/\s+/).map((w) => CODE_WORD[w] ?? w).join(" ");

function moneyWords(sign: string, amount: string, suffix: string | undefined): string {
  const sg = sign ? `${sign === "+" ? "plus" : "minus"} ` : "";
  if (suffix) {
    const big = { k: "thousand", m: "million", b: "billion" }[suffix.toLowerCase() as "k" | "m" | "b"];
    return `${sg}${amount} ${big} dollars`;
  }
  const dot = amount.indexOf(".");
  if (dot < 0) return `${sg}${amount} ${plural(amount, "dollar", "dollars")}`;
  const whole = amount.slice(0, dot);
  const frac = amount.slice(dot + 1);
  if (frac.length !== 2) return `${sg}${amount} dollars`;
  const cents = Number(frac);
  if (cents === 0) return `${sg}${whole} ${plural(whole, "dollar", "dollars")}`;
  if (num(whole) === 0) return `${sg}${cents} ${cents === 1 ? "cent" : "cents"}`;
  return `${sg}${whole} ${plural(whole, "dollar", "dollars")} ${cents} ${cents === 1 ? "cent" : "cents"}`;
}

/** Code names are not speech: a file is "the limits file", camelCase and SNAKE_CASE become the words they are. */
function codeNames(s: string): string {
  let t = s;
  t = t.replace(/(?:[\w-]+\/)*([\w-]+)\.(?:tsx?|mjs|cjs|jsx?|json|py|sql|md)\b/g, (_m, base: string) => `the ${words(base)} file`);
  // A strike offset the way the desk says it: OTM_1 is "1 strike out", OTM_2 "2 strikes out".
  t = t.replace(/\bOTM_(\d+)\b/g, (_m, k: string) => `${k} ${k === "1" ? "strike" : "strikes"} out`);
  t = t.replace(/\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/g, (m) => words(m));
  t = t.replace(/\b[a-z0-9]+(?:_[a-z0-9]+)+\b/g, (m) => words(m));
  t = t.replace(/\b[a-z]+(?:[A-Z][a-z0-9]*)+\b/g, (m) => words(m));
  return t;
}

/** "BlackRock (iShares) (BLK)": the ticker says again the name just said — drop it. A ticker that is not a repeat is kept. */
function dropRepeatedTickers(s: string): string {
  return s.replace(/\s*\(\s*([A-Z]{2,5})\s*\)/g, (m, tk: string, off: number, whole: string) => {
    const name = TICKER_SAY[tk];
    if (!name) return m;
    return whole.slice(Math.max(0, off - 60), off).toLowerCase().includes(name.toLowerCase()) ? "" : m;
  });
}

function money(s: string): string {
  // "$1.2M", "$5K" — and "$20.877 billion": the size word follows the amount, the word "dollars" goes after it.
  return s.replace(/(^|[^\w.])([+−-]?)\$(\d+(?:,\d{3})*(?:\.\d+)?)([kKmMbB](?![A-Za-z])|\s+(?:thousand|million|billion|trillion)\b)?/g, (_m, pre: string, sign: string, amount: string, suffix: string | undefined) => {
    const word = suffix?.trim();
    if (word && word.length > 1) return `${pre}${sign ? `${sign === "+" ? "plus" : "minus"} ` : ""}${amount} ${word.toLowerCase()} dollars`;
    return `${pre}${moneyWords(sign, amount, suffix)}`;
  });
}

function isoDates(s: string): string {
  return s.replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, (m, y: string, mo: string, d: string) => {
    const name = MONTHS[Number(mo) - 1];
    return name && Number(d) >= 1 && Number(d) <= 31 ? `${name} ${Number(d)}, ${y}` : m;
  });
}

function units(s: string): string {
  let t = s;
  t = t.replace(/(?<![\w.])(\d{1,2}(?::\d{2})?)\s?([AaPp])\.?[Mm]\.?(?![A-Za-z])/g, (_m, clock: string, ap: string) => `${clock} ${ap.toUpperCase()} M`);
  t = t.replace(/(?<![\w.])(\d+(?:,\d{3})*(?:\.\d+)?)(x)(?![\w'])/g, (_m, n: string) => `${n} times`);
  t = t.replace(/(?<![\w.])(\d+(?:,\d{3})*(?:\.\d+)?)([KMB])(?![\w'])/g, (_m, n: string, k: string) => `${n} ${{ K: "thousand", M: "million", B: "billion" }[k as "K" | "M" | "B"]}`);
  t = t.replace(/(?<![\w.])(\d+(?:,\d{3})*(?:\.\d+)?)(R)(?![\w'])/g, (_m, n: string) => `${n} R`);
  t = t.replace(/(?<![\w.])(\d+(?:,\d{3})*(?:\.\d+)?)(sec|secs|ms|mins?|hrs?|bps?|pts?|wk|[smhdw])(?![\w'])/g, (m, n: string, u: string, off: number, whole: string) => {
    const forms = UNIT[u];
    if (!forms) return m;
    const next = whole.slice(off + m.length);
    const adj = num(n) !== 1 && ADJECTIVAL.test(next.replace(/^\s+/, "")) && /^\s/.test(next);
    return `${n} ${num(n) === 1 || adj ? forms[0] : forms[1]}`;
  });
  t = t.replace(/(?<![\w.])(\d+(?:,\d{3})*(?:\.\d+)?) (min|mins|hr|hrs|pt|pts|sec|secs|s)(?![\w'])/g, (m, n: string, u: string) => {
    const forms = UNIT[u];
    return forms ? `${n} ${num(n) === 1 ? forms[0] : forms[1]}` : m;
  });
  return t;
}

function ratiosAndSlashes(s: string): string {
  let t = s;
  t = t.replace(/\bR:R\b/g, "risk to reward");
  t = t.replace(/\b(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)\b/g, (m, a: string, b: string) => (/^\d{1,2}$/.test(a) && /^\d{2}$/.test(b) && Number(b) < 60 && Number(a) < 25 ? m : `${a} to ${b}`));
  t = t.replace(/\b(\d+)\/(\d+)\b/g, "$1 of $2");
  t = t.replace(/\b([A-Za-z]{1,6})\/(\d+)/g, "$1 over $2");
  t = t.replace(/\bn\/a\b/gi, "not available");
  t = t.replace(/\bm\/m\b/gi, "month over month");
  t = t.replace(/\b([A-Za-z]+)\/([A-Za-z]+)\b/g, (_m, a: string, b: string) => (PER_UNIT.has(b.toLowerCase()) ? `${a} per ${b}` : `${a} or ${b}`));
  return t;
}

function symbols(s: string): string {
  return s
    .replace(/(\d+)\s*×\s*(?=[A-Z]{2,5}\b)/g, "$1 ")
    .replace(/(\d)\s*¢/g, "$1 cents")
    .replace(/(\d)\s*Δ/g, "$1 delta")
    .replace(/Δ/g, "delta ")
    .replace(/(\d)\s*→\s*(?=[\d$+−-])/g, "$1 to ")
    .replace(/→/g, ", then ")
    .replace(/(\d[\d,.]*)\s*×/g, "$1 times")
    .replace(/\s[−]\s/g, " minus ")
    .replace(/×\s*(\d)/g, "times $1")
    .replace(/×/g, " times ")
    .replace(/[·•]/g, ", ")
    .replace(/←/g, " from ")
    .replace(/↑/g, " up ")
    .replace(/↓/g, " down ")
    .replace(/≥/g, " at least ")
    .replace(/≤/g, " at most ")
    .replace(/≈/g, " about ")
    .replace(/~(?=\s?\d)/g, " about ")
    .replace(/±/g, " plus or minus ")
    .replace(/\s=\s/g, " equals ")
    .replace(/\s>\s/g, " above ")
    .replace(/\s<\s/g, " below ")
    .replace(/%/g, " percent")
    .replace(/&/g, " and ")
    .replace(/@/g, " at ")
    .replace(/#(?=\d)/g, "number ")
    .replace(/[|]/g, ", ")
    .replace(/[[\]{}*`^"“”]/g, " ")
    .replace(/…/g, ". ")
    .replace(/[—–]/g, ", ")
    .replace(/;/g, ", ")
    .replace(/[()]/g, ", ");
}

function jargon(s: string): string {
  let t = s;
  t = t.replace(/\bT([1-9])s\b/g, "target $1 hits").replace(/\bT([1-9])\b/g, "target $1").replace(/\bt([12])\b/g, "target $1");
  t = t.replace(/\bCHoCH\b/gi, "change of character").replace(/\bBOS\b/g, "break of structure");
  // Letters then a digit (IC3, Q3): the letters are spelled, the digit is said.
  t = t.replace(/\b([A-Z]{1,5})(\d{1,2})\b/g, (_m, letters: string, d: string) => `${letters.split("").join(" ")} ${d}`);
  t = t.replace(/\b(\d{2,4}(?:\.\d+)?)([CP])\b/g, (_m, n: string, cp: string) => `${n} ${cp === "C" ? "call" : "put"}`);
  t = t.replace(/\b(call|put)-(\d+)\b/g, "$1 number $2");
  t = t.replace(/\b(\d+)(DTE)\b/g, "$1 $2");
  t = t.replace(/\b(Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sept?|Oct|Nov|Dec)\b(?=\s+\d)/g, (m) => MONTH_ABBR[m] ?? m);
  t = t.replace(/\b(Mon|Tues?|Wed|Thurs?|Fri|Sat|Sun)\b(?=\s+\d)/g, (m) => WEEKDAY_ABBR[m] ?? m);
  t = t.replace(/\bvs\.?(?=\s)/gi, "versus").replace(/\bavg\b/gi, "average").replace(/\be\.g\./gi, "for example").replace(/\bi\.e\./gi, "that is");
  t = t.replace(/\bev\b/g, "E V");
  t = t.replace(/\b[A-Z]{2,}\b/g, (m) => {
    const hit = SPOKEN_EXPAND[m] ?? TICKER_SAY[m];
    if (hit) return hit;
    if (CAPS_WORDS.has(m)) return m.toLowerCase();
    return m.length >= 5 ? m.toLowerCase() : m.split("").join(" ");
  });
  return t;
}

/** The caption, shaped so a voice says it the way a trader would. Same numbers, same claim. */
export function spokenForm(raw: string): string {
  let s = raw.replace(/[   ]/g, " ");
  s = codeNames(s);
  s = dropRepeatedTickers(s);
  s = s.replace(/E\[R\]/g, "expected R");
  s = s.replace(/\bP\(T([12])\s*\|\s*fill\)/g, "chance of target $1 if filled");
  s = s.replace(/\bP\(T([12])\)(?=\s*[+−-]?\$?\.?\d)/g, "chance of target $1,").replace(/\bP\(T([12])\)/g, "chance of target $1");
  s = s.replace(/\b([A-D])\+/g, "$1 plus").replace(/\b([A-D])[−-](?=[\s.,;)]|$)/g, "$1 minus");
  s = isoDates(s);
  s = money(s);
  s = s.replace(/(^|[\s(\[,;:])([+−-])(?=\.?\d)/g, (_m, pre: string, sg: string) => `${pre}${sg === "+" ? "plus" : "minus"} `);
  s = s.replace(/(\d%?)\s*[-–]\s*(\d)/g, "$1 to $2");
  s = units(s);
  s = ratiosAndSlashes(s);
  s = symbols(s);
  s = jargon(s);
  s = s.replace(/\.(?:\s*\.)+/g, ".").replace(/\s+/g, " ").replace(/\s+([,.!?])/g, "$1").replace(/([,.!?])(?:\s*,)+/g, "$1").replace(/,\s*\./g, ".").replace(/\s*,\s*([:;])/g, "$1").replace(/^[\s,.]+/, "").replace(/,\s*$/, "").trim();
  return s;
}

/* ── Brevity: a long caption is said without its asides ────────────────── */

/** A sentence that opens with one of these is the author marking it secondary. */
const LEAD_INS = /^(for the record|for reference|for context|note that|by the way|incidentally)\b/i;
/** A spoken line longer than this (about sixteen seconds) is said as a digest. */
export const DIGEST_ABOVE_WORDS = 34;
/** A parenthesis of at least this many words is an aside; a short one ("($287)", "(+8 pts)") is data and stays. */
export const ASIDE_WORDS = 5;
const rawWords = (s: string): number => s.split(/\s+/).filter(Boolean).length;

/**
 * The caption with its asides taken out: parentheses of five words or more, and sentences the author opened with "For the record".
 * The first sentence always stays. Nothing here is rewritten, only removed — and the removed numbers are exactly the ones inside the
 * removed text, which `numbersHeld(digestOf(raw), spoken)` checks.
 */
export function digestOf(raw: string): string {
  const noAsides = raw.replace(/\s*\(([^()]*)\)/g, (m, inner: string) => (rawWords(inner) >= ASIDE_WORDS ? "" : m));
  const sentences = noAsides.split(/(?<=[.!?])\s+/);
  return sentences.filter((s, i) => i === 0 || !LEAD_INS.test(s.trim())).join(" ").trim();
}

/**
 * What the voice says. A short caption is said whole. A long one is said as its digest — the caption on screen keeps the asides —
 * unless the digest would leave too little to be a thought.
 */
export function spokenDigest(raw: string): string {
  const full = spokenForm(raw);
  if (full.split(/\s+/).length <= DIGEST_ABOVE_WORDS) return full;
  const short = spokenForm(digestOf(raw));
  return short.split(/\s+/).length >= 14 ? short : full;
}

/* ── The invariant: the voice states the caption's numbers ─────────────── */

/**
 * The numeric values in a text, sorted. `spoken` reads the money form ("240 dollars 50 cents" is 240.5, "4 cents" is 0.04) and an
 * ISO date counts for its year and day on the caption side, because the spoken month is a word.
 */
export function numbersOf(text: string, spoken = false): number[] {
  let t = text.replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, " $1 $3 ");
  const out: number[] = [];
  // Cents are hundredths on both sides: the caption's "4¢" and the voice's "4 cents" are 0.04, "5.3¢" and "5.3 cents" are 0.053.
  t = t.replace(/(?<![\d.,])(\d+(?:,\d{3})*(?:\.\d+)?)\s*¢/g, (_m, c: string) => {
    out.push(num(c) / 100);
    return " ";
  });
  if (spoken) {
    t = t.replace(/(\d+(?:,\d{3})*(?:\.\d+)?)\s+dollars?\s+(\d+)\s+cents?\b/g, (_m, w: string, c: string) => {
      out.push(num(w) + Number(c) / 100);
      return " ";
    });
    t = t.replace(/(?<![\d.,])(\d+(?:,\d{3})*(?:\.\d+)?)\s+cents?\b/g, (_m, c: string) => {
      out.push(num(c) / 100);
      return " ";
    });
  }
  for (const m of t.matchAll(/\d+(?:,\d{3})*(?:\.\d+)?/g)) out.push(num(m[0]));
  return out.sort((a, b) => a - b);
}

/** True when the spoken form says exactly the caption's numbers — none dropped, none added, none split. */
export function numbersHeld(raw: string, spoken: string): boolean {
  const a = numbersOf(raw);
  const b = numbersOf(spoken, true);
  return a.length === b.length && a.every((v, i) => Math.abs(v - b[i]!) < 1e-9);
}

/** Every `+` or `−` that sits in front of a number in the caption is said in the spoken form. */
export function signsHeld(raw: string, spoken: string): boolean {
  const signed = (raw.match(/(^|[\s(\[,;:])[+−-](?=\$?\.?\d)/g) ?? []).length;
  const said = (spoken.match(/\b(plus|minus)\b(?=\s+\d)/g) ?? []).length;
  return said >= signed;
}

/* ── Breath: a long caption is said as sentences ───────────────────────── */

const wc = (s: string): number => s.split(/\s+/).filter(Boolean).length;

/**
 * A long caption is spoken as sentence-sized pieces. Engines that stream a voice from the network stop an utterance after about
 * fifteen seconds, and one unbroken run has no breath: it lands as a list. Short captions stay one piece. A piece is never cut
 * inside a number or a word; it ends where a sentence does, or at a comma when one sentence is itself too long.
 */
export function chunkSpoken(spoken: string, maxWords = 26): string[] {
  const t = spoken.trim();
  if (!t) return [];
  if (wc(t) <= maxWords) return [t];
  const sentences = t.split(/(?<=[.!?])\s+(?=[A-Z0-9"'(])/).filter(Boolean);
  const pieces: string[] = [];
  // Last resort for a run with no punctuation to break on: at a conjunction near the limit, never before a number and never between
  // a number and its unit ("240 dollars | 50 cents" would be two utterances).
  const byWords = (s: string): string[] => {
    const w = s.split(/\s+/);
    const out: string[] = [];
    let i = 0;
    while (w.length - i > maxWords + 8) {
      let end = i + maxWords;
      for (let j = i + maxWords; j > i + maxWords - 10; j--) {
        if (/^(and|but|so|then|because|while|with|which|that|when|if)$/i.test(w[j] ?? "") && !/^\d/.test(w[j] ?? "")) {
          end = j;
          break;
        }
      }
      while (end > i + 6 && (/^\d/.test(w[end] ?? "") || /^(dollars?|cents?|percent|seconds?|minutes?|hours?|days?|points?|times|R)$/i.test(w[end] ?? ""))) end--;
      out.push(w.slice(i, end).join(" "));
      i = end;
    }
    out.push(w.slice(i).join(" "));
    return out;
  };
  const push = (s: string) => {
    if (wc(s) <= maxWords + 8) return void pieces.push(s);
    const bits = s.split(/(?<=,)\s+/);
    let cur = "";
    const flush = () => {
      for (const part of wc(cur) > maxWords + 8 ? byWords(cur.trim()) : [cur.trim()]) if (part) pieces.push(part);
    };
    for (const b of bits) {
      if (cur && wc(cur) + wc(b) > maxWords && wc(cur) >= 6) {
        flush();
        cur = b;
      } else cur = cur ? `${cur} ${b}` : b;
    }
    if (cur.trim()) flush();
  };
  for (const sent of sentences) push(sent);
  const out: string[] = [];
  for (const p of pieces) {
    const last = out[out.length - 1];
    if (last && wc(last) + wc(p) <= maxWords && (wc(last) < 6 || wc(p) < 6)) out[out.length - 1] = `${last} ${p}`;
    else out.push(p);
  }
  return out;
}
