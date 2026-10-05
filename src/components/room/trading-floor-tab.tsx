/**
 * Floor — the 3D trading room as its own tab.
 *
 * Live: the room engine (room-engine.ts) runs a cycle on every desk refresh
 * and this tab draws it. Drill: a scripted, clearly SYNTHETIC day played
 * through the same engine, for when the market is shut. Paper only.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Camera, Copy, Expand, History, Pause, Play, RotateCcw, SkipForward, Users, Volume2, VolumeX } from "lucide-react";
import { getNewsFeed } from "@/lib/news/news-server";
import { CREW, TRAITS, rankTitle, recordLine, relationWord } from "@/lib/room/agents";
import { DRILL_LABEL, playDrill, type DrillStep } from "@/lib/room/drill";
import { ROOM_CLOCK, ROOM_MANDATE, type Character, type DialogueLine } from "@/lib/room/orchestrator";
import { ROOM_DEFAULT_CASH } from "@/lib/room/paper-book";
import { etWallParts } from "@/lib/trading/sessions";
import { FloorScene, LAYOUT, type CameraPreset, type FloorEvent } from "./floor-scene";
import { FloorSound, loadSoundPref, saveSoundPref } from "./floor-sound";
import { ExecCard } from "./exec-card";
import { URGENCY_COLOR, type FloorFrame } from "./floor-screens";
import { ageOf, drillFrame, useRoomStore } from "./room-engine";
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
  { id: "follow", label: "Speaker" },
];

function optionsOpenNow(): boolean {
  const p = etWallParts(Date.now());
  const m = p.hour * 60 + p.minute;
  return p.weekday >= 1 && p.weekday <= 5 && m >= ROOM_CLOCK.optionsOpenMin && m < ROOM_CLOCK.optionsCloseMin;
}

/* ── The 3D canvas ──────────────────────────────────────────────────────── */

/** Live only: an unchanged story is talked through again at most this often. */
const SAME_STORY_TALK_MS = 150_000;

/** A trade, an exit or a change of story — the room drops what it is saying. */
function storyChanged(next: FloorFrame, prev: FloorFrame | null): boolean {
  return (
    !prev ||
    next.output.broker_action.execute_trade ||
    next.trace.beat !== prev.trace.beat ||
    (next.trace.meeting?.key ?? "") !== (prev.trace.meeting?.key ?? "") ||
    next.screens.synthetic !== prev.screens.synthetic
  );
}

