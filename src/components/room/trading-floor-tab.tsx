/**
 * Floor — the 3D trading room as its own tab.
 *
 * Live and only live. The room engine (room-engine.ts) runs a cycle on every desk refresh and looks at the tape
 * every second; this tab draws what it decides and what the five say. There is no drill, no replay and no time
 * control: what is on screen is what the desk can see right now, at the speed the market moves. When the feed is not
 * real (synthetic, delayed, silent) the badge says so and the room says so. Paper only.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, Copy, Expand, Footprints, RotateCcw, Users, Volume2, VolumeX, X } from "lucide-react";
import { CREW, TRAITS, rankTitle, recordLine, relationWord } from "@/lib/room/agents";
import { TALK } from "@/lib/room/live-types";
import { ROOM_MANDATE, type Character, type DialogueLine } from "@/lib/room/orchestrator";
import { ROOM_DEFAULT_CASH } from "@/lib/room/paper-book";
import { FloorScene, LAYOUT, PLACES, type CameraPreset, type FloorEvent } from "./floor-scene";
import { RacePanel } from "./race-panel";
import { InvestOfficePanel } from "./invest-office-panel";
import { FloorSound, loadSoundPref, saveSoundPref } from "./floor-sound";
import { ExecCard } from "./exec-card";
import { URGENCY_COLOR, type FloorFrame } from "./floor-screens";
import { frameIsEvent, useRoomStore, type WireEntry, type WireStatus } from "./room-engine";
import EV_TEST from "@/data/room-ev-test.json";

/** The z the stored EV test printed for its verdict, so this panel cannot quote a stale one. */
const EV_Z = /z (-?[\d.]+)/.exec(EV_TEST.verdict)?.[1] ?? "n/a";

const CARD = "min-w-0 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-1)] p-3";
const BTN =
  "inline-flex items-center gap-1 rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-[11px] text-[var(--color-fg)] hover:border-[var(--color-primary)] focus:outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-primary)] disabled:opacity-40";
const HEAD = "mb-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-muted)]";

const COLOR: Record<Character, string> = Object.fromEntries(
  CREW.map((c) => [c, LAYOUT.crew[c].colors.top ?? "#64748b"]),
) as Record<Character, string>;
// Navy and black tops read as nothing on a dark card; use the accent for those two.
COLOR.Sterling = LAYOUT.crew.Sterling.colors.accent ?? "#b91c1c";
COLOR.Vince = LAYOUT.crew.Vince.colors.accent ?? "#22d3ee";

const CAMERAS: { id: CameraPreset; label: string }[] = [
  { id: "auto", label: "Director" },
  { id: "overview", label: "Floor" },
  { id: "board", label: "Board" },
  { id: "quant", label: "Quant wall" },
  { id: "offices", label: "Offices" },
  { id: "front", label: "Risk & exec" },
  { id: "lounge", label: "Lounge" },
  { id: "rnd", label: "R&D lab" },
  { id: "ops", label: "Ops & data" },
  { id: "goal", label: "Goal room" },
  { id: "invest", label: "Investment" },
  { id: "boardroom", label: "Boardroom" },
  { id: "follow", label: "Speaker" },
];

/* ── The 3D canvas ──────────────────────────────────────────────────────── */

/** A trade, an exit or a change of story — the room drops what it is saying. */
function storyChanged(next: FloorFrame, prev: FloorFrame | null): boolean {
  return (
    !prev ||
    next.output.broker_action.execute_trade ||
    next.trace.beat !== prev.trace.beat ||
    (next.trace.meeting?.key ?? "") !== (prev.trace.meeting?.key ?? "")
  );
}

