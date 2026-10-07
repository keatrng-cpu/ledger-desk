import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  GitCompareArrows,
  Loader2,
  Radio,
  RefreshCw,
  TrendingUp,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  CandlestickPane,
  type CandleHover,
} from "@/components/dashboard/candlestick-pane";
import {
  fetchDualIndexes,
  fetchLiveQuotes,
  type DualRangeKey,
} from "@/lib/market/fetch-dual";
import type {
  DualIndexPayload,
  IndexSymbol,
  LiveQuote,
  MarketSource,
} from "@/lib/market/types";
import {
  formatExchangeClock,
  formatUtcClock,
  normalizedPct,
} from "@/lib/market/yahoo";
import { cn, formatPct } from "@/lib/utils";
import { feedTone } from "@/lib/ui/feed-tone";
import type { DeskPayload } from "@/lib/trading/build-desk";
import { buildChartOverlay } from "@/lib/trading/chart-overlay";
import { chartFrameClass, useBiasFlip } from "@/lib/trading/use-bias-flip";

/** Poll Yahoo last-print every 2s while visible. */
const QUOTE_POLL_MS = 2000;
/** Full bar reload cadence (heavier). */
const BARS_RELOAD_MS = 60_000;

const RANGES: { id: DualRangeKey; label: string }[] = [
  { id: "1d", label: "1D" },
  { id: "5d", label: "5D" },
  { id: "1mo", label: "1M" },
  { id: "3mo", label: "3M" },
];

const PAIRS: { left: IndexSymbol; right: IndexSymbol; label: string }[] = [
  { left: "MNQ", right: "ES", label: "MNQ / ES" },
  { left: "NQ", right: "ES", label: "NQ / ES" },
];