function FloorCanvas({
  frame,
  speed,
  camera,
  onSpeaker,
  onMeetingDone,
  onSelect,
  onEnvironment,
  onEvent,
  focusLine,
  replaying,
}: {
  frame: FloorFrame | null;
  speed: number;
  camera: CameraPreset;
  onSpeaker: (i: number, line: DialogueLine | null) => void;
  onMeetingDone: () => void;
  onSelect: (who: Character) => void;
  onEnvironment: (src: "glb" | "fallback") => void;
  onEvent: (e: FloorEvent) => void;
  focusLine: { i: number; n: number } | null;
  replaying: boolean;
}) {
  const host = useRef<HTMLDivElement>(null);
  const scene = useRef<FloorScene | null>(null);
  const cbs = useRef({ onSpeaker, onMeetingDone, onSelect, onEnvironment, onEvent });
  cbs.current = { onSpeaker, onMeetingDone, onSelect, onEnvironment, onEvent };
  const [error, setError] = useState<string | null>(null);
  // What the scene is showing, whether a meeting is running, and the newest
  // cycle waiting for that meeting to end. All per scene instance.
  const latest = useRef({ frame, speed });
  latest.current = { frame, speed };
  const shown = useRef<FloorFrame | null>(null);
  const playing = useRef(false);
  const pending = useRef<FloorFrame | null>(null);
  const lastTalk = useRef(0);
  const replayRef = useRef(false);
  replayRef.current = replaying;

  const show = useCallback((f: FloorFrame, talk: boolean) => {
    const sc = scene.current;
    if (!sc) return;
    shown.current = f;
    if (talk) {
      playing.current = true;
      lastTalk.current = Date.now();
    }
    sc.apply(f, latest.current.speed, talk);
  }, []);

  useEffect(() => {
    if (!host.current) return;
    try {
      scene.current = new FloorScene(host.current, {
        onSpeaker: (i, l) => {
          if (i >= 0) playing.current = true;
          cbs.current.onSpeaker(i, l);
        },
        onMeetingDone: () => {
          playing.current = false;
          cbs.current.onMeetingDone();
          // A newer cycle arrived mid-meeting: it is the story now.
          const next = pending.current;
          pending.current = null;
          if (next && next !== shown.current) show(next, true);
        },
        onSelect: (w) => cbs.current.onSelect(w),
        onEnvironment: (s) => cbs.current.onEnvironment(s),
        onEvent: (e) => cbs.current.onEvent(e),
      });
      // A new scene has shown nothing (React's dev double-mount builds two).
      shown.current = null;
      playing.current = false;
      pending.current = null;
      const f = latest.current.frame;
      if (f) show(f, true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "WebGL is unavailable in this browser.");
    }
    return () => {
      scene.current?.dispose();
      scene.current = null;
    };
  }, [show]);

  useEffect(() => {
    if (!frame || !scene.current || frame === shown.current) return;
    const prev = shown.current;
    // The drill and the replay only move on a click or at a meeting's end: show it now.
    if (storyChanged(frame, prev) || frame.screens.synthetic || replayRef.current) show(frame, true);
    else if (playing.current) pending.current = frame;
    else show(frame, Date.now() - lastTalk.current >= SAME_STORY_TALK_MS);
  }, [frame, show]);

  useEffect(() => scene.current?.setSpeed(speed), [speed]);
  useEffect(() => scene.current?.setCamera(camera), [camera]);
  useEffect(() => {
    if (focusLine) scene.current?.focusLine(focusLine.i);
  }, [focusLine]);

  if (error)
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-sm text-[var(--color-muted)]">
        The 3D floor needs WebGL ({error}). The meeting, the contract JSON and the book below still run.
      </div>
    );
  return <div ref={host} className="absolute inset-0" />;
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
  const live = useRoomStore((s) => s.frame);
  const enabled = useRoomStore((s) => s.enabled);
  const setEnabled = useRoomStore((s) => s.setEnabled);
  const book = useRoomStore((s) => s.book);
  const reset = useRoomStore((s) => s.reset);
  const setNews = useRoomStore((s) => s.setNews);
  const history = useRoomStore((s) => s.history);
  const backup = useRoomStore((s) => s.backup);
  const [mode, setMode] = useState<"live" | "drill" | "replay">(() => (optionsOpenNow() ? "live" : "drill"));
  const [camera, setCamera] = useState<CameraPreset>("auto");
  const [speed, setSpeed] = useState(1);
  const [speaker, setSpeaker] = useState<{ i: number; line: DialogueLine | null }>({ i: -1, line: null });
  const [selected, setSelected] = useState<Character | null>(null);
  const [env, setEnv] = useState<"glb" | "fallback" | null>(null);
  const [focus, setFocus] = useState<{ i: number; n: number } | null>(null);
  const [copied, setCopied] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

  // The drill: precomputed through the real pipeline, played one frame per meeting.
  const steps = useMemo<DrillStep[]>(() => (mode === "drill" ? playDrill(ROOM_DEFAULT_CASH) : []), [mode]);
  const [drillIdx, setDrillIdx] = useState(0);
  const [drillPlaying, setDrillPlaying] = useState(true);
  const drillFrameNow = useMemo(
    () => (mode === "drill" && steps.length ? drillFrame(steps[drillIdx]!, steps.slice(0, drillIdx + 1), 100_000 + drillIdx) : null),
    [mode, steps, drillIdx],
  );
  // The day's replay: today's story beats from the live engine, scrubbed or auto-played.
  const [replayIdx, setReplayIdx] = useState(0);
  const replayFrame = mode === "replay" ? (history[Math.min(replayIdx, history.length - 1)] ?? null) : null;
  const frame = mode === "drill" ? drillFrameNow : mode === "replay" ? replayFrame : live;

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
  const onEvent = useCallback((e: FloorEvent) => {
    if (soundOnRef.current) sound.current?.play(e);
  }, []);

  // Headlines for the news TVs — only while this tab is open.
  useEffect(() => {
    let alive = true;
    const pull = async () => {
      try {
        const r = await getNewsFeed();
        if (!alive) return;
        const now = Date.now();
        setNews(r.items.slice(0, 12).map((i) => ({ title: i.title, source: i.source, age: ageOf(i.published, now) })));
      } catch {
        // The TV says "no headlines" instead.
      }
    };
    void pull();
    const id = window.setInterval(pull, 5 * 60_000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [setNews]);

  const onMeetingDone = useCallback(() => {
    if (!drillPlaying) return;
    if (mode === "drill") window.setTimeout(() => setDrillIdx((i) => (i + 1 < steps.length ? i + 1 : i)), 900 / speed);
    else if (mode === "replay") window.setTimeout(() => setReplayIdx((i) => (i + 1 < history.length ? i + 1 : i)), 700 / speed);
  }, [mode, drillPlaying, steps.length, history.length, speed]);

  const onSpeaker = useCallback((i: number, line: DialogueLine | null) => setSpeaker({ i, line }), []);

  const fullscreen = () => {
    const el = wrap.current;
    if (!el) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void el.requestFullscreen?.();
  };

  const json = frame ? JSON.stringify(frame.output, null, 2) : "";
  const urgency = frame?.output.room_state.market_urgency ?? "LOW";
  const lines = frame?.output.floor_dialogue_and_meetings ?? [];
  const ba = frame?.output.broker_action;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Users className="h-4 w-4 text-[var(--color-primary)]" />
        <h2 className="text-sm font-semibold text-[var(--color-fg)]">Trading floor</h2>
        <div className="flex overflow-hidden rounded border border-[var(--color-border)] text-[11px]">
          {(["live", "replay", "drill"] as const).map((m) => (
            <button
              key={m}
              type="button"
              disabled={m === "replay" && history.length < 2}
              title={m === "replay" ? `Today's ${history.length} story beats, as a time-lapse` : undefined}
              onClick={() => {
                setMode(m);
                setDrillIdx(0);
                setReplayIdx(0);
                setDrillPlaying(true);
              }}
              className={`px-2 py-1 disabled:opacity-40 ${mode === m ? "bg-[var(--color-primary)] text-white" : "text-[var(--color-muted)]"}`}
            >
              {m === "live" ? "Live desk" : m === "replay" ? "Today's replay" : "Drill (synthetic)"}
            </button>
          ))}
        </div>
        <span className="rounded px-2 py-0.5 text-[11px] font-semibold text-black" style={{ background: URGENCY_COLOR[urgency] }}>
          {urgency.replace("_", " ")}
        </span>
        {frame && <span className="font-mono text-[11px] text-[var(--color-muted)]">{frame.clockLabel}</span>}
        <span className="font-mono text-[11px] text-[var(--color-subtle)]">{frame?.screens.source ?? ""}</span>
        <button
          type="button"
          className={`${BTN} ml-auto`}
          aria-pressed={soundOn}
          onClick={() => {
            const on = !soundOn;
            setSoundOn(on);
            if (on) sound.current?.unlock();
            saveSoundPref({ on, volume: sound.current?.volume ?? 0.5 });
          }}
        >
          {soundOn ? <Volume2 className="h-3 w-3" /> : <VolumeX className="h-3 w-3" />} {soundOn ? "Sound on" : "Sound off"}
        </button>
        <label className="flex items-center gap-1 text-[11px] text-[var(--color-muted)]">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          room runs in the background (paper)
        </label>
      </div>

      {mode === "drill" && (
        <p className="rounded border border-[var(--color-border)] bg-[color-mix(in_oklab,#f59e0b_12%,var(--color-surface))] px-3 py-1.5 text-[11px] text-[var(--color-fg)]">
          {DRILL_LABEL}. Same engine, same people, same paper book rules as live — the tape, the cards and the release are scripted.
        </p>
      )}
      {mode === "live" && !live && (
        <p className="rounded border border-[var(--color-border)] px-3 py-1.5 text-[11px] text-[var(--color-muted)]">
          {enabled ? "Waiting for the next desk refresh to run the first room cycle…" : "The room engine is off — switch it on above, or play the drill."}
        </p>
      )}

      <div ref={wrap} className="relative h-[58vh] min-h-[340px] w-full overflow-hidden rounded-xl border border-[var(--color-border)] bg-[#0b1220]">
        <FloorCanvas
          frame={frame}
          speed={speed}
          camera={camera}
          onSpeaker={onSpeaker}
          onMeetingDone={onMeetingDone}
          onSelect={(w) => {
            setSelected(w);
          }}
          onEnvironment={setEnv}
          onEvent={onEvent}
          focusLine={focus}
          replaying={mode === "replay"}
        />
        <div className="pointer-events-none absolute left-2 top-2 flex max-w-[70%] flex-wrap gap-1">
          {frame?.trace.meeting && (
            <span className="rounded bg-black/70 px-2 py-0.5 text-[11px] font-semibold text-amber-300">MEETING · {frame.trace.meeting.title}</span>
          )}
          {frame && <span className="rounded bg-black/60 px-2 py-0.5 font-mono text-[11px] text-slate-200">{frame.trace.beat}</span>}
          {env && <span className="rounded bg-black/50 px-2 py-0.5 text-[10px] text-slate-400">{env === "glb" ? "office: Blender" : "office: plan boxes"}</span>}
        </div>
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
        {mode === "drill" && frame?.caption && (
          <div className="pointer-events-none absolute left-2 top-9 max-w-[60%] rounded bg-amber-500/90 px-2 py-1 text-[11px] font-medium text-black">
            {steps[drillIdx]?.frame.at} — {frame.caption}
          </div>
        )}
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
            <p className="text-[12px] text-slate-400">{frame ? "…" : "Building the floor…"}</p>
          )}
          {mode === "replay" && history.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button type="button" className={BTN} onClick={() => setDrillPlaying((p) => !p)}>
                {drillPlaying ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />} {drillPlaying ? "Pause" : "Play"}
              </button>
              <History className="h-3 w-3 text-slate-300" />
              <input
                type="range"
                min={0}
                max={Math.max(0, history.length - 1)}
                value={Math.min(replayIdx, history.length - 1)}
                onChange={(e) => {
                  setDrillPlaying(false);
                  setReplayIdx(Number(e.target.value));
                }}
                className="w-48 accent-amber-400"
                aria-label="Scrub today's replay"
              />
              <span className="font-mono text-[11px] text-slate-300">
                {replayFrame?.clockLabel ?? ""} · {Math.min(replayIdx, history.length - 1) + 1}/{history.length}
              </span>
            </div>
          )}
          {mode === "drill" && (
            <div className="mt-2 flex flex-wrap items-center gap-1">
              <button type="button" className={BTN} onClick={() => setDrillPlaying((p) => !p)}>
                {drillPlaying ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />} {drillPlaying ? "Pause" : "Play"}
              </button>
              <button type="button" className={BTN} onClick={() => setDrillIdx((i) => Math.min(steps.length - 1, i + 1))}>
                <SkipForward className="h-3 w-3" /> Next
              </button>
              <button type="button" className={BTN} onClick={() => setDrillIdx(0)}>
                <RotateCcw className="h-3 w-3" /> Restart
              </button>
              <input
                type="range"
                min={0}
                max={Math.max(0, steps.length - 1)}
                value={drillIdx}
                onChange={(e) => {
                  setDrillPlaying(false);
                  setDrillIdx(Number(e.target.value));
                }}
                className="w-40 accent-amber-400"
                aria-label="Scrub the drill"
              />
              <span className="text-[11px] text-slate-300">
                {drillIdx + 1}/{steps.length}
              </span>
            </div>
          )}
          <div className="mt-1 flex items-center gap-1 text-[10px] text-slate-400">
            speed
            {[1, 1.5, 2].map((s) => (
              <button key={s} type="button" onClick={() => setSpeed(s)} className={`rounded px-1.5 ${speed === s ? "bg-white text-black" : "bg-black/50 text-slate-200"}`}>
                {s}×
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        <div className={CARD}>
          <div className={HEAD}>The meeting · {lines.length} lines</div>
          <ol className="space-y-1.5">
            {lines.map((l, i) => (
              <li key={i}>
                <button
                  type="button"
                  onClick={() => setFocus({ i, n: Date.now() })}
                  className={`w-full rounded px-1.5 py-1 text-left text-[12px] leading-snug ${speaker.i === i ? "bg-[var(--color-surface-2)]" : ""}`}
                >
                  <span className="font-semibold" style={{ color: COLOR[l.character] }}>
                    {l.character}
                  </span>{" "}
                  <span className="text-[var(--color-fg)]">{l.text}</span>
                </button>
              </li>
            ))}
          </ol>
        </div>

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
          <div className={HEAD}>Room book (paper{mode === "drill" ? " · drill book" : ""})</div>
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
          {mode === "live" && (
            <button
              type="button"
              className={`${BTN} mt-3`}
              onClick={() => {
                if (window.confirm(`Reset the room's paper book to $${ROOM_DEFAULT_CASH.toLocaleString()}? Positions and history are cleared. Close the desk on your other devices first, or one still running the old book will bring it back.`)) reset();
              }}
            >
              <RotateCcw className="h-3 w-3" /> Reset book (${book.startCash.toLocaleString()} start)
            </button>
          )}
          {mode === "live" && (
            <p className={`mt-2 text-[10px] leading-snug ${backup.status === "local" ? "text-[var(--color-down)]" : "text-[var(--color-muted)]"}`}>
              Server copy: {backup.why}
              {backup.at ? ` (${new Date(backup.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })})` : ""}
            </p>
          )}
          <p className="mt-3 text-[10px] leading-snug text-[var(--color-subtle)]">
            Mandate: ≤{ROOM_MANDATE.maxOpenPositions} open · ≤{Math.round(ROOM_MANDATE.maxCashFracPerTrade * 100)}% cash a ticket (and ≤$1,000) ·
            {" "}−{Math.abs(ROOM_MANDATE.hardStopPct)}% backstop behind the level exit · +{ROOM_MANDATE.takeProfitPct}% trims half · 0–1 DTE · flat by 11:00.
            The room's own book fills at the model ask/bid. Orders reach a broker only through the Execution card below, which is off until you turn it on.
          </p>
        </div>
      </div>

      {mode === "live" && <ExecCard />}

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