function FloorCanvas({
  frame,
  camera,
  sceneRef,
  onSpeaker,
  onMeetingDone,
  onSelect,
  onEnvironment,
  onEvent,
  onFollow,
  onFocus,
  onHover,
}: {
  frame: FloorFrame | null;
  camera: CameraPreset;
  /** The tab drives navigation (Go to, Follow) through the scene it is drawing. */
  sceneRef: { current: FloorScene | null };
  onSpeaker: (i: number, line: DialogueLine | null) => void;
  onMeetingDone: () => void;
  onSelect: (who: Character) => void;
  onEnvironment: (src: "glb" | "fallback") => void;
  onEvent: (e: FloorEvent) => void;
  onFollow: (who: Character | null) => void;
  onFocus: (label: string | null) => void;
  onHover: (label: string | null) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const scene = useRef<FloorScene | null>(null);
  const cbs = useRef({ onSpeaker, onMeetingDone, onSelect, onEnvironment, onEvent, onFollow, onFocus, onHover });
  cbs.current = { onSpeaker, onMeetingDone, onSelect, onEnvironment, onEvent, onFollow, onFocus, onHover };
  const [error, setError] = useState<string | null>(null);
  // What the scene is showing, whether a cycle's own meeting is running (a ticket, an exit, a director's call), and
  // the newest event waiting for it to end. All per scene instance.
  const latest = useRef({ frame });
  latest.current = { frame };
  const shown = useRef<FloorFrame | null>(null);
  const playing = useRef(false);
  const pending = useRef<FloorFrame | null>(null);
  const talkSeq = useRoomStore((s) => s.talkSeq);

  const show = useCallback((f: FloorFrame, talk: boolean) => {
    const sc = scene.current;
    if (!sc) return;
    shown.current = f;
    if (talk) playing.current = true;
    sc.apply(f, 1, talk);
  }, []);

  /** Hand the scene whatever the live talk has made since it last looked. A stale exchange is dropped, not played. */
  const flushTalk = useCallback(() => {
    const sc = scene.current;
    if (!sc) return;
    const { pending: items, ackTalk } = useRoomStore.getState();
    if (!items.length) return;
    const status: Record<string, WireStatus> = {};
    for (const it of items) {
      const r = sc.say({ id: it.id, at: it.at, ttlMs: it.ttlMs, urgency: it.urgency, lines: it.lines, moves: it.moves });
      status[it.id] = r === "started" ? "said" : r === "queued" ? "queued" : "dropped";
    }
    ackTalk(status);
  }, []);

  useEffect(() => {
    if (!host.current) return;
    try {
      scene.current = new FloorScene(host.current, {
        onSpeaker: (i, l) => cbs.current.onSpeaker(i, l),
        onMeetingDone: () => {
          playing.current = false;
          cbs.current.onMeetingDone();
          // A newer event arrived mid-meeting: it is the story now.
          const next = pending.current;
          pending.current = null;
          if (next && next !== shown.current) show(next, true);
        },
        onSelect: (w) => cbs.current.onSelect(w),
        onEnvironment: (s) => cbs.current.onEnvironment(s),
        onEvent: (e) => cbs.current.onEvent(e),
        onFollow: (w) => cbs.current.onFollow(w),
        onFocus: (l) => cbs.current.onFocus(l),
        onHover: (l) => cbs.current.onHover(l),
        onTalk: (id, st) => {
          if (st === "started") useRoomStore.getState().ackTalk({ [id]: "said" });
          else if (st === "dropped") useRoomStore.getState().ackTalk({ [id]: "dropped" });
        },
      });
      sceneRef.current = scene.current;
      // A new scene has shown nothing (React's dev double-mount builds two).
      shown.current = null;
      playing.current = false;
      pending.current = null;
      useRoomStore.getState().setSceneOpen(true);
      const f = latest.current.frame;
      if (f) show(f, frameIsEvent(f));
      flushTalk();
    } catch (e) {
      setError(e instanceof Error ? e.message : "WebGL is unavailable in this browser.");
    }
    return () => {
      useRoomStore.getState().setSceneOpen(false);
      scene.current?.dispose();
      scene.current = null;
      sceneRef.current = null;
    };
  }, [show, flushTalk, sceneRef]);

  useEffect(() => {
    if (!frame || !scene.current || frame === shown.current) return;
    const prev = shown.current;
    // Quiet beats follow the cycle (people, screens) without a script; the live talk says what is worth saying.
    if (!(frameIsEvent(frame) && storyChanged(frame, prev))) return show(frame, false);
    if (playing.current) pending.current = frame;
    else show(frame, true);
  }, [frame, show]);

  useEffect(() => flushTalk(), [talkSeq, flushTalk]);
  useEffect(() => scene.current?.setCamera(camera), [camera]);

  if (error)
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-sm text-[var(--color-muted)]">
        The 3D floor needs WebGL ({error}). The wire log, the contract JSON and the book below still run.
      </div>
    );
  return <div ref={host} className="absolute inset-0" />;
}

/* ── The feed's honesty, and the wire ───────────────────────────────────── */

function lagText(sec: number | null): string {
  if (sec == null) return "";
  if (sec < 90) return `${Math.round(sec)} s`;
  return `${Math.round(sec / 60)} min`;
}

/** What the data under the room really is, right now. Never flatters: delayed is delayed, synthetic is not live. */
function LiveBadge({ frame }: { frame: FloorFrame | null }) {
  const feed = useRoomStore((s) => s.feedRead);
  const tickAt = useRoomStore((s) => s.tickAt);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  const silent = tickAt != null ? Math.round((now - tickAt) / 1000) : null;
  let tone = "#16a34a";
  let text = "WAITING FOR THE DESK";
  if (feed) {
    if (silent != null && silent > 30) {
      tone = "#dc2626";
      text = `NO TICKS · ${lagText(silent)}`;
    } else if (feed.kind === "synthetic") {
      tone = "#dc2626";
      text = "NOT LIVE · synthetic desk feed";
    } else if (feed.kind === "none") {
      tone = "#dc2626";
      text = "NO FEED";
    } else if (feed.kind === "live_gateway") {
      text = `LIVE · gateway${feed.lagSec != null ? ` · ${lagText(feed.lagSec)}` : ""}`;
    } else {
      const late = (feed.lagSec ?? 0) >= 90;
      tone = late ? "#d97706" : "#16a34a";
      text = `LIVE · ${feed.kind === "yahoo" ? "Yahoo" : "Databento"}${late ? ` · futures ${lagText(feed.lagSec)} behind` : ""}`;
    }
  }
  const clock = frame?.clockLabel;
  return (
    <span className="inline-flex items-center gap-1.5 rounded border border-[var(--color-border)] px-2 py-0.5 text-[11px] font-semibold" style={{ color: tone }}>
      <span className="h-2 w-2 animate-pulse rounded-full" style={{ background: tone }} />
      {text}
      {clock ? <span className="font-mono font-normal text-[var(--color-muted)]">· {clock}</span> : null}
    </span>
  );
}

