/**
 * Structured "LIVE DATA SAYS { }" block for Trade Now.
 * Engine uses the tick whether or not we pretty-print it. Showing last
 * price on this card IS display (CME display license). Derived PATH
 * fields are from the same tape.
 */

import type { DeskPayload } from "./build-desk";
import { isNyAmLiveWindow } from "./sessions";
import type { MarketSource } from "@/lib/market/types";

const LIVE_LAG_MAX_SEC = 5;

export interface LiveSaysPrint {
  last: number;
  chgPct: number;
  source: MarketSource;
  lagSec: number;
}

export interface LiveSays {
  live: boolean;
  window: "08:30–11:00 ET" | "off";
  inWindow: boolean;
  asOf: string;
  source: MarketSource | "none";
  lagSec: number;
  mnq: LiveSaysPrint | null;
  es: LiveSaysPrint | null;
  htf: { mnq: string; es: string };
  smt: string;
  path: {
    symbol: string;
    side: string;
    grade: string;
    q: number;
    actionable: boolean;
  } | null;
  reason: string;
}

function printOf(
  q: DeskPayload["quotes"]["left"],
): LiveSaysPrint {
  return {
    last: q.price,
    chgPct: Number(q.changePct.toFixed(3)),
    source: q.source,
    lagSec: Math.round(q.lagSec),
  };
}

function isLivePrint(q: DeskPayload["quotes"]["left"]): boolean {
  return q.source === "live_gateway" && q.lagSec <= LIVE_LAG_MAX_SEC && q.price > 0;
}

export function buildLiveSays(desk: Omit<DeskPayload, "liveSays">): LiveSays {
  const inWindow = isNyAmLiveWindow(
    desk.clock.etHour,
    desk.clock.etMinute,
    desk.clock.weekday,
  );
  const left = desk.quotes.left;
  const right = desk.quotes.right;
  const leftLive = isLivePrint(left);
  const rightLive = isLivePrint(right);
  const live = inWindow && (leftLive || rightLive);
  const lagSec = Math.round(Math.max(left.lagSec, right.lagSec));
  const source: MarketSource | "none" = leftLive
    ? left.source
    : rightLive
      ? right.source
      : left.source === "synthetic" && right.source === "synthetic"
        ? "none"
        : left.source;

  const best =
    desk.scan.candidates.find((c) => c.actionable) ?? desk.scan.candidates[0];

  let reason: string;
  if (!inWindow) {
    reason = "Outside 08:30–11:00 ET live window. Gateway idle. Yahoo/Databento structure only.";
  } else if (!live) {
    reason = `In NY AM window but no live tick (lag ${lagSec}s, source ${source}). Start gateway/databento_live_gateway.py with a live CME key.`;
  } else {
    reason = "Live gateway tick is feeding Trade Now / PATH / paper manager.";
  }

  const mnq =
    left.symbol === "MNQ" || left.symbol === "NQ"
      ? printOf(left)
      : right.symbol === "MNQ" || right.symbol === "NQ"
        ? printOf(right)
        : null;
  const es =
    left.symbol === "ES"
      ? printOf(left)
      : right.symbol === "ES"
        ? printOf(right)
        : null;

  return {
    live,
    window: inWindow ? "08:30–11:00 ET" : "off",
    inWindow,
    asOf: desk.clock.nowEt,
    source,
    lagSec,
    mnq,
    es,
    htf: {
      mnq: desk.bias.left.topDown,
      es: desk.bias.right.topDown,
    },
    smt: desk.scan.smt?.note ?? "",
    path: best
      ? {
          symbol: best.symbol,
          side: best.side,
          grade: String(best.pathBand || best.grade),
          q: Number(best.confluence.toFixed(2)),
          actionable: best.actionable,
        }
      : null,
    reason,
  };
}
