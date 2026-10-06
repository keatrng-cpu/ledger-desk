/**
 * "Should I enter right now?" — one word for the whole desk.
 *
 * PRESENTATION ONLY. Nothing in this file decides, gates, sizes or sends
 * anything. It reads the words the desk already printed — the board verdict
 * (`pricePathVerdict`: TAKE / STAND / MANAGE), the SMC sequence (smc-master
 * WAIT / STAND / TAKE and its must-layers), the PATH card (actionable, band,
 * fit, vetoes), the session gate, the news blackout and the brief — and
 * collapses them into one of four states plus one plain-English sentence.
 * Before this, the answer was spread across WAIT, STAND, VETO, "not armed",
 * "3/9 musts" and "fit 0.66", each in a different corner of the screen.
 *
 * THE MAPPING (first row that matches wins):
 *
 *   | # | Desk state                                                         | Entry state |
 *   |---|--------------------------------------------------------------------|-------------|
 *   | 1 | Board verdict MANAGE (a paper position is open)                    | WAIT  — "already in; don't add" |
 *   | 2 | Board verdict TAKE (sequence TAKE + PATH A+/A/A− + HTF ok, fresh   | ENTER — countdown to the end of |
 *   |   | quote, one book) — the exact word the alarm and HUD print          |         the current killzone    |
 *   | 3 | News blackout, Judas unresolved, session gate closed, a stale      | WAIT  |
 *   |   | quote, the one-book rule, or the brief says stand down             |       |
 *   | 4 | A PATH card is armed: actionable, band A+/A/A−, fit ≥ floor 0.65    | ARMED — pulsing; waiting on the |
 *   |   | (`isHighProbPath`) but the sequence has not printed TAKE           |         missing must-layer      |
 *   | 5 | A card clears the floor (fit ≥ 0.65) with no veto and HTF ok, OR   | STALKING |
 *   |   | the preferred book's sequence is ONE must-layer from complete      |          |
 *   | 6 | Anything else (no card at the floor, every card vetoed, …)         | WAIT  |
 *
 * Because rows 1–3 read the board verdict itself, the hero can never say
 * ENTER while the HUD, the alarm or the chart frame says STAND, and it can
 * never say WAIT while they say TAKE.
 */

import { APLUS_RULES } from "@/lib/aplus/config";
import { isHighProbPath } from "@/lib/alerts/path-alarm";
import type { DeskPayload } from "@/lib/trading/build-desk";
import type { SetupCandidate } from "@/lib/trading/scanner";
import type { SmcMasterBook } from "@/lib/trading/smc-master";
import { etWallParts, resolveKillzone, sessionLive } from "@/lib/trading/sessions";

export type EntryState = "WAIT" | "STALKING" | "ARMED" | "ENTER";

/** The board verdict, as `pricePathVerdict` returns it (kept structural so this file has no UI import). */
export interface BoardVerdict {
  word: "TAKE" | "STAND" | "MANAGE";
  line: string;
  book: "left" | "right" | null;
}

export interface EntryStateRead {
  state: EntryState;
  /** One plain-English sentence: why this state, and what would change it. */
  why: string;
  /** Which mapping row fired (1–6), for the tooltip and the tests. */
  rule: 1 | 2 | 3 | 4 | 5 | 6;
  symbol: string | null;
  side: "long" | "short" | null;
  /** ENTER only, and only inside a killzone: when the current window closes. */
  countdown: { endsAtMs: number; label: string } | null;
}

const px = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });
const fit = (n: number) => n.toFixed(2);

/**
 * When the killzone that contains `nowMs` ends, read off `resolveKillzone`
 * itself (minute by minute) so this never restates a window boundary. Null
 * outside a trade window.
 */
export function killzoneEnd(nowMs: number): { endsAtMs: number; label: string } | null {
  const w = etWallParts(nowMs);
  const here = resolveKillzone(w.hour, w.minute);
  if (!here.inTradeWindow) return null;
  const startMin = w.hour * 60 + w.minute;
  for (let k = 1; k <= 24 * 60; k++) {
    const m = (startMin + k) % (24 * 60);
    const kz = resolveKillzone(Math.floor(m / 60), m % 60);
    if (kz.label !== here.label) {
      const endsAtMs = nowMs + (k * 60 - w.second) * 1000;
      return { endsAtMs, label: here.label };
    }
  }
  return null;
}

function bookOf(desk: DeskPayload, side: "left" | "right" | null): SmcMasterBook | null {
  if (!desk.smcMaster) return null;
  if (side) return desk.smcMaster[side];
  return desk.smcMaster.oneBook ?? null;
}

