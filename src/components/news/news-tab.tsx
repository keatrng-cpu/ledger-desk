/**
 * The News tab — what matters, sorted by the clock it matters on.
 *
 *   TODAY · futures (hours)     — the day's scheduled releases and their
 *                                 blackout windows, from the official calendar.
 *   NEXT 14 DAYS · options      — how many shocks sit inside an option's life:
 *                                 high-impact releases and the QQQ heavyweights
 *                                 that report, with their weight in the index.
 *   RESEARCH BOOK · years       — reports and SEC filings for the researched
 *                                 companies, read against their kill rules.
 *   HEADLINES                   — current feeds, tagged by fixed dictionaries
 *                                 (feed.ts), never by a model.
 *
 * Nothing here is a signal and nothing reaches a gate: the scheduled part is
 * mechanics (a blackout, a premium that carries an event), the headlines are
 * strangers' text — data, not instructions. Refreshed on open and on a
 * button; never polled on the trading loop.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Newspaper, RefreshCw } from "lucide-react";
import { getFilings, getNewsFeed, type FilingsPayload, type NewsPayload } from "@/lib/news/news-server";
import { dedupe, impactOf, orderItems, tagItem, type Horizon, type Tagged } from "@/lib/news/feed";
import { ThesisCard } from "./thesis-card";
import { coverageLine, eventDensity, timeline, type TimelineEvent } from "@/lib/news/schedule";
import { fundProfile } from "@/lib/invest/exposure";
import { ALL_DOSSIERS } from "@/lib/invest/dossiers";
import { etToday } from "@/lib/invest/store";

type Filter = "relevant" | Horizon | "all";

const CARD = "min-w-0 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-1)] p-3";
const H3 = "mb-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-muted)]";
const BTN =
  "rounded border border-[var(--color-border)] px-2 py-1 text-[11px] text-[var(--color-fg)] hover:border-[var(--color-accent)] focus:outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-accent)] disabled:opacity-40";

function addDays(date: string, n: number): string {
  return new Date(Date.parse(`${date}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

/** The next N weekdays after `date` (the sessions a 1–2 DTE option lives through). */
function sessionsAhead(date: string, n: number): string {
  let d = date;
  let k = 0;
  while (k < n) {
    d = addDays(d, 1);
    const wd = new Date(`${d}T12:00:00Z`).getUTCDay();
    if (wd !== 0 && wd !== 6) k++;
  }
  return d;
}

function ago(iso: string | null): string {
  if (!iso) return "";
  const m = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (m < 60) return `${Math.max(1, m)}m`;
  if (m < 48 * 60) return `${Math.round(m / 60)}h`;
  return `${Math.round(m / 1440)}d`;
}

function EventRow({ e, clock }: { e: TimelineEvent; clock: "day" | "swing" | "invest" }) {
  const tone =
    e.kind === "macro-high" || e.kind === "fomc"
      ? "text-[var(--color-warn)]"
      : e.kind === "earnings" && (e.qqqWeight ?? 0) >= 0.02
        ? "text-[var(--color-fg)]"
        : "text-[var(--color-muted)]";
  return (
    <li className="border-t border-[var(--color-border)] py-1 first:border-t-0">
      <p className="text-[11px] leading-snug">
        <span className="tabular-nums text-[var(--color-muted)]">
          {clock === "day" ? "" : `${e.date.slice(5)} · `}
          {e.when}
        </span>{" "}
        <span className={`font-medium ${tone}`}>{e.name}</span>
        {e.qqqWeight ? <span className="text-[10px] text-[var(--color-muted)]"> · {(e.qqqWeight * 100).toFixed(1)}% of QQQ</span> : null}
        {e.dossier ? <span className="text-[10px] text-[var(--color-muted)]"> · researched</span> : null}
      </p>
      <p className="text-[10px] leading-snug text-[var(--color-muted)]">{e.implication[clock]}</p>
    </li>
  );
}

