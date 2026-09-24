/**
 * The Judas window, 09:30–09:45 ET — as a setup rather than a locked door.
 *
 * WHAT CHANGED AND WHY
 * This window used to be an unconditional refusal: `smc-master.ts` failed the
 * `clean` must-layer, `paper-manager.ts` refused the fill, `path-alarm.ts`
 * returned null. The trader has decided it should not be absolute, and the
 * reasoning is sound — the Judas swing is not a hazard the desk drives past,
 * it is a NAMED MODEL. Price manipulates one way off the open to raid stops,
 * fails, and delivers the other way. The trade is fading the manipulation.
 *
 * So the question was never "is 09:30–09:45 dangerous". It is "has the
 * manipulation finished yet". Before it finishes, the desk's entire sequence
 * is undefined: the sweep is still printing, so there is no "displacement
 * AFTER the sweep" to confirm, and any entry is a guess about which way the
 * raid will go. After it finishes, the setup is the cleanest of the day —
 * a raid with a known extreme, a failure, and a reaction to trade with.
 *
 * THE CONSTRAINT THAT MAKES THIS HARD, AND THE REASON FOR 1m/2m/3m
 * 09:30–09:45 ET is EXACTLY ONE 15m candle. On the series the engine grades,
 * the raid and the reaction to the raid are the same bar and cannot be told
 * apart — not as a matter of tuning, as a matter of resolution. That is why
 * this module reads the minute rungs from `chart-timeframes.ts` and why 2m
 * and 3m were added alongside 1m: they are the coarsest honest views that
 * still separate a manipulation leg from the reaction to it.
 *
 * IT FAILS CLOSED
 * No sub-15m tape means no resolution, and no resolution means the window
 * stays shut. The desk does not get to assume the raid resolved because it
 * could not see. That matters on a lagged feed — Yahoo runs ~10 minutes
 * behind, which is most of the window — so in practice this releases only
 * when the gateway is up (08:15–11:30 ET), which is exactly the window it was
 * built for.
 *
 * WHAT IT STILL CANNOT DO
 * It releases ONE layer. The draw, the sweep significance, the dealing-range
 * half, the LTF shift, the priced target ≥1R and the retrace all still have
 * to pass on their own, the confluence floor still applies, and the news
 * blackout is a separate veto this cannot satisfy. A released Judas window
 * with no sequence behind it is still a STAND.
 */

import type { OhlcBar } from "../market/types";
import { summarizeDetectors } from "./detectors";
import { isJudasWindow } from "./sessions";
import type { ChartTf, TfSeries } from "./chart-timeframes";

/**
 * The grade a Judas entry has to carry.
 *
 * The open is the least-informed moment of the day: the dealing range is
 * hours old, the session's own structure does not exist yet, and the raid
 * that just printed is the only new fact. CLAUDE.md records that the rule
 * was always MEANT to have a grade-based escape for a fully complete setup
 * after the raid, and that nothing ever implemented it. This is it, set at
 * the A+ tag rather than the action floor because a window this thin should
 * not be taking A− setups.
 */
export const JUDAS_MIN_CONFLUENCE = 0.75;

/** Finest first. The first rung with real bars is the one that decides. */
export const JUDAS_TFS: ChartTf[] = ["1m", "2m", "3m"];

/** How recent the raid must be to still be THIS open's manipulation leg. */
export const RAID_MAX_AGE_MS = 25 * 60_000;

export type JudasStage =
  | "outside"
  | "no-tape"
  | "no-raid"
  | "raid-unresolved"
  | "wrong-side"
  | "released";

export interface JudasRead {
  /** Is the clock inside 09:30–09:45 ET at all? */
  inWindow: boolean;
  /** True when the desk must still refuse. Outside the window this is false. */
  blocked: boolean;
  stage: JudasStage;
  /** Which rung resolved it. Null when nothing could. */
  tf: ChartTf | null;
  raid: { side: "buyside" | "sellside"; extreme: number; t: number } | null;
  /** The side the resolved manipulation says to trade. Null until resolved. */
  releasedSide: "long" | "short" | null;
  reason: string;
}

const out = (over: Partial<JudasRead>): JudasRead => ({
  inWindow: true,
  blocked: true,
  stage: "no-raid",
  tf: null,
  raid: null,
  releasedSide: null,
  reason: "",
  ...over,
});

