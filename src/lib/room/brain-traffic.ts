/**
 * The nerves on the brain desk. A line is recorded only when a seat actually
 * writes the book, the book hands a line back, or the floor speaks an exchange.
 * The picture reads this. It does not invent traffic.
 */

export const NERVE_EVENT = "ledger-brain-nerve";

export type NerveEnd = "Gemma" | "Jax" | "Nova" | "Sterling" | "Vince" | "hub";

export interface Nerve {
  at: number;
  from: NerveEnd;
  to: NerveEnd;
  about: string;
}

const SEATS = new Set<NerveEnd>(["Gemma", "Jax", "Nova", "Sterling", "Vince", "hub"]);
const nerves: Nerve[] = [];
const MAX = 48;

function asEnd(name: string): NerveEnd | null {
  return SEATS.has(name as NerveEnd) ? (name as NerveEnd) : null;
}

/** One real send. The same from, to, and subject inside eight seconds is one send, not a strobe. */
export function noteNerve(from: string, to: string, about: string, at = Date.now()): void {
  const f = asEnd(from);
  const t = asEnd(to);
  const subject = about.trim().slice(0, 140);
  if (!f || !t || f === t || !subject) return;
  const last = nerves[nerves.length - 1];
  if (last && last.from === f && last.to === t && last.about === subject && at - last.at < 8_000) return;
  nerves.push({ at, from: f, to: t, about: subject });
  if (nerves.length > MAX) nerves.splice(0, nerves.length - MAX);
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(NERVE_EVENT));
}

/** An exchange that was actually queued. Each speaker hands the line to the next speaker. */
export function noteExchange(speakers: readonly string[], at: number, about: string): void {
  const who: NerveEnd[] = [];
  for (const s of speakers) {
    const e = asEnd(s);
    if (e && e !== "hub" && who[who.length - 1] !== e) who.push(e);
  }
  for (let i = 0; i < who.length - 1; i++) noteNerve(who[i]!, who[i + 1]!, about, at);
}

export function recentNerves(now = Date.now(), windowMs = 12_000): Nerve[] {
  return nerves.filter((n) => now - n.at <= windowMs && now - n.at >= 0);
}

export function allNerves(): readonly Nerve[] {
  return nerves;
}

export function clearNerves(): void {
  nerves.splice(0, nerves.length);
}