/** The card the sentence should talk about: armed first, then the best fit. */
function focusCard(desk: DeskPayload, symbol: string | null): SetupCandidate | null {
  const cands = desk.scan?.candidates ?? [];
  const armed = cands.find((c) => isHighProbPath(c));
  if (armed) return armed;
  const onBook = symbol ? cands.filter((c) => c.symbol === symbol) : [];
  const pool = onBook.length ? onBook : cands;
  return pool.reduce<SetupCandidate | null>((m, c) => (m == null || c.confluence > m.confluence ? c : m), null);
}

function vetoText(c: SetupCandidate): string | null {
  const v = c.vetoes?.[0];
  return v ? v.split(" — ")[0]!.toLowerCase() : null;
}

function cardPhrase(c: SetupCandidate): string {
  const floor = APLUS_RULES.confluenceFloor;
  const veto = vetoText(c);
  if (veto) return `${c.symbol} ${c.side} fits ${fit(c.confluence)} but is vetoed (${veto})`;
  if (c.confluence < floor) return `${c.symbol} ${c.side} fits ${fit(c.confluence)}, under the ${floor} floor`;
  if (!c.htfOk) return `${c.symbol} ${c.side} fits ${fit(c.confluence)} but fights the higher-timeframe bias`;
  return `${c.symbol} ${c.side} fits ${fit(c.confluence)}`;
}

export function deriveEntryState(desk: DeskPayload, verdict: BoardVerdict, nowMs: number): EntryStateRead {
  const book = bookOf(desk, verdict.book);
  const seqSide = book?.side ?? null;

  // Row 1 — a position is open: the answer to "enter?" is no.
  if (verdict.word === "MANAGE") {
    return {
      state: "WAIT",
      rule: 1,
      symbol: book?.symbol ?? null,
      side: seqSide,
      countdown: null,
      why: `You are already in a trade (${verdict.line.split(" · ")[0]}). Manage it — do not add a second entry.`,
    };
  }

  // Row 2 — the board printed TAKE.
  if (verdict.word === "TAKE") {
    const card = focusCard(desk, book?.symbol ?? null);
    const entry = book?.plan?.entry ?? card?.entryPx ?? null;
    return {
      state: "ENTER",
      rule: 2,
      symbol: book?.symbol ?? card?.symbol ?? null,
      side: seqSide ?? card?.side ?? null,
      countdown: killzoneEnd(nowMs),
      why: `Every must-layer passed and the PATH is ${card?.pathBand ?? card?.grade ?? "A-band"} — rest the limit at CE${entry != null ? ` ${px(entry)}` : ""}, never pay the print.`,
    };
  }

  // Row 3 — a hard block the board already applied.
  const clock = desk.clock;
  const blocked = (why: string): EntryStateRead => ({
    state: "WAIT",
    rule: 3,
    symbol: book?.symbol ?? null,
    side: seqSide,
    countdown: null,
    why,
  });
  if (desk.news?.verdict === "blackout") {
    return blocked(`News blackout — ${desk.news.reason || "a high-impact release is inside ±15 minutes"}. Nothing enters until it clears.`);
  }
  if (/^Judas/.test(verdict.line)) {
    return blocked(`The 9:30–9:45 opening raid has not resolved yet. ${verdict.line.replace(/^Judas 9:30–9:45 — /, "")}.`);
  }
  if (!sessionLive(clock)) {
    return blocked(`The trading window is closed (${clock.killzoneLabel}). Next window: ${clock.nextWindow}.`);
  }
  if (/stale print|one book:/.test(verdict.line)) {
    return blocked(verdict.line.replace(/^.*sequence complete — /, "Sequence complete, but ") + ".");
  }
  if (desk.brief?.verdict === "stand_down") {
    return blocked(`The session brief says stand down: ${desk.brief.headline}.`);
  }

  // Row 4 — armed PATH, sequence not complete.
  const armed = (desk.scan?.candidates ?? []).find((c) => isHighProbPath(c));
  if (armed) {
    const seq = desk.smcMaster ? (armed.symbol === desk.smcMaster.left.symbol ? desk.smcMaster.left : desk.smcMaster.right) : null;
    return {
      state: "ARMED",
      rule: 4,
      symbol: armed.symbol,
      side: armed.side,
      countdown: null,
      why: `${armed.symbol} ${armed.side} ${armed.pathBand ?? armed.grade} is armed (fit ${fit(armed.confluence)}) — waiting on ${seq ? `${seq.missing.toLowerCase()}${seq.missingDetail ? `: ${seq.missingDetail}` : ""}` : "the sequence"}.`,
    };
  }

  // Row 5 — close: a clean card at the floor, or one layer to go.
  const floor = APLUS_RULES.confluenceFloor;
  const clean = (desk.scan?.candidates ?? [])
    .filter((c) => c.confluence >= floor && !c.vetoes?.length && c.htfOk)
    .sort((a, b) => b.confluence - a.confluence)[0];
  const oneAway = book && book.side && book.mustNeed > 0 && book.mustPass >= book.mustNeed - 1 && book.word !== "TAKE";
  if (clean || oneAway) {
    const sym = clean?.symbol ?? book!.symbol;
    const side = clean?.side ?? book!.side;
    const need = book && (!clean || clean.symbol === book.symbol) ? book.missing.toLowerCase() : clean!.missing[0]?.toLowerCase() ?? "the sequence";
    return {
      state: "STALKING",
      rule: 5,
      symbol: sym,
      side,
      countdown: null,
      why: clean
        ? `Watching ${sym} ${side}: fit ${fit(clean.confluence)} clears the ${floor} floor, but it is not armed — needs ${need}.`
        : `${sym} ${side} is one must-layer from complete (${book!.mustPass}/${book!.mustNeed}) — needs ${need}.`,
    };
  }

  // Row 6 — nothing worth entering.
  const card = focusCard(desk, book?.symbol ?? null);
  const seqTxt = book && book.word !== "TAKE" ? ` The sequence has ${book.mustPass}/${book.mustNeed} must-layers.` : "";
  return {
    state: "WAIT",
    rule: 6,
    symbol: card?.symbol ?? book?.symbol ?? null,
    side: card?.side ?? seqSide,
    countdown: null,
    why: card ? `Nothing to enter: best idea ${cardPhrase(card)}.${seqTxt}` : `Nothing to enter: no PATH card on either book.${seqTxt}`,
  };
}

