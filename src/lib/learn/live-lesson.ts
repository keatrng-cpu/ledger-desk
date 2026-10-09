/**
 * The nine lessons, graded against the live tape.
 *
 * WHAT THIS IS FOR. The Learn tab was a localStorage checklist of prose that
 * nothing else in the app imported, so the desk could not teach and the
 * teaching could not be wrong in a way anybody would notice. These nine are
 * the conditions the desk ALREADY computes, each stated as the object, the
 * pass, and the tape that is not it — and each carrying a live `pass` / `wait`
 * / `fail` read off the detector that owns it.
 *
 * THE DETECTOR WINS. Every lesson names the file and function that owns its
 * test (`owner`) and calls exactly that function. If a lesson and its detector
 * ever disagree, the detector is right and the lesson is the bug. Nothing here
 * detects anything, scores anything, or gates anything:
 *
 *   - `SCHOOL_GATE.enabled` stays false and this is not a second one.
 *   - A checked box in the Learn tab is the trader's progress. It is not a
 *     permission and no ticket reads it.
 *   - The brain's word is still `smc-master.ts` gradeBook. A lesson only
 *     SPEAKS: it supplies the one sentence that explains the layer the grader
 *     already named as missing.
 *
 * `wait` versus `fail` is the whole distinction the old checklist could not
 * make: `wait` is absence of evidence (the third candle has not printed, the
 * window is still open, price has not come back to the array), and `fail` is
 * the tape having answered no.
 */

import { APLUS_RULES } from "../aplus/config";
import { detectMechanicalModel, mechanicalWindowBars } from "../trading/detectors";
import type { DeskPayload } from "../trading/build-desk";
import { evaluateOptionsDesk, ticketHolds, type OptionsDesk } from "../trading/options-desk";
import { RH_MAX_DEBIT_TOTAL, RH_MIN_DEBIT_TOTAL } from "../execution/rh-autofire-gates";
import { RH_SLEEVE_DEFAULT } from "../trading/options-sleeve";
import { extensionAllows, pairedDisplacement, polaritySweep, strongExtension } from "../trading/raid-pair";
import { isJudasWindow } from "../trading/sessions";
import { fourFacts, type FourFacts } from "../trading/ticket-facts";
import type { OhlcBar } from "../market/types";

export type LessonState = "pass" | "wait" | "fail";

export const LESSON_IDS = [
  "raid",
  "displacement",
  "inversion",
  "array",
  "draw",
  "half",
  "counter",
  "judas",
  "ask",
] as const;
export type LessonId = (typeof LESSON_IDS)[number];

export interface LessonDef {
  id: LessonId;
  title: string;
  /** What the thing IS. */
  object: string;
  /** What passing means. */
  pass: string;
  /** One wrong tape, and why it fails. */
  notIt: string;
  /** The file and function that owns the test. From .ai/locator.md. */
  owner: { file: string; fn: string };
  /**
   * The `smc-master.ts` must-layer ids this lesson explains, so the brain can
   * find the lesson for the layer it already named as missing. Empty when the
   * lesson explains something outside the sequence (the ask).
   */
  layers: string[];
}

export interface LiveLesson extends LessonDef {
  state: LessonState;
  /** The live tape behind that state, with its numbers. */
  live: string;
  /** One sentence a voice can say, or the brain can print under its word. */
  say: string;
}

/**
 * The nine, in the order they are learned and the order the tape prints them.
 *
 * The prose is the trader's own definitions, written down once so the floor,
 * the brain and the Learn tab quote the same words.
 */
