/**
 * What the five say, and in whose voice.
 *
 * Fixed phrase banks, one exchange builder per kind of event. A builder is handed an event (already measured by
 * live-talk.ts) and returns the lines; it never decides WHETHER anything is said. Every number comes through
 * `Facts` as it is printed, so the verifier can prove the line quotes nothing the code did not produce.
 *
 * The voices are the desk schools (agents.ts / smc-canon.ts):
 *   Gemma    ICT      liquidity, raids, the draw, premium and discount — calm, a little lecturing.
 *   Jax      TJR      sweep then 5m confirm — impatient, quick to chase, quick to complain.
 *   Nova     Blake    numbers: probabilities, option dollars, calibration — dry.
 *   Sterling Patty    conditions, objectives, the mandate — the one who says no.
 *   Vince    SMC      POI, shift, retest, the limit at CE — the operator.
 *
 * Live RH awareness (Keaton 2026-10-06): when the desk is live-when-armed, seats
 * know the envelope — $150–$550 debit, 1–4 ATM/OTM_1, review_option_order then
 * place, Manager agentAgree as the Stand bit — via research shelf + meeting cites.
 *
 * Word choice is deterministic: a variant is picked from the event's own key and skips the one used last time
 * for that bank and anything said recently, so the same event is always worded the same way and two events
 * never are. When every variant has been used the line is dropped rather than repeated — a room with nothing
 * new to say goes quiet; it does not loop.
 */

import { ROOM_MANDATE } from "./mandate";
import { jobsFor } from "./brain-feed";
import { BLACKOUT_MIN } from "@/lib/news/schedule";
import { PATH_MONTH_CAP } from "@/lib/trading/profit-rules";
import { EXEC_LIMITS } from "./exec/limits";
import {
  ANIM,
  ATM_DELTA,
  Facts,
  hash32,
  norm,
  type CardRead,
  type Line,
  type LevelRef,
  type NewsLite,
  type PositionRead,
  type TalkMove,
  type TalkState,
  type TapeBook,
} from "./live-types";
import type { Animation, Character } from "./orchestrator";

export interface Ctx {
  st: TalkState;
  f: Facts;
  /** The event's own key: the same event always picks the same words. */
  key: string;
  now: number;
}

export interface Ex {
  lines: Line[];
  moves: Partial<Record<Character, TalkMove>>;
}

/**
 * Choose among thunks: never the variant used last time for this bank, never a text that was said recently.
 * Null when every variant is spent — the caller drops the line.
 */
export function pick(c: Ctx, bank: string, variants: (() => string)[]): string | null {
  const n = variants.length;
  if (!n) return null;
  const start = hash32(`${c.key}|${bank}`) % n;
  const last = c.st.variant[bank];
  for (let k = 0; k < n; k++) {
    const i = (start + k) % n;
    if (n > 1 && i === last) continue;
    const t = variants[i]!();
    if (c.st.recent.includes(norm(t))) continue;
    c.st.variant[bank] = i;
    return t;
  }
  return null;
}

export const line = (who: Character, anim: Animation, text: string | null): Line | null => (text ? { character: who, animation: anim, text } : null);
export const compact = (xs: (Line | null)[]): Line[] => xs.filter((x): x is Line => x !== null);

function recentSpeaks(st: TalkState, who: Character, now: number, windowMs = 6 * 60_000): number {
  return (st.spoke[who] ?? []).filter((t) => now - t <= windowMs).length;
}

/** Of two people who could speak, the one who has spoken less lately. */
export function lead(c: Ctx, a: Character, b: Character): Character {
  return recentSpeaks(c.st, a, c.now) <= recentSpeaks(c.st, b, c.now) ? a : b;
}

/**
 * Shorten a line to fit a bubble — and a breath. The cut is spoken aloud, so it must read as a finished thought: the last whole
 * sentence that fits (when it keeps at least half), else the last clause that fits (closed with a full stop), else the last word.
 * A parenthesis is never left open, and a number is never cut in two (the cut is always at a space).
 */
export const clip = (s: string, n: number): string => {
  if (s.length <= n) return s;
  const cut = s.slice(0, n);
  const closeParen = (t: string): string => {
    const open = t.lastIndexOf("(");
    return open > t.lastIndexOf(")") ? t.slice(0, open) : t;
  };
  const tidy = (t: string): string => closeParen(t).replace(/[\s,;:.\-–—]+$/, "");
  const sentence = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
  if (sentence >= n * 0.5) {
    const t = closeParen(cut.slice(0, sentence + 1)).trimEnd();
    if (t.length >= n * 0.4) return /[.!?]$/.test(t) ? t : `${tidy(t)}.`;
  }
  const clause = Math.max(cut.lastIndexOf(" — "), cut.lastIndexOf("; "), cut.lastIndexOf(", "), cut.lastIndexOf(": "));
  if (clause >= n * 0.6) {
    const t = tidy(cut.slice(0, clause));
    if (t.length >= n * 0.4) return `${t}.`;
  }
  const sp = cut.lastIndexOf(" ");
  return `${tidy(sp > n * 0.6 ? cut.slice(0, sp) : cut)}…`;
};

export const WB: TalkMove = { zone: "THE_WHITEBOARD" };
const BOARD: Ex["moves"] = { Gemma: WB, Jax: WB, Nova: WB, Sterling: WB, Vince: WB };

/** What a person does with their hands when they speak without anything in particular to act out. */
export const NEUTRAL: Record<Character, Animation> = {
  Gemma: ANIM.Gemma.explain!,
  Jax: ANIM.Jax.point!,
  Nova: ANIM.Nova.analyze!,
  Sterling: ANIM.Sterling.tablet!,
  Vince: ANIM.Vince.watch!,
};

export const signed = (n: number) => (n >= 0 ? "+" : "−");

/* ── The tape ──────────────────────────────────────────────────────────── */

export interface TapeData {
  b: TapeBook;
  dir: 1 | -1;
  pts: number;
  sec: number;
  atrX: number | null;
  big: boolean;
  /** The same move, again, after it doubled inside the cooldown. */
  again: boolean;
  /** The nearest pool in the direction of travel, with the distance left. */
  nearest: { name: string; price: number; dist: number; side: "above" | "below" } | null;
  /** A pool raided in the last few minutes. */
  raid: { name: string; agoSec: number } | null;
  held: PositionRead | null;
  heldAligned: boolean | null;
  heldStopDist: number | null;
  card: CardRead | null;
  /** The newest print's age: on a feed this far behind, the room says the move is old. */
  lagSec: number | null;
  /** Dollars per ATM contract at ATM_DELTA for this move, and for one ATR. */
  deltaUsd: number;
  atrUsd: number | null;
}

export function exTape(c: Ctx, d: TapeData): Ex | null {
  const f = c.f;
  const { b } = d;
  const up = d.dir > 0;
  const span = f.span(d.sec);
  const pts = f.pts(d.pts);
  const first = lead(c, "Jax", "Vince");
  const moves: Ex["moves"] = {};
  const lines: (Line | null)[] = [];

  if (first === "Jax") {
    lines.push(
      line(
        "Jax",
        d.big ? ANIM.Jax.shout! : ANIM.Jax.point!,
        d.again
          ? pick(c, up ? "tape.jax.again.up" : "tape.jax.again.dn", [
              () => `Still going — ${b.say} ${up ? "+" : "−"}${pts} now.`,
              () => `It hasn't stopped. ${pts} ${up ? "higher" : "lower"} and counting on ${b.say}.`,
              () => `That's ${pts} ${up ? "up" : "down"} and it's not done.`,
            ])
          : pick(
              c,
              up ? "tape.jax.up" : "tape.jax.dn",
              up
                ? [
                    () => `${b.say} just ripped ${pts} in ${span}. Look at that.`,
                    () => `${pts} up in ${span} on ${b.say}. Somebody's in a hurry.`,
                    () => `Whoa — ${b.say} +${pts} in ${span}. I'm watching the 5m close.`,
                    () => (d.big ? `${b.say} ${pts} points in ${span}. That's not a drift.` : `${b.say} ${pts} higher in ${span}. It's waking up.`),
                    () => `${b.say} is lifting — ${pts} in ${span}. Tell me that's not a sweep.`,
                  ]
                : [
                    () => `${b.say} just dumped ${pts} in ${span}.`,
                    () => `${b.say} −${pts} in ${span}. Who's selling?`,
                    () => `${pts} off ${b.say} in ${span} — I'd be short already.`,
                    () => (d.big ? `${b.say} fell ${pts} in ${span}. That's not a drift either.` : `${b.say} ${pts} lower in ${span}. Heavy.`),
                    () => `${b.say} is leaking — ${pts} in ${span}. Somebody knows something.`,
                  ],
            ),
      ),
    );
    if (d.big) moves.Jax = WB;
  } else {
    lines.push(
      line(
        "Vince",
        ANIM.Vince.watch!,
        pick(c, d.again ? "tape.vince.again" : "tape.vince.open", d.again
          ? [() => `${b.say} ${up ? "+" : "−"}${pts}, and still going. Noted.`, () => `It keeps going: ${pts} ${up ? "up" : "down"} on ${b.say}.`]
          : [
              () => `${b.say} ${up ? "+" : "−"}${pts} in ${span}. Noted.`,
              () => `${b.say} is moving: ${pts} ${up ? "up" : "down"} in ${span}.`,
              () => `${pts} ${up ? "higher" : "lower"} on ${b.say} in ${span}. I'm on it.`,
              () => `${b.say} ${up ? "bid" : "offered"} — ${pts} in ${span}. I'm watching what it takes.`,
            ]),
      ),
    );
  }

  // The frame: what the move is, structurally. A move that came off a raid is said as that, and only that.
  const frame = d.raid
    ? pick(c, "tape.gemma.raid", [
        () => `That came off the ${f.raw(d.raid!.name)} raid ${f.span(d.raid!.agoSec)} ago. That's the sequence starting, not a chase.`,
        () => `The ${f.raw(d.raid!.name)} raid ${f.span(d.raid!.agoSec)} ago is what this is the reaction to. Raid, then delivery.`,
        () => `Raid on ${f.raw(d.raid!.name)}, then this. ${f.span(d.raid!.agoSec)} apart — that's the order the sequence wants.`,
      ])
    : pick(c, "tape.gemma", [
        ...(d.atrX != null && d.nearest
          ? [
              () => `${f.x(d.atrX!)} ATR in ${span} is displacement. ${f.raw(d.nearest!.name)} ${f.lvl(d.nearest!.price)} is the draw — ${f.pts(d.nearest!.dist)} pts ${d.nearest!.side}.`,
              () => `That's ${f.x(d.atrX!)} ATR. The pool in its path is ${f.raw(d.nearest!.name)} at ${f.lvl(d.nearest!.price)}, ${f.pts(d.nearest!.dist)} pts ${d.nearest!.side}.`,
            ]
          : []),
        () => `No pool taken behind it. A move without a raid isn't a setup.`,
        () => `I don't see what it raided. Displacement without a raid is just a move.`,
        ...(d.atrX != null
          ? [() => `${f.x(d.atrX!)} ATR. An expansion leg — what I want to see is what it took.`, () => `${f.x(d.atrX!)} ATR in ${span}. That's a leg, not noise.`]
          : [() => `Expansion leg. I want to see what it took.`]),
        ...(d.nearest ? [() => `Next pool is ${f.raw(d.nearest!.name)} at ${f.lvl(d.nearest!.price)}, ${f.pts(d.nearest!.dist)} pts ${d.nearest!.side}. That's where it's pointed.`] : []),
      ]);
  const quantLine = pick(c, "tape.nova", [
    () => `At delta ${f.raw(String(ATM_DELTA))} that's about ${f.usd(d.deltaUsd)} a contract on an ATM ${b.u}${d.atrUsd != null ? `; one ATR is ${f.usd(d.atrUsd)}` : ""}.`,
    () => `${b.u} ATM, one DTE: roughly ${f.usd(d.deltaUsd)} a contract for that move${d.atrUsd != null ? `. A full ATR would be ${f.usd(d.atrUsd)}` : ""}.`,
    () => `In option terms: about ${f.usd(d.deltaUsd)} a contract on the ${b.u} ATM.${d.atrUsd != null ? ` A whole ATR is worth ${f.usd(d.atrUsd)}.` : ""}`,
  ]);

  // The guard or the operator: where we stand against it.
  let stand: string | null = null;
  let standBy: Character = "Sterling";
  if (d.held) {
    const p = d.held.plan;
    stand = pick(
      c,
      d.heldAligned ? "tape.held.with" : "tape.held.against",
      d.heldAligned
        ? [
            () => `We hold ${f.int(d.held!.contracts)}× ${f.raw(d.held!.name)}. This favors it${p ? ` — the level is ${f.lvl(p.stop)}, ${b.say} is ${f.lvl(b.px)}` : ""}. The plan hasn't changed.`,
            () => `It's moving our way on ${f.raw(d.held!.name)}. Doesn't change the exits: level first${p ? `, ${f.lvl(p.stop)}` : ""}.`,
            () => `Good for ${f.raw(d.held!.name)}. Good isn't a reason to touch it.`,
          ]
        : [
            () => `This is against ${f.raw(d.held!.name)}${p ? `. Level is ${f.lvl(p.stop)}${d.heldStopDist != null ? `, ${f.pts(d.heldStopDist)} pts away` : ""}` : ""}. I'm watching the level, not the move.`,
            () => `Against the position. ${p ? `The exit is the level at ${f.lvl(p.stop)}` : "The exit is the level"} — nothing else gets a vote.`,
            () => `${f.raw(d.held!.name)} is on the wrong side of this${p && d.heldStopDist != null ? `; ${f.pts(d.heldStopDist)} pts to the level` : ""}. We don't negotiate with the stop.`,
          ],
    );
  } else if (d.card) {
    const k = d.card;
    stand = pick(c, "tape.card", [
      () => `${f.raw(k.name)} is the card${k.tier ? `, ${k.tier}` : ""}${k.entry != null ? `, CE ${f.lvl(k.entry)}` : ""}${k.awayPts != null ? `, ${f.pts(k.awayPts)} pts` : ""}. I have it.`,
      () => `Card's ${f.raw(k.name)}. It doesn't have to move again for me to see it.`,
      () => `${k.tier === "live" ? "We're at the array." : k.tier ? `The card is ${k.tier}.` : "The card is on the board."} That's the one.`,
    ]);
    standBy = "Sterling";
  } else {
    stand = pick(c, "tape.none", [
      () => `Board's empty. No card up.`,
      () => `Nothing graded. A move isn't a card until the board prints one.`,
      () => `No card on the board. I'll call it the moment one lands.`,
    ]);
  }
  if (!d.held && d.lagSec != null && d.lagSec >= 90) {
    stand = pick(c, "tape.stale", [
      () => `That print is ${f.span(d.lagSec!)} old. I don't act on old tape.`,
      () => `The feed is ${f.span(d.lagSec!)} behind — this already happened.`,
    ]);
    standBy = "Sterling";
  }

  // What came off a raid is Gemma's to say; a violent move is hers too.
  const second: Character = d.raid || (d.atrX != null && d.atrX >= 0.5) ? "Gemma" : lead(c, "Gemma", "Nova");
  if (second === "Gemma") {
    lines.push(line("Gemma", d.raid || d.nearest ? ANIM.Gemma.wall! : ANIM.Gemma.explain!, frame));
    if (d.raid || d.nearest) moves.Gemma = WB;
  } else {
    lines.push(line("Nova", ANIM.Nova.analyze!, quantLine ?? frame));
  }
  lines.push(line(standBy, standBy === "Sterling" ? (d.held && !d.heldAligned ? ANIM.Sterling.arms! : ANIM.Sterling.tablet!) : ANIM.Vince.watch!, stand));
  const out = compact(lines);
  return out.length >= 2 ? { lines: out, moves } : null;
}

