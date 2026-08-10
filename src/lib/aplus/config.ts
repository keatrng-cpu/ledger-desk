/**
 * Port of keatrng-cpu/Trading-Automation `aplus/config.py` + RULES_CALIBRATION.md
 * Non-negotiable numbers for the desk UI. AI never changes these.
 */

export const CONTRACTS = {
  ES: { symbol: "ES", pointValue: 50, tick: 0.25, commission: 4, micro: "MES" },
  NQ: { symbol: "NQ", pointValue: 20, tick: 0.25, commission: 4, micro: "MNQ" },
  MES: { symbol: "MES", pointValue: 5, tick: 0.25, commission: 1, micro: "MES" },
  MNQ: { symbol: "MNQ", pointValue: 2, tick: 0.25, commission: 1, micro: "MNQ" },
} as const;

export type ContractKey = keyof typeof CONTRACTS;

/** Active calibration (RULES_CALIBRATION.md / config.py TEST overlay). */
export const APLUS_RULES = {
  /** Production A+ tag threshold (journal label). */
  aPlusThreshold: 0.75,
  /** Active confluence floor — TEST 0.50 in config.py; calibration doc says 0.67. */
  confluenceFloor: 0.5,
  confluenceFloorCalibration: 0.67,
  riskPct: 0.005,
  riskPctCeiling: 0.01,
  minRr: 1.0,
  tpMaxR: 3.0,
  dailyLossLimitPct: 0.02,
  weeklyLossLimitPct: 0.05,
  maxSetupsPerSession: 2,
  useMicros: true,
  symbols: ["NQ", "ES"] as const,
  session: "ny" as const,
  accountEquity: 10_000,
  targetTradesPerYear: { min: 105, max: 135, center: 120 },
  targetTradesPerMonth: { min: 10, max: 15 },
  htfTopDownGate: "absolute" as const,
  model: "SMC/ICT + TJR sweep→BOS/MSS→retrace + PB risk",
  dualPeer: { NQ: "ES", ES: "NQ", MNQ: "MES", MES: "MNQ" } as Record<
    string,
    string
  >,
} as const;

export function riskDollars(equity = APLUS_RULES.accountEquity): number {
  return equity * APLUS_RULES.riskPct;
}
