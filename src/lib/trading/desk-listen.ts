import { masterSeat, type MasterInput } from "@/lib/smc/master-seat";
import { RULES_HASH } from "@/lib/desk/rules-hash";
import { RR_DISPLAY_MAX } from "@/lib/smc/exec-context";
import { primaryTarget } from "./card-plan";
import { htfBiasOf, wireMtf, type SmtRead } from "@/lib/smc/mtf-context";
import { bandFromQ } from "@/lib/smc/discipline";

const WIRE_BANDS = ["A+", "A", "A-", "B+", "B", "C"] as const;
/** Lower of bandFromQ(q) and pathBand; pathBand "skip" -> "C". Unknown pathBand -> bandFromQ(q). */
export function wireBand(q: number | null | undefined, pathBand: string | null | undefined): string | null {
  const qb = bandFromQ(q);
  if (pathBand === "skip") return "C";
  const pi = WIRE_BANDS.indexOf(pathBand as (typeof WIRE_BANDS)[number]);
  if (qb == null || pi < 0) return qb;
  return WIRE_BANDS[Math.max(pi, WIRE_BANDS.indexOf(qb as (typeof WIRE_BANDS)[number]))];
}
/**
 * The live scanner, floor, and brain, without the account.
 * The full handoff stays behind CRON_SECRET. This card does not.
 */
import { mtfArrays, WIRE_ARRAYS_CAP, type ArrayRow } from "@/lib/smc/mtf-arrays";
import type { DeskPayload } from "./build-desk";
import { evaluateOptionsDesk } from "./options-desk";
import { isJudasWindow } from "./sessions";
import type { GrokReport } from "@/lib/desk/grok-report";

export interface DeskListenCard {
  ok: true;
  at: string;
  clock: {
    et: string;
    killzone: string;
    judas: "full" | "off";
    sessionOpen: boolean;
  };
  quotes: {
    left: { symbol: string; price: number; lagSec: number };
    right: { symbol: string; price: number; lagSec: number };
  };
  scanner: {
    symbol: string;
    side: string;
    band: string | null;
    q: number;
    actionable: boolean;
    strategy: string | null;
    entry: number | null;
    /** Live Robinhood ask for this side, when the session returned one. */
    ask: number | null;
  }[];
  floor: {
    id: string | null;
    verdict: string;
    band: string | null;
    blocks: string[];
    ticket: { underlier: string; side: string; dte: number; contracts: number; debit: number; pricedFrom: "live_chain" | "model" } | null;
  };
  brain: {
    thesis: string;
    symbol: string | null;
    side: string | null;
    word: string | null;
    missing: string | null;
  };
  /** ATM call and put asks, the same numbers the floor and the desk are showing. */
  optionMarks: { underlier: string; side: string; strike: number; ask: number; bid: number | null; ageSec: number }[];
  said: { who: string; line: string }[];
  report: GrokReport | null;
  /**
   * The one packet the strategy, brain, tape, chart, floor, and Grok share.
   * Each seat reads this. None of them keeps a private copy of the trade.
   */
  wire: DeskWire;
}

