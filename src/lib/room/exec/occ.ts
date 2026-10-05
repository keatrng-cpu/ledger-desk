/**
 * OCC option symbols the way Alpaca writes them: ROOT + YYMMDD + C|P + strike×1000
 * padded to 8 digits, no padding on the root. QQQ 778 call expiring 2026-10-06 is
 * `QQQ261006C00778000`. Pure.
 */

export type OccType = "CALL" | "PUT";

export interface OccParts {
  underlier: string;
  /** ET calendar date, YYYY-MM-DD. */
  exp: string;
  type: OccType;
  strike: number;
}

export function occSymbol(p: OccParts): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(p.exp);
  if (!m) throw new Error(`bad expiry ${p.exp}`);
  if (!/^[A-Z]{1,6}$/.test(p.underlier)) throw new Error(`bad root ${p.underlier}`);
  const k = Math.round(p.strike * 1000);
  if (!Number.isFinite(k) || k <= 0 || k > 99_999_999) throw new Error(`bad strike ${p.strike}`);
  return `${p.underlier}${m[1]!.slice(2)}${m[2]}${m[3]}${p.type === "CALL" ? "C" : "P"}${String(k).padStart(8, "0")}`;
}

export function parseOcc(sym: string): OccParts | null {
  const m = /^([A-Z]{1,6})(\d{2})(\d{2})(\d{2})([CP])(\d{8})$/.exec(sym);
  if (!m) return null;
  return {
    underlier: m[1]!,
    exp: `20${m[2]}-${m[3]}-${m[4]}`,
    type: m[5] === "C" ? "CALL" : "PUT",
    strike: Number(m[6]) / 1000,
  };
}