/* ── Levels ────────────────────────────────────────────────────────────── */

export interface LevelData {
  b: TapeBook;
  lv: LevelRef;
  kind: "sweep" | "approach" | "accept";
  /** For a sweep: which side was raided; for approach/accept: where the level is relative to price. */
  side: "high" | "low";
  through?: number;
  agoSec?: number;
  dist?: number;
  beyond?: number;
  holdSec?: number;
  card: CardRead | null;
  held: PositionRead | null;
}

export function exLevel(c: Ctx, d: LevelData): Ex | null {
  const f = c.f;
  const { b, lv } = d;
  const name = f.raw(lv.name);
  const moves: Ex["moves"] = { Gemma: WB };
  const lines: (Line | null)[] = [];
  const word = b.smcWord;
  if (d.kind === "sweep") {
    const hi = d.side === "high";
    lines.push(
      line(
        "Gemma",
        ANIM.Gemma.wall!,
        pick(c, "lvl.sweep.gemma", [
          () =>
            hi
              ? `${name} ${f.lvl(lv.price)} just got raided — ${f.pts(d.through ?? 0)} pts through, back inside ${f.span(d.agoSec ?? 0)} later. Buy stops taken.`
              : `${name} ${f.lvl(lv.price)} swept — ${f.pts(d.through ?? 0)} pts under, back above. Sell stops gone.`,
          () => `${b.say} took ${name} ${f.lvl(lv.price)} and came back${hi ? " down" : " up"}. That's the raid.`,
          () => `${hi ? "Buy" : "Sell"} stops at ${name} ${f.lvl(lv.price)} are gone — ${f.pts(d.through ?? 0)} pts through and rejected.`,
        ]),
      ),
    );
    lines.push(
      line(
        "Jax",
        ANIM.Jax.shout!,
        pick(c, "lvl.sweep.jax", [
          () => `There's the sweep! Now give me the 5m confirm.`,
          () => `Raid on ${name}. I want the shift, then I'm in.`,
          () => `${name} gone. Who's got the retest?`,
          () => `Sweep and snap. This is my favorite part.`,
        ]),
      ),
    );
    const aligned = d.card && ((d.card.futSide === "long") === !hi);
    if (aligned && d.card && d.card.entry != null) {
      lines.push(
        line(
          "Vince",
          ANIM.Vince.watch!,
          pick(c, "lvl.sweep.vince.card", [
            () => `That's the raid the ${d.card!.futSide} wants. CE ${f.lvl(d.card!.entry!)}${d.card!.awayPts != null ? `, ${f.pts(d.card!.awayPts)} pts` : ""}.`,
            () => `The sweep is on our side of the card. Displacement next, then the retest into ${f.lvl(d.card!.entry!)}.`,
          ]),
        ),
      );
    } else {
      lines.push(
        line(
          "Vince",
          ANIM.Vince.watch!,
          pick(c, "lvl.sweep.vince", [
            () => `A sweep isn't a POI. I need the displacement and the shift behind it.`,
            () => `Raid done. Next on my list: displacement, then MSS, then the retest.`,
            () => `The raid is the first line of the sequence. I'm reading the second.`,
          ]),
        ),
      );
    }
    lines.push(
      line(
        "Sterling",
        ANIM.Sterling.tablet!,
        pick(c, "lvl.sweep.sterling", [
          () => `${b.say} sequence says ${word ?? "wait"}${b.smcMissing ? `: ${f.raw(clip(b.smcMissing, 70))}` : ""}. A raid is one layer.`,
          () => `One layer of the sequence. Sequence or stand.`,
          () => `A raid by itself isn't a trade. The rest has to print.`,
        ]),
      ),
    );
  } else if (d.kind === "approach") {
    lines.push(
      line(
        "Gemma",
        ANIM.Gemma.explain!,
        pick(c, "lvl.app.gemma", [
          () => `${name} ${f.lvl(lv.price)} is ${f.pts(d.dist ?? 0)} pts ${d.side === "high" ? "above" : "below"}. That's the next draw — price wants it.`,
          () => `${b.say} is leaning on ${name} ${f.lvl(lv.price)}, ${f.pts(d.dist ?? 0)} pts ${d.side === "high" ? "up" : "down"}. ${d.side === "high" ? "Buy stops" : "Sell stops"} sit there.`,
          () => `Closing on ${name}: ${f.pts(d.dist ?? 0)} pts to ${f.lvl(lv.price)}. That's liquidity it wants to take.`,
        ]),
      ),
    );
    lines.push(
      line(
        "Jax",
        ANIM.Jax.point!,
        pick(c, "lvl.app.jax", [
          () => `If it takes ${name} and snaps back, I'm in. If it just goes through, I'm not.`,
          () => `Take the ${name}, then show me the rejection.`,
          () => `Come on, tag it. Then reverse.`,
        ]),
      ),
    );
    lines.push(
      line(
        "Sterling",
        ANIM.Sterling.arms!,
        pick(c, "lvl.app.sterling", [
          () => `A touch isn't a signal. Acceptance beyond it isn't a raid.`,
          () => `Get there first. Then we talk about it.`,
          () => `Price near a level is information. It isn't permission.`,
        ]),
      ),
    );
  } else {
    lines.push(
      line(
        "Gemma",
        ANIM.Gemma.explain!,
        pick(c, "lvl.acc.gemma", [
          () => `${b.say} has held ${f.pts(d.beyond ?? 0)} pts ${d.side === "high" ? "above" : "below"} ${name} for ${f.span(d.holdSec ?? 0)}. That's acceptance, not a raid.`,
          () => `${name} ${f.lvl(lv.price)} didn't get rejected. ${f.span(d.holdSec ?? 0)} beyond it — that's a break.`,
          () => `It went through ${name} and stayed. ${f.span(d.holdSec ?? 0)} and counting — a break.`,
        ]),
      ),
    );
    lines.push(
      line(
        "Jax",
        ANIM.Jax.shout!,
        pick(c, "lvl.acc.jax", [() => `It didn't come back. I hate when it doesn't come back.`, () => `So that's the move, then?`, () => `No snapback. Fine. Fine.`]),
      ),
    );
    const against = d.card && ((d.card.futSide === "long") === (d.side === "low"));
    lines.push(
      line(
        "Sterling",
        ANIM.Sterling.tablet!,
        pick(c, "lvl.acc.sterling", [
          () => (against ? `A break against the card's side is a flag, not a ticket.` : `Acceptance changes the draw, not the rules.`),
          () => `Break noted. Nothing in the sequence says go.`,
          () => `A level that breaks is a level that changed. The mandate didn't.`,
        ]),
      ),
    );
  }
  const out = compact(lines);
  return out.length >= 2 ? { lines: out, moves } : null;
}

/* ── News ──────────────────────────────────────────────────────────────── */

export interface NewsData {
  n: NewsLite;
  ageMin: number | null;
  /** The tape since the headline (or since it was seen), if the ring spans it. */
  tape: { b: TapeBook; dir: 1 | -1; pts: number; sec: number; atrX: number | null } | null;
  vix: number | null;
  tenYear: number | null;
}

function agoText(f: Facts, ageMin: number | null): string {
  if (ageMin == null) return "just in";
  if (ageMin < 2) return "just now";
  if (ageMin < 120) return `${f.mins(ageMin)} ago`;
  return `${f.int(ageMin / 60)} h ago`;
}

export function exNews(c: Ctx, d: NewsData): Ex | null {
  const f = c.f;
  const { n } = d;
  const has = (t: string) => n.topics.includes(t);
  const title = f.raw(clip(n.title, 110));
  const tier = f.int(n.tier);
  const lines: (Line | null)[] = [];
  lines.push(
    line(
      "Sterling",
      ANIM.Sterling.tablet!,
      pick(c, n.tier === 1 ? "news.sterling.1" : "news.sterling.2", n.tier === 1
        ? [
            () => `${n.source}, ${agoText(f, d.ageMin)}: “${title}”. Tier ${tier} — ${f.raw(clip(n.why, 70))}.`,
            () => `On the wire — ${n.source}: “${title}”. ${n.primary ? "Primary source. " : ""}It's on the list because ${f.raw(clip(n.why, 70))}.`,
            () => `Reading ${n.source} (${agoText(f, d.ageMin)}): “${title}”.`,
          ]
        : [
            () => `Context, ${n.source}: “${title}”.`,
            () => `${n.source}, ${agoText(f, d.ageMin)}: “${title}”. Context, not a trigger.`,
            () => `Tier ${tier} from ${n.source}: “${title}”. Background.`,
          ]),
    ),
  );
  let react: Line | null = null;
  if (n.impact) {
    react = line("Nova", ANIM.Nova.analyze!, pick(c, "news.impact", [() => f.raw(clip(n.impact!, 150))]));
  } else if (has("fed") || has("rates")) {
    react = line(
      "Gemma",
      ANIM.Gemma.explain!,
      pick(c, "news.rates", [
        () => (d.tenYear != null ? `Rates headlines hit NQ first. The ten-year is ${f.raw(d.tenYear.toFixed(2))}%.` : `Rates headline. NQ is the rate-sensitive one.`),
        () => `Fed words move the front end first, then NQ. I watch the ten-year against it.`,
        () => `Anything on rates reprices NQ before ES. I want the yield on the wall.`,
      ]),
    );
  } else if (has("inflation") || has("jobs")) {
    react = line(
      "Nova",
      ANIM.Nova.analyze!,
      pick(c, "news.macro", [
        () => (d.vix != null ? `Scheduled-macro topic. IV leans into the print, not after it. VIX is ${f.raw(d.vix.toFixed(1))}.` : `Scheduled-macro topic. IV leans into the print, not after it.`),
        () => `Macro words, not a print. The number is what reprices the rate path.`,
        () => `Inflation and jobs talk moves the rate path. The options see it before the tape does.`,
      ]),
    );
  } else if (has("geopolitics") || has("trade")) {
    react = line(
      "Jax",
      ANIM.Jax.shout!,
      pick(c, "news.risk", [
        () => (d.vix != null ? `Risk-off headline. VIX is ${f.raw(d.vix.toFixed(1))} — if it jumps, the shorts get paid.` : `Risk-off headline. If the VIX jumps, the shorts get paid.`),
        () => `Tariffs and wars, again. Semis first, then NQ.`,
        () => `Geopolitics. The tape either shrugs or it doesn't. Let's see which.`,
      ]),
    );
  } else {
    react = line("Jax", ANIM.Jax.point!, pick(c, "news.generic", [() => `Anything for the tape?`, () => `Does it move anything or is it just noise?`, () => `Is that supposed to matter?`]));
  }
  lines.push(react);
  if (d.tape) {
    const t = d.tape;
    const small = t.atrX != null && t.atrX < 0.1;
    lines.push(
      line(
        "Vince",
        ANIM.Vince.watch!,
        pick(c, small ? "news.tape.flat" : "news.tape.move", small
          ? [() => `Tape hasn't blinked — ${t.b.say} ${f.pts(t.pts)} in ${f.span(t.sec)}.`, () => `Nothing on the tape yet. ${t.b.say} ${f.pts(t.pts)} in ${f.span(t.sec)}.`, () => `${t.b.say} shrugged: ${f.pts(t.pts)} in ${f.span(t.sec)}.`]
          : [
              () => `Tape: ${t.b.say} ${t.dir > 0 ? "up" : "down"} ${f.pts(t.pts)} in ${f.span(t.sec)}${t.atrX != null ? ` — ${f.x(t.atrX)} ATR` : ""}.`,
              () => `${t.b.say} is ${t.dir > 0 ? "higher" : "lower"} by ${f.pts(t.pts)} over ${f.span(t.sec)}.`,
              () => `The tape's reacting: ${t.b.say} ${t.dir > 0 ? "+" : "−"}${f.pts(t.pts)} in ${f.span(t.sec)}.`,
            ]),
      ),
    );
  }
  if (n.tier === 1) {
    lines.push(
      line(
        "Sterling",
        ANIM.Sterling.arms!,
        pick(c, "news.close", [() => `No change to the ticket.`, () => `Headlines don't place orders here.`, () => `Noted. Gates stay as they are.`, () => `The mandate doesn't read the news.`]),
      ),
    );
  }
  const out = compact(lines);
  // Sterling reads at the news wall, in the war room.
  return out.length >= 2 ? { lines: out, moves: { Sterling: WB } } : null;
}