export interface DeskWire {
  /** sha256 (16 hex) of the shared rules this card was graded on — the watcher fails closed on mismatch. */
  rulesHash?: string;
  /** PD arrays on 1m–4h for both books, live first, capped (mtf-arrays.ts). */
  arrays?: (Omit<ArrayRow, "createdT"> & { symbol: string })[];
  /** The shock's lean, or null. Never a block. headlineTone is always "unknown". */
  shock?: {
    /** True only inside the live shock window (tail reads are false). */
    active: boolean;
    dir: "up" | "down";
    kind: "delivery" | "manipulation" | "pending";
    bias: "bull" | "bear" | "neutral";
    confidence: number;
    smt: "both" | "single";
    headline?: string;
    headlineTone: "unknown";
    line: string;
  } | null;
  tape: {
    feed: string;
    fresh: boolean;
    left: { symbol: string; price: number; source: string; lagSec: number };
    right: { symbol: string; price: number; source: string; lagSec: number };
  };
  mtf?: ReturnType<typeof wireMtf> | null;
  htf?: ReturnType<typeof htfBiasOf>;
  smt?: { lead: SmtRead | null; all: SmtRead[] } | null;
  strategy: {
    symbol: string;
    side: string;
    name: string;
    band: string | null;
    q: number;
    actionable: boolean;
    entry: number | null;
    stop: string | null;
    draw: string | null;
    entryResting: boolean;
    /** Fix 20: 0..1, null without 5m tape. */
    displacementStrength: number | null;
    /** Judas 09:30–09:45 ET — a WARNING flag only, never a block. */
    judas: boolean;
    /** The scanner said skip (exported as C). */
    scannerSkip: boolean;
    ltfKilled: boolean;
    /** Loss-pattern guards (shared rules loss.*): size multiplier (1h+4h both oppose → loss.htf.sizeMult), sweep flag, and the guard reads. */
    sizeMult: number;
    sweep: boolean | null;
    loss: Record<string, unknown> | null;
    /** Per-rule guard outcomes: live = acted; shadow = would have acted (no effect). */
    guards: { live: { rule: string; did: string }[]; shadow: { rule: string; would: string }[] } | null;
    regime: string | null;
    /** Fix 39: trend / reversal / range — the regime the card was graded in. */
    regimeLabel: string | null;
    /** Fixes 32/35/37/38: setup tags that fit the regime and moved the grade. */
    setups: string[];
    /** Fix 37: 5m legs in the side's direction since the last opposite break. */
    legs: number | null;
    /** Fix 36: add-on at the second LTF gap after a reversal confirms. */
    addOn: { tf: string; entry: number; zone: { top: number; bottom: number } } | null;
    /** Fixes 1–4, 6, 9–15, 21, 22 (day-context.ts); macroRisk = DXY/10y read (market/macro.ts), null when no source answers. */
    context: Record<string, unknown> | null;
    /** Fix 16–18. */
    exitPlan: { trailRule: string; trailPx: number | null; timeStopBars: number; timeStopTf: string; killExit: boolean; killWhy: string | null } | null;
    /** Which plan target `target` is (T1 unless T1 < 1R and T2 clears it). */
    targetWhich: "t1" | "t2" | null;
    /** R:R to `target`. */
    rr: number | null;
    /** Uncapped R:R; `rr` is capped at 6 for display (Keaton 2026-10-13). */
    rrRaw: number | null;
    /** true when the R:R was above 6 or the stop was widened to ≥ 0.5×ATR15. */
    rrFlag: boolean;
    rr1: number | null;
    rr2: number | null;
    /** uncapped R:R (rr1/rr2 are capped at RR_DISPLAY_MAX; rrFlag set when either was above it) */
    rr1Raw: number | null;
    rr2Raw: number | null;
    t2: number | null;
    /** The plan's stop as a number (the text stays on `stop`). Null without a plan. */
    stopPx: number | null;
    /** R7 chop on this book (15m overlap / range). */
    chop: boolean;
    qRaw: number | null;
    bias1h: string | null;
    bias4h: string | null;
    /** The scanner's own label, kept for audit; `band` is the q-derived one. */
    pathBand: string | null;
    /** A displacement leg (body ≥1×ATR, or left an FVG) is behind the setup. */
    displacement: boolean;
    /** T1 as a futures price. Null when no plan was priced (never invented). */
    target: number | null;
    /** ATR(14) of the setup's (15m) series. */
    atr: number | null;
  } | null;
  brain: {
    word: string | null;
    book?: { symbol: string; side: string | null } | null;
    thesis: string;
    missing: string | null;
    htfReleased: boolean;
  };
  chart: { symbol: string; levels: { name: string; price: number; side: "above" | "below" | null }[] }[];
  /** Fix 7/8: ranked draws for the strategy's book. */
  draws?: import("@/lib/smc/exec-context").RankedDraw[];
  /** Fix 24. */
  master?: import("@/lib/smc/master-seat").MasterSeat;
  /** Fix 19 (filled by the card route from the journal; null = no data). */
  day?: { rToday: number | null; governor: "normal" | "A+ only"; closedToday: number; governorMode?: string };
  floor: {
    verdict: string;
    /** "watcher" = ARMED setup whose only hold is the live-chain price; the watcher prices it on RH. */
    handTo?: "watcher" | null;
    blocks: string[];
    ticket: {
      underlier: string;
      side: string;
      dte: number;
      contracts: number;
      debit: number;
      pricedFrom: "live_chain" | "model";
      stop: string | null;
      targets: string[];
      liveAsk: number | null;
      /** lateEntry.modelPricePending: the watcher must pass the late PnL check on the live quote. */
      latePnlPending?: boolean;
    } | null;
  };
  execution: {
    phase: "look" | "hand" | "report";
    to: "grok";
    account: "agentic-6158";
    broker: "robinhood";
  };
}