/* ── Conflicts ──────────────────────────────────────────────────────────── */

export interface Conflict {
  kind: "htf_vs_draw" | "stand_vs_armed";
  symbol: string;
  /** The two sides that disagree, for the split-colour chip (bull/up = left half, bear/down = right half). */
  a: { label: string; dir: "up" | "down" };
  b: { label: string; dir: "up" | "down" };
  explain: string;
}

/**
 * Two disagreements the desk already knows about but never put side by side:
 *   1. HTF bias vs the draw on liquidity (bull bias, magnet below — or the reverse).
 *   2. The sequence's side ("STAND ES long") vs the side a PATH card is armed /
 *      graded on for the same symbol ("ES short armed").
 * Read only; neither is a gate here (topDown already is one, in the scanner).
 */
export function detectConflicts(desk: DeskPayload): Conflict[] {
  const out: Conflict[] = [];
  for (const side of ["left", "right"] as const) {
    const bias = desk.bias?.[side];
    const draw = desk.draws?.[side]?.primary;
    if (bias && draw && bias.topDown !== "neutral") {
      const drawDir = draw.side === "below" ? "down" : "up";
      const biasDir = bias.topDown === "bull" ? "up" : "down";
      if (drawDir !== biasDir) {
        out.push({
          kind: "htf_vs_draw",
          symbol: bias.symbol,
          a: { label: `HTF ${bias.topDown}`, dir: biasDir },
          b: { label: `draw ${draw.side === "below" ? "↓" : "↑"} ${px(draw.price)}`, dir: drawDir },
          explain: `${bias.symbol}: the higher timeframe leans ${bias.topDown}, but the nearest magnet (${draw.name} ${px(draw.price)}) is ${draw.side} price — a move to it fights the bias.`,
        });
      }
    }
    const seq = desk.smcMaster?.[side];
    if (seq?.side) {
      const cards = (desk.scan?.candidates ?? []).filter((c) => c.symbol === seq.symbol);
      const armed = cards.find((c) => c.actionable) ?? null;
      // The raid names a side too (smc-master GATE.sideFromRaid: SSL taken
      // arms a long, BSL taken arms a short) — the "BSL raid arms SHORT, not
      // long" line, as a structured read rather than a sentence.
      const swept = desk.narrative?.[side]?.liquidity?.lastSweep ?? null;
      const raidSide = swept === "ssl" ? "long" : swept === "bsl" ? "short" : null;
      if (!armed && raidSide && raidSide !== seq.side) {
        out.push({
          kind: "stand_vs_armed",
          symbol: seq.symbol,
          a: { label: `sequence ${seq.side}`, dir: seq.side === "long" ? "up" : "down" },
          b: { label: `raid arms ${raidSide}`, dir: raidSide === "long" ? "up" : "down" },
          explain: `${seq.symbol}: the sequence is reading a ${seq.side}, but the last raid took ${swept!.toUpperCase()} — which arms a ${raidSide}. A reversal would be the other way.`,
        });
      }
      if (armed && armed.side !== seq.side) {
        out.push({
          kind: "stand_vs_armed",
          symbol: seq.symbol,
          a: { label: `sequence ${seq.side}`, dir: seq.side === "long" ? "up" : "down" },
          b: { label: `armed ${armed.side}`, dir: armed.side === "long" ? "up" : "down" },
          explain: `${seq.symbol}: the sequence is reading a ${seq.side} (${seq.word}) while the ${armed.pathBand ?? armed.grade} card is armed ${armed.side} — they cannot both be right; wait for one to drop.`,
        });
      }
    }
  }
  return out;
}
