import { useEffect, useState } from "react";
import { Bell, BellOff, BellRing, Volume2, VolumeX } from "lucide-react";
import {
  armPathAlarm,
  disarmPathAlarm,
  getPathAlarmState,
  mutePathAlarm,
  subscribePathAlarm,
  testPathAlarm,
  type PathAlarmState,
} from "@/lib/alerts/path-alarm";
import { ritualWindow } from "@/lib/trading/live-session";
import type { DeskPayload } from "@/lib/trading/build-desk";
import { CopyClaudeHandoff } from "@/components/desk/copy-claude-handoff";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function PathAlarmBar({ desk }: { desk?: DeskPayload }) {
  const [state, setState] = useState<PathAlarmState>(() => getPathAlarmState());
  const [ritual, setRitual] = useState(() => ritualWindow());
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => subscribePathAlarm(setState), []);
  useEffect(() => {
    const on = () => setState(getPathAlarmState());
    window.addEventListener("ledger-path-alarm", on);
    const id = window.setInterval(() => setRitual(ritualWindow()), 15_000);
    return () => {
      window.removeEventListener("ledger-path-alarm", on);
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
    <div className="mx-auto mt-1.5 flex max-w-7xl flex-wrap items-center gap-1.5">
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

      {state.lastTitle && state.lastAt && (
        <span className="truncate text-[10px] text-[var(--color-muted)]">
          Last: {state.lastTitle}
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
  );
}
