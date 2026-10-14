/**
 * What the five say in the Mead Hall about the prediction board — and where they stand while they say it.
 *
 * The hall is a glass-and-pine bar with a jumbotron, a Rune Board, three bar TVs, a Long Table, a lectern and a ledger board. It shows
 * the signal engine's board (`hall-lite.ts` carries it into the talk world): the six markets it ranks first, each with the price a
 * buyer has to beat after fees, the spread and depth, the move and its velocity from real trades only, the time to settle, how fresh the
 * read is, and an edge ONLY where a real model input exists. Where none exists the engine says "no edge read" and gives no letter.
 *
 * These exchanges teach what the engine already computes and name what it cannot. They never pick a winner, never grade a price move,
 * never call a price cheap or rich, never say which side to be on, and never touch an order: paper only, narration only. Every number
 * goes through `Facts` and is the engine's own field (hall-lite.ts rounds it for speech; nothing is recomputed here). A line with
 * nothing new to say is not said: every builder returns null when its data is missing, old or unchanged.
 *
 * Cents are written "56¢" (never "56 cents"): the spoken-form guard reads a cents sign as hundredths of a dollar on both sides, so the
 * number a listener hears is provably the number on the screen (spoken-form.ts `numbersHeld`). A single cent is "a cent", because the
 * speech engine says "1 cents". Percent, points, minutes and hours are plain numbers.
 *
 * The voices: Jax is impatient and wants a side; Sterling is the one who says no and talks in conditions; Nova is numbers and
 * probabilities; Gemma is time, liquidity and sourcing; Vince is the operator who reads the cents and rests at the limit.
 */

import { HALL_SPOTS } from "./mead-hall-layout";
import { LAYER_SAY, subjectOf } from "./hall-lite";
import { linkScore } from "./off-hours-study";
import { ANIM, type Facts, type HallLite, type HallRowLite, type Line, type NewsLite, type TalkMove, type TalkState, type TalkWorld } from "./live-types";
import { clip, compact, exMead as exMeadPlain, line, pick, type Ctx, type Ex } from "./live-voices";
import type { Character } from "./orchestrator";

/* ── Where they stand ──────────────────────────────────────────────────── */

const HALL = (spot: string): TalkMove => ({ zone: "HALL", spot });

/** The closed room studies seated at the Long Table. */
export const HALL_STUDY_MOVES: Record<Character, TalkMove> = {
  Gemma: HALL("mead_long_n0"),
  Nova: HALL("mead_long_n1"),
  Vince: HALL("mead_long_n2"),
  Sterling: HALL("mead_long_s0"),
  Jax: HALL("mead_long_s1"),
};

/** Under the jumbotron: Vince reads the cents, Gemma the clock, Nova the Rune Board's numbers, Jax leans on the taps, Sterling at the lectern. */
const AT_JUMBO: Record<Character, TalkMove> = {
  Vince: HALL("mead_jumbo_0"),
  Gemma: HALL("mead_jumbo_1"),
  Nova: HALL("mead_board"),
  Jax: HALL("mead_tap"),
  Sterling: HALL("mead_lectern"),
};

/** A lesson at the Long Table, Sterling teaching from the lectern. */
const AT_TABLE: Record<Character, TalkMove> = {
  Nova: HALL("mead_long_n1"),
  Gemma: HALL("mead_long_n0"),
  Vince: HALL("mead_long_n2"),
  Jax: HALL("mead_long_s1"),
  Sterling: HALL("mead_lectern"),
};

/** The bar and the hearth: where the crowd's mood is felt. */
const AT_BAR: Record<Character, TalkMove> = {
  Jax: HALL("mead_bar_0"),
  Vince: HALL("mead_jumbo_0"),
  Gemma: HALL("mead_chat_0"),
  Nova: HALL("mead_chat_1"),
  Sterling: HALL("mead_hearth_1"),
};

/** Every scene the voices use, for the verifier to prove each spot exists in the plan and no exchange puts two people on one. */
export const HALL_SCENES: Record<string, Record<Character, TalkMove>> = { study: HALL_STUDY_MOVES, jumbo: AT_JUMBO, table: AT_TABLE, bar: AT_BAR };
const KNOWN = new Set(HALL_SPOTS.map((s) => s.id));
for (const scene of Object.values(HALL_SCENES)) for (const m of Object.values(scene)) if (!KNOWN.has(m.spot as string)) throw new Error(`live-voices-mead: ${m.spot} is not a hall spot`);

/** The scene's moves for the people who actually speak in these lines (a person with nothing to say stays where they are). */
const place = (lines: Line[], m: Record<Character, TalkMove>): Ex["moves"] =>
  Object.fromEntries([...new Set(lines.map((l) => l.character))].map((w) => [w, m[w]])) as Ex["moves"];

/* ── Small tools ───────────────────────────────────────────────────────── */

/** A number as it should be said: no trailing ".0", registered with Facts (a year or a few hundred contracts takes no separator). */
const n = (f: Facts, x: number, dp = 1): string => {
  const v = Number(x.toFixed(dp));
  return f.raw(Math.abs(v) >= 10_000 ? v.toLocaleString("en-US") : String(v));
};
/** Cents, written with the cents sign the spoken-form guard reads as hundredths; one cent is a word. */
const c = (f: Facts, x: number, dp = 1): string => (Number(x.toFixed(dp)) === 1 ? "a cent" : `${n(f, x, dp)}¢`);
const plural = (k: number, one: string, many = `${one}s`): string => (k === 1 ? one : many);
/** Text that came from data (an outcome, a source, a headline) and may carry digits: registered as printed. */
const t = (f: Facts, s: string, max = 80): string => f.raw(clip(s, max));
/** A row named aloud: "NFL game on October 5, Minnesota". */
const subj = (f: Facts, r: HallRowLite, max = 80): string => t(f, subjectOf(r), max);
const settleIn = (f: Facts, r: HallRowLite): string | null => (r.settle ? `${n(f, r.settle.n)} ${r.settle.unit}` : null);
const upper1 = (s: string): string => `${s[0]!.toUpperCase()}${s.slice(1)}`;

const LIQ_SAY: Record<HallRowLite["liq"], string> = { deep: "deep", ok: "adequate", thin: "thin", none: "missing" };
const SPORTS = new Set(["NFL", "NBA", "MLB", "NHL", "NCAAF"]);

