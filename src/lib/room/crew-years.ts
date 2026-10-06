import study from "@/data/crew-card-study.json";
import { improveAtlas, loadAtlas, mergeAtlas, offerToBrains, saveAtlas, type BrainWho, type PeopleBrains } from "./desk-atlas";

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
  desk: boolean;
  skill: string;
  flaws: string[];
  h2: CrewHalf;
  full: CrewHalf;
}

const KEY = "ledger-crew-cards-v1";

export const CREW_STUDY = study as unknown as {
  note: string;
  searched: string;
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
    const deskNow = improveAtlas(desk ?? mergeAtlas(null, null), {
      shelf: "discretion",
      title: "Win rate",
      who: "Nova",
      nowMs: Date.now(),
      text: "A filled desk card wins about 32% at its own target. Across 1,327 cards, no cut with 110 trades won 65%. The best was 40%. The edge is the size of the winner, not the win rate. Do not stand a card down because the win rate is under 65%.",
    });
    saveAtlas(deskNow);
  } catch {
    /* a blocked disk does not invent a result */
  }
}
