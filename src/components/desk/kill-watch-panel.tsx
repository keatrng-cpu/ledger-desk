/**
 * The kill-rule check, on demand.
 *
 * Every dossier carries a written kill rule — the one fact that would end the
 * thesis. `kill-watch-server.ts` searches for evidence about each one and
 * returns the CITATIONS; the prose beside them is a finding aid, not a verdict.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO
 * It never marks a rule tripped. `KillResult.tripped` is set only by a human
 * after opening the sources, and there is no control here that sets it — the
 * Invest tab's whole discipline is that a model narrates and a person decides.
 * Search results are strangers' text: data, never instructions.
 *
 * It is a BUTTON rather than a poll because each run spends API budget and the
 * cadence that matters for a multi-year holding is monthly, not per render.
 */

import { useState } from "react";
import { runKillWatch, type KillWatchRun } from "@/lib/invest/kill-watch-server";

export function KillWatchPanel() {
  const [run, setRun] = useState<KillWatchRun | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function go() {
    setBusy(true);
    setErr(null);
    try {
      setRun(await runKillWatch({ data: { sinceDays: 30 } }));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "kill watch failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2.5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[9px] uppercase tracking-wider text-[var(--color-subtle)]">
          Kill rules · evidence since 30d
        </p>
        <button
          type="button"
          onClick={() => void go()}
          disabled={busy}
          className="rounded-[var(--radius-sm)] border border-[var(--color-border)] px-2 py-0.5 font-mono text-[10px] text-[var(--color-fg)] hover:border-[var(--color-accent)] disabled:opacity-50"
        >
          {busy ? "checking…" : "Run check"}
        </button>
      </div>

      {err && <p className="text-[10px] leading-snug text-[var(--color-warn)]">{err}</p>}

      {!run && !err && (
        <p className="text-[10px] leading-snug text-[var(--color-subtle)]">
          Each dossier names the one fact that would end its thesis. This searches
          for evidence about each, and returns sources for you to read — it never
          decides that a rule tripped.
        </p>
      )}

      {run && (
        <>
          <p className="text-[10px] leading-snug text-[var(--color-fg)]">{run.note}</p>
          <ul className="flex flex-col gap-1.5">
            {run.results.map((r) => (
              <li
                key={`${r.ticker}-${r.checkedAt}`}
                className="border-t border-[var(--color-border)] pt-1.5 first:border-t-0 first:pt-0"
              >
                <p className="text-[10px] leading-snug">
                  <span className="font-mono text-[var(--color-fg)]">{r.ticker}</span>{" "}
                  <span className="text-[var(--color-subtle)]">{r.killRule}</span>
                </p>
                {r.summary && (
                  <p className="mt-0.5 text-[10px] leading-snug text-[var(--color-subtle)]">
                    {r.summary}
                  </p>
                )}
                {r.citations.length > 0 ? (
                  <ul className="mt-0.5 flex flex-wrap gap-x-2">
                    {r.citations.slice(0, 5).map((c, i) => (
                      <li key={`${c.url}-${i}`}>
                        <a
                          href={c.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[10px] text-[var(--color-accent)] underline underline-offset-2"
                        >
                          {c.title || new URL(c.url).hostname}
                        </a>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-0.5 text-[10px] text-[var(--color-subtle)]">
                    No sources returned — that is an absence of evidence, not
                    evidence of absence. Check by hand before relying on it.
                  </p>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