/** The name of a layer the scanner failed on. */
const layer = (id: string | null): string => (id ? (LAYER_SAY[id] ?? id) : "none");

const usable = (h: HallLite | null | undefined): h is HallLite => Boolean(h && !h.old && h.rows.length > 0);

/* ── The jumbotron: the board read ─────────────────────────────────────── */

export function exHallBoard(cx: Ctx, h: HallLite): Ex | null {
  const f = cx.f;
  const r = h.rows[0];
  if (!r) return null;
  const ask = r.yesAskC != null ? `yes asks ${c(f, r.yesAskC)}` : "there is no yes ask on the book";
  const no = r.noAskC != null ? `, no asks ${c(f, r.noAskC)}` : "";
  const sp = r.spreadC != null ? `, spread ${c(f, r.spreadC)}` : "";
  const dp = r.askSize != null ? `, ${n(f, r.askSize, 0)} contracts at the ask` : "";
  const lines = compact([
    line("Vince", ANIM.Vince.watch!, pick(cx, "hall.board.vince", [
      () => `Jumbotron has ${subj(f, r)}. On the book ${ask}${no}${sp}${dp}.`,
      () => `I am reading the jumbotron: ${subj(f, r)}. ${upper1(ask)}${no}${sp}${dp}.`,
    ])),
    r.needsYesPct != null && r.midC != null && r.costPts != null
      ? line("Nova", ANIM.Nova.analyze!, pick(cx, "hall.board.nova", [
          () => `Mid is ${n(f, r.midC!)} percent. A yes buyer pays the taker fee and slippage, so yes has to be right ${n(f, r.needsYesPct!)} percent of the time just to break even. ${n(f, r.costPts!)} points of cost before any view.`,
          () => `The market's own number is ${n(f, r.midC!)} percent. After fees and slippage yes needs ${n(f, r.needsYesPct!)} percent, so crossing the book costs ${n(f, r.costPts!)} points before the contract is even right.`,
        ]))
      : null,
    line("Gemma", ANIM.Gemma.explain!, pick(cx, "hall.board.gemma", [
      () => `Depth is ${LIQ_SAY[r.liq]}${r.settle ? `, and it settles in ${settleIn(f, r)}` : ""}. The read is ${f.span(h.ageSec)} old, from ${t(f, h.source, 30)}.`,
      () => `${t(f, h.source, 30)} gave us this ${f.span(h.ageSec)} ago. The book is ${LIQ_SAY[r.liq]}${r.settle ? `, and the contract settles in ${settleIn(f, r)}` : ""}.`,
    ])),
    line("Jax", ANIM.Jax.point!, pick(cx, "hall.board.jax", [
      () => `Fine. So which side is it? ${t(f, r.outcome, 30)}, or not?`,
      () => `I want a side. In or out on ${t(f, r.outcome, 30)}?`,
    ])),
    line("Sterling", ANIM.Sterling.arms!, pick(cx, "hall.board.sterling", r.grade == null
      ? [
          () => `Neither. No edge read, so no letter. The setup score of ${n(f, r.score, 0)} says how clean the book is, not what happens next.`,
          () => `Neither. The engine will not grade it without an independent model. Setup ${n(f, r.score, 0)}, no letter. A clean book is not a view.`,
        ]
      : [
          () => `Not on a price alone. It has a letter, ${f.raw(r.grade!)}, only because a model input exists, and the letter is about cost after fees, not about who wins.`,
          () => `No side. The engine's letter is ${f.raw(r.grade!)} from a setup score of ${n(f, r.score, 0)}, a grade on the price against a model. It is not a forecast.`,
        ])),
  ]);
  return lines.length >= 3 ? { lines, moves: place(lines, AT_JUMBO) } : null;
}

/* ── The fee lesson ────────────────────────────────────────────────────── */

export function exHallFee(cx: Ctx, h: HallLite): Ex | null {
  const f = cx.f;
  const r = h.rows.find((x) => x.yesAskC != null && x.feeYesC != null && x.needsYesPct != null);
  if (!r || !(h.fee.takerPct > 0)) return null;
  const lines = compact([
    line("Nova", ANIM.Nova.analyze!, pick(cx, "hall.fee.nova", [
      () => `Mechanism first. Kalshi's taker fee is ${f.pct(h.fee.takerPct)} of contracts times price times one minus the price, rounded up to the next cent on the order.`,
      () => `Here is the fee. A taker on Kalshi pays ${f.pct(h.fee.takerPct)} times price times one minus price, per contract, rounded up on the order.`,
    ])),
    line("Vince", ANIM.Vince.watch!, pick(cx, "hall.fee.vince", [
      () => `So ${subj(f, r, 70)} at ${c(f, r.yesAskC!)} pays ${c(f, r.feeYesC!, 2)} a contract. Add ${c(f, h.fee.slipC)} of slippage and yes needs ${n(f, r.needsYesPct!)} percent.`,
      () => `Worked on the jumbotron: ${c(f, r.yesAskC!)} carries ${c(f, r.feeYesC!, 2)} a contract of fee. The engine adds ${c(f, h.fee.slipC)} for slippage, which puts yes at ${n(f, r.needsYesPct!)} percent to clear.`,
    ])),
    line("Jax", ANIM.Jax.shout!, pick(cx, "hall.fee.jax", [
      () => `Does the fee care what price I pay?`,
      () => `Is the fee the same at ${c(f, h.fee.lowPriceC, 0)} as at ${c(f, h.fee.peakPriceC, 0)}?`,
    ])),
    line("Nova", ANIM.Nova.analyze!, pick(cx, "hall.fee.curve", [
      () => `It moves with the price. Price times one minus price peaks at ${c(f, h.fee.peakPriceC, 0)}: ${c(f, h.fee.peakC, 2)} a contract there. At ${c(f, h.fee.lowPriceC, 0)} it is ${c(f, h.fee.lowC, 2)}.`,
      () => `The fee is widest at a coin flip, ${c(f, h.fee.peakC, 2)} at ${c(f, h.fee.peakPriceC, 0)}, and it shrinks toward the edges: ${c(f, h.fee.lowC, 2)} at ${c(f, h.fee.lowPriceC, 0)}.`,
    ])),
    h.fee.makerPct > 0
      ? line("Vince", ANIM.Vince.thumbs!, pick(cx, "hall.fee.maker", [
          () => `That is why I rest an order and do not cross. Kalshi lists NFL makers at ${f.pct(h.fee.makerPct, 2)}, and a resting order sets its own price.`,
          () => `So I rest at the limit. The schedule has an NFL maker at ${f.pct(h.fee.makerPct, 2)}, against ${f.pct(h.fee.takerPct)} for the taker.`,
        ]))
      : null,
    line("Sterling", ANIM.Sterling.arms!, pick(cx, "hall.fee.sterling", [
      () => `If the price is fair, the fee is the expected loss. A view has to beat it before it counts as a view.`,
      () => `Costs come before edge. A fair price still charges the fee, so the view has to be worth more than that.`,
    ])),
  ]);
  return lines.length >= 4 ? { lines, moves: place(lines, AT_TABLE) } : null;
}

