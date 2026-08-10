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
} from "@/lib/market/types";
import {
  formatExchangeClock,
  formatUtcClock,
  normalizedPct,
} from "@/lib/market/yahoo";
import { cn, formatPct } from "@/lib/utils";

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

function SourceBadge({ source }: { source: "yahoo" | "synthetic" }) {
  return (
    <span
      className={cn(
        "rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide",
        source === "yahoo"
          ? "border-[color-mix(in_oklab,var(--color-up)_40%,var(--color-border))] text-[var(--color-up)]"
          : "border-[var(--color-border)] text-[var(--color-subtle)]",
      )}
    >
      {source === "yahoo" ? "Yahoo print" : "Synthetic"}
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
  const lagColor =
    liveLag <= 5
      ? "text-[var(--color-up)]"
      : liveLag <= 60
        ? "text-[var(--color-warn)]"
        : "text-[var(--color-down)]";

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
        <span className={cn("ml-1.5 font-medium", lagColor)}>
          lag {liveLag}s
        </span>
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
  source: "yahoo" | "synthetic";
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

export function DualIndexCharts() {
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
          : `${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")} ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
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

  const maxLag = Math.max(
    leftQuote ? Math.round((wallNowMs - leftQuote.marketTimeMs) / 1000) : 0,
    rightQuote ? Math.round((wallNowMs - rightQuote.marketTimeMs) / 1000) : 0,
  );

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
              <span>
                Max print lag{" "}
                <span
                  className={cn(
                    "font-semibold",
                    maxLag <= 5
                      ? "text-[var(--color-up)]"
                      : maxLag <= 60
                        ? "text-[var(--color-warn)]"
                        : "text-[var(--color-down)]",
                  )}
                >
                  {maxLag}s
                </span>
                <span className="text-[var(--color-subtle)]">
                  {" "}
                  (Yahoo last trade vs now)
                </span>
              </span>
              <span>
                Bars {payload.interval} · reload {BARS_RELOAD_MS / 1000}s
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2.5">
                <p className="text-[10px] font-medium uppercase tracking-wider text-[var(--color-subtle)]">
                  {payload.left.symbol} session
                </p>
                <p
                  className={cn(
                    "mt-0.5 font-mono text-base font-semibold tabular",
                    (leftQuote?.changePct ?? payload.comparison.leftRet) >= 0
                      ? "text-[var(--color-up)]"
                      : "text-[var(--color-down)]",
                  )}
                >
                  {formatPct(
                    leftQuote?.changePct ?? payload.comparison.leftRet,
                  )}
                </p>
              </div>
              <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2.5">
                <p className="text-[10px] font-medium uppercase tracking-wider text-[var(--color-subtle)]">
                  {payload.right.symbol} session
                </p>
                <p
                  className={cn(
                    "mt-0.5 font-mono text-base font-semibold tabular",
                    (rightQuote?.changePct ?? payload.comparison.rightRet) >= 0
                      ? "text-[var(--color-up)]"
                      : "text-[var(--color-down)]",
                  )}
                >
                  {formatPct(
                    rightQuote?.changePct ?? payload.comparison.rightRet,
                  )}
                </p>
              </div>
              <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2.5">
                <p className="text-[10px] font-medium uppercase tracking-wider text-[var(--color-subtle)]">
                  Spread (L−R)
                </p>
                <p
                  className={cn(
                    "mt-0.5 font-mono text-base font-semibold tabular",
                    (leftQuote?.changePct ?? payload.comparison.leftRet) -
                      (rightQuote?.changePct ?? payload.comparison.rightRet) >=
                      0
                      ? "text-[var(--color-up)]"
                      : "text-[var(--color-down)]",
                  )}
                >
                  {formatPct(
                    (leftQuote?.changePct ?? payload.comparison.leftRet) -
                      (rightQuote?.changePct ?? payload.comparison.rightRet),
                  )}
                </p>
              </div>
              <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2.5">
                <p className="text-[10px] font-medium uppercase tracking-wider text-[var(--color-subtle)]">
                  Correlation ρ
                </p>
                <p className="mt-0.5 font-mono text-base font-semibold tabular text-[var(--color-fg)]">
                  {payload.comparison.corr == null
                    ? "—"
                    : payload.comparison.corr.toFixed(2)}
                </p>
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
              <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg)]/40 p-3 sm:p-4">
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
                  />
                </div>
              </div>
              <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg)]/40 p-3 sm:p-4">
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
