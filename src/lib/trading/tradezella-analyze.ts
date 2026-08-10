/**
 * TradeZella chart / session analyzer — maps pasted stats + chart context
 * onto the Ledger / Trading-Automation system.
 *
 * AI boundary: this module SCORES and STRUCTURES. It never places orders.
 * Output is a review artifact for journal + backtest efficiency.
 */

import { APLUS_RULES } from "@/lib/aplus/config";
import { WEIGHTS, COMPONENT_KEYS, type ComponentKey } from "./engine-weights";
import { ALWAYS_SCAN, strategyLabel, type StrategyId } from "./strategies";
import {
  PROFIT_ACTION_FLOOR,
  PROFIT_A_PLUS,
  PROFIT_TARGET_WR,
} from "./profit-path";

export interface TradezellaStats {
  trades?: number;
  winRate?: number; // 0-1
  netPnl?: number;
  wins?: number;
  losses?: number;
  profitFactor?: number;
  avgWin?: number;
  avgLoss?: number;
  symbol?: string;
  sessionLabel?: string;
  dateRange?: string;
}

export interface TimeframeBias {
  tf: "HTF" | "MTF" | "LTF";
  label: string;
  bias: "bull" | "bear" | "neutral" | "unknown";
  notes: string;
}

export interface ConfluenceItem {
  key: ComponentKey | string;
  present: boolean;
  weight: number;
  note: string;
}

export interface SetupPlan {
  id: string;
  strategy: StrategyId | string;
  side: "long" | "short" | "flat";
  grade: "A+" | "A" | "B" | "skip";
  confluenceScore: number;
  entry: string;
  stop: string;
  targets: string[];
  rr: string;
  conditions: string[];
  confluencesPresent: string[];
  confluencesMissing: string[];
  invalidation: string;
  notes: string;
}

export interface TradezellaAnalysis {
  title: string;
  summary: string;
  stats: TradezellaStats;
  systemAlignment: {
    pathWrTarget: number;
    observedWr: number | null;
    wrVsTarget: string;
    selectivityNote: string;
    actionFloor: number;
    aPlusFloor: number;
  };
  timeframes: TimeframeBias[];
  conditions: {
    regime: string;
    volatility: string;
    session: string;
    news: string;
    tradeable: boolean;
    notes: string[];
  };
  confluences: ConfluenceItem[];
  strategiesHit: { id: string; label: string; why: string }[];
  setups: SetupPlan[];
  backtestChecklist: { item: string; status: "pass" | "fail" | "unknown"; detail: string }[];
  nextActions: string[];
  disclaimer: string;
  chartAttached: boolean;
  chartHint: string | null;
}

export interface AnalyzeInput {
  message: string;
  /** data URL or empty */
  imageDataUrl?: string | null;
  imageName?: string | null;
  /** optional desk snapshot strings for context */
  deskContext?: {
    htfLeft?: string;
    htfRight?: string;
    killzone?: string;
    smt?: string;
    bestSetup?: string;
  };
}