/* ── The model question ────────────────────────────────────────────────── */

/** Kalshi's own price is not a model; this is the exchange where the hall says what it would take. */
export function exHallNoModel(cx: Ctx, h: HallLite): Ex | null {
  const f = cx.f;
  const r = h.rows.find((x) => x.edge == null);
  if (!r) return null;
  const sports = SPORTS.has(r.fam);
  const lines = compact([
    line("Nova", ANIM.Nova.analyze!, pick(cx, "hall.nomodel.nova", [
      () => `${subj(f, r)}: no edge read. The engine will not use Kalshi's own price as a model. Grade a market against itself and you find an edge by construction.`,
      () => `No edge read on ${subj(f, r)}. Kalshi's price is the thing being tested, so it cannot also be the model.`,
    ])),
    line("Gemma", ANIM.Gemma.explain!, pick(cx, sports ? "hall.nomodel.gemma.sports" : "hall.nomodel.gemma.other", sports
      ? [
          () => `What it needs is an independent probability with a source and a time: a sportsbook line with the margin removed, or a live win model. For this game the scanner has none right now.`,
          () => `A model here means a sportsbook price with its margin taken out, or a live win probability, each with a time on it. The scanner has no reference for this game right now.`,
        ]
      : [
          () => `What it needs is an independent probability with a source and a time. For ${t(f, r.famSay, 30)} the hall has none. The only model inputs here come from the sports scanner.`,
          () => `A model means an outside probability with a source and a time. The hall's only supplier is the sports scanner, and it does not cover ${t(f, r.famSay, 30)}.`,
        ])),
    line("Jax", ANIM.Jax.shout!, pick(cx, "hall.nomodel.jax", [
      () => `Then call it from the gut. I have a gut.`,
      () => `So guess. I am very good at guessing.`,
    ])),
    line("Sterling", ANIM.Sterling.arms!, pick(cx, "hall.nomodel.sterling", [
      () => `No letter without the input. The score of ${n(f, r.score, 0)} is how clean the book is. It is not a forecast, and a guess is not an input.`,
      () => `A guess is not a model input. The engine gives setup ${n(f, r.score, 0)} and no letter, and it says so out loud.`,
    ])),
    line("Vince", ANIM.Vince.watch!, pick(cx, "hall.nomodel.vince", [
      () => `Count on the board: ${n(f, h.noEdge, 0)} of ${n(f, h.total, 0)} markets have no edge read. ${n(f, h.modeled, 0)} ${plural(h.modeled, "has", "have")} a model behind ${h.modeled === 1 ? "it" : "them"}.`,
      () => `Of ${n(f, h.total, 0)} markets, ${n(f, h.noEdge, 0)} say no edge read. ${n(f, h.modeled, 0)} ${plural(h.modeled, "carries", "carry")} an outside model.`,
    ])),
  ]);
  return lines.length >= 4 ? { lines, moves: place(lines, AT_TABLE) } : null;
}