export function exNewsBatch(c: Ctx, items: NewsLite[]): Ex | null {
  const f = c.f;
  if (items.length < 2) return null;
  const top = items.slice(0, 3).map((n) => `“${f.raw(clip(n.title, 60))}”`);
  const lines = compact([
    line(
      "Sterling",
      ANIM.Sterling.tablet!,
      pick(c, "news.batch", [
        () => `${f.int(items.length)} more in context, none tier 1: ${top.join("; ")}.`,
        () => `Context pile: ${f.int(items.length)} headlines. ${top.join("; ")}.`,
        () => `Background reading, ${f.int(items.length)} items: ${top.join("; ")}.`,
      ]),
    ),
    line("Jax", ANIM.Jax.point!, pick(c, "news.batch.jax", [() => `Scroll. Nothing's on fire.`, () => `Background noise. Ping me when it's tier 1.`, () => `If it matters, it'll move the tape.`])),
  ]);
  return lines.length >= 2 ? { lines, moves: { Sterling: WB } } : null;
}

export function exNewsCatchUp(c: Ctx, items: NewsLite[], hours: number): Ex | null {
  const f = c.f;
  const top = items[0];
  if (!top) return null;
  const lines = compact([
    line(
      "Sterling",
      ANIM.Sterling.tablet!,
      pick(c, "news.catch", [
        () => `Catching up: ${f.int(items.length)} tier-1 headline${items.length === 1 ? "" : "s"} in the last ${f.int(hours)} hours. Newest: “${f.raw(clip(top.title, 90))}” (${top.source}).`,
        () => `While nobody was looking: ${f.int(items.length)} tier-1 item${items.length === 1 ? "" : "s"}. The newest is “${f.raw(clip(top.title, 90))}” from ${top.source}.`,
      ]),
    ),
    line("Gemma", ANIM.Gemma.explain!, pick(c, "news.catch.gemma", [() => `Anything that explains where price is, I want on the wall.`, () => `Read them against the tape, not the other way round.`, () => `Overnight news is why the range looks the way it does.`])),
  ]);
  return lines.length >= 2 ? { lines, moves: { Sterling: WB } } : null;
}

/* ── The calendar ──────────────────────────────────────────────────────── */

export interface CalData {
  name: string;
  timeEt: string;
  impact: "high" | "medium";
  step: number;
  minutes: number;
  note: string | null;
  actual: string | null;
  vs: string | null;
  tape: { b: TapeBook; dir: 1 | -1; pts: number; sec: number; atrX: number | null } | null;
  blackout: boolean;
  vix: number | null;
  held: boolean;
}

export function exCalendar(c: Ctx, d: CalData): Ex | null {
  const f = c.f;
  const name = f.raw(d.name);
  const bo = f.int(BLACKOUT_MIN);
  const lines: (Line | null)[] = [];
  if (d.step === 60) {
    lines.push(
      line("Sterling", ANIM.Sterling.tablet!, pick(c, "cal.60.sterling", [
        () => `${name} at ${f.raw(d.timeEt)} ET — ${f.mins(d.minutes)}. News cuts the size. It does not take the card off.`,
        () => `${f.mins(d.minutes)} to ${name}. The print changes the size, not whether an A-minus can work.`,
        () => `Calendar: ${name}, ${f.raw(d.timeEt)} ET. ${f.mins(d.minutes)} out. The chart still calls it.`,
      ])),
    );
    lines.push(
      line("Gemma", ANIM.Gemma.explain!, d.note
        ? pick(c, "cal.60.note", [() => `The plan's note on it: “${f.raw(clip(d.note!, 130))}”`])
        : pick(c, "cal.60.gemma", [() => `The first impulse after a release is suspect. We wait for the retest.`, () => `Releases raid both sides before they pick one. I'd rather watch.`, () => `Everyone will have a view on the number. The tape will have the only one that matters.`])),
    );
    lines.push(line("Jax", ANIM.Jax.shout!, pick(c, "cal.60.jax", [() => `${f.mins(d.minutes)}. I'm flat. Look at me being patient.`, () => `Another one of these. I'll believe the move when it holds.`, () => `Last time I traded the print I bought a lesson.`])));
  } else if (d.step === 5 || d.step === 1) {
    lines.push(
      line("Sterling", ANIM.Sterling.arms!, pick(c, `cal.${d.step}.sterling`, d.step === 5
        ? [() => `${f.mins(d.minutes)} to ${name}. Size comes in. The ticket stays if the gaps agree.`, () => `${name} in ${f.mins(d.minutes)}. We don't stand the card down for the clock.`, () => `${f.mins(d.minutes)}. The chart is still the call.`]
        : [() => `${f.mins(d.minutes)}. ${name}. Size only.`, () => `Last minute. An armed card is not cancelled by the print.`, () => `One minute out. The gaps still decide.`])),
    );
    lines.push(
      line("Vince", ANIM.Vince.watch!, pick(c, `cal.${d.step}.vince`, [
        () => (d.held ? `We're holding through it — the level stands; the exits are mechanical.` : `Nothing resting. A new A-minus still works. The print only cuts size.`),
        () => `News is a size cut for ${bo} minutes either side. It is not a veto.`,
        () => (d.held ? `Position's on. The level is the only thing that can close it.` : `Flat into the print is a choice. An armed card is not cancelled.`),
      ])),
    );
    if (d.step === 5) {
      lines.push(
        line("Nova", ANIM.Nova.analyze!, pick(c, "cal.5.nova", [
          () => (d.vix != null ? `Option spreads widen into the print; VIX is ${f.raw(d.vix.toFixed(1))}. I'm not pricing anything through it.` : `Option spreads widen into the print. I'm not pricing anything through it.`),
          () => `The model can price the option. It can't price the spread on the second after the number.`,
        ])),
      );
    }
  } else if (d.step === 0) {
    lines.push(
      line("Nova", ANIM.Nova.analyze!, d.actual
        ? pick(c, "cal.0.print", [() => `${name}: ${f.raw(d.actual!)}${d.vs ? ` — ${f.raw(d.vs)}` : ""}.`, () => `The print: ${name} ${f.raw(d.actual!)}${d.vs ? `, ${f.raw(d.vs)}` : ""}.`])
        : pick(c, "cal.0.noprint", [() => `${name} is out. No actual stamped yet — I read the tape, not a headline.`, () => `It's printed. Nobody's stamped the number, so the tape is all I have.`])),
    );
    if (d.tape) {
      lines.push(
        line("Gemma", ANIM.Gemma.explain!, pick(c, "cal.0.tape", [
          () => `${d.tape!.b.say} ${d.tape!.dir > 0 ? "+" : "−"}${f.pts(d.tape!.pts)} in ${f.span(d.tape!.sec)} since the print${d.tape!.atrX != null ? ` — ${f.x(d.tape!.atrX)} ATR` : ""}.`,
          () => `First reaction: ${d.tape!.b.say} ${d.tape!.dir > 0 ? "up" : "down"} ${f.pts(d.tape!.pts)} in ${f.span(d.tape!.sec)}.`,
        ])),
      );
    }
    lines.push(line("Jax", ANIM.Jax.shout!, pick(c, "cal.0.jax", [() => `Here we go!`, () => `Don't chase it. Don't chase it. Okay, look at that.`, () => `And there it is. Everybody's wrong for about ten seconds.`])));
  } else {
    lines.push(
      line("Gemma", ANIM.Gemma.wall!, d.tape
        ? pick(c, "cal.5p.gemma", [
            () => `First impulse is in: ${d.tape!.b.say} ${d.tape!.dir > 0 ? "up" : "down"} ${f.pts(d.tape!.pts)}${d.tape!.atrX != null ? ` (${f.x(d.tape!.atrX)} ATR)` : ""}. I wait for the retest.`,
            () => `${f.pts(d.tape!.pts)} ${d.tape!.dir > 0 ? "up" : "down"} on ${d.tape!.b.say} since the number. That's the Judas until proven otherwise.`,
          ])
        : pick(c, "cal.5p.none", [() => `Five minutes after ${name}. The first impulse is suspect — retest or nothing.`])),
    );
    lines.push(line("Jax", ANIM.Jax.point!, pick(c, "cal.5p.jax", [() => `Chasing it?`, () => `Tell me that's not the Judas.`, () => `Is it real or is it the fake? Ask me in ten minutes.`])));
    lines.push(
      line("Sterling", ANIM.Sterling.arms!, pick(c, "cal.5p.sterling", [
        () => (d.blackout ? `The print is in the window. Size is cut. The card is not dead.` : `The window's over. Size goes back. The rules don't get looser.`),
        () => (d.blackout ? `Still inside it. That changes the size, not the side.` : `The window's closed. We didn't stand down for it.`),
      ])),
    );
  }
  const out = compact(lines);
  return out.length >= 2 ? { lines: out, moves: d.step === 60 || d.step === 0 ? { Gemma: WB } : {} } : null;
}

/* ── Session marks ─────────────────────────────────────────────────────── */

export interface SessData {
  id: string;
  b: TapeBook | null;
  gapPts: number | null;
  positions: number;
  monthEntries: number;
  dayPnl: number;
  winsToday: number;
  closedToday: number;
  killzoneLabel: string;
  rangeUsedPct: number | null;
  weekTrade: string | null;
  consecLosses: number;
}

