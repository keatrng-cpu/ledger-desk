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
}

export function deskListenCard(desk: DeskPayload): DeskListenCard {
  const floor = evaluateOptionsDesk(desk);
  const best = floor.best;
  const book = desk.smcMaster.oneBook;
  const judas = isJudasWindow(desk.clock.etHour, desk.clock.etMinute);
  const verdict = best?.verdict ?? "STAND";
  const handed = verdict === "ARMED" && Boolean(best?.ticket);
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
  };
}