/** A market with a real model input: the gap as arithmetic, and the scanner's eight layers as the spine. */
export function exHallModel(cx: Ctx, h: HallLite): Ex | null {
  const f = cx.f;
  const r = h.rows.find((x) => x.edge != null);
  if (!r || !r.edge) return null;
  const e = r.edge;
  const ahead = e.netC > 0;
  const gap = c(f, Math.abs(e.netC));
  const src = t(f, e.modelSrc, 50);
  const sc = r.scan;
  const lines = compact([
    line("Nova", ANIM.Nova.analyze!, pick(cx, "hall.model.nova", [
      () => `${subj(f, r, 70)}. ${src} puts ${e.side} at ${n(f, e.modelPct)} percent${e.needPct != null ? ` against ${n(f, e.needPct)} needed after costs` : ""}. That is ${gap} a contract ${ahead ? "ahead of costs" : "short of costs"}. Arithmetic, not a call.`,
      () => `Model input: ${src}, ${e.side} at ${n(f, e.modelPct)} percent${e.needPct != null ? `, against ${n(f, e.needPct)} to clear fees and slippage` : ""}. ${upper1(gap)} a contract ${ahead ? "ahead" : "short"}. A gap on paper, not a side.`,
    ])),
    sc
      ? line("Vince", ANIM.Vince.watch!, pick(cx, sc.clears ? "hall.model.vince.clear" : "hall.model.vince.miss", sc.clears
          ? [
              () => `The scanner runs ${n(f, sc.total, 0)} layers on it and all ${n(f, sc.total, 0)} pass${sc.limitC != null ? `. The limit that clears fees and the margin is ${c(f, sc.limitC, 0)}` : ""}${sc.askC != null ? `, ask ${c(f, sc.askC, 0)}` : ""}.`,
              () => `All ${n(f, sc.total, 0)} scanner layers pass on this one${sc.limitC != null ? `, with a limit of ${c(f, sc.limitC, 0)}` : ""}${sc.askC != null ? ` against an ask of ${c(f, sc.askC, 0)}` : ""}.`,
            ]
          : [
              () => `The scanner runs ${n(f, sc.total, 0)} layers and ${n(f, sc.passed, 0)} pass. The one missing is ${layer(sc.miss)}${sc.limitC != null ? `. The price that clears fees plus the margin is ${c(f, sc.limitC, 0)}` : ""}${sc.askC != null ? `, and the ask is ${c(f, sc.askC, 0)}` : ""}.`,
              () => `${n(f, sc.passed, 0)} of ${n(f, sc.total, 0)} scanner layers pass. ${upper1(layer(sc.miss))} is the first one that fails${sc.limitC != null ? `. The limit that would clear fees is ${c(f, sc.limitC, 0)}` : ""}${sc.askC != null ? `; the ask is ${c(f, sc.askC, 0)}` : ""}.`,
            ]))
      : line("Vince", ANIM.Vince.watch!, pick(cx, "hall.model.vince.none", [
          () => `The scanner has no row for this one: ${n(f, 0, 0)} layers read and no limit price to rest at.`,
          () => `No scanner row on it, so ${n(f, 0, 0)} layers to name and no number to rest at.`,
        ])),
    line("Gemma", ANIM.Gemma.explain!, pick(cx, "hall.model.gemma", [
      () => `An input is only as good as its source and its time. This board is ${f.span(h.ageSec)} old, and the model came with it.`,
      () => `${src} is an estimate of the truth, not the truth. The read is ${f.span(h.ageSec)} old.`,
      ...(sc ? [() => `The scanner prices Robinhood's fee stack and the engine prices Kalshi's taker fee, so the limit and the edge are two views of one gap, not two answers.`] : []),
    ])),
    line("Jax", ANIM.Jax.shout!, pick(cx, ahead ? "hall.model.jax.ahead" : "hall.model.jax.short", ahead
      ? [
          () => `A gap! Say the word and I chase it.`,
          () => `Finally a number I can lean on. Do I lean?`,
        ]
      : [
          () => `Short of costs? So the model says pass. I hate it when the model says pass.`,
          () => `The price is already fair against the model. Where is my edge then?`,
        ])),
    line("Sterling", ANIM.Sterling.arms!, pick(cx, ahead ? "hall.model.sterling.ahead" : "hall.model.sterling.short", ahead
      ? [
          () => `A gap is a hypothesis. The go ledger tests it, and under ${n(f, h.rules.minSettled, 0)} settled prints that record is noise.`,
          () => `Not yet. A gap against an estimate is a question. The ledger answers it, after ${n(f, h.rules.minSettled, 0)} settled prints at the least.`,
        ]
      : [
          () => `Short of costs is an answer too: against this model the price is already fair. The ledger tests any gap, either way, and under ${n(f, h.rules.minSettled, 0)} settled prints it is noise.`,
          () => `A model that finds no edge is doing its job. The ledger decides whether it is right, after ${n(f, h.rules.minSettled, 0)} settled prints at the least.`,
        ])),
  ]);
  return lines.length >= 4 ? { lines, moves: place(lines, AT_TABLE) } : null;
}

/* ── The price bands ───────────────────────────────────────────────────── */

const bandOf = (f: Facts, b: NonNullable<HallRowLite["bin"]>): string =>
  b.id === "lt10" ? `under ${c(f, b.hiC, 0)}` : b.hiC >= 100 ? `${c(f, b.loC, 0)} and up` : `${n(f, b.loC, 0)} to ${c(f, b.hiC, 0)}`;

/** The favorite-longshot evidence: the band the engine put the contract in, what it did to the score, and where the prior comes from. */
export function exHallBins(cx: Ctx, h: HallLite): Ex | null {
  const f = cx.f;
  const cheap = h.rows.filter((x) => x.bin && x.bin.hiC <= 20).sort((a, b) => (a.gradedAskC ?? 99) - (b.gradedAskC ?? 99))[0];
  const r = cheap ?? h.rows.find((x) => x.bin && x.gradedAskC != null);
  if (!r || !r.bin || r.gradedAskC == null) return null;
  const b = r.bin;
  const band = bandOf(f, b);
  const lowBand = b.hiC <= 20;
  const lines = compact([
    line("Gemma", ANIM.Gemma.explain!, pick(cx, "hall.bins.gemma", [
      () => `${subj(f, r)}: the ${r.gradedSide} ask is ${c(f, r.gradedAskC!, 0)}. That is the ${band} band.`,
      () => `Look at the price band. ${subj(f, r)} asks ${c(f, r.gradedAskC!, 0)} on the ${r.gradedSide} side, in ${band}.`,
    ])),
    line("Nova", ANIM.Nova.analyze!, pick(cx, "hall.bins.nova", b.points < 0
      ? [
          () => `The engine docks ${n(f, Math.abs(b.points), 0)} points there${b.cap ? ` and caps the letter at ${f.raw(b.cap)}` : ""}. Cheap contracts have won less often than their prices say.`,
          () => `Down ${n(f, Math.abs(b.points), 0)} points in that band${b.cap ? `, and the letter cannot pass ${f.raw(b.cap)}` : ""}. Underdog prices have run rich on Kalshi.`,
        ]
      : b.points > 0
        ? [
            () => `The engine adds ${n(f, b.points, 0)} points in that band. Favorites have won slightly more often than priced, and the gain is small.`,
            () => `Up ${n(f, b.points, 0)} points there. Favorites have beaten their prices a little, and only a little.`,
          ]
        : [
            () => `The engine neither docks nor adds there. Near the middle there is no documented bias either way.`,
            () => `No points either way in that band. A price near the middle has no documented lean.`,
          ])),
    lowBand
      ? line("Jax", ANIM.Jax.shout!, pick(cx, "hall.bins.jax", [
          () => `But a longshot pays big when it lands!`,
          () => `Cheap ones pay the most. That is the whole point of cheap.`,
        ]))
      : null,
    line("Nova", ANIM.Nova.analyze!, pick(cx, "hall.bins.source", [
      () => `The source is ${t(f, h.flb.authors, 40)}, ${n(f, h.flb.year, 0)}: on Kalshi, takers lost about ${n(f, h.flb.takerLossPct, 0)} percent after fees, and makers about ${n(f, h.flb.makerLossPct, 0)}.`,
      () => `That comes from ${t(f, h.flb.authors, 40)}, ${n(f, h.flb.year, 0)}. Takers lost around ${n(f, h.flb.takerLossPct, 0)} percent after fees on Kalshi. Makers lost around ${n(f, h.flb.makerLossPct, 0)}.`,
    ])),
    line("Sterling", ANIM.Sterling.arms!, pick(cx, "hall.bins.sterling", [
      () => `That is a prior from one study, not this desk's record. Our own paper book decides, after ${n(f, h.rules.minSettled, 0)} settled tickets.`,
      () => `One paper's prior. Ours is a record we do not have yet, and it needs ${n(f, h.rules.minSettled, 0)} settled tickets before it says anything.`,
    ])),
  ]);
  return lines.length >= 4 ? { lines, moves: place(lines, AT_TABLE) } : null;
}

