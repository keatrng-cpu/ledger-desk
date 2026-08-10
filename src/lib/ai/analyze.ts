import { createServerFn } from "@tanstack/react-start";
import type { ChannelRow, SegmentRow } from "@/lib/data/sample-revenue";

export interface MetricsSnapshot {
  from: string;
  to: string;
  revenue: number;
  growth: number;
  churn: number;
  customers: number;
  newMrr: number;
  churnedMrr: number;
  arpu: number;
  topSegment: string;
  topChannel: string;
  segments: Pick<SegmentRow, "segment" | "revenue" | "growth" | "churn">[];
  channels: Pick<ChannelRow, "channel" | "revenue" | "share" | "growth">[];
}

export interface InsightResult {
  ok: true;
  source: "grok" | "offline";
  headline: string;
  bullets: string[];
  posture: "bullish" | "cautious" | "neutral";
  focus: string;
}

export interface InsightError {
  ok: false;
  error: string;
}

/** Deterministic offline analyst — always available, no network. */
export function offlineAnalyst(m: MetricsSnapshot): InsightResult {
  const posture: InsightResult["posture"] =
    m.growth >= 8 && m.churn <= 3.5
      ? "bullish"
      : m.growth < 2 || m.churn >= 5
        ? "cautious"
        : "neutral";

  const revM = (m.revenue / 1_000_000).toFixed(2);
  const headline =
    posture === "bullish"
      ? `Expansion intact: $${revM}M period revenue with ${m.growth.toFixed(1)}% half-over-half growth`
      : posture === "cautious"
        ? `Protect the base: churn at ${m.churn.toFixed(1)}% is diluting ${m.growth.toFixed(1)}% growth`
        : `Steady book: $${revM}M revenue, balanced growth and retention`;

  const bullets: string[] = [];

  if (m.growth >= 10) {
    bullets.push(
      `Momentum: second-half revenue outpaced the first half by ${m.growth.toFixed(1)}%. Treat this like a trend continuation — scale what is already working in ${m.topChannel}, not new experiments.`,
    );
  } else if (m.growth < 3) {
    bullets.push(
      `Momentum fade: growth is only ${m.growth.toFixed(1)}%. Audit new-logo velocity vs expansion; Expansion and ${m.topChannel} need a clear owner this week.`,
    );
  } else {
    bullets.push(
      `Measured climb at ${m.growth.toFixed(1)}% half-over-half. Keep risk small: one primary channel bet (${m.topChannel}) and one retention lever.`,
    );
  }

  if (m.churn >= 4.5) {
    bullets.push(
      `Churn pressure at ${m.churn.toFixed(1)}% monthly-equivalent is the hard gate — similar to standing aside on a conflicted HTF bias. Prioritize save offers in Starter/Pro before buying more top-of-funnel.`,
    );
  } else if (m.churn <= 2.5) {
    bullets.push(
      `Retention is clean (${m.churn.toFixed(1)}%). You have room to be aggressive on acquisition; net new MRR of $${Math.round(m.newMrr).toLocaleString()} is not being undone by exits.`,
    );
  } else {
    bullets.push(
      `Churn sits at ${m.churn.toFixed(1)}% — acceptable but not free. Pair every acquisition push with a 30-day health check on new cohorts.`,
    );
  }

  const weak = m.segments
    .slice()
    .sort((a, b) => b.churn - a.churn)[0];
  if (weak) {
    bullets.push(
      `Segment risk: ${weak.segment} shows ${weak.churn.toFixed(1)}% churn with ${weak.growth.toFixed(1)}% growth. That is the watchlist name — tighten onboarding or price pack before the mix shifts.`,
    );
  }

  bullets.push(
    `Book quality: ARPU ~$${Math.round(m.arpu).toLocaleString()} across ${m.customers.toLocaleString()} customers. ${m.topSegment} remains the draw on liquidity — protect attach and expansion there first.`,
  );

  const focus =
    posture === "bullish"
      ? `Double down on ${m.topChannel} + ${m.topSegment}; cap experiments at 10% of spend.`
      : posture === "cautious"
        ? `48-hour churn triage on ${weak?.segment ?? "Starter"}; freeze non-core campaigns.`
        : `Hold core plan; run one controlled test on Expansion vs ${m.topChannel}.`;

  return {
    ok: true,
    source: "offline",
    headline,
    bullets: bullets.slice(0, 4),
    posture,
    focus,
  };
}

function parseGrokJson(text: string): InsightResult | null {
  try {
    const cleaned = text
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();
    const parsed = JSON.parse(cleaned) as Partial<InsightResult>;
    if (
      typeof parsed.headline === "string" &&
      Array.isArray(parsed.bullets) &&
      parsed.bullets.every((b) => typeof b === "string")
    ) {
      return {
        ok: true,
        source: "grok",
        headline: parsed.headline,
        bullets: parsed.bullets.slice(0, 5),
        posture:
          parsed.posture === "bullish" ||
          parsed.posture === "cautious" ||
          parsed.posture === "neutral"
            ? parsed.posture
            : "neutral",
        focus:
          typeof parsed.focus === "string"
            ? parsed.focus
            : "Review the metrics above.",
      };
    }
  } catch {
    /* fall through */
  }
  return null;
}

export const analyzeRevenue = createServerFn({ method: "POST" })
  .validator((input: MetricsSnapshot) => input)
  .handler(async ({ data }): Promise<InsightResult | InsightError> => {
    const fallback = offlineAnalyst(data);
    const apiKey = process.env.XAI_API_KEY;
    if (!apiKey) return fallback;

    const prompt = `You are a senior revenue and trading-desk style growth analyst.
Analyze this SaaS metrics snapshot and respond with ONLY valid JSON (no markdown):
{
  "headline": "one sentence, no emoji",
  "bullets": ["3-4 concise action bullets", "..."],
  "posture": "bullish" | "cautious" | "neutral",
  "focus": "single next action for the operator"
}
Tone: proficient, calm, institutional — like a clean risk desk note. No fluff, no emoji.
Use trading metaphors sparingly only when they clarify risk (bias, drawdown, protect capital).
Metrics:
${JSON.stringify(data, null, 2)}`;

    try {
      const res = await fetch("https://api.x.ai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: "grok-4.5",
          temperature: 0.4,
          max_tokens: 500,
          messages: [
            {
              role: "system",
              content:
                "You write tight SaaS revenue analysis for operators. Output JSON only.",
            },
            { role: "user", content: prompt },
          ],
        }),
      });

      if (!res.ok) return fallback;
      const body = (await res.json()) as {
        choices?: { message?: { content?: string } }[];
      };
      const text = body.choices?.[0]?.message?.content ?? "";
      return parseGrokJson(text) ?? fallback;
    } catch {
      return fallback;
    }
  });
