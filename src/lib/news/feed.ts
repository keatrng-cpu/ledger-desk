/**
 * Headlines, parsed and tagged — deterministically, never by a model.
 *
 * WHAT THIS IS FOR
 * The News tab answers one question per clock: does this matter for a
 * futures day trade (hours), an options swing (days), or the share book
 * (years)? A headline gets tags from fixed dictionaries — the tickers it
 * names (with their weight inside QQQ, the index the options sleeve trades),
 * the macro topic it touches, and whether it brushes a dossier's pre-written
 * kill rule. Tags decide which clock it is shown under. Nothing here reads
 * sentiment, predicts a move, or reaches a gate: a headline is data.
 *
 * WHY NOT AN LLM SUMMARY
 * The desk's rule is no model in anything that runs on a schedule, and the
 * account rule is no model where an exact answer is fetchable. Which ticker a
 * headline names is fetchable by matching text. So it is matched.
 */

export interface FeedSource {
  id: string;
  name: string;
  url: string;
  /** Primary sources publish the fact itself (the Fed, BEA). */
  primary: boolean;
}

/** Checked 2026-09-27: each returns current items. MarketWatch's MarketPulse feed is stale since 2025 and is left out. */
export const FEEDS: FeedSource[] = [
  { id: "fed-press", name: "Federal Reserve", url: "https://www.federalreserve.gov/feeds/press_all.xml", primary: true },
  { id: "fed-speech", name: "Fed speeches", url: "https://www.federalreserve.gov/feeds/speeches.xml", primary: true },
  { id: "bea", name: "BEA", url: "https://apps.bea.gov/rss/rss.xml", primary: true },
  { id: "cnbc-top", name: "CNBC", url: "https://www.cnbc.com/id/100003114/device/rss/rss.html", primary: false },
  { id: "cnbc-econ", name: "CNBC Economy", url: "https://www.cnbc.com/id/20910258/device/rss/rss.html", primary: false },
  { id: "cnbc-earn", name: "CNBC Earnings", url: "https://www.cnbc.com/id/15839135/device/rss/rss.html", primary: false },
  { id: "mw-top", name: "MarketWatch", url: "https://feeds.content.dowjones.io/public/rss/mw_topstories", primary: false },
  { id: "yahoo", name: "Yahoo Finance", url: "https://finance.yahoo.com/news/rssindex", primary: false },
];

export interface FeedItem {
  id: string;
  title: string;
  link: string;
  /** ISO timestamp, or null when the feed gave no parseable date. */
  published: string | null;
  source: string;
  primary: boolean;
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  mdash: "—",
  ndash: "–",
  rsquo: "’",
  lsquo: "‘",
  rdquo: "”",
  ldquo: "“",
  hellip: "…",
};

export function decodeEntities(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n: string) => ENTITIES[n.toLowerCase()] ?? m)
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function tag(block: string, name: string): string | null {
  const m = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i").exec(block);
  return m ? m[1] : null;
}

function hash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/**
 * RSS 2.0 <item> and Atom <entry>, parsed with patterns rather than a DOM
 * (this runs on the server, where there is no DOMParser). A malformed item
 * is skipped, never guessed at.
 */
