/**
 * Discuss — its own tab (trader's call 2026-09-28), separate from Brain's
 * on-demand coach. At 6 fixed ET checkpoints (09:25, 09:32, 09:35, 09:40,
 * 09:45, 10:00 — ai-sync.ts) Grok and Claude each read the SAME desk
 * snapshot (Now's PATH candidate, Options' overnight board, Charts' ladder —
 * see coach/context.ts) independently, give a two-paragraph read, then each
 * replies once to the OTHER's read.
 *
 * WHAT THIS IS FOR, IN THE TRADER'S OWN WORDS: "their discussion isn't added
 * into any grades, it's more of a backup probability security thing... if
 * the desk has a good trade score and grok/claude are in agreement, I look
 * at the charts with less nerves." A DISAGREE changes nothing the desk does.
 */

import { useEffect, useRef, useState } from "react";
import { MessagesSquare, RefreshCw } from "lucide-react";
import type { DeskPayload } from "@/lib/trading/build-desk";
import { askDeskDiscuss, type DiscussExchange } from "@/lib/coach/claude-server";
import { buildCoachContext } from "@/lib/coach/context";
import { AI_SYNC_TIMES, dueAiSyncSlot, parseDiscussRead, type DiscussBias } from "@/lib/coach/ai-sync";
import { etWallParts } from "@/lib/trading/sessions";
import { isConfigGap, scrubEnv, SETUP_URL } from "@/lib/ui/offline";

const STORAGE_KEY = "ledger.discuss.on";
/** The most recent exchange, kept so a reload still shows the last transcript. Display only. */
const LAST_KEY = "ledger.discuss.last";

function readLast(): Entry | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(LAST_KEY);
    return raw ? (JSON.parse(raw) as Entry) : null;
  } catch {
    return null;
  }
}

/**
 * Seconds to the next scheduled checkpoint (weekdays; exchange holidays are
 * not modelled — the scheduler itself fires on any weekday minute match).
 */
function nextCheckpoint(nowMs: number): { slot: string; secs: number } {
  const p = etWallParts(nowMs);
  const sod = p.hour * 3600 + p.minute * 60 + p.second;
  const weekday = p.weekday >= 1 && p.weekday <= 5;
  if (weekday) {
    for (const t of AI_SYNC_TIMES) {
      const at = t.hour * 3600 + t.minute * 60;
      if (at > sod) return { slot: t.slot, secs: at - sod };
    }
  }
  let days = 1;
  let wd = (p.weekday + 1) % 7;
  while (wd === 0 || wd === 6) {
    days += 1;
    wd = (wd + 1) % 7;
  }
  const first = AI_SYNC_TIMES[0];
  return { slot: first.slot, secs: days * 86400 - sod + first.hour * 3600 + first.minute * 60 };
}

function fmtCountdown(secs: number): string {
  const d = Math.floor(secs / 86400);
  const h = Math.floor((secs % 86400) / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  if (d > 0) return `${d}d ${pad(h)}:${pad(m)}:${pad(s)}`;
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

/** Errors from a provider that simply isn't configured read as "offline", never as env names. */
function calm(err: string | null | undefined): string | null {
  if (!err) return null;
  return isConfigGap(err) ? "Offline — this voice isn't set up on the server." : scrubEnv(err);
}

function VoiceChip({ name, live }: { name: string; live: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
        live
          ? "border-[color-mix(in_oklab,var(--color-up)_45%,transparent)] text-[var(--color-up)]"
          : "border-[var(--color-border)] text-[var(--color-subtle)]"
      }`}
      title={live ? `${name} will read the desk at each checkpoint` : `${name} is offline — not set up on the server`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${live ? "bg-[var(--color-up)]" : "bg-[var(--color-subtle)]"}`} />
      {name} {live ? "live" : "offline"}
    </span>
  );
}
const CARD = "min-w-0 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-1)] p-3";
const BTN =
  "rounded border border-[var(--color-border)] px-2 py-1 text-[11px] text-[var(--color-fg)] hover:border-[var(--color-accent)] focus:outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-accent)] disabled:opacity-40";

