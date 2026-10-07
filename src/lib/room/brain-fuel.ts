/**
 * School, the card, the chart, the backtest, and the journal write the book.
 * The book then hands each new line to all five. A line that did not change is not sent again.
 */

import { noteNerve } from "./brain-traffic";
import {
  ATLAS_EVENT,
  BRAIN_CREW,
  PEOPLE_KEY,
  freshPeople,
  improveAtlas,
  mergeAtlas,
  nodeById,
  saveAtlas,
  type BrainWho,
  type DeskAtlas,
  type PeopleBrains,
} from "./desk-atlas";

export interface BrainFuel {
  nowMs: number;
  school: string | null;
  card: string | null;
  chart: string | null;
  backtest: string | null;
  journal: string | null;
}

const SLOTS: { title: string; key: keyof Omit<BrainFuel, "nowMs">; who: BrainWho }[] = [
  { title: "School", key: "school", who: "Nova" },
  { title: "Card", key: "card", who: "Nova" },
  { title: "Chart", key: "chart", who: "Gemma" },
  { title: "Backtest", key: "backtest", who: "Vince" },
  { title: "Journal", key: "journal", who: "Sterling" },
];

function savePeople(p: PeopleBrains): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(PEOPLE_KEY, JSON.stringify(p));
    if (typeof window !== "undefined") window.dispatchEvent(new Event(ATLAS_EVENT));
  } catch {
    /* a full disk does not stop the floor */
  }
}

/** Write the lines that changed, then hand each one to every seat. */
export function fuelBrains(
  atlas: DeskAtlas | null | undefined,
  people: PeopleBrains | null | undefined,
  fuel: BrainFuel,
): { atlas: DeskAtlas; people: PeopleBrains } {
  let a = atlas?.version === 1 ? atlas : mergeAtlas(null, null, fuel.nowMs);
  const changed: { id: string; title: string; text: string; who: BrainWho }[] = [];
  for (const slot of SLOTS) {
    const text = fuel[slot.key]?.trim();
    if (!text) continue;
    const id = `now:${slot.title.toLowerCase()}`;
    if (nodeById(a, id)?.text === text) continue;
    a = improveAtlas(a, { shelf: "now", title: slot.title, text, who: slot.who, nowMs: fuel.nowMs });
    changed.push({ id, title: slot.title, text, who: slot.who });
  }
  if (!changed.length) return { atlas: a, people: people?.version === 1 && people.people ? people : people ?? freshPeople() };

  const base = people?.version === 1 && people.people ? people : freshPeople();
  const nextPeople: PeopleBrains["people"] = { ...base.people };
  let pending = base.pending;
  for (const line of changed) {
    for (const w of BRAIN_CREW) {
      const person = nextPeople[w] ?? { who: w, known: {}, notes: [] };
      const notes = w === line.who ? [{ at: fuel.nowMs, text: line.text, about: line.id }, ...person.notes].slice(0, 12) : person.notes;
      nextPeople[w] = { ...person, known: { ...person.known, [line.id]: fuel.nowMs }, notes };
    }
    noteNerve("hub", line.who, line.title, fuel.nowMs);
    for (const other of BRAIN_CREW) if (other !== line.who) noteNerve(line.who, other, line.title, fuel.nowMs);
    if (!pending) pending = { who: line.who, text: line.text, at: fuel.nowMs };
  }
  const out = { version: 1 as const, people: nextPeople, pending, best: base.best ?? { pT1: null, expR: null } };
  saveAtlas(a);
  savePeople(out);
  return { atlas: a, people: out };
}
