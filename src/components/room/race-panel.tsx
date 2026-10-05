/**
 * The race, beside the 3D floor: the goal ($1,000 → $5,000), the five paper seats and The Room, the R&D board and the desk
 * audit — the same reads the TVs in the annex draw and the live talk quotes (frame.screens.race), plus the goal's inputs, which
 * are the trader's to set. Reading only, except `setGoal`, which restarts the paper race and touches nothing else.
 */

import { useState } from "react";
import { Target } from "lucide-react";
import { defaultGoal, type GoalSpec } from "@/lib/room/goal";
import type { SeatEventLite } from "@/lib/room/live-types";
import { useRoomStore } from "./room-engine";
import type { FloorFrame } from "./floor-screens";

const CARD = "min-w-0 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-1)] p-3";
const BTN =
  "inline-flex items-center gap-1 rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-[11px] text-[var(--color-fg)] hover:border-[var(--color-primary)] focus:outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-primary)] disabled:opacity-40";
const HEAD = "mb-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-muted)]";
const INPUT = "w-full rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 font-mono text-[12px] text-[var(--color-fg)]";

const SECTIONS = [
  { id: "goal", label: "Goal", wall: "mon_Goal_0" },
  { id: "league", label: "League", wall: "tv_goal" },
  { id: "rnd", label: "R&D", wall: "tv_rnd" },
  { id: "audit", label: "Desk audit", wall: "mon_Rnd_0" },
] as const;
type SectionId = (typeof SECTIONS)[number]["id"];

const OWNER_COLOR: Record<string, string> = { Jax: "#e4572e", Nova: "#a78bfa", Sterling: "#ef4444", Gemma: "#22c55e", Vince: "#22d3ee" };
const SEV_COLOR = { high: "var(--color-down)", med: "#f59e0b", low: "var(--color-muted)" } as const;
const STATUS_COLOR = { collecting: "var(--color-muted)", supported: "var(--color-up)", not_supported: "var(--color-down)", undecided: "#f59e0b" } as const;

const money = (n: number) => `${n < 0 ? "−" : ""}$${Math.abs(Math.round(n)).toLocaleString("en-US")}`;
const signed = (n: number) => `${n >= 0 ? "+" : "−"}$${Math.abs(Math.round(n)).toLocaleString("en-US")}`;

/** A probability that may be tiny: never prints "0%" for something merely very small. */
function pctSmall(p: number): string {
  if (p <= 0) return "0%";
  if (p < 1e-5) return "<0.001%";
  if (p < 0.001) return `${(p * 100).toFixed(4)}%`;
  if (p < 0.1) return `${(p * 100).toFixed(2)}%`;
  return `${Math.round(p * 100)}%`;
}

function eventText(ev: SeatEventLite, name: (id: string | null) => string): string {
  const who = name(ev.seat);
  switch (ev.kind) {
    case "open":
      return `${who} bought ${ev.qty ?? "?"}× ${ev.contract ?? "a contract"}${ev.debit != null ? ` for ${money(ev.debit)}` : ""}`;
    case "close":
      return `${who} closed ${ev.contract ?? "a position"}${ev.usd != null ? ` ${signed(ev.usd)}` : ""}`;
    case "skip":
      return `${who} passed${ev.why ? `: ${ev.why}` : ""}`;
    case "blocked":
      return `${who} blocked${ev.gate ? ` by ${ev.gate}` : ""}${ev.why ? `: ${ev.why}` : ""}`;
    case "lead":
      return `${who} took the lead${ev.equity != null ? ` at ${money(ev.equity)}` : ""}`;
    case "finish":
      return `${who} finished${ev.why ? `: ${ev.why}` : ""}`;
    case "syndicate":
      return `${ev.n ?? ev.members?.length ?? 2} seats backed one card${ev.contract ? ` (${ev.contract})` : ""}`;
    case "syndicate_closed":
      return `a syndicate closed${ev.usd != null ? ` ${signed(ev.usd)}` : ""}`;
    default:
      return `${who} started the race`;
  }
}

