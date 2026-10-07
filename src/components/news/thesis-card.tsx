/**
 * The thesis card at the top of the News tab: a summary, an analysis and the
 * impact on each book, written on request by Grok (web search, cited) with
 * Claude as the peer. Loads once when the tab opens; the server shares one
 * result per 10 minutes. Narration — never read by a gate.
 */

import { useCallback, useEffect, useState } from "react";
import { CloudOff, ExternalLink, RefreshCw, Sparkles } from "lucide-react";
import { isConfigGap, scrubEnv, SETUP_URL } from "@/lib/ui/offline";
import { getNewsThesis } from "@/lib/news/thesis-server";
import type { ThesisResult, ThesisRun } from "@/lib/news/thesis";

const CARD = "min-w-0 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-1)] p-3";
const H4 = "text-[10px] font-semibold uppercase tracking-wide text-[var(--color-muted)]";
const BTN =
  "rounded border border-[var(--color-border)] px-2 py-1 text-[11px] text-[var(--color-fg)] hover:border-[var(--color-accent)] focus:outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-accent)] disabled:opacity-40";

const host = (u: string) => {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return u;
  }
};

function Bullets({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <div>
      <p className={H4}>{title}</p>
      <ul className="ml-4 list-disc space-y-0.5">
        {items.map((x, i) => (
          <li key={i}>{x}</li>
        ))}
      </ul>
    </div>
  );
}

function ThesisView({ run }: { run: ThesisRun }) {
  const t = run.thesis;
  if (!t) return run.raw ? <p className="whitespace-pre-wrap text-[11px] leading-relaxed">{run.raw}</p> : null;
  const impacts: [string, string][] = [
    ["Futures · MNQ/ES", t.impacts.futures],
    ["Options · QQQ/SPY", t.impacts.options],
    ["Investing · the book", t.impacts.investing],
    ["Predictions · games", t.impacts.predictions],
  ];
  return (
    <div className="space-y-2 text-[11px] leading-relaxed">
      <p className="text-xs font-semibold leading-snug">
        {t.headline}
        {t.confidence && <span className="ml-2 rounded border border-[var(--color-border)] px-1.5 text-[10px] font-normal text-[var(--color-muted)]">confidence {t.confidence}</span>}
      </p>
      <Bullets title="Summary" items={t.summary} />
      <Bullets title="Analysis" items={t.analysis} />
      <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
        {impacts
          .filter(([, v]) => v)
          .map(([k, v]) => (
            <div key={k} className="rounded border border-[var(--color-border)] p-1.5">
              <p className={H4}>{k}</p>
              <p>{v}</p>
            </div>
          ))}
      </div>
      <Bullets title="What would change it" items={t.watch} />
      {run.sources.length > 0 && (
        <p className="text-[10px] text-[var(--color-muted)]">
          Sources:{" "}
          {run.sources.map((s, i) => (
            <span key={s.url}>
              {i > 0 && " · "}
              <a href={s.url} target="_blank" rel="noopener noreferrer" className="text-[var(--color-accent)] underline underline-offset-2">
                {s.title ?? host(s.url)}
              </a>
            </span>
          ))}
        </p>
      )}
    </div>
  );
}

/**
 * Survives unmount/remount (switching tabs and back) within the same page
 * load — the server already shares one build per 10 minutes; the card used
 * to throw that away on every close, so reopening it always meant a blank
 * "Reading the feeds…" flash while it re-fetched a result that was often
 * already sitting in the server cache. Module-level, not component state,
 * on purpose: it must outlive this component instance.
 */
let lastResult: ThesisResult | null = null;

