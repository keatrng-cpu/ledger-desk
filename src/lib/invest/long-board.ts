/**
 * The long board — the Now tab's card, on a year clock.
 *
 * A card ranks a name. It does not buy one. `canAdd` in universe.ts is still
 * the only gate that may say a name is allowed, and this file never calls a
 * broker. Pass means the dossier, the capture, and the sleeve rule agree.
 * Wait means a fact is missing. Fail means the name is banned.
 *
 * The 25 names are a research universe for data-center power, the grid, fuel,
 * compute, the building, listed space, and health, plus the two safety names
 * the book already holds. SMR developers are researched and left off: a new
 * reactor design is not a contracted fleet.
 */

import { dossierFor } from "./dossiers";
import { durabilityFor } from "./durability";
import { impliedGrowth, qualityRead } from "./factors";
import { SLEEVE_TARGET_USD } from "./policy";
import {
  canAdd,
  fundamentalsFor,
  snapshotCapturedAt,
  washSaleBan,
  type Fundamentals,
} from "./universe";

export type LongBook = "safety" | "growth";
export type LongSleeve = "safety" | "power" | "grid" | "fuel" | "compute" | "building" | "space" | "health";
export type LongState = "pass" | "wait" | "fail";

export interface LongName {
  ticker: string;
  name: string;
  book: LongBook;
  sleeve: LongSleeve;
  role: string;
  /** The contracted or installed fact. A theme sentence is not this. */
  evidence: string;
  kill: string;
  competitor: string;
  source: string;
  sourceDate: string;
  /** Starts on watch even before a dossier exists. */
  watch?: { reason: string; clearsWhen: string };
}

export const SLEEVE_CAP = 0.33;
export const NAME_CAP = 0.08;
export const CAPTURE_MAX_DAYS = 45;

