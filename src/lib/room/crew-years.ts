import study from "@/data/crew-card-study.json";
import { improveAtlas, loadAtlas, mergeAtlas, offerToBrains, saveAtlas, type BrainWho, type PeopleBrains } from "./desk-atlas";
import { PERFECT_STANDARD } from "./perfect-entry";
import book from "@/data/perfect-entry-book.json";

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
    if (localStorage.getItem("ledger-exec-rules-v2") !== "1") {
      saveAtlas(improveAtlas(loadAtlas() ?? mergeAtlas(null, null), {
        shelf: "discretion",
        title: "What places",
        who: "Vince",
        nowMs: Date.now(),
        text: "An A- or better whose one-hour and four-hour gaps agree places. No second confirm. Fit sizes, it does not pick the side. A printed stop on the wrong side or a target inside one R is repriced off the sweep, not refused. QQQ is MNQ and SPY is ES, one working order each. A stale print, a wide quote, or a zero buying-power read with cash on the Agentic account does not stand the ticket down. The 15-minute grade is the permission. The entry is the 1-minute or 5-minute inverse, or the hold. One-to-one is a partial. The draw is the target. Internal versus external is a note, not a filter. The two-a-day cap stays in the backtest. A missed A- writes the gate that blocked it. The fit does not go up because the score was high.",
      }));
      localStorage.setItem("ledger-exec-rules-v2", "1");
    }
    if (localStorage.getItem("ledger-perfect-entry-v2") !== "1") {
      saveAtlas(improveAtlas(loadAtlas() ?? mergeAtlas(null, null), {
        shelf: "discretion",
        title: "Direction first",
        who: "Gemma",
        nowMs: Date.now(),
        text: PERFECT_STANDARD,
      }));
      localStorage.setItem("ledger-perfect-entry-v2", "1");
    }
    if (localStorage.getItem("ledger-perfect-book-v1") !== book.note) {
      const lines = (book.ladder as { who: string; check: string; wins: number; n: number; wr: number | null }[])
        .map((row) => `${row.who}: ${row.check} ${row.wins}/${row.n}, ${row.wr == null ? "—" : `${Math.round(row.wr * 100)}%`}.`)
        .join(" ");
      saveAtlas(improveAtlas(loadAtlas() ?? mergeAtlas(null, null), {
        shelf: "backtest",
        title: "Joint book",
        who: "Nova",
        nowMs: Date.now(),
        text: `Sep 2022 through Sep 2026, entries 9:30 to 11:30, two a day. The target is the draw marked first. ${lines} The two-a-day book reached the draw 19 of 29 times and made about zero R. After 2024 it was 5 of 11. It did not clear 68%.`,
      }));
      localStorage.setItem("ledger-perfect-book-v1", book.note);
    }
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
      text: "Cards at 0.85 and above, the book that holds a 0.90, reached the first target 31% of the time on 1,504 fills from September 2022 through September 2026. 2020 and 2021 are not on the tape. Out of sample that book lost 0.31R. A 0.90 card is not a 65% trade. Do not make 0.90 a gate, and do not stand a card down for the win rate.",
    });
    saveAtlas(deskNow);
  } catch {
    /* a blocked disk does not invent a result */
  }
}