export function deskListenCard(desk: DeskPayload): DeskListenCard {
  const floor = evaluateOptionsDesk(desk);
  const armed = floor.best;
  const shown =
    armed ??
    floor.day.find((c) => c.verdict === "WATCH") ??
    floor.swing.find((c) => c.verdict === "WATCH") ??
    null;
  const book = desk.smcMaster.oneBook;
  const judas = isJudasWindow(desk.clock.etHour, desk.clock.etMinute);
  const verdict = shown?.verdict ?? "STAND";
  const handed = armed?.verdict === "ARMED" && Boolean(armed.ticket);
  // AUDIT F7: the card's strategy IS the brain's book when the brain has one
  // on the board, so scanner, brain and Floor describe the same trade.
  const bookCand = desk.smcMaster.oneBook?.side
    ? desk.scan.candidates.find((c) => c.symbol === desk.smcMaster.oneBook!.symbol && c.side === desk.smcMaster.oneBook!.side && !c.scannerSkip && !(c as { watchOnly?: boolean }).watchOnly)
    : undefined;
  // The brain's book leads only when it is not graded BELOW the best card
  // (live 10:13 ET: brain on MNQ short C while ES short B+ was actionable).
  const rankOf = (b: string | undefined) => { const i = ["A+", "A", "A-", "B+", "B", "C"].indexOf(String(b)); return i < 0 ? 9 : i; };
  // Keaton 2026-10-13: only full-plan cards are cards; watch rows never lead.
  const isWatch = (c: unknown) => Boolean((c as { watchOnly?: boolean }).watchOnly);
  const best = desk.scan.candidates.find((c) => !isWatch(c)) ?? null;
  const top = bookCand && (!best || rankOf(bookCand.pathBand) <= rankOf(best.pathBand)) ? bookCand : (best ?? bookCand ?? null);
  const htfReleased = desk.scan.candidates.some((c) => c.htfDisrespected === true);
  const tapeFresh = desk.quotes.left.lagSec < 30 && desk.quotes.right.lagSec < 30;
  const phase = handed ? "hand" : "look";
  const sb = desk.shock?.active || desk.shock?.tail ? desk.shock.bias : null;
  const arrRows = [
    ...mtfArrays(desk.left.symbol, desk.mtf?.left.minute, desk.left.bars).map((r) => ({ ...r, symbol: desk.left.symbol })),
    ...mtfArrays(desk.right.symbol, desk.mtf?.right.minute, desk.right.bars).map((r) => ({ ...r, symbol: desk.right.symbol })),
  ];
  const arrays = [...arrRows]
    .sort((a, b) => Number(a.mitigated) - Number(b.mitigated) || b.createdT - a.createdT)
    .slice(0, WIRE_ARRAYS_CAP)
    .map(({ createdT: _t, ...r }) => r);
  const wire: DeskWire = {
    rulesHash: RULES_HASH,
    arrays,
    mtf: desk.mtfContext ? wireMtf(desk.mtfContext) : null,
    htf: top ? htfBiasOf(desk.mtfContext, top.symbol) : null,
    smt: desk.mtfContext ? { lead: desk.mtfContext.smtLead, all: desk.mtfContext.smt } : null,
    shock: sb
      ? {
          active: Boolean(desk.shock?.active),
          dir: sb.dir,
          kind: sb.kind,
          bias: sb.bias,
          confidence: sb.confidence,
          smt: sb.smt,
          ...(sb.headline ? { headline: sb.headline } : {}),
          headlineTone: sb.headlineTone,
          line: desk.shock.line,
        }
      : null,
    tape: {
      feed: desk.feed,
      fresh: tapeFresh,
      left: { symbol: desk.quotes.left.symbol, price: desk.quotes.left.price, source: desk.quotes.left.source, lagSec: desk.quotes.left.lagSec },
      right: { symbol: desk.quotes.right.symbol, price: desk.quotes.right.price, source: desk.quotes.right.source, lagSec: desk.quotes.right.lagSec },
    },
    strategy: top
      ? {
          symbol: top.symbol,
          side: top.side,
          name: top.completeStrategy || top.strategyPrimary || "model",
          // Band from q, never above the card's pathBand (live gate walk #2: a capped / skip card must not read higher).
          band: wireBand(top.confluence, top.pathBand ?? null),
          pathBand: top.pathBand ?? top.grade ?? null,
          q: top.confluence,
          actionable: top.actionable,
          entry: top.entryPx ?? top.plan?.entry ?? null,
          entryResting: top.entryResting === true,
          chop: top.chop === true,
          qRaw: top.qRaw ?? null,
          bias1h: htfBiasOf(desk.mtfContext, top.symbol)?.bias1h ?? null,
          bias4h: htfBiasOf(desk.mtfContext, top.symbol)?.bias4h ?? null,
          stop: top.invalidation || null,
          draw: top.draw?.name ?? null,
          displacement: Boolean(top.displacement?.bodyQualified || top.displacement?.qualifiedBy) || (top.dispStrength != null && top.dispStrength.bodyAtr >= 1 && top.dispStrength.leftFvg),
          displacementStrength: top.dispStrength?.score ?? null,
          judas,
          scannerSkip: top.scannerSkip === true,
          ltfKilled: top.ltfKilled === true,
          sizeMult: (top as { sizeMult?: number }).sizeMult ?? 1,
          sweep: ((top as { loss?: { htf?: { sweep?: boolean } } }).loss?.htf?.sweep) ?? null,
          loss: (top as { loss?: Record<string, unknown> }).loss ?? null,
          guards: (top as { guards?: { live: { rule: string; did: string }[]; shadow: { rule: string; would: string }[] } }).guards ?? null,
          regime: top.setupRegime ?? null,
          regimeLabel: (top as { regimeLabel?: string }).regimeLabel ?? null,
          setups: (top as { setups?: string[] }).setups ?? [],
          legs: (top as { legs?: number }).legs ?? null,
          addOn: (top as { addOn?: DeskWireAddOn }).addOn ?? null,
          context: (() => {
            const dc = (top as { dayCtx?: Record<string, unknown> }).dayCtx ?? null;
            if (!dc) return null;
            // ladder from the FINAL plan zone (plans can attach after the context pass)
            const z = (top.plan as { entryZone?: { top: number; bottom: number } } | null | undefined)?.entryZone;
            const ladder = z && z.top > z.bottom
              ? [{ px: top.side === "short" ? z.bottom : z.top, pct: 40 }, { px: +((z.top + z.bottom) / 2).toFixed(2), pct: 40 }, { px: top.side === "short" ? z.top : z.bottom, pct: 20 }]
              : dc.ladder ?? null;
            const { blocksAll: _b, ...rest } = dc as Record<string, unknown>;
            const mr = rest.macroRisk as { risk?: string | null } | null;
            return { ...rest, ladder, macroNote: mr?.risk != null ? "DXY: Yahoo DX-Y.NYB; 10y: Yahoo ^TNX (ZN=F fallback)." : "DXY/10y: no source answered — null, not synthesized." };
          })(),
          exitPlan: top.exitPlan ? { trailRule: top.exitPlan.trailRule, trailPx: top.exitPlan.trailPx, timeStopBars: top.exitPlan.timeStopBars, timeStopTf: top.exitPlan.timeStopTf, killExit: top.exitPlan.killExit, killWhy: top.exitPlan.killWhy } : null,
          target: primaryTarget(top.plan).price,
          targetWhich: primaryTarget(top.plan).which,
          rr: (() => { const v = primaryTarget(top.plan).rr; return v == null ? null : Math.min(v, RR_DISPLAY_MAX); })(),
          rrRaw: primaryTarget(top.plan).rr,
          rrFlag: [top.plan?.rr1, top.plan?.rr2, primaryTarget(top.plan).rr].some((v) => v != null && v > RR_DISPLAY_MAX) || Boolean((top as { rrCheck?: { flagged?: boolean; widened?: boolean } }).rrCheck?.flagged || (top as { rrCheck?: { widened?: boolean } }).rrCheck?.widened),
          rr1: top.plan?.rr1 == null ? null : Math.min(top.plan.rr1, RR_DISPLAY_MAX),
          rr2: top.plan?.rr2 == null ? null : Math.min(top.plan.rr2, RR_DISPLAY_MAX),
          rr1Raw: top.plan?.rr1 ?? null,
          rr2Raw: top.plan?.rr2 ?? null,
          t2: top.plan?.t2 ?? null,
          stopPx: top.plan?.stop ?? null,
          atr: top.plan?.atr ?? null,
        }
      : null,
    brain: {
      word: book?.word ?? null,
      book: book ? { symbol: book.symbol, side: book.side ?? null } : null,
      thesis:
        top && book && (top.symbol !== book.symbol || top.side !== book.side)
          ? top.symbol !== book.symbol
            ? `${book.word ?? "WAIT"} ${book.symbol} ${book.side ?? ""} is the brain's book · ${top.symbol} ${top.side} is not it`
            : `${book.word ?? "WAIT"} ${top.symbol} ${top.side} · same book · the other side is not this entry`
          : desk.smcMaster.thesis,
      missing:
        top && book && (top.symbol !== book.symbol || top.side !== book.side)
          ? top.symbol !== book.symbol ? `brain is on ${book.symbol}` : "same book — brain was on the other side"
          : book?.missing ?? null,
      htfReleased,
    },
    // Accuracy 3: the pool side is where the level sits against live price —
    // stops above price are BSL, below are SSL — whatever the source label said.
    chart: desk.levels.slice(0, 2).map((lvl) => {
      const px = lvl.symbol === desk.quotes.left.symbol ? desk.quotes.left.price : desk.quotes.right.price;
      return {
        symbol: lvl.symbol,
        levels: lvl.items.slice(0, 6).map((item) => ({ name: poolLabel(item.name, item.price, px), price: item.price, side: px == null ? null : item.price > px ? "above" : "below" })),
      };
    }),
    draws: top
      ? (desk.rankedDraws?.[top.symbol === desk.left.symbol ? "left" : "right"] ?? []).slice(0, 8).map((d) => {
          const px = top.symbol === desk.quotes.left.symbol ? desk.quotes.left.price : desk.quotes.right.price;
          return { ...d, name: poolLabel(d.name, d.price, px), side: px == null ? d.side : d.price > px ? "above" : "below" };
        })
      : [],
    floor: {
      verdict,
      handTo: shown?.handTo ?? null,
      blocks: (shown?.blocks ?? []).slice(0, 4),
      ticket: shown?.ticket
        ? {
            underlier: shown.ticket.underlier,
            side: shown.ticket.side,
            dte: shown.ticket.dteTarget,
            contracts: shown.ticket.contracts,
            debit: shown.ticket.estDebitTotal,
            pricedFrom: shown.ticket.pricedFrom,
            stop: shown.ticket.invalidation || null,
            targets: shown.ticket.targets.slice(0, 3),
            ...(shown.ticket.latePnlPending ? { latePnlPending: true } : {}),
            liveAsk: desk.optionMarks?.find((m) => m.underlier === shown.ticket!.underlier && m.side === shown.ticket!.side)?.ask ?? null,
          }
        : null,
    },
    execution: { phase, to: "grok", account: "agentic-6158", broker: "robinhood" },
  };
  wire.master = masterSeat(masterInputOf(wire, desk.mtfContext ?? null, "normal"));
  const said = [
    {
      who: "Vince",
      line: handed
        ? "Cleared. I hand this ticket to Grok. Grok hears this floor through the LedgerDesk connector and places it on Agentic."
        : shown?.blocks?.[0]
          ? `Not handed. ${shown.blocks[0]}`
          : `Nothing to hand Grok. The floor is ${verdict}.`,
    },
    {
      who: "Sterling",
      line: "Grok can hear what we say on the connector. We do not place it ourselves.",
    },
    {
      who: "Nova",
      line: book ? `${book.word}. ${book.missing}.` : "No book yet.",
    },
    {
      who: "Gemma",
      line: `Tape is ${desk.feed}, ${desk.quotes.left.symbol} ${desk.quotes.left.lagSec}s, ${desk.quotes.right.symbol} ${desk.quotes.right.lagSec}s. ${tapeFresh ? "Fresh enough to read." : "Stale. Do not arm on it."}`,
    },
  ];
  return {
    ok: true,
    at: desk.fetchedAt,
    clock: {
      et: desk.clock.nowEt,
      killzone: desk.clock.killzoneLabel,
      judas: judas ? "full" : "off",
      sessionOpen: desk.clock.inTradeWindow,
    },
    quotes: {
      left: { symbol: desk.quotes.left.symbol, price: desk.quotes.left.price, lagSec: desk.quotes.left.lagSec },
      right: { symbol: desk.quotes.right.symbol, price: desk.quotes.right.price, lagSec: desk.quotes.right.lagSec },
    },
    scanner: desk.scan.candidates.slice(0, 4).map((c) => {
      const underlier = c.symbol.includes("ES") ? "SPY" : "QQQ";
      const optSide = c.side === "short" ? "put" : "call";
      return {
        symbol: c.symbol,
        side: c.side,
        band: wireBand(c.confluence, c.pathBand ?? null),
        pathBand: c.pathBand ?? c.grade ?? null,
        q: c.confluence,
        actionable: c.actionable,
        strategy: c.completeStrategy || c.strategyPrimary || null,
        entry: c.entryPx ?? c.plan?.entry ?? null,
        /** "card" carries a complete plan; "watch" is a row without one (watchWhy says what is missing). */
        kind: (c as { watchOnly?: boolean }).watchOnly ? "watch" : "card",
        watchWhy: (c as { watchWhy?: string | null }).watchWhy ?? null,
        ask: desk.optionMarks?.find((m) => m.underlier === underlier && m.side === optSide)?.ask ?? null,
      };
    }),
    floor: {
      id: shown?.id ?? null,
      verdict,
      band: shown?.pathBand ?? null,
      blocks: (shown?.blocks ?? []).slice(0, 4),
      ticket: shown?.ticket
        ? {
            underlier: shown.ticket.underlier,
            side: shown.ticket.side,
            dte: shown.ticket.dteTarget,
            contracts: shown.ticket.contracts,
            debit: shown.ticket.estDebitTotal,
            pricedFrom: shown.ticket.pricedFrom,
          }
        : null,
    },
    brain: {
      thesis: desk.smcMaster.thesis,
      symbol: book?.symbol ?? null,
      side: book?.side ?? null,
      word: book?.word ?? null,
      missing: book?.missing ?? null,
    },
    optionMarks: (desk.optionMarks ?? []).map((m) => ({
      underlier: m.underlier,
      side: m.side,
      strike: m.strike,
      ask: m.ask,
      bid: m.bid,
      ageSec: Math.max(0, Math.round((Date.now() - m.asOfMs) / 1000)),
    })),
    said,
    report: null,
    wire,
  };
}