/* ── The crowd ─────────────────────────────────────────────────────────── */

/** The row with the fastest real move on the board, or null when nothing has a velocity. */
export function moverOf(h: HallLite): HallRowLite | null {
  let best: HallRowLite | null = null;
  for (const r of h.rows) if (r.velCph != null && (!best || Math.abs(r.velCph) > Math.abs(best.velCph!))) best = r;
  return best;
}

const MOOD_SAY = { surging: "surging", sliding: "sliding", restless: "restless", quiet: "quiet" } as const;

export function exHallCrowd(cx: Ctx, h: HallLite): Ex | null {
  const f = cx.f;
  const m = moverOf(h);
  const { reaction, energyPct, basedOn, mood } = h.crowd;
  if (!m || m.velCph == null || reaction == null || energyPct == null) return null;
  const up = m.velCph >= 0;
  const rx =
    reaction === "hail"
      ? [() => `Hail! The whole hall is up on it, energy ${f.pct(energyPct)}!`, () => `That is a roar at ${f.pct(energyPct)} energy. Hail!`]
      : reaction === "cheer"
        ? [() => `There it goes! Cheers all round, ${f.pct(energyPct)} energy!`, () => `The hall is cheering at ${f.pct(energyPct)} and I am with it.`]
        : [() => `Ugh. The hall just groaned, ${f.pct(energyPct)} energy.`, () => `That is a groan at ${f.pct(energyPct)}. Everyone felt that one.`];
  const lines = compact([
    line("Vince", ANIM.Vince.watch!, pick(cx, "hall.crowd.vince", [
      () => `${subj(f, m)} is moving: ${c(f, Math.abs(m.velCph!))} an hour ${up ? "up" : "down"}${m.velHours != null ? `, over ${n(f, m.velHours)} hours` : ""}, from ${n(f, m.velPoints, 0)} hourly trade ${plural(m.velPoints, "point")}.`,
      () => `Fastest mover is ${subj(f, m)}, ${up ? "rising" : "falling"} ${c(f, Math.abs(m.velCph!))} an hour${m.velHours != null ? ` across ${n(f, m.velHours)} hours` : ""} on ${n(f, m.velPoints, 0)} real ${plural(m.velPoints, "trade")}.`,
    ])),
    line("Jax", ANIM.Jax.shout!, pick(cx, `hall.crowd.jax.${reaction}`, rx)),
    line("Gemma", ANIM.Gemma.explain!, pick(cx, "hall.crowd.gemma", [
      () => `The crowd reads ${MOOD_SAY[mood]}, energy ${n(f, energyPct, 0)} percent, on ${n(f, basedOn, 0)} ${plural(basedOn, "market")} with real trades behind ${basedOn === 1 ? "it" : "them"}.`,
      () => `Crowd mood is ${MOOD_SAY[mood]} at ${n(f, energyPct, 0)} percent energy. It counts only the ${n(f, basedOn, 0)} ${plural(basedOn, "market that has", "markets that have")} real trades.`,
    ])),
    line("Nova", ANIM.Nova.analyze!, pick(cx, "hall.crowd.nova", [
      () => `Velocity is the slope of real hourly trades inside a ${n(f, h.rules.velWindowH, 0)} hour window. One point is not a slope.`,
      () => `It is a slope over real hourly trades in the last ${n(f, h.rules.velWindowH, 0)} hours. With one trade there is no slope, so there is no read.`,
    ])),
    line("Sterling", ANIM.Sterling.arms!, pick(cx, "hall.crowd.sterling", [
      () => `A price move is shown, never graded. The engine has no evidence that Kalshi lags the news, so a mover earns no points.`,
      () => `Shown, not graded. Nobody has shown that a Kalshi price trails the news, so the roar earns the mover nothing.`,
    ])),
  ]);
  return lines.length >= 4 ? { lines, moves: place(lines, AT_BAR) } : null;
}

/* ── The clock ─────────────────────────────────────────────────────────── */

const minutesOf = (s: NonNullable<HallRowLite["settle"]>): number => s.n * (s.unit.startsWith("day") ? 1440 : s.unit.startsWith("hour") ? 60 : 1);

/** The market that settles first among the rows that can still trade, or null. */
export function nextToSettle(h: HallLite): HallRowLite | null {
  let best: HallRowLite | null = null;
  for (const r of h.rows) {
    if (!r.settle || (r.phase !== "open" && r.phase !== "closing_soon")) continue;
    if (!best || minutesOf(r.settle) < minutesOf(best.settle!)) best = r;
  }
  return best;
}

