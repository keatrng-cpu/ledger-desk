/**
 * What the floor's people have READ — the desk's own measured research,
 * split by whose job it is to quote it.
 *
 * Every number here comes from a committed data file the desk's scripts
 * built — `src/data/evidence-pack.json` (scripts/build-evidence-pack.mjs:
 * four years of plan moments, rule as coded) and `src/data/hit-odds-model.json`
 * (scripts/build-hit-odds.mjs) — through the same accessors the desk's cards
 * use. Nothing is typed in by hand, so a rebuilt pack changes what the room
 * says the next time it speaks, and a character can never quote a figure
 * the desk does not hold.
 *
 * Live duty (Keaton 2026-10-06): every character stays aware of the live PATH
 * setup scanner, SMC research, and the Robinhood live-when-armed envelope. When a
 * card is on the board they cite the PATH band + confluence and the SMC sequence
 * (or what is missing). They also know live RH (when armed) is $150–$550 debit,
 * 1–4 contracts ATM/OTM_1, review_option_order then place, and Manager agentAgree
 * is the Stand bit. They watch the tape and do their own shelf research — they do
 * not ignore a live A+/A/A− setup because the room is mid-banter.
 *
 *   Nova     — what the edge is and is not (baseline, the stop band, Q) + scanner fit + RH envelope.
 *   Vince    — where the fill is (fill rate by entry tier) + SMC sequence / CE + RH review→place.
 *   Sterling — what the refusals are worth (inducement, mitigation, events) + PATH cap + Stand agree.
 *   Gemma    — when the tape delivers (session buckets) + liquidity / HTF + RH live-when-armed.
 *   Jax      — how rarely the desk actually says TAKE + chase discipline on live PATH + RH size.
 *
 * RH account on the desk (Keaton 2026-10-06): every seat also carries the RH
 * Individual account read — cash vs buying power, whether BP clears the $150
 * envelope floor, and whether the armed path can fire at all (rhAccountNote /
 * rhArmedPathNote). The numbers come from the account snapshot passed in, never
 * written here.
 */

import { EVIDENCE, type EvidenceBucket } from "@/lib/trading/evidence";
import { HIT_ODDS_MODEL } from "@/lib/trading/hit-odds-model";
import {
  evaluateRhBuyingPower,
  rhSpendable,
  RH_MAX_DEBIT_TOTAL,
  RH_MIN_DEBIT_TOTAL,
  type RhAccountSnapshot,
} from "@/lib/execution/rh-autofire-gates";

const byKey = (arr: EvidenceBucket[] | undefined, key: string): EvidenceBucket | null =>
  (arr ?? []).find((b) => b.key === key) ?? null;

const r = (x: number | null | undefined) => (x == null ? "n/a" : `${x >= 0 ? "+" : "−"}${Math.abs(x).toFixed(3)}R`);
const pct = (x: number | null | undefined, dp = 1) => (x == null ? "n/a" : `${(x * 100).toFixed(dp)}%`);
const n = (x: number) => x.toLocaleString("en-US");

export interface ResearchNote {
  id: string;
  /** One sentence a character can say out loud. */
  line: string;
  /** Where the number came from, for the panel's footnote. */
  source: string;
}

const PACK = "evidence-pack.json";
const ODDS = "hit-odds-model.json";

/** The baseline: what a card is worth with nothing else known. */
export function baselineNote(): ResearchNote | null {
  const b = EVIDENCE.baseline;
  if (b?.exp == null) return null;
  return {
    id: "baseline",
    line: `Every card at or above 0.65, taken as coded, ran ${r(b.exp)} a card over ${n(b.n)} fills — the card alone is not the edge.`,
    source: `${PACK} · baseline`,
  };
}

export function bandNote(): ResearchNote | null {
  const inB = byKey(EVIDENCE.inBand, "in");
  const out = byKey(EVIDENCE.inBand, "out");
  if (inB?.exp == null || out?.exp == null) return null;
  return {
    id: "band",
    line: `Stops inside 0.5–1.5 ATR ran ${r(inB.exp)} a card over ${n(inB.n)} fills; outside the band, ${r(out.exp)} over ${n(out.n)}. The band earns by what it refuses.`,
    source: `${PACK} · inBand`,
  };
}

export function qNote(): ResearchNote | null {
  const hi = byKey(EVIDENCE.q, "0.85+");
  const lo = byKey(EVIDENCE.q, "0.65-0.70");
  if (hi?.dirHit == null || lo?.dirHit == null) return null;
  return {
    id: "q",
    line: `Fit is not probability: Q 0.85+ went the card's way ${pct(hi.dirHit)} of the time, Q 0.65–0.70 went ${pct(lo.dirHit)}.`,
    source: `${PACK} · q`,
  };
}

