/**
 * IPO WATCH — new listings against the book's pre-written IPO rule.
 *
 * The answer to "should I invest in this IPO" is the same for every IPO on
 * the day it lists: not yet. What differs is WHEN it can be researched, so
 * that is what each row shows — lock-up end, a year of public quarters, and
 * the first date a dossier may be opened. The evidence is printed above the
 * list for the same reason the base rates sit on the research card.
 */

import { ipoCapturedAt, ipoEvidence, ipoSources, pricedIpos, upcomingIpos, LOCKUP_DAYS_DEFAULT } from "@/lib/invest/ipo";
import { etToday } from "@/lib/invest/store";
import { LINK } from "./format";
import { Card, Note } from "./ui";

const STAGE: Record<string, string> = {
  lockup: "LOCK-UP",
  "track-record": "NO RECORD YET",
  research: "RESEARCHABLE",
};

const DESK_WATCH: { name: string; state: "filed" | "watch" | "longer" | "off"; line: string }[] = [
  { name: "Anthropic", state: "filed", line: "Confidential filing, June 2026. No prospectus, ticker, or date. Kill: the compute bill in a public filing." },
  { name: "OpenAI", state: "filed", line: "Confidential filing, then a 2026 listing ruled out. Stays on the watch. No date." },
  { name: "Anduril", state: "watch", line: "Said it will list. No file. Revenue is real. Kill: the operating loss eating the growth." },
  { name: "Databricks", state: "longer", line: "No file. The watch starts when a registration statement exists." },
  { name: "Waymo", state: "longer", line: "Alphabet's choice. The public way to hold it today is Alphabet, which the sleeve already overlaps." },
  { name: "Safe Superintelligence", state: "off", line: "No public model. A listing is not the next event. A public artifact is." },
  { name: "Figure AI", state: "off", line: "Pilots, not a fleet. Same rule as a reactor that has not been built." },
];

const WATCH_CLS = {
  filed: "border-[var(--color-border-strong)] text-[var(--color-fg)]",
  watch: "border-[var(--color-border-strong)] text-[var(--color-fg)]",
  longer: "border-[var(--color-border)] text-[var(--color-muted)]",
  off: "border-[color-mix(in_oklab,var(--color-warn)_50%,transparent)] text-[var(--color-warn)]",
} as const;

export function IpoCard() {
  const today = etToday();
  const up = upcomingIpos(today);
  const priced = pricedIpos(today);
  const ev = ipoEvidence();
  return (
    <Card title={`IPO watch · captured ${ipoCapturedAt()}`}>
      <Note>
        <span className="text-[var(--color-fg)]">The rule, written before any particular IPO: </span>
        not at the offer or in the first days (the pop goes to the allocation, not the open); not before the lock-up ends
        (prospectus date, else {LOCKUP_DAYS_DEFAULT} days); not before four quarterly reports as a public company. After that
        it is a research candidate like any company — dossier, verified operator, kill rule, price vs record — never a buy by
        itself.
      </Note>
      <div className="mt-2 border-t border-[var(--color-border)] pt-2">
        <p className="mb-1 text-[10px] uppercase tracking-wide text-[var(--color-muted)]">Desk watch</p>
        <ul className="space-y-1">
          {DESK_WATCH.map((w) => (
            <li key={w.name} className="text-[11px] leading-snug">
              <span className={`rounded border px-1 text-[9px] font-semibold uppercase ${WATCH_CLS[w.state]}`}>{w.state}</span>{" "}
              <span className="font-medium">{w.name}</span>
              <p className="text-[10px] text-[var(--color-muted)]">{w.line}</p>
            </li>
          ))}
        </ul>
      </div>
      {ev.length > 0 && (
        <ul className="mt-2 space-y-0.5 border-t border-[var(--color-border)] pt-2">
          {ev.map((e) => (
            <li key={e.id} className="text-[11px] leading-relaxed text-[var(--color-muted)]">
              {e.claim}{" "}
              <a href={e.url} target="_blank" rel="noopener noreferrer" className={LINK}>
                {e.source.split(",")[0]}
              </a>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-2 border-t border-[var(--color-border)] pt-2">
        <p className="mb-1 text-[10px] uppercase tracking-wide text-[var(--color-muted)]">Coming</p>
        {up.length ? (
          <ul className="space-y-0.5">
            {up.map((u) => (
              <li key={`${u.company}${u.expected}`} className="text-[11px] leading-snug">
                <span className="tabular-nums text-[var(--color-muted)]">{u.expected ?? "date tbd"} </span>
                <span className="font-medium">{u.company}</span>
                {u.ticker ? <span className="text-[var(--color-muted)]"> ({u.ticker}{u.exchange ? `, ${u.exchange}` : ""})</span> : null}
                <span className="text-[var(--color-muted)]">
                  {" "}
                  · {u.status}
                  {u.priceRange ? ` · ${u.priceRange}` : ""}
                </span>
                {u.url ? (
                  <>
                    {" "}
                    <a href={u.url} target="_blank" rel="noopener noreferrer" className={LINK}>
                      source
                    </a>
                  </>
                ) : null}
                <span className="text-[var(--color-muted)]"> · not researchable before a year of public quarters</span>
              </li>
            ))}
          </ul>
        ) : (
          <Note>No operating-company IPO on the captured calendar.</Note>
        )}
      </div>

      {priced.length > 0 && (
        <div className="mt-2 border-t border-[var(--color-border)] pt-2">
          <p className="mb-1 text-[10px] uppercase tracking-wide text-[var(--color-muted)]">Priced in the last year</p>
          <ul className="space-y-1">
            {priced.map((p) => (
              <li key={`${p.ticker}${p.pricedOn}`} className="text-[11px] leading-snug">
                <span className="rounded border border-[var(--color-border)] px-1 text-[9px] font-semibold text-[var(--color-muted)]">{STAGE[p.read.stage]}</span>{" "}
                <span className="font-medium">{p.ticker}</span> <span className="text-[var(--color-muted)]">{p.company} · priced {p.pricedOn}</span>
                {p.url ? (
                  <>
                    {" "}
                    <a href={p.url} target="_blank" rel="noopener noreferrer" className={LINK}>
                      source
                    </a>
                  </>
                ) : null}
                <p className="text-[10px] text-[var(--color-muted)]">{p.read.line}</p>
              </li>
            ))}
          </ul>
        </div>
      )}
      <Note>Sources: {ipoSources().join(" · ")}. Dates are the sources' — an expected IPO date moves until the deal prices.</Note>
    </Card>
  );
}
