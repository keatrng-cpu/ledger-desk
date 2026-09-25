/**
 * What four years of the desk's own cards paid — read at the moment of
 * decision.
 *
 * `src/data/evidence-pack.json` is built by `scripts/build-evidence-pack.mjs`
 * from the causal capture (every plan the engine priced, 2022-09 -> 2026-09,
 * both books) simulated under the rule as coded: limit at CE, 50% at T1, stop
 * to breakeven, runner to T2, ties against. This module only LOOKS UP the
 * bucket a live card falls in and says what it measured. It computes nothing
 * about the market, gates nothing and sizes nothing — a card is never refused
 * here. Refusals live in trade-plan.ts / entry-ticket.ts, where they always
 * did.
 *
 * WHY IT IS NOT A SCORE
 * The measured buckets are mostly MIXED: the two halves of the tape disagree
 * or the interval straddles zero. Folding those into a number would print a
 * precision the data does not have. So every line carries its verdict word,
 * and only NEGATIVE and POSITIVE buckets — sign agreed in both halves AND a
 * day-clustered 95% interval that excludes zero — are allowed to sound like
 * a finding.
 *
 * MULTIPLE COMPARISONS, stated once so no caller has to remember it: the pack
 * cuts the same 3,501 fills about sixty ways. At that count two or three
 * buckets will clear the verdict bar by chance. The Q band, the stop band and
 * the session buckets have a mechanism behind them; the weekday and half-hour
 * buckets do not, and they are labelled EXPLORATORY wherever they print.
 */

import raw from "../../data/evidence-pack.json";

export type EvidenceVerdict = "positive" | "negative" | "mixed" | "thin";

export interface EvidenceBucket {
  key: string;
  label: string;
  signals: number;
  n: number;
  fillRate: number | null;
  exp: number | null;
  lo: number | null;
  hi: number | null;
  isExp: number | null;
  oosExp: number | null;
  isN: number;
  oosN: number;
  t1Rate: number | null;
  dirHit: number | null;
  dirN: number;
  verdict: EvidenceVerdict;
}

export interface EvidencePack {
  builtAt: string;
  source: { capture: string; tape: string; simulated: number; filled: number };
  rules: Record<string, string>;
  baseline: EvidenceBucket;
  q: EvidenceBucket[];
  riskAtr: EvidenceBucket[];
  inBand: EvidenceBucket[];
  side: EvidenceBucket[];
  sideDrift: EvidenceBucket[];
  word: EvidenceBucket[];
  musts: EvidenceBucket[];
  session: EvidenceBucket[];
  event: EvidenceBucket[];
  composite: EvidenceBucket[];
  etHalfHour: EvidenceBucket[];
  weekday: EvidenceBucket[];
}

export const EVIDENCE = raw as unknown as EvidencePack;

const byKey = (arr: EvidenceBucket[], key: string) => arr.find((b) => b.key === key) ?? null;

export function qBucket(conf: number | null | undefined): EvidenceBucket | null {
  if (conf == null || !Number.isFinite(conf) || conf < 0.65) return null;
  const key =
    conf < 0.7 ? "0.65-0.70" : conf < 0.75 ? "0.70-0.75" : conf < 0.8 ? "0.75-0.80" : conf < 0.85 ? "0.80-0.85" : "0.85+";
  return byKey(EVIDENCE.q, key);
}

export function riskAtrBucket(riskAtr: number | null | undefined): EvidenceBucket | null {
  if (riskAtr == null || !Number.isFinite(riskAtr) || riskAtr <= 0) return null;
  const key =
    riskAtr < 0.5 ? "<0.5" : riskAtr < 0.75 ? "0.5-0.75" : riskAtr < 1 ? "0.75-1" : riskAtr <= 1.5 ? "1-1.5" : "1.5+";
  return byKey(EVIDENCE.riskAtr, key);
}

/**
 * The session the card would be taken in. `event` = the session gate opened on
 * a tape event (session-event.ts) rather than on the killzone clock.
 */
export function sessionBucket(
  killzone: string | null | undefined,
  source?: "killzone" | "event" | "none" | null,
): EvidenceBucket | null {
  const inKz = killzone === "london" || killzone === "ny_am";
  if (!inKz && source === "event") return byKey(EVIDENCE.event, "out-event");
  if (inKz) return byKey(EVIDENCE.session, killzone!);
  if (killzone === "ny_pm") return byKey(EVIDENCE.session, "ny_pm");
  return byKey(EVIDENCE.session, "other");
}

export function sideDriftBucket(
  side: "long" | "short",
  drift: "up" | "down" | null | undefined,
): EvidenceBucket | null {
  if (!drift) return null;
  return byKey(EVIDENCE.sideDrift, `${side}|${drift}`);
}

export function halfHourBucket(etHour: number, etMinute: number): EvidenceBucket | null {
  const m = etHour * 60 + etMinute;
  const slot = m - (m % 30);
  const key = `${String(Math.floor(slot / 60)).padStart(2, "0")}:${String(slot % 60).padStart(2, "0")}`;
  return byKey(EVIDENCE.etHalfHour, key);
}

