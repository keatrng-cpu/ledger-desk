/**
 * Map TradeZella analysis setup → SetupCandidate for journal logging.
 */

import type { SetupCandidate } from "./scanner";
import type { ComponentKey } from "./engine-weights";
import type { StrategyId } from "./strategies";
import type { TradezellaAnalysis, SetupPlan } from "./tradezella-analyze";

export function analysisToSetupCandidate(
  analysis: TradezellaAnalysis,
  setup?: SetupPlan | null,
): SetupCandidate | null {
  const s = setup ?? analysis.setups[0];
  if (!s || s.side === "flat") return null;

  const symbol =
    analysis.stats.symbol &&
    ["MNQ", "MES", "NQ", "ES"].includes(analysis.stats.symbol)
      ? analysis.stats.symbol
      : "MNQ";

  const grade =
    s.grade === "A+" ? "A+" : s.grade === "A" ? "A-" : s.grade === "B" ? "B" : "skip";

  const strategies = analysis.strategiesHit
    .map((x) => x.id)
    .filter(Boolean) as StrategyId[];

  return {
    id: `tz-${s.id}-${Date.now()}`,
    symbol,
    side: s.side,
    confluence: s.confluenceScore,
    grade,
    title: `TZ · ${s.strategy} · ${analysis.title}`.slice(0, 160),
    reasons: [
      ...s.confluencesPresent.map((c) => String(c)),
      ...analysis.strategiesHit.map((x) => `strategy:${x.id}`),
      analysis.systemAlignment.wrVsTarget,
    ],
    missing: s.confluencesMissing.map(String),
    components: s.confluencesPresent.filter(Boolean) as ComponentKey[],
    strategies,
    strategyPrimary: String(s.strategy),
    strategyWhy: analysis.strategiesHit.map((x) => x.why),
    entryZone: String(s.entry),
    invalidation: String(s.stop || s.invalidation),
    targets: s.targets.map(String),
    killzoneOk: true,
    htfOk: analysis.timeframes[0]?.bias !== "neutral",
    conditionsOk: analysis.conditions.tradeable,
    actionable: grade === "A+" || grade === "A-",
    regime: analysis.conditions.regime,
    volatility: analysis.conditions.volatility,
  };
}
