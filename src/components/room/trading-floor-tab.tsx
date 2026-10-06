/**
 * Floor — the 3D trading room as its own tab.
 *
 * Live and only live. The room engine (room-engine.ts) runs a cycle on every desk refresh and looks at the tape
 * every second; this tab draws what it decides and what the five say. There is no drill and no room time-travel:
 * what is on screen is what the desk can see right now (Chunk D's scrubber only pages recorded seat/close/book
 * moments — it does not rewind the cycle). When the feed is not real (synthetic, delayed, silent) the badge says
 * so and the room says so. Paper only.
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
import { BED_LAYERS, FloorSound, loadBedMutes, loadSoundPref, saveSoundPref, type BedLayer } from "./floor-sound";
import { sessionDial } from "@/lib/room/floor-props";
import { scrubMoment, type SessionMoment } from "@/lib/room/floor-race-replay";
import { ExecCard } from "./exec-card";
import { URGENCY_COLOR, type FloorFrame } from "./floor-screens";
import { frameIsEvent, useRoomStore, type WireEntry, type WireStatus } from "./room-engine";
import EV_TEST from "@/data/room-ev-test.json";
import type { DeskPayload } from "@/lib/trading/build-desk";
import { displayEntry, useAutomation, useEntryState } from "@/components/desk/use-entry-state";
import { useExecStore } from "./exec-bridge";
import type {
  ManagerRoomState,
  ManagerSteer,
  OwnerFeedback,
  SteerMove,
  DiscretionRuleDraft,
} from "@/lib/room/manager-feed";
import { isStubManagerFeed, standAgentAgree } from "@/lib/room/manager-feed";
import { managerStubRequested, roomManagerFeed } from "@/lib/room/manager-room-feed";
import { managerLoopReadout } from "@/lib/room/manager-live-loop";
import { reportRhAccount } from "@/lib/ui/rh-account";
import { RhAccountStrip } from "@/components/desk/rh-account-strip";
import { REACTIONS, useWirePins, useWireReactions } from "./wire-chat";

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
  onCanvasFocus,
  onScrollHint,
  onManagerInspect,
  onOneOnOne,
  onOwnerSit,
  onPov,
}: {
  frame: FloorFrame | null;
  camera: CameraPreset;
  onCanvasFocus: (focused: boolean) => void;
  onScrollHint: () => void;
  onManagerInspect: (state: ManagerRoomState) => void;
  onOneOnOne: (target: { kind: "crew"; who: Character } | { kind: "manager" }) => void;
  onOwnerSit?: (seated: boolean) => void;
  onPov?: (pov: "first" | "third") => void;
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
  const cbs = useRef({ onSpeaker, onMeetingDone, onSelect, onEnvironment, onEvent, onFollow, onFocus, onHover, onCanvasFocus, onScrollHint, onManagerInspect, onOneOnOne, onOwnerSit, onPov });
  cbs.current = { onSpeaker, onMeetingDone, onSelect, onEnvironment, onEvent, onFollow, onFocus, onHover, onCanvasFocus, onScrollHint, onManagerInspect, onOneOnOne, onOwnerSit, onPov };
  const [error, setError] = useState<string | null>(null);
  // What the scene is showing, whether a cycle's own meeting is running (a ticket, an exit, a director's call), and
  // the newest event waiting for it to end. All per scene instance.
  const latest = useRef({ frame });
  latest.current = { frame };
  const shown = useRef<FloorFrame | null>(null);
  const playing = useRef(false);
  const pending = useRef<FloorFrame | null>(null);
  const talkSeq = useRoomStore((s) => s.talkSeq);
  // Floor overhaul props (ticker wall, lanes, weather, banners, trophies, scars) — computed by the room engine.
  const floorProps = useRoomStore((s) => s.floorProps);
  const floorPropsSig = useRoomStore((s) => s.floorPropsSig);

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
        onFocusChange: (on) => cbs.current.onCanvasFocus(on),
        onScrollHint: () => cbs.current.onScrollHint(),
        onManagerInspect: (s) => cbs.current.onManagerInspect(s),
        onOneOnOne: (t) => cbs.current.onOneOnOne(t),
        onOwnerSit: (on) => cbs.current.onOwnerSit?.(on),
        onPovChange: (p) => cbs.current.onPov?.(p),
        // The real room feed (room engine cycles + live account); the demo stub only on dev ?manager=stub.
        managerFeed: managerStubRequested() ? undefined : roomManagerFeed(),
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
      {
        const st = useRoomStore.getState();
        scene.current.setFloorProps(st.floorProps, st.floorPropsSig);
      }
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
  useEffect(() => scene.current?.setFloorProps(floorProps, floorPropsSig), [floorProps, floorPropsSig]);
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
    } else if (feed.kind === "yahoo") {
      // Yahoo is delayed structure — never "LIVE".
      tone = "#d97706";
      text = `DELAYED · Yahoo${feed.lagSec != null ? ` · ${lagText(feed.lagSec)}` : ""}`;
    } else {
      const late = (feed.lagSec ?? 0) >= 90;
      tone = late ? "#d97706" : "#16a34a";
      // Databento historical is not the live gateway — don't say LIVE when delayed.
      text = late
        ? `DELAYED · Databento · ${lagText(feed.lagSec!)}`
        : `Databento${feed.lagSec != null ? ` · ${lagText(feed.lagSec)}` : ""}`;
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

function MiniAvatar({ who, size = 22 }: { who: Character; size?: number }) {
  const [ok, setOk] = useState(true);
  return ok ? (
    <img
      src={`/floor/portraits/${who.toLowerCase()}.png`}
      alt=""
      width={size}
      height={size}
      style={{ width: size, height: size, borderColor: COLOR[who] }}
      className="shrink-0 rounded-full border object-cover"
      onError={() => setOk(false)}
    />
  ) : (
    <span
      aria-hidden
      style={{ width: size, height: size, background: COLOR[who] }}
      className="flex shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white"
    >
      {who[0]}
    </span>
  );
}

/**
 * Everything the room said, newest first, as a chat: each exchange is a thread (the first line opens it, the rest of
 * the same exchange reply under it), with what set it off and the numbers it rested on. Reactions and pins are the
 * viewer's own marks, saved in this browser — the room never reads them.
 */