export function weekdayBucket(weekday: number): EvidenceBucket | null {
  return byKey(EVIDENCE.weekday, String(weekday));
}

const signed = (x: number) => `${x >= 0 ? "+" : "−"}${Math.abs(x).toFixed(2)}R`;

/**
 * One line a trader can read in a second. The verdict word is part of the
 * line on purpose: "−0.15R" alone reads like a fact, "−0.15R · MIXED" reads
 * like what it is.
 */
export function describeBucket(b: EvidenceBucket, opts: { exploratory?: boolean } = {}): string {
  if (b.verdict === "thin" || b.exp == null) {
    return `${b.label}: ${b.n} fills — too few to read`;
  }
  const halves =
    b.isExp != null && b.oosExp != null ? ` (2022-24 ${signed(b.isExp)}, 2025-26 ${signed(b.oosExp)})` : "";
  const tag =
    b.verdict === "negative"
      ? "LOSES in both halves"
      : b.verdict === "positive"
        ? "PAYS in both halves"
        : "mixed — not an edge either way";
  return `${b.label}: ${signed(b.exp)}/card over ${b.n}${halves} · ${tag}${opts.exploratory ? " · exploratory" : ""}`;
}

export type EvidenceTone = "warn" | "ok" | "neutral";

export interface EvidenceLine {
  key: string;
  text: string;
  tone: EvidenceTone;
  bucket: EvidenceBucket;
}

const toneOf = (b: EvidenceBucket): EvidenceTone =>
  b.verdict === "negative" ? "warn" : b.verdict === "positive" ? "ok" : "neutral";

/**
 * The evidence for ONE card, most decision-relevant first.
 *
 * Q and stop band always print (they are the two cuts with a mechanism and a
 * sample in the thousands). Session prints when it is not the ordinary
 * killzone read. Time-of-day and weekday print ONLY when they measured
 * negative in both halves, and say they are exploratory — a neutral
 * half-hour line on every card would be noise a trader learns to skip, and
 * then skips the line that matters.
 */
export function cardEvidence(input: {
  confluence: number;
  riskAtr?: number | null;
  side: "long" | "short";
  killzone?: string | null;
  sessionSource?: "killzone" | "event" | "none" | null;
  etHour?: number;
  etMinute?: number;
  weekday?: number;
}): EvidenceLine[] {
  const out: EvidenceLine[] = [];
  const push = (key: string, b: EvidenceBucket | null, exploratory = false) => {
    if (!b) return;
    out.push({ key, text: describeBucket(b, { exploratory }), tone: toneOf(b), bucket: b });
  };

  push("q", qBucket(input.confluence));
  push("stop", riskAtrBucket(input.riskAtr));

  const session = sessionBucket(input.killzone, input.sessionSource);
  if (session && !(session.key === "london" || session.key === "ny_am")) push("session", session);

  if (input.etHour != null && input.etMinute != null) {
    const slot = halfHourBucket(input.etHour, input.etMinute);
    if (slot?.verdict === "negative") push("slot", slot, true);
  }
  if (input.weekday != null) {
    const day = weekdayBucket(input.weekday);
    if (day?.verdict === "negative") push("day", day, true);
  }
  return out;
}

/**
 * The headline numbers, for places that need the finding in one sentence
 * (Brain, the income gauge, the Learn tab) rather than per card.
 */
export function evidenceHeadlines(): string[] {
  const band = byKey(EVIDENCE.inBand, "in");
  const outBand = byKey(EVIDENCE.inBand, "out");
  const q85 = byKey(EVIDENCE.q, "0.85+");
  const q65 = byKey(EVIDENCE.q, "0.65-0.70");
  const outEvent = byKey(EVIDENCE.event, "out-event");
  const lines: string[] = [];
  const base = EVIDENCE.baseline;
  if (base.exp != null) {
    lines.push(
      `Every card at or above 0.65, taken as coded: ${signed(base.exp)}/card over ${base.n} fills — the card alone is not an edge.`,
    );
  }
  if (outBand?.exp != null && band?.exp != null) {
    lines.push(
      `Stop outside 0.5-1.5 ATR: ${signed(outBand.exp)}/card, losing in both halves. Inside the band: ${signed(band.exp)}/card — the band's value is the losses it refuses, not a proven edge inside it.`,
    );
  }
  if (q85?.dirHit != null && q65?.dirHit != null) {
    lines.push(
      `Q is a fit score, not a probability: Q 0.85+ went the card's way ${(q85.dirHit * 100).toFixed(1)}% of the time vs ${(q65.dirHit * 100).toFixed(1)}% at 0.65-0.70.`,
    );
  }
  if (outEvent?.exp != null) {
    lines.push(
      `Tape-event cards OUTSIDE the killzones: ${signed(outEvent.exp)}/card over ${outEvent.n} (${outEvent.verdict === "thin" ? "thin, but" : ""} both halves negative) — the event opens the window, it does not make the trade good.`,
    );
  }
  return lines;
}
