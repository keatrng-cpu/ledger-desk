/**
 * Setup scanner — deterministic desk pre-score candidates.
 * Mirrors Trading-Automation scanner intent without the full Python engine.
 * The `confluence` field is kept for type stability, but it is a desk
 * PRE-SCORE — NOT engine confluence (engine floor 0.75 never cleared in
 * calibration). All user-visible copy must say "pre-score".
 */

import { APLUS_RULES } from "@/lib/aplus/config";
import type { SessionClock } from "./sessions";
import type { HtfBiasRead } from "./structure";
import { smtRead } from "./structure";
import {
  drawTargetsForSide,
  type DrawRead,
  type LiquidityTarget,
} from "./draw";

export type SetupSide = "long" | "short";

export interface SetupCandidate {
  id: string;
  symbol: string;
  side: SetupSide;
  confluence: number;
  grade: "A+" | "A-" | "B" | "skip";
  title: string;
  reasons: string[];
  missing: string[];
  entryZone: string;
  invalidation: string;
  targets: string[];
  /**
   * The specific liquidity level this setup is drawn toward, with its
   * empirical reach rate from past sessions. Null when no draw read was
   * supplied or nothing viable sits in the trade's direction.
   */
  draw: LiquidityTarget | null;
  killzoneOk: boolean;
  htfOk: boolean;
  actionable: boolean;
}

export interface ScanResult {
  floor: number;
  aPlus: number;
  candidates: SetupCandidate[];
  blocked: string[];
  focus: string;
  smt: ReturnType<typeof smtRead>;
}

/**
 * Resolve the draw for one symbol/side into display labels + the primary
 * target. Labels carry the empirical base rate so the card shows WHY that
 * level is the target, not just that it exists.
 */
function drawFor(
  draws: Record<string, DrawRead | undefined> | undefined,
  symbol: string,
  side: SetupSide,
): { labels: string[]; primary: LiquidityTarget | null } {
  const draw = draws?.[symbol];
  if (!draw) return { labels: [], primary: null };
  const list = drawTargetsForSide(draw, side);
  if (!list.length) return { labels: [], primary: null };
  return {
    labels: list
      .slice(0, 3)
      .map(
        (t) =>
          `${t.name} ${t.price.toFixed(2)} · ${(t.reachProbability * 100).toFixed(0)}%`,
      ),
    // Highest-scoring reachable level, not merely the nearest one.
    primary: [...list].sort((a, b) => b.score - a.score)[0] ?? null,
  };
}

function grade(score: number, floor: number): SetupCandidate["grade"] {
  if (score >= APLUS_RULES.aPlusThreshold) return "A+";
  if (score >= floor) return "A-";
  if (score >= floor - 0.12) return "B";
  return "skip";
}

