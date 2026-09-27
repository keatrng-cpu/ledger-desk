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
