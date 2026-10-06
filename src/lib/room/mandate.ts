/**
 * The trader's mandate for the trading floor (2026-10-04) and the clock rules
 * the floor inherits from the options desk. The room's own numbers — not
 * src/lib/aplus/config.ts, which no part of the floor writes to.
 */

/** Hard premium stop, percent. The primary exit is still the futures LEVEL. */
export const ROOM_STOP_PCT = -20;

export const ROOM_MANDATE = {
  maxOpenPositions: 3,
  maxCashFracPerTrade: 0.56,
  hardStopPct: ROOM_STOP_PCT,
  takeProfitPct: 40,
  /** Share of the position closed at +40%. 0.5 = the options playbook's trim; 1 = close all. */
  takeProfitCloseFrac: 0.5,
  dteAllowed: [0, 1] as readonly number[],
} as const;

/** Clock rules the room inherits from the options desk. Minutes after ET midnight. */
export const ROOM_CLOCK = {
  /** RH lists equity options 09:30–16:00 ET. Nothing routes outside it. */
  optionsOpenMin: 9 * 60 + 30,
  optionsCloseMin: 16 * 60,
  /** "Flat 11:00 ET" — both day cards. */
  dayFlatMin: 11 * 60,
  /** 1 DTE may run past 11:00 only at ≥ this % with HTF still aligned (path_continuation). */
  pastElevenMinPct: 50,
  /** Broker force-sells expiring contracts from 15:30 ET; QQQ/SPY are unmanageable 16:15→09:30. */
  flattenAllMin: 15 * 60 + 30,
  /** CLAUDE.md live loop: "After 10:00 ET, A+ only unless already in a trade." */
  aPlusOnlyAfterMin: 10 * 60,
} as const;

/** Common VIX conventions (not measured on this desk): ≥20 elevated, ≥30 stressed. */
export const VIX_ELEVATED = 20;
export const VIX_STRESSED = 30;