export function exSession(c: Ctx, d: SessData): Ex | null {
  const f = c.f;
  const b = d.b;
  const cap = f.int(PATH_MONTH_CAP);
  const px = b ? `${b.say} ${f.lvl(b.px)}` : null;
  const gap = d.gapPts != null ? `${signed(d.gapPts)}${f.pts(d.gapPts)} on yesterday's close` : null;
  const lines: (Line | null)[] = [];
  switch (d.id) {
    case "globex_open":
      lines.push(line("Sterling", ANIM.Sterling.tablet!, pick(c, "sess.globex.sterling", [() => `Globex is open${px ? `. ${px}` : ""}. Options are shut — the tape is for reading, not trading.`, () => `The futures are trading again${px ? `: ${px}` : ""}. We read; we don't trade the night.`])));
      lines.push(line("Gemma", ANIM.Gemma.explain!, pick(c, "sess.globex.gemma", [() => `Asia builds the range. London takes one side of it. That's the order I watch.`, () => `The first prints set the tone. I want to see who gets raided first.`, () => `Overnight is where tomorrow's pools get written.`])));
      break;
    case "pre_open":
      lines.push(line("Sterling", ANIM.Sterling.tablet!, pick(c, "sess.pre.sterling", [() => `Thirty minutes to the bell. PATH count ${f.int(d.monthEntries)}/${cap} this month.`, () => `Pre-open. ${f.int(d.monthEntries)} of ${cap} PATH entries used this month${d.consecLosses ? `, ${f.int(d.consecLosses)} straight loss${d.consecLosses === 1 ? "" : "es"}` : ""}.`])));
      lines.push(line("Gemma", ANIM.Gemma.wall!, pick(c, "sess.pre.gemma", [() => `${px ? `${px}${gap ? `, ${gap}` : ""}. ` : ""}Where does the open raid first?`, () => `Name the pool the open will take, before it takes it.`, () => `Two candidates for the first raid. I'm watching both.`])));
      lines.push(line("Jax", ANIM.Jax.shout!, pick(c, "sess.pre.jax", [() => `Coffee, then the bell.`, () => `Thirty minutes. I'm going to behave.`, () => `Whatever it does at nine-thirty, don't let me chase it.`])));
      break;
    case "open":
      lines.push(line("Vince", ANIM.Vince.watch!, pick(c, "sess.open.vince", [() => `Bell. ${px ? `${px}${gap ? `, ${gap}` : ""}.` : "We're open."}`, () => `We're open${px ? ` — ${px}` : ""}.`])));
      lines.push(line("Sterling", ANIM.Sterling.arms!, pick(c, "sess.open.sterling", [() => `Judas window: the raid gets a name. Size stays the desk size. A card whose direction agrees still places.`, () => `The first fifteen minutes are the raid. They do not cut size, and they do not take a ticket off.`])));
      lines.push(line("Jax", ANIM.Jax.point!, pick(c, "sess.open.jax", [() => `Whatever it does, it'll fake first.`, () => `First fifteen minutes lie. I'll just watch.`, () => `Ring it. Let's see who it hurts.`])));
      break;
    case "judas_end":
      lines.push(line("Gemma", ANIM.Gemma.explain!, pick(c, "sess.judas.gemma", [() => `${f.hhmm(9 * 60 + 45)}. The open's manipulation window is closed — what it raided is the story now.`, () => `The Judas swing has had its fifteen minutes. Now we read what it left behind.`])));
      lines.push(line("Sterling", ANIM.Sterling.tablet!, pick(c, "sess.judas.sterling", [() => `Gates are live. Everything else is the same.`, () => `The gates are open to a card. They're not open to a hunch.`])));
      break;
    case "aplus":
      lines.push(line("Sterling", ANIM.Sterling.arms!, pick(c, "sess.aplus.sterling", [() => `${f.hhmm(10 * 60)}. Size comes down from here. B+ to A+ still trade if the chart agrees.`, () => `After ${f.hhmm(10 * 60)} the ticket is smaller. The clock does not cancel a setup.`])));
      lines.push(line("Vince", ANIM.Vince.watch!, pick(c, "sess.aplus.vince", [() => `${f.int(d.positions)} open. ${f.int(d.monthEntries)}/${cap} PATH this month.`, () => `${d.positions ? `${f.int(d.positions)} on the book` : "Flat"}, ${f.int(d.monthEntries)} of ${cap} PATH used.`])));
      break;
    case "flat":
      lines.push(line("Sterling", ANIM.Sterling.approve!, pick(c, "sess.flat.sterling", [() => `${f.hhmm(11 * 60)}. Lunch. Size comes down. We keep looking until the close.`, () => `${f.hhmm(11 * 60)} is not a stop. A card that clears still gets a ticket.`])));
      lines.push(line("Jax", ANIM.Jax.shout!, pick(c, "sess.flat.jax", [() => `Lunch doesn't mean we stop looking.`, () => `I'm still on the chart. A setup is a setup.`, () => `Eleven o'clock. Smaller size. Same job.`])));
      break;
    case "flatten":
      lines.push(line("Sterling", ANIM.Sterling.arms!, pick(c, "sess.flatten.sterling", [() => `${f.hhmm(15 * 60 + 30)}. The broker force-sells expiring contracts from here. ${d.positions ? `We hold ${f.int(d.positions)}. Out.` : "We're flat."}`, () => `Last-resort flatten time, ${f.hhmm(15 * 60 + 30)}. ${d.positions ? `${f.int(d.positions)} open — closing.` : "Nothing to close."}`])));
      break;
    case "close":
      lines.push(line("Sterling", ANIM.Sterling.tablet!, pick(c, "sess.close.sterling", [() => `Cash close. Day ${signed(d.dayPnl)}${f.usd(d.dayPnl)}, ${f.int(d.winsToday)} of ${f.int(d.closedToday)} closed trades green.`, () => `Bell. The day is ${signed(d.dayPnl)}${f.usd(d.dayPnl)}${d.closedToday ? ` over ${f.int(d.closedToday)} closed` : ", no trades"}.`])));
      lines.push(line("Nova", ANIM.Nova.analyze!, pick(c, "sess.close.nova", [() => `I'll score the plans against what the tape did. Calibration doesn't care how we felt.`, () => `Now the plans get graded against the tape. That's the part I like.`])));
      break;
    case "halt":
      lines.push(line("Gemma", ANIM.Gemma.explain!, pick(c, "sess.halt.gemma", [() => `Globex halt. The tape goes dark for an hour — a clean break between today's range and tomorrow's.`, () => `The daily halt: an hour of no prints. Whatever's unresolved stays unresolved.`])));
      lines.push(line("Sterling", ANIM.Sterling.tablet!, pick(c, "sess.halt.sterling", [() => `Use it. Tomorrow's plan, not tonight's opinion.`, () => `Write down what you'd do differently. Tonight, not tomorrow.`])));
      break;
    case "week_close":
      lines.push(line("Sterling", ANIM.Sterling.tablet!, pick(c, "sess.week.sterling", [() => `Globex is shut for the weekend. The tape is frozen${px ? ` at ${px}` : ""}. Nothing to trade until Sunday ${f.hhmm(18 * 60)}.`, () => `That's the week. The futures reopen Sunday at ${f.hhmm(18 * 60)}.`])));
      lines.push(line("Gemma", ANIM.Gemma.explain!, pick(c, "sess.week.gemma", [() => `Weekend is for the week-ahead restamp and the month plan. Real levels, no invented ones.`, () => `The week's high and low are written. Next week's plan starts from them.`])));
      break;
    default:
      return null;
  }
  const out = compact(lines);
  return out.length >= 1 ? { lines: out, moves: {} } : null;
}

export interface KillzoneData {
  label: string;
  b: TapeBook | null;
  rangeUsedPct: number | null;
}

export function exKillzone(c: Ctx, d: KillzoneData): Ex | null {
  const f = c.f;
  const lines = compact([
    line("Gemma", ANIM.Gemma.explain!, pick(c, "kz.gemma", [
      () => `${d.label} is on.${d.b && d.rangeUsedPct != null ? ` ${d.b.say} has used ${f.pct(d.rangeUsedPct)} of a median session's range.` : ""}`,
      () => `${d.label} starts. Who's raided, and who hasn't been yet?`,
      () => `${d.label}. The window where the raids get delivered.`,
    ])),
    line("Vince", ANIM.Vince.watch!, pick(c, "kz.vince", [() => `Window's open. The sequence decides, not the clock.`, () => `Killzone's a time, not a signal.`, () => `A window is permission to look. It isn't permission to trade.`])),
  ]);
  return lines.length >= 2 ? { lines, moves: {} } : null;
}

/* ── The book and the card ─────────────────────────────────────────────── */

export interface PnlData {
  p: PositionRead;
  b: TapeBook | null;
  up: boolean;
}

export function exPnl(c: Ctx, d: PnlData): Ex | null {
  const f = c.f;
  const { p } = d;
  const pct = f.pct(p.pnlPct, 0);
  const nm = f.raw(p.name);
  const lines = compact([
    line("Vince", ANIM.Vince.watch!, pick(c, "pnl.vince", d.up
      ? [
          () => `${nm} is +${pct}.${d.b && p.plan ? ` ${d.b.say} ${f.lvl(d.b.px)}; level ${f.lvl(p.plan.stop)}${p.plan.t1 != null ? `, T1 ${f.lvl(p.plan.t1)}` : ""}.` : ""}`,
          () => `${nm} up ${pct}. Exits don't change because it's green.`,
          () => `Green: ${nm} +${pct}. The plan is the same plan.`,
        ]
      : [
          () => `${nm} is −${pct}.${d.b && p.plan ? ` ${d.b.say} ${f.lvl(d.b.px)}; level ${f.lvl(p.plan.stop)}.` : ""}`,
          () => `${nm} down ${pct}. The level is the exit, not the feeling.`,
          () => `Red: ${nm} −${pct}. The level hasn't been touched.`,
        ])),
    line("Sterling", ANIM.Sterling.arms!, pick(c, "pnl.sterling", d.up
      ? [() => `The room trims half at +${f.int(ROOM_MANDATE.takeProfitPct)}% on the option. Not before.`, () => `Green isn't a reason to touch it.`, () => `Trim at +${f.int(ROOM_MANDATE.takeProfitPct)}%. Until then it's a position, not a feeling.`]
      : [() => `Backstop is −${f.int(Math.abs(ROOM_MANDATE.hardStopPct))}% — behind the level, never in front of it.`, () => `Nothing to do until the level or the backstop says so.`, () => `A loss inside the plan is a cost of business.`])),
    line("Jax", d.up ? ANIM.Jax.shout! : ANIM.Jax.point!, pick(c, d.up ? "pnl.jax.up" : "pnl.jax.dn", d.up ? [() => `Take some off! …No? Fine.`, () => `That's what I said.`, () => `Yes! Don't touch it. Don't touch it.`] : [() => `It'll come back. It always comes back.`, () => `Come on, hold the level.`, () => `I'm not looking at it. I'm looking at it.`])),
  ]);
  return lines.length >= 2 ? { lines, moves: {} } : null;
}

export interface NearData {
  p: PositionRead;
  b: TapeBook;
  which: "stop" | "t1";
  dist: number;
  level: number;
}

export function exNear(c: Ctx, d: NearData): Ex | null {
  const f = c.f;
  const nm = f.raw(d.p.name);
  const lines = compact(
    d.which === "stop"
      ? [
          line("Sterling", ANIM.Sterling.arms!, pick(c, "near.stop.sterling", [
            () => `${d.b.say} is ${f.pts(d.dist)} pts from the level on ${nm}, ${f.lvl(d.level)}. If it goes through, we're out. No negotiating.`,
            () => `${f.pts(d.dist)} pts to the level on ${nm}. It either holds or it doesn't; I don't have a third answer.`,
          ])),
          line("Jax", ANIM.Jax.shout!, pick(c, "near.stop.jax", [() => `Hold. Hold. Come on.`, () => `That's too close for my heart.`, () => `Don't you dare.`])),
          line("Vince", ANIM.Vince.watch!, pick(c, "near.stop.vince", [() => `Exits are mechanical. ${f.lvl(d.level)} and I'm already gone.`, () => `The exit is armed at ${f.lvl(d.level)}. It doesn't need me.`])),
        ]
      : [
          line("Vince", ANIM.Vince.watch!, pick(c, "near.t1.vince", [
            () => `${d.b.say} is ${f.pts(d.dist)} pts from T1 ${f.lvl(d.level)}. The room trims on the option at +${f.int(ROOM_MANDATE.takeProfitPct)}%, not on the level.`,
            () => `T1 ${f.lvl(d.level)} is ${f.pts(d.dist)} pts away. The trim is +${f.int(ROOM_MANDATE.takeProfitPct)}% on the option — the level is the plan, not the exit.`,
          ])),
          line("Jax", ANIM.Jax.shout!, pick(c, "near.t1.jax", [() => `Take the money!`, () => `It's right there. Right there.`, () => `Sell it, sell it, sell it. …Fine, rules.`])),
          line("Sterling", ANIM.Sterling.tablet!, pick(c, "near.t1.sterling", [() => `The rule is the rule. The T1 trim measured worse than leaving the runner.`, () => `Measured, not felt: banking at T1 cost more than it saved.`])),
        ],
  );
  return lines.length >= 2 ? { lines, moves: d.which === "stop" ? { Jax: WB } : {} } : null;
}

export interface TierData {
  card: CardRead;
  from: string | null;
  to: string;
  b: TapeBook | null;
}

export function exTier(c: Ctx, d: TierData): Ex | null {
  const f = c.f;
  const k = d.card;
  const lines: (Line | null)[] = [];
  const j = jobsFor({
    symbol: k.futSymbol,
    side: k.futSide,
    sequence: k.sequence ?? k.tier,
    entryLine: k.entrySay?.trim() || k.entryLine,
    missing: k.block,
    target: k.t1,
    pT1: k.pT1,
    expR: k.expR,
    schools: k.schools,
  });
  if (d.from != null) {
    // The card was read out in full when it first appeared (the schools, the target, the book's record). A step from one tier to the
    // next says only what changed: where it is now, where the entry is, what is still missing — never the same briefing again.
    const pxs = (n: number) => (Number.isInteger(n) ? f.raw(n.toLocaleString("en-US")) : f.px(n)); // 29,960 not 29,960.00: nobody says "point zero zero"
    const ce = k.entry != null ? ` CE ${pxs(k.entry)}${k.stop != null ? `, stop ${pxs(k.stop)}` : ""}.` : "";
    lines.push(line("Vince", ANIM.Vince.watch!, `${f.raw(k.futSymbol)} ${k.futSide}, ${f.raw(d.from)} to ${f.raw(d.to)}.${ce}`));
    lines.push(line("Jax", ANIM.Jax.point!, f.raw(k.delivery ? `${k.delivery} ${j.watch}` : j.watch)));
    if (k.entryLine?.trim()) lines.push(line("Sterling", ANIM.Sterling.tablet!, f.raw(j.entry)));
    if (j.draw || j.odds) lines.push(line("Nova", ANIM.Nova.analyze!, f.raw([j.draw, j.odds].filter(Boolean).join(" "))));
    return { lines: compact(lines), moves: j.place || d.to === "live" ? BOARD : {} };
  }
  // Each seat opens with its own school's read of THIS card (ICT Gemma, TJR Jax, Blake Nova, Patty Sterling), then the job it already had.
  // The static canon recital and the book record are not read out on every card: the brain holds them (desk-atlas: smc:*, bt:book).
  const mine = (who: string) => (j.school[who] ? `${j.school[who]} ` : "");
  const graded = Object.keys(j.school).length > 0;
  lines.push(line("Vince", ANIM.Vince.watch!, f.raw(j.setup)));
  lines.push(line("Gemma", ANIM.Gemma.explain!, f.raw(graded ? `${mine("Gemma")}${j.draw || j.target}` : j.target)));
  // The delivery comes first: a card the lower timeframes are not delivering is said to wait before anything else about it is said.
  lines.push(line("Jax", ANIM.Jax.point!, f.raw(`${k.delivery ? `${k.delivery} ` : ""}${mine("Jax")}${j.watch}`)));
  // Nova also gives what the ledger remembers: the last graded 0.90-plus cards of this model and side, and whether passing was right.
  lines.push(line("Nova", ANIM.Nova.analyze!, f.raw(graded ? `${mine("Nova")}${j.odds}${k.recall ? ` ${k.recall}` : ""}`.trim() : j.book)));
  // PB's map first when there is one: the 1 hour / 4 hour sponsored gap, and whether the 1 to 5 minute inverse printed inside it.
  lines.push(line("Sterling", ANIM.Sterling.tablet!, f.raw(`${k.sponsored ? `${k.sponsored} ` : ""}${mine("Sterling")}${j.entry}`)));
  return { lines: compact(lines), moves: j.place || d.to === "live" ? BOARD : {} };
}