const KIND_COLOR: Record<string, string> = {
  tape: "#38bdf8",
  level: "#a78bfa",
  news: "#f59e0b",
  calendar: "#fb7185",
  session: "#94a3b8",
  book: "#22c55e",
  card: "#22d3ee",
  pulse: "#f472b6",
  feed: "#ef4444",
  heartbeat: "#64748b",
  cycle: "#e2e8f0",
  goal: "#facc15",
  seat: "#4ade80",
  rnd: "#c084fc",
  invest: "#2dd4bf",
};

const STATUS_TEXT: Record<WireStatus, string> = { queued: "queued", said: "said", dropped: "stale", unseen: "unseen" };

const etTime = (ms: number) => new Date(ms).toLocaleTimeString("en-GB", { timeZone: "America/New_York", hour12: false });

/** Everything the room said, newest first, with what set it off and the numbers it rested on. */
function WireLog({ onFocus }: { onFocus: (who: Character) => void }) {
  const wire = useRoomStore((s) => s.wire);
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className={CARD}>
      <div className={HEAD}>On the wire · what they said, and why</div>
      {wire.length === 0 ? (
        <p className="text-[12px] text-[var(--color-muted)]">Nothing yet. The room speaks when the desk gives it something real: a move, a level, a headline, a release, the book, the feed.</p>
      ) : (
        <ol className="max-h-[22rem] space-y-1 overflow-y-auto pr-1">
          {wire.map((w: WireEntry) => (
            <li key={w.id} className="rounded border border-[var(--color-border)] px-2 py-1">
              <button type="button" className="flex w-full items-center gap-2 text-left text-[11px]" onClick={() => setOpen(open === w.id ? null : w.id)}>
                <span className="font-mono text-[var(--color-subtle)]">{etTime(w.at)}</span>
                <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase text-black" style={{ background: KIND_COLOR[w.kind] ?? "#64748b" }}>
                  {w.kind}
                </span>
                {w.urgency === 2 ? <span className="text-[10px] font-bold text-[var(--color-down)]">URGENT</span> : null}
                <span className="min-w-0 flex-1 truncate text-[var(--color-fg)]">{w.label}</span>
                <span className="text-[10px] text-[var(--color-subtle)]">{STATUS_TEXT[w.status]}</span>
              </button>
              <ul className="mt-1 space-y-0.5">
                {(open === w.id ? w.lines : w.lines.slice(0, 2)).map((l, i) => (
                  <li key={i} className="text-[12px] leading-snug">
                    <button type="button" onClick={() => onFocus(l.character)} className="font-semibold" style={{ color: COLOR[l.character] }}>
                      {l.character}
                    </button>{" "}
                    <span className="text-[var(--color-fg)]">{l.text}</span>
                  </li>
                ))}
                {open !== w.id && w.lines.length > 2 ? <li className="text-[10px] text-[var(--color-subtle)]">+{w.lines.length - 2} more — click to open</li> : null}
              </ul>
              {open === w.id && w.facts.length ? (
                <p className="mt-1 font-mono text-[10px] text-[var(--color-subtle)]">numbers used: {w.facts.join(" · ")}</p>
              ) : null}
            </li>
          ))}
        </ol>
      )}
      <p className="mt-2 text-[10px] leading-snug text-[var(--color-subtle)]">
        Every number in a line was produced by code from the live desk and is listed under it. The words are fixed phrases in each person's voice, chosen from the event and from what they have already said (never the same line twice
        within {TALK.recentKeep} lines). Narration only: nothing said here gates, sizes or sends anything.
      </p>
    </div>
  );
}

/* ── Panels ─────────────────────────────────────────────────────────────── */

function Bar({ v, color }: { v: number; color: string }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded bg-[var(--color-surface-2)]">
      <div className="h-full rounded" style={{ width: `${Math.round(Math.min(1, Math.max(0, v)) * 100)}%`, background: color }} />
    </div>
  );
}

function Portrait({ who }: { who: Character }) {
  const [ok, setOk] = useState(true);
  return ok ? (
    <img
      src={`/floor/portraits/${who.toLowerCase()}.png`}
      alt={who}
      width={44}
      height={44}
      className="h-11 w-11 shrink-0 rounded-full border border-[var(--color-border)] object-cover"
      onError={() => setOk(false)}
    />
  ) : (
    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white" style={{ background: COLOR[who] }}>
      {who[0]}
    </div>
  );
}

