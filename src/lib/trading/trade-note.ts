/**
 * The trade note, pre-filled by the desk — Stage 0 of the execution ladder.
 *
 * THE PROBLEM THIS SOLVES, STATED AS A NUMBER
 * `src/data/trade-log.json` contains ONE trade. The desk has 2,188 backtested
 * trades, 387 shadow refusals and a four-year tape, and exactly one row of
 * reality. Every question that actually matters — do the fills land where the
 * plan said, does the entry rule hold live, is the direction as good as it
 * looks — is unanswerable at n=1, and no amount of further backtesting will
 * move it.
 *
 * The reason it is n=1 is not discipline. It is that logging a trade means
 * hand-typing twenty-odd fields into `scripts/log-trade.mjs`'s template, at
 * the end of a session, about a trade that is already over. That is a
 * friction problem, and friction problems are solved by removing friction,
 * not by resolving to try harder.
 *
 * WHAT IS PRE-FILLED AND WHAT IS NOT — THE WHOLE DESIGN
 * The desk already knows: the date, the ET time, the symbol, the side, the
 * plan's entry / stop / T1 / T2, the grade, the killzone, the word it printed
 * and which must-layers were missing. It writes all of those.
 *
 * It does NOT know, and will not guess: where you actually got filled, where
 * you actually got out, how many contracts, what you paid. Those are left
 * blank, because an invented fill is the one thing this repo refuses
 * everywhere else and a log is a worse place to start than a backtest.
 *
 * So the note goes from ~20 fields to 4, and the 4 that remain are the only
 * ones that carry information the desk could not have produced on its own.
 *
 * WHY A STRING AND NOT A DATABASE WRITE
 * The live trades are on Robinhood, which has no API this desk can reach. A
 * clipboard string that `log-trade.mjs` already parses is the shortest path
 * from "a trade happened" to "a row exists", and it works for a broker the
 * desk will never be connected to.
 *
 * `desk_word` and `missing` are filled even when the desk said STAND. That is
 * deliberate and it is the most valuable part of the row: while the sequence
 * fires as rarely as it does, most real trades are overrides, and an override
 * with no record of WHICH layer was overridden teaches nothing about whether
 * that layer was wrong.
 */

import type { TradePlan } from "./trade-plan";
import type { SmcLayer } from "./smc-master";

/** ET wall-clock parts, so the note carries the session's own time. */
const ET = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

function etParts(ms: number): { date: string; time: string } {
  const p = ET.formatToParts(new Date(ms));
  const get = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  const hour = get("hour") === "24" ? "00" : get("hour");
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    time: `${hour}:${get("minute")}`,
  };
}

export interface NoteInput {
  /** When the trade was taken. Defaults to now. */
  atMs?: number;
  symbol: string;
  side: "long" | "short";
  /** "options" when expressed through the RH sleeve, else "futures". */
  book: "options" | "futures";
  /** QQQ / SPY when the book is options. */
  underlier?: string | null;
  /** The numeric plan the desk priced. Levels come from here, never guessed. */
  plan?: Pick<TradePlan, "entry" | "stop" | "t1" | "t2"> | null;
  /** The word the desk actually printed at entry time. */
  deskWord?: "TAKE" | "WAIT" | "STAND" | "MANAGE" | null;
  /** Must-layers not passing when the trade was taken. */
  layers?: readonly SmcLayer[] | null;
  grade?: string | null;
  killzone?: string | null;
  /** Did the timeframe ladder agree with the trade's direction? */
  ladderAgreed?: boolean | null;
}

const num = (n: number | null | undefined): string =>
  n != null && Number.isFinite(n) ? String(Math.round(n * 100) / 100) : "";

/** The must-layers that were NOT passing — the override record. */
export function missingLayers(layers?: readonly SmcLayer[] | null): string[] {
  return (layers ?? [])
    .filter((l) => l.must && l.state !== "pass")
    .map((l) => l.id);
}

/**
 * Build the note.
 *
 * Every line the desk can fill is filled. Every line only the trader can fill
 * is present and EMPTY, with the comment that says what it wants — an absent
 * field gets forgotten, and a pre-filled guess gets believed.
 */
export function buildTradeNote(input: NoteInput): string {
  const { date, time } = etParts(input.atMs ?? Date.now());
  const p = input.plan ?? null;
  const missing = missingLayers(input.layers);
  const isOptions = input.book === "options";

  const lines: string[] = [
    `# ${input.symbol} ${input.side} — ${date} ${time} ET. Written by the desk.`,
    `# Fill the FOUR blank fields below and run:`,
    `#   npx tsx scripts/log-trade.mjs <this file>`,
    `# Leave anything you do not know EMPTY. An empty field is honest; a guessed one is not.`,
    ``,
    `date:         ${date}`,
    `time_et:      ${time}`,
    `book:         ${input.book}`,
    `symbol:       ${input.symbol}`,
    `side:         ${input.side}`,
    ``,
  ];

  if (isOptions) {
    lines.push(
      `underlier:    ${input.underlier ?? "QQQ"}`,
      `contract:                      # <- YOU: e.g. 600C 9/25`,
      `premium:                       # <- YOU: per contract, dollars per share`,
      `contracts:                     # <- YOU: how many`,
      `debit:                         # blank derives from premium x contracts x 100`,
      `dte:`,
      `delta:`,
      ``,
    );
  }

  lines.push(
    `# The levels the DESK named. Do not edit these — the whole point of the row`,
    `# is comparing them against what actually happened.`,
    `plan_entry:   ${num(p?.entry)}`,
    `plan_stop:    ${num(p?.stop)}`,
    `plan_t1:      ${num(p?.t1)}`,
    `plan_t2:      ${num(p?.t2)}`,
    ``,
    `entry_fill:                    # <- YOU: where you actually got in (underlying)`,
    `exit_fill:                     # <- YOU: where you actually got out`,
    `exit_reason:                   # <- YOU: tp | sl | discretionary | time | never_filled`,
    `pnl:                           # <- YOU: realised dollars, signed`,
    ``,
    `draw_traded_later:             # yes | no — did the named draw print AFTER you were out?`,
    `followed_plan:                 # did you take the size, stop and target as planned?`,
    `why:`,
    `why_written:  before           # before | after — was the reason written before the outcome?`,
    ``,
    `# The override record. This is the most valuable part of the row: while the`,
    `# sequence fires as rarely as it does, most real trades are overrides, and an`,
    `# override with no record of WHICH layer was short teaches nothing about`,
    `# whether that layer was wrong.`,
    `desk_word:    ${input.deskWord ?? ""}`,
    `missing:      ${missing.join(", ")}`,
    `ladder_agreed: ${input.ladderAgreed == null ? "" : input.ladderAgreed ? "yes" : "no"}`,
  );

  if (input.grade) lines.push(`# grade at entry: ${input.grade}`);
  if (input.killzone) lines.push(`# killzone: ${input.killzone}`);

  return lines.join("\n");
}

/**
 * How much of the note the desk was able to fill.
 *
 * Printed next to the button so the ask is honest: "4 fields left" is a
 * different proposition from "log this trade", and the second one is why
 * there is one row in the file.
 */
export function noteBlanks(input: NoteInput): number {
  // entry_fill, exit_fill, exit_reason, pnl — always. Plus the three option
  // legs when the book is options, which only the broker screen knows.
  return input.book === "options" ? 7 : 4;
}
