/**
 * Fix 24 — the Master Floor seat. One narrative over the SAME shared context
 * every other seat reads (sealed card, brain, Floor, MTF, SMT, LTF kill,
 * displacement, draws, exit plan, day governor), and one word: TAKE or PASS.
 * It never relaxes a gate: every check it lists must already pass upstream.
 */
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
    reversal: string | null;
  } | null;
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
  verdict: "TAKE" | "PASS";
  narrative: string[];
  checks: { name: string; ok: boolean }[];
  failed: string[];
}

const A_BANDS = ["A+", "A", "A-"];

export function masterSeat(i: MasterInput): MasterSeat {
  const c = i.card;
  if (!c) return { verdict: "PASS", narrative: ["No card on the board."], checks: [], failed: ["no card"] };
  const want = c.side === "long" ? "bull" : "bear";
  const narrative: string[] = [];
  narrative.push(`HTF: 1h ${c.bias1h ?? "?"} · 4h ${c.bias4h ?? "?"}${c.reversal ? ` · ${c.reversal}` : ""}`);
  if (i.smtLead) narrative.push(`SMT ${i.smtLead.tf} ${i.smtLead.kind}: ${i.smtLead.leader} swept, ${i.smtLead.failing} held`);
  narrative.push(`Card: ${c.symbol} ${c.side} ${c.band ?? "?"} q ${c.q}${c.chop ? " · chop" : ""}${c.dispScore != null ? ` · displacement ${c.dispScore}` : ""}`);
  if (i.topDraw) narrative.push(`Draw: ${i.topDraw.name} ${i.topDraw.price}`);
  if (c.entry != null) narrative.push(`Plan: entry ${c.entry}${c.entryResting ? " (resting)" : ""} · stop ${c.stopPx ?? "?"} · target ${c.target ?? "?"} · ${c.rr ?? "?"}R`);
  const brainAgrees = i.brainWord === "TAKE" && i.brainBook?.symbol === c.symbol && i.brainBook?.side === c.side;
  const checks = [
    { name: "band A- or better", ok: c.band != null && A_BANDS.includes(c.band) },
    { name: i.governor === "A+ only" ? "day governor: A+ only" : "day governor", ok: i.governor === "normal" || c.band === "A+" },
    { name: "actionable", ok: c.actionable },
    { name: "brain TAKE on this book", ok: brainAgrees },
    { name: "Floor not STAND", ok: i.floorVerdict !== "STAND" },
    { name: "no LTF kill on this side", ok: !c.ltfKilled },
    { name: "MTF align ≥ 2/3", ok: (i.align ?? 0) >= 0.66 },
    { name: "not chop", ok: !c.chop },
    { name: "price at the entry", ok: c.entry != null && !c.entryResting },
    { name: "stop and target priced", ok: c.stopPx != null && c.target != null },
    { name: "R:R ≥ 1", ok: (c.rr ?? 0) >= 1 },
    { name: "displacement ≥ 0.5", ok: (c.dispScore ?? 0) >= 0.5 },
    { name: "no live shock", ok: !i.shockActive },
    { name: "HTF agrees or released", ok: Boolean(c.reversal) || (c.bias1h === want && c.bias4h !== (want === "bull" ? "bear" : "bull")) },
  ];
  const failed = checks.filter((x) => !x.ok).map((x) => x.name);
  const verdict = failed.length ? "PASS" : "TAKE";
  narrative.push(verdict === "TAKE" ? "Master: TAKE — every check passes." : `Master: PASS — ${failed.slice(0, 4).join(", ")}${failed.length > 4 ? ` +${failed.length - 4}` : ""}.`);
  return { verdict, narrative, checks, failed };
}