function PeopleCards({ frame, selected, onSelect }: { frame: FloorFrame | null; selected: Character | null; onSelect: (w: Character) => void }) {
  const minds = frame?.minds ?? null;
  return (
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
      {CREW.map((who) => {
        const t = TRAITS[who];
        const n = minds?.needs[who];
        const rank = minds?.rank[who] ?? 50;
        const act = frame?.acts?.[who]?.act ?? "desk";
        const rec = recordLine(minds, who);
        const mem = minds?.memories.find((m) => m.who === who);
        const rels = CREW.filter((o) => o !== who)
          .map((o) => ({ o, w: relationWord(minds, who, o) }))
          .filter((r) => r.w !== "neutral")
          .slice(0, 2);
        return (
          <button
            key={who}
            type="button"
            onClick={() => onSelect(who)}
            className={`${CARD} text-left transition-colors ${selected === who ? "border-[var(--color-primary)]" : ""}`}
          >
            <div className="flex items-center gap-2">
              <Portrait who={who} />
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-[var(--color-fg)]">
                  {who} <span className="text-[11px] font-normal text-[var(--color-muted)]">· {t.schoolName}</span>
                </div>
                <div className="text-[11px] text-[var(--color-muted)]">
                  rank {rank} · {rankTitle(rank)} · {act.replace("_", " ")}
                </div>
              </div>
            </div>
            <p className="mt-2 line-clamp-2 text-[11px] text-[var(--color-subtle)]">{t.creed}</p>
            {n && (
              <div className="mt-2 grid grid-cols-[64px_1fr] items-center gap-x-2 gap-y-1 text-[10px] text-[var(--color-muted)]">
                <span>caffeine</span>
                <Bar v={n.caffeine} color="#a16207" />
                <span>fatigue</span>
                <Bar v={n.fatigue} color="#64748b" />
                <span>stress</span>
                <Bar v={n.stress} color="#dc2626" />
                <span>lonely</span>
                <Bar v={n.loneliness} color="#7c3aed" />
              </div>
            )}
            {rec && <p className="mt-2 text-[11px] text-[var(--color-fg)]">{rec}</p>}
            {frame?.screens.lab?.track[who] && frame.screens.lab.track[who].n > 0 && (
              <p className="mt-1 text-[11px] text-[var(--color-muted)]">
                Forecasts scored: {frame.screens.lab.track[who].n}
                {frame.screens.lab.track[who].brier != null ? ` · Brier ${frame.screens.lab.track[who].brier!.toFixed(3)}` : " · Brier after 5"}
              </p>
            )}
            {frame?.screens.lenses && (
              <p className="mt-1 text-[11px] text-[var(--color-muted)]">
                Says {Math.round(frame.screens.lenses[who].p * 100)}% on the card — {frame.screens.lenses[who].basis}
              </p>
            )}
            {rels.length > 0 && (
              <p className="mt-1 text-[11px] text-[var(--color-muted)]">{rels.map((r) => `${r.w} → ${r.o}`).join(" · ")}</p>
            )}
            {mem && (
              <p className="mt-1 line-clamp-2 text-[11px] text-[var(--color-subtle)]">
                {mem.clock} {mem.text}
                {mem.outcome ? ` → ${mem.outcome.verdict}` : ""}
              </p>
            )}
          </button>
        );
      })}
    </div>
  );
}


/* ── The quant panels: Nova's ledger, the vote, the ghost room ─────────── */

const pc = (p: number | null | undefined) => (p == null ? "—" : `${Math.round(p * 100)}%`);
const sgn = (n: number) => `${n >= 0 ? "+" : "−"}$${Math.abs(Math.round(n)).toLocaleString()}`;