/** Accuracy 3: SSL/BSL and low/high tags follow the level's side of price. */
type DeskWireAddOn = { tf: string; entry: number; zone: { top: number; bottom: number } };

export function poolLabel(name: string, price: number, px: number | null | undefined): string {
  if (px == null || !Number.isFinite(px)) return name;
  const above = price > px;
  const pool = above ? "BSL" : "SSL";
  // A low-type level above price (or high-type below) is still that level, but
  // the resting liquidity sits on the other side: say so once, plainly — never
  // "PDL (external BSL)".
  const lowType = /\b(low|PDL|PWL|EQL)\b/i.test(name);
  const highType = /\b(high|PDH|PWH|EQH)\b/i.test(name);
  if ((above && lowType) || (!above && highType)) {
    const scope = /\bexternal\b/i.test(name) ? "external " : /\binternal\b/i.test(name) ? "internal " : "";
    const base = name.replace(/\s*\((?:external|internal)?\s*(?:SSL|BSL)\)/gi, "").replace(/\s*\((?:above|below) price[^)]*\)/gi, "").trim();
    return `${base} — ${above ? "above" : "below"} price (${scope}${pool})`;
  }
  return name.replace(/\b(SSL|BSL)\b/g, pool);
}

/** Fix 24: the Master seat reads the wire itself — the same fields every seat publishes. */
export function masterInputOf(
  wire: DeskWire,
  ctx: import("@/lib/smc/mtf-context").MtfContext | null,
  governor: "normal" | "A+ only",
): MasterInput {
  const s = wire.strategy;
  const align = s && ctx ? (ctx.books.find((b) => b.symbol === s.symbol)?.align[s.side as "long" | "short"]?.score ?? null) : null;
  return {
    card: s
      ? {
          symbol: s.symbol, side: s.side, band: s.band, q: s.q, actionable: s.actionable, entry: s.entry,
          entryResting: s.entryResting, stopPx: s.stopPx, target: s.target, rr: s.rr, chop: s.chop,
          bias1h: s.bias1h, bias4h: s.bias4h, dispScore: s.displacementStrength, ltfKilled: s.ltfKilled,
          reversal: s.regime === "reversal" ? "reversal setup (HTF released / LTF breaks)" : null,
        }
      : null,
    brainWord: wire.brain.word,
    brainBook: wire.brain.book ?? null,
    floorVerdict: wire.floor.verdict,
    align,
    smtLead: wire.smt?.lead ?? null,
    shockActive: wire.shock?.active === true,
    topDraw: wire.draws?.[0] ? { name: wire.draws[0].name, price: wire.draws[0].price } : null,
    governor,
  };
}
