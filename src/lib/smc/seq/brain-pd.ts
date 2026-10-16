/** Brain step 8 (rules brainPd): premium/discount at the ENTRY via pdLeg on the card's OWN book. Non-gating (≤ +nudgeMax), shadow by default. */
import type { DeskPayload } from "@/lib/trading/build-desk";
import type { OhlcBar } from "@/lib/market/types";
import RULES from "../../../../shared/desk-rules.json";
import { closedByFeed, feedClockRead } from "../smc-unity";
import { pdLegRead } from "./pd-leg";

const BP = (RULES as unknown as { brainPd: { mode: string; nudgeMax: number } }).brainPd;
export const brainPdLive = (): boolean => BP.mode === "live";
type Zone = "premium" | "discount" | "equilibrium";
export interface BrainPdRead { mode: "live" | "shadow"; book: string; ownSide: "left" | "right"; legacyBook: "left"; pd_cur: number | null; pd_ent: number | null;
  zoneCur: Zone | null; zoneEnt: Zone | null; nudge: number; gating: false; applied: number }
const code = (z: Zone | null, side: "long" | "short") => (z == null ? null : z === (side === "short" ? "premium" : "discount") ? 0.5 : z === "equilibrium" ? -0.25 : -0.5);
/** nudge = +nudgeMax only when the ENTRY is in the aligned half; 0 otherwise (never negative, never a reason). applied = nudge in live, 0 in shadow. */
export function brainPdNudge(pdEnt: number | null, mode = BP.mode): { nudge: number; applied: number } {
  const n = pdEnt != null && pdEnt > 0 ? Math.min(0.1, BP.nudgeMax) : 0;
  return { nudge: n, applied: mode === "live" ? n : 0 };
}
export function brainPdRead(i: { desk: DeskPayload; side: "long" | "short"; own: "left" | "right"; poi: number | null; zoneCur: Zone | null; legacyBook: "left" }): BrainPdRead {
  const minute = ((i.desk.mtf?.[i.own]?.minute) ?? []) as OhlcBar[];
  const q = i.desk.quotes[i.own] as { price: number | null; marketTimeMs?: number | null };
  const fc = feedClockRead(minute, q.marketTimeMs ?? null);
  const pl = pdLegRead({ side: i.side, poi: i.poi, price: q.price, closed1m: closedByFeed(minute, 60_000, fc.feedNowMs), feedNowMs: fc.feedNowMs, legacyFail: false });
  const pdEnt = code(pl.atPoi?.zone ?? null, i.side);
  const nz = brainPdNudge(pdEnt);
  return { mode: BP.mode === "live" ? "live" : "shadow", book: String(i.desk[i.own].symbol), ownSide: i.own, legacyBook: i.legacyBook, pd_cur: code(i.zoneCur, i.side), pd_ent: pdEnt,
    zoneCur: i.zoneCur, zoneEnt: pl.atPoi?.zone ?? null, nudge: nz.nudge, gating: false, applied: nz.applied };
}
