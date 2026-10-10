/**
 * What the closed room studies. Pure. It reads the Invest long board, the investment office, the headline
 * feed, and the prediction rows the floor already fetched. It does not fetch, and it does not invent a
 * company, a price, or a side.
 *
 * Four passes, so the room does not dump the whole book in one speech:
 *   invest     the theme, the dollars waiting, and a rotating slice of the long-board watchlist
 *   watch      headlines that name a company already on that list
 *   outsider   a ticker in a headline that is not on the list, preferably beside one that is
 *   predict    the prediction rows, and a headline only when it shares a real subject word with the market
 */

import { LONG_NAMES } from "@/lib/invest/long-board";
import { freshCatalysts, themeOfTheDay, watchHit } from "./invest-read";
import { hash32, type InvestLite, type NewsLite, type PredictLite } from "./live-types";

export interface StudyWatch {
  ticker: string;
  name: string;
  sleeve: string;
  role: string;
}

export interface StudyHit {
  title: string;
  source: string;
  ticker: string;
  label: string;
  sleeve: string | null;
  role: string | null;
  kind: "watch" | "held" | "theme" | "competitor";
  impact: string | null;
}

export interface StudyOutsider {
  ticker: string;
  title: string;
  source: string;
  topic: string | null;
  beside: { ticker: string; name: string; sleeve: string } | null;
}

export interface StudyPredict {
  event: string;
  outcome: string;
  yesCents: number | null;
  grade: string | null;
  newsTitle: string | null;
  newsSource: string | null;
  newsTopic: string | null;
}

export interface StudyCatalyst {
  ticker: string;
  name: string;
  date: string;
  when: "pre-market" | "after close" | "time not stated";
}

export interface StudyBook {
  waitingUsd: number;
  sweptUsd: number;
  positions: number;
  nextTicker: string | null;
  nextSleeve: string | null;
  nextUsd: number | null;
}

export interface StudyPack {
  weekend: boolean;
  today: string;
  /** Changes every 90 minutes, so the names on the table rotate. */
  bucket: number;
  theme: { name: string; tier: string; claim: string; figure: string; sourceName: string; asOf: string; risk: string | null; evidence: string } | null;
  watch: StudyWatch[];
  book: StudyBook | null;
  catalyst: StudyCatalyst | null;
  hits: StudyHit[];
  outsiders: StudyOutsider[];
  predicts: StudyPredict[];
  predictSource: string | null;
  predictWhy: string | null;
}

export interface StudyInput {
  weekend: boolean;
  etDate: string;
  etMin: number;
  news: NewsLite[];
  invest: InvestLite | null;
  predict: PredictLite | null;
}

/** Index products and leveraged wrappers. A headline ticker in this set is not "another company". */
const NOT_A_COMPANY = new Set([
  "SPY", "QQQ", "IWM", "DIA", "VIX", "UVXY", "VXX", "SQQQ", "TQQQ", "SOXL", "SOXS", "TNA", "TZA", "TLT", "GLD", "USO", "HYG", "UUP", "SH", "PSQ", "BITO", "IBIT",
]);

/** Words that sit in almost every market title. One of these is not a shared subject. */
const STOP = new Set([
  "about", "after", "against", "ahead", "among", "before", "being", "below", "between", "could", "first", "from", "games", "going", "have", "higher", "lower", "market", "markets",
  "money", "next", "open", "over", "point", "points", "price", "prices", "since", "spread", "stock", "stocks", "their", "there", "these", "those", "today", "total", "trade",
  "trades", "trading", "under", "until", "week", "weeks", "which", "while", "whose", "would", "yesterday", "prediction", "predicted", "contract", "contracts", "chance", "percent",
]);

const STUDY_TOPICS = ["ai-capex", "energy", "ipo", "earnings", "regulation", "geopolitics", "nfl"] as const;