export const LESSONS: readonly LessonDef[] = [
  {
    id: "raid",
    title: "The raid, and which side it arms",
    object:
      "A wick through a prior swing and a close back INSIDE that swing. A close that stays outside is a breakout, not a raid. Pools are a prior swing, equal highs or lows, the session high or low, and the prior-day high or low.",
    pass:
      "Sellside taken — a wick under a low, a close back above it — arms the LONG. Buyside taken arms the SHORT. The raid that names the trade is the latest one a later displacement has actually answered.",
    notIt:
      "A fresh tag of the other pool with nothing answering it. It does not erase the older raid and it is not a new trade. A raid of a minor pool while a more extreme swing is still unswept is a flag on the card, not a refusal.",
    owner: { file: "src/lib/trading/raid-pair.ts", fn: "namingSweep" },
    layers: ["sweep"],
  },
  {
    id: "displacement",
    title: "Displacement is a LATER close",
    object:
      "A later candle in the direction the raid armed: absolute open-to-close at least 1.5x the 14-bar average range, closing that way. Leaving a gap is recorded; under the default rule a gap alone is not the displacement.",
    pass:
      "Strictly AFTER the sweep, inside the tighter of 30 minutes and 6 bars of that series — 2 bars on the 15-minute, 6 on the 5- and 1-minute, 1 on the hour.",
    notIt:
      "The raid candle itself. It is the manipulation, not the shift. A big candle an hour and a half after the raid is a different story, not the answer to that raid.",
    owner: { file: "src/lib/trading/raid-pair.ts", fn: "pairedDisplacement" },
    layers: ["ltf"],
  },
  {
    id: "inversion",
    title: "Blake's inversion, not a new gap",
    object:
      "A gap created BEFORE the sweep, on the leg that ran into the pool. After the sweep a body closes through its far side, on the displacement bar or within the next two. That close is the entry.",
    pass:
      "The close through the far side. The stop is the low of the inversion candle on a long and the high on a short; a later close through that price invalidates. A return into the gap may be noted — it is not required.",
    notIt:
      "A gap the displacement LEFT. That is the other model. And the absence of a retest is not 'needs the mechanical model' — the body close already was the entry.",
    owner: { file: "src/lib/trading/detectors.ts", fn: "detectMechanicalModel" },
    layers: ["array"],
  },
  {
    id: "array",
    title: "The array entry, and the chase",
    object:
      "The gap or the order block the displacement left, created on that bar or within the next three. An older gap does not qualify, including one from the other side. The order is a limit at the midpoint.",
    pass:
      "Price is inside the zone plus a pad of a quarter of its height, or a quarter point, whichever is larger. For a long, price still ABOVE the array is in front of it: rest the limit.",
    notIt:
      "Price below the array on a long — the stop side. The retrace already went through, so a buy there is a chase. Through the stop and the idea is dead. An empty entry means displacement left no array: no ticket.",
    owner: { file: "src/lib/trading/entry-trigger.ts", fn: "readEntry" },
    layers: ["retrace", "array"],
  },
  {
    id: "draw",
    title: "The 1:1 draw",
    object:
      "The next pool in FRONT that has not traded — a low below for a short, a high above for a long. A pool already swept is not the draw. R is midpoint-to-pool over midpoint-to-stop.",
    pass: `The first target at or above the ${APLUS_RULES.minRr.toFixed(1)} to 1 floor. Taking 1 to 1 is a partial — the draw stays open and a close through the stop ends the trade.`,
    notIt:
      "Under 1.0 the target fails and there is no buy line. A pool behind price is not a target either, however close it is.",
    owner: { file: "src/lib/trading/trade-plan.ts", fn: "buildTradePlan" },
    layers: ["target", "dol"],
  },
  {
    id: "half",
    title: "Equilibrium versus a fighting half",
    object:
      "A long comes from the discount, a short from the premium. The midpoint is equilibrium: there is no half there, so it waits, and a high fit does not buy it.",
    pass:
      "The correct half. A premium or discount that FIGHTS the side is a note — but only after both the raid and the displacement have named that side.",
    notIt:
      "No dealing range at all. That is a fail, not a note: without a range there is no half to be in. And a fighting half before the raid and the displacement have printed still waits.",
    owner: { file: "src/lib/trading/smc-master.ts", fn: "gradeBook" },
    layers: ["pd_half"],
  },
  {
    id: "counter",
    title: "A disrespected higher timeframe",
    object:
      "Trading WITH the higher-timeframe read needs no release. A neutral higher timeframe is not a bias and is not a disrespect. A 15-minute body close through the opposing gap is structure changing hands before the swing break.",
    pass:
      "Against the frame is allowed only when a recent raid of this side's pool printed and a later displacement in this direction answered it. With the frame always passes.",
    notIt:
      "Fading a strong extension — about two average ranges in eight bars, one way — with no reversal, no change in delivery and no raid-plus-displacement of the fade's side inside those bars. Trading WITH the extension is allowed.",
    owner: { file: "src/lib/trading/htf-invalidation.ts", fn: "biasDisrespect" },
    layers: ["htf", "mtf"],
  },
  {
    id: "judas",
    title: "News spike versus the Judas window",
    object:
      "Two different rows. Judas is 09:30 to 09:45 ET only; outside it the clock does not block and does not cut size. A news blackout is about a release, at any hour.",
    pass:
      "Inside the window, the open has to RESOLVE: a raid that closed back inside, then a displacement after that raid in the trade's direction. After a release, the retest is a sweep that is no longer 'none' and a confirmation that is armed or confirmed — then the spike was the raid.",
    notIt:
      "Buying the opening spike. That is the refusal the window exists for. And a blackout with no retest is a stand, however good the card looks.",
    owner: { file: "src/lib/trading/judas-window.ts", fn: "readJudas" },
    layers: ["clean", "time"],
  },
  {
    id: "ask",
    title: `The $${RH_MIN_DEBIT_TOTAL}–$${RH_MAX_DEBIT_TOTAL} live ask`,
    object: `The debit is the live ask times 100 times the number of contracts, and it has to land from $${RH_MIN_DEBIT_TOTAL} to $${RH_MAX_DEBIT_TOTAL}.`,
    pass:
      "A real contract off a live chain read, priced at its own ask, inside the envelope — and the brain on this same book and not standing.",
    notIt:
      "A model price. It is not a contract, so it is not a buy button. An empty entry is not a ticket, and the brain standing, or standing on the other book, is not a ticket.",
    owner: { file: "src/lib/trading/options-desk.ts", fn: "ticketHolds" },
    layers: [],
  },
] as const;

