/**
 * smcUnity — SMC / desk-unity shadow reads (audit 2026-10-14,
 * audits/smc-unity-audit-2026-10-14.md). Pure: inputs in, one wire object out.
 *
 * EVERY item is shadow unless its smcUnity.<item>.mode is "live" in
 * shared/desk-rules.json: in shadow it is published on wire.smcUnity and the
 * watcher logs it as shadow:smc:* rows — q, band, actionable, the brain word,
 * the Floor verdict and the fire do not move. Band edges are not touched.
 *
 * Every timeframe 1m–4h is read together: structure, arrays and dealing ranges
 * are taken per rung on CLOSED bars (closed by FEED time, not the server
 * clock), and a read only counts when a quorum of rungs agree.
 *
 * Builds on, does not duplicate: fix/stale-veto-q-timing (kill.clear,
 * timing.entryState) and feat/ltf-arm (1m–5m closed-bar arming).
 */
import RULES from "../../../shared/desk-rules.json";
import type { OhlcBar } from "@/lib/market/types";
import { fractalSwings } from "@/lib/trading/detectors";
import { HTF_RUNGS, LTF_RUNGS, rung, type ArrayRow, type ArrayTf } from "./mtf-arrays";
import type { BookMtf, MtfContext } from "./mtf-context";

type Side = "long" | "short";
type Mode = "live" | "shadow";
type Item = { mode?: string; [k: string]: unknown };
const SU = (((RULES as unknown) as { smcUnity?: Record<string, Item> }).smcUnity ?? {}) as Record<string, Item>;
export const smcMode = (k: string): Mode => (SU[k]?.mode === "live" ? "live" : "shadow");
const num = (k: string, f: string, d: number): number => {
  const v = SU[k]?.[f];
  return typeof v === "number" && Number.isFinite(v) ? v : d;
};

export const TF_MIN: Record<ArrayTf, number> = { "1m": 1, "2m": 2, "3m": 3, "4m": 4, "5m": 5, "15m": 15, "30m": 30, "1h": 60, "4h": 240 } as Record<ArrayTf, number>;
const ALL: ArrayTf[] = [...(LTF_RUNGS as readonly ArrayTf[]), ...(HTF_RUNGS as readonly ArrayTf[])];
const r2 = (n: number) => Math.round(n * 100) / 100;

/* ------------------------------------------------------------------ */
/* F9 — closes judged by FEED time                                      */
/* ------------------------------------------------------------------ */

export interface FeedClockRead {
  /** The feed's own clock: the newest quote / bar time we have (ms). */
  feedNowMs: number | null;
  /** Age of the newest 1m bar against the feed clock (s). */
  minuteAgeS: number | null;
  /** The 1m series is older than smcUnity.feedClock.minuteMaxStaleS — it must not feed kills / re-arms / LTF structure. */
  staleForKills: boolean;
  /** The server clock calls the last 1m bar closed while the feed clock says it is still forming (or vice versa). */
  closeDisagrees: boolean;
  mode: Mode;
}

export function feedClockRead(minute: OhlcBar[] | null | undefined, quoteMarketMs: number | null | undefined, serverNowMs = Date.now()): FeedClockRead {
  const m = minute ?? [];
  const last = m.length ? m[m.length - 1]! : null;
  const feedNowMs = Math.max(quoteMarketMs ?? 0, last ? last.t : 0) || null;
  const maxS = num("feedClock", "minuteMaxStaleS", 120);
  const minuteAgeS = last && feedNowMs != null ? Math.round((serverNowMs - last.t) / 1000) : null;
  const closedByServer = last ? last.t + 60_000 <= serverNowMs : false;
  const closedByFeed = last && feedNowMs != null ? last.t + 60_000 <= feedNowMs : false;
  return {
    feedNowMs,
    minuteAgeS,
    staleForKills: minuteAgeS == null || minuteAgeS > maxS,
    closeDisagrees: Boolean(last) && closedByServer !== closedByFeed,
    mode: smcMode("feedClock"),
  };
}

/** Closed-bar prefix by the feed clock (the last bar is dropped unless the feed has moved past its close). */
export function closedByFeed(bars: OhlcBar[], spanMs: number, feedNowMs: number | null): OhlcBar[] {
  if (!bars.length) return bars;
  // Accuracy (smc-unity review #5): no feed time → the last bar may be forming; drop it (never hand back unfiltered bars).
  if (feedNowMs == null) return bars.slice(0, -1);
  const last = bars[bars.length - 1]!;
  return last.t + spanMs <= feedNowMs ? bars : bars.slice(0, -1);
}

