/**
 * THE DESK AUDIT — what the five find wrong with the ledger desk, from the evidence in front of them.
 *
 * The trader's brief: the agents should be "analyzing the ledger desk and looking for fixes it needs". The honest form is a
 * deterministic read of facts the desk already holds — the feed's health, the goal's collisions, the R&D board's verdicts,
 * the ghost room's refusals, the execution layer's flags — turned into a short ranked list with an owner, the evidence line
 * and a proposal for the TRADER. Nothing here edits a rule, a config or a size; nothing calls a model; every number is
 * quoted from the read it came from. An item disappears when its evidence does.
 */

import { EXEC_FLAGS } from "./exec/limits";
import type { Character } from "./orchestrator";
import type { FeedRead, GoalLite, LabLite, RndLite, SeatsLite } from "./live-types";

export interface AuditItem {
  id: string;
  owner: Character;
  area: "data" | "rules" | "model" | "execution" | "goal" | "process";
  severity: "high" | "med" | "low";
  title: string;
  evidence: string;
  proposal: string;
}

const money = (n: number) => `${n < 0 ? "−" : "+"}$${Math.abs(Math.round(n)).toLocaleString("en-US")}`;
const ORDER = { high: 0, med: 1, low: 2 } as const;

export function deskAudit(a: { feed: FeedRead | null; goal: GoalLite | null; lab: LabLite | null; rnd: RndLite | null; seats: SeatsLite | null }): AuditItem[] {
  const out: AuditItem[] = [];
  const f = a.feed;
  if (f) {
    if (f.kind === "synthetic" || f.kind === "none")
      out.push({ id: "feed_dark", owner: "Vince", area: "data", severity: "high", title: "No real prices", evidence: f.kind === "synthetic" ? "the desk's feed is synthetic" : "no feed has printed", proposal: "Start the live gateway (gateway/databento_live_gateway.py) or confirm the Yahoo/Databento keys; nothing priced on this desk is real until a feed prints." });
    else if (f.kind === "yahoo" && (f.lagSec ?? 0) >= 300)
      out.push({ id: "feed_late", owner: "Vince", area: "data", severity: "med", title: "Prices run behind", evidence: `Yahoo futures are ${Math.round((f.lagSec ?? 0) / 60)} min late`, proposal: "The CE-touch alarm and every level exit read this tape. The Databento live gateway (sub-second) is what makes them honest." });
  }
  const g = a.goal;
  if (g) {
    for (const c of g.collisions) {
      if (!c.ask || c.severity === "info") continue;
      out.push({ id: `goal_${c.id}`, owner: "Sterling", area: "goal", severity: c.severity === "blocker" ? "high" : "med", title: c.title, evidence: c.detail.length > 160 ? `${c.detail.slice(0, 157)}…` : c.detail, proposal: c.decision ?? "A number the trader owns." });
    }
    if (g.status === "running" && g.pTarget < 0.001)
      out.push({ id: "goal_odds", owner: "Nova", area: "goal", severity: "med", title: "The goal is not on the table", evidence: `exact odds ${g.pTarget < 0.00001 ? "under 0.001%" : `${(g.pTarget * 100).toFixed(3)}%`} on the measured numbers; ${(g.pNoCard * 100).toFixed(0)}% that no card prints at all`, proposal: g.needed.pWin != null ? `It would take ${(g.needed.pWin * 100).toFixed(0)}% winners${g.needed.lambdaMultiple != null ? ` or ${g.needed.lambdaMultiple.toFixed(1)}× the cards` : ""}. Move the target, the window or the evidence — not the gates.` : "No win rate within reach gets there on this many cards. Move the target or the window — not the gates." });
  }
  const l = a.lab;
  if (l) {
    for (const r of l.refusals) {
      if (r.n >= 5 && r.pnlUsd > 0)
        out.push({ id: `gate_${r.gate}`, owner: "Sterling", area: "rules", severity: "low", title: `The ${r.gate} gate is costing money`, evidence: `${r.n} refused tickets would have made ${money(r.pnlUsd)} on the model`, proposal: "Small sample, live-forward. Re-test the gate on the four-year capture (z ≥ 2.87) before touching it." });
    }
    if (l.calibration && l.calibration.n >= 30 && l.calibration.meanP != null && l.calibration.hitRate != null && Math.abs(l.calibration.meanP - l.calibration.hitRate) > 0.1 + 1e-9)
      out.push({ id: "odds_gap", owner: "Nova", area: "model", severity: "med", title: "The card's odds are off", evidence: `said ${(l.calibration.meanP * 100).toFixed(0)}%, T1 printed ${(l.calibration.hitRate * 100).toFixed(0)}% over ${l.calibration.n} plans`, proposal: "Recalibrate hit-odds on the four-year capture (scripts/build-hit-odds.mjs), not live." });
  }
  const dead = Object.entries(EXEC_FLAGS).filter(([, v]) => !v).map(([k]) => k);
  if (dead.includes("SERVER_RUNNER_BUILT"))
    out.push({ id: "runner", owner: "Vince", area: "execution", severity: "med", title: "Nothing manages a position with the tab closed", evidence: "SERVER_RUNNER_BUILT is false: paper positions are managed by an open browser; only the 15:30 flatten has a server cron", proposal: "A scheduled server function that builds the desk and steps the room is what live trading needs; until then keep a tab open or stay on paper." });
  if (a.rnd) {
    const decided = a.rnd.experiments.filter((e) => e.status !== "collecting").length;
    if (decided === 0 && a.rnd.experiments.length)
      out.push({ id: "rnd_empty", owner: "Nova", area: "process", severity: "low", title: "No experiment has enough data yet", evidence: `${a.rnd.experiments.length} are collecting (${a.rnd.experiments.map((e) => `${e.n}/${e.nNeeded}`).join(", ")})`, proposal: "The fastest way to learn is more qualifying tickets — the desk only offers about one in five sessions, so the window is the limit." });
  }
  const s = a.seats;
  if (s && s.touches >= 3) {
    const idle = s.rows.filter((r) => r.taken.n === 0 && r.declined.n === 0 && r.id !== "room");
    if (idle.length >= 2)
      out.push({ id: "idle_seats", owner: "Jax", area: "process", severity: "low", title: "Seats that never trade", evidence: `${idle.map((r) => r.name).join(" and ")} took or declined nothing in ${s.touches} touches`, proposal: "Their size or style cannot buy a contract at this price. That is information about the policy, not a reason to loosen a gate." });
  }
  return out.sort((x, y) => ORDER[x.severity] - ORDER[y.severity]);
}
