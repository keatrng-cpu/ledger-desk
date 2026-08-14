/**
 * Internal + external liquidity map (SSL/BSL).
 * Session high/low is ONE class — not the whole picture.
 *
 * EXTERNAL sellside: PDL, PWL, swing lows outside dealing range
 * INTERNAL sellside: EQL clusters, range low, swing lows inside range
 * EXTERNAL buyside: PDH, PWH, swing highs outside range
 * INTERNAL buyside: EQH clusters, range high, swing highs inside range
 */
import type { OhlcBar } from "@/lib/market/types";

export type Bias = "bull" | "bear" | "neutral";

export interface Swing {
  t: number;
  price: number;
  kind: "high" | "low";
}

export interface DealingRange {
  high: number;
  low: number;
  eq: number;
  zone: "premium" | "discount" | "equilibrium";
  position: number;
}

export interface LiquidityPool {
  price: number;
  side: "buyside" | "sellside";
  scope: "internal" | "external";
  label: string;
  strength: number;
  swept: boolean;
  t?: number;
  tf?: "15m" | "1h" | "4h" | "session" | "daily" | "weekly";
}

export function mapLiquidityPools(
  bars: OhlcBar[],
  swings: Swing[],
  dealing: DealingRange | null,
  levels: {
    pdh: number | null;
    pdl: number | null;
    pwh: number | null;
    pwl: number | null;
  },
): LiquidityPool[] {
  const pools: LiquidityPool[] = [];
  if (!bars.length) return pools;
  const recent = bars.slice(-40);
  const atr = recent.length
    ? recent.reduce((a, b) => a + (b.h - b.l), 0) / recent.length
    : 1;
  const tol = Math.max(atr * 0.12, 0.25);
  const last = bars[bars.length - 1]!;
  const rangeHi = dealing?.high ?? null;
  const rangeLo = dealing?.low ?? null;

  const scopeOf = (price: number): "internal" | "external" => {
    if (rangeHi == null || rangeLo == null) return "external";
    if (price >= rangeLo - tol && price <= rangeHi + tol) return "internal";
    return "external";
  };

  const push = (
    price: number | null | undefined,
    side: "buyside" | "sellside",
    label: string,
    strength: number,
    scopeOverride?: "internal" | "external",
    extra?: { t?: number; tf?: LiquidityPool["tf"] },
  ) => {
    if (price == null || !Number.isFinite(price)) return;
    const scope = scopeOverride ?? scopeOf(price);
    const swept =
      side === "buyside"
        ? last.h > price + tol * 0.05
        : last.l < price - tol * 0.05;
    const dup = pools.find(
      (p) =>
        p.side === side &&
        p.scope === scope &&
        Math.abs(p.price - price) <= tol,
    );
    if (dup) {
      if (strength > dup.strength) {
        dup.price = price;
        dup.label = label;
        dup.strength = strength;
        dup.swept = swept;
        if (extra?.t) dup.t = extra.t;
        if (extra?.tf) dup.tf = extra.tf;
      }
      return;
    }
    pools.push({
      price,
      side,
      scope,
      label,
      strength,
      swept,
      t: extra?.t,
      tf: extra?.tf,
    });
  };

  // EXTERNAL HTF references
  push(levels.pdl, "sellside", "PDL (external SSL)", 5, "external", { tf: "daily" });
  push(levels.pwl, "sellside", "PWL (external SSL)", 6, "external", { tf: "weekly" });
  push(levels.pdh, "buyside", "PDH (external BSL)", 5, "external", { tf: "daily" });
  push(levels.pwh, "buyside", "PWH (external BSL)", 6, "external", { tf: "weekly" });

  // Dealing-range extremes (internal boundary)
  if (dealing) {
    push(dealing.low, "sellside", "Range low (internal SSL)", 4, "internal", { tf: "15m" });
    push(dealing.high, "buyside", "Range high (internal BSL)", 4, "internal", { tf: "15m" });
  }

  // Equal highs / lows
  const highs = swings.filter((s) => s.kind === "high").slice(-16);
  const lows = swings.filter((s) => s.kind === "low").slice(-16);
  const cluster = (
    pts: Swing[],
    side: "buyside" | "sellside",
    base: string,
  ) => {
    const used = new Set<number>();
    for (let i = 0; i < pts.length; i++) {
      if (used.has(i)) continue;
      const group = [pts[i]!];
      used.add(i);
      for (let j = i + 1; j < pts.length; j++) {
        if (Math.abs(pts[j]!.price - pts[i]!.price) <= tol) {
          group.push(pts[j]!);
          used.add(j);
        }
      }
      if (group.length >= 2) {
        const price =
          group.reduce((a, g) => a + g.price, 0) / group.length;
        const scope = scopeOf(price);
        push(
          price,
          side,
          `${base} ×${group.length} (${scope})`,
          3 + group.length,
          scope,
          { t: group[group.length - 1]!.t, tf: "15m" },
        );
      }
    }
  };
  cluster(highs, "buyside", "EQH");
  cluster(lows, "sellside", "EQL");

  // Structural swings
  for (const s of lows.slice(-6)) {
    const scope = scopeOf(s.price);
    push(
      s.price,
      "sellside",
      scope === "external"
        ? "Swing low (external SSL)"
        : "Swing low (internal SSL)",
      scope === "external" ? 3.5 : 2.5,
      scope,
      { t: s.t, tf: "15m" },
    );
  }
  for (const s of highs.slice(-6)) {
    const scope = scopeOf(s.price);
    push(
      s.price,
      "buyside",
      scope === "external"
        ? "Swing high (external BSL)"
        : "Swing high (internal BSL)",
      scope === "external" ? 3.5 : 2.5,
      scope,
      { t: s.t, tf: "15m" },
    );
  }

  // Session extremes — one class only
  const dayBars = bars.slice(-Math.min(bars.length, 96));
  if (dayBars.length) {
    let sh = -Infinity;
    let sl = Infinity;
    let shT = dayBars[0]!.t;
    let slT = dayBars[0]!.t;
    for (const b of dayBars) {
      if (b.h >= sh) {
        sh = b.h;
        shT = b.t;
      }
      if (b.l <= sl) {
        sl = b.l;
        slT = b.t;
      }
    }
    push(sh, "buyside", "Session high (BSL)", 3, scopeOf(sh), { t: shT, tf: "session" });
    push(sl, "sellside", "Session low (SSL)", 3, scopeOf(sl), { t: slT, tf: "session" });
  }

  return pools
    .sort((a, b) =>
      a.scope !== b.scope
        ? a.scope === "external"
          ? -1
          : 1
        : b.strength - a.strength,
    )
    .slice(0, 16);
}
