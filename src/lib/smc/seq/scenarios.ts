/**
 * Fix 2 — scenario cards (shadow): four scripted open plays per book from the 09:25 map.
 *   S1-bear  sweep the high / a bear array above → reverse → invert a gap → draw the lower levels
 *   S2-bear  sweep a low first → gap + consolidate → retrace to the CE → reverse down (continuation lower)
 *   S1'-bull / S2'-bull mirrors.
 * Each carries its trigger (the nearest raidable on its sweep side), invalidation and draw list (real map levels).
 * Fix 7 — scenario odds: P(script) = prior (from the map: HTF/MTF stack, PD zone, expected manipulation side,
 * London sweep) × likelihood ratios per observed event, LRs fitted on the training sessions only (Laplace).
 */
import { mappedTargets, type PremarketMap } from "./premarket-map";
import { seqMode, seqItem, type Mode } from "./rules";

export type ScriptId = "S1-bear" | "S2-bear" | "S1'-bull" | "S2'-bull";
export const SCRIPTS: ScriptId[] = ["S1-bear", "S2-bear", "S1'-bull", "S2'-bull"];
export interface Scenario { id: ScriptId; sweep: "high" | "low"; dist: "down" | "up"; trigger: { name: string; price: number } | null; invalid: string; draws: { name: string; price: number }[]; prior: number }
export interface ScenarioRead { mode: Mode; symbol: string; ranked: Scenario[] }

/** Map features → prior weights (documented heuristic; fix 7 replaces them with fitted odds when a table exists). */
export function features(m: PremarketMap): string[] {
  const f: string[] = [];
  f.push(`htf:${m.biasStack.htf}`, `mtf:${m.biasStack.mtf}`, `zone:${m.zone ?? "?"}`, `expect:${m.amd.expectManip ?? "?"}`, `london:${m.amd.londonSwept ?? "none"}`);
  return f;
}
export function scenarios(m: PremarketMap | null): ScenarioRead {
  const out: ScenarioRead = { mode: seqMode("scenarios"), symbol: m?.symbol ?? "", ranked: [] };
  if (!m || m.price == null) return out;
  const px = m.price;
  const above = mappedTargets(m, "long", px)[0] ?? null, below = mappedTargets(m, "short", px)[0] ?? null;
  const bear = m.biasStack.htf === "bear" || m.biasStack.mtf === "bear";
  const bull = m.biasStack.htf === "bull" || m.biasStack.mtf === "bull";
  const base: Record<ScriptId, number> = {
    "S1-bear": 1 + (m.amd.expectManip === "high" ? 1 : 0) + (bear ? 0.5 : 0) + (m.zone === "premium" ? 0.5 : 0),
    "S2-bear": 1 + (bear ? 1 : 0) + (m.zone === "discount" ? 0.25 : 0),
    "S1'-bull": 1 + (m.amd.expectManip === "low" ? 1 : 0) + (bull ? 0.5 : 0) + (m.zone === "discount" ? 0.5 : 0),
    "S2'-bull": 1 + (bull ? 1 : 0) + (m.zone === "premium" ? 0.25 : 0),
  };
  const fitted = seqItem<Record<string, Record<string, number>>>("scenarioOdds", "lr");
  if (fitted) for (const id of SCRIPTS) for (const f of features(m)) base[id] *= fitted[f]?.[id] ?? 1;
  const tot = SCRIPTS.reduce((a, id) => a + base[id], 0);
  const mk = (id: ScriptId): Scenario => {
    const sweep = id === "S1-bear" || id === "S2'-bull" ? "high" : "low";
    const dist = id.endsWith("bear") ? "down" : "up";
    const trig = sweep === "high" ? above : below;
    return { id, sweep, dist, trigger: trig, invalid: dist === "down" ? "body close accepted above the sweep extreme" : "body close accepted below the sweep extreme", draws: mappedTargets(m, dist === "down" ? "short" : "long", px).filter((x) => x.liq).slice(0, 3), prior: +(base[id] / tot).toFixed(3) };
  };
  out.ranked = SCRIPTS.map(mk).sort((a, b) => b.prior - a.prior);
  return out;
}
/** Which script the 09:30–11:00 tape played (sweep side = the extreme printed first; dist = the close vs open). */
export function realised(rth: { t: number; o: number; h: number; l: number; c: number }[]): ScriptId | null {
  if (rth.length < 30) return null;
  const hi = rth.reduce((a, b) => (b.h > a.h ? b : a)), lo = rth.reduce((a, b) => (b.l < a.l ? b : a));
  const first = hi.t < lo.t ? "high" : "low", down = rth.at(-1)!.c < rth[0]!.o;
  return first === "high" ? (down ? "S1-bear" : "S2'-bull") : down ? "S2-bear" : "S1'-bull";
}
/** Fix 7: fit LR[feature][script] = P(f | script) / P(f) on training sessions (Laplace +1). */
export function fitLr(rows: { feats: string[]; y: ScriptId }[]): Record<string, Record<string, number>> {
  const n = rows.length, lr: Record<string, Record<string, number>> = {};
  const fs = new Set(rows.flatMap((r) => r.feats));
  for (const f of fs) {
    lr[f] = {};
    const pf = (rows.filter((r) => r.feats.includes(f)).length + 1) / (n + 2);
    for (const id of SCRIPTS) {
      const ys = rows.filter((r) => r.y === id);
      lr[f]![id] = +(((ys.filter((r) => r.feats.includes(f)).length + 1) / (ys.length + 2)) / pf).toFixed(3);
    }
  }
  return lr;
}