/** Price is near the entry drawn on the whiteboard. They gather and decide. */
export function exAtEntry(c: Ctx, d: { card: CardRead }): Ex | null {
  const f = c.f;
  const k = d.card;
  const seq = k.sequence ?? "";
  const stand = seq.startsWith("STAND") || seq.startsWith("BIAS") || seq.startsWith("DRAW") || seq.startsWith("ENTRY GONE");
  const agree = seq.startsWith("ENTER") && k.tier === "live";
  const away = k.awayPts != null ? `${f.pts(Math.abs(k.awayPts))} pts from the entry` : "at the entry";
  const lines: (Line | null)[] = [
    line("Gemma", ANIM.Gemma.explain!, `${f.raw(k.futSymbol)} ${k.futSide}. Price is ${away}. The ladder is on the board.`),
    line("Jax", agree ? ANIM.Jax.shout! : ANIM.Jax.point!, k.delivery ? f.raw(k.delivery) : stand ? "This is not the fill. The raid does not get the order." : "Watch the entry. We do not swing before it prints."),
    line("Sterling", stand ? ANIM.Sterling.tablet! : ANIM.Sterling.approve!, stand ? "The card and the desk do not agree. Nobody places." : agree ? "The card and the desk agree." : "Not yet. The array has not been touched."),
    line("Nova", ANIM.Nova.analyze!, k.pT1 != null ? `If it fills, P(T1) ${f.frac(k.pT1)}${k.expR != null ? `, E[R] ${signed(k.expR)}${Math.abs(k.expR).toFixed(2)}` : ""}.` : "No priced T1. Do not invent one."),
    line(
      "Vince",
      agree ? ANIM.Vince.enter! : ANIM.Vince.watch!,
      agree
        ? "Price is in the array. Agentic places the month ticket if the account gates are already clear. We stay on the board and watch it."
        : "Hands off the key until price is in the array and the card still says enter.",
    ),
  ];
  return { lines: compact(lines), moves: BOARD };
}

/** An open ticket. They stay at the board and manage it off the same ladder. */
export function exManage(c: Ctx, d: { p: PositionRead }): Ex | null {
  const f = c.f;
  const p = d.p;
  const stop = p.plan?.stop != null ? f.lvl(p.plan.stop) : "the stop";
  const t1 = p.plan?.t1 != null ? f.lvl(p.plan.t1) : "the draw";
  const lines: (Line | null)[] = [
    line("Vince", ANIM.Vince.watch!, `${f.raw(p.name)} is on. Stop ${stop}. Target ${t1}. We manage it here.`),
    line("Gemma", ANIM.Gemma.explain!, "The ladder is the trade. Eyes on the entry we filled, not the next one."),
    line("Jax", ANIM.Jax.point!, p.pnlPct >= 0 ? "Let it work. Don't yank it." : "It's against us. The stop is the stop."),
    line("Nova", ANIM.Nova.analyze!, `${p.contracts} on. ${signed(p.pnlPct)}${Math.abs(p.pnlPct).toFixed(1)}% from the fill.`),
    line("Sterling", p.pnlPct <= -15 ? ANIM.Sterling.tablet! : ANIM.Sterling.approve!, p.pnlPct <= -15 ? "If it tags the stop, it is done. No add." : "Size stays. We do not add while it is open."),
  ];
  return { lines: compact(lines), moves: BOARD };
}

export function exFill(c: Ctx, d: { p: PositionRead; b: TapeBook | null }): Ex | null {
  const f = c.f;
  const side = d.p.type === "CALL" ? "calls" : "puts";
  const entry = d.p.plan?.entry != null ? f.lvl(d.p.plan.entry) : null;
  const lines = compact([
    line("Vince", ANIM.Vince.watch!, pick(c, "fill.vince", [
      () => `We're in. ${f.int(d.p.contracts)} ${d.p.u} ${side}${entry ? `, from ${entry}` : ""}. ${f.raw(d.p.name)}.`,
      () => `Filled. ${f.int(d.p.contracts)} ${d.p.u} ${side}. It's on the book.`,
    ])),
    line("Sterling", ANIM.Sterling.approve!, pick(c, "fill.sterling", [
      () => `Said and sent. The stop is the level. We do not add.`,
      () => `We're in. One plan, one fill.`,
    ])),
    line("Jax", ANIM.Jax.shout!, pick(c, "fill.jax", [() => `We're in! Hands off it.`, () => `That's the fill. Don't touch it.`])),
    line("Gemma", ANIM.Gemma.explain!, pick(c, "fill.gemma", [
      () => `Entry was the array. If this one had already left, we would have waited for the pullback.`,
      () => `On the board: filled at the spot, not at a chase.`,
    ])),
  ]);
  return lines.length >= 2 ? { lines, moves: BOARD } : null;
}

export interface LessonHit {
  id: string;
  who: Character;
  text: string;
  kind: string;
  verdict: string;
  pnl: string;
}

/** A graded winner or loser becomes a drill. Everyone hears the number. */
export function exLesson(c: Ctx, d: { hit: LessonHit }): Ex | null {
  const f = c.f;
  const good = d.hit.verdict === "right" || d.hit.verdict === "saved" || d.hit.kind === "win";
  const num = d.hit.pnl;
  const what = f.raw(d.hit.text);
  const who = d.hit.who;
  const lines = compact([
    line("Gemma", ANIM.Gemma.explain!, pick(c, "lesson.gemma", [
      () => `${who} ${good ? "won" : "lost"} ${num}. Paper. The chart ${good ? "paid the side" : "did the other thing"}. We learn the tape.`,
      () => `Shelf. ${what}. ${num}. Everyone look at it.`,
    ])),
    line("Vince", ANIM.Vince.watch!, pick(c, "lesson.vince", [
      () => good
        ? `Entry was the spot. We repeat that. We do not move the order because it worked once.`
        : `Entry was late or it was a chase. Next one rests at CE. We do not buy the extension.`,
    ])),
    line("Nova", ANIM.Nova.analyze!, pick(c, "lesson.nova", [
      () => good
        ? `Target held. ${num}. The draw was real. We do not stretch T1 to feel clever.`
        : `Target did not pay. ${num}. Analytics stays the number on the card, not a new story.`,
    ])),
    line("Sterling", ANIM.Sterling.tablet!, pick(c, "lesson.sterling", [
      () => `Arithmetic. ${num} on paper. A winner does not buy a bigger next ticket. A loser does not get averaged.`,
      () => `${num}. Size stays inside the debit. That is the whole improvement.`,
    ])),
    line("Jax", ANIM.Jax.point!, pick(c, "lesson.jax", [
      () => good ? `I'll take the ${num}. I still don't get to skip the retest.` : `That's mine. ${num}. Next entry is the array. I'm not chasing it.`,
    ])),
  ]);
  return lines.length >= 2 ? { lines, moves: BOARD } : null;
}

/** Once a day the floor reads the shelf out loud so a winner and a loser are not private. */
export function exShelf(c: Ctx, d: { wins: string[]; losses: string[] }): Ex | null {
  if (!d.wins.length && !d.losses.length) return null;
  const f = c.f;
  const win = f.raw(d.wins[0] ?? "none");
  const loss = f.raw(d.losses[0] ?? "none");
  const lines = compact([
    line("Gemma", ANIM.Gemma.explain!, pick(c, "shelf.gemma", [
      () => `Trophy wall. Winner: ${win}. Loser: ${loss}. Paper, both of them. Everyone knows.`,
      () => `Look at the shelf. ${win}. And the scar: ${loss}.`,
    ])),
    line("Nova", ANIM.Nova.analyze!, pick(c, "shelf.nova", [
      () => `We keep the winner's target and we throw out the loser's story. The number is the teacher.`,
    ])),
    line("Vince", ANIM.Vince.watch!, pick(c, "shelf.vince", [
      () => `Entries. The winner filled at the spot. The loser is why we wait for the pullback.`,
    ])),
    line("Sterling", ANIM.Sterling.tablet!, pick(c, "shelf.sterling", [
      () => `Arithmetic does not care who called it. ${win} does not raise size. ${loss} does not get a second ticket.`,
    ])),
    line("Jax", ANIM.Jax.point!, pick(c, "shelf.jax", [
      () => `I see both. I'll chase the process, not the last print.`,
    ])),
  ]);
  return lines.length >= 2 ? { lines, moves: BOARD } : null;
}

export interface GhostData {
  gate: string;
  n: number;
  usd: number;
  wins: number;
}

export function exGhost(c: Ctx, d: GhostData): Ex | null {
  const f = c.f;
  const gain = d.usd > 0;
  const lines = compact([
    line("Sterling", ANIM.Sterling.tablet!, pick(c, "ghost.sterling", [
      () => `The ${f.raw(d.gate)} veto so far: ${f.int(d.n)} refused ticket${d.n === 1 ? "" : "s"}, ${f.int(d.wins)} would have won, ${signed(d.usd)}${f.usd(d.usd)} on the model.`,
      () => `Ghost room, ${f.raw(d.gate)}: ${f.int(d.n)} closed. ${f.int(d.wins)} winners, ${signed(d.usd)}${f.usd(d.usd)} in total.`,
    ])),
    gain
      ? line("Jax", ANIM.Jax.shout!, pick(c, "ghost.jax.gain", [() => `So I was right. Say it. I was right.`, () => `Money on the table and we left it. Noted.`, () => `Every time you say no, a ghost gets rich.`, () => `Look at the ghosts eating. We could've been eating.`]))
      : line("Sterling", ANIM.Sterling.approve!, pick(c, "ghost.sterling.save", [() => `That's what a no is for.`, () => `The ghost room agrees with me.`, () => `A refused loss is a saved loss.`, () => `Every time a ghost loses, a real account didn't.`, () => `The veto earned its keep.`])),
    gain
      ? line("Nova", ANIM.Nova.analyze!, pick(c, "ghost.nova.gain", [() => `It's ${f.int(d.n)} tickets. That's a sample, not a verdict. The ghosts keep running.`, () => `${f.int(d.n)} isn't enough to move a gate. I'm logging it.`]))
      : line("Jax", ANIM.Jax.point!, pick(c, "ghost.jax.loss", [() => `Fine. Fine. Lucky guess.`, () => `One refusal doesn't make you a prophet.`, () => `Don't smile, Sterling. I can hear you smiling.`, () => `Okay. Okay. Point to the gate.`])),
  ]);
  return lines.length >= 2 ? { lines, moves: {} } : null;
}

/* ── Pulse and feed ────────────────────────────────────────────────────── */

export interface PulseData {
  vix: { from: number; to: number } | null;
  tenYear: { from: number; to: number } | null;
}

export function exPulse(c: Ctx, d: PulseData): Ex | null {
  const f = c.f;
  const lines: (Line | null)[] = [];
  if (d.vix) {
    const up = d.vix.to > d.vix.from;
    lines.push(line("Nova", ANIM.Nova.analyze!, pick(c, up ? "pulse.vix.up" : "pulse.vix.dn", up
      ? [
          () => `VIX ${f.raw(d.vix!.from.toFixed(1))} → ${f.raw(d.vix!.to.toFixed(1))}. Option prices bid before the tape does.`,
          () => `Implied vol is up: ${f.raw(d.vix!.from.toFixed(1))} to ${f.raw(d.vix!.to.toFixed(1))}. Every ATM costs more to own.`,
          () => `VIX bid from ${f.raw(d.vix!.from.toFixed(1))} to ${f.raw(d.vix!.to.toFixed(1))}. Somebody's buying protection.`,
        ]
      : [
          () => `VIX ${f.raw(d.vix!.from.toFixed(1))} → ${f.raw(d.vix!.to.toFixed(1))}. Premium's coming out of the options.`,
          () => `Vol is bleeding off: ${f.raw(d.vix!.from.toFixed(1))} to ${f.raw(d.vix!.to.toFixed(1))}. Long premium gets cheaper.`,
          () => `VIX eased from ${f.raw(d.vix!.from.toFixed(1))} to ${f.raw(d.vix!.to.toFixed(1))}. The market's exhaling.`,
        ])));
    lines.push(line("Sterling", ANIM.Sterling.tablet!, pick(c, "pulse.vix.sterling", [() => `The ticket's cap is ${f.usd(EXEC_LIMITS.maxTicketUsd)} either way. The contract count is what vol changes.`, () => `Sizing comes from the level, not from how scared the VIX is.`, () => `Vol moves the price of the option. It doesn't move the rules.`])));
  }
  if (d.tenYear) {
    const up = d.tenYear.to > d.tenYear.from;
    lines.push(line("Gemma", ANIM.Gemma.explain!, pick(c, "pulse.ten", [
      () => `Ten-year ${f.raw(d.tenYear!.from.toFixed(2))}% → ${f.raw(d.tenYear!.to.toFixed(2))}%. NQ is the rate-sensitive one — ${up ? "watch it lean" : "that's a tailwind"}.`,
      () => `The ten-year went from ${f.raw(d.tenYear!.from.toFixed(2))}% to ${f.raw(d.tenYear!.to.toFixed(2))}%. ${up ? "Higher yields are a headwind for NQ." : "Lower yields give NQ room."}`,
    ])));
  }
  const out = compact(lines);
  return out.length >= 2 ? { lines: out, moves: {} } : null;
}

