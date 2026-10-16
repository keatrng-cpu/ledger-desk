/**
 * Rule 1 SHADOW fire lane (audits/overnight-1016/report.md, blocker #9 and latency cut (c)). Pure, read-only.
 * A Rule 1 ticket is born on a CLOSED 5m bar, so it gets its own lane that skips the fast:persist hold. The desk stamps
 * each ticket with the lane read (closed bar, age at build, would-fire); the watcher logs when the lane WOULD fire and
 * the latency vs the legacy persist path. Config: shared/rule1-lane.json (outside the rules hash). live is false:
 * nothing here gates, sizes or fires, and the live fast chain / RH order path are unchanged.
 */
import CFG from "../../../shared/rule1-lane.json";

export type Rule1Lane = {
  lane: "rule1"; mode: "shadow"; live: false; version: number; persistExempt: boolean;
  barCloseAt: number; builtAt: number; ageS: number; closedBar: boolean; stale: boolean; wouldFire: boolean;
  legacyPersistHoldS: number; why: string;
};

export function rule1Lane(t: { at: number }, nowMs: number): Rule1Lane {
  const ageS = +((nowMs - t.at) / 1000).toFixed(1);
  const closedBar = t.at <= nowMs;
  const stale = ageS > CFG.maxAgeS;
  const wouldFire = closedBar && !stale;
  return {
    lane: "rule1", mode: "shadow", live: false, version: CFG.version, persistExempt: CFG.persistExempt,
    barCloseAt: t.at, builtAt: nowMs, ageS, closedBar, stale, wouldFire, legacyPersistHoldS: CFG.legacyPersistHoldS,
    why: !closedBar ? "bar not closed yet" : stale ? `ticket ${ageS}s old (> ${CFG.maxAgeS}s)` : `closed 5m bar ${ageS}s ago; persist exempt (shadow, no order)`,
  };
}

/** Attach the lane read to each ticket (returns new objects; the input is not mutated). */
export function withLane<T extends { at: number }>(tickets: T[], nowMs: number): (T & { lane: Rule1Lane })[] {
  return tickets.map((t) => ({ ...t, lane: rule1Lane(t, nowMs) }));
}
