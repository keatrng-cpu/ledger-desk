import { useEffect, useState } from "react";
import {
  ATLAS_EVENT,
  BRAIN_CREW,
  loadAtlas,
  nowLines,
  peopleKnown,
  type PeopleBrains,
  PEOPLE_KEY,
} from "@/lib/room/desk-atlas";

function readPeople(): PeopleBrains | null {
  try {
    const raw = localStorage.getItem(PEOPLE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as PeopleBrains;
    return p?.version === 1 ? p : null;
  } catch {
    return null;
  }
}

/** The one desk brain, and the five that connect to it. */
export function FloorBrains() {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const sync = () => setTick((n) => n + 1);
    window.addEventListener(ATLAS_EVENT, sync);
    window.addEventListener("focus", sync);
    return () => {
      window.removeEventListener(ATLAS_EVENT, sync);
      window.removeEventListener("focus", sync);
    };
  }, []);
  const desk = loadAtlas();
  const people = readPeople();
  void tick;
  const now = desk ? nowLines(desk) : [];
  return (
    <div className="rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
      <p className="text-[11px] uppercase tracking-wider text-[var(--color-muted)]">
        Desk brain · {peopleKnown(people)} nodes known by the floor
        {people?.best?.pT1 != null ? ` · best P(T1) ${Math.round(people.best.pT1 * 100)}%` : ""}
        {people?.best?.expR != null ? ` · best E[R] ${people.best.expR.toFixed(2)}` : ""}
      </p>
      <p className="mt-1 text-[12px] text-[var(--color-subtle)]">
        A person can write their own brain any time. The desk takes a line only when it raises probability, expectancy, or realized P&L.
      </p>
      <div className="mt-2 space-y-1">
        {now.map((n) => (
          <p key={n.id} className="text-[12px] leading-snug text-[var(--color-fg)]">
            <span className="text-[var(--color-muted)]">{n.title}. </span>
            {n.text}
          </p>
        ))}
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-5">
        {BRAIN_CREW.map((who) => {
          const b = people?.people[who];
          const note = b?.notes[0];
          return (
            <div key={who} className="rounded-[var(--radius-sm)] border border-[var(--color-border)] px-2 py-1.5">
              <p className="text-[11px] text-[var(--color-muted)]">{who}</p>
              <p className="mt-1 text-[11px] leading-snug text-[var(--color-fg)]">{note?.text ?? "Knows the desk. Nothing new of their own."}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