/**
 * Has this open's manipulation finished, and which way did it resolve?
 *
 * `rungs` is the bundle from `allSeries(m15, m1)`. `side` is the side the
 * sequence wants to trade; a release is granted only when that side is the
 * one the failed raid points at, because entering WITH the manipulation is
 * precisely the trade this window exists to prevent.
 */
export function readJudas(
  rungs: Partial<Record<ChartTf, TfSeries>> | null | undefined,
  clock: { etHour: number; etMinute: number },
  side: "long" | "short" | null,
): JudasRead {
  if (!isJudasWindow(clock.etHour, clock.etMinute)) {
    return {
      inWindow: false,
      blocked: false,
      stage: "outside",
      tf: null,
      raid: null,
      releasedSide: null,
      reason: "Outside the 09:30–09:45 window",
    };
  }

  // Finest rung with enough tape to carry a detector. 30 bars is two 15m
  // candles' worth on 1m — enough for a swing to exist to be swept.
  let chosen: { tf: ChartTf; bars: OhlcBar[] } | null = null;
  for (const tf of JUDAS_TFS) {
    const s = rungs?.[tf];
    if (s?.bars && s.bars.length >= 30) {
      chosen = { tf, bars: s.bars };
      break;
    }
  }
  if (!chosen) {
    return out({
      stage: "no-tape",
      reason:
        "Judas 09:30–09:45 — no 1m/2m/3m tape, so the raid cannot be told from the reaction. " +
        "The window stays shut rather than assume it resolved.",
    });
  }

  const det = summarizeDetectors(chosen.bars);
  const raid = det.sweep.latest;
  const disp = det.displacement.latest;
  const nowT = chosen.bars[chosen.bars.length - 1]!.t;

  if (!raid || nowT - raid.t > RAID_MAX_AGE_MS) {
    return out({
      tf: chosen.tf,
      stage: "no-raid",
      reason: `Judas 09:30–09:45 — no raid on the ${chosen.tf} yet. Name it, do not anticipate it.`,
    });
  }

  const wantDisp = raid.side === "sellside" ? "bull" : "bear";
  const wantSide = raid.side === "sellside" ? "long" : "short";

  // The reaction must be a LATER bar than the raid. Same-bar is the raid
  // itself wearing the shape of a reaction, which is the exact confusion the
  // whole window exists to avoid — and on a 15m series it is the ONLY thing
  // that can ever happen here.
  const resolved =
    !!disp && disp.index > raid.index && disp.direction === wantDisp && raid.closeBackInside > 0;

  if (!resolved) {
    return out({
      tf: chosen.tf,
      stage: "raid-unresolved",
      raid: { side: raid.side, extreme: raid.wickExtreme, t: raid.t },
      reason:
        `Judas 09:30–09:45 — ${raid.side} raid to ${raid.wickExtreme.toFixed(2)} on the ${chosen.tf}, ` +
        (disp && disp.index <= raid.index
          ? "but the displacement is the raid itself, not the reaction to it. Wait for a later bar."
          : `no ${wantDisp} displacement back through it yet. The manipulation has not failed.`),
    });
  }

  if (side && side !== wantSide) {
    return out({
      tf: chosen.tf,
      stage: "wrong-side",
      raid: { side: raid.side, extreme: raid.wickExtreme, t: raid.t },
      releasedSide: wantSide,
      reason:
        `Judas 09:30–09:45 — the ${raid.side} raid failed and points ${wantSide.toUpperCase()}, ` +
        `not ${side.toUpperCase()}. Entering WITH the manipulation is the trade this window refuses.`,
    });
  }

  return {
    inWindow: true,
    blocked: false,
    stage: "released",
    tf: chosen.tf,
    raid: { side: raid.side, extreme: raid.wickExtreme, t: raid.t },
    releasedSide: wantSide,
    reason:
      `Judas swing confirmed on the ${chosen.tf}: ${raid.side} raid to ${raid.wickExtreme.toFixed(2)}, ` +
      `closed back inside by ${raid.closeBackInside.toFixed(2)}, ${wantDisp} displacement ` +
      `${disp!.ratio.toFixed(1)}× ATR on a later bar. Fade it ${wantSide.toUpperCase()}.`,
  };
}