export interface FeedData {
  kind: "live_gateway" | "yahoo" | "databento" | "synthetic" | "none";
  lagSec: number | null;
  from: string | null;
  reminder: boolean;
}

export function exFeed(c: Ctx, d: FeedData): Ex | null {
  const f = c.f;
  const lines: (Line | null)[] = [];
  if (d.kind === "live_gateway") {
    lines.push(line("Sterling", ANIM.Sterling.approve!, pick(c, "feed.gw.sterling", [() => `Gateway's up — the tape is real-time${d.lagSec != null ? ` (last print ${f.span(d.lagSec)} old)` : ""}.`, () => `Real-time tape is back. I'll trust a touch of CE again.`])));
    lines.push(line("Vince", ANIM.Vince.thumbs!, pick(c, "feed.gw.vince", [() => `Good. Then a touch of CE means something.`, () => `Now I can see the sweep when it happens, not ten minutes later.`])));
  } else if (d.kind === "yahoo" || d.kind === "databento") {
    lines.push(line("Sterling", ANIM.Sterling.arms!, pick(c, "feed.yh.sterling", [
      () => `We're on ${d.kind === "yahoo" ? "Yahoo" : "historical Databento"}${d.lagSec != null ? ` — futures run ${f.span(d.lagSec)} behind` : ""}. I won't call a touch off that.`,
      () => `The real-time feed is down. ${d.kind === "yahoo" ? "Yahoo" : "Databento historical"} is what we have${d.lagSec != null ? `, ${f.span(d.lagSec)} late` : ""}.`,
    ])));
    lines.push(line("Jax", ANIM.Jax.shout!, pick(c, "feed.yh.jax", [() => `So we're trading the past.`, () => `Ten minutes late is a different market.`, () => `I can't sweep what I see after it happened.`])));
    lines.push(line("Nova", ANIM.Nova.analyze!, pick(c, "feed.yh.nova", [() => `The ETF prints are fresher than the futures right now. The spot crossover uses whichever is real.`, () => `Option prices are only as good as the spot under them. I'm pricing off the fresher of the two.`])));
  } else if (d.kind === "synthetic") {
    lines.push(line("Sterling", ANIM.Sterling.arms!, pick(c, "feed.syn.sterling", [
      () => (d.reminder ? `Still on synthetic data. Nothing I say off it is a price.` : `The desk is on synthetic data. Nothing I say off it is a price.`),
      () => (d.reminder ? `The feed is still made up. News and the calendar are real; prices aren't.` : `The feed is made up. News and the calendar are real; prices aren't.`),
    ])));
    lines.push(line("Jax", ANIM.Jax.shout!, pick(c, "feed.syn.jax", [() => `So it's a screensaver.`, () => `We're looking at made-up numbers. Great.`, () => `I'm not chasing a cartoon.`])));
    lines.push(line("Nova", ANIM.Nova.analyze!, pick(c, "feed.syn.nova", [() => `Every card is refused on a synthetic feed, by design. I'll talk news and the calendar — those are real.`, () => `No live prices means no probabilities. I can still read the news.`])));
  } else {
    lines.push(line("Sterling", ANIM.Sterling.arms!, pick(c, "feed.none.sterling", [() => `No ticks from the desk. I'm not reading a tape that isn't there.`, () => `The tape's gone quiet — not the market, the feed.`])));
    lines.push(line("Vince", ANIM.Vince.watch!, pick(c, "feed.none.vince", [() => `Waiting on the feed. Nothing gets decided blind.`, () => `Blind means flat. I'm flat.`])));
  }
  const out = compact(lines);
  return out.length >= 2 ? { lines: out, moves: {} } : null;
}

/* ── Heartbeats: what they talk about when nothing is happening ────────── */

export interface RangeData {
  b: TapeBook;
  usedPct: number;
}
export function exRange(c: Ctx, d: RangeData): Ex | null {
  const f = c.f;
  const u = d.usedPct;
  const who = lead(c, "Jax", "Vince");
  const lines = compact([
    line("Gemma", ANIM.Gemma.explain!, pick(c, "hb.range.gemma", [
      () => `${d.b.say} has used ${f.pct(u)} of a median session's range. ${u < 40 ? "Plenty left to run." : u > 85 ? "Most of the day's range is spent." : "Mid-range — it hasn't decided."}`,
      () => `Range check: ${f.pct(u)} of the median session is on the board for ${d.b.say}.`,
      () => `${d.b.say}: ${f.pct(u)} of a typical day's range, spent. ${u < 40 ? "Most of it is still ahead." : u > 85 ? "There isn't much range left today." : "Halfway there. Undecided."}`,
      () => `How far has the day moved? ${f.pct(u)} of a median session so far on ${d.b.say}.`,
    ])),
    who === "Jax"
      ? line("Jax", ANIM.Jax.point!, pick(c, "hb.range.jax", u < 40
          ? [() => `So it hasn't even started.`, () => `Barely out of bed.`, () => `Then there's a whole day of moves I haven't been wrong about yet.`]
          : u > 85
            ? [() => `Then the move's done and I missed it.`, () => `Great. I show up after the party.`, () => `Out of range. Out of excuses.`]
            : [() => `Boring. Wake me when it leaves.`, () => `Make up your mind.`, () => `Neither here nor there. Typical.`]))
      : line("Vince", ANIM.Vince.watch!, pick(c, "hb.range.vince", [() => `Range spent or not, the card decides.`, () => `I don't trade the range. I trade the sweep.`, () => `Noted. The sequence doesn't care how much range is left.`])),
  ]);
  return lines.length >= 2 ? { lines, moves: {} } : null;
}

export interface DealingData {
  b: TapeBook;
  posPct: number;
  zone: "premium" | "discount" | "equilibrium";
  low: number;
  high: number;
}
export function exDealing(c: Ctx, d: DealingData): Ex | null {
  const f = c.f;
  const rule =
    d.zone === "premium"
      ? "Premium — above the dealing-range midpoint. Shorts belong here. A long from here is the wrong half."
      : d.zone === "discount"
        ? "Discount — below the midpoint. Longs belong here. A short from here is the wrong half."
        : "Equilibrium — the midpoint of the dealing range. Not premium, not discount.";
  const lines = compact([
    line("Gemma", ANIM.Gemma.wall!, pick(c, "hb.deal.gemma", [
      () => `${d.b.say} sits ${f.pct(d.posPct)} up the range ${f.lvl(d.low)}–${f.lvl(d.high)} — ${d.zone}. ${rule}`,
      () => `Dealing range ${f.lvl(d.low)}–${f.lvl(d.high)}: ${d.b.say} is ${f.pct(d.posPct)} of the way up. ${d.zone[0]!.toUpperCase()}${d.zone.slice(1)}.`,
      () => `Premium or discount? ${d.b.say} is ${f.pct(d.posPct)} up a ${f.lvl(d.low)}–${f.lvl(d.high)} range — ${d.zone}. ${rule}`,
    ])),
    line("Vince", ANIM.Vince.watch!, pick(c, "hb.deal.vince", [
      () => `Right half or no card. ${d.zone === "equilibrium" ? "This isn't either." : `I want ${d.zone === "premium" ? "shorts" : "longs"} from a PD array here.`}`,
      () => `A PD array in the right half, after a sweep. That's the whole menu.`,
      () => `The half decides the side. The array decides the price.`,
    ])),
  ]);
  return lines.length >= 2 ? { lines, moves: { Gemma: WB } } : null;
}

export interface DrawData {
  b: TapeBook;
  name: string;
  price: number;
  dist: number;
  side: "above" | "below";
}
export function exDraw(c: Ctx, d: DrawData): Ex | null {
  const f = c.f;
  const nm = f.raw(d.name);
  const lines = compact([
    line("Gemma", ANIM.Gemma.explain!, pick(c, "hb.draw.gemma", [
      () => `Draw on liquidity for ${d.b.say}: ${nm} ${f.lvl(d.price)}, ${f.pts(d.dist)} pts ${d.side}.`,
      () => `Where's it going? ${nm} at ${f.lvl(d.price)} — ${f.pts(d.dist)} pts ${d.side}. That's the pool with the most resting orders.`,
      () => `The draw is ${nm}, ${f.lvl(d.price)} — ${f.pts(d.dist)} pts ${d.side} ${d.b.say}.`,
    ])),
    line("Jax", ANIM.Jax.point!, pick(c, "hb.draw.jax", [() => `And how long till it gets there?`, () => `I'd rather it took it now.`, () => `Pools don't care about my patience.`])),
    line("Sterling", ANIM.Sterling.arms!, pick(c, "hb.draw.sterling", [() => `A draw is where price is pointed, not a reason to be in.`, () => `Pointed isn't arrived.`, () => `Where it's going isn't a trade. How it gets there might be.`])),
  ]);
  return lines.length >= 2 ? { lines, moves: {} } : null;
}

export interface HtfData {
  b: TapeBook;
}
export function exHtf(c: Ctx, d: HtfData): Ex | null {
  const f = c.f;
  const { b } = d;
  const lines = compact([
    line("Vince", ANIM.Vince.watch!, pick(c, "hb.htf.vince", [
      () => `${b.say} top-down: ${b.htf === "none" ? "no bias" : b.htf}. The sequence says ${b.smcWord ?? "wait"}${b.smcMissing ? ` — missing: ${f.raw(clip(b.smcMissing, 80))}` : ""}.`,
      () => `Sequence on ${b.say}: ${b.smcWord ?? "wait"}${b.smcMissing ? `. First layer not passing: ${f.raw(clip(b.smcMissing, 80))}` : ""}.`,
      () => `${b.say} reads ${b.htf === "none" ? "neutral" : b.htf} on the higher timeframes${b.smcMissing ? `; the sequence is stuck at ${f.raw(clip(b.smcMissing, 70))}` : ""}.`,
    ])),
    line("Gemma", ANIM.Gemma.explain!, pick(c, "hb.htf.gemma", [
      () => (b.htf === "none" ? `No higher-timeframe bias means no trade against it either.` : `Higher timeframe is ${b.htf === "bull" ? "bullish" : "bearish"}. Longs ${b.htf === "bull" ? "are" : "aren't"} on the menu${b.htf === "bear" ? " unless the disrespect is documented" : ""}.`),
      () => (b.htf === "none" ? `Without a bias the higher timeframes are a coin flip. We don't flip coins.` : `The higher timeframe is the boss. ${b.htf === "bull" ? "It says buy the dips." : "It says sell the rallies."}`),
      () => `Top-down is ${b.htf === "none" ? "undecided" : b.htf === "bull" ? "up" : "down"}. Direction comes from the gaps. A missing layer cuts size. It does not veto.`,
    ])),
  ]);
  return lines.length >= 2 ? { lines, moves: {} } : null;
}

export interface BoardData {
  card: CardRead;
}
export function exHot(c: Ctx, d: BoardData): Ex | null {
  const f = c.f;
  const k = d.card;
  const fit = k.fit ?? 0;
  if (fit < 0.8) return null;
  const where =
    k.entry != null && k.awayPts != null
      ? `Price is ${f.pts(Math.abs(k.awayPts))} pts from the entry at ${f.lvl(k.entry)}.`
      : k.entry != null
        ? `The entry is ${f.lvl(k.entry)}.`
        : "The entry is not priced yet.";
  const lines = compact([
    line("Nova", ANIM.Nova.board!, `${k.futSymbol} ${k.futSide} is ${fit.toFixed(2)}. ${where} Stop ${k.stop != null ? f.lvl(k.stop) : "—"}. Target ${k.t1 != null ? f.lvl(k.t1) : "the draw"}.`),
    line("Gemma", ANIM.Gemma.wall!, "Bias is the one-hour and the four-hour gaps. Respected bullish, or a bearish gap that failed, is long. The reverse is short. The draw is the liquidity or the open gap in that direction, and we mark it before the entry."),
    line("Jax", ANIM.Jax.point!, "Sweep the pool on the other side, external or internal. Then the one-minute or five-minute gap. Then the inverse, or the gap holds. The fifteen-minute grade is the permission, not the trigger. Two a day is the backtest. Live, a count does not stand a ticket down."),
    line("Sterling", ANIM.Sterling.tablet!, "The target is the draw. A score does not pick the side. A short printed target gets repriced, it does not stand the card down. QQQ and SPY are separate tickets."),
    line("Vince", ANIM.Vince.watch!, `Robinhood is armed on Agentic. The limit sits at ${k.entry != null ? f.lvl(k.entry) : "the array"}. Direction agrees, so it places. No second confirm.`),
  ]);
  return { lines, moves: BOARD };
}