/** The goal's inputs. Changing any of them restarts the paper race (the seats start over at the new start). */
function GoalForm({ goal }: { goal: GoalSpec }) {
  const setGoal = useRoomStore((s) => s.setGoal);
  const [f, setF] = useState(() => ({
    start: String(goal.start),
    target: String(goal.target),
    days: String(goal.tradingDays),
    floor: String(Math.round(goal.floorFrac * 100)),
    share: String(Math.round(goal.capFrac * 100)),
    minDelta: String(goal.minDelta),
    minAsk: String(goal.minAskUsd),
    startDate: goal.startDate,
  }));
  const [err, setErr] = useState<string | null>(null);
  const field = (k: keyof typeof f, label: string, width = "") => (
    <label className={`block text-[10px] text-[var(--color-muted)] ${width}`}>
      {label}
      <input className={INPUT} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} inputMode="decimal" />
    </label>
  );
  const apply = () => {
    const n = (s: string) => Number(s.replace(/[$,%\s]/g, ""));
    const next: GoalSpec = {
      ...goal,
      start: n(f.start),
      target: n(f.target),
      tradingDays: Math.round(n(f.days)),
      floorFrac: n(f.floor) / 100,
      capFrac: n(f.share) / 100,
      minDelta: n(f.minDelta),
      minAskUsd: n(f.minAsk),
      startDate: f.startDate.trim(),
    };
    setErr(setGoal(next));
  };
  return (
    <div className="mt-3 rounded border border-[var(--color-border)] p-2">
      <div className={HEAD}>The goal's numbers — yours to set</div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {field("start", "start $")}
        {field("target", "target $")}
        {field("days", "sessions")}
        {field("startDate", "day one (ET)")}
        {field("floor", "floor % of start")}
        {field("share", "ticket share %")}
        {field("minDelta", "min Δ")}
        {field("minAsk", "min ask $")}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button type="button" className={BTN} onClick={apply}>
          Apply (restarts the race)
        </button>
        <button type="button" className={BTN} onClick={() => setErr(setGoal(defaultGoal(Date.now())))}>
          Defaults
        </button>
        {err && <span className="text-[11px] text-[var(--color-down)]">{err}</span>}
      </div>
      <p className="mt-2 text-[10px] leading-snug text-[var(--color-subtle)]">
        These shape the paper experiment only. The house room's 10% ticket cap, the Execution card's limits and every gate are not changed by them.
      </p>
    </div>
  );
}

