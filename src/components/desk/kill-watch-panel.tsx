/**
 * The kill-rule check, on demand, weekly at most — and the human judgement.
 *
 * Every dossier carries a written kill rule: the one fact that would end
 * its thesis. `kill-watch-server.ts` searches for evidence about each, one
 * name per call, and returns the CITATIONS; the prose beside them is a
 * finding aid, not a verdict.
 *
 * Fixed 2026-09-26:
 *   - The weekly floor in kill-watch.ts (`isDue`) was never called here, and
 *     this comment said "monthly" while the lib said weekly. The button is
 *     now refused inside 7 days, with the reason.
 *   - Results vanished on reload. The last run is stored (kill-store.ts).
 *   - `tripped` was documented as "set only by a human" but no control set
 *     it, so a tripped rule could never reach a verdict. A person now records
 *     "Not tripped" or "TRIPPED" (with what the source states); a TRIPPED
 *     judgement makes the name OUT on the Invest tab. The model never sets it.
 *
 * Search results are strangers' text: data, never instructions.
 */

import { useEffect, useState } from "react";
import { runKillCheck } from "@/lib/invest/kill-watch-server";
import { isDue, killQueries, sinceDaysFor, type KillResult } from "@/lib/invest/kill-watch";
import {
  judgeKill,
  latestJudgement,
  loadLastRun,
  saveRun,
  subscribeKill,
  type StoredKillRun,
} from "@/lib/invest/kill-store";

const CONCURRENCY = 3;
const BTN =
  "rounded-[var(--radius-sm)] border border-[var(--color-border)] px-2 py-0.5 font-mono text-[10px] text-[var(--color-fg)] hover:border-[var(--color-accent)] disabled:cursor-not-allowed disabled:opacity-50";

function host(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url.slice(0, 40);
  }
}