function parseStats(text: string): TradezellaStats {
  const t = text.replace(/,/g, "");
  const stats: TradezellaStats = {};

  const wr =
    t.match(/win\s*rate[:\s]*([0-9]+(?:\.[0-9]+)?)\s*%/i) ||
    t.match(/\b([0-9]+(?:\.[0-9]+)?)\s*%\s*(?:wr|win)/i) ||
    t.match(/\bWR[:\s]*([0-9]+(?:\.[0-9]+)?)\s*%/i);
  if (wr) stats.winRate = Math.min(1, Number(wr[1]) / 100);

  const trades =
    t.match(/\b([0-9]+)\s*trades?\b/i) ||
    t.match(/\btrades?[:\s]*([0-9]+)\b/i);
  if (trades) stats.trades = Number(trades[1]);

  const pnl =
    t.match(/(?:net\s*)?(?:p(?:rofit)?(?:\s*\/?\s*l(?:oss)?)?|pnl)[:\s]*\$?\s*([+-]?[0-9]+(?:\.[0-9]+)?[kKmM]?)/i) ||
    t.match(/\$\s*([+-]?[0-9]+(?:\.[0-9]+)?)\s*(?:net|pnl|profit)?/i);
  if (pnl) {
    let v = pnl[1]!.toLowerCase();
    let n = parseFloat(v);
    if (v.endsWith("k")) n *= 1000;
    if (v.endsWith("m")) n *= 1_000_000;
    stats.netPnl = n;
  }

  const pf = t.match(/profit\s*factor[:\s]*([0-9]+(?:\.[0-9]+)?)/i);
  if (pf) stats.profitFactor = Number(pf[1]);

  const wins = t.match(/\b([0-9]+)\s*wins?\b/i);
  const losses = t.match(/\b([0-9]+)\s*losses?\b/i);
  if (wins) stats.wins = Number(wins[1]);
  if (losses) stats.losses = Number(losses[1]);

  if (stats.trades && stats.winRate != null && stats.wins == null) {
    stats.wins = Math.round(stats.trades * stats.winRate);
    stats.losses = stats.trades - stats.wins;
  }

  const sym = t.match(/\b(MNQ|MES|NQ|ES|MYM|M2K|GC|CL)\b/i);
  if (sym) stats.symbol = sym[1]!.toUpperCase();

  const range =
    t.match(
      /\b((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2}(?:\s*[-–]\s*\d{1,2})?,?\s*\d{4})\b/i,
    ) || t.match(/\b(\d{4}-\d{2}-\d{2}\s*(?:to|[-–])\s*\d{4}-\d{2}-\d{2})\b/i);
  if (range) stats.dateRange = range[1];

  const session = t.match(
    /\b(NY\s*AM|NY\s*PM|London|Asia|killzone|RTH|premarket)\b/i,
  );
  if (session) stats.sessionLabel = session[1];

  return stats;
}

function inferSide(text: string): "long" | "short" | "flat" {
  const lower = text.toLowerCase();
  const longHits = (lower.match(/\b(long|buy|bull|discount|sellside sweep)\b/g) || [])
    .length;
  const shortHits = (
    lower.match(/\b(short|sell|bear|premium|buyside sweep)\b/g) || []
  ).length;
  if (longHits > shortHits) return "long";
  if (shortHits > longHits) return "short";
  return "flat";
}

function detectMentionedComponents(text: string): Set<string> {
  const lower = text.toLowerCase();
  const hits = new Set<string>();
  const map: Record<string, string[]> = {
    mechanical_model: ["mechanical", "sweep→displace", "sweep displace invert", "full model"],
    structure: ["bos", "structure", "mss", "break of structure"],
    mid_bias: ["mid bias", "15m", "mtf", "mid structure"],
    ifvg: ["ifvg", "i-fvg", "inverted fvg", "fvg"],
    smt: ["smt", "divergence", "nq/es", "nq es", "correlation"],
    sweep_significant: ["sweep", "pdh", "pdl", "pwh", "pwl", "liquidity taken", "raid"],
    htf2_bias: ["htf2", "4h", "hourly bias"],
    weekly_pd: ["weekly", "pwh", "pwl", "weekly pd"],
    order_block: ["order block", "ob ", " orderblock"],
    cisd: ["cisd", "change in state"],
    displacement: ["displacement", "impulse", "aggressive"],
    mss: ["mss", "market structure shift"],
    opening_bias: ["open", "judas", "opening range", "8:30", "9:30"],
    pd: ["premium", "discount", "equilibrium", "dealing range"],
    sponsored: ["sponsored"],
    breaker: ["breaker"],
    mitigation: ["mitigation"],
    rejection: ["rejection", "wick reject"],
    propulsion: ["propulsion"],
    daily_bias: ["daily bias", "daily", "po3"],
  };
  for (const [key, words] of Object.entries(map)) {
    if (words.some((w) => lower.includes(w))) hits.add(key);
  }
  return hits;
}