/** What settles next, and how old the read is. A read that is too old to talk from is said to be old, once. */
export function exHallClock(cx: Ctx, h: HallLite): Ex | null {
  const f = cx.f;
  if (h.old || h.rows.length === 0) {
    const lines = compact([
      line("Gemma", ANIM.Gemma.explain!, pick(cx, h.rows.length === 0 ? "hall.clock.empty.gemma" : "hall.clock.old.gemma", h.rows.length === 0
        ? [
            () => `The board has no priced market on it, ${f.int(0)} rows${h.reason ? `: ${t(f, h.reason, 90)}` : ""}.`,
            () => `Nothing priced on the board, ${f.int(0)} rows${h.reason ? `. The note says ${t(f, h.reason, 90)}` : ""}.`,
          ]
        : [
            () => `The last read is ${f.span(h.ageSec)} old. The engine calls a quote stale after ${n(f, h.staleSec, 0)} seconds, so nothing on the board is priced right now.`,
            () => `This board is ${f.span(h.ageSec)} old and the engine's limit is ${n(f, h.staleSec, 0)} seconds. We are looking at history.`,
          ])),
      line("Vince", ANIM.Vince.watch!, pick(cx, h.held ? "hall.clock.held.vince" : "hall.clock.old.vince", h.held
        ? [() => `The last pull failed, so this is the board we kept, ${f.span(h.ageSec)} old.`, () => `A pull failed. The screens are holding the ${f.span(h.ageSec)}-old board.`]
        : [() => `No fresh pull in ${f.span(h.ageSec)}. I will not read cents off a stale board.`, () => `Nothing new for ${f.span(h.ageSec)}. The cents on the screens are old.`])),
      line("Sterling", ANIM.Sterling.arms!, pick(cx, "hall.clock.old.sterling", [
        () => `A ${f.span(h.ageSec)}-old price is history. We do not trade history, on paper or otherwise.`,
        () => `Old prices are not prices; the limit is ${n(f, h.staleSec, 0)} seconds. We wait for the next read.`,
      ])),
    ]);
    return lines.length >= 2 ? { lines, moves: place(lines, AT_JUMBO) } : null;
  }
  const r = nextToSettle(h);
  if (!r || !r.settle) return null;
  const soon = r.phase === "closing_soon";
  const near = soon || r.settle.unit.startsWith("minute");
  const lines = compact([
    line("Jax", ANIM.Jax.point!, pick(cx, "hall.clock.jax", [
      () => `What ends first?`,
      () => `So which one is closest to the bell?`,
    ])),
    line("Gemma", ANIM.Gemma.explain!, pick(cx, "hall.clock.gemma", [
      () => `${subj(f, r)} settles first, in ${settleIn(f, r)}${soon ? ", and it is closing soon" : ""}.`,
      () => `The nearest settlement is ${subj(f, r)}, ${settleIn(f, r)} out${soon ? ", already inside its last minutes" : ""}.`,
    ])),
    line("Vince", ANIM.Vince.watch!, pick(cx, h.stale ? "hall.clock.vince.stale" : "hall.clock.vince", h.stale
      ? [
          () => `The quote was ${r.fresh} when it was read, ${f.span(h.ageSec)} ago. By the engine's ${n(f, h.staleSec, 0)} second rule it is stale now.`,
          () => `Read ${f.span(h.ageSec)} ago and ${r.fresh} then. The engine calls a quote stale after ${n(f, h.staleSec, 0)} seconds, so what I am reading is history.`,
        ]
      : [
          () => `The quote is ${r.fresh}, off the ${r.basis === "book" ? "live book" : "last trade"}, and the read is ${f.span(h.ageSec)} old.`,
          () => `Freshness on it reads ${r.fresh}, ${r.basis === "book" ? "from the live book" : "from the last trade only"}. The board is ${f.span(h.ageSec)} old.`,
        ])),
    line("Sterling", ANIM.Sterling.arms!, pick(cx, near ? "hall.clock.sterling.near" : "hall.clock.sterling.far", near
      ? [
          () => `Near the end a price carries the latest news and has no time left to be wrong. The engine caps the letter in the last minutes.`,
          () => `Late in a contract's life the price is nearly all information. That is why the engine caps its letter near the close.`,
        ]
      : [
          () => `While there is time left a price can still be wrong, in either direction. The engine caps the letter only in the last minutes.`,
          () => `Hours out, nothing is settled and the price is a guess with a fee on it. The engine waits for the last minutes to cap the letter.`,
        ])),
  ]);
  return lines.length >= 3 ? { lines, moves: place(lines, AT_JUMBO) } : null;
}

/* ── The record ────────────────────────────────────────────────────────── */

const gainLoss = (x: number): string => (x > 0 ? "gain" : x < 0 ? "loss" : "flat");

export function exHallRecord(cx: Ctx, h: HallLite): Ex | null {
  const f = cx.f;
  const rec = h.record;
  if (!rec) return null;
  const min = h.rules.minSettled;
  const empty = rec.goN === 0 && rec.paperTickets === 0 && rec.jClosed === 0 && rec.jOpen === 0;
  const lines = compact([
    line("Nova", ANIM.Nova.analyze!, pick(cx, rec.goN === 0 ? "hall.record.nova.empty" : "hall.record.nova", rec.goN === 0
      ? [
          () => `The go ledger is empty. Nothing the scanner flagged has been recorded, so nothing has been tested.`,
          () => `No prints in the go ledger yet. The scanner has not flagged anything we kept.`,
        ]
      : [
          () => `The go ledger holds ${n(f, rec.goN, 0)} ${plural(rec.goN, "print")}: ${n(f, rec.goSettled, 0)} settled, ${n(f, rec.goWins, 0)} won, a net ${gainLoss(rec.goNet)} of ${f.usd(rec.goNet, 2)} per contract held to settlement.${rec.goSettled < min ? ` Under ${n(f, min, 0)} settled, that is noise.` : ""}`,
          () => `Go ledger: ${n(f, rec.goN, 0)} ${plural(rec.goN, "print")}, ${n(f, rec.goSettled, 0)} settled, ${n(f, rec.goWins, 0)} won. Net ${gainLoss(rec.goNet)} ${f.usd(rec.goNet, 2)} a contract at settlement.${rec.goSettled < min ? ` Below ${n(f, min, 0)} settled it is noise.` : ""}`,
        ])),
    line("Sterling", ANIM.Sterling.tablet!, pick(cx, "hall.record.sterling", [
      () => `The paper book has ${n(f, rec.paperTickets, 0)} ${plural(rec.paperTickets, "ticket")}, ${n(f, rec.paperOpen, 0)} open, ${n(f, rec.paperSettled, 0)} settled. ${rec.paperRead === "ok" && rec.paperHitPct != null ? `Hit rate ${n(f, rec.paperHitPct, 0)} percent.` : "The scorer says too few to read."}`,
      () => `Paper tickets: ${n(f, rec.paperTickets, 0)}, with ${n(f, rec.paperOpen, 0)} open and ${n(f, rec.paperSettled, 0)} settled. ${rec.paperRead === "ok" && rec.paperHitPct != null ? `The scorer reads a ${n(f, rec.paperHitPct, 0)} percent hit rate.` : "Too few to read."}`,
    ])),
    line("Vince", ANIM.Vince.watch!, pick(cx, "hall.record.vince", [
      () => `The journal has ${n(f, rec.jOpen, 0)} open and ${n(f, rec.jClosed, 0)} closed${rec.jClosed > 0 ? `, a net ${gainLoss(rec.jNet)} of ${f.usd(rec.jNet, 2)}` : ""}.`,
      () => `Our own fills in the journal: ${n(f, rec.jOpen, 0)} open, ${n(f, rec.jClosed, 0)} closed${rec.jClosed > 0 ? `, net ${gainLoss(rec.jNet)} ${f.usd(rec.jNet, 2)}` : ""}.`,
    ])),
    line("Jax", ANIM.Jax.shout!, pick(cx, empty ? "hall.record.jax.empty" : "hall.record.jax", empty
      ? [() => `So we know nothing yet.`, () => `Three empty books. Great.`]
      : [() => `So is it working or not?`, () => `Just tell me if the ledger is winning.`])),
    line("Gemma", ANIM.Gemma.explain!, pick(cx, "hall.record.gemma", [
      () => `A record only counts once it can be read. Until then the cents on these screens are a price list, not a result.`,
      () => `Under ${n(f, min, 0)} settled there is no result to read. There is only a price list and a count.`,
    ])),
  ]);
  return lines.length >= 4 ? { lines, moves: place(lines, AT_TABLE) } : null;
}

