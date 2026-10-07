/**
 * Patty and Blake entries. The array fill is one of them, not the only one.
 *
 * Inverse: after a sweep in the higher-timeframe bias, the entry is the
 * 1m, 2m, 3m, 4m, or 5m inverse of the gap in that leg. Five minutes is the
 * highest inverse they normally take. Do not enter inside the five-minute
 * gap just traded into. Wait for it to invert.
 *
 * Gap tap: price fills or taps the higher-timeframe gap, a new gap forms off
 * that reaction, then either displacement in the bias or the inverse of that
 * new gap is the entry.
 *
 * Continuation: already in bias, a pullback into a 5m or 15m gap, then the
 * first 1m–5m inverse. A continuation needs less structure than a reversal.
 * A target has to be marked. A gap that defends nothing is not a hold.
 */

export type PbSequence =
  | "inverse_after_sweep"
  | "gap_tap_displace"
  | "gap_tap_inverse"
  | "continuation"
  | "array"
  | "wait";

export interface PbRead {
  sequence: PbSequence;
  label: string;
  act: string;
  enter: boolean;
}

export function readPbEntry(input: {
  side: "long" | "short";
  htfOk: boolean;
  gapAgrees: boolean;
  swept: boolean;
  inverted: boolean;
  displaced: boolean;
  gapTapped: boolean;
  target: boolean;
  inArray: boolean;
  gone: boolean;
}): PbRead {
  const bias = input.htfOk || input.gapAgrees;
  if (input.gone) {
    return {
      sequence: "wait",
      label: "ENTRY GONE",
      act: "Price left the entry. Do not chase. Wait for a new inverse or a new gap off the tap.",
      enter: false,
    };
  }
  if (!input.target) {
    return {
      sequence: "wait",
      label: "NO TARGET",
      act: "Patty does not take a gap that defends nothing. Mark the draw before the inverse.",
      enter: false,
    };
  }
  if (bias && input.swept && input.inverted) {
    return {
      sequence: "inverse_after_sweep",
      label: "ENTER · INVERSE",
      act: "Sweep in the higher-timeframe bias, then a 1m to 5m inverse. That inverse is the entry. Five minutes is the highest. The stop is beyond the sweep.",
      enter: true,
    };
  }
  if (bias && input.gapTapped && input.displaced) {
    return {
      sequence: "gap_tap_displace",
      label: "ENTER · GAP TAP",
      act: "The higher-timeframe gap was tapped and price displaced in the bias. Continuation. The displacement is the entry, not a second confirm.",
      enter: true,
    };
  }
  if (bias && input.gapTapped && input.inverted) {
    return {
      sequence: "gap_tap_inverse",
      label: "ENTER · GAP INVERSE",
      act: "The tap formed a gap and that gap inverted in the bias. The inverse of the tap-gap is the entry.",
      enter: true,
    };
  }
  if (bias && input.gapTapped && !input.swept) {
    return {
      sequence: "continuation",
      label: "ANTICIPATION · CONTINUATION",
      act: "Pullback into the 5m or 15m gap, bias already set. Wait for the first 1m to 5m inverse, or for displacement off the tap. Do not enter inside the gap.",
      enter: false,
    };
  }
  if (bias && input.swept && !input.inverted) {
    return {
      sequence: "inverse_after_sweep",
      label: "ANTICIPATION · INVERSE",
      act: "Sweep is in. Wait for the 1m, 2m, 3m, 4m, or 5m inverse of the gap in that leg. Armed is not the fill.",
      enter: false,
    };
  }
  if (input.inArray && bias) {
    return {
      sequence: "array",
      label: "ENTER · ARRAY",
      act: "Price is in the array and the bias agrees. Rest the limit at CE. This is the fill when no inverse has printed yet.",
      enter: true,
    };
  }
  return {
    sequence: "wait",
    label: "ANTICIPATION",
    act: "Need the higher-timeframe bias, a sweep or a gap tap, and a target. The entry is the inverse or the displacement, not the score.",
    enter: false,
  };
}