function LedgerPanel({ frame }: { frame: FloorFrame | null }) {
  const L = frame?.screens.ledger ?? null;
  return (
    <div className={CARD}>
      <div className={HEAD}>Nova's ledger — the option, not just the plan</div>
      {!L ? (
        <p className="text-[12px] text-[var(--color-muted)]">No priced plan. Every ticket is priced on three measured paths: T1 before the 11:00 flat, a loss, or nothing.</p>
      ) : (
        <div className="space-y-2 text-[12px]">
          <p className="font-mono text-[var(--color-fg)]">{L.contract}</p>
          <p className="text-[11px] text-[var(--color-muted)]">
            Model {pc(L.pT1Model)} to T1 in 8h · {L.measured ? `${pc(L.share)} of T1s land inside ${L.windowBars} bars` : "time curve not measured — 8h odds stand in"}
          </p>
          <ul className="space-y-1">
            {L.paths.map((x) => (
              <li key={x.kind} className="flex items-center gap-2">
                <span className="w-12 font-semibold" style={{ color: x.kind === "t1" ? "#22c55e" : x.kind === "loss" ? "#ef4444" : "#f59e0b" }}>
                  {x.kind === "t1" ? "T1" : x.kind === "loss" ? "Loss" : "Flat"}
                </span>
                <span className="w-10 font-mono">{pc(x.p)}</span>
                <Bar v={x.p} color={x.kind === "t1" ? "#22c55e" : x.kind === "loss" ? "#ef4444" : "#f59e0b"} />
                <span className="w-16 text-right font-mono">{sgn(x.pnlUsd)}</span>
                <span className="w-12 text-right font-mono text-[10px] text-[var(--color-subtle)]">~{x.clock}</span>
              </li>
            ))}
          </ul>
          <p className={`font-mono text-sm font-semibold ${L.evUsd > 0 ? "text-[var(--color-up)]" : "text-[var(--color-down)]"}`}>
            EV {sgn(L.evUsd)} a contract after both crossings{L.held && L.edgeUsd != null ? ` · hold vs sell ${sgn(L.edgeUsd)}` : ""}
          </p>
          {L.evCalUsd != null && L.pCal != null ? (
            <p className={`font-mono text-[11px] ${L.evCalUsd > 0 ? "text-[var(--color-up)]" : "text-[var(--color-down)]"}`}>
              On the model's out-of-sample hit rate ({pc(L.pCal)} for {pc(L.pT1Model)}): {sgn(L.evCalUsd)} — quoted, not a gate
            </p>
          ) : null}
          <p className="text-[10px] leading-snug text-[var(--color-subtle)]">
            A refusal rule, not an edge claim. On four years of real cards (2025–26 out of sample) the tickets it passed beat the ones it refused, but not by enough to call it shown (z {EV_Z}) — its proven effect is trading about a quarter as often. The ghost room keeps measuring.
          </p>
        </div>
      )}
    </div>
  );
}

function VotePanel({ frame }: { frame: FloorFrame | null }) {
  const L = frame?.screens.lenses ?? null;
  const lab = frame?.screens.lab ?? null;
  return (
    <div className={CARD}>
      <div className={HEAD}>The vote — P(T1 before 11:00), five lenses</div>
      {!L ? (
        <p className="text-[12px] text-[var(--color-muted)]">No card under review.</p>
      ) : (
        <div className="space-y-1.5">
          {CREW.map((who) => (
            <div key={who} className="text-[11px]">
              <div className="flex items-center gap-2">
                <span className="w-16 font-semibold" style={{ color: COLOR[who] }}>
                  {who}
                </span>
                <Bar v={L[who].p} color={COLOR[who]} />
                <span className="w-10 text-right font-mono">{pc(L[who].p)}</span>
              </div>
              <p className="ml-[72px] text-[10px] text-[var(--color-subtle)]">
                {L[who].basis}
                {lab?.track[who]?.brier != null ? ` · Brier ${lab.track[who].brier!.toFixed(3)} (n${lab.track[who].n})` : ""}
              </p>
            </div>
          ))}
          <p className="pt-1 font-mono text-[12px] font-semibold text-[var(--color-fg)]">Room {pc(frame?.screens.roomP)}</p>
        </div>
      )}
    </div>
  );
}

