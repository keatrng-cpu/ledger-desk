import { stopText, ticketMatchesCard, dteFitsPlan, tapeStale } from "@/lib/smc/deep-audit";
import { floorDteRead } from "@/lib/smc/smc-unity";
import { masterSeat, type MasterInput } from "@/lib/smc/master-seat";
import { EVF, evCard, on as evOn } from "@/lib/desk/ev-fire";
import { RULES_HASH } from "@/lib/desk/rules-hash";
import { buildDeskSeq, type DeskSeqWire } from "@/lib/smc/seq/wire";
import { RR_DISPLAY_MAX } from "@/lib/smc/exec-context";
import { primaryTarget } from "./card-plan";
import { htfBiasOf, wireMtf, type SmtRead } from "@/lib/smc/mtf-context";
import { bandFromQ } from "@/lib/smc/discipline";
import { kzSeatNote } from "@/lib/desk/kz-disp";
import { LTF_ARM, capBandAt } from "@/lib/smc/ltf-arm";

const WIRE_BANDS = ["A+", "A", "A-", "B+", "B", "C"] as const;
/** Lower of bandFromQ(q) and pathBand; pathBand "skip" -> "C". Unknown pathBand -> bandFromQ(q). */
/** ltfArm: a card armed by LTF evidence never reads above ltfArm.capBand, whatever q says. */
/** 10/16 retest re-entry: one shadow line for the brain seat and the Floor (same text both places). */
function retestLine(top: unknown): string | null {
  const r = (top as { retestReentry?: import("@/lib/smc/retest-reentry").RetestRead | null } | null)?.retestReentry;
  return r && r.state !== "void" ? `${r.label} [shadow, no vote]` : null;
}

