/**
 * Fix 24 — the Master Floor seat. One narrative over the SAME shared context
 * every other seat reads (sealed card, brain, Floor, MTF, SMT, LTF kill,
 * displacement, draws, exit plan, day governor), and one word: TAKE or PASS.
 * It never relaxes a gate: every check it lists must already pass upstream.
 */
import { rule1D70Line } from "@/lib/trading/rule1-d70";

export interface MasterInput {
  card: {
    symbol: string;
    side: string;
    band: string | null;
    q: number;
    actionable: boolean;
    entry: number | null;
    entryResting: boolean;
    stopPx: number | null;
    target: number | null;
    rr: number | null;
    chop: boolean;
    bias1h: string | null;
    bias4h: string | null;
    dispScore: number | null;
    ltfKilled: boolean;
    /** qv2-1015 shadow score, read-only (the seat never decides on it). */
    qV2?: { q: number; band: string; vetoed: boolean } | null;
    reversal: string | null;
  } | null;
  /** Rule 1 shadow tickets (read-only; the brain/Floor seat shows and logs them, never decides on them). */
  rule1?: import("@/lib/trading/rule1").Rule1Ticket[];
  brainWord: string | null;
  brainBook: { symbol: string; side: string | null } | null;
  floorVerdict: string;
  align: number | null;
  smtLead: { tf: string; kind: string; leader: string; failing: string } | null;
  shockActive: boolean;
  topDraw: { name: string; price: number } | null;
  governor: "normal" | "A+ only";
}

export interface MasterSeat {
  /**
   * TAKE: every critical and safety check passes. WAIT: the card is alive but
   * a critical check is open. SKIP: no card, a skip/C card, an LTF kill on
   * this side, or the brain opposes it. (R3-a: "PASS" read as "passes".)
   */
  verdict: "TAKE" | "WAIT" | "SKIP";
  narrative: string[];
  checks: { name: string; ok: boolean; tier: "critical" | "safety" | "caution" }[];
  failed: string[];
  cautions: string[];
}

const A_BANDS = ["A+", "A", "A-"];

export function masterSeat(i: MasterInput): MasterSeat {
  const c = i.card;
  if (!c) return { verdict: "SKIP", narrative: ["No card on the board."], checks: [], failed: ["no card"], cautions: [] };
  const want = c.side === "long" ? "bull" : "bear";
  const narrative: string[] = [];
  narrative.push(`HTF: 1h ${c.bias1h ?? "?"} · 4h ${c.bias4h ?? "?"}${c.reversal ? ` · ${c.reversal}` : ""}`);
  if (i.smtLead) narrative.push(`SMT ${i.smtLead.tf} ${i.smtLead.kind}: ${i.smtLead.leader} swept, ${i.smtLead.failing} held`);
  narrative.push(`Card: ${c.symbol} ${c.side} ${c.band ?? "?"} q ${c.q}${c.chop ? " · chop" : ""}${c.dispScore != null ? ` · displacement ${c.dispScore}` : ""}`);
  narrative.push(`Brain on this book: ${i.brainWord ?? "?"}${i.brainBook ? ` (${i.brainBook.symbol} ${i.brainBook.side ?? "-"})` : ""}`);
  for (const t of i.rule1 ?? []) if (t.ticketD70) narrative.push(rule1D70Line(t));   // shadow Δ0.7 ticket (overnight-1016 #1); display only, no check
  if (i.topDraw) narrative.push(`Draw: ${i.topDraw.name} ${i.topDraw.price}`);
  narrative.push(c.entry != null ? `Plan: entry ${c.entry}${c.entryResting ? " (resting)" : ""} · stop ${c.stopPx ?? "?"} · target ${c.target ?? "?"} · ${c.rr ?? "?"}R` : "Plan: no priced entry yet");
  const sameBook = i.brainBook?.symbol === c.symbol;
  const brainOpposes = sameBook && (i.brainWord === "STAND" || (i.brainBook!.side != null && i.brainBook!.side !== c.side));
  const checks: MasterSeat["checks"] = [
    { name: "band A- or better", ok: c.band != null && A_BANDS.includes(c.band), tier: "critical" },
    { name: "price at the entry", ok: c.entry != null && !c.entryResting, tier: "critical" },
    { name: "stop and target priced", ok: c.stopPx != null && c.target != null, tier: "critical" },
    { name: "R:R ≥ 1", ok: (c.rr ?? 0) >= 1, tier: "critical" },
    { name: "brain not opposing", ok: !brainOpposes, tier: "critical" },
    { name: "no LTF kill on this side", ok: !c.ltfKilled, tier: "safety" },
    { name: i.governor === "A+ only" ? "day governor: A+ only" : "day governor", ok: i.governor === "normal" || c.band === "A+", tier: "safety" },
    { name: "no live shock", ok: !i.shockActive, tier: "safety" },
    { name: "Floor not STAND", ok: i.floorVerdict !== "STAND", tier: "safety" },
    { name: "actionable", ok: c.actionable, tier: "safety" },
    { name: "brain TAKE", ok: i.brainWord === "TAKE" && sameBook, tier: "caution" },
    { name: "MTF align ≥ 2/3", ok: (i.align ?? 0) >= 0.66, tier: "caution" },
    { name: "not chop", ok: !c.chop, tier: "caution" },
    { name: "displacement ≥ 0.5", ok: (c.dispScore ?? 0) >= 0.5, tier: "caution" },
    { name: "HTF agrees or released", ok: Boolean(c.reversal) || (c.bias1h === want && c.bias4h !== (want === "bull" ? "bear" : "bull")), tier: "caution" },
  ];
  const failed = checks.filter((x) => !x.ok && x.tier !== "caution").map((x) => x.name);
  const cautions = checks.filter((x) => !x.ok && x.tier === "caution").map((x) => x.name);
  const dead = !c.band || c.band === "C" || c.ltfKilled || brainOpposes;
  const verdict: MasterSeat["verdict"] = failed.length === 0 ? "TAKE" : dead ? "SKIP" : "WAIT";
  narrative.push(
    verdict === "TAKE"
      ? `Master: TAKE${cautions.length ? ` — cautions: ${cautions.join(", ")}` : " — clean"}.`
      : `Master: ${verdict} — ${failed.slice(0, 4).join(", ")}${failed.length > 4 ? ` +${failed.length - 4}` : ""}.`,
  );
  return { verdict, narrative, checks, failed, cautions };
}
