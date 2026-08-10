import { useEffect, useState } from "react";
import { Bot, Loader2, RefreshCw, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  analyzeRevenue,
  offlineAnalyst,
  type InsightResult,
  type MetricsSnapshot,
} from "@/lib/ai/analyze";
import { cn } from "@/lib/utils";

interface AiInsightsProps {
  snapshot: MetricsSnapshot;
}

const postureStyles: Record<
  InsightResult["posture"],
  { label: string; className: string }
> = {
  bullish: {
    label: "Bullish",
    className: "bg-[color-mix(in_oklab,var(--color-up)_18%,transparent)] text-[var(--color-up)]",
  },
  cautious: {
    label: "Cautious",
    className:
      "bg-[color-mix(in_oklab,var(--color-down)_18%,transparent)] text-[var(--color-down)]",
  },
  neutral: {
    label: "Neutral",
    className:
      "bg-[color-mix(in_oklab,var(--color-warn)_18%,transparent)] text-[var(--color-warn)]",
  },
};

export function AiInsights({ snapshot }: AiInsightsProps) {
  const [insight, setInsight] = useState<InsightResult>(() => offlineAnalyst(snapshot));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (snap: MetricsSnapshot) => {
    setLoading(true);
    setError(null);
    // Instant offline baseline so UI never blanks
    setInsight(offlineAnalyst(snap));
    try {
      const result = await analyzeRevenue({ data: snap });
      if (result.ok) {
        setInsight(result);
      } else {
        setError(result.error);
      }
    } catch {
      // Keep offline insight
      setError(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // Debounce lightly when filters change
    const t = window.setTimeout(() => {
      void run(snapshot);
    }, 280);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-run on range identity
  }, [snapshot.from, snapshot.to, snapshot.revenue, snapshot.growth, snapshot.churn]);

  const posture = postureStyles[insight.posture];

  return (
    <Card className="border-[color-mix(in_oklab,var(--color-primary)_25%,var(--color-border))]">
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-[var(--color-primary-dim)] text-[var(--color-primary)]">
            <Bot className="h-5 w-5" aria-hidden />
          </div>
          <div>
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-[var(--color-fg)]">
              Desk analyst
              <Sparkles className="h-3.5 w-3.5 text-[var(--color-primary)]" aria-hidden />
            </CardTitle>
            <CardDescription>
              Grok-powered read with offline fallback — trading-desk style revenue notes
            </CardDescription>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "rounded-full px-2.5 py-0.5 text-[11px] font-medium uppercase tracking-wide",
              posture.className,
            )}
          >
            {posture.label}
          </span>
          <span className="rounded-full border border-[var(--color-border)] px-2 py-0.5 text-[11px] text-[var(--color-subtle)]">
            {insight.source === "grok" ? "Live Grok" : "Offline model"}
          </span>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={loading}
            onClick={() => void run(snapshot)}
            aria-label="Refresh analysis"
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
        {loading && (
          <div className="h-1 w-full overflow-hidden rounded-full bg-[var(--color-surface-3)]">
            <div className="h-full w-1/3 shimmer rounded-full bg-[var(--color-primary)]/40" />
          </div>
        )}
        <p className="text-base font-medium leading-snug tracking-tight text-[var(--color-fg)] sm:text-lg">
          {insight.headline}
        </p>
        <ul className="space-y-2.5">
          {insight.bullets.map((b, i) => (
            <li
              key={i}
              className="flex gap-2.5 text-sm leading-relaxed text-[var(--color-muted)]"
            >
              <span
                className="mt-2 h-1 w-1 shrink-0 rounded-full bg-[var(--color-primary)]"
                aria-hidden
              />
              <span>{b}</span>
            </li>
          ))}
        </ul>
        <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-4 py-3">
          <p className="text-[11px] font-medium uppercase tracking-wider text-[var(--color-subtle)]">
            Focus
          </p>
          <p className="mt-1 text-sm font-medium text-[var(--color-fg)]">{insight.focus}</p>
        </div>
        {error && (
          <p className="text-xs text-[var(--color-down)]">Live analysis unavailable: {error}</p>
        )}
      </CardContent>
    </Card>
  );
}