export function scanSetups(
  left: HtfBiasRead,
  right: HtfBiasRead,
  clock: SessionClock,
  /**
   * Optional swing-based SMT divergence (structure.smtDivergence). When given it
   * becomes the primary SMT signal and the %-change spread is demoted to color;
   * omitted, smtRead keeps its original two-arg behavior.
   */
  divergence?: Parameters<typeof smtRead>[2],
  /**
   * Optional per-symbol draw-on-liquidity reads (trading/draw.ts). When given,
   * targets become the SPECIFIC levels price is empirically likely to reach
   * (with base rates from past sessions) instead of generic level names, and
   * a candidate whose direction has no viable draw is penalized — a setup
   * pointing at nothing is not a setup.
   */
  draws?: Record<string, DrawRead | undefined>,
): ScanResult {
  const floor = APLUS_RULES.confluenceFloor;
  const smt = smtRead(left, right, divergence);
  const blocked: string[] = [];
  if (!clock.isWeekday) blocked.push("Weekend — plan only, no session entries");
  if (!clock.inTradeWindow)
    blocked.push(`Outside trade window (${clock.killzoneLabel})`);

  const candidates: SetupCandidate[] = [];

  const build = (read: HtfBiasRead) => {
    // Long idea
    {
      const reasons: string[] = [];
      const missing: string[] = [];
      let score = 0.22;

      const htfOk = read.topDown === "bull";
      if (htfOk) {
        score += 0.18;
        reasons.push("HTF top-down bull (absolute gate pass)");
      } else {
        missing.push("HTF top-down bull");
      }

      if (read.mid === "bull") {
        score += 0.08;
        reasons.push("Mid-structure higher highs/lows");
      } else missing.push("mid bull structure");

      if (read.dealing?.zone === "discount") {
        score += 0.1;
        reasons.push("Price in discount of dealing range");
      } else if (read.dealing?.zone === "premium") {
        missing.push("discount array (currently premium)");
      } else {
        score += 0.03;
        reasons.push("Near equilibrium — need precise entry");
      }

      const sellLiq = read.liquidity.filter(
        (l) => l.side === "sellside" && l.swept,
      );
      if (sellLiq.length) {
        score += 0.12;
        reasons.push(`Sellside liquidity swept (${sellLiq[0]!.label})`);
      } else missing.push("sellside sweep");

      if (read.lastBOS?.direction === "bull") {
        score += 0.1;
        reasons.push(`Bull BOS @ ${read.lastBOS.level.toFixed(2)}`);
      } else missing.push("bull BOS/MSS");

      if (smt.edge === "left" && read.symbol === left.symbol && smt.state.includes("bull")) {
        score += 0.08;
        reasons.push("SMT / relative strength support");
      } else if (smt.state === "locked") {
        score += 0.02;
      } else missing.push("bullish SMT");

      const killzoneOk = clock.inTradeWindow;
      if (killzoneOk) {
        score += 0.08;
        reasons.push(`Killzone: ${clock.killzoneLabel}`);
      } else missing.push("active killzone");

      if (read.pdh && read.last < read.pdh) {
        score += 0.04;
        reasons.push("Below PDH — room toward prior high");
      }

      // Draw on liquidity: is there a level above that price is empirically
      // likely to reach from here? A long into nothing is not a trade.
      const drawL = drawFor(draws, read.symbol, "long");
      if (drawL.primary) {
        if (drawL.primary.reachProbability >= 0.5) {
          score += 0.08;
          reasons.push(
            `Draw: ${drawL.primary.name} ${drawL.primary.price.toFixed(2)} (${(drawL.primary.reachProbability * 100).toFixed(0)}% base rate, ${drawL.primary.distanceAtr.toFixed(2)} ATR)`,
          );
        } else {
          missing.push(
            `strong draw above (best ${drawL.primary.name} only ${(drawL.primary.reachProbability * 100).toFixed(0)}%)`,
          );
        }
      } else if (draws) {
        missing.push("no liquidity draw above — nothing to target");
      }

      score = Math.min(0.98, score);
      const g = grade(score, floor);
      const actionable =
        g !== "skip" && g !== "B" && htfOk && killzoneOk && clock.isWeekday;

      candidates.push({
        id: `${read.symbol}-long`,
        symbol: read.symbol,
        side: "long",
        confluence: +score.toFixed(3),
        grade: g,
        title: `${read.symbol} long — discount / sweep model`,
        reasons,
        missing,
        entryZone: read.dealing
          ? `${read.dealing.low.toFixed(2)} – ${read.dealing.eq.toFixed(2)}`
          : "await array",
        invalidation: read.pdl
          ? `Below PDL ${read.pdl.toFixed(2)} / last sellside`
          : "Below last protected low",
        targets: drawL.labels.length
          ? drawL.labels
          : [
              read.dealing ? `EQ ${read.dealing.eq.toFixed(2)}` : "Mid range",
              read.pdh ? `PDH ${read.pdh.toFixed(2)}` : "Prior day high",
              "External buyside pool",
            ],
        draw: drawL.primary,
        killzoneOk,
        htfOk,
        actionable,
      });
    }

    // Short idea
    {
      const reasons: string[] = [];
      const missing: string[] = [];
      let score = 0.22;

      const htfOk = read.topDown === "bear";
      if (htfOk) {
        score += 0.18;
        reasons.push("HTF top-down bear (absolute gate pass)");
      } else missing.push("HTF top-down bear");

      if (read.mid === "bear") {
        score += 0.08;
        reasons.push("Mid-structure lower highs/lows");
      } else missing.push("mid bear structure");

      if (read.dealing?.zone === "premium") {
        score += 0.1;
        reasons.push("Price in premium of dealing range");
      } else if (read.dealing?.zone === "discount") {
        missing.push("premium array (currently discount)");
      }

      const buyLiq = read.liquidity.filter(
        (l) => l.side === "buyside" && l.swept,
      );
      if (buyLiq.length) {
        score += 0.12;
        reasons.push(`Buyside liquidity swept (${buyLiq[0]!.label})`);
      } else missing.push("buyside sweep");

      if (read.lastBOS?.direction === "bear") {
        score += 0.1;
        reasons.push(`Bear BOS @ ${read.lastBOS.level.toFixed(2)}`);
      } else missing.push("bear BOS/MSS");

      if (smt.edge === "left" && smt.state.includes("bear")) {
        score += 0.08;
        reasons.push("SMT weakness support");
      } else if (smt.state === "locked") {
        score += 0.02;
      } else missing.push("bearish SMT");

      const killzoneOk = clock.inTradeWindow;
      if (killzoneOk) {
        score += 0.08;
        reasons.push(`Killzone: ${clock.killzoneLabel}`);
      } else missing.push("active killzone");

      // Draw on liquidity below — same logic as the long path, mirrored.
      const drawS = drawFor(draws, read.symbol, "short");
      if (drawS.primary) {
        if (drawS.primary.reachProbability >= 0.5) {
          score += 0.08;
          reasons.push(
            `Draw: ${drawS.primary.name} ${drawS.primary.price.toFixed(2)} (${(drawS.primary.reachProbability * 100).toFixed(0)}% base rate, ${drawS.primary.distanceAtr.toFixed(2)} ATR)`,
          );
        } else {
          missing.push(
            `strong draw below (best ${drawS.primary.name} only ${(drawS.primary.reachProbability * 100).toFixed(0)}%)`,
          );
        }
      } else if (draws) {
        missing.push("no liquidity draw below — nothing to target");
      }

      score = Math.min(0.98, score);
      const g = grade(score, floor);
      const actionable =
        g !== "skip" && g !== "B" && htfOk && killzoneOk && clock.isWeekday;

      candidates.push({
        id: `${read.symbol}-short`,
        symbol: read.symbol,
        side: "short",
        confluence: +score.toFixed(3),
        grade: g,
        title: `${read.symbol} short — premium / sweep model`,
        reasons,
        missing,
        entryZone: read.dealing
          ? `${read.dealing.eq.toFixed(2)} – ${read.dealing.high.toFixed(2)}`
          : "await array",
        invalidation: read.pdh
          ? `Above PDH ${read.pdh.toFixed(2)} / last buyside`
          : "Above last protected high",
        targets: drawS.labels.length
          ? drawS.labels
          : [
              read.dealing ? `EQ ${read.dealing.eq.toFixed(2)}` : "Mid range",
              read.pdl ? `PDL ${read.pdl.toFixed(2)}` : "Prior day low",
              "External sellside pool",
            ],
        draw: drawS.primary,
        killzoneOk,
        htfOk,
        actionable,
      });
    }
  };

  build(left);
  build(right);

  candidates.sort((a, b) => b.confluence - a.confluence);

  const best = candidates[0];
  let focus = "Stand down — no A-grade idea clears gates.";
  if (best && best.actionable) {
    focus = `Focus: ${best.symbol} ${best.side.toUpperCase()} (${best.grade}, pre-score ${best.confluence}). ${best.reasons[0] ?? ""}`;
  } else if (best && best.grade !== "skip") {
    focus = `Nearest: ${best.symbol} ${best.side} @ pre-score ${best.confluence} (${best.grade}) — missing: ${best.missing.slice(0, 2).join(", ") || "alignment"}.`;
  } else if (blocked.length) {
    focus = blocked[0]!;
  }

  return {
    floor,
    aPlus: APLUS_RULES.aPlusThreshold,
    candidates: candidates.slice(0, 6),
    blocked,
    focus,
    smt,
  };
}
