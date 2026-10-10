/** Cash options are shut, weekends included. */
export function marketClosed(s: { optionsOpen: boolean }): boolean {
  return !s.optionsOpen;
}

/**
 * A game window, by the clock only. Weekend afternoon through late evening,
 * and a weeknight after the cash close. No line is invented from this.
 */
export function gamesOn(s: { weekday: number; etMin: number }): boolean {
  const m = s.etMin;
  if ((s.weekday === 0 || s.weekday === 6) && m >= 12 * 60 && m < 23 * 60 + 30) return true;
  if (s.weekday >= 1 && s.weekday <= 5 && m >= 19 * 60 && m < 23 * 60 + 30) return true;
  return false;
}