function fmtPrice(n: number) {
  return n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function SourceBadge({ source }: { source: MarketSource }) {
  return (
    <span
      className={cn(
        "rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide",
        source === "live_gateway"
          ? "border-[color-mix(in_oklab,var(--color-up)_55%,var(--color-border))] text-[var(--color-up)]"
          : source === "databento"
            ? "border-[color-mix(in_oklab,var(--color-up)_40%,var(--color-border))] text-[var(--color-up)]"
            : source === "yahoo"
              ? "border-[color-mix(in_oklab,var(--color-primary)_40%,var(--color-border))] text-[var(--color-primary)]"
              : "border-[var(--color-border)] text-[var(--color-subtle)]",
      )}
    >
      {source === "live_gateway"
        ? "Live tick"
        : source === "databento"
          ? "Databento"
          : source === "yahoo"
            ? "Yahoo print"
            : "Synthetic"}
    </span>
  );
}

function LiveClock({
  quote,
  wallNowMs,
}: {
  quote: LiveQuote | null;
  wallNowMs: number;
}) {
  if (!quote) {
    return (
      <p className="font-mono text-[10px] tabular text-[var(--color-subtle)]">
        — awaiting print —
      </p>
    );
  }
  const liveLag = Math.max(
    0,
    Math.round((wallNowMs - quote.marketTimeMs) / 1000),
  );
  // Source first (same helper as the header feed dot): SYN/Y! never green;
  // unknown → red. SYN stamps marketTimeMs=now so lag-only colour lied.
  const printTone = feedTone([quote.source], liveLag);

  return (
    <div className="space-y-0.5 font-mono text-[10px] tabular leading-tight text-[var(--color-subtle)]">
      <p>
        <span className="text-[var(--color-muted)]">Print </span>
        {formatExchangeClock(quote.marketTimeMs, quote.timezone)}
        <span className="text-[var(--color-subtle)]"> ET</span>
      </p>
      <p>
        <span className="text-[var(--color-muted)]">UTC </span>
        {formatUtcClock(quote.marketTimeMs)}
      </p>
      <p>
        <span className="text-[var(--color-muted)]">Fetched </span>
        {formatUtcClock(quote.fetchedAtMs)}
        <span
          className={cn("ml-1.5 inline-block h-1.5 w-1.5 rounded-full align-middle", printTone.className)}
          title={`${printTone.title} · print delay ${liveLag}s`}
          aria-label={printTone.label}
        />
      </p>
    </div>
  );
}

function SymbolHeader({
  symbol,
  label,
  quote,
  fallbackPrice,
  fallbackChange,
  source,
  hover,
  wallNowMs,
  flash,
}: {
  symbol: string;
  label: string;
  quote: LiveQuote | null;
  fallbackPrice: number;
  fallbackChange: number;
  source: MarketSource;
  hover: CandleHover | null;
  wallNowMs: number;
  flash: "up" | "down" | null;
}) {
  const price = quote?.price ?? fallbackPrice;
  const changePct = quote?.changePct ?? fallbackChange;
  const up = changePct >= 0;
  return (
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h4 className="font-mono text-sm font-semibold tracking-tight text-[var(--color-fg)]">
            {symbol}
          </h4>
          <SourceBadge source={quote?.source ?? source} />
        </div>
        <p className="mt-0.5 text-xs text-[var(--color-subtle)]">{label}</p>
        <div className="mt-1.5">
          <LiveClock quote={quote} wallNowMs={wallNowMs} />
        </div>
      </div>
      <div className="text-right">
        <p
          className={cn(
            "font-mono text-xl font-semibold tabular transition-colors duration-150 sm:text-2xl",
            flash === "up" && "text-[var(--color-up)]",
            flash === "down" && "text-[var(--color-down)]",
            !flash && "text-[var(--color-fg)]",
          )}
        >
          {fmtPrice(hover?.c ?? price)}
        </p>
        <p
          className={cn(
            "font-mono text-xs tabular",
            up ? "text-[var(--color-up)]" : "text-[var(--color-down)]",
          )}
        >
          {quote
            ? `${quote.change >= 0 ? "+" : ""}${quote.change.toFixed(2)} (${formatPct(changePct)})`
            : formatPct(changePct)}
        </p>
        {quote?.dayHigh != null && quote.dayLow != null && (
          <p className="mt-0.5 font-mono text-[10px] tabular text-[var(--color-subtle)]">
            D {fmtPrice(quote.dayLow)} – {fmtPrice(quote.dayHigh)}
          </p>
        )}
        {hover && (
          <p className="mt-0.5 font-mono text-[10px] tabular text-[var(--color-subtle)]">
            O {fmtPrice(hover.o)} · H {fmtPrice(hover.h)} · L{" "}
            {fmtPrice(hover.l)}
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * Overlay + plan for one pane, from the live desk, if the desk trades this
 * symbol. The Charts tab keeps its own bar payload (its own ranges and
 * pairs); the SMC markup comes from the desk's 15m read and is drawn onto
 * whatever bars this pane shows — the levels are prices, not bars.
 */
function paneMarkup(desk: DeskPayload | null | undefined, symbol: string, bars: DualIndexPayload["left"]["bars"]) {
  if (!desk) return { overlay: null, plan: null };
  const overlay = buildChartOverlay(desk, symbol, bars);
  const book =
    desk.smcMaster.left.symbol === symbol
      ? desk.smcMaster.left
      : desk.smcMaster.right.symbol === symbol
        ? desk.smcMaster.right
        : null;
  return { overlay, plan: book?.plan ?? null };
}

/** Tiny inline sparkline (no axes). */
function Spark({ values, color, min, max, zero }: { values: Array<number | null | undefined>; color: string; min?: number; max?: number; zero?: boolean }) {
  const v = values.filter((x): x is number => x != null && Number.isFinite(x));
  if (v.length < 2) return <span className="h-6 w-24" aria-hidden />;
  const lo = min ?? Math.min(...v, zero ? 0 : Infinity);
  const hi = max ?? Math.max(...v, zero ? 0 : -Infinity);
  const W = 96;
  const H = 24;
  const y = (x: number) => (hi === lo ? H / 2 : H - ((x - lo) / (hi - lo)) * H);
  const step = W / (v.length - 1);
  const d = v.map((x, i) => `${i ? "L" : "M"}${(i * step).toFixed(1)},${y(x).toFixed(1)}`).join("");
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="ml-auto shrink-0" aria-hidden>
      {zero && lo < 0 && hi > 0 && <line x1="0" x2={W} y1={y(0)} y2={y(0)} stroke="var(--color-border-strong)" strokeDasharray="2 2" />}
      <path d={d} fill="none" stroke={color} strokeWidth="1.5" />
    </svg>
  );
}

/**
 * Rolling Pearson ρ of bar-to-bar changes over exactly `win` closed bars.
 * Returns null for a window when either side has zero variance (flat) — callers
 * show "n/a", never ρ=0. Needs win+1 price points to form `win` returns.
 */
/** Bar duration for dual-index Yahoo intervals — matches fetch-dual RANGE_CFG. */
function barMsForInterval(interval: string): number {
  switch (interval) {
    case "1m":
      return 60_000;
    case "2m":
      return 2 * 60_000;
    case "5m":
      return 5 * 60_000;
    case "15m":
      return 15 * 60_000;
    case "30m":
      return 30 * 60_000;
    case "60m":
    case "1h":
      return 60 * 60_000;
    case "1d":
      return 24 * 60 * 60_000;
    default:
      return 0;
  }
}

function rollingCorr(rows: { left: number; right: number }[], win: number): (number | null)[] {
  const dl: number[] = [];
  const dr: number[] = [];
  for (let i = 1; i < rows.length; i++) {
    dl.push(rows[i]!.left - rows[i - 1]!.left);
    dr.push(rows[i]!.right - rows[i - 1]!.right);
  }
  const out: (number | null)[] = [];
  for (let i = win; i <= dl.length; i++) {
    const a = dl.slice(i - win, i);
    const b = dr.slice(i - win, i);
    const ma = a.reduce((x, y) => x + y, 0) / win;
    const mb = b.reduce((x, y) => x + y, 0) / win;
    let num = 0;
    let va = 0;
    let vb = 0;
    for (let k = 0; k < win; k++) {
      num += (a[k]! - ma) * (b[k]! - mb);
      va += (a[k]! - ma) ** 2;
      vb += (b[k]! - mb) ** 2;
    }
    // Flat window → n/a (not ρ=0).
    out.push(va > 0 && vb > 0 ? num / Math.sqrt(va * vb) : null);
  }
  return out;
}

export function DualIndexCharts({ desk = null }: { desk?: DeskPayload | null }) {
  const [rangeKey, setRangeKey] = useState<DualRangeKey>("1d");
  const [pairIdx, setPairIdx] = useState(0);
  const [payload, setPayload] = useState<DualIndexPayload | null>(null);
  const [leftQuote, setLeftQuote] = useState<LiveQuote | null>(null);
  const [rightQuote, setRightQuote] = useState<LiveQuote | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [polling, setPolling] = useState(true);
  const [leftHover, setLeftHover] = useState<CandleHover | null>(null);
  const [rightHover, setRightHover] = useState<CandleHover | null>(null);
  const [wallNowMs, setWallNowMs] = useState(() => Date.now());
  const [leftFlash, setLeftFlash] = useState<"up" | "down" | null>(null);
  const [rightFlash, setRightFlash] = useState<"up" | "down" | null>(null);

  const pair = PAIRS[pairIdx]!;

  const loadBars = useCallback(async () => {
    setLoading(true);
    setError(null);
    setLeftHover(null);
    setRightHover(null);
    try {
      const res = await fetchDualIndexes({
        data: {
          rangeKey,
          left: pair.left,
          right: pair.right,
        },
      });
      if (!res.ok) {
        setError(res.error);
        setPayload(null);
      } else {
        setPayload(res);
        setLeftQuote(res.quotes.left);
        setRightQuote(res.quotes.right);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Load failed");
      setPayload(null);
    } finally {
      setLoading(false);
    }
  }, [rangeKey, pair.left, pair.right]);

  const pollQuotes = useCallback(async () => {
    try {
      const res = await fetchLiveQuotes({
        data: { left: pair.left, right: pair.right },
      });
      if (!res.ok) return;

      setLeftQuote((prev) => {
        if (prev && res.left.price !== prev.price) {
          const dir = res.left.price > prev.price ? "up" : "down";
          queueMicrotask(() => {
            setLeftFlash(dir);
            window.setTimeout(() => setLeftFlash(null), 350);
          });
        }
        return res.left;
      });
      setRightQuote((prev) => {
        if (prev && res.right.price !== prev.price) {
          const dir = res.right.price > prev.price ? "up" : "down";
          queueMicrotask(() => {
            setRightFlash(dir);
            window.setTimeout(() => setRightFlash(null), 350);
          });
        }
        return res.right;
      });

      setPayload((p) => {
        if (!p) return p;
        return {
          ...p,
          fetchedAt: res.fetchedAt,
          fetchedAtMs: res.fetchedAtMs,
          left: {
            ...p.left,
            price: res.left.price,
            changePct: res.left.changePct,
            marketTimeMs: res.left.marketTimeMs,
            marketTimeIso: res.left.marketTimeIso,
          },
          right: {
            ...p.right,
            price: res.right.price,
            changePct: res.right.changePct,
            marketTimeMs: res.right.marketTimeMs,
            marketTimeIso: res.right.marketTimeIso,
          },
          quotes: { left: res.left, right: res.right },
          comparison: {
            ...p.comparison,
            leftRet: res.left.changePct,
            rightRet: res.right.changePct,
            spreadRet: res.left.changePct - res.right.changePct,
          },
        };
      });
    } catch {
      /* keep last good quotes */
    }
  }, [pair.left, pair.right]);

  useEffect(() => {
    void loadBars();
  }, [loadBars]);

  useEffect(() => {
    const id = window.setInterval(() => setWallNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (!polling) return;
    let cancelled = false;
    const tick = () => {
      if (cancelled || document.visibilityState === "hidden") return;
      void pollQuotes();
    };
    tick();
    const id = window.setInterval(tick, QUOTE_POLL_MS);
    const onVis = () => {
      if (document.visibilityState === "visible") tick();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      cancelled = true;
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [polling, pollQuotes]);

  useEffect(() => {
    if (!polling) return;
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") void loadBars();
    }, BARS_RELOAD_MS);
    return () => window.clearInterval(id);
  }, [polling, loadBars]);

  const leftMarkup = useMemo(
    () => (payload ? paneMarkup(desk, payload.left.symbol, payload.left.bars) : { overlay: null, plan: null }),
    [desk, payload],
  );
  const rightMarkup = useMemo(
    () => (payload ? paneMarkup(desk, payload.right.symbol, payload.right.bars) : { overlay: null, plan: null }),
    [desk, payload],
  );

  // The same red/green frame as the Now tab's setup chart, per pane.
  const leftFlip = useBiasFlip(
    desk?.fetchedAt ?? "",
    payload?.left.symbol ?? "",
    leftMarkup.overlay?.topDown ?? "neutral",
    leftMarkup.plan?.side ?? null,
  );
  const rightFlip = useBiasFlip(
    desk?.fetchedAt ?? "",
    payload?.right.symbol ?? "",
    rightMarkup.overlay?.topDown ?? "neutral",
    rightMarkup.plan?.side ?? null,
  );
  const leftWarn = leftMarkup.overlay?.warn.active ? leftMarkup.overlay.warn.reason : leftFlip?.reason ?? null;
  const rightWarn = rightMarkup.overlay?.warn.active ? rightMarkup.overlay.warn.reason : rightFlip?.reason ?? null;
  const leftFrame = chartFrameClass({ warn: leftWarn != null, take: leftMarkup.overlay?.flashTake ?? false });
  const rightFrame = chartFrameClass({ warn: rightWarn != null, take: rightMarkup.overlay?.flashTake ?? false });

  const relData = useMemo(() => {
    if (!payload) return [];
    const L = normalizedPct(payload.left.bars);
    const R = normalizedPct(payload.right.bars);
    const mapR = new Map(R.map((p) => [p.t, p.v]));
    const rows: { t: number; label: string; left: number; right: number }[] =
      [];
    for (const p of L) {
      const rv = mapR.get(p.t);
      if (rv == null) continue;
      const d = new Date(p.t);
      const label =
        payload.interval === "1d"
          ? d.toISOString().slice(5, 10)
          : // ET, not UTC — every rule on this desk is written in ET.
            `${d.toLocaleString("en-US", { timeZone: "America/New_York", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).replace(",", "")} ET`;
      rows.push({
        t: p.t,
        label,
        left: +p.v.toFixed(3),
        right: +rv.toFixed(3),
      });
    }
    if (rows.length > 240) {
      const step = Math.ceil(rows.length / 240);
      return rows.filter((_, i) => i % step === 0 || i === rows.length - 1);
    }
    return rows;
  }, [payload]);

  /**
   * Rolling ρ window: UNTHINNED % levels, CLOSED bars only, raw (not rounded)
   * so 1m changes are not quantized away. Drops the last bar only while it is
   * still forming (same rule as session ρ / alignedReturnPairs in yahoo.ts);
   * when the market is closed the last bar is kept. Exactly 60 return pairs;
   * flat windows and short histories → n/a.
   */
  const rollingRho = useMemo(() => {
    if (!payload) return { series: [] as (number | null)[], latest: null as number | null, n: 0 };
    const L = normalizedPct(payload.left.bars);
    const R = normalizedPct(payload.right.bars);
    const mapR = new Map(R.map((p) => [p.t, p.v]));
    const rows: { t: number; left: number; right: number }[] = [];
    for (const p of L) {
      const rv = mapR.get(p.t);
      if (rv == null) continue;
      rows.push({ t: p.t, left: p.v, right: rv });
    }
    // Exclude the forming (last) bar only while it is still open.
    const barMs = barMsForInterval(payload.interval);
    const nowMs = payload.fetchedAtMs;
    let closed = rows;
    if (rows.length > 0 && barMs > 0 && nowMs < rows[rows.length - 1]!.t + barMs) {
      closed = rows.slice(0, -1);
    }
    const series = rollingCorr(closed, 60);
    const latest = series.length ? series[series.length - 1]! : null;
    return { series, latest, n: closed.length };
  }, [payload]);

  return (
    <Card className="overflow-hidden border-[color-mix(in_oklab,var(--color-primary)_18%,var(--color-border))]">
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-[var(--color-primary-dim)] text-[var(--color-primary)]">
            <GitCompareArrows className="h-5 w-5" aria-hidden />
          </div>
          <div>
            <CardTitle className="flex flex-wrap items-center gap-2 text-sm font-medium text-[var(--color-fg)]">
              Dual index desk — MNQ mini vs ES
              {polling && (
                <span className="inline-flex items-center gap-1 rounded-full border border-[color-mix(in_oklab,var(--color-up)_35%,var(--color-border))] px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-[var(--color-up)]">
                  <Radio className="h-3 w-3 animate-pulse" aria-hidden />
                  Live · {QUOTE_POLL_MS / 1000}s
                </span>
              )}
            </CardTitle>
            <CardDescription>
              Yahoo continuous CME prints · second-precision print time · poll
              every {QUOTE_POLL_MS / 1000}s · free feed may lag the pit
            </CardDescription>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div
            className="inline-flex rounded-[var(--radius-sm)] border border-[var(--color-border)] p-0.5"
            role="group"
            aria-label="Index pair"
          >
            {PAIRS.map((p, i) => (
              <button
                key={p.label}
                type="button"
                onClick={() => setPairIdx(i)}
                className={cn(
                  "min-h-8 rounded-[calc(var(--radius-sm)-2px)] px-2.5 text-xs font-medium transition-colors",
                  pairIdx === i
                    ? "bg-[var(--color-surface-3)] text-[var(--color-fg)]"
                    : "text-[var(--color-muted)] hover:text-[var(--color-fg)]",
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
          <div
            className="inline-flex rounded-[var(--radius-sm)] border border-[var(--color-border)] p-0.5"
            role="group"
            aria-label="Chart range"
          >
            {RANGES.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => setRangeKey(r.id)}
                className={cn(
                  "min-h-8 min-w-9 rounded-[calc(var(--radius-sm)-2px)] px-2 text-xs font-medium transition-colors",
                  rangeKey === r.id
                    ? "bg-[var(--color-surface-3)] text-[var(--color-fg)]"
                    : "text-[var(--color-muted)] hover:text-[var(--color-fg)]",
                )}
              >
                {r.label}
              </button>
            ))}
          </div>
          <Button
            type="button"
            variant={polling ? "secondary" : "outline"}
            size="sm"
            onClick={() => setPolling((v) => !v)}
            aria-pressed={polling}
          >
            <Radio className="h-3.5 w-3.5" />
            {polling ? "Live on" : "Live off"}
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={loading}
            onClick={() => void loadBars()}
            aria-label="Refresh market data"
          >
            {loading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            Refresh
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {loading && !payload && (
          <div className="flex h-48 items-center justify-center gap-2 text-sm text-[var(--color-muted)]">
            <Loader2 className="h-4 w-4 animate-spin text-[var(--color-primary)]" />
            Loading dual indexes…
          </div>
        )}

        {error && !payload && (
          <p className="rounded-[var(--radius-md)] border border-[var(--color-down)]/30 bg-[color-mix(in_oklab,var(--color-down)_8%,transparent)] px-4 py-3 text-sm text-[var(--color-down)]">
            {error}
          </p>
        )}

        {payload && (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2 font-mono text-[11px] tabular text-[var(--color-subtle)]">
              <span>
                Wall{" "}
                <span className="text-[var(--color-fg)]">
                  {formatUtcClock(wallNowMs)}
                </span>
              </span>
              {/* The print delay is written once: the header's feed dot. */}
              <span>
                Bars {payload.interval} · reload {BARS_RELOAD_MS / 1000}s
              </span>
            </div>

            {/* Session moves, spread and correlation as ONE header strip with
                sparklines (spread = L% − R% per bar; ρ sparkline = rolling
                60-bar correlation of bar returns, from the same bars). */}
            <div className="flex flex-wrap items-stretch divide-x divide-[var(--color-border)] overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-2)]">
              {[
                { k: `${payload.left.symbol}`, v: leftQuote?.changePct ?? payload.comparison.leftRet, series: relData.map((r) => r.left) },
                { k: `${payload.right.symbol}`, v: rightQuote?.changePct ?? payload.comparison.rightRet, series: relData.map((r) => r.right) },
              ].map((x) => (
                <div key={x.k} className="flex min-w-[9rem] flex-1 items-center gap-2 px-3 py-1.5">
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-[var(--color-subtle)]">{x.k} session</p>
                    <p className={cn("font-mono text-sm font-semibold tabular", x.v >= 0 ? "text-[var(--color-up)]" : "text-[var(--color-down)]")}>
                      {formatPct(x.v)}
                    </p>
                  </div>
                  <Spark values={x.series} color={x.v >= 0 ? "var(--color-up)" : "var(--color-down)"} />
                </div>
              ))}
              {(() => {
                const sp = (leftQuote?.changePct ?? payload.comparison.leftRet) - (rightQuote?.changePct ?? payload.comparison.rightRet);
                return (
                  <div className="flex min-w-[9rem] flex-1 items-center gap-2 px-3 py-1.5" title="Spread = left % − right % from the first common bar">
                    <div>
                      <p className="text-[10px] uppercase tracking-wider text-[var(--color-subtle)]">Spread L−R</p>
                      <p className={cn("font-mono text-sm font-semibold tabular", sp >= 0 ? "text-[var(--color-up)]" : "text-[var(--color-down)]")}>{formatPct(sp)}</p>
                    </div>
                    <Spark values={relData.map((r) => r.left - r.right)} color="var(--color-primary)" zero />
                  </div>
                );
              })()}
              <div
                className="flex min-w-[9rem] flex-1 items-center gap-2 px-3 py-1.5"
                title={`Session ρ = correlation over the selected range. Sparkline = rolling Pearson ρ of bar-to-bar % changes over exactly 60 CLOSED (unthinned) bars; forming last bar dropped only while still open. n/a when either window is flat or fewer than 60 closed return pairs (need 61 closed bars). Latest rolling: ${rollingRho.latest == null ? "n/a" : rollingRho.latest.toFixed(2)} · closed bars ${rollingRho.n}.`}
              >
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-[var(--color-subtle)]">Correlation ρ</p>
                  <p className="font-mono text-sm font-semibold tabular text-[var(--color-fg)]">
                    {payload.comparison.corr == null ? "—" : payload.comparison.corr.toFixed(2)}
                  </p>
                  <p className="font-mono text-[9px] text-[var(--color-subtle)]" title="Rolling 60 closed-bar ρ (unthinned); n/a if flat or &lt;60">
                    roll 60 {rollingRho.latest == null ? "n/a" : rollingRho.latest.toFixed(2)}
                  </p>
                </div>
                <Spark values={rollingRho.series} color="var(--color-accent)" min={-1} max={1} />
              </div>
            </div>

            <div className="flex items-start gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2.5">
              <TrendingUp
                className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-primary)]"
                aria-hidden
              />
              <p className="text-sm leading-relaxed text-[var(--color-muted)]">
                {payload.comparison.note}
                <span className="mt-1 block font-mono text-[11px] text-[var(--color-subtle)]">
                  {payload.interval} · {payload.left.count}+
                  {payload.right.count} bars · last poll{" "}
                  {leftQuote
                    ? formatUtcClock(leftQuote.fetchedAtMs)
                    : payload.fetchedAt}
                  {loading ? " · reloading bars…" : ""}
                </span>
              </p>
            </div>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <div className={cn("rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg)]/40 p-3 sm:p-4", leftFrame)}>
                {leftWarn && (
                  <p role="alert" className="mb-2 rounded-[var(--radius-sm)] bg-[color-mix(in_oklab,var(--color-down)_14%,transparent)] px-2 py-1 text-xs font-medium text-[var(--color-down)]">
                    {leftWarn}
                  </p>
                )}
                {!leftWarn && leftMarkup.overlay?.word === "TAKE" && (
                  <p className="mb-2 rounded-[var(--radius-sm)] bg-[color-mix(in_oklab,var(--color-up)_14%,transparent)] px-2 py-1 text-xs font-semibold text-[var(--color-up)]">
                    TAKE — {leftMarkup.overlay.missing}
                  </p>
                )}
                <SymbolHeader
                  symbol={payload.left.symbol}
                  label={payload.left.label}
                  quote={leftQuote}
                  fallbackPrice={payload.left.price}
                  fallbackChange={payload.left.changePct}
                  source={payload.left.source}
                  hover={leftHover}
                  wallNowMs={wallNowMs}
                  flash={leftFlash}
                />
                <div className="mt-3">
                  <CandlestickPane
                    bars={payload.left.bars}
                    height={300}
                    onHover={setLeftHover}
                    syncTimeMs={rightHover?.time ?? null}
                    {...leftMarkup}
                  />
                </div>
              </div>
              <div className={cn("rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg)]/40 p-3 sm:p-4", rightFrame)}>
                {rightWarn && (
                  <p role="alert" className="mb-2 rounded-[var(--radius-sm)] bg-[color-mix(in_oklab,var(--color-down)_14%,transparent)] px-2 py-1 text-xs font-medium text-[var(--color-down)]">
                    {rightWarn}
                  </p>
                )}
                {!rightWarn && rightMarkup.overlay?.word === "TAKE" && (
                  <p className="mb-2 rounded-[var(--radius-sm)] bg-[color-mix(in_oklab,var(--color-up)_14%,transparent)] px-2 py-1 text-xs font-semibold text-[var(--color-up)]">
                    TAKE — {rightMarkup.overlay.missing}
                  </p>
                )}
                <SymbolHeader
                  symbol={payload.right.symbol}
                  label={payload.right.label}
                  quote={rightQuote}
                  fallbackPrice={payload.right.price}
                  fallbackChange={payload.right.changePct}
                  source={payload.right.source}
                  hover={rightHover}
                  wallNowMs={wallNowMs}
                  flash={rightFlash}
                />
                <div className="mt-3">
                  <CandlestickPane
                    bars={payload.right.bars}
                    height={300}
                    onHover={setRightHover}
                    syncTimeMs={leftHover?.time ?? null}
                    {...rightMarkup}
                  />
                </div>
              </div>
            </div>

            <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg)]/40 p-3 sm:p-4">
              <div className="mb-2">
                <p className="text-sm font-medium text-[var(--color-fg)]">
                  Relative performance
                </p>
                <p className="text-xs text-[var(--color-subtle)]">
                  % from first common bar — divergences are SMT candidates
                </p>
              </div>
              <div className="h-[200px] sm:h-[220px]">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart
                    data={relData}
                    margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
                  >
                    <CartesianGrid
                      stroke="#27272a"
                      strokeDasharray="3 3"
                      vertical={false}
                    />
                    <XAxis
                      dataKey="label"
                      tick={{ fill: "#71717a", fontSize: 10 }}
                      axisLine={false}
                      tickLine={false}
                      minTickGap={36}
                    />
                    <YAxis
                      tick={{ fill: "#71717a", fontSize: 10 }}
                      axisLine={false}
                      tickLine={false}
                      tickFormatter={(v) => `${Number(v).toFixed(1)}%`}
                      width={48}
                    />
                    <Tooltip
                      contentStyle={{
                        background: "#18181c",
                        border: "1px solid #3f3f46",
                        borderRadius: 8,
                        fontSize: 12,
                      }}
                      formatter={(value: number, name: string) => [
                        `${value.toFixed(2)}%`,
                        name,
                      ]}
                    />
                    <Legend
                      wrapperStyle={{ fontSize: 12, color: "#a1a1aa" }}
                      iconType="circle"
                      iconSize={8}
                    />
                    <Line
                      type="monotone"
                      dataKey="left"
                      name={payload.left.symbol}
                      stroke="#2dd4bf"
                      strokeWidth={2}
                      dot={false}
                      isAnimationActive={false}
                    />
                    <Line
                      type="monotone"
                      dataKey="right"
                      name={payload.right.symbol}
                      stroke="#60a5fa"
                      strokeWidth={2}
                      dot={false}
                      isAnimationActive={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
