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

const STORAGE_KEY = "ledger.discuss.on";
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
  const fallback = voice ? (voice.error ?? "No text.") : keyPresent ? "Not called this checkpoint — see the error above." : "No key configured for this provider.";
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

function ExchangeCard({ entry }: { entry: Entry }) {
  const { round1, round2 } = entry.exchange;
  const bothAgree = agree(parseDiscussRead(round1.grok?.text).bias, parseDiscussRead(round1.claude?.text).bias);
  const nothingCameBack = !round1.grok?.text && !round1.claude?.text;
  return (
    <div className={CARD}>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs font-semibold text-[var(--color-fg)]">{entry.slot} ET</span>
        <span className="text-[10px] text-[var(--color-muted)]">
          {new Date(entry.at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit" })} local
        </span>
        {bothAgree && <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-up)]">both agree</span>}
      </div>

      {/* The exchange's own error was silently dropped before — this is the
          one place it renders. Shown whenever round 1 came back completely
          empty, which is exactly when a trader most needs to know WHY. */}
      {entry.exchange.error && (nothingCameBack || !entry.exchange.configured) && (
        <p className="mb-2 rounded-[var(--radius-sm)] border border-[color-mix(in_oklab,var(--color-warn)_45%,transparent)] bg-[color-mix(in_oklab,var(--color-warn)_8%,transparent)] px-2 py-1.5 text-[11px] text-[var(--color-warn)]">
          {entry.exchange.error}
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

      <p className="text-[10px] uppercase tracking-wide text-[var(--color-muted)]">
        XAI {desk.coach?.xai ? "ACTIVE" : "MISSING"} · Anthropic {desk.coach?.anthropic ? "ACTIVE" : "MISSING"} · reads Now's PATH
        candidate, Options' overnight board, and Charts' timeframe ladder every time.
      </p>

      {history.length === 0 ? (
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
        already decided those. History resets when this tab (or the page) reloads; it is a same-session check, not a
        permanent record.
      </p>
    </div>
  );
}
