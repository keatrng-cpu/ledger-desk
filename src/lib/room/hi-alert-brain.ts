/**
 * What the brain keeps from a graded high-alert card (hi-alert.ts), so the five learn from the setups they took AND the ones they passed on.
 *
 * Three things are written, once per card, when the chart has finished grading it:
 *   1. The desk brain gets the lesson as a node on the backtest shelf (what it was, what the desk did and why, what the chart did, and whether the
 *      decision was right). It is written whether or not the card was taken: a pass that was right and a pass that cost are both evidence.
 *   2. The school that reads the card's model is graded against the tape: if its verdict was "fits" and the trade worked, or "missing" and it did not,
 *      its entry node gains confidence; the other two combinations lose it. Only a card that FILLED teaches this. A card that never filled says
 *      nothing about whether the read was right, only that the limit was not touched.
 *   3. The character who presents that school (Gemma ICT, Jax TJR, Nova Blake, Sterling Patty; Nova otherwise) gets the lesson as a personal note.
 *      A hypothetical result never becomes a rule: only a TAKEN trade that paid is offered to the desk brain as realized P&L (offerToBrains).
 *
 * The confidence a school node earns here is shown, not obeyed: it moves by a fixed step on a handful of cards, which is not a sample a gate could
 * stand on. Nothing here touches a rule, a gate, a size or an order.
 */

import { callOf, lessonOf, type HiAlert } from "@/lib/trading/hi-alert";
import { SCHOOL_AVATAR, ownSchool, type SchoolKey } from "@/lib/trading/school-brief";
import {
  gradeAtlas,
  improveAtlas,
  loadAtlas,
  mergeAtlas,
  offerToBrains,
  saveAtlas,
  schoolNodeId,
  syncPeople,
  type BrainWho,
  type DeskAtlas,
  type PeopleBrains,
} from "./desk-atlas";

const worked = (h: HiAlert): boolean => {
  const o = h.outcome;
  return Boolean(o?.filled && (o.status === "t1" || o.status === "t2") && (o.R ?? 0) > 0);
};

export interface Fed {
  atlas: DeskAtlas;
  people: PeopleBrains | null;
  school: SchoolKey | null;
  /** True when the school's entry node was graded against the tape. */
  graded: boolean;
  who: BrainWho;
}

export function feedHiAlert(atlas: DeskAtlas, people: PeopleBrains | null, h: HiAlert, nowMs: number): Fed {
  const school = ownSchool(h.strategy);
  const who = (school ? SCHOOL_AVATAR[school] : "Nova") as BrainWho;
  const text = lessonOf(h);
  const slot = h.id.split("|").pop() ?? "x";
  let a = improveAtlas(atlas, { shelf: "backtest", title: `Hi-alert ${h.sym} ${h.side} ${h.day.slice(5)} ${slot}`, text, who, nowMs });

  let graded = false;
  const read = school ? h.schools.find((s) => s.school === school) : null;
  if (school && read && h.outcome?.filled) {
    const right = read.verdict === "fits" ? worked(h) : read.verdict === "missing" ? !worked(h) : null;
    if (right != null) {
      a = gradeAtlas(a, schoolNodeId(school, "entry"), right, nowMs);
      graded = true;
    }
  }

  const taken = h.taken !== "no";
  const out = offerToBrains(people, a, {
    who,
    text,
    about: `Hi-alert ${h.sym} ${h.side}`,
    shelf: "backtest",
    nowMs,
    // Only a trade that was TAKEN has a realized result. A hypothetical one is remembered by the person and does not become a desk rule.
    pnl: taken && h.outcome?.R != null ? h.outcome.R : null,
    pT1: null,
    expR: null,
  });
  return { atlas: out.desk, people: out.people, school, graded, who };
}

/**
 * Feed every graded, not-yet-fed record. Browser only (it reads and writes the atlas and the people's brains in storage). Returns the list with
 * `fed` set on those it wrote, so each card is written once.
 */
export function feedLedger(list: HiAlert[], nowMs: number): HiAlert[] {
  const todo = list.filter((h) => h.outcome?.done && !h.fed && callOf(h) !== "open");
  if (!todo.length) return list;
  let atlas = loadAtlas() ?? mergeAtlas(null, null, nowMs);
  let people: PeopleBrains | null = syncPeople(null, atlas, nowMs);
  const fed = new Set<string>();
  for (const h of todo) {
    const r = feedHiAlert(atlas, people, h, nowMs);
    atlas = r.atlas;
    people = r.people;
    fed.add(h.id);
  }
  saveAtlas(atlas);
  return list.map((h) => (fed.has(h.id) ? { ...h, fed: true } : h));
}
