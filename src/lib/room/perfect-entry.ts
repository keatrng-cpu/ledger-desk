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
  "A perfect entry is a Patty and Blake card, not a fit. Window 9:30–11:00, not into the 11:00 open. Four-hour and one-hour agree. Do not fade the four-week tape. Sweep out of the box, body close back through the gap, no mitigation block, other index failed the same side, nothing untaken in front of the target, first card of the session. Stop is the inversion candle. Target is one-to-one or the other side of the box. Fit is a checklist, not the entry. This is the sequence allowed to be graded toward 68% on the one-to-one. That number is not measured yet.";