export function ThesisCard() {
  const [res, setRes] = useState<ThesisResult | null>(() => lastResult);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const run = useCallback(() => {
    setLoading(true);
    setErr(null);
    void getNewsThesis()
      .then((data) => {
        // Only touch state/UI when something actually changed — a re-fetch
        // that lands on the same server-cached build must not repaint or
        // reset any per-render UI (e.g. an open <details>) for no reason.
        if (data.generatedAt !== lastResult?.generatedAt) {
          lastResult = data;
          setRes(data);
        }
      })
      .catch((e: unknown) => setErr(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => run(), [run]);

  const p = res?.primary ?? null;
  // Every model that was tried failed for want of a key/setting → one calm
  // offline card. No env var names, no per-model error dump.
  const noRun = !!res && !(p && (p.thesis || p.raw)) && !(res.second && (res.second.thesis || res.second.raw));
  const offline = noRun && res!.tried.length > 0 && res!.tried.every((t) => !t.ok && isConfigGap(t.error));
  if (offline) {
    return (
      <section className={`${CARD} flex flex-wrap items-center gap-3`} role="status">
        <CloudOff size={16} className="shrink-0 text-[var(--color-muted)]" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-[12px] font-semibold text-[var(--color-fg)]">AI thesis offline</p>
          <p className="text-[11px] leading-snug text-[var(--color-muted)]">
            The model connection isn&apos;t set up on this server, so there&apos;s no written thesis. Everything below — the
            calendar, the timeline and each headline&apos;s summary and impact — still works without it.
          </p>
        </div>
        <a href={SETUP_URL} target="_blank" rel="noopener noreferrer" className={`flex items-center gap-1 ${BTN}`}>
          Setup <ExternalLink size={11} aria-hidden />
        </a>
      </section>
    );
  }
  const at = res ? new Date(res.generatedAt).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" }) : null;
  return (
    <section className={`${CARD} border-[color-mix(in_oklab,var(--color-accent)_40%,transparent)]`}>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Sparkles size={13} className="text-[var(--color-accent)]" />
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-muted)]">Thesis · summary, analysis, impacts</h3>
        {p && (
          <span className="text-[10px] text-[var(--color-muted)]">
            {p.model}
            {p.webSearch ? " + web search" : ""} · {at} ET{res?.cached ? " (shared, ≤10 min old)" : ""}
          </span>
        )}
        <button type="button" className={`ml-auto flex items-center gap-1 ${BTN}`} onClick={run} disabled={loading}>
          <RefreshCw size={11} /> {loading ? "Thinking…" : "Rebuild"}
        </button>
      </div>
      {loading && !res && <p className="text-[11px] text-[var(--color-muted)]">Reading the feeds, the calendar, the pulse and today's games, and searching other sources… up to ~25 seconds.</p>}
      {err && <p className="text-[11px] text-[var(--color-warn)]">Thesis unavailable — {scrubEnv(err)}</p>}
      {res && p && (p.thesis || p.raw) ? (
        <ThesisView run={p} />
      ) : res ? (
        <p className="text-[11px] text-[var(--color-warn)]">
          No thesis this time. The headlines below still carry each story's summary and what it moves.
        </p>
      ) : null}
      {res?.second && (res.second.thesis || res.second.raw) && (
        <details className="mt-2">
          <summary className="cursor-pointer text-[10px] text-[var(--color-muted)]">
            Second opinion — {res.second.model}
            {res.second.webSearch ? " + web search" : " (headlines only)"}
          </summary>
          <div className="mt-1">
            <ThesisView run={res.second} />
          </div>
        </details>
      )}
      {res && (
        <p className="mt-2 text-[10px] leading-snug text-[var(--color-muted)]">
          Built from {res.inputs.headlines} headlines, {res.inputs.events} calendar events and {res.inputs.games} games
          {res.inputs.feedsFailed.length ? `; feeds down (searched around): ${res.inputs.feedsFailed.join(", ")}` : ""}. A model's
          narration, not a signal — it never sizes or calls a trade, and the desk's gates decide.
        </p>
      )}
      {res && res.tried.some((t) => t.error) && (
        <p className="mt-1 text-[10px] leading-snug text-[var(--color-muted)]">
          Tried: {res.tried.map((t) => `${t.model} ${t.ok ? "✓" : `— ${isConfigGap(t.error) ? "offline (not set up)" : scrubEnv(t.error ?? "no JSON")}`}`).join(" · ")}
        </p>
      )}
    </section>
  );
}
