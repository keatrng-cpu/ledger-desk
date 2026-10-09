/**
 * Robinhood long-options swing strategy — time-gated, HTF-driven.
 *
 * Only arms when the "time occurs": HTF absolute + structure + timing window.
 * Product: long debit calls/puts only (defined risk = premium). No short naked.
 * Proxies: SPY ← ES, QQQ ← NQ. Hold multi-session, not day-scalp.
 *
 * This module is deterministic structure. It never places RH orders.
 */

import type { DeskPayload } from "./build-desk";
import type { SessionClock } from "./sessions";
import type { NewsRead } from "./news";
import { loadRhSleeve, rhRiskBudgetUsd } from "./options-sleeve";
import { sessionLive } from "@/lib/trading/sessions";

export type OptionSide = "call" | "put";
export type SwingUnderlier = "SPY" | "QQQ";
export type SwingVerdict =
  | "ARMED_CALL"
  | "ARMED_PUT"
  | "WATCH"
  | "STAND_DOWN"
  | "EXIT_HOLD";

export interface SwingTiming {
  entryDayOk: boolean;
  entrySessionOk: boolean;
  newsOk: boolean;
  fridayCaution: boolean;
  label: string;
}

export interface SwingContractPlan {
  underlier: SwingUnderlier;
  side: OptionSide;
  dteMin: number;
  dteMax: number;
  dteTarget: number;
  deltaMin: number;
  deltaMax: number;
  riskPct: number;
  riskDollars: number;
  holdSessionsMin: number;
  holdSessionsMax: number;
  invalidation: string;
  targets: string[];
  robinhoodNote: string;
}

export interface SwingSignal {
  verdict: SwingVerdict;
  confidence: number;
  underlier: SwingUnderlier | null;
  side: OptionSide | null;
  proxySymbol: string | null;
  htf: string;
  dealing: string | null;
  reasons: string[];
  blocks: string[];
  timing: SwingTiming;
  plan: SwingContractPlan | null;
  checklist: { id: string; ok: boolean; label: string }[];
  focus: string;
  timeOccurs: boolean;
}

export const SWING_RISK_PCT = {
  A: 0.15,
  B: 0.1,
  probe: 0.075,
} as const;

/**
 * A swing is a contract that is still open at the next morning's open.
 * The hold is the number of sessions it is meant to survive. The expiration
 * is past that hold, never a 0DTE.
 */
export const SWING_SPANS: {
  id: "swing_overnight" | "swing_2" | "swing_3" | "swing_4" | "swing_5" | "swing_week";
  sessions: number;
  label: string;
  dteTarget: number;
  dteMin: number;
  dteMax: number;
}[] = [
  { id: "swing_overnight", sessions: 1, label: "Overnight", dteTarget: 2, dteMin: 1, dteMax: 3 },
  { id: "swing_2", sessions: 2, label: "2 sessions", dteTarget: 3, dteMin: 2, dteMax: 4 },
  { id: "swing_3", sessions: 3, label: "3 sessions", dteTarget: 4, dteMin: 3, dteMax: 6 },
  { id: "swing_4", sessions: 4, label: "4 sessions", dteTarget: 5, dteMin: 4, dteMax: 7 },
  { id: "swing_5", sessions: 5, label: "5 sessions", dteTarget: 6, dteMin: 5, dteMax: 8 },
  { id: "swing_week", sessions: 7, label: "Week", dteTarget: 10, dteMin: 7, dteMax: 14 },
];

function weekdayEt(clock: SessionClock): number {
  const w = clock.weekday;
  if (typeof w === "number") return w;
  return new Date().getDay();
}

export function swingTiming(
  clock: SessionClock,
  news: NewsRead,
): SwingTiming {
  const wd = weekdayEt(clock);
  const monThu = wd >= 1 && wd <= 4;
  const friday = wd === 5;
  const weekend = wd === 0 || wd === 6;

  const sessionOk =
    clock.isWeekday &&
    (clock.killzone === "ny_am" ||
      clock.killzone === "ny_pm" ||
      clock.killzone === "london" ||
      sessionLive(clock));

  const newsOk = news.verdict === "clear";
  const fridayCaution = friday;

  let label = "No entry window";
  if (weekend) label = "Weekend — manage only, no new swings";
  else if (!newsOk) label = `News ${news.verdict} — no new multi-day premium`;
  else if (friday) label = "Friday — an overnight into the next open can still be a swing. A longer hold waits.";
  else if (monThu && clock.killzone === "ny_am")
    label = "Prime: NY AM Mon–Thu — can arm swing after HTF clear";
  else if (monThu && sessionOk)
    label = "Secondary: session open — arm only if HTF absolute already set";
  else if (monThu) label = "Mon–Thu but outside session — plan levels only";

  return {
    entryDayOk: (monThu || friday) && !weekend,
    entrySessionOk: sessionOk && !weekend,
    newsOk,
    fridayCaution,
    label,
  };
}

