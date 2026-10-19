import type { OhlcBar } from "./types";

const MONTH_CODE = ["H", "M", "U", "Z"] as const; // Mar Jun Sep Dec

/** Third Friday of (year, month0) in UTC. */
function thirdFriday(year: number, month0: number): Date {
  const first = new Date(Date.UTC(year, month0, 1));
  const firstFridayDay = 1 + ((5 - first.getUTCDay() + 7) % 7);
  return new Date(Date.UTC(year, month0, firstFridayDay + 14));
}

/**
 * Front quarterly contract by the rule Yahoo ES=F / NQ=F follow: the front is the nearest
 * quarterly (H/M/U/Z) whose 3rd-Friday expiry is still more than 8 days away. The roll lands on
 * the Thursday 8 days before expiry (CME equity-index roll date — 2026-09-10 for ESU6→ESZ6).
 * `now` is injectable so callers and tests share one deterministic calculation.
 */
export function frontQuarterly(root: string, now: Date = new Date()): string {
  const t = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  for (let i = 0; i < 8; i++) {
    const q = Math.floor(now.getUTCMonth() / 3) + i;
    const year = now.getUTCFullYear() + Math.floor(q / 4);
    const month0 = (q % 4) * 3 + 2;
    const expiry = thirdFriday(year, month0).getTime();
    const rollDate = expiry - 8 * 86_400_000;
    if (t < rollDate) return `${root}${MONTH_CODE[q % 4]}${year % 10}`;
  }
  throw new Error("frontQuarterly: no contract found");
}

/** Roll one-minute bars into N-minute OHLC buckets on epoch boundaries. */
export function aggregateBars(bars: OhlcBar[], minutes: number): OhlcBar[] {
  if (minutes <= 1 || bars.length === 0) return bars;
  const ms = minutes * 60_000;
  const out: OhlcBar[] = [];
  let bucket = -1;
  let cur: OhlcBar | null = null;
  for (const b of bars) {
    const k = Math.floor(b.t / ms) * ms;
    if (k !== bucket || !cur) {
      if (cur) out.push(cur);
      bucket = k;
      cur = { t: k, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v };
    } else {
      cur.h = Math.max(cur.h, b.h);
      cur.l = Math.min(cur.l, b.l);
      cur.c = b.c;
      cur.v += b.v;
    }
  }
  if (cur) out.push(cur);
  return out;
}