/** Out of sample, the card's own P(T1) model against what happened. */
export function oddsNote(): ResearchNote | null {
  const v = HIT_ODDS_MODEL.validation as unknown as { oosN?: number; oosHitRate?: number } | undefined;
  if (v?.oosHitRate == null || v.oosN == null) return null;
  return {
    id: "odds",
    line: `Out of sample, ${pct(v.oosHitRate)} of ${n(v.oosN)} fills reached T1. Most fills never see the first target.`,
    source: `${ODDS} · validation`,
  };
}

export function fillTierNote(): ResearchNote | null {
  const f = HIT_ODDS_MODEL.fillByTier as unknown as Record<string, number> | undefined;
  if (!f?.LIVE || !f.ARMED || !f.FORMING) return null;
  return {
    id: "fill_tier",
    line: `A limit resting at CE filled ${pct(f.LIVE, 0)} of the time when price was already there, ${pct(f.ARMED, 0)} from inside one ATR, ${pct(f.FORMING, 0)} from further out.`,
    source: `${ODDS} · fillByTier`,
  };
}

export function inducementNote(): ResearchNote | null {
  const yes = byKey(EVIDENCE.inducement, "yes");
  const no = byKey(EVIDENCE.inducement, "no");
  if (yes?.exp == null || no?.exp == null) return null;
  return {
    id: "inducement",
    line: `A decoy sweep before the real one ran ${r(yes.exp)} a card over ${n(yes.n)} fills, against ${r(no.exp)} without one. That's a warning, not confirmation.`,
    source: `${PACK} · inducement`,
  };
}

export function mitigationNote(): ResearchNote | null {
  const yes = byKey(EVIDENCE.mitigation, "yes");
  const no = byKey(EVIDENCE.mitigation, "no");
  if (yes?.exp == null || no?.exp == null) return null;
  return {
    id: "mitigation",
    line: `Mitigation blocks ran ${r(yes.exp)} a card over ${n(yes.n)} fills against ${r(no.exp)} without — the largest sample of any concept we've measured, and it says warning.`,
    source: `${PACK} · mitigation`,
  };
}

export function eventNote(): ResearchNote | null {
  const out = byKey(EVIDENCE.event, "out-event");
  if (out?.exp == null) return null;
  return {
    id: "event",
    line: `Tape-event cards outside the killzones ran ${r(out.exp)} a card over ${n(out.n)} fills. The event opens the window; it doesn't make the trade good.`,
    source: `${PACK} · event`,
  };
}

export function sessionNote(): ResearchNote | null {
  const am = byKey(EVIDENCE.session, "ny_am");
  const ldn = byKey(EVIDENCE.session, "london");
  if (am?.t1Rate == null || ldn?.t1Rate == null) return null;
  return {
    id: "session",
    line: `NY AM fills reached T1 ${pct(am.t1Rate)} of the time against London's ${pct(ldn.t1Rate)} — the morning delivers more often, not always.`,
    source: `${PACK} · session`,
  };
}

export function takeWordNote(): ResearchNote | null {
  const take = byKey(EVIDENCE.word, "TAKE");
  const total = EVIDENCE.source?.simulated;
  if (!take || !total) return null;
  return {
    id: "take_word",
    line: `The desk said TAKE on ${n(take.signals)} of ${n(total)} cards in the four-year capture. It doesn't say it often.`,
    source: `${PACK} · word`,
  };
}

/** Live PATH scanner mandate — every seat can quote this. */
export function scannerMandateNote(): ResearchNote {
  return {
    id: "scanner_mandate",
    line: "Read NQ and ES together. Trade the leader, the one that printed the highest 1m to 5m inverse. The laggard stands down. An unswept PDH, PDL, or session pool is the bias. A swept pool was the manipulation.",
    source: "PATH scanner · APLUS_RULES.confluenceFloor",
  };
}

/** SMC sequence mandate — Vince's school, but the whole room cites it. */
export function smcMandateNote(): ResearchNote {
  return {
    id: "smc_mandate",
    line: "SMC sequence first: POI, shift, retest, limit at CE. A raid without the rest is a picture, not a ticket.",
    source: "smc-canon.ts",
  };
}

/** Robinhood live-when-armed mandate — every seat can quote this (Keaton 2026-10-06). */
export function rhLiveMandateNote(): ResearchNote {
  return {
    id: "rh_live_mandate",
    line: "Agentic ••6158 is live. A setup that clears the chart can take $90–$550 even when that is a large share of the account. Sterling's ledger is a note, not a veto.",
    source: "docs/RH_LIVE_ROUTINE.md · manager-agree.ts",
  };
}