function detectStrategies(
  text: string,
  components: Set<string>,
  side: "long" | "short" | "flat",
): { id: string; label: string; why: string }[] {
  const lower = text.toLowerCase();
  const out: { id: string; label: string; why: string }[] = [];
  const add = (id: StrategyId, why: string) => {
    if (!out.some((x) => x.id === id))
      out.push({ id, label: strategyLabel(id), why });
  };

  if (components.has("mechanical_model") || /mechanical|blake/.test(lower)) {
    add("mechanical", "Ordered sweep→displace→invert→retest language present");
    add("blake_mech", "Mechanical / IFVG path");
  }
  if (
    (components.has("sweep_significant") && components.has("ifvg")) ||
    /\btjr\b/.test(lower)
  ) {
    add("tjr", "Sweep + structure/IFVG retrace (TJR model)");
  }
  if (/judas|false break|liquidity grab.*open/.test(lower) || components.has("opening_bias")) {
    add("judas", "Open/session manipulation + shift cues");
  }
  if (components.has("ifvg") && /invert|distribution|pdi/.test(lower)) {
    add("pdi", "Inverted FVG / pre-distribution cues");
  }
  if (/patty|open manip|ny open/.test(lower)) {
    add("patty", "Session open manipulation model");
  }
  if (components.has("mid_bias") || /continuation|with.?trend/.test(lower)) {
    add("continuation", "With-trend continuation language");
  }
  if (/ronan|narrative|top.?down/.test(lower) || components.has("daily_bias")) {
    add("ronan", "HTF narrative alignment");
  }
  if (components.has("smt") || /\bsmt\b/.test(lower)) {
    add("smt", "NQ↔ES divergence / relative strength");
  }
  if (!out.length && side !== "flat") {
    add("tjr", "Default review path — confirm sweep + IFVG stack on chart");
  }
  return out;
}

function scoreFromComponents(present: Set<string>): number {
  let s = 0;
  for (const k of present) {
    if (k in WEIGHTS) s += WEIGHTS[k as ComponentKey];
  }
  return Math.min(0.99, +s.toFixed(4));
}

function gradeOf(score: number): SetupPlan["grade"] {
  if (score >= PROFIT_A_PLUS) return "A+";
  if (score >= PROFIT_ACTION_FLOOR) return "A";
  if (score >= APLUS_RULES.confluenceFloor) return "B";
  return "skip";
}

/**
 * Core analyzer — works offline from text + optional chart attachment flag.
 */
