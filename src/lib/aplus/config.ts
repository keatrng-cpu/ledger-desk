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

export type RiskGrade = "A+" | "A" | "A-" | "B" | "C" | "skip";

/** Active calibration (RULES_CALIBRATION.md / desk paper book). */
export const APLUS_RULES = {
  /** Production A+ tag threshold (journal label). */
  aPlusThreshold: 0.75,
  /** Path / execute floor — calibrated 0.67. */
  confluenceFloor: 0.67,
  confluenceFloorCalibration: 0.67,
  /**
   * Grade-based risk on paper / backtest book ($100k).
   * A+ 3% · A 2% · A- 1% · B paper · C 0.5% journal · skip 0.
   */
  riskByGrade: {
    "A+": 0.03,
    A: 0.02,
    "A-": 0.01,
    B: 0.0, // paper only — not live risk
    C: 0.005, // journal micro only
    skip: 0,
  } as Record<RiskGrade, number>,
  /** Default display risk (mid band / A-path). */
  riskPct: 0.02,
  /** Hard cap — never size above A+ band. */
  riskPctCeiling: 0.03,
  minRr: 1.0,
  tpMaxR: 3.0,
  dailyLossLimitPct: 0.02,
  weeklyLossLimitPct: 0.05,
  maxSetupsPerSession: 2,
  /**
   * Take risk off (scale-out) — mandatory on paper/backtest book.
   * At +1R: bank `tp1Fraction` of size, move stop to break-even.
   * Runner: remainder to +2R (or structure TP2). Open risk after TP1 ≈ 0.
   */
  scaleOut: {
    enabled: true,
    /** Share of contracts closed at TP1 (1R). */
    tp1Fraction: 0.5,
    /** After TP1, stop moves to entry (risk-free runner). */
    moveStopToBeAfterTp1: true,
    /** Optional BE buffer in R (0 = exact entry). */
    beBufferR: 0,
  },
  useMicros: true,
  symbols: ["NQ", "ES"] as const,
  session: "ny" as const,
  /** Paper + backtest account. */
  accountEquity: 100_000,
  paperEquity: 100_000,
  targetTradesPerYear: { min: 90, max: 120, center: 108 },
  targetTradesPerMonth: { min: 8, max: 12, center: 9 },
  htfTopDownGate: "absolute" as const,
  model: "SMC/ICT + TJR sweep→BOS/MSS→retrace + PB risk",
  profitPath: {
    targetWinRate: 0.7,
    targetExpectancyR: 0.35,
    minSampleTrades: 100,
    actionFloor: 0.67,
    onlyExecuteGrades: ["A+", "A"] as const,
  },
  dualPeer: { NQ: "ES", ES: "NQ", MNQ: "MES", MES: "MNQ" } as Record<
    string,
    string
  >,
} as const;

/** Map confluence score → risk grade label for sizing. */
export function riskGradeFromScore(score: number): RiskGrade {
  if (score >= APLUS_RULES.aPlusThreshold) return "A+";
  if (score >= APLUS_RULES.confluenceFloor + 0.03) return "A";
  if (score >= APLUS_RULES.confluenceFloor) return "A-";
  if (score >= APLUS_RULES.confluenceFloor - 0.1) return "B";
  if (score > 0) return "C";
  return "skip";
}

/** Risk % of equity for a grade (clamped 0–ceiling). */
export function riskPctForGrade(grade: RiskGrade | string): number {
  const g = (grade in APLUS_RULES.riskByGrade ? grade : "skip") as RiskGrade;
  const pct = APLUS_RULES.riskByGrade[g] ?? 0;
  return Math.min(Math.max(pct, 0), APLUS_RULES.riskPctCeiling);
}

export function riskPctForScore(score: number): number {
  return riskPctForGrade(riskGradeFromScore(score));
}

export function riskDollars(
  equity = APLUS_RULES.accountEquity,
  gradeOrScore?: RiskGrade | number,
): number {
  let pct: number = APLUS_RULES.riskPct;
  if (typeof gradeOrScore === "number") pct = riskPctForScore(gradeOrScore);
  else if (typeof gradeOrScore === "string") pct = riskPctForGrade(gradeOrScore);
  return equity * pct;
}

/** Contracts so stop risk ≈ riskDollars (micros preferred). Min 1 if risk > 0. */
export function sizeContracts(opts: {
  symbol: string;
  riskPts: number;
  equity?: number;
  gradeOrScore?: RiskGrade | number;
}): { contracts: number; riskPct: number; riskDollars: number; pv: number } {
  const equity = opts.equity ?? APLUS_RULES.paperEquity;
  const pct =
    typeof opts.gradeOrScore === "number"
      ? riskPctForScore(opts.gradeOrScore)
      : typeof opts.gradeOrScore === "string"
        ? riskPctForGrade(opts.gradeOrScore)
        : APLUS_RULES.riskPct;
  const dollars = equity * pct;
  const key = (
    opts.symbol in CONTRACTS ? opts.symbol : "MNQ"
  ) as ContractKey;
  // Prefer micro when useMicros
  const microKey = APLUS_RULES.useMicros
    ? ((CONTRACTS[key].micro in CONTRACTS
        ? CONTRACTS[key].micro
        : key) as ContractKey)
    : key;
  const pv = CONTRACTS[microKey]?.pointValue ?? CONTRACTS.MNQ.pointValue;
  const riskPts = Math.max(opts.riskPts, 0.25);
  const perContractRisk = riskPts * pv;
  let contracts =
    perContractRisk > 0 ? Math.floor(dollars / perContractRisk) : 0;
  if (pct > 0 && contracts < 1) contracts = 1;
  // Cap extreme size (safety)
  contracts = Math.min(contracts, 200);
  return {
    contracts,
    riskPct: pct,
    riskDollars: dollars,
    pv,
  };
}