export function NewsTab() {
  const [data, setData] = useState<NewsPayload | null>(null);
  const [filings, setFilings] = useState<FilingsPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("relevant");
  const today = etToday();

  const load = useCallback(() => {
    setLoading(true);
    setErr(null);
    void Promise.all([
      getNewsFeed()
        .then(setData)
        .catch((e: unknown) => setErr(e instanceof Error ? e.message : String(e))),
      getFilings()
        .then(setFilings)
        .catch(() => setFilings(null)),
    ]).finally(() => setLoading(false));
  }, []);
  useEffect(() => load(), [load]);

  const qqq = useMemo(() => new Map(fundProfile("QQQ")?.holdings ?? []), []);
  const dossiers = useMemo(() => new Set(ALL_DOSSIERS.filter((d) => d.kind === "company").map((d) => d.ticker)), []);
  const tagged: Tagged[] = useMemo(() => {
    if (!data) return [];
    const w = (t: string) => (t === "GOOGL" ? (qqq.get("GOOGL") ?? 0) + (qqq.get("GOOG") ?? 0) : qqq.get(t) ?? 0);
    return orderItems(dedupe(data.items.map((i) => tagItem(i, w, dossiers))));
  }, [data, qqq, dossiers]);
  const weight = useCallback((t: string) => (t === "GOOGL" ? (qqq.get("GOOGL") ?? 0) + (qqq.get("GOOG") ?? 0) : (qqq.get(t) ?? 0)), [qqq]);
  const shown = tagged.filter((t) =>
    filter === "all" ? true : filter === "relevant" ? t.tier <= 2 : t.horizons.includes(filter) && t.tier <= 2,
  );

  const todayEvents = timeline(today, today);
  const nextHigh = timeline(addDays(today, 1), addDays(today, 30)).find((e) => e.kind === "macro-high" || e.kind === "fomc");
  const swingTo = addDays(today, 14);
  const swing = timeline(addDays(today, 1), swingTo, { minQqqWeight: 0.02 }).filter((e) => e.kind !== "macro-medium");
  const dte2 = eventDensity(addDays(today, 1), sessionsAhead(today, 2));
  const week = eventDensity(addDays(today, 1), sessionsAhead(today, 5));
  const book = timeline(today, addDays(today, 40), { minQqqWeight: 1 }).filter((e) => e.kind === "earnings" && e.dossier);

  const pulse = (data?.pulse ?? []).filter((p) => p.last != null);

  return (
    <div className="space-y-3">
      <header className="flex flex-wrap items-center gap-2">
        <Newspaper size={15} className="text-[var(--color-muted)]" />
        <h2 className="text-sm font-semibold">News</h2>
        <span className="text-[11px] text-[var(--color-muted)]">what matters, by the clock it matters on</span>
        <button type="button" className={`ml-auto flex items-center gap-1 ${BTN}`} onClick={load} disabled={loading}>
          <RefreshCw size={11} /> {loading ? "Loading…" : "Refresh"}
        </button>
      </header>

      <ThesisCard />

      <p className="text-[11px] leading-relaxed text-[var(--color-muted)]">{coverageLine(today)}</p>

      {pulse.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {pulse.map((p) => {
            const chg = p.prevClose ? (p.last! - p.prevClose) / p.prevClose : null;
            return (
              <div key={p.symbol} className="rounded border border-[var(--color-border)] px-2 py-1 text-[11px] tabular-nums">
                <span className="text-[var(--color-muted)]">{p.label} </span>
                <span className="font-medium">{p.symbol === "^TNX" ? `${p.last!.toFixed(2)}%` : p.last!.toFixed(2)}</span>
                {chg != null && (
                  <span className={chg < 0 ? "text-[var(--color-down)]" : "text-[var(--color-up)]"}>
                    {" "}
                    {chg >= 0 ? "+" : ""}
                    {(chg * 100).toFixed(2)}%
                  </span>
                )}
              </div>
            );
          })}
          <span className="self-center text-[10px] text-[var(--color-muted)]">Yahoo, delayed · vs prior close</span>
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <section className={CARD}>
          <h3 className={H3}>Today · futures</h3>
          {todayEvents.length ? (
            <ul>
              {todayEvents.map((e) => (
                <EventRow key={`${e.date}${e.when}${e.name}`} e={e} clock="day" />
              ))}
            </ul>
          ) : (
            <p className="text-[11px] text-[var(--color-muted)]">
              Nothing scheduled today.
              {nextHigh ? ` Next high-impact: ${nextHigh.name}, ${nextHigh.date} ${nextHigh.when} ET.` : ""}
            </p>
          )}
        </section>

        <section className={CARD}>
          <h3 className={H3}>Next 14 days · options</h3>
          <p className="text-[11px] leading-snug">
            <span className="text-[var(--color-muted)]">A 2-DTE option lives through · </span>
            {dte2.line}
          </p>
          <p className="mb-1 text-[11px] leading-snug">
            <span className="text-[var(--color-muted)]">A 5-session swing · </span>
            {week.line}
          </p>
          <ul>
            {swing.slice(0, 14).map((e) => (
              <EventRow key={`${e.date}${e.when}${e.name}`} e={e} clock="swing" />
            ))}
          </ul>
        </section>

        <section className={CARD}>
          <h3 className={H3}>Research book · years</h3>
          {book.length ? (
            <ul>
              {book.map((e) => (
                <EventRow key={`${e.date}${e.name}`} e={e} clock="invest" />
              ))}
            </ul>
          ) : (
            <p className="text-[11px] text-[var(--color-muted)]">No researched company reports in the next 40 days.</p>
          )}
          <div className="mt-2 border-t border-[var(--color-border)] pt-2">
            <p className="text-[10px] uppercase tracking-wide text-[var(--color-muted)]">SEC filings · 45 days</p>
            {filings?.configured ? (
              filings.filings.length ? (
                <ul className="mt-1 space-y-0.5">
                  {filings.filings.slice(0, 12).map((f) => (
                    <li key={f.url} className="text-[11px] leading-snug">
                      <span className="tabular-nums text-[var(--color-muted)]">{f.filed.slice(5)} </span>
                      <span className="font-medium">{f.ticker}</span>{" "}
                      <a href={f.url} target="_blank" rel="noopener noreferrer" className="text-[var(--color-accent)] underline underline-offset-2">
                        {f.form}
                      </a>
                      {f.items ? <span className="text-[10px] text-[var(--color-muted)]"> items {f.items}</span> : null}
                      {f.officerChange && <span className="text-[10px] text-[var(--color-warn)]"> · officer/director change — re-verify the operator</span>}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-[11px] text-[var(--color-muted)]">No filings in the window.</p>
              )
            ) : (
              <p className="text-[10px] leading-snug text-[var(--color-muted)]">{filings?.note ?? "Loading…"}</p>
            )}
          </div>
        </section>
      </div>

      <section className={CARD}>
        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          <h3 className={`${H3} mb-0 mr-2`}>Headlines</h3>
          {(["relevant", "day", "swing", "invest", "predict", "all"] as Filter[]).map((f) => (
            <button
              key={f}
              type="button"
              aria-pressed={filter === f}
              onClick={() => setFilter(f)}
              className={`${BTN} ${filter === f ? "border-[var(--color-accent)]" : ""}`}
            >
              {f === "relevant" ? "Relevant" : f === "day" ? "Futures" : f === "swing" ? "Options" : f === "invest" ? "Book" : f === "predict" ? "Predict" : "All"}
            </button>
          ))}
          {data && (
            <span className="ml-auto text-[10px] text-[var(--color-muted)]">
              {shown.length} of {tagged.length} · fetched {ago(data.fetchedAt)} ago{data.cached ? " (cached)" : ""}
            </span>
          )}
        </div>
        {err && <p className="text-[11px] text-[var(--color-warn)]">Headlines unavailable — {err}</p>}
        {data?.failed.length ? (
          <p className="text-[10px] text-[var(--color-muted)]">Did not load: {data.failed.map((f) => `${f.source} (${f.why})`).join(", ")}</p>
        ) : null}
        <ul className="space-y-1">
          {shown.slice(0, 60).map((t) => (
            <li key={t.id} className="border-t border-[var(--color-border)] pt-1 first:border-t-0">
              <p className="text-[11px] leading-snug">
                <span className="tabular-nums text-[var(--color-muted)]">{ago(t.published)} · {t.source} </span>
                <a href={t.link} target="_blank" rel="noopener noreferrer" className={t.tier === 1 ? "font-medium hover:underline" : "hover:underline"}>
                  {t.title}
                </a>
              </p>
              {t.summary && <p className="line-clamp-2 text-[10px] leading-snug text-[var(--color-muted)]">{t.summary}</p>}
              {impactOf(t, weight) && <p className="text-[10px] leading-snug text-[var(--color-fg)]">→ {impactOf(t, weight)}</p>}
              {(t.tickers.length > 0 || t.topics.length > 0 || t.killRule.length > 0) && (
                <p className="text-[10px] leading-snug text-[var(--color-muted)]">
                  {t.killRule.length > 0 && (
                    <span className="text-[var(--color-warn)]">touches {t.killRule.join("/")}'s kill rule — read it against the rule · </span>
                  )}
                  {[...t.tickers, ...t.topics].join(" · ")}
                </p>
              )}
            </li>
          ))}
        </ul>
        <p className="mt-2 text-[10px] leading-relaxed text-[var(--color-muted)]">
          Tags, summaries and the → line come from the feeds and fixed word lists (company names, macro topics, NFL teams, each
          dossier's kill-rule words), not a model — the model writes only the Thesis card above, on request. Relevant = it
          names a QQQ heavyweight or a researched company, a scheduled-macro topic, or it is a primary source (the Fed, BEA).
          Headlines are strangers' text: open the source before acting on anything.
        </p>
      </section>
    </div>
  );
}