export const LONG_NAMES: LongName[] = [
  { ticker: "VTI", name: "Vanguard Total Stock Market", book: "safety", sleeve: "safety", role: "Ballast. The return the book does not try to out-think.", evidence: "Total US market. The wash-sale swap for the indexes the sleeve trades.", kill: "None — a fund. Do not add QQQ or SPY beside it.", competitor: "ITOT", source: "desk dossier", sourceDate: "2026-09-26" },
  { ticker: "SGOV", name: "0-3 month Treasuries", book: "safety", sleeve: "safety", role: "Dry powder. The place a sweep waits.", evidence: "T-bills. No business risk.", kill: "None.", competitor: "BIL", source: "desk dossier", sourceDate: "2026-09-26" },
  { ticker: "CEG", name: "Constellation Energy", book: "growth", sleeve: "power", role: "Largest US nuclear fleet. Operator, not a developer.", evidence: "About 22 GW nuclear. Multi-year PPAs with Microsoft and Meta; a Google deal was reported this week.", kill: "A forced outage at more than one site, or a PPA cancelled.", competitor: "VST", source: "Motley Fool fleet note; MarketWatch 2026-10-08", sourceDate: "2026-10-08" },
  { ticker: "VST", name: "Vistra", book: "growth", sleeve: "power", role: "Nuclear and gas in ERCOT and PJM.", evidence: "20-year AWS PPA and a 2,609 MW Meta PPA. DOE loan for uprates announced this week.", kill: "Hedge book stops covering the fleet, or the Meta/AWS years are cut.", competitor: "CEG", source: "Motley Fool; MarketWatch 2026-10-08", sourceDate: "2026-10-08" },
  { ticker: "TLN", name: "Talen Energy", book: "growth", sleeve: "power", role: "Nuclear next to a data-center campus.", evidence: "Susquehanna nuclear, sold to a hyperscaler campus rather than to the grid alone.", kill: "The campus contract is rejected or the plant is down past a refuel.", competitor: "CEG", source: "nuclear-fleet comparison, 2026-09-16", sourceDate: "2026-09-16" },
  { ticker: "ETN", name: "Eaton", book: "growth", sleeve: "grid", role: "Switchgear and the electrical room.", evidence: "Electrical Americas orders and backlog. The kit between the plant and the rack.", kill: "Orders roll over for two quarters, or capex eats the cash.", competitor: "GEV", source: "Vestorvia chain note 2026-09-13", sourceDate: "2026-09-13" },
  { ticker: "GEV", name: "GE Vernova", book: "growth", sleeve: "grid", role: "Turbines and grid equipment.", evidence: "Gas turbines and grid gear on the same order book as the data-center build.", kill: "Backlog cancellation, or a turbine slot given away.", competitor: "ETN", source: "power-chain notes, 2026-09-30", sourceDate: "2026-09-30" },
  { ticker: "PWR", name: "Quanta Services", book: "growth", sleeve: "grid", role: "The crews who build the lines.", evidence: "Contracted transmission and distribution construction. Labor, not a story.", kill: "Backlog stops converting, or a safety stoppage.", competitor: "ETN", source: "grid-buildout notes, 2026-09-30", sourceDate: "2026-09-30" },
  { ticker: "VRT", name: "Vertiv", book: "growth", sleeve: "grid", role: "Power and cooling inside the hall.", evidence: "Orders and backlog for the room the racks sit in.", kill: "A guide cut, or capex above operating cash.", competitor: "ETN", source: "Vestorvia 2026-09-13", sourceDate: "2026-09-13" },
  { ticker: "CCJ", name: "Cameco", book: "growth", sleeve: "fuel", role: "Uranium mining and fuel services.", evidence: "Fuel for a fleet that already runs. Not a new reactor.", kill: "A contract year is deferred, or the mine is down.", competitor: "BWXT", source: "BNN nuclear set, 2026-10-09", sourceDate: "2026-10-09" },
  { ticker: "BWXT", name: "BWX Technologies", book: "growth", sleeve: "fuel", role: "Reactor components and naval nuclear.", evidence: "Installed component work for reactors that already exist.", kill: "A program slip past two quarters.", competitor: "CCJ", source: "nuclear-supply notes", sourceDate: "2026-10-08" },
  { ticker: "WMB", name: "Williams", book: "growth", sleeve: "fuel", role: "The gas pipe that feeds the plant.", evidence: "Interstate gas lines, now also tied to data-center power.", kill: "A permitted project is denied.", competitor: "CEG", source: "BNN 2026-10-09", sourceDate: "2026-10-09" },
  { ticker: "NVDA", name: "Nvidia", book: "growth", sleeve: "compute", role: "The accelerator. Same bet as the options sleeve.", evidence: "The chip the halls are built for. Overlaps the sleeve, so it sits under the cap.", kill: "Export rule, or a guide cut. Sleeve overlap is a wait by itself.", competitor: "AVGO", source: "desk concentration set", sourceDate: "2026-10-09" },
  { ticker: "AVGO", name: "Broadcom", book: "growth", sleeve: "compute", role: "Custom accelerator and the network.", evidence: "Custom silicon and switching for the same halls.", kill: "A custom program cancelled. Sleeve overlap.", competitor: "NVDA", source: "desk concentration set", sourceDate: "2026-10-09" },
  { ticker: "TSM", name: "TSMC", book: "growth", sleeve: "compute", role: "The foundry.", evidence: "The plant that prints the chip. A different geography from the sleeve.", kill: "A node slip, or a cross-strait stoppage.", competitor: "ASML", source: "compute chain", sourceDate: "2026-10-09" },
  { ticker: "ASML", name: "ASML", book: "growth", sleeve: "compute", role: "The machine that prints the chip.", evidence: "The only EUV tool. Installed base, not a model.", kill: "An export ban on the tool.", competitor: "TSM", source: "compute chain", sourceDate: "2026-10-09" },
  { ticker: "EQIX", name: "Equinix", book: "growth", sleeve: "building", role: "The halls, leased.", evidence: "Rent, power available, and occupancy. A building, not a model.", kill: "Occupancy falls, or power cannot be delivered to a campus.", competitor: "DLR", source: "data-center REIT set", sourceDate: "2026-10-09" },
  { ticker: "DLR", name: "Digital Realty", book: "growth", sleeve: "building", role: "The other hall landlord.", evidence: "Wholesale campuses. Same job as EQIX, different tenant mix.", kill: "A hyperscaler takes the campus back in house.", competitor: "EQIX", source: "data-center REIT set", sourceDate: "2026-10-09" },
  { ticker: "SPCX", name: "SpaceX", book: "growth", sleeve: "space", role: "Listed launch and Starlink. New.", evidence: "Reported listed as SPCX, with Barclays coverage on 2026-10-09. A listing article is not a gate.", kill: "A launch failure, or dilution. Starts on watch.", competitor: "RKLB", source: "TipRanks / Barclays 2026-10-09", sourceDate: "2026-10-09", watch: { reason: "Newly listed. No captured fundamentals row and no dossier.", clearsWhen: "A captured fundamentals row and a complete dossier, and share count not rising." } },
  { ticker: "RKLB", name: "Rocket Lab", book: "growth", sleeve: "space", role: "Listed launch and spacecraft.", evidence: "Electron launch book and spacecraft. High multiple, so it starts on watch.", kill: "A launch failure, or share count up.", competitor: "SPCX", source: "Barclays initiation 2026-10-09", sourceDate: "2026-10-09", watch: { reason: "High-multiple launcher. Dilution is the kill until the count is flat.", clearsWhen: "Share count flat for a year and a complete dossier." } },
  { ticker: "LLY", name: "Eli Lilly", book: "growth", sleeve: "health", role: "The drug franchise.", evidence: "An installed prescription base. Cash that does not depend on a data-center cycle.", kill: "A trial failure on the lead franchise, or a price rule.", competitor: "ISRG", source: "health sleeve", sourceDate: "2026-10-09" },
  { ticker: "ISRG", name: "Intuitive Surgical", book: "growth", sleeve: "health", role: "The installed surgical base.", evidence: "Systems already in hospitals. Procedure growth, not a story.", kill: "Procedure growth stalls for two quarters.", competitor: "LLY", source: "health sleeve", sourceDate: "2026-10-09" },

  { ticker: "ETR", name: "Entergy", book: "growth", sleeve: "power", role: "Southeast utility where the campuses are being built.", evidence: "Regulated spend in the region taking data-center load. A slower cash flow than a merchant fleet.", kill: "The rate case does not recover the build.", competitor: "CEG", source: "BNN data-center power set, 2026-10-09", sourceDate: "2026-10-09" },
  { ticker: "ANET", name: "Arista Networks", book: "growth", sleeve: "compute", role: "The switch in the hall.", evidence: "Networking for the same rooms Eaton and Vertiv power. Overlaps the compute cycle, not the option underlier.", kill: "A cloud capex pause that cuts switching orders.", competitor: "AVGO", source: "compute chain", sourceDate: "2026-10-09" },
  { ticker: "UNH", name: "UnitedHealth", book: "growth", sleeve: "health", role: "The payer.", evidence: "Premiums. A different cash flow from power and chips.", kill: "A medical-cost ratio that breaks the plan.", competitor: "LLY", source: "health sleeve", sourceDate: "2026-10-09" },
];