const longByTicker = new Map(LONG_NAMES.map((n) => [n.ticker.toUpperCase(), n]));

const isCompanyTicker = (t: string): boolean => /^[A-Z]{1,5}$/.test(t) && !NOT_A_COMPANY.has(t);

function tokens(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 5 && !STOP.has(w));
}

function topicOf(n: NewsLite): string | null {
  return STUDY_TOPICS.find((t) => n.topics.includes(t)) ?? null;
}

function knownTickers(inv: InvestLite | null): Set<string> {
  const s = new Set<string>(longByTicker.keys());
  if (!inv) return s;
  for (const key of Object.keys(inv.watch)) {
    if (key === key.toUpperCase() && !/\s/.test(key)) s.add(key);
  }
  return s;
}

function watchSlice(etDate: string, bucket: number): StudyWatch[] {
  const names = LONG_NAMES;
  if (!names.length) return [];
  const start = hash32(`${etDate}|${bucket}`) % names.length;
  const n = Math.min(4, names.length);
  const out: StudyWatch[] = [];
  for (let i = 0; i < n; i++) {
    const row = names[(start + i) % names.length]!;
    out.push({ ticker: row.ticker, name: row.name, sleeve: row.sleeve, role: row.role });
  }
  return out;
}

function hitsOf(news: NewsLite[], inv: InvestLite | null): StudyHit[] {
  const out: StudyHit[] = [];
  const seen = new Set<string>();
  for (const n of news) {
    const listed = n.tickers.map((t) => t.toUpperCase()).find((t) => longByTicker.has(t));
    if (listed && !seen.has(listed)) {
      const row = longByTicker.get(listed)!;
      seen.add(listed);
      out.push({
        title: n.title,
        source: n.source,
        ticker: listed,
        label: row.name,
        sleeve: row.sleeve,
        role: row.role,
        kind: "watch",
        impact: n.impact,
      });
    } else if (inv) {
      const hit = watchHit(inv, n.title, n.tickers);
      if (!hit || seen.has(hit.key)) continue;
      seen.add(hit.key);
      const isTk = hit.key === hit.key.toUpperCase() && /^[A-Z]{1,5}$/.test(hit.key);
      const row = isTk ? longByTicker.get(hit.key) : undefined;
      out.push({
        title: n.title,
        source: n.source,
        ticker: isTk ? hit.key : "",
        label: row?.name ?? hit.label,
        sleeve: row?.sleeve ?? null,
        role: row?.role ?? null,
        kind: hit.kind === "held" ? "held" : hit.kind === "competitor" ? "competitor" : row ? "watch" : "theme",
        impact: n.impact,
      });
    }
    if (out.length >= 3) break;
  }
  return out;
}

function outsidersOf(news: NewsLite[], inv: InvestLite | null): StudyOutsider[] {
  const known = knownTickers(inv);
  const out: StudyOutsider[] = [];
  const seen = new Set<string>();
  for (const n of news) {
    const besideTicker = n.tickers.map((t) => t.toUpperCase()).find((t) => longByTicker.has(t));
    const besideRow = besideTicker ? longByTicker.get(besideTicker)! : null;
    for (const raw of n.tickers) {
      const tk = raw.toUpperCase();
      if (!isCompanyTicker(tk) || known.has(tk) || seen.has(tk)) continue;
      seen.add(tk);
      out.push({
        ticker: tk,
        title: n.title,
        source: n.source,
        topic: topicOf(n),
        beside: besideRow ? { ticker: besideRow.ticker, name: besideRow.name, sleeve: besideRow.sleeve } : null,
      });
      if (out.length >= 2) return out;
    }
  }
  return out;
}