interface Entry {
  slot: string;
  at: string;
  exchange: DiscussExchange;
  /** Key presence AT FIRE TIME — so a historical card reads correctly even if the desk's own coach status changes later in the session. */
  xaiPresent: boolean;
  anthropicPresent: boolean;
}

const BIAS_STYLE: Record<DiscussBias, string> = {
  bullish: "border-[var(--color-up)] text-[var(--color-up)]",
  bearish: "border-[var(--color-down)] text-[var(--color-down)]",
  neutral: "border-[var(--color-border)] text-[var(--color-muted)]",
};

function ReadTag({ text }: { text: string | null | undefined }) {
  const r = parseDiscussRead(text);
  if (!r.bias) return null;
  return (
    <span className={`rounded border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${BIAS_STYLE[r.bias]}`}>
      {r.bias}
      {r.confidence ? ` · ${r.confidence}` : ""}
    </span>
  );
}

function agree(a: DiscussBias | null, b: DiscussBias | null): boolean {
  return a != null && a === b;
}

function VoiceBlock({
  label,
  voice,
  keyPresent,
}: {
  label: string;
  voice: { text: string | null; error: string | null } | null | undefined;
  /** Whether this provider's key was present at fire time — distinguishes "no key" from a real API failure when `voice` itself is null. */
  keyPresent: boolean;
}) {
  const text = voice?.text;
  // `voice` is null only when askDeskDiscuss never called that provider (its
  // key was absent server-side) OR the whole checkpoint failed before either
  // provider ran (see the exchange-level banner in ExchangeCard) — say which,
  // instead of the misleading generic "No text." both used to show here.
  const fallback = voice
    ? (calm(voice.error) ?? "No text.")
    : keyPresent
      ? "Not called this checkpoint — see the note above."
      : "Offline — this voice isn't set up on the server.";
  return (
    <div className="min-w-0 flex-1 rounded-[var(--radius-sm)] border border-[color-mix(in_oklab,var(--color-primary)_28%,var(--color-border))] bg-[color-mix(in_oklab,var(--color-primary)_5%,transparent)] px-2.5 py-2">
      <div className="mb-1 flex items-center gap-1.5">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--color-primary)]">{label}</p>
        <ReadTag text={text} />
      </div>
      {text ? (
        <p className="whitespace-pre-wrap text-[11px] leading-relaxed text-[var(--color-fg)]">{text}</p>
      ) : (
        <p className="text-[11px] text-[var(--color-warn)]">{fallback}</p>
      )}
    </div>
  );
}