/** Researched, and left off the featured list on purpose. */
export const LEFT_OFF: { area: string; why: string }[] = [
  { area: "SMR developers (OKLO, SMR)", why: "A new reactor design. The fleet note prefers plants that already run." },
  { area: "Water and waste (AWK, WM)", why: "Durable, and not this chain. They stay a note so the board does not become a second index." },
  { area: "Defense primes", why: "A budget cycle, not a contracted power year." },
  { area: "QQQ, SPY, VOO, IVV", why: "Banned while the sleeve trades QQQ and SPY options." },
];

export const SLEEVE_ORDER: LongSleeve[] = ["safety", "power", "grid", "fuel", "compute", "building", "space", "health"];

export interface LongCard {
  name: LongName;
  state: LongState;
  /** The one reason, the way the brain prints the one missing layer. */
  reason: string;
  implied: string;
  quality: string;
  fresh: string;
  price: string;
  drawdown: string;
  trend: string;
  capex: string;
  dilution: string;
  overlap: string;
  shares: string;
  source: string;
}

const COMPUTE_OVERLAP = new Set(["NVDA", "AVGO", "AMD", "MSFT", "AAPL", "GOOGL", "META", "TSM", "ASML"]);

function ageDays(asOf: string, today: string): number | null {
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${today}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((b - a) / 86_400_000);
}