export const LESSON_BY_ID: Record<LessonId, LessonDef> = Object.fromEntries(
  LESSONS.map((l) => [l.id, l]),
) as Record<LessonId, LessonDef>;

export interface LessonCtx {
  /** Which futures book to grade against. Defaults to the one-book leg. */
  leg?: "left" | "right";
  /**
   * The options book.
   *
   *   omitted  it is evaluated here on the DEFAULT sleeve, so a server render
   *            and a browser render of the same payload answer the same way.
   *   given    the caller's own book is used, so the tab and the lesson cannot
   *            price the same ticket differently.
   *   null     EXPLICITLY not read. The ask lesson then says so rather than
   *            guessing, which is what the floor wants: it only ever quotes
   *            the lesson for a SEQUENCE layer, and the ask has none.
   */
  options?: OptionsDesk | null;
}

function legOf(desk: DeskPayload, ctx?: LessonCtx): "left" | "right" {
  if (ctx?.leg) return ctx.leg;
  const one = desk.smcMaster.oneBook;
  if (one && one.symbol === desk.right.symbol) return "right";
  return "left";
}

function barsOf(desk: DeskPayload, leg: "left" | "right"): OhlcBar[] {
  return (leg === "left" ? desk.left.bars : desk.right.bars) ?? [];
}