export function armedBand(c: { confluence: number; pathBand?: string | null; ltfArmed?: boolean }): string | null {
  const b = wireBand(c.confluence, c.pathBand ?? null);
  return c.ltfArmed ? capBandAt(b, LTF_ARM.capBand) : b;
}
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
import { buildSmcUnity, type SmcUnityWire } from "@/lib/smc/smc-unity-wire";
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
  /** ltfArm (shared rules): mode, cap, and the cards live mode would have shown that the board dropped. */
  ltfArm?: { mode: string; capBand: string; dropped: { symbol: string; side: string; why: string; wouldBand: string | null; arm: string; entry: number; stop: number; t1: number | null }[] };
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
  /** 1m series integrity (#19). gapped=true → LTF arrays/levels withheld; the watcher blocks. */
  feed: { gapped: boolean; gaps: { symbol: string; fromMs: number; toMs: number; fromIso: string; toIso: string; missing: number; trailing?: boolean; blocking: boolean; why: string }[] };
  tape: {
    feed: string;
    fresh: boolean;
    gapped: boolean;
    left: { symbol: string; price: number; source: string; lagSec: number };
    right: { symbol: string; price: number; source: string; lagSec: number };
  };
  mtf?: ReturnType<typeof wireMtf> | null;
  /** SMC/unity shadow reads (shared rules smcUnity.*; audit 2026-10-14). Shadow = changes nothing. */
  smcUnity?: SmcUnityWire | null;
  /** Keaton's trade sequence shadow reads (shared rules deskSeq.*; brief 2026-10-14). Shadow = changes nothing. */
  deskSeq?: DeskSeqWire | null;
  htf?: ReturnType<typeof htfBiasOf>;
  smt?: { lead: SmtRead | null; all: SmtRead[] } | null;
  /** Rule 1 SHADOW tickets (shared/rule1.json). The watcher logs would-fire only; never an order. */
  rule1: import("./rule1").Rule1Ticket[];
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
    /** qv2-1015 SHADOW score (shared/q-v2.json): never gates or fires. Carried only: the watcher and the brain/Floor seat
     *  receive it but do not log or display it yet. Its volPct and option inputs are null on the desk, so those terms are dead (0). */
    qV2: { q: number; band: string; deltas: { source: string; delta: number; note?: string }[]; vetoed: boolean } | null;
    /** evFire (shared rules evFire, OFF by default): calibrated P(T1), EV_R, size, would-fire; null when evFire.mode is off. */
    ev?: import("@/lib/desk/ev-fire").EvRead | null;
    /** evFire.qRawOnce: q before R3 chase and before any seal. */
    qRaw0?: number | null;
    /** Fix A: the side's kill evidence is invalidated on closed bars (kill.clear); the watcher ltf_kill reads it with kill.clear.mode. */
    ltfKillCleared: boolean;
    /** Fix B: timing (at/near/late/missed + ATR distance 1m–4h + real-POI re-entry), separate from q/band. */
    entryState: unknown;
    /** 10/16 retest re-entry SHADOW read (smc/retest-reentry.ts). Brain/Floor note it, the watcher shadow-logs it; never fires. */
    retestReentry?: import("@/lib/smc/retest-reentry").RetestRead | null;
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
    /** The plan's own T1 (10/15 13:02 CT T1-jump fix): the watcher reads this before `target`. */
    t1?: number | null;
    /** The plan's stop as a number (the text stays on `stop`). Null without a plan. */
    stopPx: number | null;
    /** deep-audit #4: structural anchor (raid/sweep price) — the journal's setup id. */
    anchor?: number | null;
    /** deep-audit #1/#13: price printed through the stop — the card is dead. */
    invalidated?: boolean;
    /** deep-audit #12: quote lag > 30 s — band C, not actionable. */
    staleTape?: boolean;
    playedOut?: boolean;
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
    /** kzDisp item 49: Kill Zone seat note in the brain context (shadow: a note, never a vote). */
    kzSeat?: string;
    /** 10/16 retest re-entry seat note (shadow: a note, never a vote). */
    retestSeat?: string | null;
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
    /** evFire shadow: the Floor's EV line (EV_R, p, cost_R, reason). Never a vote; the Floor's STAND still blocks live. */
    ev?: string | null;
    /** kzDisp item 49: Floor "Kill Zone" seat line (shadow note, never a vote). */
    kzSeat?: string;
    /** 10/16 retest re-entry Floor line (shadow: a note, never a vote; the watcher shadow-logs it only). */
    retest?: string | null;
    /** fireFix.gateHand: A+/A handed with brain/SMT/direction holds at a one-step smaller size. */
    sizeCut?: boolean;
    /** "watcher" = ARMED setup whose only hold is the live-chain price; the watcher prices it on RH. */
    handTo?: "watcher" | null;
    blocks: string[];
    /** deep-audit #5/#6: ticket vs card checks. */
    ticketCheck?: TicketFlags;
    /** deep-audit #5: Floor's SMT ticket when it is on the other book/side — shown separately, never handed. */
    otherBookTicket?: { underlier: string; side: string; dte: number; label: string } | null;
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
  // deep-audit #5/#6: a contradicting / wrong-DTE / unpriced ticket is never handed (checked once `top` is known).
  let handed = armed?.verdict === "ARMED" && Boolean(armed.ticket);
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
  const tapeFresh = !tapeStale([desk.quotes.left.lagSec, desk.quotes.right.lagSec]); // one boundary with build-desk (stale only when lag > STALE_TAPE_SEC)
  const tk = ticketCheck(shown?.ticket ?? null, top ? { symbol: top.symbol, side: top.side as "long" | "short" } : null, desk.clock.etHour, desk.clock.etMinute,
    shown?.ticket ? desk.optionMarks?.find((m) => m.underlier === shown.ticket!.underlier && m.side === shown.ticket!.side)?.ask ?? null : null);
  if (!tk.handable || !tapeFresh) handed = false;
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
    ltfArm: { mode: LTF_ARM.mode, capBand: LTF_ARM.capBand, dropped: (desk.scan.ltfArmShadow ?? []).map((x) => ({ symbol: x.symbol, side: x.side, why: x.why, wouldBand: x.wouldBand, arm: x.arm.why, entry: x.arm.entry, stop: x.arm.stop, t1: x.arm.t1?.price ?? null })) },
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
    feed: { gapped: desk.minuteFeed?.gapped === true, gaps: desk.minuteFeed?.gaps ?? [] },
    tape: {
      feed: desk.feed,
      fresh: tapeFresh,
      gapped: desk.minuteFeed?.gapped === true,
      left: { symbol: desk.quotes.left.symbol, price: desk.quotes.left.price, source: desk.quotes.left.source, lagSec: desk.quotes.left.lagSec },
      right: { symbol: desk.quotes.right.symbol, price: desk.quotes.right.price, source: desk.quotes.right.source, lagSec: desk.quotes.right.lagSec },
    },
    rule1: (desk as { rule1?: import("./rule1").Rule1Ticket[] }).rule1 ?? [],
    strategy: top
      ? {
          symbol: top.symbol,
          side: top.side,
          name: top.completeStrategy || top.strategyPrimary || "model",
          // Band from q, never above the card's pathBand (live gate walk #2: a capped / skip card must not read higher).
          band: armedBand(top),
          pathBand: top.pathBand ?? top.grade ?? null,
          q: top.confluence,
          actionable: top.actionable,
          entry: top.entryPx ?? top.plan?.entry ?? null,
          entryResting: top.entryResting === true,
          chop: top.chop === true,
          qRaw: top.qRaw ?? null,
          bias1h: htfBiasOf(desk.mtfContext, top.symbol)?.bias1h ?? null,
          bias4h: htfBiasOf(desk.mtfContext, top.symbol)?.bias4h ?? null,
          // deep-audit #14: the text is rendered from the number the watcher uses
          stop: top.plan?.stop != null ? stopText(top.plan.stop, top.invalidation) : top.invalidation || null,
          anchor: (top.plan as { raid?: { price: number } | null } | null | undefined)?.raid?.price ?? top.plan?.sweep ?? null,
          invalidated: (top as { invalidated?: boolean }).invalidated === true,
          staleTape: !tapeFresh,
          playedOut: (top as { playedOut?: boolean }).playedOut === true,
          draw: top.draw?.name ?? null,
          displacement: Boolean(top.displacement?.bodyQualified || top.displacement?.qualifiedBy) || (top.dispStrength != null && top.dispStrength.bodyAtr >= 1 && top.dispStrength.leftFvg),
          displacementStrength: top.dispStrength?.score ?? null,
          judas,
          scannerSkip: top.scannerSkip === true,
          ltfKilled: top.ltfKilled === true,
          qV2: ((top as { q_v2?: unknown }).q_v2 as never) ?? null,
          ltfKillCleared: (top as { ltfKillCleared?: boolean }).ltfKillCleared === true,
          entryState: (top as { entryState?: unknown }).entryState ?? null,
          retestReentry: ((top as { retestReentry?: unknown }).retestReentry as never) ?? null,
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
          t1: top.plan?.t1 ?? null,
          stopPx: top.plan?.stop ?? null,
          atr: top.plan?.atr ?? null,
        }
      : null,
    brain: {
      kzSeat: kzSeatNote(),
      retestSeat: retestLine(top),
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
      kzSeat: kzSeatNote(),
      retest: retestLine(top),
      sizeCut: shown?.sizeCut === true,
      handTo: shown?.handTo ?? null,
      blocks: [...tk.blocks, ...(shown?.blocks ?? [])].slice(0, 4),
      ticketCheck: tk.flags,
      otherBookTicket: tk.contradicts && shown?.ticket ? { underlier: shown.ticket.underlier, side: shown.ticket.side, dte: shown.ticket.dteTarget, label: "Floor SMT other-book ticket — NOT the card's trade" } : null,
      ticket: shown?.ticket && !tk.contradicts
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
  try {
    wire.smcUnity = buildSmcUnity(desk, top ?? null, arrRows, book ? { symbol: book.symbol, side: book.side, word: book.word } : null, wire.floor.ticket?.dte ?? null);
  } catch {
    wire.smcUnity = null; // shadow layer must never break the card
  }
  try {
    // evFire (OFF by default): EV read on the top card; rungs from the smcUnity continuation row (same text the watcher and the replay parse).
    if (evOn(EVF.mode) && wire.strategy && top) {
      const st = wire.strategy as unknown as { side: string; q: number; band: string | null; entry: number | null; stopPx?: number | null; t1?: number | null; bias1h?: string | null; bias4h?: string | null };
      const want = st.side === "long" ? "bull" : "bear";
      const htfOk = [st.bias1h, st.bias4h].every((b) => b == null || b === want);
      const cont = (wire.smcUnity?.rows ?? []).find((r) => r.rule === "continuation")?.would ?? "";
      const rungs = Number(/holds on (\d+) rungs/.exec(cont)?.[1] ?? 0);
      const pl = top.plan as { stop?: number; t1?: number | null } | null | undefined;
      const ev = evCard({ q: st.q, band: st.band, side: st.side, entry: st.entry, stop: pl?.stop ?? null, t1: pl?.t1 ?? null, rungs, htfOk });
      (wire.strategy as { ev?: unknown }).ev = { ...ev, rungs, htfOk, mode: EVF.mode };
      (wire.strategy as { qRaw0?: number | null }).qRaw0 = (top as { qRaw0?: number }).qRaw0 ?? null;
      wire.floor.ev = ev.evR == null ? `EV: refuse — ${ev.why}` : `EV ${ev.evR.toFixed(2)}R, P(T1) ${(ev.p! * 100).toFixed(0)}% (measured), cost ${ev.costR}R, ${ev.would ? `WOULD fire $${ev.sizeUsd}` : "no fire"} [${EVF.mode}]`;
    }
  } catch {
    // shadow layer must never break the card
  }
  try {
    wire.deskSeq = buildDeskSeq({
      desk, top: top ?? null, rows: arrRows,
      legacyBrain: book ? { symbol: book.symbol, side: book.side, word: book.word } : null,
      floorTicket: wire.floor.ticket ? { underlier: wire.floor.ticket.underlier, side: wire.floor.ticket.side } : null,
    });
  } catch {
    wire.deskSeq = null; // shadow layer must never break the card
  }
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
        band: armedBand(c),
        pathBand: c.pathBand ?? c.grade ?? null,
        q: c.confluence,
        /** Review 2026-10-15 #2: q before the seal and every cap/penalty that fired (band before/after). */
        q_raw: (c as { q_raw?: number }).q_raw ?? null,
        q_v2: (c as { q_v2?: unknown }).q_v2 ?? null,
        q_scan: (c as { q_scan?: number }).q_scan ?? null,
        capReasons: ((c as { capReasons?: { stage: string; field: string; kind: string; before: unknown; after: unknown; bandBefore: string | null; bandAfter: string | null; why?: string | null; source?: string | null }[] }).capReasons ?? [])
          // fix/cap-why-attribution-1016: serve the writer's own label (source) too; it was dropped here.
          .filter((r) => r.kind !== "nudge").map(({ stage, field, kind, before, after, bandBefore, bandAfter, why, source }) => ({ stage, field, kind, before, after, bandBefore, bandAfter, why: why ?? null, source: source ?? null })),
        actionable: c.actionable,
        strategy: c.completeStrategy || c.strategyPrimary || null,
        entry: c.entryPx ?? c.plan?.entry ?? null,
        /** "card" carries a complete plan; "watch" is a row without one (watchWhy says what is missing). */
        kind: (c as { watchOnly?: boolean }).watchOnly ? "watch" : "card",
        watchWhy: (c as { watchWhy?: string | null }).watchWhy ?? null,
        /** ltfArm (shared rules): best closed-rung 1m-4h arming evidence; mode says if it acted. */
        ltfArm: c.ltfArm ? { mode: LTF_ARM.mode, tf: c.ltfArm.tf, why: c.ltfArm.why, entry: c.ltfArm.entry, stop: c.ltfArm.stop, t1: c.ltfArm.t1?.price ?? null, rr1: c.ltfArm.rr1, armed: c.ltfArmed === true, shadow: c.ltfArmShadow ?? null } : null,
        ask: desk.optionMarks?.find((m) => m.underlier === underlier && m.side === optSide)?.ask ?? null,
      };
    }),
    floor: {
      id: shown?.id ?? null,
      verdict,
      band: shown?.pathBand ?? null,
      blocks: [...tk.blocks, ...(shown?.blocks ?? [])].slice(0, 4),
      ticket: shown?.ticket && !tk.contradicts
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
          bias1h: s.bias1h, bias4h: s.bias4h, dispScore: s.displacementStrength, ltfKilled: s.ltfKilled, qV2: s.qV2 ?? null,
          reversal: s.regime === "reversal" ? "reversal setup (HTF released / LTF breaks)" : null,
        }
      : null,
    rule1: wire.rule1 ?? [],
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