export function gradeLongCard(
  name: LongName,
  opts: { last?: number | null; lastAt?: string | null; today?: string; weight?: number } = {},
): LongCard {
  const today = opts.today ?? new Date().toISOString().slice(0, 10);
  const ban = washSaleBan(name.ticker);
  const dossier = dossierFor(name.ticker);
  const fund = fundamentalsFor(name.ticker);
  const dur = durabilityFor(name.ticker);
  const growth = impliedGrowth(fund);
  const quality = qualityRead(fund);
  const waits: string[] = [];
  let state: LongState = "pass";

  if (ban) {
    state = "fail";
    waits.push(`Banned. ${ban}`);
  }
  if (name.watch) waits.push(name.watch.reason);
  if (!dossier) waits.push("No dossier. The scanner does not buy a name the gate has not read.");
  else if (dossier.watch) waits.push(dossier.watch.reason);
  else if (dossier.kind === "company" && (!fund || fund.pendingCapture)) waits.push("No captured fundamentals row.");
  if (growth.demand === "heroic") waits.push("Heroic implied growth. The price needs a decade the record has not delivered.");
  if (name.book === "growth" && fund && !fund.pendingCapture && quality.present < 2) waits.push("Quality legs missing. Return on capital or margin is blank.");
  if ((name.sleeve === "power" || name.sleeve === "grid") && dur?.capexToOcf != null && dur.capexToOcf > 1) waits.push("Capex is above operating cash.");
  if ((name.sleeve === "space" || name.sleeve === "fuel") && dur?.sharesCagr != null && dur.sharesCagr > 0.03) waits.push("Share count is rising.");
  if (COMPUTE_OVERLAP.has(name.ticker)) waits.push("Overlaps the options sleeve. Under the name cap, not the core.");
  const captured = fund?.asOf ?? snapshotCapturedAt();
  const age = ageDays(captured, today);
  if (name.book === "growth" && age != null && age > CAPTURE_MAX_DAYS) waits.push(`Fundamentals are ${age} days old.`);
  if (opts.weight != null && opts.weight > NAME_CAP) waits.push(`Name is over the ${Math.round(NAME_CAP * 100)}% cap.`);

  if (state !== "fail" && waits.length) state = "wait";
  const reason = state === "pass"
    ? name.book === "safety" ? "Safety name. Dossier complete. The board does not buy it." : "Dossier, capture, and sleeve rule agree. The board still does not buy it."
    : waits[0]!;

  const last = opts.last ?? null;
  const high = fund?.high52 ?? null;
  const ma = fund?.ma200 ?? null;
  const price = last != null ? `$${last.toFixed(2)}${opts.lastAt ? ` · ${opts.lastAt.slice(0, 16).replace("T", " ")}` : ""}` : "— no quote";
  const drawdown = last != null && high != null && high > 0 ? `${(((last - high) / high) * 100).toFixed(1)}% from the 52-week high` : "—";
  const trend = last != null && ma != null ? (last >= ma ? "above the 200-day" : "below the 200-day") : "200-day not captured";
  const one = last != null ? `1 share is $${last.toFixed(2)} of the $${SLEEVE_TARGET_USD} sleeve. 100 shares is $${Math.round(last * 100).toLocaleString()}.` : "No quote, so the share count is blank.";

  return {
    name,
    state,
    reason,
    implied: growth.growth == null ? "implied growth —" : `${(growth.growth * 100).toFixed(1)}% for 10 years · ${growth.demand}`,
    quality: quality.present === 0 ? "quality —" : `${quality.strong} of ${quality.present} legs strong`,
    fresh: fund ? `${fund.source} · ${fund.asOf}` : `no row · snapshot ${snapshotCapturedAt()}`,
    price,
    drawdown,
    trend,
    capex: dur?.capexToOcf == null ? "capex —" : `capex / cash ${(dur.capexToOcf * 100).toFixed(0)}%`,
    dilution: dur?.sharesCagr == null ? "share count —" : `shares ${(dur.sharesCagr * 100).toFixed(1)}%/yr`,
    overlap: COMPUTE_OVERLAP.has(name.ticker) ? "same bet as the sleeve" : "not in the sleeve set",
    shares: one,
    source: `${name.source} · ${name.sourceDate}`,
  };
}

export function gradeBoard(opts: { marks?: { ticker: string; last: { price: number; at: string } | null }[]; today?: string } = {}): LongCard[] {
  const by = new Map((opts.marks ?? []).map((m) => [m.ticker, m.last]));
  return LONG_NAMES.map((n) => {
    const last = by.get(n.ticker);
    return gradeLongCard(n, { last: last?.price ?? null, lastAt: last?.at ?? null, today: opts.today });
  });
}

/** A sleeve over a third of the book is one bet. Counts every name, not only the nine tech tickers. */
export function sleeveLoad(weights: { ticker: string; weight: number }[]): { sleeve: LongSleeve; weight: number; over: boolean }[] {
  const map = new Map(LONG_NAMES.map((n) => [n.ticker, n.sleeve]));
  const acc = new Map<LongSleeve, number>();
  for (const w of weights) {
    const s = map.get(w.ticker);
    if (!s) continue;
    acc.set(s, (acc.get(s) ?? 0) + w.weight);
  }
  return [...acc.entries()].map(([sleeve, weight]) => ({ sleeve, weight, over: weight > SLEEVE_CAP }));
}