export function RacePanel({ frame, onGo }: { frame: FloorFrame | null; onGo: (screenId: string) => void }) {
  const goalSpec = useRoomStore((s) => s.goal);
  const [tab, setTab] = useState<SectionId>("goal");
  const r = frame?.screens.race ?? null;
  const g = r?.goal ?? null;
  const seats = r?.seats ?? null;
  const rnd = r?.rnd ?? null;
  const audit = r?.audit ?? [];
  const name = (id: string | null) => seats?.rows.find((x) => x.id === id)?.name ?? id ?? "someone";
  const section = SECTIONS.find((s) => s.id === tab)!;

  return (
    <div className={CARD}>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Target className="h-4 w-4 text-[#f472b6]" />
        <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-muted)]">The race — the five, the goal and the desk</div>
        <div className="ml-auto flex flex-wrap gap-1">
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setTab(s.id)}
              aria-pressed={tab === s.id}
              className={`rounded px-2 py-0.5 text-[11px] ${tab === s.id ? "bg-white text-black" : "border border-[var(--color-border)] text-[var(--color-fg)]"}`}
            >
              {s.label}
              {s.id === "audit" && audit.length ? ` (${audit.length})` : ""}
            </button>
          ))}
          <button type="button" className={BTN} onClick={() => onGo(section.wall)} title="Fly to the screen that shows this in the office">
            On the wall
          </button>
        </div>
      </div>

      {tab === "goal" && (
        <div>
          {g ? (
            <>
              <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                <span className="font-mono text-2xl font-bold text-[var(--color-fg)]">{money(g.equity)}</span>
                <span className="text-[12px] text-[var(--color-muted)]">
                  of {money(g.target)} · {g.status === "before" ? `starts ${g.startDate}` : g.status === "running" ? `day ${g.day} of ${g.of}` : g.status} · {g.leader ?? "no one"} leads
                </span>
                {g.paceLabel && (
                  <span className={`text-[12px] font-semibold ${g.paceLabel === "ahead" ? "text-[var(--color-up)]" : g.paceLabel === "behind" ? "text-[var(--color-down)]" : "text-[var(--color-fg)]"}`}>
                    {g.paceLabel}
                    {g.paceUsd != null ? ` (${signed(g.paceUsd)})` : ""}
                    <span className="ml-1 font-normal text-[var(--color-muted)]">vs the path's mark for the end of today</span>
                  </span>
                )}
              </div>
              <div className="relative mt-2 h-2 rounded bg-[var(--color-surface-2)]">
                <div className="h-2 rounded bg-[var(--color-up)]" style={{ width: `${Math.max(0, Math.min(100, ((g.equity - g.start) / Math.max(1, g.target - g.start)) * 100))}%` }} />
                <div className="absolute top-[-2px] h-3 w-[2px] bg-amber-400" style={{ left: `${Math.max(0, Math.min(100, ((g.floor - g.start) / Math.max(1, g.target - g.start)) * 100))}%` }} title={`floor ${money(g.floor)}`} />
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-[12px] sm:grid-cols-4">
                <div>
                  <dt className="text-[10px] text-[var(--color-muted)]">Odds of {money(g.target)} (exact)</dt>
                  <dd className="font-mono font-semibold">{pctSmall(g.pTarget)}</dd>
                </div>
                <div>
                  <dt className="text-[10px] text-[var(--color-muted)]">Touch the floor</dt>
                  <dd className="font-mono font-semibold">{pctSmall(g.pFloor)}</dd>
                </div>
                <div>
                  <dt className="text-[10px] text-[var(--color-muted)]">No card prints at all</dt>
                  <dd className="font-mono font-semibold">{pctSmall(g.pNoCard)}</dd>
                </div>
                <div>
                  <dt className="text-[10px] text-[var(--color-muted)]">Cards per session</dt>
                  <dd className="font-mono font-semibold">{g.lambda.toFixed(2)}</dd>
                </div>
              </dl>
              {g.winsNeed != null && (
                <p className="mt-2 text-[11px] leading-snug text-amber-300">
                  Straight line: {g.winsNeed} winning ticket{g.winsNeed === 1 ? "" : "s"} in a row at the {Math.round(g.capFrac * 100)}% ticket share would reach {money(g.target)}. The desk allows {g.tradeBudget} tickets
                  {" "}a month and expects {g.expectedTickets.toFixed(1)} in this window
                  {g.winsNeed > g.tradeBudget ? " — on the room's measured trade shape the goal cannot be reached even if every ticket wins; the cheaper strikes in the ladder have bigger payoffs and their own exact odds." : "."}
                </p>
              )}
              <p className="mt-2 text-[11px] leading-snug text-[var(--color-muted)]">
                {g.needed.pWin != null ? `It would take ${(g.needed.pWin * 100).toFixed(0)}% winners${g.needed.lambdaMultiple != null ? ` or ${g.needed.lambdaMultiple.toFixed(1)}× the cards` : ""}.` : "No win rate within reach gets there on this many cards."} Measured: {(g.measured.pWin * 100).toFixed(0)}% win ·
                {" "}mean {g.measured.meanPct >= 0 ? "+" : ""}
                {g.measured.meanPct.toFixed(1)}% of premium{g.measured.n != null ? ` (n ${g.measured.n})` : ""}. The gates do not move for the goal.
              </p>
              {g.collisions.filter((c) => c.ask).length > 0 && (
                <div className="mt-3">
                  <div className={HEAD}>Where the goal meets the rules — your call</div>
                  <ul className="space-y-1.5 text-[11px]">
                    {g.collisions
                      .filter((c) => c.ask)
                      .map((c) => (
                        <li key={c.id} className="rounded border border-[var(--color-border)] p-2">
                          <div className="font-semibold" style={{ color: c.severity === "blocker" ? "var(--color-down)" : "#f59e0b" }}>
                            {c.title}
                          </div>
                          <div className="text-[var(--color-muted)]">{c.detail}</div>
                          {c.decision && <div className="mt-0.5 text-[var(--color-fg)]">{c.decision}</div>}
                        </li>
                      ))}
                  </ul>
                </div>
              )}
            </>
          ) : (
            <p className="text-[12px] text-[var(--color-muted)]">The goal is planned with the first room cycle.</p>
          )}
          <GoalForm key={JSON.stringify(goalSpec)} goal={goalSpec} />
        </div>
      )}

      {tab === "league" && (
        <div>
          {seats ? (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-[12px]">
                  <thead className="text-[10px] uppercase text-[var(--color-muted)]">
                    <tr>
                      <th className="py-1 pr-2">#</th>
                      <th className="pr-2">Seat</th>
                      <th className="pr-2 text-right">Equity</th>
                      <th className="pr-2 text-right">P&amp;L</th>
                      <th className="pr-2 text-right">Open</th>
                      <th className="pr-2 text-right">Took</th>
                      <th className="text-right">Declined</th>
                    </tr>
                  </thead>
                  <tbody className="font-mono">
                    {seats.rows.map((x, i) => (
                      <tr key={x.id} className="border-t border-[var(--color-border)]">
                        <td className="py-1 pr-2">{i + 1}</td>
                        <td className="pr-2 font-sans font-semibold" style={{ color: x.owner ? OWNER_COLOR[x.owner] : "var(--color-fg)" }}>
                          {x.name}
                          {x.status !== "running" ? ` · ${x.status === "hit" ? "GOAL" : "FLOOR"}` : ""}
                        </td>
                        <td className="pr-2 text-right">{money(x.equity)}</td>
                        <td className={`pr-2 text-right ${x.pnl >= 0 ? "text-[var(--color-up)]" : "text-[var(--color-down)]"}`}>{signed(x.pnl)}</td>
                        <td className="pr-2 text-right">{x.open}</td>
                        <td className="pr-2 text-right">
                          {x.taken.n} ({x.taken.wins}W)
                        </td>
                        <td className="text-right">{x.declined.n}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-2 text-[10px] leading-snug text-[var(--color-subtle)]">
                {seats.sessions} session{seats.sessions === 1 ? "" : "s"} · {seats.touches} CE touch{seats.touches === 1 ? "" : "es"} · syndicates {seats.syndicates.n} (closed {seats.syndicates.closed}, {signed(seats.syndicates.usd)}). Each seat is a $
                {goalSpec.start.toLocaleString()} paper account trading the room's own checklist and exits — the style differs, the rules do not.
              </p>
              <ul className="mt-2 space-y-0.5 text-[11px] text-[var(--color-muted)]">
                {seats.events.slice(0, 6).map((ev) => (
                  <li key={ev.id}>
                    <span className="font-mono text-[var(--color-subtle)]">{new Date(ev.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span> {eventText(ev, name)}
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="text-[12px] text-[var(--color-muted)]">The seats open with the first room cycle.</p>
          )}
        </div>
      )}

      {tab === "rnd" && (
        <div>
          {rnd && rnd.experiments.length ? (
            <ul className="space-y-1.5 text-[11px]">
              {rnd.experiments.map((e) => (
                <li key={e.id} className="rounded border border-[var(--color-border)] p-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-bold" style={{ color: OWNER_COLOR[e.owner] }}>
                      {e.owner}
                    </span>
                    <span className="font-semibold text-[var(--color-fg)]">{e.title}</span>
                    <span className="ml-auto font-mono" style={{ color: STATUS_COLOR[e.status] }}>
                      {e.n}/{e.nNeeded} · {e.status.replace("_", " ")}
                    </span>
                  </div>
                  <div className="text-[var(--color-muted)]">{e.read}</div>
                  {e.proposal && <div className="mt-0.5 text-amber-300">Proposal for you: {e.proposal}</div>}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[12px] text-[var(--color-muted)]">The experiments register with the first session. Each has its bar fixed in advance; a proposal reaches you only when one clears it, and none of them edits a rule.</p>
          )}
        </div>
      )}

      {tab === "audit" && (
        <div>
          {audit.length ? (
            <ul className="space-y-1.5 text-[11px]">
              {audit.map((a) => (
                <li key={a.id} className="rounded border border-[var(--color-border)] p-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-bold" style={{ color: OWNER_COLOR[a.owner] }}>
                      {a.owner}
                    </span>
                    <span className="font-semibold text-[var(--color-fg)]">{a.title}</span>
                    <span className="ml-auto text-[10px] uppercase" style={{ color: SEV_COLOR[a.severity] }}>
                      {a.severity} · {a.area}
                    </span>
                  </div>
                  <div className="text-[var(--color-muted)]">{a.evidence}</div>
                  <div className="mt-0.5 text-[var(--color-fg)]">{a.proposal}</div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[12px] text-[var(--color-muted)]">Nothing the five can prove is wrong with the desk right now. An item appears when its evidence does and goes when it does.</p>
          )}
          <p className="mt-2 text-[10px] leading-snug text-[var(--color-subtle)]">
            The audit reads facts the desk already holds (feed health, the goal's collisions, the ghost room, the R&amp;D board, the execution flags). It proposes; it never edits a rule, a size or a number in config.ts.
          </p>
        </div>
      )}
    </div>
  );
}