function ExchangeCard({ entry, label }: { entry: Entry; label?: string }) {
  const { round1, round2 } = entry.exchange;
  const bothAgree = agree(parseDiscussRead(round1.grok?.text).bias, parseDiscussRead(round1.claude?.text).bias);
  const nothingCameBack = !round1.grok?.text && !round1.claude?.text;
  return (
    <div className={CARD}>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        {label && (
          <span className="rounded border border-[var(--color-border)] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-[var(--color-subtle)]">
            {label}
          </span>
        )}
        <span className="font-mono text-xs font-semibold text-[var(--color-fg)]">
          {entry.slot === "manual" ? "Manual run" : `${entry.slot} ET`}
        </span>
        <span className="text-[10px] text-[var(--color-muted)]">
          {new Date(entry.at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit" })} local
        </span>
        {bothAgree && <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-up)]">both agree</span>}
      </div>

      {/* The exchange's own error was silently dropped before — this is the
          one place it renders. Shown whenever round 1 came back completely
          empty, which is exactly when a trader most needs to know WHY. */}
      {entry.exchange.error && (nothingCameBack || !entry.exchange.configured) && (
        <p className="mb-2 rounded-[var(--radius-sm)] border border-[color-mix(in_oklab,var(--color-warn)_45%,transparent)] bg-[color-mix(in_oklab,var(--color-warn)_8%,transparent)] px-2 py-1.5 text-[11px] text-[var(--color-warn)]">
          {calm(entry.exchange.error)}
        </p>
      )}

      <p className="mb-1 text-[9px] font-semibold uppercase tracking-wider text-[var(--color-subtle)]">Round 1 · independent reads</p>
      <div className="mb-2 flex flex-col gap-2 sm:flex-row">
        <VoiceBlock label="Grok" voice={round1.grok} keyPresent={entry.xaiPresent} />
        <VoiceBlock label="Claude" voice={round1.claude} keyPresent={entry.anthropicPresent} />
      </div>

      {(round2.grokReply?.text || round2.claudeReply?.text) && (
        <>
          <p className="mb-1 text-[9px] font-semibold uppercase tracking-wider text-[var(--color-subtle)]">Round 2 · one reply each, to the other's read</p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <VoiceBlock label="Grok replies to Claude" voice={round2.grokReply} keyPresent={entry.xaiPresent} />
            <VoiceBlock label="Claude replies to Grok" voice={round2.claudeReply} keyPresent={entry.anthropicPresent} />
          </div>
        </>
      )}
    </div>
  );
}

export function DiscussTab({ desk }: { desk: DeskPayload }) {
  const [on, setOn] = useState(() => {
    if (typeof window === "undefined") return true;
    try {
      return window.localStorage.getItem(STORAGE_KEY) !== "0";
    } catch {
      return true;
    }
  });
  const [history, setHistory] = useState<Entry[]>([]);
  const [running, setRunning] = useState(false);
  const [last, setLast] = useState<Entry | null>(() => readLast());
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  useEffect(() => {
    const newest = history[0];
    if (!newest) return;
    setLast(newest);
    try {
      window.localStorage.setItem(LAST_KEY, JSON.stringify(newest));
    } catch {
      /* storage unavailable — the in-session history still shows */
    }
  }, [history]);
  const firedRef = useRef<Set<string>>(new Set());
  const inFlightRef = useRef(false);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, on ? "1" : "0");
    } catch {
      /* storage unavailable — the toggle still works for this tab */
    }
  }, [on]);

  const fire = async (slot: string) => {
    inFlightRef.current = true;
    const xaiPresent = Boolean(desk.coach?.xai);
    const anthropicPresent = Boolean(desk.coach?.anthropic);
    try {
      const exchange = await askDeskDiscuss({ data: { ...buildCoachContext(desk, undefined), slot } });
      setHistory((h) => [{ slot, at: new Date().toISOString(), exchange, xaiPresent, anthropicPresent }, ...h]);
    } catch (e) {
      setHistory((h) => [
        {
          slot,
          at: new Date().toISOString(),
          xaiPresent,
          anthropicPresent,
          exchange: {
            configured: xaiPresent || anthropicPresent,
            error: e instanceof Error ? e.message : "Discussion failed — the request itself did not complete (network or auth).",
            round1: { grok: null, claude: null },
            round2: { grokReply: null, claudeReply: null },
          },
        },
        ...h,
      ]);
    } finally {
      inFlightRef.current = false;
    }
  };

  // The automatic checkpoints — checked on every desk refresh, only actually
  // fires at the 6 fixed ET minutes, at most once each per ET day.
  useEffect(() => {
    if (!on || inFlightRef.current) return;
    if (!desk.coach?.xai && !desk.coach?.anthropic) return;
    const due = dueAiSyncSlot(new Date(), firedRef.current);
    if (!due) return;
    firedRef.current.add(due.key); // mark fired BEFORE the await — never double-fire a slot
    void fire(due.slot);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fire is stable enough for this poll-driven check; re-creating it on every desk tick is the point.
  }, [desk, on]);

  // Display only — dueAiSyncSlot (checked in the effect above) is the real clock.
  const nextUp = AI_SYNC_TIMES.map((t) => t.slot).find((s) => !history.some((h) => h.slot === s));
  const next = nextCheckpoint(now);
  const grokLive = Boolean(desk.coach?.xai);
  const claudeLive = Boolean(desk.coach?.anthropic);
  const speakers = [grokLive && "Grok", claudeLive && "Claude"].filter(Boolean) as string[];
  const preview =
    speakers.length === 2
      ? "Run now → Grok and Claude each read the desk, then one reply each to the other."
      : speakers.length === 1
        ? `Run now → only ${speakers[0]} reads the desk (the other voice is offline), no round 2.`
        : "Run now → nobody would speak: both voices are offline.";

  return (
    <div className="space-y-3">
      <header className="flex flex-wrap items-center gap-2">
        <MessagesSquare size={15} className="text-[var(--color-muted)]" />
        <h2 className="text-sm font-semibold">Discuss</h2>
        <span className="text-[11px] text-[var(--color-muted)]">
          Grok + Claude, independent reads then one reply each — a confidence check, never a gate
        </span>
        <div className="ml-auto flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-[11px] text-[var(--color-muted)]">
            <input type="checkbox" checked={on} onChange={(e) => setOn(e.target.checked)} />
            automatic (09:25–10:00 ET)
          </label>
          <button type="button" className={`flex items-center gap-1 ${BTN}`} disabled={running} onClick={() => void (async () => { setRunning(true); await fire("manual"); setRunning(false); })()}>
            <RefreshCw size={11} className={running ? "animate-spin" : ""} /> {running ? "Discussing…" : "Run now"}
          </button>
        </div>
      </header>

      <div className={`${CARD} flex flex-wrap items-center gap-4`}>
        <div>
          <p className="text-[9px] font-semibold uppercase tracking-wider text-[var(--color-subtle)]">
            Next checkpoint · {next.slot} ET
          </p>
          <p
            className={`font-mono text-3xl font-semibold tabular-nums ${on ? "text-[var(--color-fg)]" : "text-[var(--color-subtle)]"}`}
            title={on ? "Fires automatically at this ET minute" : "Automatic is off — this checkpoint will not fire"}
          >
            {fmtCountdown(next.secs)}
          </p>
          <p className="mt-0.5 flex flex-wrap gap-1 font-mono text-[9px] text-[var(--color-subtle)]">
            {AI_SYNC_TIMES.map((t) => (
              <span
                key={t.slot}
                className={
                  t.slot === next.slot
                    ? "text-[var(--color-primary)]"
                    : history.some((h) => h.slot === t.slot)
                      ? "text-[var(--color-up)]"
                      : ""
                }
              >
                {t.slot}
              </span>
            ))}
            {!on && <span className="text-[var(--color-warn)]">· automatic off</span>}
          </p>
        </div>
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <VoiceChip name="Grok" live={grokLive} />
            <VoiceChip name="Claude" live={claudeLive} />
            {(!grokLive || !claudeLive) && (
              <a
                href={SETUP_URL}
                target="_blank"
                rel="noreferrer"
                className="text-[10px] text-[var(--color-primary)] underline-offset-2 hover:underline"
              >
                Setup
              </a>
            )}
          </div>
          <p className="text-[11px] text-[var(--color-muted)]">{preview}</p>
          <p className="text-[10px] text-[var(--color-subtle)]">
            Reads Now&apos;s PATH candidate, Options&apos; overnight board, and Charts&apos; timeframe ladder every time.
          </p>
        </div>
      </div>

      {history.length === 0 && last ? (
        <ExchangeCard entry={last} label="Last session" />
      ) : history.length === 0 ? (
        <p className={`${CARD} text-[11px] text-[var(--color-muted)]`}>
          {on
            ? `Waiting for the next checkpoint — ${AI_SYNC_TIMES.map((t) => t.slot).join(", ")} ET. ${nextUp ? `Next up: ${nextUp} ET.` : ""} Or click "Run now" to try it immediately.`
            : "Automatic is off. Click \"Run now\" for a one-off exchange, or turn it back on for the 6 scheduled checkpoints."}
        </p>
      ) : (
        <div className="space-y-3">
          {history.map((e) => (
            <ExchangeCard key={`${e.slot}-${e.at}`} entry={e} />
          ))}
        </div>
      )}

      <p className="text-[10px] leading-relaxed text-[var(--color-muted)]">
        Each round-1 read ends with the model's own "Read: bias · confidence" line — a badge off its own words, not a
        computed figure. Round 2 is one reply each to the other's read, correcting or adding a fact or a probability if
        warranted. Neither round ever produces a new entry, target, stop, or size — the desk's deterministic scoring
        already decided those. Only the most recent exchange is kept in this browser across reloads (shown as
        &quot;Last session&quot;); it is a same-session check, not a permanent record.
      </p>
    </div>
  );
}
