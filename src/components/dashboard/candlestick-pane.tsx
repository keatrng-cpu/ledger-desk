import { useEffect, useRef } from "react";
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from "lightweight-charts";
import type { OhlcBar } from "@/lib/market/types";

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
}

function toCandleData(bars: OhlcBar[]) {
  return bars.map((b) => ({
    time: Math.floor(b.t / 1000) as UTCTimestamp,
    open: b.o,
    high: b.h,
    low: b.l,
    close: b.c,
  }));
}

function toVolumeData(bars: OhlcBar[]) {
  return bars.map((b) => ({
    time: Math.floor(b.t / 1000) as UTCTimestamp,
    value: b.v,
    color:
      b.c >= b.o ? "rgba(52, 211, 153, 0.35)" : "rgba(248, 113, 113, 0.35)",
  }));
}

function nearestBar(bars: OhlcBar[], timeMs: number): OhlcBar | null {
  if (!bars.length) return null;
  let best = bars[0]!;
  let dist = Math.abs(best.t - timeMs);
  for (let i = 1; i < bars.length; i++) {
    const b = bars[i]!;
    const d = Math.abs(b.t - timeMs);
    if (d < dist) {
      dist = d;
      best = b;
    }
  }
  if (dist > 6 * 60 * 60 * 1000) return null;
  return best;
}

export function CandlestickPane({
  bars,
  height = 280,
  onHover,
  syncTimeMs,
  accentUp = "#34d399",
  accentDown = "#f87171",
}: CandlestickPaneProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const onHoverRef = useRef(onHover);
  const barsRef = useRef(bars);
  const applyingSync = useRef(false);
  onHoverRef.current = onHover;
  barsRef.current = bars;

  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;

    const chart = createChart(el, {
      height,
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#71717a",
        fontFamily: "IBM Plex Sans, system-ui, sans-serif",
        fontSize: 11,
      },
      grid: {
        vertLines: { color: "rgba(39, 39, 42, 0.7)" },
        horzLines: { color: "rgba(39, 39, 42, 0.7)" },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: {
          color: "rgba(45, 212, 191, 0.35)",
          width: 1,
          style: 2,
          labelBackgroundColor: "#18181c",
        },
        horzLine: {
          color: "rgba(45, 212, 191, 0.35)",
          width: 1,
          style: 2,
          labelBackgroundColor: "#18181c",
        },
      },
      rightPriceScale: {
        borderColor: "#27272a",
        scaleMargins: { top: 0.08, bottom: 0.22 },
      },
      timeScale: {
        borderColor: "#27272a",
        timeVisible: true,
        secondsVisible: false,
      },
      localization: {
        priceFormatter: (p: number) =>
          p >= 1000
            ? p.toLocaleString("en-US", { maximumFractionDigits: 2 })
            : p.toFixed(2),
      },
    });

    const candles = chart.addSeries(CandlestickSeries, {
      upColor: accentUp,
      downColor: accentDown,
      borderUpColor: accentUp,
      borderDownColor: accentDown,
      wickUpColor: accentUp,
      wickDownColor: accentDown,
    });

    const volume = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "vol",
    });
    chart.priceScale("vol").applyOptions({
      scaleMargins: { top: 0.82, bottom: 0 },
    });

    chartRef.current = chart;
    candleRef.current = candles;
    volumeRef.current = volume;

    chart.subscribeCrosshairMove((param) => {
      if (applyingSync.current) return;
      const cb = onHoverRef.current;
      if (!cb) return;
      if (!param.time || !param.seriesData) {
        cb(null);
        return;
      }
      const d = param.seriesData.get(candles) as
        | {
            open: number;
            high: number;
            low: number;
            close: number;
            time: UTCTimestamp;
          }
        | undefined;
      if (!d) {
        cb(null);
        return;
      }
      const t =
        typeof param.time === "number"
          ? param.time * 1000
          : Date.parse(String(param.time)) || 0;
      cb({ time: t, o: d.open, h: d.high, l: d.low, c: d.close });
    });

    const ro = new ResizeObserver(() => {
      if (el.clientWidth > 0) {
        chart.applyOptions({ width: el.clientWidth });
      }
    });
    ro.observe(el);

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      candleRef.current = null;
      volumeRef.current = null;
    };
  }, [height, accentUp, accentDown]);

  useEffect(() => {
    if (!candleRef.current || !volumeRef.current || !chartRef.current) return;
    if (!bars.length) {
      candleRef.current.setData([]);
      volumeRef.current.setData([]);
      return;
    }
    candleRef.current.setData(toCandleData(bars));
    volumeRef.current.setData(toVolumeData(bars));
    chartRef.current.timeScale().fitContent();
  }, [bars]);

  useEffect(() => {
    const chart = chartRef.current;
    const series = candleRef.current;
    if (!chart || !series) return;
    if (syncTimeMs == null) {
      applyingSync.current = true;
      chart.clearCrosshairPosition();
      applyingSync.current = false;
      return;
    }
    const bar = nearestBar(barsRef.current, syncTimeMs);
    if (!bar) return;
    applyingSync.current = true;
    try {
      chart.setCrosshairPosition(
        bar.c,
        Math.floor(bar.t / 1000) as UTCTimestamp,
        series,
      );
    } catch {
      /* ignore */
    }
    // Release after paint so user moves still propagate
    requestAnimationFrame(() => {
      applyingSync.current = false;
    });
  }, [syncTimeMs]);

  return (
    <div
      ref={hostRef}
      className="w-full"
      style={{ height }}
      role="img"
      aria-label="Candlestick chart"
    />
  );
}
