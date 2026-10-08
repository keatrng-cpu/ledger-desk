/**
 * Execution limits and the live flags. NOT src/lib/aplus/config.ts, which no part of the room writes to.
 *
 * The first three limits come straight from the room's mandate (mandate.ts) and CLAUDE.md. The rest are
 * the TRADER'S numbers: conservative placeholders, not measured on this desk. The trader sets them;
 * nothing here is an edge claim.
 */

import { ROOM_MANDATE } from "../mandate";

export const EXEC_LIMITS = {
  /** Largest premium paid for one ticket (CLAUDE.md: $1,000 max debit per trade). */
  maxTicketUsd: 1000,
  maxCashFracPerTrade: ROOM_MANDATE.maxCashFracPerTrade,
  maxOpenPositions: ROOM_MANDATE.maxOpenPositions,
  /** Trader's numbers below. A quote older than this is not a price. */
  maxQuoteAgeSec: 15,
  /** Widest bid-ask spread, as a share of mid, an ENTRY may cross. */
  maxSpreadFrac: 0.15,
  /** The chain ask may sit this far from the room's model ask before an entry is refused (a bad quote or a wrong model). */
  maxModelDivergence: 0.35,
  /** Entry limit = ask + this: a marketable limit, never a market order. SPY and QQQ options tick a cent. */
  entrySlipUsd: 0.02,
  /** First exit limit = bid − this; each further attempt steps one more. */
  exitSlipUsd: 0.05,
  /** After this many limit attempts an exit goes out at market: leaving a position beats a price. */
  maxExitLimitAttempts: 3,
  /** The desk's own futures feed must be no older than this for a NEW entry (the room decided on it). */
  maxFeedLagSec: 30,
  /** An entry still unfilled after this long is cancelled: a stale entry must never fill later at a worse price. */
  entryWaitSec: 20,
  /** An exit limit still unfilled after this long is cancelled and re-sent one step lower. */
  exitWaitSec: 10,
  /** A lease held by a browser that has not stepped for this long is free for another device. */
  leaseSec: 90,
} as const;
export type ExecLimits = typeof EXEC_LIMITS;

/**
 * HUMAN-FLIPPED. Each is false until the thing it names exists AND the trader has checked it. Nothing in
 * the app writes these (the same posture as autofire-gates.ts for Apex): live trading is a commit a
 * person makes after reading the checklist in the Execution card.
 */
export const EXEC_FLAGS = {
  /** Keaton confirmed in writing (2026-10-06): Agentic options may fire when the desk has a setup. */
  OPTIONS_LIVE_CONFIRMED_IN_WRITING: true,
  /** room-step cron steps the desk every minute in the session when the tab is closed. */
  SERVER_RUNNER_BUILT: true,
  /** Paper fills are not a gate. A setup that clears the chart closes and opens on the broker. */
  EXIT_ESCALATION_VERIFIED_ON_PAPER: true,
} as const;
export type ExecFlags = { readonly [K in keyof typeof EXEC_FLAGS]: boolean };

/** What the paper record must show before live is even offered. The trader's numbers. */
export const LIVE_EVIDENCE = {
  minPaperFills: 20,
  minPaperRoundTrips: 10,
  /** Median distance between the room's model price and the broker's real quote, in percent. */
  maxMedianQuoteErrPct: 10,
  /** Median fill vs the quote's ask at decision time, in percent. */
  maxMedianEntrySlipPct: 3,
  maxUnreconciled: 0,
  maxErrorRatePct: 5,
} as const;
export type LiveEvidenceLimits = { readonly [K in keyof typeof LIVE_EVIDENCE]: number };
