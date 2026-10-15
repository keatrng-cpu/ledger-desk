/**
 * Review 2026-10-15 #2: card attribution. Every write that LOWERS a card's band or q is recorded on the card as
 * capReasons[] = { stage, field, before, after, bandBefore, bandAfter, why }. `why` is the first reason line the
 * desk pushed after the write (each cap pushes its own sentence). Raises are recorded as kind "nudge".
 * q_scan is the scanner's q; q_raw is q immediately before the seal (sealBand) — both pre-seal.
 */
import { bandFromQ } from "@/lib/smc/discipline";
import { takeQSource } from "./q-source";

export type CapReason = {
  stage: string; field: "pathBand" | "confluence"; kind: "cap" | "penalty" | "nudge";
  before: number | string | null; after: number | string | null;
  bandBefore: string | null; bandAfter: string | null; why?: string | null; _ri?: number;
  /** qv2-1015: the writer's own label (q-source.ts). `why` is kept for history; `source` is authoritative. "untracked" = residual from writes on untracked copies. */
  source?: string | null;
};
type Card = { confluence: number; pathBand?: string | null; reasons: string[]; capReasons?: CapReason[]; q_scan?: number; q_raw?: number };

let stage = "scan";
export const capStage = (s: string): void => { stage = s; };
const ORDER = ["skip", "C", "B", "B+", "A-", "A", "A+"];
const rank = (b: unknown) => ORDER.indexOf(String(b));
const bandOf = (c: Card) => (c.pathBand ?? (bandFromQ(c.confluence) as string | null) ?? null) as string | null;

export function trackCard<T extends Card>(c: T): T {
  if (Object.getOwnPropertyDescriptor(c, "confluence")?.get) return c;
  const log: CapReason[] = [];
  Object.defineProperty(c, "capReasons", { value: log, enumerable: true, writable: false });
  c.q_scan = c.confluence;
  for (const field of ["confluence", "pathBand"] as const) {
    let v = (c as Card)[field];
    Object.defineProperty(c, field, {
      enumerable: true, configurable: true,
      get: () => v,
      set: (n) => {
        // A no-op write still consumes the label, so it can never leak onto the next real write.
        if (n === v) { takeQSource(); return; }
        const bandBefore = bandOf(c);
        const old = v; v = n;
        const down = field === "confluence" ? Number(n) < Number(old) : rank(n) < rank(old);
        const source = takeQSource();
        log.push({ stage, field, source, kind: down ? (field === "pathBand" ? "cap" : "penalty") : "nudge", before: old as never, after: n as never, bandBefore, bandAfter: bandOf(c), _ri: c.reasons.length });
      },
    });
  }
  return c;
}

/** Call right before the seal: records q_raw and resolves each entry's `why`. */
export function preSeal<T extends Card>(c: T): T {
  c.q_raw = c.confluence;
  resolveWhy(c);
  // qv2-1015: raises/penalties written on untracked copies never hit the setter. Log the residual so
  // q_scan + Σ logged deltas == q_raw always holds.
  const log = c.capReasons;
  if (log && c.q_scan != null) {
    const sum = log.filter((r) => r.field === "confluence").reduce((a, r) => a + (Number(r.after) - Number(r.before)), 0);
    const resid = +(c.confluence - c.q_scan - sum).toFixed(4);
    if (Math.abs(resid) >= 1e-4) log.push({ stage, field: "confluence", kind: resid > 0 ? "nudge" : "penalty", before: +(c.confluence - resid).toFixed(4), after: c.confluence, bandBefore: null, bandAfter: null, why: null, source: "untracked (write on a card copy)" });
  }
  return c;
}
export function resolveWhy(c: Card): void {
  for (const r of c.capReasons ?? []) if (r._ri != null) { r.why ??= c.reasons[r._ri] ?? null; delete r._ri; }
}