/** The nine lessons with their live read, in the order above. */
export function readLiveLessons(desk: DeskPayload, ctx?: LessonCtx): LiveLesson[] {
  const leg = legOf(desk, ctx);
  const facts = fourFacts(desk, leg);
  const bars = barsOf(desk, leg);
  const book = leg === "left" ? desk.smcMaster.left : desk.smcMaster.right;
  // `in` rather than `??`: an explicit null means "do not read the options
  // book", and that is different from not having said anything about it.
  const options: OptionsDesk | null =
    ctx && "options" in ctx ? (ctx.options ?? null) : evaluateOptionsDesk(desk, RH_SLEEVE_DEFAULT);
  const reads: Record<LessonId, { state: LessonState; live: string; say: string }> = {
    raid: raidRead(facts),
    displacement: displacementRead(facts, bars),
    inversion: inversionRead(bars),
    array: arrayRead(facts),
    draw: drawRead(facts),
    half: halfRead(facts, book),
    counter: counterRead(facts, bars),
    judas: judasRead(desk, book),
    ask: askRead(desk, options),
  };
  return LESSONS.map((def) => ({ ...def, ...reads[def.id] }));
}

/* ── the nine reads ───────────────────────────────────────────────────── */

function raidRead(f: FourFacts): { state: LessonState; live: string; say: string } {
  const c = f.four[0]!;
  if (c.ok) return { state: "pass", live: c.detail, say: f.direction.text };
  if (!f.direction.raidSide) {
    return {
      state: "wait",
      live: c.detail,
      say: "No raid has closed back inside yet. A push with no pool taken is not a setup.",
    };
  }
  const arms = f.direction.raidSide === "sellside" ? "long" : "short";
  return {
    state: "fail",
    live: c.detail,
    say: `The answered raid arms the ${arms}, so this book is on the wrong side of it.`,
  };
}

function displacementRead(f: FourFacts, bars: OhlcBar[]): { state: LessonState; live: string; say: string } {
  const within = mechanicalWindowBars(bars);
  const dir = f.side === "long" ? "bull" : "bear";
  // POLARITY, not `namingSweep`. `namingSweep` only ever returns a raid a
  // displacement HAS answered, so measuring this lesson's window against it
  // would make the "window passed with nothing answering" case unreachable —
  // which is the one state this lesson exists to teach.
  const sweep = f.side ? polaritySweep(bars, dir) : null;
  if (!f.side || !sweep) {
    return {
      state: "wait",
      live: `No raid of this side's pool to answer. The window would be ${within} bar${within === 1 ? "" : "s"} of this series.`,
      say: "Nothing to displace away from yet — the raid comes first.",
    };
  }
  const disp = pairedDisplacement(bars, sweep, dir);
  if (disp) {
    return {
      state: "pass",
      live: `${dir === "bull" ? "Bullish" : "Bearish"} displacement closed at ${disp.close.toFixed(2)}, ${disp.ratio.toFixed(2)} times the 14-bar range, ${disp.index - sweep.index} bar${disp.index - sweep.index === 1 ? "" : "s"} after the raid (window ${within}). ${f.ltf.reason}`,
      say: `The displacement is the later close at ${disp.close.toFixed(2)}, not the raid candle.`,
    };
  }
  const since = bars.length - 1 - sweep.index;
  if (since > within) {
    return {
      state: "fail",
      live: `${since} bars since the raid with no qualifying close — the ${within}-bar window has passed. ${f.ltf.reason}`,
      say: "The window after that raid closed with no displacement. A later candle is a different story.",
    };
  }
  return {
    state: "wait",
    live: `${since} of ${within} bars used since the raid, no 1.5x body close yet. ${f.ltf.reason}`,
    say: "The raid is in. I am waiting for the later close, not the raid candle.",
  };
}

