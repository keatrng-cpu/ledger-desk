import { primaryTarget } from "./card-plan";
import { htfBiasOf, wireMtf, type SmtRead } from "@/lib/smc/mtf-context";
import { bandFromQ } from "@/lib/smc/discipline";
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
    /** Which plan target `target` is (T1 unless T1 < 1R and T2 clears it). */
    targetWhich: "t1" | "t2" | null;
    /** R:R to `target`. */
    rr: number | null;
    rr1: number | null;
    rr2: number | null;
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
    thesis: string;
    missing: string | null;
    htfReleased: boolean;
  };
  chart: { symbol: string; levels: { name: string; price: number }[] }[];
  floor: {
    verdict: string;
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
    ? desk.scan.candidates.find((c) => c.symbol === desk.smcMaster.oneBook!.symbol && c.side === desk.smcMaster.oneBook!.side && c.pathBand !== "skip")
    : undefined;
  const top = bookCand ?? desk.scan.candidates[0] ?? null;
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
          // Band is strictly derived from the q on the wire (PATH bands).
          band: bandFromQ(top.confluence),
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
          displacement: Boolean(top.displacement?.bodyQualified || top.displacement?.qualifiedBy),
          target: primaryTarget(top.plan).price,
          targetWhich: primaryTarget(top.plan).which,
          rr: primaryTarget(top.plan).rr,
          rr1: top.plan?.rr1 ?? null,
          rr2: top.plan?.rr2 ?? null,
          t2: top.plan?.t2 ?? null,
          stopPx: top.plan?.stop ?? null,
          atr: top.plan?.atr ?? null,
        }
      : null,
    brain: {
      word: book?.word ?? null,
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
    chart: desk.levels.slice(0, 2).map((lvl) => ({
      symbol: lvl.symbol,
      levels: lvl.items.slice(0, 6).map((item) => ({ name: item.name, price: item.price })),
    })),
    floor: {
      verdict,
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
            liveAsk: desk.optionMarks?.find((m) => m.underlier === shown.ticket!.underlier && m.side === shown.ticket!.side)?.ask ?? null,
          }
        : null,
    },
    execution: { phase, to: "grok", account: "agentic-6158", broker: "robinhood" },
  };
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
        band: bandFromQ(c.confluence),
        pathBand: c.pathBand ?? c.grade ?? null,
        q: c.confluence,
        actionable: c.actionable,
        strategy: c.completeStrategy || c.strategyPrimary || null,
        entry: c.entryPx ?? c.plan?.entry ?? null,
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

