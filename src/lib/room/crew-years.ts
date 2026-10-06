import study from "@/data/crew-years.json";
import { loadAtlas, offerToBrains, type BrainWho, type PeopleBrains } from "./desk-atlas";

export interface CrewHalf {
  n: number;
  wins: number;
  wr: number | null;
  sumR: number;
  expR: number | null;
}

export interface CrewPerson {
  who: BrainWho;
  year: number;
  rule: string;
  targetR: number;
  desk: boolean;
  skill: string;
  flaws: string[];
  h2: CrewHalf;
  full: CrewHalf;
}

const KEY = "ledger-crew-years-v1";

export const CREW_STUDY = study as {
  note: string;
  window: { start: string; end: string };
  yearsAvailable: number[];
  people: CrewPerson[];
};

export function crewOf(who: string): CrewPerson | null {
  return CREW_STUDY.people.find((p) => p.who === who) ?? null;
}

/** Write each person's year into their own brain. Nothing that missed the bar is taught to the desk. */
export function learnCrewYears(): void {
  try {
    if (typeof localStorage === "undefined") return;
    if (localStorage.getItem(KEY) === study.note) return;
    let people: PeopleBrains | null = null;
    let desk = loadAtlas();
    for (const p of CREW_STUDY.people) {
      const wrote = offerToBrains(people, desk, {
        who: p.who,
        text: p.skill,
        about: `${p.who} ${p.year}`,
        shelf: "backtest",
        nowMs: Date.now(),
        pnl: null,
        pT1: null,
        expR: null,
      });
      people = wrote.people;
      desk = wrote.desk;
    }
    localStorage.setItem(KEY, study.note);
  } catch {
    /* a blocked disk does not invent a result */
  }
}