export interface TicketFlags { sideOk: boolean; dteOk: boolean; dteWant: number; liveAskMissing: boolean; contractsZero: boolean; why: string[] }
/**
 * deep-audit #5/#6 (pure): the hand-off ticket must be the card's trade — underlier/side from the card
 * (MNQ/NQ→QQQ, ES→SPY; long→call) — and its DTE must be the intraday ticket DTE (optExec.intradayTicket: 0DTE;
 * 1DTE+ is swing-only). From lateBlockEt an intraday ticket is blocked (0DTE impractical), never rolled. 0 contracts blocks the hand; a missing live ask is flagged only.
 */
export function ticketCheck(
  t: { underlier: string; side: string; dteTarget: number; contracts?: number } | null,
  card: { symbol: string; side: "long" | "short" } | null,
  etHour: number, etMinute: number, liveAsk: number | null,
): { handable: boolean; contradicts: boolean; blocks: string[]; flags: TicketFlags | undefined } {
  if (!t) return { handable: true, contradicts: false, blocks: [], flags: undefined };
  if (!card) return { handable: false, contradicts: false, blocks: ["no card to match the ticket to"], flags: undefined };
  const m = ticketMatchesCard({ underlier: t.underlier, right: t.side }, card.symbol, card.side);
  const fd = floorDteRead(etHour, etMinute, t.dteTarget);
  const want = fd.want;
  // Owner rule 2026-10-15: the intraday ticket is 0DTE ATM (1 OTM fallback); 1DTE+ intraday fails (swing-only).
  const dteOk = dteFitsPlan(t.dteTarget, "intraday") && t.dteTarget === want && !fd.lateBlocked;
  const liveAskMissing = !(liveAsk != null && liveAsk > 0);
  const contractsZero = t.contracts != null && !(t.contracts > 0);
  const why: string[] = [];
  if (!m.ok) why.push(m.why!);
  if (fd.lateBlocked) why.push("0DTE impractical this late (after the intraday cutoff ET) — intraday blocked, not rolled to 1DTE");
  else if (!dteOk) why.push(`ticket ${t.dteTarget} DTE does not fit the intraday plan (want ${want} DTE; 1DTE+ is swing-only)`);
  if (contractsZero) why.push("ticket has 0 contracts");
  // A missing live ask is FLAGGED, not blocked: the watcher prices ARMED tickets on the RH chain (handTo "watcher").
  const flagsWhy = liveAskMissing ? [...why, "no live ask — model price only (watcher must price on the chain)"] : why;
  return { handable: why.length === 0, contradicts: !m.ok, blocks: why, flags: { sideOk: m.ok, dteOk, dteWant: want, liveAskMissing, contractsZero, why: flagsWhy } };
}
