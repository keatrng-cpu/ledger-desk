import { useEffect, useRef } from "react";
import type { OhlcBar } from "@/lib/market/types";
import type { ChartOverlay } from "@/lib/trading/chart-overlay";
import type { TradePlan } from "@/lib/trading/trade-plan";
import type { SmcArray } from "@/lib/trading/smc-board";

export interface CandleHover {
  time: number;
  o: number;
  h: number;
  l: number;
  c: number;
}

interface CandlestickPaneProps {
  bars: OhlcBar[];
  height?: number;
  onHover?: (point: CandleHover | null) => void;
  /** Unix ms — mirrors crosshair from the sibling pane. */
  syncTimeMs?: number | null;
  accentUp?: string;
  accentDown?: string;
  /**
   * The SMC markup for this symbol (chart-overlay.ts). Drawn as native
   * price lines (pools, draw, EQ, plan), series markers (raid, MSS/BOS,
   * displacement) and a canvas primitive (PD-array boxes). Null = bare tape.
   */
  overlay?: ChartOverlay | null;
  /** The priced trade, if the sequence has one. Lines on top of the overlay. */
  plan?: TradePlan | null;
}

/**
 * Colours are hex here, not CSS tokens: lightweight-charts paints to a
 * canvas and cannot resolve `var(--color-*)`. These are the same hues the
 * SVG setup chart uses (see styles.css tokens) so the two surfaces agree.
 */
const C = {
  up: "#22c55e",
  down: "#ef4444",
  warn: "#f59e0b",
  primary: "#2dd4bf",
  fg: "#e4e4e7",
  muted: "#a1a1aa",
  fvg: "#a1a1aa",
  ifvg: "#60a5fa",
  ob: "#fbbf24",
};

function toCandleData(bars: OhlcBar[]) {
  return bars.map((b) => ({
    time: Math.floor(b.t / 1000) as number,
    open: b.o,
    high: b.h,
    low: b.l,
    close: b.c,
  }));
}

function toVolumeData(bars: OhlcBar[], up: string, down: string) {
  return bars.map((b) => ({
    time: Math.floor(b.t / 1000) as number,
    value: b.v ?? 0,
    color: b.c >= b.o ? up : down,
  }));
}

/** Snap an event time to the bar that contains it, as chart seconds. */
function barTimeSec(bars: OhlcBar[], t: number): number | null {
  if (!bars.length) return null;
  if (t <= bars[0]!.t) return Math.floor(bars[0]!.t / 1000);
  for (let i = bars.length - 1; i >= 0; i--) {
    if (bars[i]!.t <= t) return Math.floor(bars[i]!.t / 1000);
  }
  return null;
}

function arrayColor(a: SmcArray): string {
  if (a.kind === "ob" || a.kind === "bb" || a.kind === "rb") return C.ob;
  if (a.kind === "ifvg") return C.ifvg;
  return C.fvg;
}

function arrayName(a: SmcArray): string {
  const kind = a.kind === "bb" ? "breaker" : a.kind === "rb" ? "rejection" : a.kind;
  const state = a.state === "fresh" || a.state === kind ? "" : ` · ${a.state}`;
  return `${a.tf} ${a.side} ${kind}${state}`.toUpperCase();
}

function shortName(label: string): string {
  return label.replace(/\s*\([^)]*\)/g, "").replace(/\s+/g, " ").trim();
}

/**
 * PD-array boxes as a series primitive.
 *
 * lightweight-charts has price lines and markers but no rectangles, so the
 * boxes an SMC trader draws from the bar that made an FVG/OB out to the
 * right edge are painted here on the series' own canvas, in the series'
 * coordinate space, so they scroll and zoom with the candles.
 */
