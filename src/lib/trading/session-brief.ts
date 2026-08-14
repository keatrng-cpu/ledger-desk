/**
 * Session brief — bull path, bear path, and no-trade day detection.
 * Every liquidity / confluence line carries a price and an ET window.
 * Deterministic. No LLM.
 */

import type { DrawRead } from "./draw";
import { NEWS_CALENDAR, type NewsEvent, type NewsRead } from "./news";
import type { MarketNarrative } from "./market-narrative";
import type { ScanResult } from "./scanner";
import type { SessionClock } from "./sessions";
import { etWallParts } from "./sessions";
import type { Bias, HtfBiasRead, LiquidityPool } from "./structure";

export type DayVerdict = "trade" | "reduce" | "stand_down";
export type DayKind =
  | "trend_day"
  | "distribution"
  | "accumulation"
  | "consolidation"
  | "news_day"
  | "mixed_books"
  | "dead_chop";

export type PathStatus = "armed" | "wait" | "invalid";

export interface PricedLevel {
  name: string;
  price: number;
  window: string;
  scope: "internal" | "external" | "session";
  swept: boolean;
  side: "bsl" | "ssl";
}

export interface PathPlan {
  side: "long" | "short";
  status: PathStatus;
  lean: number;
  headline: string;
  trigger: PricedLevel | null;
  confirm: string[];
  entry: string;
  invalidation: string;
  targets: { name: string; price: number; window: string }[];
  timeWindow: string;
  why: string[];
}

export interface BookSlice {
  symbol: string;
  last: number;
  htf: Bias;
  session: Bias;
  sessionStrength: number;
  zone: string;
  dealing: { high: number; low: number; eq: number } | null;
  ssl: PricedLevel[];
  bsl: PricedLevel[];
  lastBos: { direction: Bias; level: number; at: string } | null;
}

export interface SessionBriefInput {
  clock: SessionClock;
  bias: { left: HtfBiasRead; right: HtfBiasRead };
  scan: ScanResult;
  news: NewsRead;
  draws: { left: DrawRead; right: DrawRead };
  feed: "databento" | "yahoo" | "synthetic" | "mixed";
  narrative: { left: MarketNarrative; right: MarketNarrative; summary: string };
}

export interface SessionBrief {
  verdict: DayVerdict;
  kind: DayKind;
  score: number;
  headline: string;
  clockLine: string;
  newsLine: string;
  todayNews: { name: string; timeEt: string; impact: "high" | "medium"; state: "past" | "now" | "next" }[];
  reasons: string[];
  standDownReasons: string[];
  books: { left: BookSlice; right: BookSlice };
  bull: PathPlan;
  bear: PathPlan;
  primaryPath: "bull" | "bear" | "none";
  gates: { id: string; label: string; ok: boolean; detail: string }[];
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function etDateKey(now: Date): string {
  const p = etWallParts(now.getTime());
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}`;
}

function etStamp(t: number): string {
  const p = etWallParts(t);
  return `${pad2(p.hour)}:${pad2(p.minute)} ET`;
}

export function newsOnDate(date: string, calendar: NewsEvent[] = NEWS_CALENDAR): NewsEvent[] {
  return calendar.filter((e) => e.date === date);
}

/** ET window the level was printed in — always labeled so the brief is actionable. */
export function windowForLabel(label: string): string {
  const u = label.toUpperCase();
  if (u.includes("ASIA")) return "18:00–02:00 ET";
  if (u.includes("LONDON")) return "02:00–08:00 ET";
  if (u.includes("NY AM") || u.includes("NYAM")) return "08:00–11:00 ET";
  if (u.includes("NY PM") || u.includes("NYPM")) return "13:30–16:00 ET";
  if (u.includes("NY") || u.includes("SESSION HIGH") || u.includes("SESSION LOW"))
    return "08:00–16:00 ET";
  if (u.includes("PDH") || u.includes("PDL") || u.includes("PRIOR DAY"))
    return "prior RTH 09:30–16:00 ET";
  if (u.includes("PWH") || u.includes("PWL") || u.includes("WEEK"))
    return "week Sun 18:00–Fri 17:00 ET";
  if (u.includes("MIDNIGHT") || u.includes("00:00")) return "00:00 ET midnight open";
  if (u.includes("830") || u.includes("8:30")) return "08:30 ET NY open";
  if (u.includes("930") || u.includes("9:30")) return "09:30 ET cash open";
  if (u.includes("EQH") || u.includes("EQL") || u.includes("RANGE") || u.includes("DR "))
    return "current dealing range";
  if (u.includes("SWING")) return "LTF confirmed swing";
  if (u.includes("OTE") || u.includes("CE")) return "array / OTE 62–79%";
  return "session · ET";
}

function toLevel(p: LiquidityPool): PricedLevel {
  return {
    name: p.label,
    price: p.price,
    window: windowForLabel(p.label),
    scope: p.scope,
    swept: p.swept,
    side: p.side === "buyside" ? "bsl" : "ssl",
  };
}

function uniqueLevels(list: PricedLevel[], last: number): PricedLevel[] {
  const seen = new Set<string>();
  return list
    .filter((l) => Number.isFinite(l.price))
    .sort((a, b) => {
      if (a.swept !== b.swept) return a.swept ? 1 : -1;
      return Math.abs(a.price - last) - Math.abs(b.price - last);
    })
    .filter((l) => {
      const k = `${l.side}:${l.price.toFixed(1)}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .slice(0, 6);
}