/**
 * Build swing signal from live desk.
 * Calls only when HTF bull absolute on proxy; puts when HTF bear.
 */
export function evaluateOptionsSwing(desk: DeskPayload): SwingSignal {
  const timing = swingTiming(desk.clock, desk.news);
  const blocks: string[] = [];
  const reasons: string[] = [];

  const left = desk.bias.left;
  const right = desk.bias.right;

  const esBias =
    right.symbol === "ES" || right.symbol === "MES"
      ? right
      : left.symbol === "ES" || left.symbol === "MES"
        ? left
        : right;
  const nqBias =
    left.symbol === "NQ" || left.symbol === "MNQ"
      ? left
      : right.symbol === "NQ" || right.symbol === "MNQ"
        ? right
        : left;

  type Pick = {
    underlier: SwingUnderlier;
    proxy: typeof left;
    side: OptionSide;
    score: number;
  };
  const picks: Pick[] = [];

  for (const [underlier, proxy] of [
    ["SPY", esBias] as const,
    ["QQQ", nqBias] as const,
  ]) {
    if (proxy.topDown === "bull") {
      let score = proxy.confidence ?? 0.5;
      if (proxy.mid === "bull") score += 0.08;
      if (proxy.daily === "bull") score += 0.06;
      if (proxy.dealing?.zone === "discount") score += 0.1;
      if (proxy.dealing?.zone === "premium") score -= 0.08;
      picks.push({ underlier, proxy, side: "call", score });
    } else if (proxy.topDown === "bear") {
      let score = proxy.confidence ?? 0.5;
      if (proxy.mid === "bear") score += 0.08;
      if (proxy.daily === "bear") score += 0.06;
      if (proxy.dealing?.zone === "premium") score += 0.1;
      if (proxy.dealing?.zone === "discount") score -= 0.08;
      picks.push({ underlier, proxy, side: "put", score });
    }
  }

  picks.sort((a, b) => b.score - a.score);
  const best = picks[0] ?? null;

  const scanBest =
    desk.scan.candidates.find((c) => c.actionable) ??
    desk.scan.candidates.find((c) => c.htfOk && (c.confluence ?? 0) >= 0.55) ??
    null;

  if (!timing.entryDayOk) blocks.push("Weekend — manage only");
  if (!timing.newsOk)
    blocks.push(`News ${desk.news.verdict}: ${desk.news.reason}`);
  if (!timing.entrySessionOk) blocks.push("Outside swing arm session");
  if (desk.weekAhead?.today?.kind === "nfp" || desk.weekAhead?.today?.kind === "holiday") {
    blocks.push("Week card forbids new multi-day premium today");
  }

  if (!best) {
    blocks.push("No absolute HTF bull/bear on ES or NQ proxy");
  } else {
    reasons.push(
      `${best.underlier} via ${best.proxy.symbol} HTF ${best.proxy.topDown} (conf ${((best.proxy.confidence ?? 0) * 100).toFixed(0)}%)`,
    );
    reasons.push(
      `Side ${best.side.toUpperCase()} · dealing ${best.proxy.dealing?.zone ?? "n/a"} · mid ${best.proxy.mid} · daily ${best.proxy.daily}`,
    );
    if (best.score < 0.55) {
      blocks.push(`Swing score weak ${best.score.toFixed(2)} < 0.55`);
    }
    if (best.side === "call" && best.proxy.dealing?.zone === "premium") {
      blocks.push("Call into premium — wait discount or acceptance");
    }
    if (best.side === "put" && best.proxy.dealing?.zone === "discount") {
      blocks.push("Put into discount — wait premium or displacement");
    }
  }

  if (best && scanBest) {
    const scanCall = scanBest.side === "long";
    const wantCall = best.side === "call";
    if (scanCall === wantCall && scanBest.htfOk) {
      reasons.push(
        `Futures scanner agrees ${scanBest.symbol} ${scanBest.side} @ ${scanBest.confluence.toFixed(2)}`,
      );
    } else if (scanBest.actionable && scanCall !== wantCall) {
      blocks.push(
        `Scanner fights swing (${scanBest.symbol} ${scanBest.side}) — stand down`,
      );
    }
  }

  const hardOk =
    Boolean(best) &&
    timing.entryDayOk &&
    timing.entrySessionOk &&
    timing.newsOk &&
    blocks.length === 0 &&
    (best?.score ?? 0) >= 0.55;

  const watchOk =
    Boolean(best) &&
    timing.newsOk &&
    (best?.score ?? 0) >= 0.5 &&
    blocks.filter((b) => !b.includes("session") && !b.includes("Friday"))
      .length <= 1;

  let verdict: SwingVerdict = "STAND_DOWN";
  if (hardOk && best) {
    verdict = best.side === "call" ? "ARMED_CALL" : "ARMED_PUT";
  } else if (watchOk && best) {
    verdict = "WATCH";
  }

  const timeOccurs = verdict === "ARMED_CALL" || verdict === "ARMED_PUT";

  let plan: SwingContractPlan | null = null;
  if (best && (timeOccurs || verdict === "WATCH")) {
    const riskPct = timeOccurs ? SWING_RISK_PCT.A : SWING_RISK_PCT.probe;
    const sleeve = loadRhSleeve();
    plan = {
      underlier: best.underlier,
      side: best.side,
      dteMin: 1,
      dteMax: 14,
      dteTarget: 3,
      deltaMin: 0.35,
      deltaMax: 0.5,
      riskPct,
      // Graded loss budget. `riskPct` was computed on the line above and then
      // never used, so a 0.075 probe risked the same dollars as a 0.15 A.
      riskDollars: rhRiskBudgetUsd(sleeve, riskPct),
      holdSessionsMin: 2,
      holdSessionsMax: 10,
      invalidation:
        best.side === "call"
          ? `HTF flips bear on ${best.proxy.symbol} OR daily close below protected swing low / PD array`
          : `HTF flips bull on ${best.proxy.symbol} OR daily close above protected swing high / PD array`,
      targets: [
        "Trim 50% premium at +50–80% gain",
        "Runner toward HTF EQ / opposing PD array",
        "Time stop: thesis not working by session 5–7 → reduce",
      ],
      robinhoodNote:
        "Robinhood: BUY TO OPEN long call/put or a debit spread. At most $1,000 of debit; the loss is capped at 15% of the debit paid, sized from the futures invalidation. No naked short. Do not average losers.",
    };
  }

  const checklist = [
    {
      id: "htf",
      ok: Boolean(best && best.proxy.topDown !== "neutral"),
      label: "HTF absolute (bull→call / bear→put)",
    },
    {
      id: "day",
      ok: timing.entryDayOk,
      label: "Mon–Fri. A swing is anything still open at the next morning's open",
    },
    {
      id: "session",
      ok: timing.entrySessionOk,
      label: "Session arm window (NY AM best)",
    },
    {
      id: "news",
      ok: timing.newsOk,
      label: "News clear for multi-day hold",
    },
    {
      id: "location",
      ok: Boolean(
        best &&
          !(
            (best.side === "call" && best.proxy.dealing?.zone === "premium") ||
            (best.side === "put" && best.proxy.dealing?.zone === "discount")
          ),
      ),
      label: "Dealing location not fighting side",
    },
    {
      id: "score",
      ok: (best?.score ?? 0) >= 0.55,
      label: "Swing score ≥ 0.55",
    },
    {
      id: "risk",
      ok: true,
      label: `RH sleeve: ≤ $1,000 debit · loss capped ${(SWING_RISK_PCT.A * 100).toFixed(0)}% of the debit paid`,
    },
  ];

  const focus =
    timeOccurs && plan
      ? `TIME OCCURS → RH BUY ${plan.side.toUpperCase()} ${plan.underlier} · DTE ~${plan.dteTarget} (Δ ${plan.deltaMin}–${plan.deltaMax}) · risk $${plan.riskDollars} · hold ${plan.holdSessionsMin}–${plan.holdSessionsMax} sessions`
      : verdict === "WATCH" && plan
        ? `WATCH ${plan.underlier} ${plan.side} — timing not clean: ${timing.label}`
        : `STAND DOWN options swing — ${blocks[0] || timing.label}`;

  return {
    verdict,
    confidence: best?.score ?? 0,
    underlier: best?.underlier ?? null,
    side: best?.side ?? null,
    proxySymbol: best?.proxy.symbol ?? null,
    htf: best ? `${best.proxy.symbol} ${best.proxy.topDown}` : "neutral",
    dealing: best?.proxy.dealing?.zone ?? null,
    reasons,
    blocks,
    timing,
    plan,
    checklist,
    focus,
    timeOccurs,
  };
}

export function optionsSwingPlaybook(): string[] {
  return [
    "RH sleeve: ≤ $1,000 debit per ticket, loss capped 15% of the debit, sized from the futures invalidation. Not the $100k futures book.",
    "SPY follows ES HTF · QQQ follows NQ HTF — absolute gate. One underlier.",
    "A swing is still open at the next morning's open. The cards are overnight, 2, 3, 4, 5 sessions, and a week. Expiration sits past that hold.",
    "Arm on a weekday when news is clear. Friday can take the overnight only. Three sessions or more waits in a labor week.",
    "Delta 0.40–0.55. The draw's R picks which hold card leads. Trim half when the pool pays 40% of the debit.",
    "Separate from futures PATH — one thesis preferred.",
  ];
}

export function swingVerdictTone(
  v: SwingVerdict,
): "up" | "down" | "warn" | "muted" {
  if (v === "ARMED_CALL") return "up";
  if (v === "ARMED_PUT") return "down";
  if (v === "WATCH") return "warn";
  return "muted";
}
