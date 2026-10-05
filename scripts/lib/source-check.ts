/**
 * Does the page a figure cites still say that figure? — the pure half of `scripts/check-research-sources.mjs`.
 *
 * No model, no network: given the figure as the research file quotes it and the text of the page it cites, say which of the
 * figure's numbers appear in the page. It exists because a figure's accuracy is a property of a page, not of how confident the
 * person (or the model) who typed it was — two search-engine summaries in the 2026-10-05 research pass had a year swapped and a
 * percentage off by a tenth, and only a read of the primary page caught them.
 *
 * What it can and cannot say: a number that is NOT in the page is a finding (the page moved on, the figure was mistyped, or the
 * page states it in other units — a person decides which). A number that IS in the page does not prove the sentence around it;
 * years and single digits carry no information and are not counted.
 */

export type CheckVerdict = "match" | "partial" | "missing" | "no-numbers";

export interface FigureCheck {
  /** The informative numbers in the figure, thousands separators removed. */
  numbers: string[];
  found: string[];
  /** Found only as a unit conversion of another number in the figure that IS on the page (7.25 trillion ← 7,248,070 million). */
  derived: string[];
  missing: string[];
  /** The whole figure, whitespace-normalised, appears verbatim in the page. */
  phrase: boolean;
  verdict: CheckVerdict;
}

const SPACES = /[     ]/g;

/** Page text as the matcher reads it: lower case, odd spaces folded, thousands separators removed, whitespace collapsed. */
export function normalizePage(text: string): string {
  let t = text.replace(SPACES, " ").toLowerCase();
  // 7,248,070 · 28 600 · 1 008 597 → 7248070 · 28600 · 1008597 (a group of exactly three digits after the separator)
  for (let i = 0; i < 4; i++) t = t.replace(/(\d)[, ](?=\d{3}(?!\d))/g, "$1");
  return t.replace(/\s+/g, " ");
}

const isYear = (tok: string): boolean => /^\d{4}$/.test(tok) && Number(tok) >= 1900 && Number(tok) <= 2100;

/**
 * The numbers worth looking for in a figure: not years, not single digits without a decimal (they match anything), commas
 * removed. "3-3/4 to 4 percent" has none — it can only be matched as a phrase.
 */
export function figureNumbers(figure: string): string[] {
  const out: string[] = [];
  for (const m of figure.replace(SPACES, " ").matchAll(/\d[\d,]*(?:\.\d+)?/g)) {
    const tok = m[0].replace(/,/g, "").replace(/\.$/, "");
    if (!tok || isYear(tok)) continue;
    if (/^\d$/.test(tok)) continue;
    if (!out.includes(tok)) out.push(tok);
  }
  return out;
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A number appears in the (normalised) page as a whole number: not inside a longer one, and 3.6 also matches 3.60. */
function hasNumber(page: string, tok: string): boolean {
  const forms = tok.includes(".") ? [tok, `${tok}0`] : [tok];
  return forms.some((f) => new RegExp(`(?<![\\d.])${esc(f)}(?![\\d])`).test(page));
}

/** A phrase appears as itself, not inside a longer word or number: "3.6" is not found in "13.6", nor "36" in "1.36". */
function hasPhrase(page: string, phrase: string): boolean {
  return new RegExp(`(?<![A-Za-z0-9.])${esc(phrase)}(?![A-Za-z0-9])`).test(page);
}

const decimals = (tok: string): number => (tok.includes(".") ? tok.length - tok.indexOf(".") - 1 : 0);

/**
 * Is `tok` (7.25) `native` (7248070) in a larger unit, rounded the way a person would quote it? Exact arithmetic on the two
 * numbers: native / 10^k, rounded to tok's decimals, must equal tok, for k = 3, 6, 9 or 12.
 */
export function isUnitConversion(tok: string, native: string): boolean {
  const n = Number(native);
  const dec = decimals(tok);
  if (!Number.isFinite(n) || n < 1000 || dec === 0) return false;
  return [3, 6, 9, 12].some((k) => (n / 10 ** k).toFixed(dec) === Number(tok).toFixed(dec));
}

export function checkFigure(figure: string, pageText: string): FigureCheck {
  const page = normalizePage(pageText);
  const numbers = figureNumbers(figure);
  const onPage = numbers.filter((n) => hasNumber(page, n));
  const derived = numbers.filter((n) => !onPage.includes(n) && onPage.some((native) => native !== n && isUnitConversion(n, native)));
  const found = [...onPage, ...derived];
  const missing = numbers.filter((n) => !found.includes(n));
  const whole = figure.replace(SPACES, " ").toLowerCase().replace(/\s+/g, " ").trim();
  let phrase = hasPhrase(page, whole);
  // A figure with no number worth testing (a fraction, a rate) is matched by the longest opening run of its words the page has —
  // "3-3/4 to 4 percent target range" is quoted from "…to 3-3/4 to 4 percent, in support of…".
  if (!phrase && numbers.length === 0) {
    const words = whole.split(" ");
    for (let n = words.length - 1; n >= 3 && !phrase; n--) phrase = /\d/.test(words.slice(0, n).join(" ")) && hasPhrase(page, words.slice(0, n).join(" "));
  }
  const verdict: CheckVerdict = phrase ? "match" : numbers.length === 0 ? "no-numbers" : missing.length === 0 ? "match" : found.length === 0 ? "missing" : "partial";
  return { numbers, found, derived, missing, phrase, verdict };
}

/** Strip a web page to its readable text: scripts, styles and tags out, the common entities decoded. */
export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;|&#34;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/\s+/g, " ");
}
