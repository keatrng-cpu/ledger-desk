/** Builds wire.smcUnity from the desk payload (shadow; see smc-unity.ts). */
import type { OhlcBar } from "@/lib/market/types";
import { rollingAtr } from "@/lib/trading/detectors";
import type { DeskPayload } from "@/lib/trading/build-desk";
import type { ArrayRow } from "./mtf-arrays";
import {
  brainBookRead, continuationRead, extensionMtfRead, feedClockRead, floorDteRead, killShadow,
  rungRanges, sessionRanges, smcUnityRows, closedByFeed, type Level, type SmcUnityWire,
} from "./smc-unity";

export type { SmcUnityWire } from "./smc-unity";

type Cand = DeskPayload["scan"]["candidates"][number];

function atrOf(bars: OhlcBar[]): number | null {
  if (bars.length < 16) return null;
  const a = rollingAtr(bars);
  const v = a[a.length - 1];
  return v != null && Number.isFinite(v) && v > 0 ? v : null;
}

export function buildSmcUnity(
  desk: DeskPayload,
  top: Cand | null,
  rows: (ArrayRow & { symbol: string })[],
  brain: { symbol: string; side: "long" | "short" | null; word: string } | null,
  ticketDte: number | null,
): SmcUnityWire {
  const qL = desk.quotes.left as { price: number | null; marketTimeMs?: number | null };
  const qR = desk.quotes.right as { price: number | null; marketTimeMs?: number | null };
  const mL = desk.mtf?.left.minute ?? [];
  const mR = desk.mtf?.right.minute ?? [];
  const feed = { left: feedClockRead(mL, qL.marketTimeMs ?? null), right: feedClockRead(mR, qR.marketTimeMs ?? null) };
  const kill = killShadow(desk.mtfContext ?? null);

  let continuation: SmcUnityWire["continuation"] = null;
  let extension: SmcUnityWire["extension"] = null;
  let brainBook: SmcUnityWire["brainBook"] = null;
  let ranges: SmcUnityWire["ranges"] = [];
  let sessions: SmcUnityWire["sessions"] = [];
  if (top) {
    const isL = top.symbol === desk.left.symbol;
    const side = top.side as "long" | "short";
    const price = (isL ? qL : qR).price;
    const minute = isL ? mL : mR;
    const fc = isL ? feed.left : feed.right;
    const bars15 = closedByFeed(isL ? desk.left.bars : desk.right.bars, 900_000, fc.feedNowMs);
    const atr15 = atrOf(bars15);
    const book = desk.mtfContext?.books.find((b) => b.symbol === top.symbol) ?? null;
    const myRows = rows.filter((r) => r.symbol === top.symbol);
    sessions = sessionRanges(minute, fc.feedNowMs);
    const lvl: Level[] = [
      ...(desk.levels.find((l) => l.symbol === top.symbol)?.items ?? []).map((x) => ({ name: x.name, price: x.price })),
      ...(desk.rankedDraws?.[isL ? "left" : "right"] ?? []).map((d) => ({ name: d.name, price: d.price })),
      ...sessions.flatMap((s) => [{ name: `${s.name} high`, price: s.hi }, { name: `${s.name} low`, price: s.lo }]),
    ];
    const dc = (top as { dayCtx?: { openingRange?: { sd?: Record<string, number> } | null } }).dayCtx;
    for (const [k, v] of Object.entries(dc?.openingRange?.sd ?? {})) if (Number.isFinite(v)) lvl.push({ name: `OR SD ${k}`, price: v });
    const closed1m = closedByFeed(minute, 60_000, fc.feedNowMs);
    const recent = closed1m.slice(-30);
    const extremeSince = recent.length ? (side === "short" ? Math.min(...recent.map((b) => b.l)) : Math.max(...recent.map((b) => b.h))) : null;
    const plan = top.plan as { t1?: number | null } | null | undefined;
    const loss = (top as { loss?: { late?: { block?: boolean } } }).loss;
    const rr = (top as { rrCheck?: { why?: string | null } }).rrCheck;
    const brainMissing = brain && brain.symbol === top.symbol ? desk.smcMaster.oneBook?.missing ?? null : null;
    const rangesAt = (at: number) => rungRanges(top.symbol, minute, bars15, at, fc.feedNowMs);
    continuation = continuationRead({
      side, price, t1: plan?.t1 ?? null, atr15, extremeSince, book, rows: myRows, levels: lvl, ranges: rangesAt,
      card: { late: loss?.late?.block === true, pdFail: brainMissing === "POI in correct half", t1Null: plan?.t1 == null || /not a real ranked level/.test(rr?.why ?? ""), q: top.confluence },
    });
    ranges = (price != null ? rangesAt(price) : []).map((r) => ({ tf: r.tf, zone: r.zone, ratio: r.ratio, hi: r.hi, lo: r.lo }));
    extension = extensionMtfRead(book, side, (top.missing ?? []).some((m) => /^extension/.test(m)));
    brainBook = brainBookRead({ symbol: top.symbol, side }, brain, desk.mtfContext ?? null);
  }
  const floorDte = floorDteRead(desk.clock.etHour, desk.clock.etMinute, ticketDte);
  const base = { v: 1 as const, kill, feed, continuation, brainBook, extension, floorDte, ranges, sessions };
  return { ...base, rows: smcUnityRows(base) };
}