function makeArrayPrimitive(getArrays: () => SmcArray[]) {
  let series: any = null;
  let chart: any = null;
  const renderer = {
    draw(target: any) {
      if (!series || !chart) return;
      const arrays = getArrays();
      if (!arrays.length) return;
      target.useMediaCoordinateSpace(({ context: ctx, mediaSize }: any) => {
        const ts = chart.timeScale();
        for (const a of arrays) {
          const yTop = series.priceToCoordinate(a.top);
          const yBot = series.priceToCoordinate(a.bottom);
          if (yTop == null || yBot == null) continue;
          let x0 = ts.timeToCoordinate(Math.floor(a.t / 1000));
          // Origin left of the visible range → box starts at the left edge.
          if (x0 == null) {
            const first = ts.getVisibleRange?.();
            if (first && Math.floor(a.t / 1000) < Number(first.from)) x0 = 0;
            else continue;
          }
          const strong = a.state === "fresh" || a.state === "inverted";
          const color = arrayColor(a);
          const h = Math.max(1.5, yBot - yTop);
          ctx.globalAlpha = strong ? 0.18 : 0.09;
          ctx.fillStyle = color;
          ctx.fillRect(x0, yTop, mediaSize.width - x0, h);
          ctx.globalAlpha = 0.6;
          ctx.strokeStyle = color;
          ctx.lineWidth = 0.75;
          ctx.beginPath();
          ctx.moveTo(x0, yTop);
          ctx.lineTo(mediaSize.width, yTop);
          ctx.moveTo(x0, yBot);
          ctx.lineTo(mediaSize.width, yBot);
          ctx.stroke();
          if (h >= 9) {
            ctx.globalAlpha = 0.9;
            ctx.fillStyle = C.muted;
            ctx.font = "8px ui-monospace, monospace";
            ctx.textBaseline = "top";
            ctx.fillText(arrayName(a), x0 + 3, yTop + 1);
          }
          ctx.globalAlpha = 1;
        }
      });
    },
  };
  const view = { zOrder: () => "bottom" as const, renderer: () => renderer };
  const views = [view];
  return {
    attached(p: any) {
      series = p.series;
      chart = p.chart;
    },
    detached() {
      series = null;
      chart = null;
    },
    paneViews: () => views,
    updateAllViews() {},
  };
}

/**
 * Client-only candlestick pane (lightweight-charts is browser/canvas).
 * Dynamic-imports the lib so SSR never resolves it.
 */
