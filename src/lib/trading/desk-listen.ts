/**
 * The live scanner, floor, and brain, without the account.
 * The full handoff stays behind CRON_SECRET. This card does not.
 */
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
  }[];
  floor: {
    id: string | null;
    verdict: string;
    band: string | null;
    blocks: string[];
    ticket: { underlier: string; side: string; dte: number; contracts: number; debit: number } | null;
  };
  brain: {
    thesis: string;
    symbol: string | null;
    side: string | null;
    word: string | null;
    missing: string | null;
  };
  said: { who: string; line: string }[];
  report: GrokReport | null;
  /**
   * The one packet the strategy, brain, tape, chart, floor, and Grok share.
   * Each seat reads this. None of them keeps a private copy of the trade.
   */
  wire: DeskWire;
}

export interface DeskWire {
  tape: {
    feed: string;
    fresh: boolean;
    left: { symbol: string; price: number; source: string; lagSec: number };
    right: { symbol: string; price: number; source: string; lagSec: number };
  };
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
      stop: string | null;
      targets: string[];
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
  const best = floor.best;
  const book = desk.smcMaster.oneBook;
  const judas = isJudasWindow(desk.clock.etHour, desk.clock.etMinute);
  const verdict = best?.verdict ?? "STAND";
  const handed = verdict === "ARMED" && Boolean(best?.ticket);
  const top = desk.scan.candidates[0] ?? null;
  const htfReleased = desk.scan.candidates.some((c) => c.htfDisrespected === true);
  const tapeFresh = desk.quotes.left.lagSec < 30 && desk.quotes.right.lagSec < 30;
  const phase = handed ? "hand" : "look";
  const wire: DeskWire = {
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
          band: top.pathBand ?? top.grade,
          q: top.confluence,
          actionable: top.actionable,
          entry: top.entryPx ?? null,
          stop: top.invalidation || null,
          draw: top.draw?.name ?? null,
        }
      : null,
    brain: {
      word: book?.word ?? null,
      thesis: desk.smcMaster.thesis,
      missing: book?.missing ?? null,
      htfReleased,
    },
    chart: desk.levels.slice(0, 2).map((lvl) => ({
      symbol: lvl.symbol,
      levels: lvl.items.slice(0, 6).map((item) => ({ name: item.name, price: item.price })),
    })),
    floor: {
      verdict,
      blocks: (best?.blocks ?? []).slice(0, 4),
      ticket: best?.ticket
        ? {
            underlier: best.ticket.underlier,
            side: best.ticket.side,
            dte: best.ticket.dteTarget,
            contracts: best.ticket.contracts,
            debit: best.ticket.estDebitTotal,
            stop: best.ticket.invalidation || null,
            targets: best.ticket.targets.slice(0, 3),
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
    scanner: desk.scan.candidates.slice(0, 3).map((c) => ({
      symbol: c.symbol,
      side: c.side,
      band: c.pathBand ?? c.grade,
      q: c.confluence,
      actionable: c.actionable,
      strategy: c.completeStrategy || c.strategyPrimary || null,
      entry: c.entryPx ?? null,
    })),
    floor: {
      id: best?.id ?? null,
      verdict,
      band: best?.pathBand ?? null,
      blocks: (best?.blocks ?? []).slice(0, 4),
      ticket: best?.ticket
        ? {
            underlier: best.ticket.underlier,
            side: best.ticket.side,
            dte: best.ticket.dteTarget,
            contracts: best.ticket.contracts,
            debit: best.ticket.estDebitTotal,
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
    said,
    report: null,
    wire,
  };
}
