/**
 * B+ needs Brain TAKE (Keaton 2026-10-16 09:37 CT, scope +09:41 / +09:43 CT: hard minQ / no-veto list). shared/desk-rules.json fire.bplusBrainTake.
 * A B+ card, and an A- card downsized to B+ sizing by the one-step HTF cap, fire live only when Brain says TAKE on the
 * exact same symbol and side. A-/A/A+ at their own size are unchanged. Twin of the watcher's Watcher._bplus_brain_ok
 * (refusal code bplus_brain_agree). Pure; desk card, Brain note and Floor text all read this one answer.
 */
import RULES from "../../../shared/desk-rules.json";

type Hard = { maxPerDay?: number; noneAfterLoss?: boolean; minQ?: number; noFloorBlocks?: boolean; bplusCaution?: boolean; noBrainVeto?: boolean; brainTake?: boolean };
type Rule = { mode?: string; bands?: string[]; htfCappedFrom?: string[]; word?: string; matchSymbolSide?: boolean; nearMissPromoted?: boolean; hard?: Hard };
export const BPLUS_BRAIN_RULE: Rule = ((RULES as { fire?: { bplusBrainTake?: Rule } }).fire?.bplusBrainTake) ?? {};
export const BPLUS_BRAIN_CODE = "bplus_brain_agree";
export const BPLUS_BRAIN_HOLD_PREFIX = "B+ needs Brain TAKE";

const normBand = (b: string | null | undefined) => String(b ?? "").replace("−", "-");
const book = (s: string | null | undefined) => (/ES|SPY/i.test(String(s ?? "")) ? "ES" : /NQ|QQQ/i.test(String(s ?? "")) ? "NQ" : String(s ?? "").toUpperCase());

export interface BplusBrainInput {
  band: string | null | undefined;
  /** true when the one-step HTF cap (loss.htf 1h/4h against) downsized this card's size. */
  htfCapped?: boolean;
  symbol: string | null | undefined;
  side: "long" | "short" | string | null | undefined;
  brainWord: string | null | undefined;
  brainSymbol?: string | null;
  brainSide?: string | null;
  /** Card promoted to B+ by the near-miss rule (fire.nearMissPct). */
  nearMissPromoted?: boolean;
  /** Fit q of the card (hard minQ). Unknown = blocked. */
  q?: number | null;
  /** Floor blocks on the card (any = hard block). */
  floorBlocks?: readonly string[];
  /** bplus_caution result when known (watcher gate). false = hard block; undefined = not evaluated on this side. */
  bplusCautionOk?: boolean;
  /** B+-sized entries already taken today (ET) and whether a trade lost today. undefined = not known on this side
   * (the desk does not hold the watcher's day ledger); null = known-unknown -> fails closed. */
  bplusEntriesToday?: number | null;
  lostToday?: boolean | null;
}

/** Does the rule apply to this card (B+, or A- capped to B+ size by HTF)? */
export function bplusBrainApplies(i: Pick<BplusBrainInput, "band" | "htfCapped" | "nearMissPromoted">): boolean {
  const r = BPLUS_BRAIN_RULE;
  if (r.mode !== "live") return false;
  const b = normBand(i.band);
  return (r.bands ?? []).includes(b) || (!!i.htfCapped && (r.htfCappedFrom ?? []).includes(b)) || (r.nearMissPromoted !== false && !!(i as BplusBrainInput).nearMissPromoted);
}

export function bplusBrainGate(i: BplusBrainInput): { fireable: boolean; reason: string | null } {
  if (!bplusBrainApplies(i)) return { fireable: true, reason: null };
  const r = BPLUS_BRAIN_RULE;
  const want = (r.word ?? "TAKE").toUpperCase();
  const what = normBand(i.band) === "B+" ? "B+" : i.nearMissPromoted && !i.htfCapped ? `${normBand(i.band)} near-miss promoted to B+` : `${normBand(i.band)} capped to B+ size by 1h/4h`;
  const h = r.hard ?? {};
  const no = (why: string) => ({ fireable: false, reason: `${BPLUS_BRAIN_HOLD_PREFIX}: ${what} is not fireable — ${why}.` });
  if (i.bplusEntriesToday !== undefined || i.lostToday !== undefined) {
    const nb = i.bplusEntriesToday, lost = i.lostToday;
    if (typeof nb !== "number" || typeof lost !== "boolean") return no(`day B+ count/loss unknown (fail closed)`);
    if (h.maxPerDay != null && nb >= h.maxPerDay) return no(`B+ entries today ${nb}/${h.maxPerDay}`);
    if (h.noneAfterLoss && lost) return no("a trade lost today (no B+ after a loss)");
  }
  if (h.minQ != null && !(typeof i.q === "number" && i.q >= h.minQ)) return no(`fit q ${typeof i.q === "number" ? i.q.toFixed(2) : "unknown"} < ${h.minQ.toFixed(2)}`);
  if (h.noFloorBlocks && (i.floorBlocks?.length ?? 0) > 0) return no(`Floor block: ${i.floorBlocks![0]}`);
  if (h.bplusCaution && i.bplusCautionOk === false) return no("bplus_caution failed");
  const word = String(i.brainWord ?? "").toUpperCase();
  if (h.noBrainVeto && word === "STAND") return no("Brain veto (STAND)");
  if (h.noBrainVeto && i.brainSide && i.side && String(i.brainSide).toLowerCase() !== String(i.side).toLowerCase()) return no(`Brain veto (Brain is ${i.brainSide})`);
  if (word !== want) return { fireable: false, reason: `${BPLUS_BRAIN_HOLD_PREFIX}: ${what} is not fireable — Brain is ${word || "silent"}, not ${want}.` };
  if (r.matchSymbolSide !== false) {
    if (!i.brainSymbol || !i.brainSide) return { fireable: false, reason: `${BPLUS_BRAIN_HOLD_PREFIX}: ${what} is not fireable — Brain TAKE names no symbol/side.` };
    if (book(i.brainSymbol) !== book(i.symbol) || String(i.brainSide).toLowerCase() !== String(i.side).toLowerCase()) {
      return { fireable: false, reason: `${BPLUS_BRAIN_HOLD_PREFIX}: ${what} is not fireable — Brain TAKE is ${i.brainSymbol} ${i.brainSide}, card is ${i.symbol} ${i.side}.` };
    }
  }
  return { fireable: true, reason: null };
}