function GhostPanel({ frame }: { frame: FloorFrame | null }) {
  const lab = frame?.screens.lab ?? null;
  const cal = lab?.calibration;
  return (
    <div className={CARD}>
      <div className={HEAD}>Ghost room & calibration</div>
      {!lab ? (
        <p className="text-[12px] text-[var(--color-muted)]">Nothing recorded yet.</p>
      ) : (
        <div className="space-y-2 text-[12px]">
          <p>
            <span className="text-[var(--color-muted)]">Room exits vs mandate alone: </span>
            <span className="font-mono">{lab.twins.n ? `${sgn(lab.twins.deltaUsd)} over ${lab.twins.n}` : "no paired fills yet"}</span>
          </p>
          <div>
            <p className="text-[var(--color-muted)]">Refused at the CE — what they'd have made:</p>
            {lab.refusals.length ? (
              <ul className="font-mono text-[11px]">
                {lab.refusals.map((r) => (
                  <li key={r.gate}>
                    {r.gate}: {r.n}× {sgn(r.pnlUsd)} ({r.wins} won)
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[11px] text-[var(--color-subtle)]">No refused ticket has closed yet.</p>
            )}
          </div>
          <p>
            <span className="text-[var(--color-muted)]">Calibration: </span>
            <span className="font-mono">
              {cal && cal.n ? `said ${pc(cal.meanP)}, hit ${pc(cal.hitRate)} over ${cal.n}${cal.brier != null ? ` · Brier ${cal.brier.toFixed(3)}` : ""}` : "no scored plans yet"}
            </span>
          </p>
          <p className="text-[10px] leading-snug text-[var(--color-subtle)]">
            Ghosts never fill: same model marks, same exits, separate from the room's cash and halts. Paired twins run the trader's mandate alone beside every room fill.
          </p>
        </div>
      )}
    </div>
  );
}

/* ── The tab ────────────────────────────────────────────────────────────── */

export default function TradingFloorTab() {
  const frame = useRoomStore((s) => s.frame);
  const enabled = useRoomStore((s) => s.enabled);
  const setEnabled = useRoomStore((s) => s.setEnabled);
  const book = useRoomStore((s) => s.book);
  const reset = useRoomStore((s) => s.reset);
  const backup = useRoomStore((s) => s.backup);
  const [camera, setCamera] = useState<CameraPreset>("auto");
  const [speaker, setSpeaker] = useState<{ i: number; line: DialogueLine | null }>({ i: -1, line: null });
  const [selected, setSelected] = useState<Character | null>(null);
  // Navigation: who the camera is riding with, and what it flew to (a screen, a bank of monitors).
  const [following, setFollowing] = useState<Character | null>(null);
  const [looking, setLooking] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const sceneRef = useRef<FloorScene | null>(null);
  const [env, setEnv] = useState<"glb" | "fallback" | null>(null);
  const [copied, setCopied] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

  // Sound: off until the trader turns it on (and a click unlocks audio).
  const sound = useRef<FloorSound | null>(null);
  const [soundOn, setSoundOn] = useState(false);
  useEffect(() => {
    sound.current = new FloorSound();
    const pref = loadSoundPref();
    sound.current.volume = pref.volume;
    setSoundOn(pref.on);
    return () => sound.current?.dispose();
  }, []);
  const soundOnRef = useRef(false);
  soundOnRef.current = soundOn;
  // A saved "on" still needs one gesture before the browser will speak.
  useEffect(() => {
    const arm = () => {
      if (soundOnRef.current) sound.current?.unlock();
    };
    window.addEventListener("pointerdown", arm);
    return () => window.removeEventListener("pointerdown", arm);
  }, []);
  const onEvent = useCallback((e: FloorEvent) => {
    if (soundOnRef.current) sound.current?.play(e);
  }, []);

  const onSpeaker = useCallback((i: number, line: DialogueLine | null) => {
    setSpeaker({ i, line });
    if (!soundOnRef.current) return;
    if (line?.text) sound.current?.say(line);
    else sound.current?.hush();
  }, []);
  // A follow or a fly-to is the viewer's own camera: no preset is "on" while it lasts.
  const onFollow = useCallback((who: Character | null) => {
    setFollowing(who);
    if (who) {
      setLooking(null);
      setCamera("free");
    }
  }, []);
  const onFocus = useCallback((label: string | null) => {
    setLooking(label);
    if (label) {
      setFollowing(null);
      setCamera("free");
    }
  }, []);
  const goTo = useCallback((screenId: string) => {
    sceneRef.current?.focusScreen(screenId);
  }, []);
  const onMeetingDone = useCallback(() => undefined, []);

  const fullscreen = () => {
    const el = wrap.current;
    if (!el) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void el.requestFullscreen?.();
  };

  const json = frame ? JSON.stringify(frame.output, null, 2) : "";
  const urgency = frame?.output.room_state.market_urgency ?? "LOW";
  const ba = frame?.output.broker_action;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Users className="h-4 w-4 text-[var(--color-primary)]" />
        <h2 className="text-sm font-semibold text-[var(--color-fg)]">Trading floor</h2>
        <LiveBadge frame={frame} />
        <span className="rounded px-2 py-0.5 text-[11px] font-semibold text-black" style={{ background: URGENCY_COLOR[urgency] }}>
          {urgency.replace("_", " ")}
        </span>
        <span className="font-mono text-[11px] text-[var(--color-subtle)]">{frame?.screens.source ?? ""}</span>
        <button
          type="button"
          className={`${BTN} ml-auto`}
          aria-pressed={soundOn}
          title={soundOn ? "Speaking the caption in each person's voice" : "Click to let the floor speak the caption"}
          onClick={() => {
            const on = !soundOn;
            setSoundOn(on);
            if (on) {
              sound.current?.unlock();
              if (speaker.line?.text) sound.current?.say(speaker.line);
            } else {
              sound.current?.hush();
            }
            saveSoundPref({ on, volume: sound.current?.volume ?? 0.5 });
          }}
        >
          {soundOn ? <Volume2 className="h-3 w-3" /> : <VolumeX className="h-3 w-3" />} {soundOn ? "Voices on" : "Voices off"}
        </button>
        <label className="flex items-center gap-1 text-[11px] text-[var(--color-muted)]">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          room runs in the background (paper)
        </label>
      </div>

      {!frame && (
        <p className="rounded border border-[var(--color-border)] px-3 py-1.5 text-[11px] text-[var(--color-muted)]">
          {enabled ? "Waiting for the next desk refresh to run the first room cycle…" : "The room engine is off — switch it on above."}
        </p>
      )}

      <div ref={wrap} className="relative h-[58vh] min-h-[340px] w-full overflow-hidden rounded-xl border border-[var(--color-border)] bg-[#0b1220]">
        <FloorCanvas
          frame={frame}
          camera={camera}
          sceneRef={sceneRef}
          onFollow={onFollow}
          onFocus={onFocus}
          onHover={setHover}
          onSpeaker={onSpeaker}
          onMeetingDone={onMeetingDone}
          onSelect={(w) => {
            setSelected(w);
          }}
          onEnvironment={setEnv}
          onEvent={onEvent}
        />
        <div className="pointer-events-none absolute left-2 top-2 flex max-w-[70%] flex-wrap gap-1">
          {frame?.trace.meeting && (
            <span className="rounded bg-black/70 px-2 py-0.5 text-[11px] font-semibold text-amber-300">MEETING · {frame.trace.meeting.title}</span>
          )}
          {frame && <span className="rounded bg-black/60 px-2 py-0.5 font-mono text-[11px] text-slate-200">{frame.trace.beat}</span>}
          {env && <span className="rounded bg-black/50 px-2 py-0.5 text-[10px] text-slate-400">{env === "glb" ? "office: Blender" : "office: plan boxes"}</span>}
        </div>
        {(following || looking) && (
          <div className="absolute left-2 top-9 flex items-center gap-1 rounded bg-black/75 px-2 py-0.5 text-[11px] text-slate-100">
            <Footprints className="h-3 w-3" />
            {following ? (
              <span>
                Following <b style={{ color: COLOR[following] }}>{following}</b> · drag to orbit · scroll to zoom
              </span>
            ) : (
              <span>
                Looking at <b>{looking}</b>
              </span>
            )}
            <button
              type="button"
              className="ml-1 inline-flex items-center gap-0.5 rounded border border-slate-500 px-1 text-[10px] hover:border-white"
              onClick={() => {
                sceneRef.current?.follow(null);
                setLooking(null);
                setCamera("overview");
              }}
              aria-label={following ? "Stop following and return to the floor view" : "Go back to the floor view"}
            >
              <X className="h-3 w-3" /> {following ? "Stop (Esc)" : "Back"}
            </button>
          </div>
        )}
        <div className="absolute right-2 top-2 flex flex-wrap justify-end gap-1">
          {CAMERAS.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setCamera(c.id)}
              className={`rounded px-2 py-0.5 text-[10px] ${camera === c.id ? "bg-white text-black" : "bg-black/60 text-slate-200"}`}
            >
              {c.id === "overview" ? <Camera className="mr-0.5 inline h-3 w-3" /> : null}
              {c.label}
            </button>
          ))}
          <button type="button" onClick={fullscreen} className="rounded bg-black/60 px-2 py-0.5 text-[10px] text-slate-200" aria-label="Full screen">
            <Expand className="inline h-3 w-3" />
          </button>
        </div>
        {hover && <div className="pointer-events-none absolute bottom-14 right-2 rounded bg-black/80 px-2 py-0.5 text-[11px] text-slate-100">{hover}</div>}
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 to-transparent p-3 pt-8">
          {speaker.line ? (
            <p className="text-[13px] leading-snug text-white">
              <span className="mr-1 font-bold" style={{ color: COLOR[speaker.line.character] }}>
                {speaker.line.character}
              </span>
              <span className="mr-1 text-[10px] uppercase text-slate-400">{speaker.line.animation.replace(/_/g, " ").toLowerCase()}</span>
              {speaker.line.text}
            </p>
          ) : (
            <p className="text-[12px] text-slate-400">{frame ? "Watching the tape…" : "Building the floor…"}</p>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-1)] px-3 py-2">
        <div className="flex flex-wrap items-center gap-1">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-muted)]">Follow</span>
          {CREW.map((c) => (
            <button
              key={c}
              type="button"
              className={`${BTN} ${following === c ? "border-[var(--color-primary)]" : ""}`}
              aria-pressed={following === c}
              onClick={() => {
                sceneRef.current?.follow(following === c ? null : c);
                setSelected(c);
              }}
            >
              <span className="inline-block h-2 w-2 rounded-full" style={{ background: COLOR[c] }} /> {c}
            </button>
          ))}
        </div>
        {(["war room", "annex", "invest", "lounge"] as const).map((group) => (
          <div key={group} className="flex flex-wrap items-center gap-1">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-muted)]">{group === "war room" ? "Go to" : group === "annex" ? "Annex" : group === "invest" ? "Invest wing" : "Lounge"}</span>
            {PLACES.filter((p) => p.group === group).map((p) => (
              <button key={p.id} type="button" className={BTN} onClick={() => goTo(p.id)}>
                {p.label}
              </button>
            ))}
          </div>
        ))}
        <span className="text-[10px] text-[var(--color-subtle)]">Click a person to follow them · double-click a screen, the board or a TV to go to it · Esc lets go.</span>
      </div>

      <RacePanel frame={frame} onGo={goTo} />

      <InvestOfficePanel frame={frame} onGo={goTo} />

      <div className="grid gap-3 lg:grid-cols-[1.4fr_1fr_1fr]">
        <WireLog onFocus={setSelected} />

        <div className={CARD}>
          <div className={HEAD}>Sterling's list → the ticket</div>
          {ba && (
            <p className={`mb-2 font-mono text-[12px] font-semibold ${ba.execute_trade ? "text-[var(--color-up)]" : "text-[var(--color-muted)]"}`}>
              {ba.action_type} {ba.contracts_quantity}× {ba.underlying} {ba.option_type} {ba.strike_offset}
              {ba.target_position_id ? ` → ${ba.target_position_id}` : ""}
            </p>
          )}
          <ul className="space-y-0.5 text-[11px]">
            {(frame?.trace.gates ?? []).map((g) => (
              <li key={g.id} className={g.ok ? "text-[var(--color-muted)]" : "text-[var(--color-down)]"}>
                {g.ok ? "✓" : "✗"} {g.label}
              </li>
            ))}
            {frame && !frame.trace.gates.length && <li className="text-[var(--color-muted)]">{frame.trace.refusal ?? "nothing to clear"}</li>}
          </ul>
          <div className="mt-3 flex items-center justify-between">
            <span className={HEAD}>Your contract JSON</span>
            <button
              type="button"
              className={BTN}
              disabled={!json}
              onClick={() => {
                void navigator.clipboard?.writeText(json).then(() => {
                  setCopied(true);
                  window.setTimeout(() => setCopied(false), 1500);
                });
              }}
            >
              <Copy className="h-3 w-3" /> {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <pre className="max-h-64 overflow-auto rounded bg-[var(--color-surface-2)] p-2 text-[10px] leading-tight text-[var(--color-fg)]">{json}</pre>
        </div>

        <div className={CARD}>
          <div className={HEAD}>Room book (paper)</div>
          {frame && (
            <div className="space-y-1 text-[12px]">
              <div className="flex justify-between">
                <span className="text-[var(--color-muted)]">Equity</span>
                <span className="font-mono">${frame.screens.book.equity.toLocaleString()}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--color-muted)]">Cash</span>
                <span className="font-mono">${frame.screens.book.cash.toLocaleString()}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--color-muted)]">Day</span>
                <span className={`font-mono ${frame.screens.book.dayPnl >= 0 ? "text-[var(--color-up)]" : "text-[var(--color-down)]"}`}>
                  {frame.screens.book.dayPnl >= 0 ? "+" : "−"}${Math.abs(frame.screens.book.dayPnl).toLocaleString()}
                </span>
              </div>
              {frame.screens.book.positions.map((p) => (
                <div key={p.id} className="flex justify-between font-mono text-[11px]">
                  <span>
                    {p.id} ×{p.contracts}
                  </span>
                  <span className={p.pnlPct >= 0 ? "text-[var(--color-up)]" : "text-[var(--color-down)]"}>
                    {p.pnlPct >= 0 ? "+" : ""}
                    {p.pnlPct.toFixed(1)}%
                  </span>
                </div>
              ))}
              <ul className="mt-2 space-y-0.5 text-[11px] text-[var(--color-muted)]">
                {frame.screens.book.events.map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            </div>
          )}
          <button
            type="button"
            className={`${BTN} mt-3`}
            onClick={() => {
              if (window.confirm(`Reset the room's paper book to $${ROOM_DEFAULT_CASH.toLocaleString()}? Positions and history are cleared. Close the desk on your other devices first, or one still running the old book will bring it back.`)) reset();
            }}
          >
            <RotateCcw className="h-3 w-3" /> Reset book (${book.startCash.toLocaleString()} start)
          </button>
          <p className={`mt-2 text-[10px] leading-snug ${backup.status === "local" ? "text-[var(--color-down)]" : "text-[var(--color-muted)]"}`}>
            Server copy: {backup.why}
            {backup.at ? ` (${new Date(backup.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })})` : ""}
          </p>
          <p className="mt-3 text-[10px] leading-snug text-[var(--color-subtle)]">
            Mandate: ≤{ROOM_MANDATE.maxOpenPositions} open · ≤{Math.round(ROOM_MANDATE.maxCashFracPerTrade * 100)}% cash a ticket (and ≤$1,000) ·
            {" "}−{Math.abs(ROOM_MANDATE.hardStopPct)}% backstop behind the level exit · +{ROOM_MANDATE.takeProfitPct}% trims half · 0–1 DTE · flat by 11:00.
            The room's own book fills at the model ask/bid. Orders reach a broker only through the Execution card below, which is off until you turn it on.
          </p>
        </div>
      </div>

      <ExecCard />

      <div className="grid gap-3 lg:grid-cols-3">
        <LedgerPanel frame={frame} />
        <VotePanel frame={frame} />
        <GhostPanel frame={frame} />
      </div>

      <div>
        <div className={HEAD}>The people — needs, rank, grudges and what they remember</div>
        <PeopleCards frame={frame} selected={selected} onSelect={setSelected} />
      </div>
    </div>
  );
}