function inversionRead(bars: OhlcBar[]): { state: LessonState; live: string; say: string } {
  if (bars.length < 20) {
    return { state: "wait", live: "Not enough closed bars to read the model.", say: "Not enough tape for the inversion yet." };
  }
  const seq = detectMechanicalModel(bars);
  const zone = seq.zone;
  const where = zone ? `${zone.source} ${zone.bottom.toFixed(2)}–${zone.top.toFixed(2)}` : "no zone";
  if (seq.complete && seq.direction) {
    return {
      state: "pass",
      live: `Inverted ${where}; the body close is the entry. Direction ${seq.direction}${seq.retest ? `, and price has since been back in it at ${seq.retest.price.toFixed(2)} — noted, not required` : ", with no return into it — which is fine"}.`,
      say: `Blake's entry is the body close through ${where}. The retest is a note.`,
    };
  }
  if (!seq.alive && seq.invalidation) {
    return {
      state: "fail",
      live: `The sequence died: ${seq.invalidation.replace(/_/g, " ")}. Furthest state ${seq.state}, ${seq.ageBars} bars old.`,
      say: `The mechanical model is dead — ${seq.invalidation.replace(/_/g, " ")}.`,
    };
  }
  return {
    state: "wait",
    live: `State ${seq.state}${seq.sweep ? `, raid at ${seq.sweep.sweptLevel.toFixed(2)}` : ""}${seq.displacement ? `, displaced to ${seq.displacement.close.toFixed(2)}` : ""}. ${where}. A gap the displacement LEFT would be the other model, not this one.`,
    say: "No body close through a pre-raid gap yet. A new gap is the other model.",
  };
}

function arrayRead(f: FourFacts): { state: LessonState; live: string; say: string } {
  if (f.entry.px == null) {
    return {
      state: "fail",
      live: "No entry price — displacement left no array. No ticket.",
      say: "There is no array to rest at, so there is no ticket.",
    };
  }
  if (f.entry.inside) {
    return { state: "pass", live: f.entry.text, say: `Price is in the array. The limit rests at ${f.entry.px.toFixed(2)}.` };
  }
  if (f.entry.chase) {
    return { state: "fail", live: f.entry.text, say: `Price went through ${f.entry.px.toFixed(2)} on the stop side. Buying here is a chase.` };
  }
  return { state: "wait", live: f.entry.text, say: `Rest the limit at ${f.entry.px.toFixed(2)} and wait. Being in front of it is the normal state.` };
}

function drawRead(f: FourFacts): { state: LessonState; live: string; say: string } {
  if (f.target.px == null) {
    return { state: "wait", live: f.target.text, say: "No unswept pool in front of this entry, so there is no target yet." };
  }
  if (f.target.r == null) {
    return { state: "wait", live: f.target.text, say: "The target is priced but the stop is not, so R is unknown." };
  }
  if (f.target.pays) {
    return {
      state: "pass",
      live: f.target.text,
      say: `T1 is ${f.target.pool ?? "the next pool"} at ${f.target.px.toFixed(2)}, ${f.target.r.toFixed(2)}R. Taking 1:1 is a partial.`,
    };
  }
  return {
    state: "fail",
    live: f.target.text,
    say: `The draw is only ${f.target.r.toFixed(2)}R — under the floor, so the target fails and there is no buy line.`,
  };
}

function halfRead(
  f: FourFacts,
  book: { dealing: { zone: string; eq: number } | null; layers: { id: string; state: string }[] },
): { state: LessonState; live: string; say: string } {
  const d = book.dealing;
  if (!d) {
    return { state: "fail", live: "No dealing range at all — there is no half to be in.", say: "There is no dealing range, so there is no half. That is a fail, not a note." };
  }
  if (d.zone === "equilibrium") {
    return {
      state: "wait",
      live: `Price is at equilibrium ${d.eq.toFixed(2)} — no half, so it waits. A high fit does not buy it.`,
      say: "Equilibrium has no half. It waits, whatever the fit says.",
    };
  }
  const want = f.side === "long" ? "discount" : "premium";
  if (d.zone === want) {
    return { state: "pass", live: `${d.zone}, which is the ${f.side} half. Equilibrium ${d.eq.toFixed(2)}.`, say: `We are in the ${d.zone}, which is the half this ${f.side} comes from.` };
  }
  // The same two layers bcd0e928 demoted the half behind: the grader's own
  // `sweep` and `ltf`. Not the 1m-5m confirm, which is a different question.
  const layer = (id: string) => book.layers.find((l) => l.id === id)?.state ?? null;
  const named = layer("sweep") === "pass" && layer("ltf") === "pass";
  if (named) {
    return {
      state: "pass",
      live: `${d.zone} fights the ${f.side}, but the raid and the displacement have already named the side — so the half is a note, not a halt. Equilibrium ${d.eq.toFixed(2)}.`,
      say: `The ${d.zone} fights it, and the raid and the displacement already named the side. That is a note.`,
    };
  }
  return {
    state: "wait",
    live: `${d.zone} fights the ${f.side} and the raid and the displacement have not both printed. It still waits. Equilibrium ${d.eq.toFixed(2)}.`,
    say: `The ${d.zone} fights this side and the sequence is not named yet, so it waits.`,
  };
}