export function parseFeed(xml: string, source: FeedSource): FeedItem[] {
  if (typeof xml !== "string" || !xml.includes("<")) return [];
  const blocks = [...xml.matchAll(/<item[\s>][\s\S]*?<\/item>/gi), ...xml.matchAll(/<entry[\s>][\s\S]*?<\/entry>/gi)].map((m) => m[0]);
  const out: FeedItem[] = [];
  for (const b of blocks) {
    const title = decodeEntities(tag(b, "title") ?? "");
    let link = decodeEntities(tag(b, "link") ?? "");
    if (!link) {
      const href = /<link[^>]*href="([^"]+)"/i.exec(b);
      link = href ? href[1] : "";
    }
    if (!title || !/^https?:\/\//i.test(link)) continue;
    const rawDate = decodeEntities(tag(b, "pubDate") ?? tag(b, "published") ?? tag(b, "updated") ?? tag(b, "dc:date") ?? "");
    const t = Date.parse(rawDate);
    out.push({
      id: hash(link),
      title,
      link,
      published: Number.isFinite(t) ? new Date(t).toISOString() : null,
      source: source.name,
      primary: source.primary,
    });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Tagging                                                             */
/* ------------------------------------------------------------------ */

/**
 * Names the desk cares about, matched as whole words. Tickers of three
 * letters or fewer are matched by NAME only — "V", "MA", "ETN" and "CEG" as
 * bare strings would match ordinary words and abbreviations.
 */
export const NAMES: Record<string, string[]> = {
  NVDA: ["Nvidia", "NVDA"],
  AAPL: ["Apple", "AAPL"],
  MSFT: ["Microsoft", "MSFT"],
  AMZN: ["Amazon", "AMZN"],
  GOOGL: ["Alphabet", "Google", "GOOGL"],
  META: ["Meta Platforms", "Meta", "Facebook"],
  AVGO: ["Broadcom", "AVGO"],
  TSLA: ["Tesla", "TSLA"],
  MU: ["Micron"],
  AMD: ["AMD", "Advanced Micro Devices"],
  NFLX: ["Netflix"],
  COST: ["Costco"],
  WMT: ["Walmart"],
  PLTR: ["Palantir"],
  INTC: ["Intel"],
  CSCO: ["Cisco"],
  V: ["Visa"],
  MA: ["Mastercard"],
  LLY: ["Eli Lilly", "Lilly"],
  JNJ: ["Johnson & Johnson", "J&J"],
  JPM: ["JPMorgan", "JPMorgan Chase"],
  ETN: ["Eaton"],
  CEG: ["Constellation Energy"],
  NEE: ["NextEra"],
  EQIX: ["Equinix"],
  TSM: ["TSMC", "Taiwan Semiconductor"],
  ASML: ["ASML"],
  ORCL: ["Oracle"],
  "BRK-B": ["Berkshire Hathaway", "Berkshire"],
};

export type Topic =
  | "fed"
  | "inflation"
  | "jobs"
  | "growth"
  | "rates"
  | "trade"
  | "energy"
  | "earnings"
  | "ipo"
  | "ai-capex"
  | "regulation"
  | "geopolitics"
  | "crypto";

export const TOPICS: Record<Topic, RegExp> = {
  fed: /\b(fed|federal reserve|fomc|powell|rate cut|rate hike|interest rates?|monetary policy)\b/i,
  inflation: /\b(cpi|pce|inflation|consumer prices|producer prices|ppi)\b/i,
  jobs: /\b(jobs? report|payrolls?|nonfarm|unemployment|jobless|labor market|hiring|layoffs?)\b/i,
  growth: /\b(gdp|recession|economy|economic growth|consumer spending|retail sales|ism)\b/i,
  rates: /\b(treasur(y|ies)|bond yields?|10-year|yields?|bond market)\b/i,
  trade: /\b(tariffs?|trade war|trade deal|export controls?|import duties)\b/i,
  energy: /\b(oil|crude|opec|natural gas|gasoline)\b/i,
  earnings: /\b(earnings|quarterly results|revenue|guidance|outlook|beats?|misses|profit)\b/i,
  ipo: /\b(ipo|initial public offering|public debut|goes public|listing|direct listing)\b/i,
  "ai-capex": /\b(ai spending|capex|capital spending|data centers?|gpus?|hyperscalers?)\b/i,
  regulation: /\b(antitrust|doj|ftc|sec\b|lawsuit|ruling|regulators?|probe|fine[ds]?)\b/i,
  geopolitics: /\b(war|sanctions?|missile|strikes?|china|taiwan|russia|ukraine|iran|israel|middle east)\b/i,
  crypto: /\b(bitcoin|crypto|ethereum|stablecoin)\b/i,
};

/**
 * Words from each dossier's pre-written kill rule. A headline that names the
 * company AND one of these is flagged: read the source against the rule. It
 * does not trip anything — a person does that (kill-store.ts).
 */
export const KILL_WORDS: Record<string, RegExp> = {
  GOOGL: /\b(antitrust|remedy|divest|breakup|search default|ad manager|youtube)\b/i,
  MSFT: /\b(azure|openai|write-?down)\b/i,
  V: /\b(interchange|swipe fees?|credit card competition|fednow|real-time payments?)\b/i,
  COST: /\b(membership|renewal rate|membership fee)\b/i,
  LLY: /\b(drug pricing|medicare|glp-1|incretin|phase 3|trial)\b/i,
  NVDA: /\b(export controls?|china|in-house (chips?|silicon)|custom chips?)\b/i,
  AAPL: /\b(search deal|default search|google payments?|app store|services revenue)\b/i,
  ETN: /\b(orders|backlog|data center)\b/i,
  CEG: /\b(power purchase|ppa|nuclear|merchant power)\b/i,
};

export type Horizon = "day" | "swing" | "invest";

export interface Tagged extends FeedItem {
  tickers: string[];
  topics: Topic[];
  horizons: Horizon[];
  /** 1 = read it; 2 = market context; 3 = not about this desk. */
  tier: 1 | 2 | 3;
  /** Dossier tickers whose kill-rule words this headline touches. */
  killRule: string[];
  why: string;
}

const MACRO: Topic[] = ["fed", "inflation", "jobs", "growth", "rates", "trade", "energy", "geopolitics"];

function nameRegex(n: string): RegExp {
  const esc = n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^A-Za-z])${esc}([^A-Za-z]|$)`);
}

const NAME_RX: [string, RegExp[]][] = Object.entries(NAMES).map(([t, ns]) => [t, ns.map(nameRegex)]);

/**
 * Tag one headline. `qqqWeight` gives the ticker's weight inside QQQ so a
 * mention of an 8.5% holding outranks a 0.2% one. `dossiers` are the names
 * the share book researches.
 */
export function tagItem(item: FeedItem, qqqWeight: (t: string) => number, dossiers: Set<string>): Tagged {
  const text = item.title;
  const tickers = NAME_RX.filter(([, rxs]) => rxs.some((r) => r.test(text))).map(([t]) => t);
  const topics = (Object.keys(TOPICS) as Topic[]).filter((k) => TOPICS[k].test(text));
  const killRule = tickers.filter((t) => KILL_WORDS[t]?.test(text));
  const heavy = tickers.filter((t) => qqqWeight(t) >= 0.02);
  const horizons = new Set<Horizon>();
  if (topics.some((t) => MACRO.includes(t)) || heavy.length) horizons.add("day");
  if (topics.includes("earnings") || topics.some((t) => ["fed", "inflation", "jobs"].includes(t)) || tickers.some((t) => qqqWeight(t) > 0)) horizons.add("swing");
  if (tickers.some((t) => dossiers.has(t)) || topics.some((t) => ["ipo", "regulation", "ai-capex"].includes(t)) || item.primary) horizons.add("invest");

  let tier: Tagged["tier"] = 3;
  const reasons: string[] = [];
  if (killRule.length) {
    tier = 1;
    reasons.push(`touches ${killRule.join("/")}'s kill rule`);
  }
  if (heavy.length) {
    tier = 1;
    reasons.push(heavy.map((t) => `${t} is ${(qqqWeight(t) * 100).toFixed(1)}% of QQQ`).join(", "));
  }
  if (topics.some((t) => ["fed", "inflation", "jobs"].includes(t))) {
    tier = 1;
    reasons.push("scheduled-macro topic");
  }
  if (item.primary) {
    tier = 1;
    reasons.push("primary source");
  }
  if (tier === 3 && (tickers.length || topics.length)) {
    tier = 2;
    reasons.push([...tickers, ...topics].slice(0, 3).join(", "));
  }
  return {
    ...item,
    tickers,
    topics,
    horizons: [...horizons],
    tier,
    killRule,
    why: reasons.join(" · ") || "not about this desk",
  };
}

/** Same story from two outlets → one row (the earlier-published one). */
export function dedupe(items: Tagged[]): Tagged[] {
  const seen = new Map<string, Tagged>();
  for (const it of items) {
    const key = it.title.toLowerCase().replace(/[^a-z0-9 ]/g, "").split(" ").filter((w) => w.length > 3).slice(0, 8).join(" ");
    const prev = seen.get(key);
    if (!prev || (it.published && prev.published && it.published < prev.published)) seen.set(key, it);
  }
  return [...seen.values()];
}

/** Tier first, then newest. A sort, not a score. */
export function orderItems(items: Tagged[]): Tagged[] {
  return [...items].sort((a, b) => (a.tier !== b.tier ? a.tier - b.tier : (b.published ?? "").localeCompare(a.published ?? "")));
}