/** Epoch SECONDS → ET wall clock ("09:30", or "Sep 25 09:30" with the date). */
function etLabel(t: number, withDate: boolean): string {
  return new Date(t * 1000).toLocaleString("en-US", {
    timeZone: "America/New_York",
    ...(withDate ? { month: "short", day: "2-digit" } : {}),
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function CandlestickPane({
  bars,
  height = 280,
  onHover,
  syncTimeMs,
  accentUp = C.up,
  accentDown = C.down,
  overlay = null,
  plan = null,
}: CandlestickPaneProps) {
  const elRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<any>(null);
  const fitKeyRef = useRef<string>("");
  const candleRef = useRef<any>(null);
  const volRef = useRef<any>(null);
  const lwcRef = useRef<any>(null);
  const priceLinesRef = useRef<any[]>([]);
  const markersRef = useRef<any>(null);
  const primitiveRef = useRef<any>(null);
  const arraysRef = useRef<SmcArray[]>([]);
  const onHoverRef = useRef(onHover);
  onHoverRef.current = onHover;
  // The overlay may arrive before the chart finishes its dynamic import;
  // keep the latest so the init path can paint it once the series exists.
  const overlayRef = useRef<{ overlay: ChartOverlay | null; plan: TradePlan | null }>({ overlay, plan });
  overlayRef.current = { overlay, plan };

  useEffect(() => {
    if (typeof window === "undefined" || !elRef.current) return;
    let disposed = false;
    let chart: any;

    (async () => {
      const lwc = await import("lightweight-charts");
      if (disposed || !elRef.current) return;
      lwcRef.current = lwc;
      const {
        createChart,
        ColorType,
        CrosshairMode,
        CandlestickSeries,
        HistogramSeries,
      } = lwc;

      chart = createChart(elRef.current, {
        height,
        layout: {
          background: { type: ColorType.Solid, color: "transparent" },
          textColor: "#a1a1aa",
        },
        grid: {
          vertLines: { color: "rgba(63,63,70,0.35)" },
          horzLines: { color: "rgba(63,63,70,0.35)" },
        },
        crosshair: { mode: CrosshairMode.Normal },
        rightPriceScale: { borderVisible: false },
        // ET, labelled. The library gets raw epoch seconds and printed UTC by
        // default, so 09:30 ET read as 13:30 on a desk whose every rule is
        // written in ET.
        localization: { timeFormatter: (t: number) => `${etLabel(t, true)} ET` },
        timeScale: {
          borderVisible: false,
          timeVisible: true,
          secondsVisible: false,
          tickMarkFormatter: (t: number) => etLabel(t, false),
        },
      });
      chartRef.current = chart;

      const candle = chart.addSeries(CandlestickSeries, {
        upColor: accentUp,
        downColor: accentDown,
        borderVisible: false,
        wickUpColor: accentUp,
        wickDownColor: accentDown,
      });
      candleRef.current = candle;

      const vol = chart.addSeries(HistogramSeries, {
        priceFormat: { type: "volume" },
        priceScaleId: "vol",
      });
      chart.priceScale("vol").applyOptions({
        scaleMargins: { top: 0.8, bottom: 0 },
      });
      volRef.current = vol;

      const primitive = makeArrayPrimitive(() => arraysRef.current);
      candle.attachPrimitive(primitive);
      primitiveRef.current = primitive;

      if (bars.length) {
        candle.setData(toCandleData(bars) as any);
        vol.setData(toVolumeData(bars, accentUp + "99", accentDown + "99") as any);
        chart.timeScale().fitContent();
      }
      paintOverlay(bars, overlayRef.current.overlay, overlayRef.current.plan);

      chart.subscribeCrosshairMove((param: any) => {
        const cb = onHoverRef.current;
        if (!cb) return;
        if (!param?.time || !param.seriesData) {
          cb(null);
          return;
        }
        const d = param.seriesData.get(candle) as
          | { open: number; high: number; low: number; close: number; time: number }
          | undefined;
        if (!d) {
          cb(null);
          return;
        }
        cb({
          time: Number(d.time) * 1000,
          o: d.open,
          h: d.high,
          l: d.low,
          c: d.close,
        });
      });
    })();

    return () => {
      disposed = true;
      chart?.remove();
      chartRef.current = null;
      candleRef.current = null;
      volRef.current = null;
      primitiveRef.current = null;
      markersRef.current = null;
      priceLinesRef.current = [];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Replace every overlay object on the series. Called on init and whenever
   * the overlay/plan/bars change; lightweight-charts has no diffing for
   * price lines, so the previous set is removed and the new one created —
   * a handful of objects each poll, well under a frame.
   */
  function paintOverlay(currentBars: OhlcBar[], ov: ChartOverlay | null, pl: TradePlan | null) {
    const candle = candleRef.current;
    const lwc = lwcRef.current;
    const chart = chartRef.current;
    if (!candle || !lwc || !chart) return;
    const { LineStyle, createSeriesMarkers } = lwc;

    for (const line of priceLinesRef.current) {
      try {
        candle.removePriceLine(line);
      } catch {
        /* already gone */
      }
    }
    priceLinesRef.current = [];

    const add = (opts: Record<string, unknown>) => {
      priceLinesRef.current.push(candle.createPriceLine(opts));
    };

    if (ov) {
      for (const p of ov.pools) {
        add({
          price: p.price,
          color: p.side === "buyside" ? C.down : C.up,
          lineWidth: p.scope === "external" ? 2 : 1,
          lineStyle: p.scope === "external" ? LineStyle.Solid : LineStyle.Dashed,
          axisLabelVisible: p.scope === "external" && !p.swept,
          title: `${p.swept ? "✕ " : ""}${p.side === "buyside" ? "BSL" : "SSL"} ${shortName(p.label)}`,
        });
      }
      if (ov.range) {
        add({
          price: ov.range.eq,
          color: C.muted,
          lineWidth: 1,
          lineStyle: LineStyle.Dotted,
          axisLabelVisible: false,
          title: "EQ",
        });
      }
      if (ov.draw) {
        add({
          price: ov.draw.price,
          color: C.up,
          lineWidth: 2,
          lineStyle: LineStyle.LargeDashed,
          axisLabelVisible: true,
          title: `DOL ${shortName(ov.draw.name)} · ${(ov.draw.reachProbability * 100).toFixed(0)}%`,
        });
      }
    }
    if (pl) {
      add({ price: pl.entry, color: C.primary, lineWidth: 2, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: "entry" });
      add({ price: pl.stop, color: C.down, lineWidth: 2, lineStyle: LineStyle.Solid, axisLabelVisible: true, title: "stop" });
      if (pl.t1 != null) {
        add({ price: pl.t1, color: C.up, lineWidth: 2, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: pl.rr1 != null ? `T1 ${pl.rr1.toFixed(1)}R` : "T1" });
      }
      if (pl.t2 != null) {
        add({ price: pl.t2, color: C.up, lineWidth: 1, lineStyle: LineStyle.SparseDotted, axisLabelVisible: true, title: pl.rr2 != null ? `T2 ${pl.rr2.toFixed(1)}R` : "T2" });
      }
    }

    // Markers: the raid, structure breaks, displacement candles.
    const markers: any[] = [];
    const sweep = pl?.sweep?.t != null ? { t: pl.sweep.t, price: pl.sweep.price, above: pl.side === "short" } : ov?.sweep ? { t: ov.sweep.t, price: ov.sweep.price, above: ov.sweep.side === "buyside" } : null;
    if (sweep) {
      const time = barTimeSec(currentBars, sweep.t);
      if (time != null) {
        markers.push({
          time,
          position: sweep.above ? "aboveBar" : "belowBar",
          color: C.warn,
          shape: "circle",
          text: `raid ${sweep.price.toFixed(2)}`,
          size: 1,
        });
      }
    }
    for (const s of ov?.structure ?? []) {
      const time = barTimeSec(currentBars, s.t);
      if (time == null) continue;
      const up = s.side === "bull";
      if (s.kind === "displacement") {
        markers.push({ time, position: up ? "belowBar" : "aboveBar", color: C.warn, shape: up ? "arrowUp" : "arrowDown", size: 0.8 });
      } else {
        markers.push({
          time,
          position: up ? "belowBar" : "aboveBar",
          color: s.kind === "mss" ? C.primary : C.fg,
          shape: up ? "arrowUp" : "arrowDown",
          text: s.kind.toUpperCase(),
          size: 1,
        });
      }
    }
    // Markers must be time-sorted or the library throws.
    markers.sort((a, b) => a.time - b.time);
    if (!markersRef.current) markersRef.current = createSeriesMarkers(candle, markers);
    else markersRef.current.setMarkers(markers);

    arraysRef.current = ov?.arrays ?? [];
    chart.timeScale().applyOptions({});
  }

  useEffect(() => {
    const candle = candleRef.current;
    const vol = volRef.current;
    const chart = chartRef.current;
    if (!candle || !vol || !chart || !bars.length) return;
    candle.setData(toCandleData(bars) as any);
    vol.setData(toVolumeData(bars, accentUp + "99", accentDown + "99") as any);
    // Refit only when the SERIES changed (a new symbol/range), not on every
    // 60s reload — refitting each reload threw away the trader's zoom.
    const key = `${bars.length ? bars[0]!.t : 0}`;
    if (fitKeyRef.current !== key) {
      fitKeyRef.current = key;
      chart.timeScale().fitContent();
    }
  }, [bars, accentUp, accentDown]);

  useEffect(() => {
    paintOverlay(bars, overlay, plan);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bars, overlay, plan]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || syncTimeMs == null) return;
    const t = Math.floor(syncTimeMs / 1000);
    try {
      chart.setCrosshairPosition(undefined as any, t as any, candleRef.current);
    } catch {
      /* ignore */
    }
  }, [syncTimeMs]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    chart.applyOptions({ height });
  }, [height]);

  return (
    <div
      ref={elRef}
      className="w-full overflow-hidden rounded-md"
      style={{ height }}
    />
  );
}