function counterRead(f: FourFacts, bars: OhlcBar[]): { state: LessonState; live: string; say: string } {
  const side = f.side;
  const ext = strongExtension(bars);
  const extOk = side ? extensionAllows(bars, side) : true;
  const extLine = ext ? ` Tape has extended ${ext} about two average ranges in eight bars.` : "";
  if (side && ext && !extOk) {
    return {
      state: "fail",
      live: `Fading a strong ${ext} extension with no reversal, no change in delivery and no raid-plus-displacement of the ${side} side inside those bars.${extLine}`,
      say: `This is fading a strong ${ext} run with nothing printed against it. Refused.`,
    };
  }
  if (f.counter.htf === "agrees") {
    return { state: "pass", live: `${f.counter.text}${extLine}`, say: "We are with the higher timeframe, so no release is needed." };
  }
  if (f.counter.htf === "unread") {
    return {
      state: "pass",
      live: `${f.counter.text}${extLine}`,
      say: "The higher timeframe is neutral. That is not a bias and it is not a disrespect.",
    };
  }
  if (f.counter.released) {
    return {
      state: "pass",
      live: `${f.counter.text}${extLine}`,
      say: "The higher timeframe points the other way and the desk released this side — raid, displacement, structure.",
    };
  }
  return {
    state: "fail",
    live: `${f.counter.text}${extLine}`,
    say: "We are against the higher timeframe with no release printed. That needs a raid of this side's pool and a later displacement answering it.",
  };
}

function judasRead(
  desk: DeskPayload,
  book: { layers: { id: string; state: string; detail: string }[] },
): { state: LessonState; live: string; say: string } {
  const clean = book.layers.find((l) => l.id === "clean");
  const inJudas = isJudasWindow(desk.clock.etHour, desk.clock.etMinute);
  const blackout = desk.news.verdict === "blackout";
  const live = `${inJudas ? "Inside 09:30–09:45 ET. " : "Outside the Judas window — the clock does not block and does not cut size. "}${blackout ? "News blackout is on. " : ""}${clean?.detail ?? "No sequence read."}`;
  if (!clean) return { state: "wait", live, say: "No sequence graded on this book yet." };
  if (clean.state === "pass") {
    return {
      state: "pass",
      live,
      say: inJudas
        ? "The open resolved: a raid closed back inside and a later bar displaced against it."
        : blackout
          ? "The print was the raid. The retest is the trade."
          : "The tape is tradable — neither the Judas window nor a release is in the way.",
    };
  }
  return {
    state: "fail",
    live,
    say: inJudas
      ? "The open has not resolved. Buying the spike is the refusal this window exists for."
      : "A blackout with no retest is a stand. The first impulse is the suspect one.",
  };
}

