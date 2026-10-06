/**
 * How the floor prints numbers. Formatting only — every value passed in was
 * computed elsewhere; nothing here rounds a number into a different claim.
 */

import { ROOM_STOP_PCT } from "./mandate";
import { shortDate, type OptionType, type Underlier } from "./option-math";

export const usd = (n: number, dp = 0) =>
  `${n < 0 ? "−" : ""}$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp })}`;
export const px = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const prem = (n: number) => `$${n.toFixed(2)}`;
export const signedPct = (n: number) => `${n >= 0 ? "+" : "−"}${Math.abs(n).toFixed(1)}%`;
export const clockEt = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
export const contractName = (u: Underlier, strike: number, type: OptionType, exp: string) =>
  `${u} ${shortDate(exp)} ${strike}${type === "CALL" ? "C" : "P"}`;
export const pctOf = (p: number | null | undefined) => (p == null ? "n/a" : `${Math.round(p * 100)}%`);
export const rSigned = (r: number | null | undefined) => (r == null ? "n/a" : `${r >= 0 ? "+" : "−"}${Math.abs(r).toFixed(2)}R`);
export const sideWord = (t: OptionType) => (t === "CALL" ? "calls" : "puts");
export const ptsTxt = (n: number) => `${n.toFixed(n >= 10 ? 0 : 2)}pt`;
/** "−20%" with a real minus, for every line that names the stop. */
export const STOP_TXT = `−${Math.abs(ROOM_STOP_PCT)}%`;

/** A room gate's code id, said the way the room says it ("ev" is "EV", "one_book" is "one-book"). */
const GATE_WORD: Record<string, string> = {
  ev: "EV",
  ev_preview: "EV",
  t1_pays: "T1-pays",
  dte: "DTE",
  one_book: "one-book",
  cash_cap: "cash-cap",
};
export const gateWord = (id: string): string => GATE_WORD[id] ?? id.replace(/_/g, " ");

/** A strike offset said as a trader says it: "ATM" is "at the money", "OTM_1" is "one strike out". */
export const offsetWord = (o: string): string => {
  if (o === "ATM") return "at the money";
  const k = /^OTM_(\d+)$/.exec(o)?.[1];
  if (k == null) return o.replace(/_/g, " ");
  return k === "1" ? "one strike out" : `${k} strikes out`;
};
