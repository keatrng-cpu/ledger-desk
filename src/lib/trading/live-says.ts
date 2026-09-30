/**
 * Structured "LIVE DATA SAYS { }" block for Trade Now.
 * Engine uses the tick whether or not we pretty-print it. Showing last
 * price on this card IS display (CME display license). Derived PATH
 * fields are from the same tape.
 */

import type { DeskPayload } from "./build-desk";
import { isNyAmLiveWindow, NY_AM_LIVE_LABEL } from "./sessions";
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
  window: typeof NY_AM_LIVE_LABEL | "off";
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
  smc: {
    word: string;
    thesis: string;
    vsSchools: string;
    left: { symbol: string; word: string; mustPass: number; mustNeed: number; missing: string };
    right: { symbol: string; word: string; mustPass: number; mustNeed: number; missing: string };
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
  // Freshness alone decides `live` — NOT the clock. The gateway's own default
  // (databento_live_gateway.py, in_ny_am_window) streams whenever Globex is
  // open, well beyond NY_AM_LIVE_START_MIN/END_MIN; that pair is only the
  // GUARANTEED minimum (what GATEWAY_NY_AM_ONLY=1 would restore), not the
  // actual runtime window. Gating `live` on `inWindow` used to make this card
  // claim "Gateway idle" for hours while a real sub-5-second tick was already
  // feeding the engine underneath — the exact wrong-direction lie the rest of
  // this codebase is paranoid about (see live-gateway.ts's own freshness
  // doctrine). `inWindow` is kept only to explain the reason text.
  const live = leftLive || rightLive;
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
  if (live && inWindow) {
    reason = "Live gateway tick is feeding Trade Now / PATH / paper manager.";
  } else if (live) {
    reason = `Live gateway tick is feeding Trade Now / PATH / paper manager (outside the guaranteed ${NY_AM_LIVE_LABEL} window — the scheduled gateway happens to still be running).`;
  } else if (inWindow) {
    reason = `In the guaranteed ${NY_AM_LIVE_LABEL} window but no live tick (lag ${lagSec}s, source ${source}). Check gateway/databento_live_gateway.py.`;
  } else {
    reason = `Outside the guaranteed ${NY_AM_LIVE_LABEL} window and no live tick (lag ${lagSec}s, source ${source}). Yahoo/Databento structure only.`;
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
    window: inWindow ? NY_AM_LIVE_LABEL : "off",
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
    smc: desk.smcMaster
      ? {
          word: desk.smcMaster.oneBook?.word ?? "STAND",
          thesis: desk.smcMaster.thesis,
          vsSchools: desk.smcMaster.vsSchools,
          left: {
            symbol: desk.smcMaster.left.symbol,
            word: desk.smcMaster.left.word,
            mustPass: desk.smcMaster.left.mustPass,
            mustNeed: desk.smcMaster.left.mustNeed,
            missing: desk.smcMaster.left.missing,
          },
          right: {
            symbol: desk.smcMaster.right.symbol,
            word: desk.smcMaster.right.word,
            mustPass: desk.smcMaster.right.mustPass,
            mustNeed: desk.smcMaster.right.mustNeed,
            missing: desk.smcMaster.right.missing,
          },
        }
      : null,
    reason,
  };
}
