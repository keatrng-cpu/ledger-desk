/**
 * Research the desk already measured. A note for the journal and the brain.
 *
 * This is not a crew, and it is not an execution path. The PATH number is
 * the card's confluence. The entry, stop, and T1 are the card's plan.
 * Discretion is the measured size factor. Nothing here places, and nothing
 * here changes the floor.
 */
import { APLUS_RULES } from "@/lib/aplus/config";
import { FACTOR_CEILING, FACTOR_FLOOR } from "@/lib/journal/discretion";
import { QUOTE_EXECUTION_MAX_LAG_SEC } from "@/lib/market/types";
import type { DeskPayload } from "./build-desk";
import { loadDeskMemory, remember } from "./desk-memory";
import { etDateKey } from "./week-ahead";

export interface ResearchRead {
  status: "stand" | "note";
  /** Always false. The desk places. This file does not. */
  sent: false;
  key: string;
  title: string;
  summary: string;
}

export interface ResearchFacts {
  day: string;
  symbol: string;
  side: "long" | "short";
  confluence: number;
  pathBand: string;
  smcWord: string;
  smcMissing: string;
  retrace: "pass" | "wait" | "fail" | "none";
  entry: number | null;
  stop: number | null;
  t1: number | null;
  draw: string | null;
  quoteSource: string;
  quoteLagSec: number;
  quotePrice: number;
  discretionMult: number | null;
  discretionVerdict: string | null;
}

function px(n: number): string {
  return n.toFixed(2);
}

function discretionClause(mult: number | null, verdict: string | null): string {
  if (mult == null || !Number.isFinite(mult)) {
    return "Discretion has no measured sample, so size stays ×1.00. It is not a veto.";
  }
  const clamped = Math.min(FACTOR_CEILING, Math.max(FACTOR_FLOOR, mult));
  const word = verdict && verdict.trim() ? verdict.trim() : "measured";
  return `Discretion is ${word}, size ×${clamped.toFixed(2)} (clamped ${FACTOR_FLOOR.toFixed(2)}–${FACTOR_CEILING.toFixed(2)}). It does not veto and it does not change the floor.`;
}

/** One sentence from facts the desk already printed. `sent` is false on every branch. */
export function researchLine(f: ResearchFacts): ResearchRead {
  const floor = APLUS_RULES.confluenceFloor;
  const band = f.pathBand || "—";
  const key = [
    f.day,
    f.symbol,
    f.side,
    band,
    f.smcWord,
    f.retrace,
    f.quoteSource,
    f.discretionMult == null ? "none" : f.discretionMult.toFixed(2),
  ].join("|");
  const title = `Research ${f.symbol} ${f.side}`;
  const refuse = (summary: string): ResearchRead => ({
    status: "stand",
    sent: false,
    key: `${key}|stand`,
    title,
    summary,
  });

  const lag = Number.isFinite(f.quoteLagSec) ? f.quoteLagSec : Number.POSITIVE_INFINITY;
  const printOk =
    f.quoteSource !== "synthetic" &&
    f.quoteSource !== "" &&
    Number.isFinite(f.quotePrice) &&
    f.quotePrice > 0 &&
    lag <= QUOTE_EXECUTION_MAX_LAG_SEC;
  if (!printOk) {
    return refuse(
      `No entry. The print is ${f.quoteSource || "missing"} ${Number.isFinite(lag) ? Math.round(lag) : "—"}s. Research does not invent a fill.`,
    );
  }
  if (!(f.confluence >= floor)) {
    return refuse(
      `${f.symbol} ${f.side} PATH ${f.confluence.toFixed(2)} is under ${floor.toFixed(2)}. Kept as research. No entry and no exit to manage.`,
    );
  }
  if (f.smcWord !== "TAKE") {
    return refuse(
      `${f.symbol} ${f.side} SMC ${f.smcWord || "—"}. Missing: ${f.smcMissing || "the sequence"}. The entry is not confirmed.`,
    );
  }
  const priced =
    f.entry != null &&
    f.stop != null &&
    f.t1 != null &&
    [f.entry, f.stop, f.t1].every((n) => Number.isFinite(n) && n > 0);
  if (!priced) {
    return refuse(
      `${f.symbol} ${f.side} is TAKE and the plan has no entry, stop, and T1. Nothing to manage.`,
    );
  }
  const draw = f.draw ? ` (${f.draw})` : "";
  const disc = discretionClause(f.discretionMult, f.discretionVerdict);
  const levels = `Entry ${px(f.entry!)}. Stop ${px(f.stop!)}. First exit ${px(f.t1!)}${draw}.`;
  if (f.retrace !== "pass") {
    return refuse(
      `${f.symbol} ${f.side} is armed. ${levels} The touch has not printed, so this is not a fill. ${disc} Quote ${f.quoteSource} ${Math.round(lag)}s.`,
    );
  }
  return {
    status: "note",
    sent: false,
    key: `${key}|note`,
    title,
    summary: `${f.symbol} ${f.side} ${band} PATH ${f.confluence.toFixed(2)}. ${levels} ${disc} Quote ${f.quoteSource} ${Math.round(lag)}s. The desk places. This note does not.`,
  };
}

/** The best card on the desk, as a research note. Null when the scan is empty. */
export function researchRead(
  desk: DeskPayload,
  discretion?: Record<string, { factor?: number; verdict?: string }> | null,
  day = etDateKey(),
): ResearchRead | null {
  const candidates = desk.scan?.candidates ?? [];
  const card =
    candidates.find((c) => c.actionable) ??
    [...candidates].sort((a, b) => b.confluence - a.confluence)[0];
  if (!card) return null;
  const es = /ES/.test(card.symbol);
  const leftEs = /ES/.test(desk.quotes.left.symbol);
  const quote = es === leftEs ? desk.quotes.left : desk.quotes.right;
  const master = desk.smcMaster;
  const book =
    master == null
      ? null
      : /ES/.test(card.symbol) === /ES/.test(master.left.symbol)
        ? master.left
        : master.right;
  const retrace = book?.layers?.find((l) => l.id === "retrace");
  const strat = card.completeStrategy || card.strategyPrimary;
  const d = strat && discretion ? discretion[strat] : undefined;
  const plan = card.plan;
  return researchLine({
    day,
    symbol: card.symbol,
    side: card.side,
    confluence: card.confluence,
    pathBand: String(card.pathBand || card.grade || "—"),
    smcWord: book?.word ?? "—",
    smcMissing: book?.missing ?? "",
    retrace: retrace?.state ?? "none",
    entry: plan?.entry ?? card.entryPx ?? null,
    stop: plan?.stop ?? null,
    t1: plan?.t1 ?? null,
    draw: plan?.drawName ?? card.draw?.name ?? null,
    quoteSource: quote?.source ?? "",
    quoteLagSec: quote?.lagSec ?? Number.POSITIVE_INFINITY,
    quotePrice: quote?.price ?? 0,
    discretionMult: typeof d?.factor === "number" ? d.factor : null,
    discretionVerdict: d?.verdict ?? null,
  });
}

/** One note per key. A repeat poll does not write the same research twice. */
export function rememberResearch(line: ResearchRead): void {
  if (typeof window === "undefined") return;
  const seen = loadDeskMemory().items.some(
    (i) => i.kind === "note" && (i.payload as { key?: string } | undefined)?.key === line.key,
  );
  if (seen) return;
  remember("note", line.title, line.summary, ["research", "entry", "exit", "discretion"], {
    key: line.key,
    sent: false,
    status: line.status,
  });
}