function WireLog({ onFocus }: { onFocus: (who: Character) => void }) {
  const wire = useRoomStore((s) => s.wire);
  const [open, setOpen] = useState<string | null>(null);
  const { reactions, toggle: react } = useWireReactions();
  const { isPinned, toggle: pin } = useWirePins();
  return (
    <div className={CARD}>
      <div className={HEAD}>On the wire · the room&apos;s chat</div>
      {wire.length === 0 ? (
        <p className="text-[12px] text-[var(--color-muted)]">Quiet on the wire. The room speaks when the desk gives it something real: a move, a level, a headline, a release, the book, the feed.</p>
      ) : (
        <ol className="max-h-[26rem] space-y-2 overflow-y-auto pr-1">
          {wire.map((w: WireEntry) => {
            const [head, ...replies] = w.lines;
            const shown = open === w.id ? replies : replies.slice(0, 1);
            const mine = reactions[w.id] ?? [];
            const pinned = isPinned(w.id);
            return (
              <li key={w.id} className="group rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1.5">
                <div className="flex items-center gap-1.5 text-[10px]">
                  <span className="rounded px-1.5 py-0.5 font-semibold uppercase text-black" style={{ background: KIND_COLOR[w.kind] ?? "#64748b" }}>
                    {w.kind}
                  </span>
                  {w.urgency === 2 ? <span className="font-bold text-[var(--color-down)]">URGENT</span> : null}
                  <span className="min-w-0 flex-1 truncate text-[var(--color-muted)]" title={w.label}>
                    {w.label}
                  </span>
                  <span className="font-mono text-[var(--color-subtle)]">{etTime(w.at)}</span>
                  <span className="text-[var(--color-subtle)]">· {STATUS_TEXT[w.status]}</span>
                </div>
                {head && (
                  <div className="mt-1 flex items-start gap-2">
                    <button type="button" onClick={() => onFocus(head.character)} aria-label={`Select ${head.character}`}>
                      <MiniAvatar who={head.character} size={26} />
                    </button>
                    <p className="min-w-0 text-[12px] leading-snug">
                      <span className="font-semibold" style={{ color: COLOR[head.character] }}>
                        {head.character}
                      </span>{" "}
                      <span className="text-[var(--color-fg)]">{head.text}</span>
                    </p>
                  </div>
                )}
                {shown.length > 0 && (
                  <ul className="ml-[13px] mt-1 space-y-1 border-l border-[var(--color-border)] pl-3">
                    {shown.map((l, i) => (
                      <li key={i} className="flex items-start gap-1.5">
                        <button type="button" onClick={() => onFocus(l.character)} aria-label={`Select ${l.character}`}>
                          <MiniAvatar who={l.character} size={18} />
                        </button>
                        <p className="min-w-0 text-[12px] leading-snug">
                          <span className="font-semibold" style={{ color: COLOR[l.character] }}>
                            {l.character}
                          </span>{" "}
                          <span className="text-[var(--color-fg)]">{l.text}</span>
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="mt-1 flex flex-wrap items-center gap-1">
                  {(replies.length > 1 || w.facts.length > 0) && (
                    <button type="button" className="text-[10px] text-[var(--color-primary)]" onClick={() => setOpen(open === w.id ? null : w.id)}>
                      {open === w.id ? "Collapse" : replies.length > 1 ? `${replies.length - 1} more in thread · numbers` : "Numbers used"}
                    </button>
                  )}
                  <span className="ml-auto flex items-center gap-0.5">
                    {REACTIONS.map((r) => {
                      const on = mine.includes(r);
                      return (
                        <button
                          key={r}
                          type="button"
                          aria-pressed={on}
                          aria-label={`React ${r}`}
                          onClick={() => react(w.id, r)}
                          className={`rounded-full border px-1 text-[11px] leading-5 transition-opacity ${
                            on ? "border-[var(--color-primary)] opacity-100" : "border-transparent opacity-40 hover:opacity-100 group-hover:opacity-70"
                          }`}
                        >
                          {r}
                        </button>
                      );
                    })}
                    {head && (
                      <button
                        type="button"
                        aria-pressed={pinned}
                        onClick={() => pin({ id: w.id, at: w.at, who: head.character, text: head.text })}
                        className={`ml-1 rounded border px-1.5 text-[10px] ${pinned ? "border-[var(--color-primary)] text-[var(--color-primary)]" : "border-[var(--color-border)] text-[var(--color-muted)] hover:text-[var(--color-fg)]"}`}
                        title={pinned ? "Unpin from THE PLAN board" : "Pin this line to THE PLAN board"}
                      >
                        {pinned ? "Pinned" : "Pin to board"}
                      </button>
                    )}
                  </span>
                </div>
                {open === w.id && w.facts.length ? (
                  <p className="mt-1 font-mono text-[10px] text-[var(--color-subtle)]">numbers used: {w.facts.join(" · ")}</p>
                ) : null}
              </li>
            );
          })}
        </ol>
      )}
      <p className="mt-2 text-[10px] leading-snug text-[var(--color-subtle)]">
        Every number in a line was produced by code from the live desk and is listed under it (open the thread). The words are fixed phrases in each person's voice, chosen from the event and from what they have already said (never the same line twice
        within {TALK.recentKeep} lines). Narration only: nothing said here gates, sizes or sends anything — reactions and pins stay in this browser.
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

/* ── Chunk D item 35: session moment scrubber (presentation; real history only) ─ */

function ReplayScrubber({
  moments,
  index,
  onIndex,
  onGo,
}: {
  moments: SessionMoment[];
  index: number | null;
  onIndex: (i: number | null) => void;
  onGo: (screenId: string) => void;
}) {
  const [playing, setPlaying] = useState(false);
  const n = moments.length;
  const cur = scrubMoment(moments, index ?? 0);

  useEffect(() => {
    if (!playing || n === 0) return;
    const id = window.setInterval(() => {
      onIndex(((index ?? 0) + 1) % n);
    }, 1600);
    return () => window.clearInterval(id);
  }, [playing, n, index, onIndex]);

  useEffect(() => {
    if (n === 0) {
      onIndex(null);
      setPlaying(false);
    } else if (index == null) onIndex(0);
  }, [n, index, onIndex]);

  return (
    <div className={CARD}>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <div className={HEAD} style={{ marginBottom: 0 }}>
          Session replay — recorded moments
        </div>
        <div className="ml-auto flex flex-wrap gap-1">
          <button type="button" className={BTN} disabled={n === 0} onClick={() => onIndex(Math.max(0, (index ?? 0) - 1))} aria-label="Previous moment">
            Prev
          </button>
          <button
            type="button"
            className={BTN}
            disabled={n === 0}
            onClick={() => setPlaying((p) => !p)}
            aria-pressed={playing}
          >
            {playing ? "Pause" : "Play"}
          </button>
          <button type="button" className={BTN} disabled={n === 0} onClick={() => onIndex(Math.min(n - 1, (index ?? 0) + 1))} aria-label="Next moment">
            Next
          </button>
          <button type="button" className={BTN} onClick={() => onGo("ovh_scrub")} title="Fly to the scrubber board">
            On the wall
          </button>
          <button type="button" className={BTN} onClick={() => onGo("ovh_race")} title="Fly to the race board">
            Race board
          </button>
        </div>
      </div>
      {n === 0 ? (
        <p className="text-[12px] text-[var(--color-muted)]">No moments yet — seat events, closed paper, and book log entries appear here as they happen. Nothing is invented.</p>
      ) : (
        <>
          <input
            type="range"
            className="w-full accent-[var(--color-primary)]"
            min={0}
            max={n - 1}
            value={index ?? 0}
            onChange={(e) => {
              setPlaying(false);
              onIndex(Number(e.target.value));
            }}
            aria-label="Scrub session moments"
          />
          <div className="mt-1 flex justify-between font-mono text-[10px] text-[var(--color-muted)]">
            <span>
              {(index ?? 0) + 1} / {n}
            </span>
            <span>{cur ? new Date(cur.at).toLocaleString("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", second: "2-digit" }) + " ET" : ""}</span>
          </div>
          {cur && (
            <div className="mt-2 rounded border border-[var(--color-border)] bg-[var(--color-surface)] p-2">
              <div className="text-[12px] font-semibold text-[var(--color-fg)]">
                {cur.title}
                {cur.schoolShort ? <span className="ml-2 font-mono text-[10px] text-[var(--color-muted)]">{cur.schoolShort}</span> : null}
              </div>
              <p className="mt-1 text-[11px] leading-snug text-[var(--color-muted)]">{cur.detail}</p>
              <p className="mt-1 font-mono text-[10px] text-[var(--color-subtle)]">{cur.kind}</p>
            </div>
          )}
          <p className="mt-2 text-[10px] text-[var(--color-subtle)]">Presentation only — scrubbing does not rewind the room cycle or invent history.</p>
        </>
      )}
    </div>
  );
}

/* ── Chunk C item 26: Owner 1:1 (E) with a character or the Manager ───── */

function OneOnOnePanel({
  target,
  frame,
  managerState,
  onClose,
  onOpenManager,
}: {
  target: { kind: "crew"; who: Character } | { kind: "manager" };
  frame: FloorFrame | null;
  managerState: ManagerRoomState | null;
  onClose: () => void;
  onOpenManager: () => void;
}) {
  if (target.kind === "manager") {
    const call = managerState?.call;
    return (
      <div className={`${CARD} border-[#38bdf8]/50`}>
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className={HEAD} style={{ marginBottom: 0 }}>
            1:1 · Trading Stand <span className="ml-1 rounded bg-[#38bdf8]/20 px-1.5 py-0.5 font-mono text-[10px] text-[#7dd3fc]">{managerState?.current ?? "—"}</span>
          </div>
          <button type="button" className={BTN} onClick={onClose} aria-label="Close 1:1">
            <X className="h-3 w-3" /> Close
          </button>
        </div>
        <p className="text-[11px] text-[var(--color-muted)]">Owner ↔ Manager context — presentation only. Open the full Stand panel to teach / steer.</p>
        {call ? (
          <p className="mt-2 text-[12px] text-[var(--color-fg)]">
            <span className="font-semibold">{call.action}</span>
            {call.underlier ? ` · ${call.underlier} ${call.side ?? ""}` : ""} — {call.reasoning.thesis}
          </p>
        ) : (
          <p className="mt-2 text-[12px] text-[var(--color-muted)]">No call this cycle.</p>
        )}
        <button type="button" className={`${BTN} mt-3`} onClick={onOpenManager}>
          Open full Manager panel
        </button>
      </div>
    );
  }
  const who = target.who;
  const t = TRAITS[who];
  const minds = frame?.minds ?? null;
  const n = minds?.needs[who];
  const act = frame?.acts?.[who]?.act ?? "desk";
  const mem = minds?.memories.find((m) => m.who === who);
  return (
    <div className={`${CARD}`} style={{ borderColor: `${COLOR[who]}88` }}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className={HEAD} style={{ marginBottom: 0 }}>
          1:1 · <span style={{ color: COLOR[who] }}>{who}</span>
          <span className="ml-1 text-[10px] font-normal text-[var(--color-muted)]">{t.schoolName}</span>
        </div>
        <button type="button" className={BTN} onClick={onClose} aria-label="Close 1:1">
          <X className="h-3 w-3" /> Close
        </button>
      </div>
      <p className="text-[11px] text-[var(--color-muted)]">Owner private context — what the room already knows. No orders.</p>
      <ul className="mt-2 space-y-1 text-[12px] text-[var(--color-fg)]">
        <li>
          <span className="text-[var(--color-muted)]">Now:</span> {act}
        </li>
        <li>
          <span className="text-[var(--color-muted)]">Lens (school idea):</span> {t.creed}
        </li>
        {n && (
          <li className="font-mono text-[11px] text-[var(--color-subtle)]">
            needs · stress {(n.stress * 100).toFixed(0)} · lonely {(n.loneliness * 100).toFixed(0)} · fatigue {(n.fatigue * 100).toFixed(0)}
          </li>
        )}
        {mem && (
          <li className="text-[11px] text-[var(--color-muted)]">
            memory · {mem.kind} · {mem.text}
          </li>
        )}
        {!mem && <li className="text-[11px] text-[var(--color-subtle)]">No scored memory yet.</li>}
      </ul>
    </div>
  );
}

/* ── Trading Stand Manager (stub) — ManagerRoomState + steer + teach ───── */

const STEER_CHIPS: { move: SteerMove; label: string }[] = [
  { move: "ASK_LENS", label: "Ask Nova" },
  { move: "DEMAND_PREMORTEM", label: "Premortem" },
  { move: "TABLE", label: "Table" },
  { move: "DECLARE_AGREE", label: "Agree" },
  { move: "HAND_TO_OWNER", label: "Hand to Owner" },
];

function ManagerPanel({
  state,
  lastSteer,
  onSteer,
  onClose,
  onTeach,
  feedback,
  stub,
  standBit,
  loopLine,
}: {
  stub: boolean;
  /** managerLoopReadout(feed).line — the live loop's Floor-rule / B+ read (display only). */
  loopLine?: string | null;
  /** What the RH path would read as agentAgree (manager-agree.ts) — false for the stub. */
  standBit: boolean;
  state: ManagerRoomState;
  lastSteer: ManagerSteer | null;
  onSteer: (m: SteerMove) => void;
  onClose: () => void;
  onTeach: (kind: "AFFIRM_CALL" | "REJECT_CALL" | "TEACH_RULE", text: string, draft?: DiscretionRuleDraft) => void;
  feedback: OwnerFeedback[];
}) {
  const [teachOpen, setTeachOpen] = useState(false);
  const [ruleText, setRuleText] = useState("Prefer aside when confluence < 0.7");
  const call = state.call;
  const open = state.open;
  const close = state.close;
  return (
    <div className={`${CARD} border-[#38bdf8]/60`}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className={HEAD} style={{ marginBottom: 0 }}>
          Trading Stand · Manager <span className="ml-1 rounded bg-[#38bdf8]/20 px-1.5 py-0.5 font-mono text-[10px] text-[#7dd3fc]">{state.current}</span>
        </div>
        <button type="button" className={BTN} onClick={onClose} aria-label="Close Manager panel">
          <X className="h-3 w-3" /> Close
        </button>
      </div>
      <p className="text-[11px] text-[var(--color-muted)]">
        {stub ? "Stub · " : "Live room · "}ManagerRoomState v{state.version} · cycle {state.cycleId}
        {stub ? " · presentation only — a demo call never reaches the RH Stand bit" : ""}
      </p>
      <p className="mt-1 font-mono text-[11px]" title="managerStateForAgree(feed) → resolveStandAgentAgree (src/lib/execution/manager-agree.ts)">
        <span className="text-[var(--color-muted)]">RH Stand bit (agentAgree): </span>
        <span className={standBit ? "text-[#4ade80]" : "text-[var(--color-fg)]"}>{String(standBit)}</span>
        {stub && <span className="text-[var(--color-subtle)]"> · stub feed → false</span>}
      </p>
      {loopLine && (
        <p className="mt-0.5 font-mono text-[10px] text-[var(--color-subtle)]" title="managerLoopReadout (src/lib/room/manager-live-loop.ts) — display only, never places">
          RH loop: {loopLine}
        </p>
      )}
      <RhAccountStrip className="mt-2" />
      {call ? (
        <div className="mt-2 space-y-1 text-[12px]">
          <p className="font-semibold text-[var(--color-fg)]">{call.reasoning.thesis}</p>
          <p className="font-mono text-[11px] text-[var(--color-muted)]">
            {call.action} · agentAgree={String(call.agentAgree)} · {call.underlier ?? "—"} {call.side ?? ""} {call.strikeOffset ?? ""} ×{call.contracts ?? "—"} · ${call.estDebitTotal ?? "—"}
          </p>
          <ul className="text-[11px] text-[var(--color-subtle)]">
            <li>{call.reasoning.floorCite}</li>
            <li>{call.reasoning.pathCite}</li>
            <li>{call.reasoning.debateCite}</li>
            {call.reasoning.blocks.length > 0 && <li className="text-[var(--color-down)]">blocks: {call.reasoning.blocks.join(", ")}</li>}
          </ul>
        </div>
      ) : (
        <p className="mt-2 text-[12px] text-[var(--color-muted)]">No call — {state.current}</p>
      )}
      {open && (
        <div className="mt-2 rounded border border-[var(--color-border)] bg-[var(--color-surface-2)] p-2 text-[11px]">
          <div className="font-semibold text-[#4ade80]">OPEN · {open.underlier} {open.side} ×{open.contracts}</div>
          <div className="font-mono text-[var(--color-muted)]">
            {open.source} · debit ${open.entryDebit} · mark {open.mark ?? "—"} · pnl {open.pnlUsd == null ? "—" : `${open.pnlUsd >= 0 ? "+" : ""}${open.pnlUsd}`}
          </div>
        </div>
      )}
      {close && (
        <div className="mt-2 rounded border border-[var(--color-border)] bg-[var(--color-surface-2)] p-2 text-[11px]">
          <div className="font-semibold">CLOSE · {close.result} · {close.label}</div>
          <div className="text-[var(--color-muted)]">
            {close.reason} · ${close.pnlUsd} · taught={String(close.taught)}
          </div>
        </div>
      )}
      <div className="mt-2 grid grid-cols-3 gap-1 text-[10px] text-[var(--color-muted)]">
        <span>Floor {state.floor.verdict}</span>
        <span>PATH {state.path.band ?? "—"} · {state.path.confluence.toFixed(2)}</span>
        <span>Arms {state.arms.autofireEnabled ? "AF" : "off"}/{state.arms.liveArmed ? "live" : "paper"}</span>
      </div>
      <div className="mt-3">
        <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-muted)]">Steer (emit ManagerSteer only)</div>
        <div className="flex flex-wrap gap-1">
          {STEER_CHIPS.map((c) => (
            <button key={c.move} type="button" className={BTN} onClick={() => onSteer(c.move)}>
              {c.label}
            </button>
          ))}
        </div>
        {lastSteer && (
          <p className="mt-1 text-[11px] text-[#7dd3fc]">
            STAND → {lastSteer.address}: {lastSteer.line}
          </p>
        )}
      </div>
      <div className="mt-3">
        <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-muted)]">Owner Teach (Prototype Lab)</div>
        <div className="flex flex-wrap gap-1">
          <button type="button" className={BTN} onClick={() => onTeach("AFFIRM_CALL", "Right call.")}>
            Affirm
          </button>
          <button type="button" className={BTN} onClick={() => onTeach("REJECT_CALL", "Wrong call — do not repeat.")}>
            Reject
          </button>
          <button type="button" className={BTN} onClick={() => setTeachOpen((v) => !v)}>
            Teach rule
          </button>
        </div>
        {teachOpen && (
          <div className="mt-2 space-y-1 rounded border border-[var(--color-border)] p-2">
            <input
              className="w-full rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-[11px]"
              value={ruleText}
              onChange={(e) => setRuleText(e.target.value)}
              aria-label="Discretion rule text"
            />
            <button
              type="button"
              className={BTN}
              onClick={() => {
                onTeach("TEACH_RULE", ruleText, {
                  scope: "global",
                  scopeKey: "*",
                  effect: "prefer_aside",
                  factor: null,
                  text: ruleText,
                });
                setTeachOpen(false);
              }}
            >
              Save mock DiscretionRule
            </button>
          </div>
        )}
        {feedback.length > 0 && (
          <ul className="mt-1 max-h-20 overflow-auto text-[10px] text-[var(--color-subtle)]">
            {feedback.slice(-4).map((f) => (
              <li key={f.id}>
                {f.kind}: {f.text}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function PeopleCards({ frame, selected, onSelect }: { frame: FloorFrame | null; selected: Character | null; onSelect: (w: Character) => void }) {
  const minds = frame?.minds ?? null;
  const [flipped, setFlipped] = useState<Character | null>(null);
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
        const isFlipped = flipped === who;
        const flipBtn = (
          <button
            type="button"
            className="ml-auto shrink-0 rounded border border-[var(--color-border)] px-1.5 py-0.5 text-[10px] text-[var(--color-muted)] hover:text-[var(--color-fg)]"
            aria-pressed={isFlipped}
            onClick={(e) => {
              e.stopPropagation();
              setFlipped(isFlipped ? null : who);
            }}
          >
            {isFlipped ? "Back ↺" : "Bio ↻"}
          </button>
        );
        return (
          <div key={who} className="[perspective:1000px]">
          <div
            className={`grid transition-transform duration-500 [transform-style:preserve-3d] ${isFlipped ? "[transform:rotateY(180deg)]" : ""}`}
          >
          <div
            role="button"
            tabIndex={isFlipped ? -1 : 0}
            aria-hidden={isFlipped}
            onClick={() => onSelect(who)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onSelect(who);
              }
            }}
            className={`${CARD} col-start-1 row-start-1 cursor-pointer text-left transition-colors [backface-visibility:hidden] ${selected === who ? "border-[var(--color-primary)]" : ""}`}
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
              {flipBtn}
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
          </div>
          <div
            aria-hidden={!isFlipped}
            className={`${CARD} col-start-1 row-start-1 overflow-y-auto text-left [backface-visibility:hidden] [transform:rotateY(180deg)] ${selected === who ? "border-[var(--color-primary)]" : ""}`}
          >
            <div className="flex items-center gap-2">
              <MiniAvatar who={who} size={28} />
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold" style={{ color: COLOR[who] }}>
                  {who}
                </div>
                <div className="text-[10px] text-[var(--color-muted)]">{t.schoolName} · {t.roams ? "roams the floor" : "never leaves the desk"}</div>
              </div>
              {isFlipped ? flipBtn : null}
            </div>
            <p className="mt-2 text-[11px] leading-snug text-[var(--color-fg)]">&ldquo;{t.creed}&rdquo;</p>
            <div className="mt-2 grid grid-cols-[72px_1fr] items-center gap-x-2 gap-y-1 text-[10px] text-[var(--color-muted)]">
              <span>aggression</span>
              <Bar v={t.aggression} color="#f97316" />
              <span>caution</span>
              <Bar v={t.caution} color="#38bdf8" />
              <span>sociability</span>
              <Bar v={t.sociability} color="#a78bfa" />
              <span>diligence</span>
              <Bar v={t.diligence} color="#22c55e" />
            </div>
            {t.likes.length > 0 && (
              <p className="mt-2 text-[10px] text-[var(--color-muted)]">Likes: {t.likes.map((l) => String(l).replace(/_/g, " ")).join(" · ")}</p>
            )}
            {mem && (
              <p className="mt-1 text-[10px] leading-snug text-[var(--color-subtle)]">
                Remembers: {mem.clock} {mem.text}
                {mem.outcome ? ` → ${mem.outcome.verdict}` : ""}
              </p>
            )}
          </div>
          </div>
          </div>
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

/**
 * A ticker crawl along the foot of the room: the entry state, the two quotes,
 * the plan's levels and the room's headlines — all real, from the desk and the
 * frame. Nothing here is new data.
 */
function TickerCrawl({ desk, frame, entry }: { desk: DeskPayload | null; frame: FloorFrame | null; entry: ReturnType<typeof useEntryState>["read"] }) {
  const items: { k: string; text: string; color?: string }[] = [];
  const auto = useAutomation();
  if (entry) {
    const d = displayEntry(entry, auto);
    items.push({ k: "state", text: `${d.label} — ${d.why}`, color: d.color });
  }
  if (desk) {
    for (const q of [desk.quotes.left, desk.quotes.right])
      items.push({
        k: q.symbol,
        text: `${q.symbol} ${q.price.toLocaleString("en-US", { maximumFractionDigits: 2 })} ${q.changePct >= 0 ? "▲" : "▼"} ${q.changePct >= 0 ? "+" : ""}${q.changePct.toFixed(2)}%`,
        color: q.changePct >= 0 ? "var(--color-up)" : "var(--color-down)",
      });
  }
  const p = frame?.screens.plan;
  if (p) items.push({ k: "plan", text: `PLAN ${p.symbol} ${p.side.toUpperCase()} · CE ${fmtPx(p.entry)} · STOP ${fmtPx(p.stop)} · T1 ${fmtPx(p.t1)} · T2 ${fmtPx(p.t2)}` });
  for (const n of (frame?.screens.news ?? []).slice(0, 6)) items.push({ k: `n-${n.title}`, text: `${n.title} — ${n.source}${n.age ? ` · ${n.age}` : ""}` });
  if (!items.length) return null;
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 h-6 overflow-hidden border-t border-white/10 bg-black/85 font-mono text-[12px] leading-6 text-slate-200" aria-hidden>
      <div className="ticker-crawl" style={{ animationDuration: `${Math.max(30, items.length * 9)}s` }}>
        {items.map((it) => (
          <span key={it.k} className="mr-10" style={it.color ? { color: it.color } : undefined}>
            {it.text}
          </span>
        ))}
      </div>
    </div>
  );
}

const fmtPx = (v: number | null | undefined) => (v == null ? "—" : v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

/**
 * THE PLAN as a fixed 2D card over the scene: always readable, never clipped
 * by the camera. Same numbers the whiteboard draws (frame.screens.plan); the
 * confidence badge is the card's PATH band and the room's P(T1).
 */
function PlanOverlay({ frame, className = "" }: { frame: FloorFrame | null; className?: string }) {
  const p = frame?.screens.plan ?? null;
  const card = frame?.trace.entry?.entry ?? null;
  const pT1 = frame?.screens.roomP ?? frame?.screens.ledger?.pT1Model ?? null;
  const conf = pT1 == null ? null : pT1 >= 0.6 ? "high" : pT1 >= 0.45 ? "medium" : "low";
  const confColor = conf === "high" ? "var(--color-up)" : conf === "medium" ? "var(--color-warn)" : "var(--color-muted)";
  const { pins } = useWirePins();
  // No priced plan and nothing pinned: a small tab, not a card full of "No priced plan."
  if (!p && !pins.length) {
    return (
      <div className={`${className} text-right`}>
        <span
          className="inline-block rounded-full border border-white/15 bg-black/70 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-300 shadow"
          title="The plan card opens when the desk has a priced plan (or a pinned wire line)"
        >
          The plan · none yet
        </span>
      </div>
    );
  }
  return (
    <div className={`rounded-lg border border-white/15 bg-black/80 p-2.5 text-slate-100 shadow-lg backdrop-blur ${className}`}>
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-[12px] font-bold uppercase tracking-[0.14em]">The plan</span>
        {(card?.band || pT1 != null) && (
          <span
            className="rounded-full border px-1.5 py-0.5 font-mono text-[11px]"
            style={{ borderColor: confColor, color: confColor }}
            title={`Confidence: ${card?.band ? `PATH ${card.band}` : "no band"}${pT1 != null ? ` · room P(T1) ${Math.round(pT1 * 100)}%` : ""}`}
          >
            {card?.band ? `PATH ${card.band}` : ""}
            {card?.band && pT1 != null ? " · " : ""}
            {pT1 != null ? `${Math.round(pT1 * 100)}%` : ""}
          </span>
        )}
      </div>
      {p ? (
        <>
          <p className="mb-1 font-mono text-[11px] text-slate-300">
            {p.symbol} {p.side.toUpperCase()}
          </p>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 font-mono text-[13px]">
            <dt className="text-slate-300">CE</dt>
            <dd className="text-right font-semibold">{fmtPx(p.entry)}</dd>
            <dt className="text-[#f87171]">STOP</dt>
            <dd className="text-right font-semibold text-[#f87171]">{fmtPx(p.stop)}</dd>
            {p.t1 != null && (
              <>
                <dt className="text-[#4ade80]">T1</dt>
                <dd className="text-right text-[#4ade80]">{fmtPx(p.t1)}</dd>
              </>
            )}
            <dt className="text-[#86efac]">T2</dt>
            <dd className="text-right font-semibold text-[#86efac]">{fmtPx(p.t2)}</dd>
          </dl>
        </>
      ) : (
        <p className="text-[11px] text-slate-400">No priced plan yet.</p>
      )}
      {pins.length > 0 && (
        <ul className="mt-2 space-y-1 border-t border-white/10 pt-1.5">
          {pins.map((pn) => (
            <li key={pn.id} className="text-[11px] leading-snug">
              <span className="mr-1 text-[9px] uppercase tracking-wide text-slate-400">📌 {etTime(pn.at).slice(0, 5)}</span>
              <span className="font-semibold" style={{ color: COLOR[pn.who as Character] ?? "#e2e8f0" }}>
                {pn.who}
              </span>{" "}
              <span className="text-slate-200">{pn.text}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The room's own beat, in words — for empty states that say why it is empty instead of showing a zero. */
const BEAT_WORD: Record<string, string> = {
  chop: "chop, no clean setup",
  trigger_wait: "waiting on the trigger",
  blind: "the feed is blind",
  blocked: "the gates are shut",
  vetoed: "the last card was vetoed",
  rejected: "the last ticket was refused",
  holding: "holding",
  closed: "the last ticket closed",
  exit: "an exit just went through",
  fill: "a fill just went through",
};
const beatWord = (b: string | null | undefined) => (b ? (BEAT_WORD[b] ?? b.replace(/_/g, " ")) : "");

/* ── Sterling's list, grouped ──────────────────────────────────────────── */

type GateRow = { id: string; ok: boolean; label: string };
const GATE_GROUPS: { key: string; title: string; ids: string[] }[] = [
  { key: "market", title: "Market", ids: ["market", "desk", "fresh_tape", "before_flat", "after_ten"] },
  { key: "setup", title: "Setup", ids: ["card", "dte", "desk_word", "desk_ticket", "trigger", "t1_pays", "ev", "ev_preview", "clock"] },
  { key: "risk", title: "Risk", ids: ["halt_day", "halt_week", "cooldown", "slots", "one_book", "one_bias", "no_average", "month"] },
  { key: "account", title: "Account", ids: ["ledger", "cash_cap"] },
];

/** The same gates, in the same order inside each block, one pass/fail chip per block. Unknown ids land in Setup. */
function groupGates(gates: GateRow[]) {
  const known = new Set(GATE_GROUPS.flatMap((g) => g.ids));
  return GATE_GROUPS.map((g) => ({
    ...g,
    rows: gates.filter((x) => (g.key === "setup" ? g.ids.includes(x.id) || !known.has(x.id) : g.ids.includes(x.id))),
  })).filter((g) => g.rows.length > 0);
}

function GateBlocks({ gates }: { gates: GateRow[] }) {
  const groups = groupGates(gates);
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className="space-y-1">
      {groups.map((g) => {
        const failed = g.rows.filter((r) => !r.ok);
        const pass = failed.length === 0;
        const isOpen = open === g.key || (open == null && !pass && g.key === groups.find((x) => x.rows.some((r) => !r.ok))?.key);
        return (
          <div key={g.key} className="rounded border border-[var(--color-border)]">
            <button
              type="button"
              aria-expanded={isOpen}
              onClick={() => setOpen(isOpen ? "" : g.key)}
              className="flex w-full items-center gap-2 px-2 py-1 text-left text-[11px]"
            >
              <span className="font-semibold text-[var(--color-fg)]">{g.title}</span>
              <span className="text-[10px] text-[var(--color-subtle)]">
                {g.rows.length - failed.length}/{g.rows.length}
              </span>
              <span
                className={`ml-auto rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase ${
                  pass
                    ? "bg-[color-mix(in_oklab,var(--color-up)_18%,transparent)] text-[var(--color-up)]"
                    : "bg-[color-mix(in_oklab,var(--color-down)_18%,transparent)] text-[var(--color-down)]"
                }`}
              >
                {pass ? "pass" : "fail"}
              </span>
            </button>
            {isOpen && (
              <ul className="space-y-0.5 border-t border-[var(--color-border)] px-2 py-1 text-[11px]">
                {g.rows.map((r) => (
                  <li key={r.id} className={r.ok ? "text-[var(--color-muted)]" : "text-[var(--color-down)]"}>
                    {r.ok ? "✓" : "✗"} {r.label}
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ── The decision strip: what the desk says, what the Manager says, what the account allows ── */

function DecisionStrip({
  entry,
  managerState,
  onManager,
}: {
  entry: ReturnType<typeof useEntryState>["read"];
  managerState: ManagerRoomState | null;
  onManager: () => void;
}) {
  const auto = useAutomation();
  const d = entry ? displayEntry(entry, auto) : null;
  const call = managerState?.call ?? null;
  return (
    <div className="grid gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-1)] px-3 py-2 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center">
      <div className="flex items-center gap-2" title={d?.hint ?? "Waiting for the desk"}>
        <span className="text-[9px] font-semibold uppercase tracking-wider text-[var(--color-subtle)]">Desk</span>
        <span className="rounded px-2 py-0.5 font-mono text-[13px] font-bold" style={{ color: d?.color ?? "var(--color-muted)", border: `1px solid ${d?.color ?? "var(--color-border)"}` }}>
          {d?.label ?? "—"}
        </span>
      </div>
      <button type="button" onClick={onManager} className="flex min-w-0 items-center gap-2 text-left" title="Open the Manager's stand">
        <span className="text-[9px] font-semibold uppercase tracking-wider text-[var(--color-subtle)]">Manager</span>
        <span className="font-mono text-[11px] font-semibold text-[var(--color-fg)]">{managerState?.current ?? "—"}</span>
        <span className="min-w-0 truncate text-[11px] text-[var(--color-muted)]">
          {call ? `${call.action}${call.underlier ? ` · ${call.underlier} ${call.side ?? ""}` : ""}${call.reasoning?.thesis ? ` — ${call.reasoning.thesis}` : ""}` : d?.why ?? "No call yet."}
        </span>
      </button>
      <RhAccountStrip />
    </div>
  );
}

export default function TradingFloorTab({ desk = null }: { desk?: DeskPayload | null } = {}) {
  const frame = useRoomStore((s) => s.frame);
  const { read: entry } = useEntryState(desk);
  const execStatus = useExecStore((s) => s.status);
  const execError = useExecStore((s) => s.error);
  const [canvasFocused, setCanvasFocused] = useState(false);
  const [walkMode, setWalkMode] = useState(() => {
    if (typeof window === "undefined") return true;
    try {
      return window.localStorage.getItem("ledger.floor.walk") !== "0";
    } catch {
      return true;
    }
  });
  const [pov, setPov] = useState<"first" | "third">("third");
  const [showJson, setShowJson] = useState(false);
  const [managerState, setManagerState] = useState<ManagerRoomState | null>(null);
  const [managerOpen, setManagerOpen] = useState(false);
  const [oneOnOne, setOneOnOne] = useState<{ kind: "crew"; who: Character } | { kind: "manager" } | null>(null);
  const [ownerSeated, setOwnerSeated] = useState(false);
  const [scrubIndex, setScrubIndex] = useState<number | null>(null);
  const [lastSteer, setLastSteer] = useState<ManagerSteer | null>(null);
  const [feedbackLog, setFeedbackLog] = useState<OwnerFeedback[]>([]);
  const [hintFlash, setHintFlash] = useState(false);
  const hintTimer = useRef<number | null>(null);
  // The hint shows for a few seconds, then hides; a refused wheel or a focus change brings it back.
  const [hintShown, setHintShown] = useState(true);
  const showHint = useCallback((ms = 4000) => {
    setHintShown(true);
    if (hintTimer.current) window.clearTimeout(hintTimer.current);
    hintTimer.current = window.setTimeout(() => {
      setHintShown(false);
      setHintFlash(false);
    }, ms);
  }, []);
  useEffect(() => {
    showHint(5000);
    return () => {
      if (hintTimer.current) window.clearTimeout(hintTimer.current);
    };
  }, [showHint]);
  useEffect(() => showHint(3500), [canvasFocused, showHint]);
  const onScrollHint = useCallback(() => {
    setHintFlash(true);
    showHint(2500);
  }, [showHint]);
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
  // The room's lighting follows the desk's entry state (the same word as the Now hero).
  const auto = useAutomation();
  // An open position (RH automation or a paper MANAGE) lights the room green, like ENTER.
  const mood = entry ? (auto.phase === "open" || entry.rule === 1 ? "ENTER" : entry.state) : null;
  useEffect(() => {
    if (mood) sceneRef.current?.setEntryMood(mood);
  }, [mood, env]);
  // Walk is a dedicated mode: the scene follows the tab's choice (saved), and in it a click never becomes a follow.
  useEffect(() => {
    sceneRef.current?.setWalkMode(walkMode);
    try {
      window.localStorage.setItem("ledger.floor.walk", walkMode ? "1" : "0");
    } catch {
      /* storage unavailable */
    }
  }, [walkMode, env]);
  const openManager = useCallback(() => {
    const sc = sceneRef.current;
    if (sc) {
      sc.focusManager();
      setManagerState(sc.getManagerFeed().getState());
    }
    setManagerOpen(true);
  }, []);

  // Keep the Manager panel in sync with the scene's feed (the real room feed unless ?manager=stub).
  useEffect(() => {
    const feed = sceneRef.current?.getManagerFeed();
    if (!feed) return;
    return feed.subscribe((s) => {
      setManagerState(s);
      // The RH account rides on ManagerRoomState when the feed has one (display only).
      reportRhAccount(s.account ?? null);
      setLastSteer(feed.getLastSteer());
      setFeedbackLog(feed.getFeedbackLog());
    });
  }, [env]);

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
  // The sound bed (item 13): per-layer mutes, fed by the same props the room draws (VIX band, killzone, NQ prints).
  const [bedMutes, setBedMutes] = useState<Record<BedLayer, boolean>>(() => loadBedMutes());
  const [bedOpen, setBedOpen] = useState(false);
  const floorProps = useRoomStore((s) => s.floorProps);
  const moments = floorProps?.moments ?? [];
  useEffect(() => {
    sceneRef.current?.setScrubIndex(scrubIndex);
  }, [scrubIndex, env]);
  useEffect(() => {
    const dial = sessionDial(Date.now(), floorProps?.clock ?? null);
    sound.current?.bed(soundOn, {
      weather: floorProps?.weather.band ?? "none",
      intensity: floorProps?.weather.intensity ?? 0,
      inKillzone: dial.inKillzone && !dial.marketNote,
    });
  }, [soundOn, floorProps, bedMutes]);

  const onSpeaker = useCallback((i: number, line: DialogueLine | null) => {
    setSpeaker({ i, line });
    if (!soundOnRef.current || !line?.text) return;
    sound.current?.say(line);
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
        <span className="font-mono text-[11px] text-[var(--color-subtle)]">
          {(frame?.screens.source ?? "").replace(/\s*·\s*lag\s+\d+\s*s\b/i, "")}
        </span>
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
        <div className="relative">
          <button
            type="button"
            className={BTN}
            aria-expanded={bedOpen}
            title="Sound bed: mute each layer on its own (plays only while sound is on)"
            onClick={() => setBedOpen((o) => !o)}
          >
            Layers {BED_LAYERS.filter((l) => !bedMutes[l.id]).length}/{BED_LAYERS.length}
          </button>
          {bedOpen && (
            <div className="absolute right-0 top-full z-20 mt-1 w-56 rounded border border-[var(--color-border)] bg-[var(--color-surface-1)] p-2 shadow-lg">
              <div className={HEAD}>Sound bed</div>
              {BED_LAYERS.map((l) => (
                <label key={l.id} className="flex items-center gap-2 py-0.5 text-[11px] text-[var(--color-fg)]" title={l.title}>
                  <input
                    type="checkbox"
                    checked={!bedMutes[l.id]}
                    onChange={(e) => {
                      sound.current?.setMuted(l.id, !e.target.checked);
                      setBedMutes((m) => ({ ...m, [l.id]: !e.target.checked }));
                    }}
                  />
                  {l.label}
                </label>
              ))}
              {!soundOn && <p className="mt-1 text-[10px] text-[var(--color-muted)]">Sound is off — turn Voices on to hear the bed.</p>}
            </div>
          )}
        </div>
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
          onCanvasFocus={setCanvasFocused}
          onScrollHint={onScrollHint}
          onManagerInspect={(s) => {
            setManagerState(s);
            setManagerOpen(true);
            sceneRef.current?.focusManager();
          }}
          onOneOnOne={(t) => {
            setOneOnOne(t);
            if (t.kind === "manager") {
              const s = sceneRef.current?.getManagerState();
              if (s) setManagerState(s);
            }
          }}
          onOwnerSit={setOwnerSeated}
          onPov={setPov}
        />
        <PlanOverlay frame={frame} className="pointer-events-none absolute right-2 top-[4.25rem] z-10 hidden w-52 sm:block" />
        {/* Scroll capture hint, bottom-centre (clear of the camera buttons).
            Shown for a few seconds on arrival, when the wheel is refused, and
            when focus changes; otherwise hidden. */}
        <div
          className={`pointer-events-none absolute bottom-20 left-1/2 z-10 -translate-x-1/2 whitespace-nowrap rounded-full px-3 py-1 text-[12px] shadow transition-opacity duration-500 ${
            hintShown ? "opacity-100" : "opacity-0"
          } ${canvasFocused ? "bg-black/75 text-slate-100" : hintFlash ? "bg-white text-black" : "bg-black/70 text-slate-200"}`}
          role="status"
          aria-hidden={!hintShown}
        >
          {canvasFocused ? (
            <>
              {walkMode ? (pov === "first" ? "Eyes · " : "Behind · ") + (ownerSeated ? "F/E to stand · " : "WASD or arrows · point the mouse to look · ") : ""}Scroll zooms ·{" "}
              <button type="button" className="pointer-events-auto underline" onClick={() => sceneRef.current?.releaseFocus()}>
                Esc releases
              </button>
            </>
          ) : (
            "Click the floor · WASD or arrows walk · point the mouse to look · V switches eyes"
          )}
        </div>
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
        <div className="pointer-events-none absolute inset-x-0 bottom-6 bg-gradient-to-t from-black/85 to-transparent p-3 pt-8">
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
        <TickerCrawl desk={desk} frame={frame} entry={entry} />
      </div>

      <PlanOverlay frame={frame} className="sm:hidden" />

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-1)] px-3 py-2">
        <div className="flex flex-wrap items-center gap-1">
          <button
            type="button"
            className={`${BTN} ${walkMode ? "border-[var(--color-primary)]" : ""}`}
            aria-pressed={walkMode}
            title={walkMode ? "Walk as the owner. WASD or arrows. Point the mouse to look — no drag." : "Turn on to walk the floor from the owner's view"}
            onClick={() => {
              const next = !walkMode;
              setWalkMode(next);
              if (next) sceneRef.current?.engageOwner();
            }}
          >
            <Footprints className="h-3 w-3" /> Walk {walkMode ? "on" : "off"}
          </button>
          <button
            type="button"
            className={`${BTN} ${pov === "first" ? "border-[var(--color-primary)]" : ""}`}
            aria-pressed={pov === "first"}
            title="V switches between the owner's eyes and a camera that follows behind them"
            onClick={() => {
              const next = pov === "first" ? "third" : "first";
              setPov(next);
              sceneRef.current?.setPov(next);
              if (walkMode) sceneRef.current?.engageOwner();
            }}
          >
            {pov === "first" ? "Eyes" : "Behind"}
          </button>
          <button type="button" className={BTN} onClick={openManager} title="Fly to the Manager's stand and open it">
            Manager
          </button>
          <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-muted)]">Follow</span>
          {CREW.map((c) => (
            <button
              key={c}
              type="button"
              className={`${BTN} ${following === c ? "border-[var(--color-primary)]" : ""}`}
              aria-pressed={following === c}
              onClick={() => {
                // Following someone is leaving walk mode — say so by turning it off, not by fighting the Owner camera.
                if (walkMode) setWalkMode(false);
                sceneRef.current?.setWalkMode(false);
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
        <span className="text-[10px] text-[var(--color-subtle)]">
          {walkMode ? "WASD or arrows walk · point the mouse to look · V eyes/behind · " : "Click a person to follow them · "}double-click a screen, the board or a TV to go to it · Esc lets go.
        </span>
      </div>

      <DecisionStrip entry={entry} managerState={managerState} onManager={openManager} />

      {oneOnOne && (
        <OneOnOnePanel
          target={oneOnOne}
          frame={frame}
          managerState={managerState}
          onClose={() => setOneOnOne(null)}
          onOpenManager={() => {
            setOneOnOne(null);
            setManagerOpen(true);
            sceneRef.current?.focusManager();
          }}
        />
      )}

      {managerOpen && managerState && (
        <ManagerPanel
          stub={isStubManagerFeed(sceneRef.current?.getManagerFeed())}
          standBit={standAgentAgree(sceneRef.current?.getManagerFeed())}
          loopLine={managerLoopReadout(sceneRef.current?.getManagerFeed(), Date.now()).line}
          state={managerState}
          lastSteer={lastSteer}
          feedback={feedbackLog}
          onClose={() => setManagerOpen(false)}
          onSteer={(m) => {
            const feed = sceneRef.current?.getManagerFeed();
            if (!feed) return;
            const ev = feed.steer(m);
            setLastSteer(ev);
            setManagerState(feed.getState());
          }}
          onTeach={(kind, text, draft) => {
            const feed = sceneRef.current?.getManagerFeed();
            if (!feed) return;
            feed.teach({ kind, cycleId: managerState.cycleId, decisionKey: managerState.call?.decisionKey ?? null, targetAction: null, text, ruleDraft: draft ?? null });
            setFeedbackLog(feed.getFeedbackLog());
            setManagerState(feed.getState());
          }}
        />
      )}

      <RacePanel frame={frame} onGo={goTo} />
      <ReplayScrubber moments={moments} index={scrubIndex} onIndex={setScrubIndex} onGo={goTo} />

      {/* items-start: each card is its own height — the JSON card no longer
          stretches the wire log and the book into tall empty panels. */}
      <div className="grid items-start gap-3 lg:grid-cols-[1.4fr_1fr_1fr]">
        <WireLog onFocus={setSelected} />

        <div className={CARD}>
          <div className={HEAD}>Sterling's list → the ticket</div>
          {ba && (
            <p className={`mb-2 font-mono text-[12px] font-semibold ${ba.execute_trade ? "text-[var(--color-up)]" : "text-[var(--color-muted)]"}`}>
              {ba.action_type} {ba.contracts_quantity}× {ba.underlying} {ba.option_type} {ba.strike_offset}
              {ba.target_position_id ? ` → ${ba.target_position_id}` : ""}
            </p>
          )}
          {frame && frame.trace.gates.length > 0 ? (
            <GateBlocks gates={frame.trace.gates} />
          ) : (
            <p className="text-[11px] text-[var(--color-muted)]">
              {frame ? (frame.trace.refusal ?? `Nothing on Sterling's list — ${beatWord(frame.trace.beat)}.`) : "Sterling's list fills on the first room cycle."}
            </p>
          )}
          <div className="mt-3 flex items-center justify-between gap-2">
            <label className="flex items-center gap-1 text-[10px] text-[var(--color-subtle)]">
              <input type="checkbox" checked={showJson} onChange={(e) => setShowJson(e.target.checked)} />
              dev · contract JSON
            </label>
            {showJson && (
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
            )}
          </div>
          {showJson && (
            <pre className="mt-1 max-h-64 overflow-auto rounded bg-[var(--color-surface-2)] p-2 text-[10px] leading-tight text-[var(--color-fg)]">{json || "No cycle yet."}</pre>
          )}
        </div>

        <div className={CARD}>
          <div className={HEAD}>Room book (paper)</div>
          {!frame && <p className="text-[11px] text-[var(--color-muted)]">The book opens on the first room cycle.</p>}
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
                {frame.screens.book.dayPnl === 0 ? (
                  <span className="font-mono text-[var(--color-muted)]">flat</span>
                ) : (
                  <span className={`font-mono ${frame.screens.book.dayPnl > 0 ? "text-[var(--color-up)]" : "text-[var(--color-down)]"}`}>
                    {frame.screens.book.dayPnl > 0 ? "+" : "−"}${Math.abs(frame.screens.book.dayPnl).toLocaleString()}
                  </span>
                )}
              </div>
              {frame.screens.book.positions.length === 0 && (
                <p className="rounded border border-dashed border-[var(--color-border)] px-2 py-1 text-[11px] text-[var(--color-muted)]">
                  No tickets open — desk is quiet{frame.clockLabel ? ` at ${frame.clockLabel}` : ""}{frame.trace.beat ? ` · ${beatWord(frame.trace.beat)}` : ""}.
                </p>
              )}
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
            {" "}−{Math.abs(ROOM_MANDATE.hardStopPct)}% backstop behind the level exit · +{ROOM_MANDATE.takeProfitPct}% trims half · 0–1 DTE · entries until 16:00. Size cut after 11:00.
            The room's own book fills at the model ask/bid. Orders reach a broker only through the Execution card below, which is off until you turn it on.
          </p>
        </div>
      </div>

      {/* Empty / unauthorised states fold into one slim card instead of
          three empty panels and an "Unauthorized" error. */}
      {(() => {
        const execLocked = Boolean(execError && !execStatus);
        const serverLocal = backup.status === "local";
        const empty = [
          !frame?.screens.ledger && "Nova's ledger (no priced plan)",
          !frame?.screens.lenses && "the vote (no card under review)",
          !frame?.screens.lab && "ghost room (nothing recorded)",
        ].filter(Boolean) as string[];
        if (!execLocked && !serverLocal && !empty.length) return null;
        return (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-1)] px-3 py-2 text-[13px]">
            {(execLocked || serverLocal) && (
              <span className="font-semibold text-[var(--color-fg)]">Sign in to enable execution and the server book</span>
            )}
            {(execLocked || serverLocal) && (
              <span className="text-[var(--color-muted)]">
                (account chip, top right{execLocked ? ` · execution: ${execError}` : ""}
                {serverLocal ? " · the room book is saved in this browser only" : ""})
              </span>
            )}
            {empty.length > 0 && <span className="text-[var(--color-muted)]">Waiting on: {empty.join(" · ")}</span>}
          </div>
        );
      })()}

      <ExecCard collapsed={Boolean(execError && !execStatus)} />

      {(frame?.screens.ledger || frame?.screens.lenses || frame?.screens.lab) && (
        <div className="grid gap-3 lg:grid-cols-3">
          {frame?.screens.ledger && <LedgerPanel frame={frame} />}
          {frame?.screens.lenses && <VotePanel frame={frame} />}
          {frame?.screens.lab && <GhostPanel frame={frame} />}
        </div>
      )}


      <details className="group rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-1)]">
        <summary className="cursor-pointer list-none px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-muted)]">
          <span className="mr-1 inline-block transition-transform group-open:rotate-90">▸</span> Investment Office
        </summary>
        <div className="px-1 pb-1">
          <InvestOfficePanel frame={frame} onGo={goTo} />
        </div>
      </details>

      <div>
        <div className={HEAD}>The people — needs, rank, grudges and what they remember</div>
        <PeopleCards frame={frame} selected={selected} onSelect={setSelected} />
      </div>
    </div>
  );
}
