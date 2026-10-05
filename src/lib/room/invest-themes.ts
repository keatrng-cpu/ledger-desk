/**
 * The investment office's research file, with the desk's rules enforced at the door.
 *
 * `src/data/invest-themes.json` is a DATED snapshot of what industries need and who competes for it: demand facts that each
 * carry a figure, a year and a source URL, the innovations behind them, the competitors, the risks, and the listed vehicles.
 * It is context for a conversation, never a forecast and never a recommendation — the office quotes a third party's figure
 * as that party's ("IEA projects ..."), and a name only enters the book through a dossier and the ADD gate (universe.ts).
 *
 * A theme that breaks a rule is DROPPED here, not shown with a warning: a banned vehicle (the wash-sale list, universe.ts) or
 * a demand fact with no source would otherwise reach a TV in the room.
 */

import raw from "@/data/invest-themes.json";
import { WASH_SALE_BANNED } from "@/lib/invest/universe";
import type { InvestTier } from "./live-types";

export interface ThemeDemand {
  claim: string;
  figure: string;
  asOf: string;
  sourceName: string;
  source: string;
}
export interface ThemeCompetitor {
  name: string;
  ticker: string | null;
  angle: string;
}
export interface ThemeVehicle {
  ticker: string;
  kind: "fund" | "stock";
  note: string;
}
export interface ResearchTheme {
  id: string;
  name: string;
  tier: InvestTier;
  horizon: "mid" | "long";
  summary: string;
  demand: ThemeDemand[];
  innovations: string[];
  competitors: ThemeCompetitor[];
  risks: string[];
  vehicles: ThemeVehicle[];
  evidence: "strong" | "moderate" | "thin";
}
export interface ResearchFile {
  version: number;
  asOf: string;
  about: string;
  tiers: Record<InvestTier, string>;
  themes: ResearchTheme[];
}

export const RESEARCH = raw as unknown as ResearchFile;

const TIERS = new Set<string>(["safe", "mid", "high"]);
const EVIDENCE = new Set<string>(["strong", "moderate", "thin"]);
const BANNED = new Set(Object.keys(WASH_SALE_BANNED).map((t) => t.toUpperCase()));

const filled = (s: unknown): s is string => typeof s === "string" && s.trim().length > 0;

/** Why a theme may not be shown, or null when it may. */
export function themeProblem(t: ResearchTheme): string | null {
  if (!filled(t?.id) || !filled(t.name)) return "no id or name";
  if (!TIERS.has(t.tier)) return `tier "${t.tier}"`;
  if (t.horizon !== "mid" && t.horizon !== "long") return `horizon "${t.horizon}"`;
  if (!EVIDENCE.has(t.evidence)) return `evidence "${t.evidence}"`;
  if (!filled(t.summary)) return "no summary";
  if (!Array.isArray(t.demand) || !t.demand.length) return "no demand fact";
  for (const d of t.demand) {
    if (!filled(d.claim) || !filled(d.figure) || !filled(d.asOf) || !filled(d.sourceName)) return "a demand fact without a figure, a year or a source name";
    if (!filled(d.source) || !/^https:\/\//.test(d.source)) return "a demand fact without a source URL";
  }
  if (!Array.isArray(t.vehicles) || !t.vehicles.length) return "no vehicle";
  for (const v of t.vehicles) {
    if (!filled(v.ticker)) return "a vehicle without a ticker";
    if (BANNED.has(v.ticker.toUpperCase())) return `banned vehicle ${v.ticker} (wash-sale list)`;
  }
  if (!Array.isArray(t.competitors) || !t.competitors.length) return "no competitors";
  return null;
}

export function usableThemes(file: ResearchFile = RESEARCH): ResearchTheme[] {
  return (file?.themes ?? []).filter((t) => themeProblem(t) == null);
}