function bookSlice(read: HtfBiasRead): BookSlice {
  const pools = read.liquidity ?? [];
  const ssl = uniqueLevels(
    pools.filter((p) => p.side === "sellside").map(toLevel),
    read.last,
  );
  const bsl = uniqueLevels(
    pools.filter((p) => p.side === "buyside").map(toLevel),
    read.last,
  );
  return {
    symbol: read.symbol,
    last: read.last,
    htf: read.topDown,
    session: read.sessionStance ?? "neutral",
    sessionStrength: read.sessionStrength ?? 0,
    zone: read.dealing?.zone ?? "—",
    dealing: read.dealing
      ? { high: read.dealing.high, low: read.dealing.low, eq: read.dealing.eq }
      : null,
    ssl,
    bsl,
    lastBos: read.lastBOS
      ? {
          direction: read.lastBOS.direction,
          level: read.lastBOS.level,
          at: etStamp(read.lastBOS.t),
        }
      : null,
  };
}

function fmt(n: number): string {
  return n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function nearestUntapped(levels: PricedLevel[], last: number, wantBelow: boolean): PricedLevel | null {
  const pool = levels.filter((l) => !l.swept && (wantBelow ? l.price < last : l.price > last));
  if (!pool.length) {
    const any = levels.filter((l) => (wantBelow ? l.price <= last : l.price >= last));
    return any[0] ?? levels[0] ?? null;
  }
  return pool[0] ?? null;
}

function lastSwept(levels: PricedLevel[]): PricedLevel | null {
  return levels.find((l) => l.swept) ?? null;
}

function buildPath(
  side: "long" | "short",
  primary: BookSlice,
  other: BookSlice,
  narr: MarketNarrative,
  draw: DrawRead,
  clock: SessionClock,
): PathPlan {
  const isLong = side === "long";
  const raidPool = isLong ? primary.ssl : primary.bsl;
  const targetPool = isLong ? primary.bsl : primary.ssl;
  const swept = lastSwept(raidPool);
  const nextRaid = nearestUntapped(raidPool, primary.last, isLong);
  const trigger = swept ?? nextRaid;
  const sessionWith = primary.session === (isLong ? "bull" : "bear");
  const sessionAgainst = primary.session === (isLong ? "bear" : "bull");
  const htfWith = primary.htf === (isLong ? "bull" : "bear");
  const strong = primary.sessionStrength >= 0.28;

  let status: PathStatus = "wait";
  if (sessionAgainst && strong && !swept) status = "invalid";
  else if (sessionAgainst && strong && swept && !sessionWith) {
    // Raid already happened and delivery continues the other way — path is
    // the opposite side, not a fade of the impulse.
    status = "invalid";
  } else if (swept && (sessionWith || !strong) && (htfWith || sessionWith)) {
    status = narr.confirmation === "armed_entry" || narr.confirmation === "confirmed"
      ? "armed"
      : "wait";
  } else if (htfWith && !sessionAgainst) {
    status = "wait";
  }

  const timeWindow = clock.killzone === "ny_am"
    ? "NY AM 08:00–11:00 ET (best 09:30–11:00)"
    : clock.killzone === "ny_pm"
      ? "NY PM 13:30–16:00 ET"
      : clock.killzone === "london"
        ? "London 02:00–08:00 ET"
        : "Wait for NY AM 08:00–11:00 ET";

  const confirm = isLong
    ? [
        `SSL raid at a marked low (Asia/London/PDL/EQL) — sweep is setup, not entry`,
        `LTF displacement + MSS/CHoCH up after the raid`,
        `IFVG / bullish OB retest in discount (below EQ ${primary.dealing ? fmt(primary.dealing.eq) : "—"})`,
      ]
    : [
        `BSL raid at a marked high (Asia/London/PDH/EQH) — sweep is setup, not entry`,
        `LTF displacement + MSS/CHoCH down after the raid`,
        `IFVG / bearish OB retest in premium (above EQ ${primary.dealing ? fmt(primary.dealing.eq) : "—"})`,
      ];

  const invLevel = isLong
    ? swept ?? primary.ssl[0]
    : swept ?? primary.bsl[0];
  const invalidation = invLevel
    ? `Beyond ${invLevel.name} ${fmt(invLevel.price)} (${invLevel.window}) — structural invalidation`
    : isLong
      ? "Below protected session low / PDL"
      : "Above protected session high / PDH";

  const t1 = nearestUntapped(targetPool, primary.last, !isLong);
  const eq = primary.dealing
    ? {
        name: "EQ / IRL",
        price: primary.dealing.eq,
        window: "current dealing range 50%",
      }
    : null;
  const t2draw =
    draw.primary &&
    ((isLong && draw.primary.side === "above") ||
      (!isLong && draw.primary.side === "below"))
      ? {
          name: draw.primary.name,
          price: draw.primary.price,
          window: windowForLabel(draw.primary.name),
        }
      : null;
  const targets = [eq, t1 ? { name: t1.name, price: t1.price, window: t1.window } : null, t2draw]
    .filter((x): x is { name: string; price: number; window: string } => !!x)
    .filter((x, i, a) => a.findIndex((y) => Math.abs(y.price - x.price) < 0.5) === i)
    .slice(0, 3);

  const entry = primary.dealing
    ? isLong
      ? `Discount of range ${fmt(primary.dealing.low)}–${fmt(primary.dealing.eq)} · last ${fmt(primary.last)}`
      : `Premium of range ${fmt(primary.dealing.eq)}–${fmt(primary.dealing.high)} · last ${fmt(primary.last)}`
    : `Await array at last ${fmt(primary.last)}`;

  const why: string[] = [];
  if (trigger) {
    why.push(
      `${swept ? "Already raided" : "Next raid"} ${trigger.name} ${fmt(trigger.price)} · ${trigger.window}${
        trigger.swept ? " · swept" : " · untapped"
      }`,
    );
  }
  if (primary.lastBos) {
    why.push(
      `Last BOS ${primary.lastBos.direction} @ ${fmt(primary.lastBos.level)} · ${primary.lastBos.at}`,
    );
  }
  why.push(
    `${primary.symbol} HTF ${primary.htf} · session ${primary.session} ${Math.round(primary.sessionStrength * 100)}% · ${primary.zone}`,
  );
  if (other.htf !== primary.htf && other.htf !== "neutral") {
    why.push(
      `Books mixed: ${other.symbol} HTF ${other.htf} — one-book rule, do not pair both`,
    );
  }
  if (draw.primary) {
    why.push(
      `DOL ${draw.primary.name} ${fmt(draw.primary.price)} · ${windowForLabel(draw.primary.name)} · ${(draw.primary.reachProbability * 100).toFixed(0)}% reach`,
    );
  }

  const leanRaw =
    (htfWith ? 0.28 : 0) +
    (sessionWith ? 0.34 : sessionAgainst ? -0.28 : 0) +
    (swept ? 0.18 : 0) +
    (status === "armed" ? 0.16 : 0) +
    (status === "invalid" ? -0.4 : 0);
  const lean = Math.max(0, Math.min(1, +leanRaw.toFixed(2)));

  const headline =
    status === "invalid"
      ? `${primary.symbol} ${side} off — session delivering the other way`
      : status === "armed"
        ? `${primary.symbol} ${side} armed — raid + confirm, take the retest`
        : trigger
          ? `${primary.symbol} ${side} waits for ${swept ? "LTF MSS + array retest" : `raid of ${trigger.name} ${fmt(trigger.price)}`}`
          : `${primary.symbol} ${side} — mark levels, no trigger yet`;

  return {
    side,
    status,
    lean,
    headline,
    trigger,
    confirm,
    entry,
    invalidation,
    targets,
    timeWindow,
    why,
  };
}

function classifyDay(opts: {
  news: NewsRead;
  todayHigh: boolean;
  left: BookSlice;
  right: BookSlice;
  scan: ScanResult;
  clock: SessionClock;
  feed: SessionBriefInput["feed"];
}): { kind: DayKind; verdict: DayVerdict; score: number; reasons: string[]; stand: string[] } {
  const { news, todayHigh, left, right, scan, clock, feed } = opts;
  const reasons: string[] = [];
  const stand: string[] = [];
  let score = 72;

  const condL = scan.conditions.left;
  const condR = scan.conditions.right;
  const bothDead = condL.regime === "dead" && condR.regime === "dead";
  const bothRange = condL.regime === "ranging" && condR.regime === "ranging";
  const mixedHtf =
    left.htf !== "neutral" &&
    right.htf !== "neutral" &&
    left.htf !== right.htf;
  const sessionAgree =
    left.session !== "neutral" && left.session === right.session;
  const noSmt = scan.smt.edge === "none";

  let kind: DayKind = "trend_day";
  if (news.verdict !== "clear" || todayHigh) kind = "news_day";
  else if (bothDead) kind = "dead_chop";
  else if (bothRange) kind = "consolidation";
  else if (mixedHtf) kind = "mixed_books";
  else if (sessionAgree && left.session === "bear") kind = "distribution";
  else if (sessionAgree && left.session === "bull") kind = "accumulation";
  else if (condL.regime === "trending" || condR.regime === "trending") kind = "trend_day";
  else kind = "consolidation";

  if (!clock.isWeekday) {
    score -= 50;
    stand.push("Weekend — plan only, no session entries");
  }
  if (clock.killzone === "ny_lunch") {
    score -= 22;
    reasons.push("NY lunch 11:00–13:30 ET — typical consolidation, no new risk");
  }
  if (clock.killzone === "dead") {
    score -= 18;
    reasons.push(`Outside killzone (${clock.killzoneLabel}) — ${clock.nextWindow}`);
  }
  if (clock.weekday === 5 && clock.etHour >= 11) {
    score -= 16;
    reasons.push("Friday after 11:00 ET — liquidity thins, reduce or flatten");
  }
  if (news.verdict === "blackout") {
    score -= 45;
    stand.push(news.reason);
  } else if (news.verdict === "caution") {
    score -= 18;
    reasons.push(news.reason);
  } else if (todayHigh) {
    score -= 8;
    reasons.push("High-impact print already on today's calendar — treat as news day, expect Judas around the number");
    if (clock.etHour < 12) {
      score -= 8;
      reasons.push("Morning after a high-impact 08:30 ET print — first impulse is often the Judas; wait for the retest, do not chase");
    }
  }
  if (bothDead) {
    score -= 28;
    stand.push(
      `Both books dead/chop (ER ${condL.er.toFixed(2)} / ${condR.er.toFixed(2)}) — no delivery`,
    );
  } else if (bothRange) {
    score -= 14;
    reasons.push("Both books ranging — fade only A+ raids, skip continuation");
  }
  if (mixedHtf && noSmt) {
    score -= 16;
    reasons.push(
      `${left.symbol} HTF ${left.htf} vs ${right.symbol} HTF ${right.htf} and no SMT crack — mixed books, one contract only`,
    );
  }
  if (sessionAgree) {
    reasons.push(
      `Session delivery ${left.session} on both books (${Math.round(left.sessionStrength * 100)}% / ${Math.round(right.sessionStrength * 100)}%) — ride it, do not fade`,
    );
    if (kind === "distribution" || kind === "accumulation") score += 6;
  }
  if (feed === "synthetic") {
    score -= 40;
    stand.push("Synthetic feed — no live tape, stand down");
  }
  if (scan.blocked.some((b) => /lag|quote|execution/i.test(b))) {
    score -= 10;
    reasons.push("Execution feed stale — structure ok, do not click live");
  }

  score = Math.max(0, Math.min(100, score));
  let verdict: DayVerdict = "trade";
  if (stand.length || score < 32) verdict = "stand_down";
  else if (score < 58) verdict = "reduce";

  return { kind, verdict, score, reasons, stand };
}

export function buildSessionBrief(desk: SessionBriefInput, now = new Date()): SessionBrief {
  const { clock, bias, scan, news, draws, feed, narrative } = desk;
  const left = bookSlice(bias.left);
  const right = bookSlice(bias.right);
  const date = etDateKey(now);
  const today = newsOnDate(date);
  const todayHigh = today.some((e) => e.impact === "high");
  const todayNews = today.map((e) => {
    const mins =
      (e.timeEt.split(":").map(Number)[0]! * 60 +
        e.timeEt.split(":").map(Number)[1]!) -
      (clock.etHour * 60 + clock.etMinute);
    const state: "past" | "now" | "next" =
      Math.abs(mins) <= 15 ? "now" : mins < 0 ? "past" : "next";
    return { name: e.name, timeEt: e.timeEt, impact: e.impact, state };
  });

  const day = classifyDay({
    news,
    todayHigh,
    left,
    right,
    scan,
    clock,
    feed,
  });

  // Primary book = the one whose session agrees with itself; mixed HTF → session winner.
  const leftRide = left.sessionStrength + (left.htf === left.session ? 0.2 : 0);
  const rightRide = right.sessionStrength + (right.htf === right.session ? 0.2 : 0);
  const primaryBook = rightRide > leftRide ? right : left;
  const otherBook = primaryBook.symbol === left.symbol ? right : left;
  const primaryNarr =
    primaryBook.symbol === left.symbol ? narrative.left : narrative.right;
  const primaryDraw =
    primaryBook.symbol === left.symbol ? draws.left : draws.right;

  const bull = buildPath("long", primaryBook, otherBook, primaryNarr, primaryDraw, clock);
  const bear = buildPath("short", primaryBook, otherBook, primaryNarr, primaryDraw, clock);

  let primaryPath: SessionBrief["primaryPath"] = "none";
  if (day.verdict === "stand_down") primaryPath = "none";
  else if (bear.lean >= bull.lean + 0.08 && bear.status !== "invalid") primaryPath = "bear";
  else if (bull.lean >= bear.lean + 0.08 && bull.status !== "invalid") primaryPath = "bull";
  else if (bear.status === "armed") primaryPath = "bear";
  else if (bull.status === "armed") primaryPath = "bull";

  const kindLabel: Record<DayKind, string> = {
    trend_day: "Trend day",
    distribution: "Distribution day",
    accumulation: "Accumulation day",
    consolidation: "Consolidation / range",
    news_day: "News day",
    mixed_books: "Mixed books",
    dead_chop: "Dead / chop — no trade",
  };

  const verdictWord =
    day.verdict === "stand_down"
      ? "STAND DOWN"
      : day.verdict === "reduce"
        ? "REDUCE"
        : "TRADE";

  const headline = `${verdictWord} · ${kindLabel[day.kind]} · primary ${
    primaryPath === "none" ? "none" : primaryPath === "bear" ? "BEAR" : "BULL"
  }`;

  const newsLine =
    todayNews.length === 0
      ? news.nextEvent
        ? `Next: ${news.nextEvent.name} ${news.nextEvent.timeEt} ET`
        : "No high-impact on the calendar today"
      : todayNews
          .map(
            (e) =>
              `${e.name} ${e.timeEt} ET (${e.impact}${e.state === "past" ? " · printed" : e.state === "now" ? " · LIVE" : " · ahead"})`,
          )
          .join(" · ");

  const clockLine = `${clock.nowEt} · ${clock.killzoneLabel} · ${clock.sessionPhase}`;

  const gates = [
    {
      id: "day",
      label: "Day quality",
      ok: day.verdict !== "stand_down",
      detail: `${kindLabel[day.kind]} · ${day.score}/100`,
    },
    {
      id: "news",
      label: "News",
      ok: news.verdict === "clear",
      detail: news.reason,
    },
    {
      id: "session",
      label: "Killzone",
      ok: clock.inTradeWindow,
      detail: clock.killzoneLabel,
    },
    {
      id: "delivery",
      label: "Session delivery",
      ok: left.session === right.session && left.session !== "neutral",
      detail: `${left.symbol} ${left.session} ${Math.round(left.sessionStrength * 100)}% · ${right.symbol} ${right.session} ${Math.round(right.sessionStrength * 100)}%`,
    },
    {
      id: "smt",
      label: "SMT",
      ok: scan.smt.edge !== "none",
      detail: scan.smt.note,
    },
    {
      id: "path",
      label: "Path",
      ok: primaryPath !== "none",
      detail:
        primaryPath === "none"
          ? "No path armed — wait"
          : primaryPath === "bear"
            ? bear.headline
            : bull.headline,
    },
  ];

  return {
    verdict: day.verdict,
    kind: day.kind,
    score: day.score,
    headline,
    clockLine,
    newsLine,
    todayNews,
    reasons: day.reasons,
    standDownReasons: day.stand,
    books: { left, right },
    bull,
    bear,
    primaryPath,
    gates,
  };
}
