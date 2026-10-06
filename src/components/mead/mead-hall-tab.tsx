/**
 * The Mead Hall — a pine/iron/brass sports bar for prediction markets.
 *
 * Data: the real PredictionMarketFeed (`getPredictionMarketFeed`, Kalshi
 * public read-only — broad sports / econ / politics, ranked by setup quality,
 * NFL a mild tie-break). DEV shows the feed's labelled MOCK rows only when
 * Kalshi returns nothing.
 *
 * PAPER ONLY. Every YES / NO tap opens a paper ticket that writes the predict
 * journal (`logEntry`). There is no order path from this tab.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Beer, Camera, RefreshCw, Ticket, X } from "lucide-react";
import { getPredictionMarketFeed } from "@/lib/predict/predict-server";
import { KALSHI_SOURCE_LABEL, type PredictionMarket, type PredictionMarketFeedState } from "@/lib/predict/prediction-market-feed";
import { logEntry, readJournal, subscribePredict } from "@/lib/predict/journal";
import { VENUES, sideFee, type VenueId } from "@/lib/predict/math";
import { ENTRY_STYLE } from "@/components/desk/use-entry-state";
import { createMeadFeed, type MeadFeed } from "./mead-feed";
import { MeadScene, marketById, type MeadMood, type Reaction, type TicketSide } from "./mead-scene";
import { MEAD, categoryLabel, cents, edgeTag, eventLabel, gradeColor, pct, setupGradeLabel } from "./mead-screens";

const CARD = "min-w-0 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-1)] p-3";
const BTN =
  "inline-flex items-center gap-1 rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-[11px] text-[var(--color-fg)] hover:border-[var(--color-primary)] focus:outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-primary)] disabled:opacity-40";
const INPUT = "rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-1.5 py-0.5 text-[12px] text-[var(--color-fg)]";

const REACT_COLOR: Record<Reaction, string> = { cheer: "#22c55e", groan: "#ef4444", hail: MEAD.brass };

function useMeadFeed(): [PredictionMarketFeedState, MeadFeed | null] {
  const feed = useRef<MeadFeed | null>(null);
  const [state, setState] = useState<PredictionMarketFeedState>({ markets: [], topIds: [], featuredId: null, status: "idle", league: "nfl", fetchedAt: null, note: "" });
  useEffect(() => {
    // 30 s: the feed fans out to ~8 Kalshi series per read and Kalshi rate-limits (HTTP 429) shared IPs.
    const f = createMeadFeed({ load: () => getPredictionMarketFeed({ data: {} }), every: 30_000 });
    feed.current = f;
    const off = f.subscribe(setState);
    return () => {
      off();
      f.dispose();
      feed.current = null;
    };
  }, []);
  return [state, feed.current];
}

interface TicketDraft {
  market: PredictionMarket;
  side: TicketSide;
}

function PaperTicket({ draft, onClose }: { draft: TicketDraft; onClose: () => void }) {
  const { market: m, side } = draft;
  const quoted = side === "YES" ? m.yesPrice : m.noPrice;
  const [contracts, setContracts] = useState("10");
  const [price, setPrice] = useState(quoted != null ? String(Math.round(quoted * 100)) : "");
  const [venue, setVenue] = useState<VenueId>("rh-rothera");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const mock = m.source === "mock";
  const px = Number(price) / 100;
  const n = Math.round(Number(contracts));
  const fees = VENUES[venue];
  const cost = px > 0 && px < 1 && n > 0 ? px * n + sideFee(px, n, fees) : null;
  const ref = m.winChance == null ? null : side === "YES" ? m.winChance : Math.round((1 - m.winChance) * 10_000) / 10_000;
  const submit = () => {
    if (mock) return;
    const r = logEntry({
      league: categoryLabel(m).toLowerCase(),
      game: eventLabel(m),
      ticker: m.id,
      team: side === "YES" ? m.outcome : `NO · ${m.outcome}`,
      contracts: n,
      entry: px,
      referenceAtEntry: ref,
      referenceName: "Mead Hall win chance (Kalshi mid)",
      venue,
      note: `PAPER · Mead Hall ${side} tap`,
    });
    setMsg(r.ok ? { ok: true, text: `Paper ticket logged: ${n} × ${side} ${m.outcome} at ${Math.round(px * 100)}¢ (${fees.label}). No order was sent anywhere.` } : { ok: false, text: r.why });
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3" role="dialog" aria-modal="true" aria-label="Paper ticket" data-testid="mead-ticket">
      <div className="w-full max-w-md rounded-xl border-2 p-4 shadow-2xl" style={{ borderColor: MEAD.brass, background: "linear-gradient(180deg,#122820,#0a1610)" }}>
        <div className="mb-2 flex items-start justify-between gap-2">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-widest" style={{ color: MEAD.brass }}>
              Paper ticket · The Mead Hall
            </div>
            <div className="text-lg font-black text-white">
              <span style={{ color: side === "YES" ? "#4ade80" : "#f87171" }}>{side}</span> · {m.outcome}
            </div>
            <div className="text-[12px] text-emerald-100/80">
              {categoryLabel(m)} · {eventLabel(m)}
            </div>
          </div>
          <button type="button" className="rounded p-1 text-emerald-100/80 hover:text-white" onClick={onClose} aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="mb-3 grid grid-cols-3 gap-2 text-center text-[11px] text-emerald-50/90">
          <div className="rounded bg-black/30 p-1.5">
            <div className="opacity-70">Quoted {side}</div>
            <div className="text-base font-black text-white">{cents(quoted)}</div>
          </div>
          <div className="rounded bg-black/30 p-1.5">
            <div className="opacity-70">Win chance</div>
            <div className="text-base font-black text-white">{pct(ref)}</div>
          </div>
          <div className="rounded bg-black/30 p-1.5">
            <div className="opacity-70">Grade · gates</div>
            <div className="text-base font-black" style={{ color: MEAD.brass }}>
              {setupGradeLabel(m.setupGrade)} · {m.gates.passed}/{m.gates.total}
            </div>
          </div>
        </div>
        {m.gates.missing && <div className="mb-2 text-[11px] text-emerald-100/80">Missing: {m.gates.missing}</div>}
        <div className="flex flex-wrap items-end gap-2 text-[11px] text-emerald-50/90">
          <label>
            Contracts
            <input className={`ml-1 w-16 ${INPUT}`} value={contracts} inputMode="numeric" onChange={(e) => setContracts(e.target.value)} />
          </label>
          <label>
            Price ¢
            <input className={`ml-1 w-14 ${INPUT}`} value={price} inputMode="numeric" onChange={(e) => setPrice(e.target.value)} />
          </label>
          <label>
            Venue
            <select className={`ml-1 ${INPUT}`} value={venue} onChange={(e) => setVenue(e.target.value as VenueId)}>
              {Object.values(VENUES).map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="mt-2 text-[11px] text-emerald-100/80">{cost != null ? `Paper cost incl. entry fee: $${cost.toFixed(2)} · pays $${n.toFixed(0)} if ${side} settles.` : "Enter contracts and a price between 1¢ and 99¢."}</div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            data-testid="mead-ticket-log"
            disabled={mock || cost == null || msg?.ok === true}
            onClick={submit}
            className="inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-[13px] font-black text-[#0a1610] disabled:opacity-40"
            style={{ background: MEAD.brass }}
          >
            <Ticket className="h-4 w-4" /> Log PAPER ticket
          </button>
          <button type="button" className="rounded-md border border-emerald-300/30 px-3 py-1.5 text-[12px] text-emerald-50/90" onClick={onClose}>
            {msg?.ok ? "Done" : "Cancel"}
          </button>
        </div>
        {mock && <div className="mt-2 rounded bg-orange-900/50 p-1.5 text-[11px] text-orange-200">MOCK row (DEV only) — synthetic prices are never written to your journal.</div>}
        {msg && <div className={`mt-2 text-[11px] ${msg.ok ? "text-green-300" : "text-red-300"}`}>{msg.text}</div>}
        <div className="mt-3 border-t border-emerald-300/20 pt-2 text-[10px] text-emerald-200/70">
          PAPER ONLY — this writes the predict journal on this device. The Mead Hall never places, reviews or cancels an order.
        </div>
      </div>
    </div>
  );
}

export default function MeadHallTab() {
  const host = useRef<HTMLDivElement | null>(null);
  const scene = useRef<MeadScene | null>(null);
  const [state, feed] = useMeadFeed();
  const stateRef = useRef(state);
  stateRef.current = state;
  const [ready, setReady] = useState(false);
  const [webglErr, setWebglErr] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);
  const [hint, setHint] = useState(false);
  const [hover, setHover] = useState<string | null>(null);
  const [draft, setDraft] = useState<TicketDraft | null>(null);
  const [flash, setFlash] = useState<{ r: Reaction; line: string; at: number } | null>(null);
  const [mood, setMood] = useState<MeadMood>("WAIT");
  const [, setVersion] = useState(0);
  useEffect(() => subscribePredict(() => setVersion((n) => n + 1)), []);
  const hintTimer = useRef<number | null>(null);

  const openTicket = useCallback((id: string, side: TicketSide) => {
    const m = marketById(stateRef.current, id);
    if (m) setDraft({ market: m, side });
  }, []);

  useEffect(() => {
    if (!host.current) return;
    try {
      scene.current = new MeadScene(host.current, {
        onFocusChange: setFocused,
        onScrollHint: () => {
          setHint(true);
          if (hintTimer.current) window.clearTimeout(hintTimer.current);
          hintTimer.current = window.setTimeout(() => setHint(false), 1800);
        },
        onHover: setHover,
        onTicket: openTicket,
        onReaction: (r, line) => setFlash({ r, line, at: Date.now() }),
      });
      setReady(true);
    } catch (e) {
      setWebglErr(e instanceof Error ? e.message : String(e));
    }
    return () => {
      scene.current?.dispose();
      scene.current = null;
      if (hintTimer.current) window.clearTimeout(hintTimer.current);
    };
  }, [openTicket]);

  useEffect(() => {
    if (!scene.current || state.status === "idle") return;
    scene.current.setFeed(state);
    setMood(scene.current.getMood());
  }, [state, ready]);

  useEffect(() => {
    if (!flash) return;
    const id = window.setTimeout(() => setFlash(null), 1600);
    return () => window.clearTimeout(id);
  }, [flash]);

  const journal = readJournal();
  const featured = useMemo(() => state.markets.find((m) => m.id === state.featuredId) ?? null, [state]);
  const mst = ENTRY_STYLE[mood];
  const mock = state.status === "mock";

  return (
    <div className="space-y-3" data-testid="mead-hall">
      <div className="flex flex-wrap items-center gap-2">
        <Beer className="h-5 w-5" style={{ color: MEAD.brass }} />
        <h2 className="text-lg font-black tracking-wide" style={{ color: MEAD.brass }}>
          THE MEAD HALL <span className="text-[var(--color-muted)]">— Predictions</span>
        </h2>
        <span className="rounded-full border px-2 py-0.5 text-[10px] font-bold" style={{ borderColor: mst.color, color: mst.color }} title={mst.hint}>
          {mst.label}
        </span>
        <span
          className="rounded-full border px-2 py-0.5 text-[10px] font-bold"
          style={mock ? { borderColor: "#fb923c", color: "#fdba74" } : { borderColor: "var(--color-border)", color: "var(--color-muted)" }}
          title={state.note}
        >
          {mock ? "MOCK · DEV only" : state.status === "live" ? `${state.note.startsWith("STALE") ? "STALE · " : ""}${state.label ?? KALSHI_SOURCE_LABEL}` : state.status.toUpperCase()}
        </span>
        <span className="rounded-full bg-[color-mix(in_oklab,var(--color-primary)_14%,transparent)] px-2 py-0.5 text-[10px] font-bold text-[var(--color-primary)]">PAPER ONLY</span>
        <span className="ml-auto text-[11px] text-[var(--color-muted)]">
          {journal.open.length} open paper · {state.fetchedAt ? new Date(state.fetchedAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit" }) : "—"}
        </span>
        <button type="button" className={BTN} onClick={() => feed?.refresh()} title="Refresh the feed">
          <RefreshCw className="h-3 w-3" /> Refresh
        </button>
      </div>

      <div
        className="relative overflow-hidden rounded-xl border-2"
        style={{ borderColor: focused ? MEAD.brass : "var(--color-border)", boxShadow: flash ? `inset 0 0 60px 10px ${REACT_COLOR[flash.r]}88, 0 0 24px ${REACT_COLOR[flash.r]}66` : undefined, transition: "box-shadow 300ms" }}
      >
        <div ref={host} className="h-[64vh] min-h-[420px] w-full bg-[#0a1610]" data-testid="mead-canvas" />
        {webglErr && <div className="absolute inset-0 flex items-center justify-center p-4 text-sm text-red-300">3D unavailable: {webglErr}. The market list below still works.</div>}
        <div className="pointer-events-none absolute left-2 top-2 flex flex-col gap-1">
          <span className="rounded bg-black/60 px-2 py-0.5 text-[11px] text-white">
            {focused ? "WASD walks Keaton · drag to look · wheel zooms · Esc releases" : "Click the hall to walk (WASD) · tap YES / NO for a paper ticket"}
          </span>
          {hover && <span className="rounded bg-black/70 px-2 py-0.5 text-[11px]" style={{ color: MEAD.brass }}>{hover}</span>}
        </div>
        {flash && (
          <div className="pointer-events-none absolute left-1/2 top-6 -translate-x-1/2 rounded-full px-4 py-1 text-xl font-black" style={{ background: REACT_COLOR[flash.r], color: flash.r === "hail" ? MEAD.pineInk : "#fff" }}>
            {flash.line}
          </div>
        )}
        {hint && !focused && (
          <div className="pointer-events-none absolute inset-x-0 bottom-3 mx-auto w-fit rounded bg-black/70 px-3 py-1 text-[12px] text-white">Click the hall to zoom — the page keeps scrolling until you do</div>
        )}
        {focused && (
          <button type="button" className="absolute right-2 top-2 rounded bg-black/60 px-2 py-0.5 text-[11px] text-white underline" onClick={() => scene.current?.releaseFocus()}>
            Release (Esc)
          </button>
        )}
        <div className="absolute bottom-2 right-2 flex flex-wrap gap-1">
          {(["overview", "jumbotron", "board", "bar"] as const).map((w) => (
            <button key={w} type="button" className={`${BTN} bg-black/60`} onClick={() => scene.current?.look(w)}>
              <Camera className="h-3 w-3" /> {w === "board" ? "Rune Board" : w[0].toUpperCase() + w.slice(1)}
            </button>
          ))}
        </div>
        <div className="absolute bottom-2 left-2 flex gap-1">
          {(["cheer", "groan", "hail"] as const).map((r) => (
            <button key={r} type="button" className={`${BTN} bg-black/60`} onClick={() => scene.current?.react(r)} title="Preview a crowd reaction — presentation only">
              {r === "hail" ? "Hail!" : r[0].toUpperCase() + r.slice(1)}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-[2fr_1fr]">
        <section className={CARD}>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-muted)]">On the taps · ranked by setup</h3>
            <span className="text-[10px] text-[var(--color-muted)]">{state.markets.length} markets</span>
          </div>
          {!state.markets.length && <div className="text-[12px] text-[var(--color-muted)]">{state.status === "loading" || state.status === "idle" ? "Pouring the first round…" : state.note || "No markets right now."}</div>}
          <div className="max-h-80 space-y-1 overflow-auto">
            {state.markets.slice(0, 24).map((m) => (
              <div key={m.id} className="flex items-center gap-2 rounded border border-[var(--color-border)] px-2 py-1 text-[12px]" data-testid="mead-row">
                <span className="w-16 shrink-0 text-[10px] font-bold text-emerald-200/70">{categoryLabel(m)}</span>
                <span className="min-w-0 flex-1 truncate">
                  <span className="font-semibold">{m.outcome}</span> <span className="text-[var(--color-muted)]">{eventLabel(m)}</span>
                </span>
                <span className="w-12 text-right font-mono">{pct(m.winChance)}</span>
                <span
                  className={m.setupGrade != null ? "w-8 text-center font-black" : "w-8 text-center text-[9px] font-semibold leading-tight"}
                  style={{ color: m.setupGrade == null ? gradeColor("—") : m.setupGrade.startsWith("A") ? "#4ade80" : m.setupGrade === "B" ? MEAD.brass : "#94a3b8" }}
                  title={setupGradeLabel(m.setupGrade)}
                >
                  {setupGradeLabel(m.setupGrade)}
                </span>
                <button type="button" className="rounded bg-green-700 px-2 py-0.5 text-[11px] font-bold text-white disabled:opacity-40" disabled={m.yesPrice == null} onClick={() => setDraft({ market: m, side: "YES" })}>
                  YES {cents(m.yesPrice)}
                </button>
                <button type="button" className="rounded bg-red-700 px-2 py-0.5 text-[11px] font-bold text-white disabled:opacity-40" disabled={m.noPrice == null} onClick={() => setDraft({ market: m, side: "NO" })}>
                  NO {cents(m.noPrice)}
                </button>
              </div>
            ))}
          </div>
        </section>
        <section className={CARD}>
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-muted)]">Featured</h3>
          {featured ? (
            <div className="space-y-1 text-[12px]">
              <div className="text-base font-black">{featured.outcome}</div>
              <div className="text-[var(--color-muted)]">
                {categoryLabel(featured)} · {eventLabel(featured)}
              </div>
              <div>
                YES {cents(featured.yesPrice)} · NO {cents(featured.noPrice)} · win {pct(featured.winChance)}
              </div>
              <div style={{ color: MEAD.brass }}>
                {edgeTag(featured.edge)} · {featured.setupGrade != null ? `grade ${featured.setupGrade}` : setupGradeLabel(null)} · {featured.gates.word} {featured.gates.passed}/{featured.gates.total}
              </div>
              {featured.gates.missing && <div className="text-[11px] text-[var(--color-muted)]">Missing: {featured.gates.missing}</div>}
            </div>
          ) : (
            <div className="text-[12px] text-[var(--color-muted)]">Nothing featured yet.</div>
          )}
          <p className="mt-3 text-[10px] leading-snug text-[var(--color-muted)]">
            {state.note} Mood follows the scanner words (GO → ENTER, LIMIT → ARMED, a B setup → STALKING). The crowd cheers, groans or shouts Hail as prices move —
            presentation only, never a signal.
          </p>
        </section>
      </div>

      {draft && <PaperTicket draft={draft} onClose={() => setDraft(null)} />}
    </div>
  );
}