export function analyzeTradezella(input: AnalyzeInput): TradezellaAnalysis {
  const message = (input.message || "").trim();
  const chartAttached = Boolean(input.imageDataUrl && input.imageDataUrl.length > 32);
  const stats = parseStats(message);
  const side = inferSide(message);
  const mentioned = detectMentionedComponents(message);

  // If chart attached but sparse text, seed expected review components
  if (chartAttached && mentioned.size < 3) {
    for (const k of [
      "structure",
      "ifvg",
      "pd",
      "sweep_significant",
      "displacement",
    ] as ComponentKey[]) {
      // mark as unknown-present for checklist weight display as review targets
      // don't auto-score as present — use separate "review" set
    }
  }

  const strategiesHit = detectStrategies(message, mentioned, side);
  const score = scoreFromComponents(mentioned);
  const grade = gradeOf(score);

  const confluences: ConfluenceItem[] = COMPONENT_KEYS.map((key) => {
    const present = mentioned.has(key);
    return {
      key,
      present,
      weight: WEIGHTS[key],
      note: present
        ? "Mentioned / inferred from your notes"
        : chartAttached
          ? "Verify on chart against this component"
          : "Not mentioned — mark on chart if present",
    };
  });

  const timeframes: TimeframeBias[] = [
    {
      tf: "HTF",
      label: "Weekly + Daily (absolute gate)",
      bias: /htf\s*bull|daily bull|weekly bull|bullish bias/i.test(message)
        ? "bull"
        : /htf\s*bear|daily bear|weekly bear|bearish bias/i.test(message)
          ? "bear"
          : input.deskContext?.htfLeft?.toLowerCase().includes("bull")
            ? "bull"
            : input.deskContext?.htfLeft?.toLowerCase().includes("bear")
              ? "bear"
              : "unknown",
      notes:
        input.deskContext?.htfLeft ||
        "Confirm Weekly+Daily structure before any LTF entry. Neutral HTF = no trade.",
    },
    {
      tf: "MTF",
      label: "4H / 1H (secondary)",
      bias: /mtf\s*bull|1h bull|4h bull/i.test(message)
        ? "bull"
        : /mtf\s*bear|1h bear|4h bear/i.test(message)
          ? "bear"
          : "unknown",
      notes: "Mid structure should not override HTF. Used for confluence only.",
    },
    {
      tf: "LTF",
      label: "15m / 5m / 1m entry",
      bias: side === "long" ? "bull" : side === "short" ? "bear" : "unknown",
      notes:
        "Entry model: sweep → displacement/MSS → IFVG/OB retest. Partial sequences = skip.",
    },
  ];

  const session =
    stats.sessionLabel ||
    input.deskContext?.killzone ||
    (/ny|london|asia/i.exec(message)?.[0] ?? "unspecified");

  const conditions = {
    regime: /chop|range|dead/i.test(message)
      ? "ranging/dead"
      : /trend|impulse|displace/i.test(message)
        ? "trending"
        : chartAttached
          ? "read from chart (ER/ATR)"
          : "unknown",
    volatility: /high\s*vol|news|spike/i.test(message)
      ? "high"
      : /low\s*vol|thin/i.test(message)
        ? "low"
        : "normal/unknown",
    session,
    news: /fomc|cpi|nfp|news/i.test(message) ? "caution/blackout check" : "clear unless calendar says otherwise",
    tradeable: !/chop|dead|blackout/i.test(message),
    notes: [
      "Condition gate precedes scoring (Trading-Automation rule 8).",
      "NY AM is the default killzone until expectancy proven elsewhere.",
      input.deskContext?.smt ? `Desk SMT: ${input.deskContext.smt}` : "Check NQ↔ES SMT at the extreme.",
    ],
  };

  const symbol = stats.symbol || "MNQ/ES";
  const setups: SetupPlan[] = [];

  if (side !== "flat" || chartAttached || message.length > 20) {
    const primary = strategiesHit[0]?.id ?? "tjr";
    const presentKeys = [...mentioned];
    const missingKeys = COMPONENT_KEYS.filter((k) => !mentioned.has(k)).slice(0, 8);

    setups.push({
      id: "primary",
      strategy: primary,
      side: side === "flat" ? (timeframes[0]!.bias === "bear" ? "short" : "long") : side,
      grade: chartAttached && mentioned.size < 2 ? "B" : grade,
      confluenceScore: score,
      entry:
        message.match(/entry[:\s]+([0-9]+(?:\.[0-9]+)?)/i)?.[1] ||
        "IFVG / OB mid in discount (long) or premium (short) — mark from chart",
      stop:
        message.match(/(?:stop|s\/l|sl)[:\s]+([0-9]+(?:\.[0-9]+)?)/i)?.[1] ||
        "Beyond sweep extreme / protected swing (never arbitrary ticks)",
      targets: [
        message.match(/(?:target|tp|t\.?p\.?)[:\s]+([0-9]+(?:\.[0-9]+)?)/i)?.[1] ||
          "TP1 = 1R",
        "TP2 = next opposing liquidity (PDH/PDL / EQH/EQL), clamp 1–3R",
      ],
      rr: "1:1 → 1:3 structure-based",
      conditions: [
        `HTF absolute gate: only with top-down bias`,
        `Session: ${session}`,
        conditions.regime,
        conditions.news,
      ],
      confluencesPresent: presentKeys,
      confluencesMissing: missingKeys,
      invalidation: "Close back beyond sweep + loss of structure — flat, no average",
      notes:
        score >= PROFIT_ACTION_FLOOR
          ? "Path-eligible if HTF+session+conditions clear and pattern complete."
          : "Below path floor (0.67) — journal as review/SKIP, do not execute for profit path.",
    });

    // Secondary: SMT dual confirmation setup if dual indexes mentioned
    if (mentioned.has("smt") || /nq|es|mnq|mes/i.test(message) || chartAttached) {
      setups.push({
        id: "smt-confirm",
        strategy: "smt",
        side: setups[0]!.side,
        grade: mentioned.has("smt") ? grade : "skip",
        confluenceScore: mentioned.has("smt") ? Math.min(0.99, score + WEIGHTS.smt) : score * 0.5,
        entry: "Only if SMT favors direction at the liquidity extreme",
        stop: "Same structural stop as primary — no wider for correlation hope",
        targets: ["Same TP ladder as primary"],
        rr: "1:1 – 1:3",
        conditions: ["Both NQ and ES structure reviewed", "No fighting HTF on either"],
        confluencesPresent: mentioned.has("smt") ? ["smt"] : [],
        confluencesMissing: mentioned.has("smt") ? [] : ["smt"],
        invalidation: "SMT resolves against you → stand down",
        notes: "SMT is confluence, not a standalone trigger without entry model.",
      });
    }
  }

  const observedWr = stats.winRate ?? null;
  const wrVsTarget =
    observedWr == null
      ? "No WR parsed — paste TradeZella WR (e.g. 64.3%) for path comparison."
      : observedWr >= PROFIT_TARGET_WR
        ? `Session WR ${(observedWr * 100).toFixed(1)}% ≥ path target 70% — still verify grades were A/A+ only.`
        : `Session WR ${(observedWr * 100).toFixed(1)}% below path 70%. Filter to A-path grades only next sample.`;

  const backtestChecklist: TradezellaAnalysis["backtestChecklist"] = [
    {
      item: "HTF Weekly+Daily gate respected",
      status: timeframes[0]!.bias === "unknown" ? "unknown" : "pass",
      detail: "Long only bull HTF, short only bear HTF, neutral = flat",
    },
    {
      item: "Killzone (NY AM default)",
      status: /ny|killzone|rth/i.test(session) ? "pass" : "unknown",
      detail: String(session),
    },
    {
      item: "Meaningful liquidity sweep",
      status: mentioned.has("sweep_significant") ? "pass" : chartAttached ? "unknown" : "fail",
      detail: "PDH/PDL/PWH/PWL/EQH/EQL — not random wicks",
    },
    {
      item: "Displacement + MSS/BOS",
      status:
        mentioned.has("displacement") || mentioned.has("mss") || mentioned.has("structure")
          ? "pass"
          : "unknown",
      detail: "Real displacement, not drift",
    },
    {
      item: "Retrace into IFVG/OB (complete model)",
      status: mentioned.has("ifvg") || mentioned.has("order_block") || mentioned.has("mechanical_model")
        ? "pass"
        : "unknown",
      detail: "Refuse partial sequences",
    },
    {
      item: "R:R in 1:1–1:3 band",
      status: "unknown",
      detail: "Structure targets clamped to band",
    },
    {
      item: "Risk ≤ 0.5% / trade",
      status: "unknown",
      detail: `Desk risk model ${APLUS_RULES.riskPct * 100}%`,
    },
    {
      item: "A-path grade only (profit path)",
      status: score >= PROFIT_ACTION_FLOOR ? "pass" : score > 0 ? "fail" : "unknown",
      detail: `Action floor ${PROFIT_ACTION_FLOOR}, A+ ${PROFIT_A_PLUS}`,
    },
  ];

  const nextActions: string[] = [];
  if (chartAttached) {
    nextActions.push(
      "On the chart: mark PDH/PDL, dealing range EQ, last BOS, and any IFVG mid — reply with those prices for a scored setup card.",
    );
  }
  if (observedWr != null && observedWr < PROFIT_TARGET_WR) {
    nextActions.push(
      "Re-grade every TradeZella trade A+/A/B/C. Drop B/C from the sample and recompute WR.",
    );
  }
  if (!mentioned.has("mechanical_model")) {
    nextActions.push(
      "Tag which trades had full mechanical sequence vs partial — partials should be SKIPs.",
    );
  }
  nextActions.push(
    "Log A-path setups only (Paper first) with strategy tags: " +
      ALWAYS_SCAN.slice(0, 5).join(", ") +
      "…",
  );
  nextActions.push(
    "If completing a backtest: one session at a time, max 2 setups/KZ, journal skips.",
  );
  if (stats.trades && stats.trades > 15) {
    nextActions.push(
      `${stats.trades} trades in window may exceed selectivity (~10–15/mo target). Flag overtrading.`,
    );
  }

  const title = chartAttached
    ? `TradeZella chart review${stats.symbol ? ` · ${stats.symbol}` : ""}${stats.dateRange ? ` · ${stats.dateRange}` : ""}`
    : `TradeZella session analysis${stats.symbol ? ` · ${stats.symbol}` : ""}`;

  const summaryParts = [
    chartAttached
      ? "Chart attached — system checklist applied; confirm levels for a hard score."
      : "Text analysis against Ledger engine rules.",
    observedWr != null
      ? `Parsed WR ${(observedWr * 100).toFixed(1)}%` +
        (stats.trades ? ` on ${stats.trades} trades` : "") +
        (stats.netPnl != null ? ` · net ~$${stats.netPnl}` : "") +
        "."
      : "No TradeZella stats parsed yet — paste WR, trade count, PnL for path math.",
    strategiesHit.length
      ? `Strategy tags: ${strategiesHit.map((s) => s.label).join(", ")}.`
      : "No strategy tags locked — describe sweep/IFVG/SMT on the chart.",
  ];

  return {
    title,
    summary: summaryParts.join(" "),
    stats,
    systemAlignment: {
      pathWrTarget: PROFIT_TARGET_WR,
      observedWr,
      wrVsTarget,
      selectivityNote:
        "Profit path executes only A/A+ (score ≥ 0.67). Incomplete IFVG+structure without displacement/MSS is vetoed.",
      actionFloor: PROFIT_ACTION_FLOOR,
      aPlusFloor: PROFIT_A_PLUS,
    },
    timeframes,
    conditions,
    confluences,
    strategiesHit,
    setups,
    backtestChecklist,
    nextActions,
    disclaimer:
      "Analysis is educational structure mapping — not an order. LLM/chat never gates live risk.",
    chartAttached,
    chartHint: chartAttached
      ? input.imageName || "chart image attached"
      : null,
  };
}