/* ── The headline ──────────────────────────────────────────────────────── */

/** A headline older than this is not read as news in the hall. */
export const HALL_NEWS_MAX_AGE_MS = 24 * 3_600_000;

export interface HallNewsLink {
  row: HallRowLite;
  news: NewsLite;
  score: number;
}

/**
 * The headline that shares the most subject with one of the six markets (the study pass's own rule: two points per shared word of five
 * letters or more, a stop list, a ticker written in the market's text). Below two points nothing links. A team code is never read: a
 * market on a Minnesota game is just an NFL market and a headline about Minnesota links by the word.
 */
export function bestNewsLink(h: HallLite, news: NewsLite[], nowMs: number): HallNewsLink | null {
  let best: HallNewsLink | null = null;
  for (const item of news) {
    // A headline with no time, or more than a day old, is not news to talk about.
    if (item.publishedMs == null || nowMs - item.publishedMs > HALL_NEWS_MAX_AGE_MS) continue;
    for (const r of h.rows) {
      const score = linkScore(r.famSay, r.outcome, item);
      if (score >= 2 && (!best || score > best.score || (score === best.score && (item.publishedMs ?? 0) > (best.news.publishedMs ?? 0)))) best = { row: r, news: item, score };
    }
  }
  return best;
}

export function exHallNews(cx: Ctx, _h: HallLite, link: HallNewsLink): Ex | null {
  const f = cx.f;
  const { row: r, news } = link;
  const lines = compact([
    line("Gemma", ANIM.Gemma.explain!, pick(cx, "hall.news.gemma", [
      () => `${t(f, news.source, 30)} has “${t(f, news.title, 90)}” It shares a subject with ${subj(f, r, 70)}.`,
      () => `From ${t(f, news.source, 30)}: “${t(f, news.title, 88)}” Same subject as ${subj(f, r, 70)}.`,
    ])),
    line("Jax", ANIM.Jax.shout!, pick(cx, "hall.news.jax", [
      () => `That is a story. I want to trade the story.`,
      () => `News! News moves lines!`,
    ])),
    line("Vince", ANIM.Vince.watch!, pick(cx, "hall.news.vince", [
      () => `By the time we read it the book has seen it${r.yesAskC != null ? `: yes asks ${c(f, r.yesAskC, 0)}` : ""}. The engine found no sign that Kalshi lags the news.`,
      () => `The cents${r.yesAskC != null ? `, ${c(f, r.yesAskC, 0)} on yes,` : ""} already carry whatever the wire knew. Nobody has shown a lag to trade.`,
    ])),
    line("Sterling", ANIM.Sterling.arms!, pick(cx, "hall.news.sterling", [
      () => `A headline is not a side. It is a reason to look at the price again.`,
      () => `A headline is not a side. Read the price, not the story.`,
    ])),
  ]);
  return lines.length >= 3 ? { lines, moves: place(lines, AT_BAR) } : null;
}

/* ── The lectern: when the hall would call a row worth a paper ticket ──── */

export function exHallLectern(cx: Ctx, h: HallLite): Ex | null {
  const f = cx.f;
  const r = h.rows[0];
  if (!r) return null;
  const k = r.condsMet;
  const edge = r.edge ? (r.edge.netC > 0 ? "positive" : "negative") : "none";
  const lines = compact([
    line("Sterling", ANIM.Sterling.arms!, pick(cx, "hall.lectern.sterling", [
      () => `The hall calls a row worth a paper ticket when four things hold: an independent model with a source and a time, an edge after fees and slippage, a quote fresh from the live book, and depth at the ask.`,
      () => `Four conditions, together: an outside model with a source and a time, a real edge after fees and slippage, a fresh quote from the live book, and depth at the ask. Not three.`,
    ])),
    line("Nova", ANIM.Nova.analyze!, pick(cx, "hall.lectern.nova", [
      () => `The numbers: a model no older than ${n(f, h.rules.modelMaxMin, 0)} minutes, a quote under ${n(f, h.rules.staleSec, 0)} seconds old, at least ${n(f, h.rules.minDepth, 0)} contracts at the ask, and a spread of ${c(f, h.rules.maxSpreadC, 0)} or less.`,
      () => `The engine's own limits: a model under ${n(f, h.rules.modelMaxMin, 0)} minutes old and a quote under ${n(f, h.rules.staleSec, 0)} seconds. The scanner wants ${n(f, h.rules.minDepth, 0)} contracts at the ask and no more than ${c(f, h.rules.maxSpreadC, 0)} of spread.`,
    ])),
    line("Vince", ANIM.Vince.watch!, pick(cx, "hall.lectern.vince", [
      () => `The jumbotron row, ${subj(f, r, 70)}: model ${r.conds.model ? "present" : "none"}, edge ${edge}, quote ${r.conds.fresh ? "fresh" : "stale"}, depth ${r.conds.depth ? "enough" : "short"}. ${n(f, k, 0)} of the four ${plural(k, "holds", "hold")}.`,
      () => `The jumbotron row meets ${n(f, k, 0)} of the four. Model ${r.conds.model ? "present" : "missing"}, edge ${edge}, quote ${r.conds.fresh ? "fresh" : "stale"}, depth ${r.conds.depth ? "enough" : "short"}.`,
    ])),
    line("Jax", ANIM.Jax.point!, pick(cx, "hall.lectern.jax", [
      () => `And when all four hold, I finally get my side?`,
      () => `Four out of four and I am allowed to lean?`,
    ])),
    line("Sterling", ANIM.Sterling.approve!, pick(cx, "hall.lectern.reply", [
      () => `You get a paper ticket. It is a list of conditions, not a forecast, and it can still lose.`,
      () => `You get paper, nothing else. Conditions are not a prediction, and a row that meets them can still lose.`,
    ])),
  ]);
  return lines.length >= 4 ? { lines, moves: place(lines, AT_JUMBO) } : null;
}