function linkScore(event: string, outcome: string, n: NewsLite): number {
  const words = new Set(tokens(`${event} ${outcome}`));
  const title = new Set(tokens(n.title));
  let score = 0;
  for (const w of words) {
    if (!title.has(w)) continue;
    score += w.length >= 5 ? 2 : 1;
  }
  for (const t of n.tickers) {
    if (t.length >= 2 && new RegExp(`(^|[^A-Za-z])${t}([^A-Za-z]|$)`, "i").test(`${event} ${outcome}`)) score += 3;
  }
  return score;
}

function predictsOf(rows: PredictLite["rows"], news: NewsLite[]): StudyPredict[] {
  const used = new Set<string>();
  return rows.slice(0, 3).map((row) => {
    let best: { n: NewsLite; score: number } | null = null;
    for (const n of news) {
      if (used.has(n.id)) continue;
      const score = linkScore(row.event, row.outcome, n);
      if (score >= 2 && (!best || score > best.score)) best = { n, score };
    }
    if (best) used.add(best.n.id);
    return {
      event: row.event,
      outcome: row.outcome,
      yesCents: row.yesCents,
      grade: row.grade,
      newsTitle: best?.n.title ?? null,
      newsSource: best?.n.source ?? null,
      newsTopic: best ? topicOf(best.n) : null,
    };
  });
}

/** Yes-price to cents. The feed stores 0–1. A value already in cents (1–100) is kept. Anything else is dropped. */
export function yesCentsOf(price: number | null | undefined): number | null {
  if (price == null || !Number.isFinite(price)) return null;
  if (price >= 0 && price <= 1) return Math.round(price * 100);
  if (price > 1 && price <= 100) return Math.round(price);
  return null;
}

export function toPredictLite(r: {
  asOf: string;
  label?: string;
  source?: string;
  reason?: string;
  markets: { event: string; outcome: string; yesPrice: number | null; setupGrade: string | null }[];
}): PredictLite {
  const rows = r.markets.slice(0, 6).map((m) => ({
    event: m.event,
    outcome: m.outcome,
    yesCents: yesCentsOf(m.yesPrice),
    grade: m.setupGrade,
  }));
  return {
    asOf: r.asOf,
    source: r.label || r.source || "Kalshi",
    reason: rows.length ? (r.reason ?? null) : (r.reason ?? "The prediction feed returned no rows."),
    rows,
  };
}

export function studyPack(i: StudyInput): StudyPack {
  const bucket = Math.floor(i.etMin / 90);
  const inv = i.invest;
  const theme = inv ? themeOfTheDay(inv, bucket) : null;
  const dm = theme?.demand[0] ?? null;
  const cat = inv ? freshCatalysts(inv)[0] ?? null : null;
  const ranked = [...i.news].sort((a, b) => (b.publishedMs ?? 0) - (a.publishedMs ?? 0));
  return {
    weekend: i.weekend,
    today: i.etDate,
    bucket,
    theme: theme && dm
      ? { name: theme.name, tier: theme.tier, claim: dm.claim, figure: dm.figure, sourceName: dm.sourceName, asOf: dm.asOf, risk: theme.risks[0] ?? null, evidence: theme.evidence }
      : null,
    watch: watchSlice(i.etDate, bucket),
    book: inv
      ? {
          waitingUsd: inv.funnel.waitingUsd,
          sweptUsd: inv.funnel.sweptUsd,
          positions: inv.book.positions,
          nextTicker: inv.next?.ticker ?? null,
          nextSleeve: inv.next?.sleeve ?? null,
          nextUsd: inv.next && inv.next.usd > 0 ? inv.next.usd : null,
        }
      : null,
    catalyst: cat ? { ticker: cat.ticker, name: cat.name, date: cat.date, when: cat.when } : null,
    hits: hitsOf(ranked, inv),
    outsiders: outsidersOf(ranked, inv),
    predicts: i.predict ? predictsOf(i.predict.rows, ranked) : [],
    predictSource: i.predict?.source ?? null,
    predictWhy: i.predict ? (i.predict.rows.length ? null : i.predict.reason) : "The prediction book has not been read this session.",
  };
}
