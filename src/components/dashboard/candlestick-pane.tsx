import { useEffect, useRef } from "react";
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

/**
 * Client-only candlestick pane (lightweight-charts is browser/canvas).
 * Dynamic-imports the lib so SSR never resolves it.
 */
export function CandlestickPane({
  bars,
  height = 280,
  onHover,
  syncTimeMs,
  accentUp = "#22c55e",
  accentDown = "#ef4444",
}: CandlestickPaneProps) {
  const elRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<any>(null);
  const candleRef = useRef<any>(null);
  const volRef = useRef<any>(null);
  const onHoverRef = useRef(onHover);
  onHoverRef.current = onHover;

  useEffect(() => {
    if (typeof window === "undefined" || !elRef.current) return;
    let disposed = false;
    let chart: any;

    (async () => {
      const lwc = await import("lightweight-charts");
      if (disposed || !elRef.current) return;
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
        timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false },
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

      if (bars.length) {
        candle.setData(toCandleData(bars) as any);
        vol.setData(toVolumeData(bars, accentUp + "99", accentDown + "99") as any);
        chart.timeScale().fitContent();
      }

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
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const candle = candleRef.current;
    const vol = volRef.current;
    const chart = chartRef.current;
    if (!candle || !vol || !chart || !bars.length) return;
    candle.setData(toCandleData(bars) as any);
    vol.setData(toVolumeData(bars, accentUp + "99", accentDown + "99") as any);
    chart.timeScale().fitContent();
  }, [bars, accentUp, accentDown]);

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
