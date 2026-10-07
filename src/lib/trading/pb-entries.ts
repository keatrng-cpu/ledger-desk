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
  | "amd"
  | "tjr"
  | "reversal"
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
  /** Sweep closed through and held. A fade of that break stands down. */
  accepted?: boolean;
  /** False when the other index refused the same sequence. Unknown does not block. */
  otherAgrees?: boolean | null;
  /** False when the shift did not leave a 1m–5m gap. Unknown does not block. */
  realGap?: boolean | null;
  /** False when the draw has already traded. */
  drawOpen?: boolean;
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
  if (input.drawOpen === false) {
    return {
      sequence: "wait",
      label: "DRAW SPENT",
      act: "The pool or the gap already traded. No second entry in the same leg.",
      enter: false,
    };
  }
  if (input.otherAgrees === false) {
    return {
      sequence: "wait",
      label: "STAND DOWN · OTHER BOOK",
      act: "The other index did not print the same sweep or inverse. One book refusing the sequence is a stand-down.",
      enter: false,
    };
  }
  if (input.accepted) {
    return {
      sequence: "wait",
      label: "STAND DOWN · ACCEPTED",
      act: "The sweep closed through and held. That is the break, not a fade. Do not take the reversal.",
      enter: false,
    };
  }
  // Reversal: the sweep failed and delivery changed. CISD is the early close
  // through the sweep leg. MSS is the displacement break. The entry is the
  // retrace into that gap, not the raid itself.
  if (input.swept && input.displaced && !input.htfOk && (input.inverted || input.inArray) && input.realGap !== false) {
    return {
      sequence: "reversal",
      label: "ENTER · REVERSAL",
      act: "The raid failed. Delivery shifted against the old bias. Enter the retrace into the gap the shift left. Stop beyond the sweep. Do not fade a sweep that accepted through.",
      enter: true,
    };
  }
  if (input.swept && input.displaced && !input.htfOk) {
    return {
      sequence: "reversal",
      label: "ANTICIPATION · REVERSAL",
      act: "Sweep printed and the shift started, against the old bias. Wait for the retrace into the gap or the CISD level. The raid is not the entry.",
      enter: false,
    };
  }
  // AMD: accumulation is the range, manipulation is the raid, distribution is the entry.
  // The Judas swing is only the middle. Do not buy the breakout of the range.
  if (bias && input.swept && (input.displaced || input.inverted) && (input.inArray || input.inverted) && input.realGap !== false) {
    return {
      sequence: "amd",
      label: "ENTER · AMD",
      act: "Accumulation was the range. Manipulation was the sweep. Distribution is this retrace. Enter the gap the shift left. Stop beyond the raid. Target the other side of the range.",
      enter: true,
    };
  }
  if (bias && input.swept && !input.displaced && !input.inverted) {
    return {
      sequence: "amd",
      label: "ANTICIPATION · AMD",
      act: "The range was swept. That is manipulation, not the entry. Wait for delivery to shift and for the retrace into the gap. Do not chase the wick.",
      enter: false,
    };
  }
  // TJR: sweep, then market structure shift, then the retrace into the FVG or the order block.
  if (bias && input.swept && input.displaced && (input.inArray || input.inverted) && input.realGap !== false) {
    return {
      sequence: "tjr",
      label: "ENTER · TJR",
      act: "Sweep, then the shift, then the retrace. Price is back in the gap the displacement left. Stop beyond the sweep. Target is the next unswept pool.",
      enter: true,
    };
  }
  if (bias && input.swept && input.displaced) {
    return {
      sequence: "tjr",
      label: "ANTICIPATION · TJR",
      act: "Sweep and the structure shift have printed. Wait for the retrace into the fair value gap or the last opposing candle. Do not chase the break.",
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
    if (input.realGap === false) {
      return {
        sequence: "gap_tap_displace",
        label: "ANTICIPATION · GAP TAP",
        act: "The tap displaced without leaving a 1m to 5m gap. Wait for the gap. Do not enter the drift.",
        enter: false,
      };
    }
    return {
      sequence: "gap_tap_displace",
      label: "ENTER · GAP TAP",
      act: "The higher-timeframe gap was tapped and price displaced in the bias, and the shift left a gap. Continuation. The displacement is the entry, not a second confirm.",
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

export interface SequenceCard {
  symbol: string;
  side: string;
  htfOk: boolean;
  gapSide?: "long" | "short" | null;
  components?: readonly string[] | null;
  strategyPrimary?: string | null;
  targets?: readonly string[] | null;
  plan?: { t1?: number | null } | null;
}

/** One read for the scanner card and the floor, off the component names the scanner actually writes. */
export function sequenceFor(
  c: SequenceCard,
  ctx: {
    inArray: boolean;
    gone: boolean;
    price: number | null;
    others: SequenceCard[];
  },
): PbRead {
  const comps = new Set((c.components ?? []).map((x) => String(x)));
  const text = c.strategyPrimary ?? "";
  const side = c.side === "short" ? "short" : "long";
  const swept = comps.has("sweep_significant") || comps.has("sweep") || /sweep/i.test(text);
  const inverted = comps.has("ifvg") || /inverse|ifvg/i.test(text);
  const displaced = comps.has("displacement") || comps.has("mss") || comps.has("cisd") || /displac/i.test(text);
  const realGap = inverted || comps.has("ifvg") ? true : displaced ? false : null;
  const t1 = c.plan?.t1 ?? null;
  const drawOpen = ctx.price == null || t1 == null ? true : side === "long" ? ctx.price < t1 : ctx.price > t1;
  const rest = ctx.others.filter((o) => o.symbol !== c.symbol);
  let otherAgrees: boolean | null = null;
  if (rest.length) {
    const hit = (o: SequenceCard) => {
      const set = new Set((o.components ?? []).map((x) => String(x)));
      return set.has("sweep_significant") || set.has("ifvg") || set.has("displacement") || set.has("mss");
    };
    const same = rest.some((o) => o.side === c.side && hit(o));
    const opp = rest.some((o) => o.side !== c.side && hit(o));
    otherAgrees = opp && !same ? false : same ? true : null;
  }
  return readPbEntry({
    side,
    htfOk: c.htfOk,
    gapAgrees: c.gapSide == null || c.gapSide === side,
    swept,
    inverted,
    displaced,
    gapTapped: c.gapSide != null && c.gapSide === side,
    target: (c.targets?.length ?? 0) > 0 || t1 != null,
    inArray: ctx.inArray,
    gone: ctx.gone,
    accepted: !c.htfOk && swept && displaced && !inverted && !ctx.inArray,
    otherAgrees,
    realGap,
    drawOpen,
  });
}