function askRead(desk: DeskPayload, options: OptionsDesk | null): { state: LessonState; live: string; say: string } {
  if (!options) {
    return {
      state: "wait",
      live: "The options book is not read on this surface, so there is no ask to check here.",
      say: "I am not pricing the contract from here.",
    };
  }
  const card = options.best;
  const t = card?.ticket ?? null;
  if (!card || !t) {
    return {
      state: "wait",
      live: `No handed ticket. ${options.focus}`,
      say: "There is no ticket on the board, so there is no ask to check.",
    };
  }
  const holds = ticketHolds(desk, card);
  const debit = t.estDebitTotal;
  const inEnvelope = debit >= RH_MIN_DEBIT_TOTAL && debit <= RH_MAX_DEBIT_TOTAL;
  const base = `${t.contracts} ${t.underlier} ${t.side} · ${t.pricedFrom === "live_chain" ? `live ask $${debit.toFixed(0)}` : `model $${debit.toFixed(0)} — not a contract`}`;
  if (t.pricedFrom !== "live_chain") {
    return {
      state: "wait",
      live: `${base}. A model price is a shape for the tab, never a buy button.`,
      say: "That debit is a model estimate, not a contract. No buy line.",
    };
  }
  if (!inEnvelope) {
    return {
      state: "fail",
      live: `${base} — outside $${RH_MIN_DEBIT_TOTAL}–$${RH_MAX_DEBIT_TOTAL}.`,
      say: `The live ask puts the debit at $${debit.toFixed(0)}, outside the envelope.`,
    };
  }
  if (holds.length) {
    return { state: "fail", live: `${base}. Held: ${holds.join(" ")}`, say: holds[0]! };
  }
  return {
    state: "pass",
    live: `${base}, inside the envelope, and the brain is on this book.`,
    say: `Live ask prices the debit at $${debit.toFixed(0)}, inside the envelope, on the book the brain is on.`,
  };
}

/* ── finding the lesson for a layer the grader already named ──────────── */

/**
 * The lesson that explains a must-layer, found by the layer's own id or by its
 * label. The brain names the layer; this turns that into the sentence.
 *
 * Matching on the LABEL as well as the id is deliberate: `SmcMasterBook.missing`
 * is the label, not the id, and the two have drifted before.
 */
export function lessonForLayer(lessons: LiveLesson[], layerIdOrLabel: string | null | undefined): LiveLesson | null {
  if (!layerIdOrLabel) return null;
  const needle = layerIdOrLabel.trim().toLowerCase();
  if (!needle) return null;
  const byId = lessons.find((l) => l.layers.some((x) => x === needle));
  if (byId) return byId;
  // The grader's labels, mapped to the layer ids they belong to. Any label it
  // can print has to land here or the brain prints no sentence at all.
  const LABELS: { re: RegExp; layer: string }[] = [
    { re: /sweep|liquidity/, layer: "sweep" },
    { re: /ltf|shift|displacement/, layer: "ltf" },
    { re: /premium|discount|half|poi/, layer: "pd_half" },
    { re: /target/, layer: "target" },
    { re: /draw on liquidity/, layer: "dol" },
    { re: /retrace/, layer: "retrace" },
    { re: /pd array/, layer: "array" },
    { re: /htf|bias/, layer: "htf" },
    { re: /mtf|middle/, layer: "mtf" },
    { re: /judas|news/, layer: "clean" },
    { re: /kill ?zone|window/, layer: "time" },
  ];
  const hit = LABELS.find((x) => x.re.test(needle));
  if (!hit) return null;
  return lessons.find((l) => l.layers.includes(hit.layer)) ?? null;
}

/** The first lesson that is failing, then the first waiting. What to teach now. */
export function nextLesson(lessons: LiveLesson[]): LiveLesson | null {
  return lessons.find((l) => l.state === "fail") ?? lessons.find((l) => l.state === "wait") ?? null;
}

/**
 * The one sentence for the layer the grader named as missing, without reading
 * the options book — what the floor and the brain quote.
 *
 * Returns null when the layer has no lesson (so a caller prints its own line
 * rather than an empty quote).
 */
export function sayForMissing(
  desk: DeskPayload,
  missing: string | null | undefined,
  leg?: "left" | "right",
): string | null {
  if (!missing) return null;
  const lesson = lessonForLayer(readLiveLessons(desk, { leg, options: null }), missing);
  return lesson?.say ?? null;
}
