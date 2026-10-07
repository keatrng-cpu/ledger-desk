/**
 * How fresh the print is, and whether the last minute is noise.
 * The cuts match the desk: 30s feed lag (exec/limits.ts maxFeedLagSec), a last-return |z| of 2.
 * A sentence from here is a note. It is not a gate and it does not place.
 */

const FEED_LAG_SEC = 30;
const NOISE_Z = 2;

/** |z| of the last log-return against the ones before it. Too few prints, or a flat window, is not a number. */
export function noiseZ(closes: readonly number[]): number {
  if (closes.length < 9) return Number.POSITIVE_INFINITY;
  const rets: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    const prev = closes[i - 1]!;
    const cur = closes[i]!;
    if (!(prev > 0) || !(cur > 0)) return Number.POSITIVE_INFINITY;
    rets.push(Math.log(cur / prev));
  }
  if (rets.length < 8) return Number.POSITIVE_INFINITY;
  const prior = rets.slice(0, -1);
  const mean = prior.reduce((s, x) => s + x, 0) / prior.length;
  const variance = prior.reduce((s, x) => s + (x - mean) ** 2, 0) / (prior.length - 1);
  const sigma = Math.sqrt(variance);
  if (!(sigma > 0)) return Number.POSITIVE_INFINITY;
  return (rets[rets.length - 1]! - mean) / sigma;
}

export function precisionSentence(input: { symbol: string; lagSec: number | null; closes: readonly number[] }): string | null {
  const bits: string[] = [];
  if (input.lagSec != null && Number.isFinite(input.lagSec)) {
    const age = Math.round(input.lagSec);
    bits.push(input.lagSec <= FEED_LAG_SEC ? `${input.symbol} print is ${age}s old` : `${input.symbol} print is ${age}s old, past the ${FEED_LAG_SEC}s feed`);
  }
  const z = noiseZ(input.closes);
  if (Number.isFinite(z)) {
    const az = Math.abs(z);
    bits.push(az >= NOISE_Z ? `last minute is ${az.toFixed(1)}z, a noise bar` : `last minute is ${az.toFixed(1)}z, not a noise bar`);
  } else if (input.closes.length >= 9) {
    bits.push("last minute has no usable range, treat it as noise");
  }
  if (!bits.length) return null;
  return `${bits.join(". ")}. A note for the book. Not a gate.`;
}
