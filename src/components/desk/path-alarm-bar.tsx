import { useEffect, useState } from "react";
import { Bell, BellOff, BellRing, Volume2, VolumeX } from "lucide-react";
import {
  armPathAlarm,
  disarmPathAlarm,
  getPathAlarmState,
  mutePathAlarm,
  subscribePathAlarm,
  testPathAlarm,
  PATH_ALARM_EVENT,
  type PathAlarmFire,
  type PathAlarmState,
} from "@/lib/alerts/path-alarm";
import {
  getAutoPaperState,
  setAutoPaper,
  subscribeAutoPaper,
  type AutoPaperState,
} from "@/lib/trading/auto-paper";
import { ritualWindow } from "@/lib/trading/live-session";
import type { DeskPayload } from "@/lib/trading/build-desk";
import { CopyClaudeHandoff } from "@/components/desk/copy-claude-handoff";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function PathAlarmBar({ desk }: { desk?: DeskPayload }) {
  const [state, setState] = useState<PathAlarmState>(() => getPathAlarmState());
  const [auto, setAuto] = useState<AutoPaperState>(() => getAutoPaperState());
  const [ritual, setRitual] = useState(() => ritualWindow());
  const [msg, setMsg] = useState<string | null>(null);
  /**
   * The last alarm, pinned on the page until the trader dismisses it.
   *
   * The fire carried the whole ticket — size, stop, what to do at T1, when
   * the idea is dead — and the only thing listening was the OS notification,
   * which silently does nothing without permission. The event was dispatched
   * and nobody heard it.
   */
  const [pinned, setPinned] = useState<PathAlarmFire | null>(null);
  useEffect(() => {
    const onFire = (e: Event) => {
      const detail = (e as CustomEvent<PathAlarmFire>).detail;
      if (detail) setPinned(detail);
    };
    window.addEventListener(PATH_ALARM_EVENT, onFire);
    return () => window.removeEventListener(PATH_ALARM_EVENT, onFire);
  }, []);

  useEffect(() => subscribePathAlarm(setState), []);
  useEffect(() => subscribeAutoPaper(setAuto), []);
  useEffect(() => {
    const on = () => setState(getPathAlarmState());
    const onAuto = () => setAuto(getAutoPaperState());
    window.addEventListener("ledger-path-alarm", on);
    window.addEventListener("ledger-auto-paper", onAuto);
    const id = window.setInterval(() => setRitual(ritualWindow()), 15_000);
    return () => {
      window.removeEventListener("ledger-path-alarm", on);
      window.removeEventListener("ledger-auto-paper", onAuto);
      window.clearInterval(id);
    };
  }, []);

  const onArm = async () => {
    const res = await armPathAlarm();
    setState(getPathAlarmState());
    setMsg(res.ok ? "Alarm armed — keep this tab open" : res.reason ?? "Failed");
    window.setTimeout(() => setMsg(null), 4000);
  };

  return (
    <>
    {pinned && (
      <div
        role="alert"
        className="mx-auto mt-1.5 max-w-7xl rounded-[var(--radius-md)] border border-[color-mix(in_oklab,var(--color-warn)_55%,var(--color-border))] bg-[color-mix(in_oklab,var(--color-warn)_10%,var(--color-surface))] px-3 py-2"
      >
        <div className="flex items-start justify-between gap-2">
          <p className="text-[12px] font-semibold text-[var(--color-fg)]">
            {pinned.title}
            <span className="ml-2 font-normal text-[10px] text-[var(--color-subtle)]">
              {new Date(pinned.at).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit" })} ET
            </span>
          </p>
          <button
            type="button"
            onClick={() => setPinned(null)}
            className="shrink-0 rounded-[var(--radius-sm)] border border-[var(--color-border)] px-2 py-0.5 text-[10px] text-[var(--color-muted)] hover:text-[var(--color-fg)]"
          >
            Dismiss
          </button>
        </div>
        <pre className="mt-1 whitespace-pre-wrap font-mono text-[10.5px] leading-snug text-[var(--color-fg)]">
          {pinned.body}
        </pre>
      </div>
    )}
    <div className="mx-auto mt-1.5 flex max-w-7xl flex-wrap items-center gap-1.5">
      {auto.on ? (
        <button
          type="button"
          onClick={() => setAuto(setAutoPaper(false))}
          className={cn(
            "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
            "border-[color-mix(in_oklab,var(--color-up)_45%,var(--color-border))] text-[var(--color-up)]",
          )}
          title="Auto paper rests a limit at CE for a sequence TAKE on a PATH A+/A/A− card in NY AM; it fills on the touch and books stats"
        >
          Auto paper on
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setAuto(setAutoPaper(true))}
          className="inline-flex items-center gap-1 rounded-full border border-[var(--color-border)] px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-muted)]"
          title="Click to let the desk rest paper limits for sequence TAKEs and write stats"
        >
          Auto paper off
        </button>
      )}

      {state.armed ? (
        <button
          type="button"
          onClick={() => disarmPathAlarm()}
          className={cn(
            "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
            "border-[color-mix(in_oklab,var(--color-up)_45%,var(--color-border))] text-[var(--color-up)]",
          )}
        >
          <BellRing className="h-3 w-3" />
          Alarm on
        </button>
      ) : (
        <button
          type="button"
          onClick={() => void onArm()}
          className="inline-flex items-center gap-1 rounded-full border border-[var(--color-primary)] bg-[color-mix(in_oklab,var(--color-primary)_14%,transparent)] px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-fg)]"
        >
          <Bell className="h-3 w-3" />
          Arm alarm
        </button>
      )}

      {state.armed && (
        <button
          type="button"
          onClick={() => mutePathAlarm(!state.muted)}
          className="inline-flex items-center gap-1 rounded-full border border-[var(--color-border)] px-2 py-0.5 text-[10px] text-[var(--color-muted)]"
        >
          {state.muted ? (
            <>
              <VolumeX className="h-3 w-3" /> Muted
            </>
          ) : (
            <>
              <Volume2 className="h-3 w-3" /> Sound
            </>
          )}
        </button>
      )}

      <Button
        variant="ghost"
        size="sm"
        className="h-6 px-2 text-[10px]"
        onClick={() => testPathAlarm("short")}
      >
        Test beep
      </Button>
      {desk && <CopyClaudeHandoff desk={desk} />}

      <span
        className={cn(
          "rounded-full border px-2 py-0.5 text-[10px]",
          ritual.id === "judas"
            ? "border-[color-mix(in_oklab,var(--color-down)_40%,var(--color-border))] text-[var(--color-down)]"
            : ritual.id === "pulse" || ritual.id === "premarket"
              ? "border-[color-mix(in_oklab,var(--color-warn)_40%,var(--color-border))] text-[var(--color-warn)]"
              : ritual.id === "prime"
                ? "border-[color-mix(in_oklab,var(--color-up)_40%,var(--color-border))] text-[var(--color-up)]"
                : "border-[var(--color-border)] text-[var(--color-subtle)]",
        )}
      >
        {ritual.label} · {ritual.et}
      </span>

      {auto.on && auto.lastTitle && (
        <span className="truncate text-[10px] text-[var(--color-up)]">
          Auto: {auto.lastTitle}
        </span>
      )}
      {auto.on && !auto.lastTitle && auto.lastSkip && (
        <span className="hidden truncate text-[10px] text-[var(--color-subtle)] lg:inline">
          Auto wait · {auto.lastSkip}
        </span>
      )}
      {msg && <span className="text-[10px] text-[var(--color-up)]">{msg}</span>}
      {!state.armed && (
        <span className="hidden text-[10px] text-[var(--color-subtle)] sm:inline">
          Click Arm — A+/A/A- PATH will beep this computer
        </span>
      )}
      {state.armed && ritual.id === "off" && (
        <span className="hidden items-center gap-1 text-[10px] text-[var(--color-subtle)] sm:inline-flex">
          <BellOff className="h-3 w-3" />
          Alarm stays armed; only fires on high-prob PATH
        </span>
      )}
    </div>
    </>
  );
}
