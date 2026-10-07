/**
 * One entry. The first list was what the tape already moved.
 * The second list is Patty and Blake: the box, the body through the gap,
 * the draw in front of nothing. Fit is not a vote.
 *
 * A perfect entry is allowed to be graded toward 68% on the one-to-one.
 * That number is not measured yet. Do not speak it as a result.
 */

export interface PerfectInput {
  side: "long" | "short";
  fit?: number | null;
  entry?: number | null;
  stop?: number | null;
  t1?: number | null;
  /** Minutes from midnight ET. */
  minuteEt?: number | null;
  htf?: "bull" | "bear" | "none" | null;
  drift?: "up" | "down" | "flat" | null;
  mitigation?: boolean | null;
  smtAgrees?: boolean | null;
  /** Body closed back through the gap. A wick is not the entry. */
  bodyClose?: boolean | null;
  /** Target has no untaken equal high or equal low in front of it. */
  drawClear?: boolean | null;
  firstThisSession?: boolean | null;
  armed?: boolean | null;
}

export interface PerfectGrade {
  perfect: boolean;
  missing: string[];
  say: string;
}

const WINDOW = "9:30 to 11:00, and not into the next hour";

export function gradePerfect(input: PerfectInput): PerfectGrade {
  const missing: string[] = [];
  const sideUp = input.side === "long";

  if (input.minuteEt == null) missing.push(WINDOW);
  else if (input.minuteEt < 9 * 60 + 30 || input.minuteEt >= 11 * 60) missing.push(WINDOW);
  else if (input.minuteEt >= 10 * 60 + 50) missing.push("too close to the 11:00 open");

  if (input.htf == null || input.htf === "none") missing.push("four-hour and one-hour agree");
  else if ((input.htf === "bull") !== sideUp) missing.push("side is with the higher timeframe");

  if (input.drift == null) missing.push("four-week drift");
  else if ((input.drift === "up") !== sideUp && input.drift !== "flat") missing.push("not fading the four-week tape");

  if (input.mitigation == null) missing.push("no second push");
  else if (input.mitigation) missing.push("mitigation block is the fade");

  if (input.smtAgrees == null) missing.push("other index failed the same side");
  else if (!input.smtAgrees) missing.push("SMT disagrees");

  if (input.bodyClose == null) missing.push("body closed through the gap");
  else if (!input.bodyClose) missing.push("wick is not the inversion");

  if (input.drawClear == null) missing.push("draw is unprotected");
  else if (!input.drawClear) missing.push("equal highs or lows still sit in front");

  if (input.firstThisSession == null) missing.push("first card this session");
  else if (!input.firstThisSession) missing.push("session already spent");

  const risk =
    input.entry != null && input.stop != null ? Math.abs(input.entry - input.stop) : null;
  const reward =
    input.entry != null && input.t1 != null ? Math.abs(input.t1 - input.entry) : null;
  if (risk == null || reward == null || risk <= 0) missing.push("one-to-one is priced");
  else if (reward / risk < 0.9) missing.push("target is inside one R");

  if (input.armed === false) missing.push("card is armed, not a watch");

  const perfect = missing.length === 0;
  const say = perfect
    ? "Perfect entry. Box swept, body back through the gap, draw is clear, higher timeframe and the tape agree. One-to-one is the test. Fit does not get a vote."
    : `Not perfect. Still need ${missing.slice(0, 3).join(", ")}. A high score does not finish the list.`;
  return { perfect, missing, say };
}

export const PERFECT_STANDARD =
  "Direction first, on every trade. The one-hour and the four-hour gaps have to agree: a respected bullish gap or a disrespected bearish gap is long, and the reverse is short. The draw is the resting liquidity or the open gap in that direction, marked before the entry. Then the sweep, external or internal. Then a gap. The entry is the inverse of the gap in the sweep, or a gap that forms with the bias and holds. Two trades between 9:30 and 11:30 ET. The target is that draw, not the fit. The Sep 2022–Sep 2026 book of this sequence reached the draw 19 of 29 times and made about zero R. The second half was 5 of 11. That is not 68%.";