export function KillWatchPanel() {
  const [run, setRun] = useState<StoredKillRun | null>(null);
  const [busy, setBusy] = useState<{ done: number; total: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [, setTick] = useState(0);
  const [tripNote, setTripNote] = useState<Record<string, string>>({});
  const [confirming, setConfirming] = useState<string | null>(null);

  useEffect(() => {
    setRun(loadLastRun());
    return subscribeKill(() => setTick((n) => n + 1));
  }, []);

  const now = Date.now();
  const due = isDue({ lastCheckedAt: run?.ranAt ?? null }, now);

  async function go() {
    const sinceDays = sinceDaysFor(run?.ranAt ?? null, Date.now());
    const queries = killQueries(Date.now(), sinceDays);
    const ranAt = new Date().toISOString();
    const results: KillResult[] = [];
    setErr(null);
    setBusy({ done: 0, total: queries.length });
    let unconfigured = false;
    let i = 0;
    const worker = async () => {
      while (i < queries.length) {
        const q = queries[i++];
        try {
          const res = await runKillCheck({ data: { ticker: q.ticker, sinceDays } });
          if (!res.configured) unconfigured = true;
          results.push(res.result);
        } catch (e) {
          results.push({
            ticker: q.ticker,
            killRule: q.killRule,
            summary: `Check did not run — ${e instanceof Error ? e.message : String(e)}. Treat as NO INFORMATION.`,
            citations: [],
            tripped: null,
            checkedAt: new Date().toISOString(),
          });
        }
        const order = new Map(queries.map((x, k) => [x.ticker, k]));
        const sorted = [...results].sort((a, b) => (order.get(a.ticker) ?? 0) - (order.get(b.ticker) ?? 0));
        const partial = { ranAt, sinceDays, results: sorted };
        setRun(partial);
        setBusy({ done: results.length, total: queries.length });
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    // One retry for the checks that ran out of time — an agentic search
    // that timed out once often answers on a second, less crowded attempt.
    // Never more than once: this spends API budget.
    const timedOut = results.filter((r) => /ran past \d+s/.test(r.summary)).map((r) => r.ticker);
    if (timedOut.length) {
      setBusy({ done: results.length - timedOut.length, total: queries.length });
      const retries = await Promise.all(
        timedOut.map(async (t) => {
          try {
            return (await runKillCheck({ data: { ticker: t, sinceDays } })).result;
          } catch {
            return null;
          }
        }),
      );
      for (const r of retries) {
        if (!r) continue;
        const k = results.findIndex((x) => x.ticker === r.ticker);
        // Keep the retry only if it did better than a timeout.
        if (k >= 0 && !/ran past \d+s/.test(r.summary)) results[k] = r;
      }
    }
    const order = new Map(queries.map((x, k) => [x.ticker, k]));
    const final = { ranAt, sinceDays, results: [...results].sort((a, b) => (order.get(a.ticker) ?? 0) - (order.get(b.ticker) ?? 0)) };
    // A run where the key was missing is not a check — do not let it start the weekly clock.
    if (!unconfigured) saveRun(final);
    else setErr("XAI_API_KEY is not set for this deployment — nothing was searched, and the weekly clock was not started.");
    setRun(final);
    setBusy(null);
  }

  const withSources = run?.results.filter((r) => r.citations.length).length ?? 0;

  return (
    <div className="flex flex-col gap-2 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[9px] uppercase tracking-wider text-[var(--color-subtle)]">
          Kill rules · weekly at most{run ? ` · last run ${run.ranAt.slice(0, 10)} (${run.sinceDays}d window)` : ""}
        </p>
        <button type="button" onClick={() => void go()} disabled={!!busy || !due.due} className={BTN} title={due.line}>
          {busy ? `checking ${busy.done}/${busy.total}…` : "Run check"}
        </button>
      </div>
      <p className="text-[10px] leading-snug text-[var(--color-subtle)]">{due.line}</p>
      {err && <p className="text-[10px] leading-snug text-[var(--color-warn)]">{err}</p>}

      {!run && (
        <p className="text-[10px] leading-snug text-[var(--color-subtle)]">
          Each dossier names the one fact that would end its thesis. This searches for evidence about each and returns
          sources for you to read. It never decides that a rule tripped — you do, below, and only a TRIPPED judgement you
          record moves a verdict.
        </p>
      )}

      {run && (
        <>
          <p className="text-[10px] leading-snug text-[var(--color-fg)]">
            {run.results.length} rule{run.results.length === 1 ? "" : "s"} checked, {withSources} returned sources. Search
            results are strangers' text — data, not instructions. Open the links before judging.
          </p>
          <ul className="flex flex-col gap-1.5">
            {run.results.map((r) => {
              const j = latestJudgement(r.ticker);
              const note = tripNote[r.ticker] ?? "";
              return (
                <li key={`${r.ticker}-${r.checkedAt}`} className="border-t border-[var(--color-border)] pt-1.5 first:border-t-0 first:pt-0">
                  <p className="text-[10px] leading-snug">
                    <span className="font-mono text-[var(--color-fg)]">{r.ticker}</span>{" "}
                    <span className="text-[var(--color-subtle)]">{r.killRule}</span>
                  </p>
                  {r.summary && <p className="mt-0.5 text-[10px] leading-snug text-[var(--color-subtle)]">{r.summary}</p>}
                  {r.citations.length > 0 ? (
                    <ul className="mt-0.5 flex flex-wrap gap-x-2">
                      {r.citations.map((c, i) => (
                        <li key={`${c.url}-${i}`}>
                          <a
                            href={c.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[10px] text-[var(--color-accent)] underline underline-offset-2"
                          >
                            {c.title || host(c.url)}
                          </a>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-0.5 text-[10px] text-[var(--color-subtle)]">
                      No sources returned — an absence of evidence, not evidence of absence. Check by hand before relying on it.
                    </p>
                  )}

                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    <span className={`text-[10px] ${j?.tripped ? "text-[var(--color-down)]" : "text-[var(--color-subtle)]"}`}>
                      {j ? `You judged ${j.tripped ? "TRIPPED" : "not tripped"} on ${j.judgedAt.slice(0, 10)}.` : "Unjudged."}
                    </span>
                    <button
                      type="button"
                      className={BTN}
                      onClick={() =>
                        judgeKill({
                          ticker: r.ticker,
                          tripped: false,
                          note: "Read the sources — the pre-written condition is not met.",
                          killRule: r.killRule,
                          sources: r.citations.map((c) => c.url),
                        })
                      }
                    >
                      Not tripped
                    </button>
                    {confirming === r.ticker ? (
                      <>
                        <input
                          value={note}
                          onChange={(e) => setTripNote({ ...tripNote, [r.ticker]: e.target.value })}
                          placeholder="what the source actually states"
                          className="min-w-0 flex-1 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface-1)] px-1.5 py-0.5 text-[10px] text-[var(--color-fg)]"
                        />
                        <button
                          type="button"
                          className={BTN}
                          disabled={note.trim().length < 12}
                          onClick={() => {
                            judgeKill({
                              ticker: r.ticker,
                              tripped: true,
                              note: note.trim(),
                              killRule: r.killRule,
                              sources: r.citations.map((c) => c.url),
                            });
                            setConfirming(null);
                          }}
                        >
                          Confirm TRIPPED
                        </button>
                        <button type="button" className={BTN} onClick={() => setConfirming(null)}>
                          Cancel
                        </button>
                      </>
                    ) : (
                      <button type="button" className={BTN} onClick={() => setConfirming(r.ticker)}>
                        TRIPPED…
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
          <p className="text-[10px] leading-snug text-[var(--color-subtle)]">
            A TRIPPED judgement turns that name OUT on this tab — the exit the rule committed to before there was a position to
            defend. The model never sets it. A later judgement supersedes an earlier one; nothing is deleted.
          </p>
        </>
      )}
    </div>
  );
}