export function exBoard(c: Ctx, d: BoardData): Ex | null {
  const f = c.f;
  const k = d.card;
  const lines = compact([
    line("Vince", ANIM.Vince.watch!, pick(c, "hb.board.vince", [
      () => `${f.raw(k.name)}. ${k.setup ? f.raw(k.setup) : "No confluence tagged on it."}`,
      () => `Top of the board: ${k.band ?? "—"} ${k.futSymbol} ${k.futSide}. ${k.setup ? f.raw(k.setup) : ""}`,
      () => `${k.band ?? "—"} ${k.futSymbol} ${k.futSide}. Buy-side sits above the highs, sell-side under the lows. ${k.setup ? f.raw(k.setup) : "Nothing tagged."}`,
    ])),
    line("Sterling", ANIM.Sterling.tablet!, pick(c, "hb.board.sterling", [
      () => (k.block ? `${k.verdict === "ARMED" ? "Armed, but " : "Held back by: "}${f.raw(clip(k.block, 90))}.` : `Nothing blocking it. The touch is what's missing.`),
      () => (k.block ? `What it still needs: ${f.raw(clip(k.block, 90))}.` : `Gates are clear. It's waiting on price.`),
    ])),
    k.expR != null
      ? line("Nova", ANIM.Nova.analyze!, pick(c, "hb.board.nova", [() => `E[R] ranks cards well but runs optimistic at the top. I quote it; I don't trust the decimals.`, () => `The model's top fifth priced higher than it realized. Rank, don't bank.`, () => `Expected R is a ranking, not a promise.`]))
      : null,
  ]);
  return lines.length >= 2 ? { lines, moves: {} } : null;
}

export interface SmtData {
  nq: TapeBook;
  es: TapeBook;
  leader: "NQ" | "ES";
  nqPct: number;
  esPct: number;
}
export function exSmt(c: Ctx, d: SmtData): Ex | null {
  const f = c.f;
  const lines = compact([
    line("Gemma", ANIM.Gemma.explain!, pick(c, "hb.smt.gemma", [
      () => `NQ ${signed(d.nqPct)}${f.pct(d.nqPct, 2)} against ES ${signed(d.esPct)}${f.pct(d.esPct, 2)} on the day — ${d.leader} is leading.`,
      () => `${d.leader} is the stronger index today: NQ ${signed(d.nqPct)}${f.pct(d.nqPct, 2)}, ES ${signed(d.esPct)}${f.pct(d.esPct, 2)}.`,
      () => `Relative strength: ${d.leader} leads. NQ ${signed(d.nqPct)}${f.pct(d.nqPct, 2)}, ES ${signed(d.esPct)}${f.pct(d.esPct, 2)}.`,
    ])),
    line("Jax", ANIM.Jax.point!, pick(c, "hb.smt.jax", [() => `If one makes a new high and the other won't, that's my divergence.`, () => `Watch which one gives up first.`, () => `Divergence at a level — that's the tell.`])),
    line("Sterling", ANIM.Sterling.arms!, pick(c, "hb.smt.sterling", [() => `SMT is a bias input here, not a model. It scores only at a level.`, () => `A spread isn't a divergence. It has to print at a pool.`])),
  ]);
  return lines.length >= 2 ? { lines, moves: {} } : null;
}

export interface GapData {
  b: TapeBook;
  pts: number;
  prev: number;
}
export function exGap(c: Ctx, d: GapData): Ex | null {
  const f = c.f;
  const lines = compact([
    line("Jax", ANIM.Jax.point!, pick(c, "hb.gap.jax", [
      () => `${d.b.say} is ${signed(d.pts)}${f.pts(d.pts)} on yesterday's close of ${f.lvl(d.prev)}.`,
      () => `Yesterday ended at ${f.lvl(d.prev)}. ${d.b.say} is ${f.pts(d.pts)} ${d.pts >= 0 ? "above" : "below"} it.`,
      () => `${d.pts >= 0 ? "Up" : "Down"} ${f.pts(d.pts)} on the day for ${d.b.say}. Close was ${f.lvl(d.prev)}.`,
    ])),
    line("Gemma", ANIM.Gemma.explain!, pick(c, "hb.gap.gemma", [() => `Yesterday's close is a magnet until proven otherwise.`, () => `Price remembers where it settled.`, () => `The prior close is the fairest price the market ever agreed on.`])),
  ]);
  return lines.length >= 2 ? { lines, moves: {} } : null;
}

export interface VolData {
  b: TapeBook;
  ratio: number;
}
export function exVol(c: Ctx, d: VolData): Ex | null {
  const f = c.f;
  const hot = d.ratio >= 1.3;
  const lines = compact([
    line("Nova", ANIM.Nova.analyze!, pick(c, "hb.vol.nova", [
      () => `${d.b.say} volume is ${f.x(d.ratio)} its recent median — ${hot ? "participation is real" : "nobody's here"}.`,
      () => `Volume on ${d.b.say}: ${f.x(d.ratio)} the usual. ${hot ? "People showed up." : "Thin."}`,
      () => `${hot ? "Heavy" : "Light"} tape: ${f.x(d.ratio)} median volume on ${d.b.say}.`,
    ])),
    line("Vince", ANIM.Vince.watch!, pick(c, "hb.vol.vince", [
      () => (hot ? `A level that gets hit on volume is one to respect.` : `Thin tape. Moves on this don't mean much.`),
      () => (hot ? `Volume is the vote. It's voting.` : `Nobody's voting. I don't read much into it.`),
      () => (hot ? `The raids that matter come with volume.` : `Quiet tape lies. I'd rather wait for the crowd.`),
    ])),
  ]);
  return lines.length >= 2 ? { lines, moves: {} } : null;
}

export interface WeekData {
  trade: string;
  skipIf: string;
  kind: string | null;
}
export function exWeek(c: Ctx, d: WeekData): Ex | null {
  const f = c.f;
  const lines = compact([
    line("Sterling", ANIM.Sterling.tablet!, pick(c, "hb.week.sterling", [
      () => `Today's plan: ${f.raw(clip(d.trade, 150))}`,
      () => `The plan for today, as written: ${f.raw(clip(d.trade, 150))}`,
      () => `Written before the open — ${f.raw(clip(d.trade, 150))}`,
    ])),
    d.skipIf ? line("Sterling", ANIM.Sterling.arms!, pick(c, "hb.week.skip", [() => `Skip if: ${f.raw(clip(d.skipIf, 120))}`, () => `The plan says stand down if ${f.raw(clip(d.skipIf, 120))}`])) : null,
    line("Gemma", ANIM.Gemma.explain!, pick(c, "hb.week.gemma", [() => `Written before the open. The tape gets to disagree, but it has to earn it.`, () => `A plan isn't a prediction. It's a list of what we'd do if.`, () => `The week-ahead is the map. The tape is the weather.`])),
  ]);
  return lines.length >= 2 ? { lines, moves: {} } : null;
}

export interface RulesData {
  monthEntries: number;
  consecLosses: number;
  dayPnl: number;
  positions: number;
}
export function exRules(c: Ctx, d: RulesData): Ex | null {
  const f = c.f;
  const cap = f.int(PATH_MONTH_CAP);
  const lines = compact([
    line("Sterling", ANIM.Sterling.tablet!, pick(c, "hb.rules.sterling", [
      () => `PATH ${f.int(d.monthEntries)}/${cap} this month. ${d.consecLosses ? `${f.int(d.consecLosses)} straight loss${d.consecLosses === 1 ? "" : "es"}. ` : ""}Day ${signed(d.dayPnl)}${f.usd(d.dayPnl)}${d.positions ? `, ${f.int(d.positions)} open` : ", flat"}.`,
      () => `Counters: ${f.int(d.monthEntries)} of ${cap} PATH entries, day ${signed(d.dayPnl)}${f.usd(d.dayPnl)}${d.consecLosses ? `, ${f.int(d.consecLosses)} in a row against us` : ""}.`,
      () => `Book check — ${d.positions ? `${f.int(d.positions)} open` : "flat"}, day ${signed(d.dayPnl)}${f.usd(d.dayPnl)}, ${f.int(d.monthEntries)}/${cap} PATH.`,
    ])),
    line("Jax", ANIM.Jax.shout!, pick(c, "hb.rules.jax", [
      () => (d.monthEntries >= PATH_MONTH_CAP - 2 ? `${f.int(d.monthEntries)} used? We're rationing.` : `Plenty of bullets. Fewer opinions.`),
      () => `Count them twice. Still not enough.`,
      () => `Every number on that list is one I'd like to change.`,
    ])),
  ]);
  return lines.length >= 2 ? { lines, moves: {} } : null;
}

export interface LabData {
  cal: { n: number; meanP: number | null; hitRate: number | null; brier: number | null } | null;
  twins: { n: number; deltaUsd: number };
  refusals: { n: number; pnlUsd: number };
}
export function exLab(c: Ctx, d: LabData): Ex | null {
  const f = c.f;
  const parts: (() => string)[] = [];
  if (d.cal && d.cal.n >= 1 && d.cal.meanP != null && d.cal.hitRate != null) {
    parts.push(() => `Calibration: ${f.int(d.cal!.n)} plans scored — said ${f.frac(d.cal!.meanP!)}, hit ${f.frac(d.cal!.hitRate!)}${d.cal!.brier != null ? `, Brier ${f.raw(d.cal!.brier.toFixed(3))}` : ""}.`);
    parts.push(() => `My plans so far: ${f.frac(d.cal!.meanP!)} predicted, ${f.frac(d.cal!.hitRate!)} realized over ${f.int(d.cal!.n)}.`);
  }
  if (d.twins.n >= 1) parts.push(() => `The room's exits against the mandate alone: ${signed(d.twins.deltaUsd)}${f.usd(d.twins.deltaUsd)} over ${f.int(d.twins.n)} paired fills.`);
  if (d.refusals.n >= 1) parts.push(() => `The refused tickets: ${f.int(d.refusals.n)} closed, ${signed(d.refusals.pnlUsd)}${f.usd(d.refusals.pnlUsd)} on the model.`);
  if (!parts.length) return null;
  const lines = compact([
    line("Nova", ANIM.Nova.write!, pick(c, "hb.lab.nova", parts)),
    line("Sterling", ANIM.Sterling.approve!, pick(c, "hb.lab.sterling", [() => `Small samples. I'll quote them; I won't trade on them.`, () => `Evidence, not a verdict. Keep logging.`, () => `A number with an n of ${f.int(Math.max(1, d.cal?.n ?? d.refusals.n))} is a hint.`])),
  ]);
  return lines.length >= 2 ? { lines, moves: { Nova: WB } } : null;
}

export interface MemData {
  who: Character;
  against: Character | null;
  clock: string;
  text: string;
  verdict: string | null;
  movePct: number | null;
  usd: number | null;
}
export function exMemory(c: Ctx, d: MemData): Ex | null {
  const f = c.f;
  const teller: Character = d.who === "Sterling" ? "Jax" : "Sterling";
  const verdictText =
    d.verdict === "right" ? "that one was right" : d.verdict === "wrong" ? "that one was wrong" : d.verdict === "saved" ? "that no saved money" : d.verdict === "cost" ? "that no cost money" : d.verdict ? `it scored ${d.verdict}` : "still open";
  const move = d.movePct != null ? ` (${signed(d.movePct)}${f.pct(d.movePct, 2)} on the ETF)` : d.usd != null ? ` (${signed(d.usd)}${f.usd(d.usd)})` : "";
  const good = d.verdict === "right" || d.verdict === "saved";
  const when = f.hhmm(Number(d.clock.slice(0, 2)) * 60 + Number(d.clock.slice(3, 5)));
  const lines = compact([
    line(teller, NEUTRAL[teller], pick(c, "hb.mem.teller", [
      () => `${when} — ${f.raw(d.text)}. ${verdictText[0]!.toUpperCase()}${verdictText.slice(1)}${move}.`,
      () => `Going back to ${when}: ${f.raw(d.text)}. ${verdictText[0]!.toUpperCase()}${verdictText.slice(1)}${move}.`,
    ])),
    line(d.who, NEUTRAL[d.who], pick(c, good ? "hb.mem.good" : "hb.mem.bad", good
      ? [() => `Write that down.`, () => `I'll take the credit.`, () => `Noted. Say it louder.`]
      : [() => `Fine. I'll own that one.`, () => `One bad call isn't a record.`, () => `It's on the board. I can read.`])),
  ]);
  return lines.length >= 2 ? { lines, moves: {} } : null;
}