export function analysisToMarkdown(a: TradezellaAnalysis): string {
  const lines: string[] = [];
  lines.push(`## ${a.title}`);
  lines.push(a.summary);
  lines.push("");
  lines.push("### System alignment");
  lines.push(a.systemAlignment.wrVsTarget);
  lines.push(a.systemAlignment.selectivityNote);
  lines.push("");
  lines.push("### HTF / MTF / LTF");
  for (const tf of a.timeframes) {
    lines.push(
      `- **${tf.tf}** (${tf.label}): **${tf.bias}** — ${tf.notes}`,
    );
  }
  lines.push("");
  lines.push("### Conditions");
  lines.push(
    `Regime ${a.conditions.regime} · Vol ${a.conditions.volatility} · Session ${a.conditions.session} · News ${a.conditions.news}`,
  );
  lines.push("");
  lines.push("### Strategies");
  for (const s of a.strategiesHit) {
    lines.push(`- **${s.label}** — ${s.why}`);
  }
  if (!a.strategiesHit.length) lines.push("- (none locked yet)");
  lines.push("");
  lines.push("### Setups");
  for (const s of a.setups) {
    lines.push(
      `#### ${s.id} · ${s.strategy} · ${s.side.toUpperCase()} · ${s.grade} (${s.confluenceScore.toFixed(2)})`,
    );
    lines.push(`- Entry: ${s.entry}`);
    lines.push(`- Stop: ${s.stop}`);
    lines.push(`- Targets: ${s.targets.join(" · ")}`);
    lines.push(`- R:R: ${s.rr}`);
    lines.push(`- Present: ${s.confluencesPresent.join(", ") || "—"}`);
    lines.push(`- Missing: ${s.confluencesMissing.slice(0, 6).join(", ") || "—"}`);
    lines.push(`- ${s.notes}`);
    lines.push("");
  }
  lines.push("### Confluences (engine weights)");
  for (const c of a.confluences.filter((x) => x.present)) {
    lines.push(`- ✓ ${c.key} (w=${c.weight.toFixed(3)})`);
  }
  const missing = a.confluences.filter((x) => !x.present).slice(0, 8);
  for (const c of missing) {
    lines.push(`- ○ ${c.key}`);
  }
  lines.push("");
  lines.push("### Backtest checklist");
  for (const b of a.backtestChecklist) {
    lines.push(`- [${b.status}] ${b.item} — ${b.detail}`);
  }
  lines.push("");
  lines.push("### Next actions");
  for (const n of a.nextActions) lines.push(`- ${n}`);
  lines.push("");
  lines.push(`_${a.disclaimer}_`);
  return lines.join("\n");
}