/* ── Games are on: the existing Mead line, now about an actual market ─── */

/** The old three-line exchange said only the rules. With a board it says what is on the jumbotron; without one it is unchanged. */
export function exMead(cx: Ctx, h: HallLite | null | undefined): Ex | null {
  if (!usable(h)) return exMeadPlain(cx);
  const f = cx.f;
  const r = h.rows[0]!;
  const lines = compact([
    line("Gemma", ANIM.Gemma.explain!, pick(cx, "hall.mead.gemma", [
      () => `Games are on. The jumbotron has ${subj(f, r)}${r.yesAskC != null ? `, yes asking ${c(f, r.yesAskC, 0)}` : ""}. The screen is paper.`,
      () => `Games are on and the hall is lit. ${subj(f, r)} is up top${r.yesAskC != null ? ` at ${c(f, r.yesAskC, 0)} on yes` : ""}. Paper, not a ticket.`,
    ])),
    line("Jax", ANIM.Jax.shout!, pick(cx, "hall.mead.jax", [
      () => `I want a side. Sterling is going to say no, and he is right about the broker.`,
      () => `A game is not a sweep. I can still say which way I think it breaks.`,
    ])),
    line("Sterling", ANIM.Sterling.arms!, pick(cx, "hall.mead.sterling", [
      () => `Paper only. A game does not touch the Robinhood book.`,
      () => `We can sit in the Mead Hall. We cannot send a game as a ticket.`,
    ])),
  ]);
  return lines.length >= 2 ? { lines, moves: place(lines, AT_JUMBO) } : null;
}

/* ── What the talk schedules ───────────────────────────────────────────── */

export interface MeadBeat {
  id: string;
  weight: number;
  sig: string;
  build: (c: Ctx) => Ex | null;
}

/** Coarse on purpose: the board is talked about again when the featured market changes or its price moves a few cents, not on every cent. */
const rowSig = (r: HallRowLite): string => `${r.id}|${r.yesAskC == null ? "" : Math.round(r.yesAskC / 3)}|${r.edge ? Math.round(r.edge.netC) : ""}|${r.grade ?? ""}`;

/**
 * The prediction talk the room offers while the options book is shut. A beat is offered only when its data is there and fresh enough to
 * speak from, and only when it has something NEW: never said under this signature (a signature carries the ET date, so a lesson is
 * offered once a day, and the featured market, its price in 3 cent steps, the unit of its settle time and the record's counts, so a
 * beat comes back when the thing it describes moved, never on a timer alone). A read too old to talk from offers one beat: that it is old.
 */
export function meadBeats(w: TalkWorld, st: TalkState): MeadBeat[] {
  const h = w.hall;
  const out: MeadBeat[] = [];
  if (!h) return out;
  const today = w.clock.etDate;
  const offer = (id: string, weight: number, sig: string, build: (cx: Ctx) => Ex | null) => {
    if (st.topicSig[`hb:${id}`] !== sig) out.push({ id, weight, sig, build });
  };
  if (h.old || h.rows.length === 0) {
    offer("hall:clock", 1.9, `${today}|${h.rows.length ? "old" : "empty"}|${h.held ? 1 : 0}`, (cx) => exHallClock(cx, h));
    return out;
  }
  offer("hall:board", 1.7, `${today}|${rowSig(h.rows[0]!)}`, (cx) => exHallBoard(cx, h));
  offer("hall:fee", 1.5, today, (cx) => exHallFee(cx, h));
  offer("hall:bins", 1.4, today, (cx) => exHallBins(cx, h));
  offer("hall:lectern", 1.35, today, (cx) => exHallLectern(cx, h));
  const model = h.rows.find((r) => r.edge != null);
  if (model) offer("hall:model", 1.65, `${today}|${rowSig(model)}`, (cx) => exHallModel(cx, h));
  const none = h.rows.find((r) => r.edge == null);
  if (none) offer("hall:nomodel", 1.55, `${today}|${none.id}|${h.noEdge}`, (cx) => exHallNoModel(cx, h));
  const next = nextToSettle(h);
  if (next) offer("hall:clock", 1.45, `${today}|${next.id}|${next.settle!.unit}|${next.phase}`, (cx) => exHallClock(cx, h));
  const rec = h.record;
  if (rec) offer("hall:record", 1.3, `${rec.goN}|${rec.goSettled}|${rec.goWins}|${rec.paperTickets}|${rec.paperSettled}|${rec.jOpen}|${rec.jClosed}`, (cx) => exHallRecord(cx, h));
  const link = bestNewsLink(h, w.news, w.nowMs);
  if (link) offer("hall:news", 1.6, `${link.news.id}|${link.row.id}`, (cx) => exHallNews(cx, h, link));
  return out;
}

/**
 * The hall reacting to its own crowd. Not a heartbeat: when the crowd's read changes the room should answer soon, not wait behind the
 * lessons. It is offered only when the engine has real velocity behind a surging or sliding mood (reaction is null otherwise), and
 * `sig` changes only when the mood, the mover or its speed (in 2 cent an hour steps) does.
 */
export function crowdOffer(h: HallLite): { sig: string; build: (cx: Ctx) => Ex | null } | null {
  const mover = moverOf(h);
  if (!mover || h.crowd.reaction == null) return null;
  return { sig: `${h.crowd.mood}|${mover.id}|${Math.round((mover.velCph ?? 0) / 2)}`, build: (cx) => exHallCrowd(cx, h) };
}