/* ------------------------------------------------------------------ */
/* F11 / ranges — premium/discount per rung on that rung's own range     */
/* ------------------------------------------------------------------ */

export type Zone = "premium" | "discount" | "equilibrium";
export interface RungRange { tf: ArrayTf; hi: number; lo: number; eq: number; zone: Zone | null; ratio: number | null }

/** The rung's dealing range = its last CONFIRMED swing high and swing low (closed bars). */
export function rungRange(bars: OhlcBar[], at: number | null, k = 2): Omit<RungRange, "tf"> | null {
  if (bars.length < 2 * k + 3) return null;
  const sw = fractalSwings(bars, k).filter((s) => s.index + k < bars.length);
  const hi = [...sw].reverse().find((s) => s.kind === "high");
  const lo = [...sw].reverse().find((s) => s.kind === "low");
  if (!hi || !lo || !(hi.price > lo.price)) return null;
  // price that broke out of the swing range extends it (the leg is still running)
  const after = bars.slice(Math.min(hi.index, lo.index));
  const H = Math.max(hi.price, ...after.map((b) => b.h));
  const L = Math.min(lo.price, ...after.map((b) => b.l));
  const eq = (H + L) / 2;
  if (at == null || !Number.isFinite(at)) return { hi: H, lo: L, eq: r2(eq), zone: null, ratio: null };
  const ratio = (at - L) / (H - L);
  const split = num("continuation", "eqSplit", 0.5);
  const band = 0.02;
  const zone: Zone = ratio > split + band ? "premium" : ratio < split - band ? "discount" : "equilibrium";
  return { hi: H, lo: L, eq: r2(eq), zone, ratio: +ratio.toFixed(3) };
}

export function rungRanges(symbol: string, minute: OhlcBar[] | null | undefined, bars15: OhlcBar[] | null | undefined, at: number | null, feedNowMs: number | null): RungRange[] {
  const out: RungRange[] = [];
  for (const tf of ALL) {
    const ltf = (LTF_RUNGS as readonly string[]).includes(tf);
    const src = ltf ? minute : bars15;
    if (!src?.length) continue;
    const { bars } = rung(symbol, src, tf, feedNowMs ?? undefined);
    const r = rungRange(bars, at);
    if (r) out.push({ tf, ...r });
  }
  return out;
}

/** Side agrees with the zone of its POI on a majority of rungs (1m–4h together). */
export function pdVote(ranges: RungRange[], side: Side): { agree: number; of: number; pass: boolean; byTf: Record<string, Zone | null> } {
  const want: Zone = side === "short" ? "premium" : "discount";
  const rated = ranges.filter((r) => r.zone && r.zone !== "equilibrium");
  const agree = rated.filter((r) => r.zone === want).length;
  const byTf: Record<string, Zone | null> = {};
  for (const r of ranges) byTf[r.tf] = r.zone;
  return { agree, of: rated.length, pass: rated.length > 0 && agree / rated.length >= 0.5, byTf };
}

/* ------------------------------------------------------------------ */
/* Session ranges (Asia / London / NY open range) from closed 1m          */
/* ------------------------------------------------------------------ */

const ET_OFFSET_CACHE = new Map<number, number>();
function etParts(t: number): { day: string; hm: number } {
  const d = new Date(t);
  const key = Math.floor(t / 3_600_000);
  let off = ET_OFFSET_CACHE.get(key);
  if (off == null) {
    // hourCycle h23: hour12:false prints "24:xx" at midnight in some ICU builds → Invalid Date.
    const s = d.toLocaleString("en-US", { timeZone: "America/New_York", hourCycle: "h23" });
    const et = new Date(s + " UTC").getTime();
    off = Math.round((et - Math.floor(t / 1000) * 1000) / 60_000);
    ET_OFFSET_CACHE.set(key, off);
  }
  const e = new Date(t + off * 60_000);
  return { day: e.toISOString().slice(0, 10), hm: e.getUTCHours() * 60 + e.getUTCMinutes() };
}