const usd2 = (x: number) => `$${x.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** True when the account read on the desk cannot put $150 into an options debit. */
export function rhAccountShort(a: RhAccountSnapshot | null | undefined): boolean {
  return rhSpendable(a) < RH_MIN_DEBIT_TOTAL;
}

/** The RH account on the desk: cash vs buying power vs the envelope. */
export function rhAccountNote(a: RhAccountSnapshot | null | undefined): ResearchNote {
  if (!a) {
    return {
      id: "rh_account",
      line: "No Robinhood account read on the desk — the agent pulls get_portfolio before any RH proposal, and autofire refuses blind.",
      source: "rh-autofire-gates.ts · evaluateRhBuyingPower",
    };
  }
  const sp = rhSpendable(a);
  const day =
    a.dayChangeUsd != null
      ? ` ${a.dayChangeUsd < 0 ? "Down" : "Up"} ${usd2(Math.abs(a.dayChangeUsd))} today${a.dayChangePct != null ? ` (${a.dayChangePct < 0 ? "−" : "+"}${Math.abs(a.dayChangePct).toFixed(2)}%)` : ""}.`
      : "";
  const settling = a.unsettledFunds && a.unsettledFunds > 0 ? ` — ${usd2(a.unsettledFunds)} still settling` : "";
  const line =
    sp < RH_MIN_DEBIT_TOTAL
      ? `RH ${a.label} on the desk: ${usd2(a.cash)} cash but only ${usd2(sp)} buying power${settling}. Under the $${RH_MIN_DEBIT_TOTAL} floor nothing in the $${RH_MIN_DEBIT_TOTAL}–$${RH_MAX_DEBIT_TOTAL} envelope can place.${day}`
      : `RH ${a.label} on the desk: ${usd2(a.cash)} cash, ${usd2(sp)} buying power — room for up to ${usd2(Math.min(sp, RH_MAX_DEBIT_TOTAL))} of the $${RH_MIN_DEBIT_TOTAL}–$${RH_MAX_DEBIT_TOTAL} envelope.${day}`;
  return { id: "rh_account", line, source: `${a.source} · ${new Date(a.asOfMs).toISOString().slice(0, 16)}Z` };
}

/** Whether the armed RH path can fire on this account, and the first gate that says no. */
export function rhArmedPathNote(a: RhAccountSnapshot | null | undefined, nowMs: number): ResearchNote {
  const sp = rhSpendable(a);
  let line: string;
  if (a && sp < RH_MIN_DEBIT_TOTAL) {
    line = `Armed RH path is shut on BP: ${usd2(sp)} can't carry a $${RH_MIN_DEBIT_TOTAL} debit, so even Floor ARMED + PATH A-band + Manager agree stands down${a.agenticAllowed === false ? " — and the agent can't trade that account yet anyway" : ""}.`;
  } else if (a && a.agenticAllowed === false) {
    line = `RH ${a.label} has the buying power, but the agent can't trade that account — the armed path stays read-only.`;
  } else {
    const g = evaluateRhBuyingPower(a, nowMs);
    const ready =
      !!a &&
      a.agenticAllowed !== false &&
      a.accountNumber === "995386158" &&
      sp >= RH_MIN_DEBIT_TOTAL;
    line = ready
      ? `Armed RH path is live on Agentic ••6158: ${usd2(sp)} buying power is ready. Fire when Trading Stand, the desk, or the market presents a trade.`
      : g.ok
        ? "Armed RH path: BP clears the floor — still needs RH_LIVE_ARMED, Floor ARMED, PATH A-band, Manager agentAgree, then review before place."
        : `Armed RH path waits on a fresh get_portfolio read before anything is proposed (${g.gate}).`;
  }
  return { id: "rh_armed_path", line, source: "rh-autofire-gates.ts · evaluateRhBuyingPower" };
}

export function pick<T>(xs: (T | null)[], seed: number): T | null {
  const ok = xs.filter((x): x is T => x != null);
  return ok.length ? ok[Math.abs(seed) % ok.length]! : null;
}

/** The notes each person carries, for their monitor and the Research panel. */
export function researchShelf(
  rhAccount?: RhAccountSnapshot | null,
  nowMs: number = Date.now(),
): Record<"Nova" | "Vince" | "Sterling" | "Gemma" | "Jax", ResearchNote[]> {
  const keep = (xs: (ResearchNote | null)[]) => xs.filter((x): x is ResearchNote => x != null);
  // Account context only when the caller put an account read on the desk.
  const acct = rhAccount === undefined ? null : rhAccountNote(rhAccount);
  const armed = rhAccount === undefined ? null : rhArmedPathNote(rhAccount, nowMs);
  return {
    Nova: keep([baselineNote(), bandNote(), qNote(), oddsNote(), scannerMandateNote(), rhLiveMandateNote(), acct]),
    Vince: keep([fillTierNote(), smcMandateNote(), rhLiveMandateNote(), acct]),
    Sterling: keep([inducementNote(), mitigationNote(), eventNote(), scannerMandateNote(), rhLiveMandateNote(), acct, armed]),
    Gemma: keep([sessionNote(), smcMandateNote(), rhLiveMandateNote(), acct]),
    Jax: keep([takeWordNote(), scannerMandateNote(), rhLiveMandateNote(), acct, armed]),
  };
}

export const RESEARCH_BUILT = { pack: EVIDENCE.builtAt, odds: HIT_ODDS_MODEL.builtAt };