export interface MoodData {
  who: Character;
  need: "caffeine" | "fatigue" | "stress" | "loneliness" | "boredom";
}
export function exMood(c: Ctx, d: MoodData): Ex | null {
  const banks: Record<MoodData["need"], (() => string)[]> = {
    caffeine: [() => `Third coffee and it's not even lunch. Don't say anything.`, () => `I need a coffee before the next headline.`, () => `Whoever finished the pot: I know it was you.`],
    fatigue: [() => `I've been staring at this tape too long. Everything looks like a fair value gap.`, () => `Tired eyes see sweeps that aren't there. Noted.`, () => `If I blink the move happens. If I don't, nothing does.`],
    stress: [() => `Everyone relax. Nothing's wrong. Why does it feel like something's wrong?`, () => `Heart rate says we need a minute.`, () => `I'd like to be calm. I'd like that a lot.`],
    loneliness: [() => `Anyone want to look at a chart with me? Anyone?`, () => `It's quiet. Say something.`, () => `I've been talking to the monitor. It agrees with everything.`],
    boredom: [() => `Flat tape. Somebody move.`, () => `I could count the ticks. I have been counting the ticks.`, () => `The market is doing its best impression of a screensaver.`],
  };
  const reply: Record<Character, (() => string)[]> = {
    Jax: [() => `Same.`, () => `Oh, shut up. …Same.`, () => `I'd say something smart but I'm the one who's tired.`],
    Nova: [() => `Noted. It doesn't change the model.`, () => `Eat something. The numbers will wait.`, () => `That's a variable I can't hedge.`],
    Sterling: [() => `Discipline looks like this. Quietly.`, () => `Nothing to trade is a result.`, () => `Take five. The rules will be here.`],
    Gemma: [() => `Look away from the screen. The levels aren't going anywhere.`, () => `Take a walk. The draw will still be there.`, () => `Pools don't move when you're not watching. They do move when you are.`],
    Vince: [() => `Same. Keep the keyboard warm.`, () => `I'm here. I'm watching. Go.`, () => `Go. I've got the desk.`],
  };
  const who = d.who;
  const others = (["Gemma", "Nova", "Vince", "Jax", "Sterling"] as Character[]).filter((x) => x !== who);
  const other = others[hash32(c.key) % others.length]!;
  const lines = compact([
    line(who, NEUTRAL[who], pick(c, `hb.mood.${d.need}.${who}`, banks[d.need])),
    line(other, NEUTRAL[other], pick(c, `hb.mood.reply.${other}`, reply[other])),
  ]);
  const move: TalkMove | null = d.need === "caffeine" && (who === "Jax" || who === "Nova" || who === "Gemma") ? { zone: "WATERCOOLER", spot: "coffee" } : null;
  return lines.length >= 2 ? { lines, moves: move ? { [who]: move } : {} } : null;
}

export interface EvidenceData {
  text: string;
}
export function exEvidence(c: Ctx, d: EvidenceData): Ex | null {
  const f = c.f;
  const lines = compact([
    line("Nova", ANIM.Nova.write!, pick(c, "hb.evid.nova", [() => `On four years of real cards: ${f.raw(clip(d.text, 170))}`, () => `From the capture: ${f.raw(clip(d.text, 170))}`])),
    line("Sterling", ANIM.Sterling.approve!, pick(c, "hb.evid.sterling", [() => `Which is why the gates stay where they are.`, () => `That's the number behind the no.`, () => `Measured, not believed.`])),
    line("Jax", ANIM.Jax.shout!, pick(c, "hb.evid.jax", [() => `Numbers don't have feelings. Unlike me.`, () => `I hate it when the data is right.`, () => `Do the numbers know how good I look on a long?`])),
  ]);
  return lines.length >= 2 ? { lines, moves: { Nova: WB } } : null;
}

export interface TomorrowData {
  weekday: string;
  kind: string | null;
  trade: string | null;
  news: { timeEt: string; name: string; impact: string }[];
  skipIf: string | null;
}
export function exTomorrow(c: Ctx, d: TomorrowData): Ex | null {
  const f = c.f;
  const rel = d.news.length ? `Releases: ${d.news.slice(0, 3).map((n) => `${f.raw(n.name)} ${f.raw(n.timeEt)}`).join(", ")}.` : `No scheduled releases.`;
  const lines = compact([
    line("Sterling", ANIM.Sterling.tablet!, pick(c, "hb.tom.sterling", [
      () => `${d.weekday}: ${d.kind ?? "a trading day"}. ${rel}`,
      () => `Next up, ${d.weekday} (${d.kind ?? "trading day"}). ${rel}`,
    ])),
    d.trade ? line("Gemma", ANIM.Gemma.wall!, pick(c, "hb.tom.gemma", [() => `The plan, as written: ${f.raw(clip(d.trade!, 140))}`, () => `For ${d.weekday}: ${f.raw(clip(d.trade!, 140))}`])) : null,
    d.skipIf ? line("Sterling", ANIM.Sterling.arms!, pick(c, "hb.tom.skip", [() => `And we skip if: ${f.raw(clip(d.skipIf!, 120))}`, () => `Stand down if ${f.raw(clip(d.skipIf!, 120))}`])) : null,
  ]);
  return lines.length >= 2 ? { lines, moves: { Gemma: WB } } : null;
}

export interface OvernightData {
  b: TapeBook;
  lo: number;
  hi: number;
  openPts: number | null;
}
export function exOvernight(c: Ctx, d: OvernightData): Ex | null {
  const f = c.f;
  const lines = compact([
    line("Gemma", ANIM.Gemma.explain!, pick(c, "hb.night.gemma", [
      () => `Globex so far: ${d.b.say} ${f.lvl(d.lo)}–${f.lvl(d.hi)}, now ${f.lvl(d.b.px)}${d.openPts != null ? `, ${signed(d.openPts)}${f.pts(d.openPts)} from the ${f.hhmm(18 * 60)} open` : ""}.`,
      () => `The overnight range on ${d.b.say} is ${f.lvl(d.lo)} to ${f.lvl(d.hi)}. Price is at ${f.lvl(d.b.px)}.`,
      () => `${d.b.say} has traded ${f.lvl(d.lo)}–${f.lvl(d.hi)} since the open. That's the box tomorrow starts in.`,
    ])),
    line("Vince", ANIM.Vince.watch!, pick(c, "hb.night.vince", [() => `Levels for tomorrow come off this range. I'm marking the extremes.`, () => `Asia and London write tomorrow's pools. We read, we don't trade.`, () => `Whoever gets raided first overnight sets the tone for the open.`])),
  ]);
  return lines.length >= 2 ? { lines, moves: {} } : null;
}

export interface RecapData {
  dayPnl: number;
  closed: number;
  wins: number;
  refusals: { n: number; pnlUsd: number } | null;
}
export function exRecap(c: Ctx, d: RecapData): Ex | null {
  const f = c.f;
  const lines = compact([
    line("Sterling", ANIM.Sterling.tablet!, pick(c, "hb.recap.sterling", [
      () => `Day: ${signed(d.dayPnl)}${f.usd(d.dayPnl)}. ${f.int(d.wins)} of ${f.int(d.closed)} closed trades green.${d.refusals && d.refusals.n ? ` The refused tickets would have made ${signed(d.refusals.pnlUsd)}${f.usd(d.refusals.pnlUsd)} over ${f.int(d.refusals.n)}.` : ""}`,
      () => `Recap — ${signed(d.dayPnl)}${f.usd(d.dayPnl)} on the day, ${f.int(d.wins)}/${f.int(d.closed)} closed in the green.${d.refusals && d.refusals.n ? ` Ghost room: ${signed(d.refusals.pnlUsd)}${f.usd(d.refusals.pnlUsd)} over ${f.int(d.refusals.n)} refusals.` : ""}`,
    ])),
    line("Jax", ANIM.Jax.shout!, pick(c, d.dayPnl >= 0 ? "hb.recap.jax.up" : "hb.recap.jax.dn", d.dayPnl >= 0 ? [() => `Green day. Don't jinx it.`, () => `I'll take it.`, () => `I'd like it on record that I saw it coming.`] : [() => `Red. Tomorrow's another day.`, () => `We'll get it back. Slowly. Boringly.`, () => `I'm not mad. I'm just loud.`])),
  ]);
  return lines.length >= 2 ? { lines, moves: {} } : null;
}

export interface WelcomeData {
  feedLine: string;
  positions: number;
  monthEntries: number;
  b: TapeBook | null;
  optionsOpen: boolean;
  globexOpen: boolean;
}
export function exWelcome(c: Ctx, d: WelcomeData): Ex | null {
  const f = c.f;
  const cap = f.int(PATH_MONTH_CAP);
  const lines = compact([
    line("Sterling", ANIM.Sterling.tablet!, pick(c, "welcome.sterling", [
      () => `Desk's live. ${f.raw(d.feedLine)}${d.b ? ` ${d.b.say} ${f.lvl(d.b.px)}.` : ""} ${d.positions ? `${f.int(d.positions)} open.` : "Flat."} PATH ${f.int(d.monthEntries)}/${cap} this month.`,
      () => `We're up. ${f.raw(d.feedLine)}${d.b ? ` ${d.b.say} at ${f.lvl(d.b.px)}.` : ""} ${d.positions ? `${f.int(d.positions)} on the book.` : "Nothing on the book."}`,
    ])),
    line("Vince", ANIM.Vince.watch!, pick(c, "welcome.vince", [
      () => (d.optionsOpen ? `Options are open. The gates read the tape, not the clock.` : d.globexOpen ? `Options are shut; Globex is trading. We read the tape, we don't trade it.` : `Everything's shut. Week plan and news until it reopens.`),
      () => (d.optionsOpen ? `Cash session. The sequence is the only thing that gets a vote.` : d.globexOpen ? `Night shift: futures only. We watch, we plan.` : `Markets are closed. Nothing's moving but the news.`),
    ])),
  ]);
  return lines.length >= 2 ? { lines, moves: {} } : null;
}

/** The five compare notes. Discretion is each school's own no. Nothing here is a ticket. */
export interface HuddleData {
  missing: string | null;
  experiment: { owner: Character; title: string; n: number; nNeeded: number } | null;
  leader: string | null;
  seated: string | null;
  jaxWrong: boolean;
  stamp: string | null;
  /** A refusal the model says cost money. Named, not edited. */
  costGate: string | null;
}
export function exHuddle(c: Ctx, d: HuddleData): Ex | null {
  const f = c.f;
  const lines = compact([
    line("Gemma", ANIM.Gemma.explain!, pick(c, "hb.huddle.gemma", [
      () => d.missing
        ? `The improvement on the sequence is ${f.raw(d.missing)}, and only if it prints. I will not invent the layer to make a trade.`
        : d.stamp
          ? `The stamp is ${f.raw(d.stamp)}. That is the whole room's no, Jax included.`
          : `The sequence is intact. Adding a layer to force a trade is how a good desk gets worse.`,
      () => d.missing
        ? `${f.raw(d.missing)} is still missing. Discount, premium, the draw — none of them substitute for it.`
        : `I am not teaching a new model today. The one on the board is the one we trade.`,
    ])),
    line("Jax", ANIM.Jax.point!, pick(c, d.jaxWrong ? "hb.huddle.jax.wrong" : "hb.huddle.jax", d.jaxWrong
      ? [
          () => d.leader && d.leader !== "Jax"
            ? `Last chase was wrong, so I stand back. ${f.raw(d.leader)} can lead the paper book. I still want the sweep, then the shift, and I still don't get to skip the retest.`
            : `Last chase was wrong. Being ahead on paper does not buy me the next one. Sweep, then the shift. No skip.`,
          () => `I wanted it and the tape said I was early. The improvement I can actually make is not paying the spread to look busy.`,
        ]
      : [
          () => d.leader && d.leader !== "Jax"
            ? `${f.raw(d.leader)} is ahead on paper. Paper is not a fill. I want the sweep into the shift, and I still don't get to skip the retest.`
            : `If I'm leading the paper book, that is not a license to chase. Sweep, then the shift. That's the whole discretion.`,
          () => `Friendly is fine. I still lose the argument when it is not a sweep into a shift.`,
        ])),
    line("Nova", ANIM.Nova.analyze!, pick(c, "hb.huddle.nova", d.experiment
      ? [
          () => `Jax, the only question close enough to argue with is ${f.raw(d.experiment!.title)}: ${f.int(d.experiment!.n)} of ${f.int(d.experiment!.nNeeded)}. Finish the sample. Do not crown it, and do not move a gate from this room.`,
          () => `${f.raw(d.experiment!.owner)}'s test is the one on the bench, ${f.int(d.experiment!.n)} into ${f.int(d.experiment!.nNeeded)}. A half sample is not a new edge.`,
        ]
      : [
          () => `Nothing on the bench is close to its bar. Your sweep is not a sample, Jax, and the model stays the model.`,
          () => `No experiment is ready to argue with the four-year test. Collecting is the improvement. Crowning is not.`,
        ])),
    line("Vince", ANIM.Vince.watch!, pick(c, "hb.huddle.vince", [
      () => `Nova can count it. I rest the order at consequent encroachment until price is in the array. A late print does not get a ticket, and it does not get a story.`,
      () => `The execution improvement is the one we already have: face down until the array, slide it back if it leaves. I do not chase Jax's sweep.`,
    ])),
    line("Sterling", ANIM.Sterling.approve!, pick(c, "hb.huddle.sterling", [
      () => d.seated
        ? `${f.raw(d.seated)} sits. Beating a seated book on paper is not a reason to loosen the checklist.${d.costGate ? ` The ${f.raw(d.costGate)} no has cost on the model. We still do not edit it from the floor.` : ""}`
        : d.leader
          ? `${f.raw(d.leader)} is leading. Leading is not a size.${d.costGate ? ` ${f.raw(d.costGate)} has cost on the model, and it stays.` : " The checklist is the same one for the leader."}`
          : `Objectives not met is not a reason to go looking for one.${d.costGate ? ` ${f.raw(d.costGate)} stays, even when the model says it cost.` : ""}`,
      () => `You can argue the sweep, the sample and the array. None of you gets a different checklist.`,
    ])),
  ]);
  return lines.length >= 2 ? { lines, moves: d.missing ? { Gemma: WB } : {} } : null;
}