export interface SessionRange { name: string; hi: number; lo: number }
/** Trading-session key: the ET date the session ENDS on (18:00 ET roll — a bar at/after 18:00 belongs to the next day's session). */
export function sessionKeyOf(t: number): string {
  const p = etParts(t);
  if (p.hm < 18 * 60) return p.day;
  const d = new Date(p.day + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
/**
 * Asia 20:00–00:00, London 02:00–05:00, NY OR 09:30–10:00, Overnight 18:00–09:30 ET — all bounded to the ONE
 * current trading session (18:00 ET roll) of the latest closed bar; prior days are never pooled (Accuracy #1).
 * At 19:30 ET the session is the one that opened at 18:00: Overnight = bars since 18:00, the rest not printed yet.
 */
export function sessionRanges(minute: OhlcBar[] | null | undefined, feedNowMs: number | null): SessionRange[] {
  const m = closedByFeed(minute ?? [], 60_000, feedNowMs);
  if (!m.length) return [];
  const cur = sessionKeyOf(m[m.length - 1]!.t);
  const win: [string, number, number][] = [["Asia", 20 * 60, 24 * 60], ["London", 120, 300], ["NY OR", 570, 600], ["Overnight", -1, -1]];
  const out: SessionRange[] = [];
  for (const [name, a, b] of win) {
    const xs = m.filter((x) => {
      if (sessionKeyOf(x.t) !== cur) return false;
      const hm = etParts(x.t).hm;
      if (name === "Overnight") return hm >= 18 * 60 || hm < 570;
      return hm >= a && hm < b;
    });
    if (xs.length) out.push({ name, hi: Math.max(...xs.map((x) => x.h)), lo: Math.min(...xs.map((x) => x.l)) });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* F2 — continuation: structure holds → roll target, re-anchor POI       */
/* ------------------------------------------------------------------ */

export interface StructureHold { rungs: string[]; count: number; holds: boolean; why: string[] }

/** Per rung: same-dir structure, or a live same-dir array with no live opposite iFVG, or opposite iFVGs that failed. */
export function structureHolds(book: BookMtf | null | undefined, rows: ArrayRow[], side: Side): StructureHold {
  const want = side === "short" ? "bear" : "bull";
  const opp = want === "bear" ? "bull" : "bear";
  const minRungs = num("continuation", "minRungs", 3);
  const hit: string[] = [];
  const why: string[] = [];
  for (const tf of ALL) {
    const rr = rows.filter((r) => r.tf === tf);
    const st = book?.rungs.find((r) => r.tf === tf);
    const structOk = st?.structure?.dir === want;
    const sameLive = rr.some((r) => r.dir === want && !r.mitigated && !(r.kind === "ifvg" && r.failed));
    const oppIfvgLive = rr.some((r) => r.kind === "ifvg" && r.dir === opp && !r.mitigated && !r.failed && r.ageBars <= 6);
    const oppFailed = rr.some((r) => r.kind === "ifvg" && r.dir === opp && r.failed);
    if ((structOk || sameLive || oppFailed) && !oppIfvgLive) {
      hit.push(tf);
      why.push(`${tf}: ${[structOk && `${st!.structure!.kind} ${want}`, sameLive && `${want} array holding`, oppFailed && `${opp} iFVG failed`].filter(Boolean).join(", ")}`);
    }
  }
  return { rungs: hit, count: hit.length, holds: hit.length >= minRungs, why: why.slice(0, 6) };
}

export interface ContinuationPoi { tf: string; kind: string; lo: number; hi: number; ce: number; ageMin: number }

/** Newest unmitigated same-direction array on ANY rung on the pullback side of price (above for a short). */
export function continuationPoi(rows: ArrayRow[], side: Side, price: number): ContinuationPoi | null {
  return continuationPois(rows, side, price)[0] ?? null;
}

/** All pullback POIs, newest first (ties → nearest). The read picks the first one sitting in the right half. */
export function continuationPois(rows: ArrayRow[], side: Side, price: number): ContinuationPoi[] {
  const want = side === "short" ? "bear" : "bull";
  const cands = rows
    .filter((r) => r.dir === want && !r.mitigated && !(r.kind === "ifvg" && r.failed))
    .filter((r) => (side === "short" ? r.lo > price : r.hi < price))
    .map((r) => ({ tf: r.tf, kind: r.kind, lo: r.lo, hi: r.hi, ce: r.ce, ageMin: r.ageBars * (TF_MIN[r.tf] ?? 1) }))
    .filter((r) => r.ageMin <= 240);
  // newest first; tie → nearest to price (the first pullback stop)
  cands.sort((a, b) => a.ageMin - b.ageMin || Math.abs(a.ce - price) - Math.abs(b.ce - price));
  return cands;
}

export interface Level { name: string; price: number }

/** Next real liquidity beyond price that pays ≥ minR from the POI with the given stop. */
export function nextTarget(levels: Level[], side: Side, price: number, entry: number, stop: number, minR: number): (Level & { r: number }) | null {
  const risk = Math.abs(stop - entry);
  if (!(risk > 0)) return null;
  const beyond = levels
    .filter((l) => Number.isFinite(l.price) && (side === "short" ? l.price < price : l.price > price))
    .map((l) => ({ ...l, r: +((side === "short" ? entry - l.price : l.price - entry) / risk).toFixed(2) }))
    .filter((l) => l.r >= minR)
    .sort((a, b) => Math.abs(a.price - price) - Math.abs(b.price - price));
  return beyond[0] ?? null;
}

export interface ContinuationRead {
  mode: Mode;
  side: Side;
  /** T1 is spent (touched) or within t1NearAtr — the plan needs the next draw. */
  t1Spent: boolean;
  structure: StructureHold;
  poi: ContinuationPoi | null;
  stop: number | null;
  t1: (Level & { r: number }) | null;
  /** pd_half judged at the POI on each rung's own range, voted 1m–4h. */
  pdAtPoi: ReturnType<typeof pdVote> | null;
  /** The late guard measured from the new POI (×ATR15). */
  lateFromPoiAtr: number | null;
  /** What the live card penalised that this read would not. */
  penalties: string[];
  /** Shadow verdict: the card would roll forward and rest at the POI. */
  wouldRoll: boolean;
}

export function continuationRead(i: {
  side: Side;
  price: number | null;
  t1: number | null;
  atr15: number | null;
  /** today's/rolling lows-highs already reached since the fill (T1 touched?) */
  extremeSince: number | null;
  book: BookMtf | null | undefined;
  rows: ArrayRow[];
  levels: Level[];
  ranges: (at: number) => RungRange[];
  card: { late?: boolean; pdFail?: boolean; t1Null?: boolean; q?: number };
}): ContinuationRead | null {
  const { side, price, atr15 } = i;
  if (price == null || !Number.isFinite(price)) return null;
  const nearAtr = num("continuation", "t1NearAtr", 0.5);
  const minR = num("continuation", "minR", 1);
  const touched = i.t1 != null && i.extremeSince != null && (side === "short" ? i.extremeSince <= i.t1 : i.extremeSince >= i.t1);
  const near = i.t1 != null && atr15 != null && atr15 > 0 && Math.abs(price - i.t1) <= nearAtr * atr15;
  const t1Spent = i.t1 == null || touched || near;
  const structure = structureHolds(i.book, i.rows, side);
  // The POI must sit in the right half of the latest leg on the rungs (premium for a short):
  // newest array that passes the 1m–4h pd vote; else the newest one (reported as failing pd).
  const pois = continuationPois(i.rows, side, price);
  const graded = pois.slice(0, 12).map((p) => ({ p, pd: pdVote(i.ranges(p.ce), side) }));
  const pick = graded.find((g) => g.pd.pass) ?? graded[0] ?? null;
  const poi = pick?.p ?? null;
  const pad = atr15 != null && atr15 > 0 ? 0.1 * atr15 : 0;
  const stop = poi ? r2(side === "short" ? poi.hi + pad : poi.lo - pad) : null;
  const entry = poi?.ce ?? null;
  const t1 = entry != null && stop != null ? nextTarget(i.levels, side, price, entry, stop, minR) : null;
  const pdAtPoi = pick?.pd ?? null;
  const lateFromPoiAtr = entry != null && atr15 ? +(Math.max(0, side === "short" ? entry - price : price - entry) / atr15).toFixed(2) : null;
  const penalties: string[] = [];
  if (i.card.late) penalties.push("late guard measured from the stale entry / spent T1 (build-desk.ts lateGuard)");
  if (i.card.pdFail) penalties.push("pd_half graded at current price, not the POI (scanner.ts impulseZone / structure.ts dealingRange)");
  if (i.card.t1Null) penalties.push("T1 null — next real liquidity never searched (exec-context.ts sanePlan)");
  if (t1Spent) penalties.push("T1 spent/near — card did not roll to the next draw");
  const wouldRoll = structure.holds && t1Spent && poi != null && t1 != null && (pdAtPoi?.pass ?? false);
  return { mode: smcMode("continuation"), side, t1Spent, structure, poi, stop, t1, pdAtPoi, lateFromPoiAtr, penalties, wouldRoll };
}

/* ------------------------------------------------------------------ */
/* F4 — brain per book                                                   */
/* ------------------------------------------------------------------ */

export interface BrainBookRead {
  mode: Mode;
  ticketBook: string | null;
  ticketSide: Side | null;
  brainBook: string | null;
  brainSide: Side | null;
  brainWord: string | null;
  /** The brain's word is about another book/side — a caution, not a block. */
  otherBook: boolean;
  /** Level SMT points at the ticket's book (its book is the failing one). */
  smtForTicket: boolean;
  wouldUnblock: boolean;
}

export function brainBookRead(
  ticket: { symbol: string | null; side: Side | null },
  brain: { symbol?: string | null; side?: string | null; word?: string | null } | null | undefined,
  ctx: MtfContext | null | undefined,
): BrainBookRead {
  const bs = (brain?.side === "long" || brain?.side === "short" ? brain.side : null) as Side | null;
  // Accuracy #2: only a DIFFERENT symbol is the other book; the same symbol on the opposite side is the
  // opposite-brain refusal and is never weakened here.
  const otherBook = Boolean(brain?.symbol && ticket.symbol && brain.symbol !== ticket.symbol);
  const lead = ctx?.smtLead ?? null;
  const smtForTicket = Boolean(lead && ticket.symbol && lead.failing === ticket.symbol && ((lead.kind === "bearish" && ticket.side === "short") || (lead.kind === "bullish" && ticket.side === "long")));
  return {
    mode: smcMode("brainPerBook"),
    ticketBook: ticket.symbol,
    ticketSide: ticket.side,
    brainBook: brain?.symbol ?? null,
    brainSide: bs,
    brainWord: brain?.word ?? null,
    otherBook,
    smtForTicket,
    wouldUnblock: otherBook && (brain?.word === "STAND" || smtForTicket),
  };
}

/* ------------------------------------------------------------------ */
/* F8 — extension guard with every rung's reversal evidence              */
/* ------------------------------------------------------------------ */

export function extensionMtfRead(book: BookMtf | null | undefined, side: Side, skippedByExtension: boolean): { mode: Mode; skipped: boolean; rungsWithReversal: string[]; wouldAllow: boolean; capBand: "A-" | null } {
  const want = side === "short" ? "bear" : "bull";
  const pool = side === "short" ? "buyside" : "sellside";
  const rungs = (book?.rungs ?? [])
    .filter((r) => ["1m", "2m", "3m", "4m", "5m", "15m", "30m"].includes(r.tf))
    .filter((r) => (r.structure && r.structure.dir === want && r.structure.ageBars <= 10) || (r.sweep && r.sweep.side === pool && r.sweep.ageBars <= 6))
    .map((r) => r.tf);
  const wouldAllow = skippedByExtension && rungs.length >= 2;
  return { mode: smcMode("extensionMtf"), skipped: skippedByExtension, rungsWithReversal: rungs, wouldAllow, capBand: wouldAllow ? "A-" : null };
}

/* ------------------------------------------------------------------ */
/* F10 — Floor DTE by time                                                */
/* ------------------------------------------------------------------ */

export function floorDteRead(etHour: number, etMinute: number, ticketDte: number | null): { mode: Mode; want: number; ticketDte: number | null; mismatch: boolean; lateBlocked: boolean } {
  const o = (RULES as { optExec?: { dteByTime?: { zeroDteUntilEt?: string; afterDte?: number } } }).optExec?.dteByTime ?? {};
  const [h, m] = String(o.zeroDteUntilEt ?? "14:30").split(":").map(Number);
  // Owner rule 2026-10-15: optExec.intradayTicket (live) pins intraday tickets at 0DTE ATM all session; 1DTE+ is
  // swing-only. From lateBlockEt the intraday ticket is BLOCKED (lateBlocked) — want stays 0, never rolled to 1.
  const it = (RULES as { optExec?: { intradayTicket?: { mode?: string; dte?: number; lateBlockEt?: string } } }).optExec?.intradayTicket;
  const live = it?.mode === "live";
  const [lh, lm] = String(it?.lateBlockEt ?? "15:25").split(":").map(Number);
  const nowMin = etHour * 60 + etMinute;
  const want = live ? (it!.dte ?? 0) : nowMin < (h! * 60 + m!) ? 0 : (o.afterDte ?? 1);
  const lateBlocked = live && want === 0 && nowMin >= lh! * 60 + lm!;
  return { mode: smcMode("floorDte"), want, ticketDte, mismatch: ticketDte != null && ticketDte !== want, lateBlocked };
}

/* ------------------------------------------------------------------ */
/* F1/F7/F12 — kill shadow                                                */
/* ------------------------------------------------------------------ */

export function killShadow(ctx: MtfContext | null | undefined): { mode: Mode; books: { symbol: string; against: string; failedOnly: boolean; killT: number; killTInv: number | null; live: boolean }[]; bothKilled: string[] } {
  const books: { symbol: string; against: string; failedOnly: boolean; killT: number; killTInv: number | null; live: boolean }[] = [];
  const bothKilled: string[] = [];
  for (const b of ctx?.books ?? []) {
    const live = (b.ltfReversals ?? []).filter((r) => !r.rearmed);
    if (live.length === 2) bothKilled.push(b.symbol);
    for (const r of b.ltfReversals ?? []) {
      books.push({ symbol: b.symbol, against: r.against, failedOnly: r.smc?.failedOnly === true, killT: r.killT, killTInv: r.smc?.killTInv ?? null, live: !r.rearmed });
    }
  }
  return { mode: smcMode("ifvgFail"), books, bothKilled };
}

/* ------------------------------------------------------------------ */
/* The wire object                                                        */
/* ------------------------------------------------------------------ */

export interface SmcUnityWire {
  v: 1;
  kill: ReturnType<typeof killShadow>;
  feed: { left: FeedClockRead; right: FeedClockRead };
  continuation: ContinuationRead | null;
  brainBook: BrainBookRead | null;
  extension: ReturnType<typeof extensionMtfRead> | null;
  floorDte: ReturnType<typeof floorDteRead> | null;
  ranges: { tf: string; zone: Zone | null; ratio: number | null; hi: number; lo: number }[];
  sessions: SessionRange[];
  /** Short, human rows for the watcher's shadow:smc:* log. */
  rows: { rule: string; would: string }[];
}

export function smcUnityRows(w: Omit<SmcUnityWire, "rows">): { rule: string; would: string }[] {
  const rows: { rule: string; would: string }[] = [];
  for (const k of w.kill.books) if (k.live && k.failedOnly) rows.push({ rule: "ifvgFail", would: `${k.symbol} kill against the ${k.against} rests only on failed iFVGs — would drop` });
  for (const s of w.kill.bothKilled) rows.push({ rule: "bothKills", would: `${s}: both sides killed — would report both, not null` });
  for (const [k, f] of Object.entries(w.feed)) if (f.staleForKills) rows.push({ rule: "feedClock", would: `${k} 1m series ${f.minuteAgeS}s old — would not feed kills/re-arms` });
  const c = w.continuation;
  if (c?.wouldRoll) rows.push({ rule: "continuation", would: `${c.side}: structure holds on ${c.structure.count} rungs (${c.structure.rungs.join(",")}) — roll T1 → ${c.t1!.name} ${c.t1!.price} (${c.t1!.r}R), rest at ${c.poi!.tf} ${c.poi!.kind} CE ${c.poi!.ce}, stop ${c.stop}` });
  else if (c && c.t1Spent && c.structure.holds) rows.push({ rule: "continuation", would: `${c.side}: T1 spent, structure holds on ${c.structure.count} rungs — ${c.poi ? (c.t1 ? "POI not in the right half yet" : "no next real liquidity ≥ minR") : "no pullback POI yet"}` });
  if (w.brainBook?.wouldUnblock) rows.push({ rule: "brainPerBook", would: `brain ${w.brainBook.brainWord} on ${w.brainBook.brainBook} ${w.brainBook.brainSide ?? ""} is another book than the ${w.brainBook.ticketBook} ${w.brainBook.ticketSide} ticket — caution, not block` });
  if (w.extension?.wouldAllow) rows.push({ rule: "extensionMtf", would: `extension skip overruled by reversal on ${w.extension.rungsWithReversal.join(",")} — cap A-` });
  if (w.floorDte?.mismatch) rows.push({ rule: "floorDte", would: `ticket ${w.floorDte.ticketDte} DTE → ${w.floorDte.want} DTE by time` });
  return rows;
}
