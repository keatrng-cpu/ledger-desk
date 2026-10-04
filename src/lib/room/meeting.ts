/**
 * THE MEETING — what the five say to each other this cycle.
 *
 * Not five monologues: an exchange. Somebody opens, somebody pushes, somebody
 * answers with the desk's own measurement, Sterling rules, Vince routes. Lines
 * address each other by name, quote the person's school (smc-canon.ts), and
 * bring back what the room remembers (agents.ts: scored calls, vetoes priced
 * after the fact, who is on a heater and who is on thin ice).
 *
 * Every number in every line is read from the cycle's facts, the desk's
 * research files (research.ts) or the room's own memory — never written here.
 * Animations are chosen per line and then fitted to where the person is
 * standing, so nobody writes on a whiteboard from the watercooler.
 */

import { APLUS_RULES } from "@/lib/aplus/config";
import { etWallParts } from "@/lib/trading/sessions";
import { SCHOOLS } from "@/lib/trading/smc-canon";
import {
  CREW,
  TRAITS,
  lastScored,
  rankTitle,
  recordLine,
  relationWord,
  type Activity,
  type AgentAct,
  type Agenda,
  type MindState,
  type Meeting,
  type Places,
} from "./agents";
import {
  STOP_TXT,
  clockEt,
  contractName,
  pctOf,
  prem,
  px,
  ptsTxt,
  rSigned,
  sideWord,
  signedPct,
  usd,
} from "./format";
import { challengeFor, preMortem, rebuttalFor, strikeWhy, tallyLine, thesisOwner, type Lenses } from "./debate";
import type { LabRead } from "./lab";
import { ROOM_CLOCK, ROOM_MANDATE } from "./mandate";
import { attribute, type HoldRead } from "./quant";
import { HALF_SPREAD, ivFor, ivSource, quoteOption, type Underlier } from "./option-math";
import {
  bandNote,
  baselineNote,
  fillTierNote,
  inducementNote,
  mitigationNote,
  oddsNote,
  pick,
  qNote,
  sessionNote,
  takeWordNote,
} from "./research";
import type {
  Animation,
  Beat,
  Character,
  DialogueLine,
  EntryPlan,
  ExitPlan,
  Gate,
  RoomDeskRead,
  RoomEntryRead,
  RoomInput,
  RoomLedger,
  RoomTrace,
  Trend,
} from "./orchestrator";

export interface Facts {
  input: RoomInput;
  desk: RoomDeskRead | null;
  ledger: RoomLedger | null;
  beat: Beat;
  exit: ExitPlan | null;
  entry: EntryPlan | null;
  card: RoomEntryRead | null;
  refusal: string | null;
  refusalGate: string | null;
  gates: Gate[];
  focus: RoomTrace["focus"];
  etMin: number;
  etDate: string;
  seed: number;
  nowMs: number;
  errors: string[];
  agenda: Agenda | null;
  /** quant.ts holdValue per open position. */
  holds: Record<string, HoldRead | null>;
  /** Each person's own P(T1 before the flat) for the card under review. */
  lenses: Lenses | null;
  /** What the ghost room and the calibration ledger have learned so far. */
  lab: LabRead | null;
}

type Line = { who: Character; text: string; want: Animation };

const say = (who: Character, text: string, want: Animation): Line => ({ who, text: text.replace(/\s+/g, " ").trim(), want });

/* ── Shared reads ───────────────────────────────────────────────────────── */

const trendWord = (t: Trend) => (t === "BULLISH" ? "bullish" : t === "BEARISH" ? "bearish" : "choppy");

function vixOf(f: Facts): number {
  return Math.max(f.input.market_data.SPY.vix, f.input.market_data.QQQ.vix);
}

function vixTxt(f: Facts): string {
  const v = vixOf(f);
  return v > 0 ? `VIX ${v.toFixed(1)}` : "no VIX print";
}

function htfLine(f: Facts): string {
  const d = f.desk;
  if (!d) return `Tags: QQQ ${trendWord(f.input.market_data.QQQ.trend)}, SPY ${trendWord(f.input.market_data.SPY.trend)}.`;
  return `HTF ${d.futures.QQQ.symbol} ${d.htf.QQQ}, ${d.futures.SPY.symbol} ${d.htf.SPY}.`;
}

function printLine(f: Facts): string {
  const a = f.agenda?.next;
  const d = f.desk?.news.next;
  const n = a ? { name: a.name, timeEt: a.timeEt, minutes: a.minutes } : d ? { name: d.name, timeEt: d.timeEt, minutes: d.minutesAway } : null;
  if (!n) return "No high-impact print in range.";
  return n.minutes <= 90 ? `${n.name} at ${n.timeEt} ET — ${n.minutes} min out.` : `Next print: ${n.name} ${n.timeEt} ET.`;
}

function hotTape(f: Facts): Underlier | null {
  const m = f.input.market_data;
  return m.QQQ.volume_spike ? "QQQ" : m.SPY.volume_spike ? "SPY" : null;
}

/** The direction Jax pushes on this cycle — his chase call — or null. */
export function jaxPush(f: Pick<Facts, "beat" | "card" | "input">): { underlier: Underlier; dir: 1 | -1 } | null {
  if ((f.beat === "trigger_wait" || f.beat === "vetoed") && f.card)
    return { underlier: f.card.underlier, dir: f.card.type === "CALL" ? 1 : -1 };
  if (f.beat !== "blocked" && f.beat !== "chop" && f.beat !== "holding" && f.beat !== "blind") return null;
  const m = f.input.market_data;
  const hot: Underlier | null = m.QQQ.volume_spike ? "QQQ" : m.SPY.volume_spike ? "SPY" : null;
  if (!hot) return null;
  const t = m[hot];
  // Jax trades the tape's momentum, not the higher frame — that is the whole of his job.
  const dir: 1 | -1 = t.rsi >= 55 ? 1 : t.rsi <= 45 ? -1 : t.trend === "BEARISH" ? -1 : 1;
  return { underlier: hot, dir };
}

function jaxMemory(minds: MindState | null): string | null {
  const m = lastScored(minds, "chase_call", "Jax");
  if (!m?.outcome || m.outcome.movePct == null || !m.call) return null;
  const pct = `${m.outcome.movePct >= 0 ? "+" : "−"}${Math.abs(m.outcome.movePct).toFixed(2)}%`;
  return m.outcome.verdict === "right"
    ? `You were right at ${m.clock}, I'll give you that — ${m.call.underlier} went ${pct} your way in thirty minutes.`
    : `Like ${m.clock}, Jax? ${m.call.underlier} went ${pct} on your call thirty minutes later.`;
}

function vetoMemory(minds: MindState | null): { line: string; verdict: "saved" | "cost" } | null {
  const m = lastScored(minds, "veto", "Sterling");
  if (!m?.outcome || m.outcome.usd == null) return null;
  const v = m.outcome.verdict === "saved" ? "saved" : "cost";
  return { line: `The ${m.clock} veto ${v === "saved" ? "saved" : "cost"} ${usd(Math.abs(m.outcome.usd))} on the model thirty minutes later.`, verdict: v };
}

function creed(who: Character): string {
  return TRAITS[who].creed;
}

/* ── Per-beat scripts ───────────────────────────────────────────────────── */

function rejected(f: Facts): Line[] {
  return [
    say("Vince", "Feed came in malformed — the router's idle.", "STEADY_MONITORING"),
    say("Sterling", `Input rejected: ${f.errors.slice(0, 2).join("; ")}. Nothing opens and nothing closes on data I can't verify.`, "CROSSING_ARMS"),
    say("Jax", "Fix the pipe and give me a tape.", "FURIOUS_TYPING"),
    say("Nova", `${f.errors.length} field error${f.errors.length === 1 ? "" : "s"}. I'm not pricing a guess.`, "ANALYZING"),
    say("Gemma", "No tape, no brief.", "EXPLAINING"),
  ];
}

function closed(f: Facts): Line[] {
  const d = f.desk;
  const q = f.input.market_data.QQQ;
  const s = f.input.market_data.SPY;
  const week = d?.weekTrade ? ` Week card: ${d.weekTrade}` : "";
  const opener = !d
    ? "No desk read and no session. Quiet floor."
    : d.holiday
      ? `Cash holiday — nothing lists today.${week}`
      : !d.isWeekday
        ? `Weekend. ${d.nextWindow ? `Next window: ${d.nextWindow}.` : ""}${week}`
        : f.etMin < ROOM_CLOCK.optionsOpenMin
          ? `Pre-market — options list at 09:30 ET. ${htfLine(f)}${week}`
          : `Cash is done for the day. ${htfLine(f)}`;
  const note = pick([baselineNote(), bandNote(), qNote(), oddsNote(), sessionNote()], f.seed);
  const banter = [
    `Gemma, QQQ ${px(q.price)} and SPY ${px(s.price)}, and I can't click either one.`,
    "Replaying this morning's tape on my phone. Don't judge me.",
    `RSI ${Math.round(q.rsi)} on QQQ and the market's shut. Cruel.`,
  ][f.seed % 3]!;
  const quip = ["So what IS the edge, then?", "You always say that.", "Fine. What would make it a trade?"][f.seed % 3]!;
  const book = f.ledger ? `Book: ${f.input.portfolio.open_positions.length}/${ROOM_MANDATE.maxOpenPositions} open, day ${usd(f.ledger.realizedTodayUsd)}.` : "";
  return [
    say("Gemma", opener, "EXPLAINING"),
    say("Jax", banter, "FURIOUS_TYPING"),
    say("Nova", note ? `Use the quiet, Jax. ${note.line}` : `${vixTxt(f)}. Nothing to price while it's shut.`, "NODDING"),
    say("Jax", quip, "POINTING"),
    say("Sterling", `What makes a trade is the desk's word, the CE touch and my list — in that order. ${book}`, "CHECKING_TABLET"),
    say("Vince", `Options closed. Nothing routes until 09:30 ET.${d?.lagSec != null ? ` Futures feed ${d.feed}.` : ""}`, "STEADY_MONITORING"),
  ];
}

function blind(f: Facts): Line[] {
  const hot = hotTape(f);
  const t = hot ? f.input.market_data[hot] : f.input.market_data.QQQ;
  const push = jaxPush(f);
  return [
    say(
      "Jax",
      hot && push
        ? `${hot} ${px(t.price)}, RSI ${Math.round(t.rsi)}, volume spiking — ${push.dir > 0 ? "calls" : "puts"}, NOW.`
        : `QQQ ${px(f.input.market_data.QQQ.price)}, RSI ${Math.round(f.input.market_data.QQQ.rsi)}. Give me something.`,
      "SHOUTING",
    ),
    say("Sterling", "No desk read on the wire, Jax. I manage exits on the marks; nothing opens on RSI and a trend tag.", "CROSSING_ARMS"),
    say("Nova", "RSI and the spike aren't the desk's gates — the sequence is, and I can't see it from here.", "ANALYZING"),
    say("Gemma", `No HTF, no calendar, no killzone. ${htfLine(f)} That's a label, not a bias.`, "EXPLAINING"),
    say("Vince", focusQuote(f), "STEADY_MONITORING"),
  ];
}

function focusQuote(f: Facts): string {
  const q = f.focus.quote;
  const src = f.desk ? f.desk.spotSource[f.focus.underlier] : `${f.focus.underlier} ${px(f.input.market_data[f.focus.underlier].price)} (caller)`;
  return q
    ? `${contractName(f.focus.underlier, q.strike, f.focus.type, f.focus.exp)} ${prem(q.bid)} × ${prem(q.ask)} (model, ${prem(q.ask - q.bid)} wide) · ${src}. Nothing to route.`
    : "Nothing to route.";
}

function blocked(f: Facts, minds: MindState | null): Line[] {
  const c = f.card!;
  const d = f.desk;
  const hot = hotTape(f);
  const push = jaxPush(f);
  const gemma = d?.judas
    ? `Judas window until 09:45. Whatever runs off the open is the raid until it fails — name it, don't trade it. ${htfLine(f)}`
    : d?.news.blackout
      ? `${d.news.reason || "News blackout"} — ±15 minutes, hands off. The first impulse off a release is usually the raid. ${htfLine(f)}`
      : `${htfLine(f)} ${printLine(f)}`;
  const jax =
    hot && push
      ? `Volume spike on ${hot} at ${px(f.input.market_data[hot].price)}, RSI ${Math.round(f.input.market_data[hot].rsi)} — ${push.dir > 0 ? "calls" : "puts"}, NOW. Why are we flat?!`
      : c.smcWord === "WAIT"
        ? `${c.futSymbol} is one layer off — ${c.smcMissing}. The raid's right there, let me in already.`
        : `${c.futSymbol} ${c.futSide} is setting up. I can feel it.`;
  const memory = jaxMemory(minds);
  const lines: Line[] = [
    say("Gemma", gemma, "GESTICURING_AT_WALL"),
    say("Jax", jax, hot ? "SHOUTING" : "FURIOUS_TYPING"),
    say(
      "Nova",
      `Jax — ${c.name}: SMC ${c.smcWord}${c.smcWord !== "TAKE" ? `, missing ${c.smcMissing}` : ""}.${hot ? " RSI and the spike aren't gates; the sequence is." : ""}${memory ? ` ${memory}` : ""}`,
      "ANALYZING",
    ),
    say("Jax", d?.judas ? "So what turns it on?" : "Fine — what does it need?", "POINTING"),
    say(
      "Nova",
      d?.judas
        ? "09:45, and a raid that closes back inside the pool it took. Then the sequence prices a CE and Vince rests a limit there."
        : `${c.smcMissing} prints, the sequence prices a CE, and Vince rests the limit there. Until then it's a picture.`,
      "WRITING_ON_WHITEBOARD",
    ),
    say("Sterling", `Desk ${c.verdict}: ${(c.blocks[0] ?? c.smcMissing).replace(/\.$/, "")}. Nothing to clear.${patternWarning(c)}`, "CHECKING_TABLET"),
    say("Vince", focusQuote(f), "STEADY_MONITORING"),
  ];
  return lines;
}

function patternWarning(c: RoomEntryRead | null): string {
  if (!c?.patterns) return "";
  if (c.patterns.inducement) {
    const n = inducementNote();
    return n ? ` And the card shows a decoy sweep: ${n.line}` : "";
  }
  if (c.patterns.mitigation) {
    const n = mitigationNote();
    return n ? ` And there's a mitigation block on it: ${n.line}` : "";
  }
  return "";
}

function greeksLine(f: Facts): string {
  const e = f.entry!;
  const q = e.quote;
  return (
    `${e.offset} ${contractName(e.entry.underlier, q.strike, e.entry.type, e.exp)}: ${Math.abs(q.delta).toFixed(2)}Δ, mid ${prem(q.mid)}, IV ${(q.iv * 100).toFixed(1)}% (${ivSource(vixOf(f))}, model — not a chain mid). ` +
    `Theta to 11:00 eats ${Math.round(e.decay * 100)}% of the ${STOP_TXT} stop${e.decay >= 1 ? " — it's a clock" : e.clock ? " — nearly a clock" : ""}. ` +
    `P(T1|fill) ${pctOf(e.entry.pT1)}, E[R] ${rSigned(e.entry.expR)} per fill.`
  );
}

function where(c: RoomEntryRead): string {
  return c.awayPts == null ? "right there" : c.awayPts === 0 ? "sitting ON the CE" : `${ptsTxt(c.awayPts)} off the CE`;
}

function triggerWait(f: Facts, minds: MindState | null): Line[] {
  const c = f.card!;
  const e = f.entry!;
  const fill = fillTierNote();
  const memory = jaxMemory(minds);
  const tjrNeverChase = SCHOOLS.tjr.sequence.find((s) => /never chase/i.test(s)) ?? "Enter on the shift or first clean retrace — never chase";
  return [
    say("Gemma", `${htfLine(f)} The ${c.futSymbol} ${c.futSide} is ${aligned(f, c) ? "with" : "AGAINST"} the higher frame. ${printLine(f)}`, "GESTICURING_AT_WALL"),
    say("Jax", `${c.futSymbol} ${c.futSide}, PATH ${c.band ?? "—"} — ${where(c)}. ${sideWord(c.type).toUpperCase()}, now, before it leaves!`, "POINTING"),
    say("Vince", `We rest at CE ${px(c.plan?.entry ?? 0)}, Jax. ${fill ? fill.line : ""}`, c.tier === "armed" ? "THUMBS_UP" : "STEADY_MONITORING"),
    say("Jax", "And if it never comes back?", "SHOUTING"),
    say("Vince", `Then we didn't pay for a move we missed. Your own school says it: "${tjrNeverChase}." ${c.awayPts != null ? `${ptsTxt(c.awayPts)} away, ${(c.tier ?? "—").toUpperCase()}.` : ""}`, c.tier === "armed" ? "THUMBS_UP" : "STEADY_MONITORING"),
    say("Nova", `${greeksLine(f)}${memory ? ` ${memory}` : ""}`, "WRITING_ON_WHITEBOARD"),
    say("Sterling", `Pre-cleared: ${e.qty}× ≤ ${usd(e.capUsd)}. It fires on the CE touch and nothing else.`, "CHECKING_TABLET"),
  ];
}

function aligned(f: Facts, c: RoomEntryRead): boolean {
  const want = c.futSide === "long" ? "bull" : "bear";
  return f.desk?.htf[c.underlier] === want;
}

/* ── The debate (debate.ts) — every card the room can price ───────────────── */

const OWNER_ANIM: Record<Character, Animation> = {
  Jax: "POINTING",
  Nova: "WRITING_ON_WHITEBOARD",
  Sterling: "CHECKING_TABLET",
  Gemma: "GESTICURING_AT_WALL",
  Vince: "STEADY_MONITORING",
};

function etMinOfMs(ms: number): number {
  const w = etWallParts(ms);
  return w.hour * 60 + w.minute;
}

function thesisText(c: RoomEntryRead): string {
  const pl = c.plan!;
  const rr = pl.rr1 ?? (pl.t1 != null ? Math.abs(pl.t1 - pl.entry) / Math.max(1e-9, Math.abs(pl.entry - pl.stop)) : null);
  const where_ = c.tier === "live" ? "It's ON the CE now." : c.awayPts != null ? `${ptsTxt(c.awayPts)} off the CE, ${(c.tier ?? "—").toUpperCase()}.` : "";
  return `${c.strategy ?? c.name}: ${c.futSymbol} ${c.futSide} from CE ${px(pl.entry)}, stop ${px(pl.stop)}, T1 ${pl.t1 != null ? px(pl.t1) : "—"}${rr != null ? ` (${rr.toFixed(2)}R)` : ""}, PATH ${c.band ?? "—"}. ${where_}`;
}

function priceText(e: EntryPlan): string {
  const ev = e.ev!;
  const w = ev.window;
  const by = (k: "t1" | "loss" | "none") => ev.scenarios.find((x) => x.kind === k);
  const sgn = (n: number | undefined) => `${(n ?? 0) >= 0 ? "+" : "−"}$${Math.abs(Math.round(n ?? 0))}`;
  return (
    `${contractName(e.entry.underlier, e.quote.strike, e.entry.type, e.exp)} at ${prem(e.quote.ask)}: model ${pctOf(ev.pT1Model)} to T1 in 8h, ` +
    `${pctOf(w.pT1)} before 11:00${w.measured ? ` (${Math.round(w.shareOfHitsInWindow * 100)}% of T1s land inside ${w.windowBars} bars)` : " (time curve not measured)"}. ` +
    `T1 ${sgn(by("t1")?.pnlUsd)} · loss ${sgn(by("loss")?.pnlUsd)} · flat ${sgn(by("none")?.pnlUsd)} → EV ${sgn(ev.evUsd)} a contract after ${prem(ev.spreadUsd / 100)} of spread.`
  );
}

/**
 * The structured argument over a priced card: thesis → price → challenge →
 * rebuttal → (why this strike) → everyone's number → verdict → execution.
 * Null when the card has no priced plan — the older beat script runs instead.
 */
function debate(f: Facts, minds: MindState | null, mode: "wait" | "fill" | "veto"): Line[] | null {
  const e = f.entry;
  const c = f.card;
  if (!e?.ev || !c?.plan || !f.lenses) return null;
  const ev = e.ev;
  const owner = thesisOwner(c.strategy);
  const t1 = ev.scenarios.find((x) => x.kind === "t1");
  const ch = challengeFor(c, ev, f.lab, t1 ? `${clockEt(etMinOfMs(t1.atMs))} ET` : null);
  const rb = rebuttalFor(owner, c, ev, ch);
  const lines: Line[] = [
    say(owner, thesisText(c), OWNER_ANIM[owner]),
    say("Nova", priceText(e), "WRITING_ON_WHITEBOARD"),
    say(ch.who, ch.text, ch.want),
    say(rb.who, rb.text, rb.want),
  ];
  const why = strikeWhy({ offset: e.offset, ev }, e.alt ? { offset: e.alt.offset, ev: e.alt.ev } : null);
  if (why) {
    lines.push(say("Jax", why.ask, "POINTING"));
    lines.push(say("Nova", why.answer, "NODDING"));
  } else if (!lines.some((l) => l.who === "Jax")) {
    const jaxP = Math.round(f.lenses.Jax.p * 100);
    const novaP = Math.round(f.lenses.Nova.p * 100);
    lines.push(
      say(
        "Jax",
        mode === "veto"
          ? `${jaxP}% on the picture alone, and you two want ${novaP}%. Fine — the ghost room settles it.`
          : jaxP > novaP
            ? `I'm at ${jaxP}% — the picture's better than your model says, Nova.`
            : `${jaxP}% on the geometry. Even I'm not hyped.`,
        mode === "veto" ? "SHOUTING" : "POINTING",
      ),
    );
  }
  lines.push(say("Gemma", tallyLine(f.lenses, f.lab, `${c.futSymbol}:${c.futSide}:${c.plan.entry.toFixed(2)}:${f.etDate}`), "EXPLAINING"));
  const room = f.ledger ? APLUS_RULES.dailyLossLimitPct * f.ledger.dayStartEquity + f.ledger.realizedTodayUsd : null;
  if (mode === "fill") {
    lines.push(
      say(
        "Sterling",
        `Cleared: ${e.qty}× for ${usd(e.debitUsd)} under a ${usd(e.capUsd)} cap, level first, ${STOP_TXT} behind it${room != null ? `, halt room ${usd(room)}` : ""}. ${preMortem(c, ev)}`,
        "APPROVING",
      ),
    );
    const src = f.desk ? f.desk.spotSource[c.underlier] : `${c.underlier} ${px(f.input.market_data[c.underlier].price)}`;
    lines.push(say("Vince", `BUY_OPEN ${e.qty}× ${contractName(c.underlier, e.quote.strike, c.type, e.exp)} · limit ${prem(e.quote.ask)} · ${src}. Sent.`, "SMASHING_ENTER_KEY"));
  } else if (mode === "wait") {
    if (ch.decisive) {
      lines.push(say("Sterling", "Not cleared. It's priced at its CE already — if it touches, the ledger refuses it and the ghost room takes it.", "CROSSING_ARMS"));
      lines.push(say("Vince", `Watching CE ${px(c.plan.entry)}${c.awayPts != null ? ` — ${ptsTxt(c.awayPts)} away, ${(c.tier ?? "—").toUpperCase()}` : ""}. Nothing will route on this one.`, "STEADY_MONITORING"));
    } else {
      lines.push(say("Sterling", `Pre-cleared: ${e.qty}× ≤ ${usd(e.capUsd)}, fires on the CE touch only. ${preMortem(c, ev)}`, "CHECKING_TABLET"));
      lines.push(say("Vince", `Resting at CE ${px(c.plan.entry)}${c.awayPts != null ? ` — ${ptsTxt(c.awayPts)} away, ${(c.tier ?? "—").toUpperCase()}` : ""}. Nothing crosses the spread early.`, c.tier === "armed" ? "THUMBS_UP" : "STEADY_MONITORING"));
    }
  } else {
    const gate = f.refusalGate ?? "";
    const vm = vetoMemory(minds);
    const quantGate = gate === "ev" || gate === "t1_pays";
    lines.push(
      say(
        "Sterling",
        quantGate
          ? `No. The plan can be right and this option still lose — that's the list now.${vm?.verdict === "saved" ? ` ${vm.line}` : ""}`
          : `No. ${VETO_WHY[gate] ?? (f.refusal ?? "A gate failed").replace(/\.?$/, ".")}${vm?.verdict === "saved" ? ` ${vm.line}` : ""}`,
        "CROSSING_ARMS",
      ),
    );
    lines.push(say("Vince", c.tier === "live" ? "Standing down. The ghost room takes the ticket at the ask — we'll know what the no was worth." : "Standing down. Nothing routes.", "STEADY_MONITORING"));
  }
  return lines;
}

function fill(f: Facts): Line[] {
  const e = f.entry!;
  const c = e.entry;
  const room = f.ledger ? APLUS_RULES.dailyLossLimitPct * f.ledger.dayStartEquity + f.ledger.realizedTodayUsd : null;
  const src = f.desk ? f.desk.spotSource[c.underlier] : `${c.underlier} ${px(f.input.market_data[c.underlier].price)}`;
  const odds = oddsNote();
  return [
    say("Jax", `${c.futSymbol} tagged CE ${px(c.plan?.entry ?? 0)} — ${e.qty}× ${contractName(c.underlier, e.quote.strike, c.type, e.exp)}. GO, GO, GO!`, "SHOUTING"),
    say("Nova", `Sterling — ${greeksLine(f)}`, "NODDING"),
    say(
      "Sterling",
      `Cleared. Slot ${f.input.portfolio.open_positions.length + 1}/${ROOM_MANDATE.maxOpenPositions} · debit ${usd(e.debitUsd)} under a ${usd(e.capUsd)} cap · ${STOP_TXT} = ${usd(-e.stopUsd)} · exit on the level first${room != null ? ` · day halt room ${usd(room)}` : ""}.`,
      "APPROVING",
    ),
    say("Vince", `BUY_OPEN ${e.qty}× ${contractName(c.underlier, e.quote.strike, c.type, e.exp)} · limit ${prem(e.quote.ask)} (mid ${prem(e.quote.mid)} + ${prem(HALF_SPREAD)}) · ${src}. Sent.`, "SMASHING_ENTER_KEY"),
    say("Gemma", `${htfLine(f)} If it's wrong, it's wrong at ${c.futSymbol} ${px(c.plan?.stop ?? 0)} — that's the exit, before any percentage.`, "GESTICURING_AT_WALL"),
    say("Nova", odds ? `For the record: ${odds.line}` : "For the record: most fills never see T1.", "NODDING"),
  ];
}

function holding(f: Facts): Line[] {
  const open = f.input.portfolio.open_positions;
  const best = [...open].sort((a, b) => b.pnl_percent - a.pnl_percent)[0]!;
  const t = f.input.market_data[best.ticker];
  const q = quoteOption(t.price, best.strike, best.exp, best.type, ivFor(best.ticker, t.vix), f.nowMs);
  const lv = f.desk?.held?.[best.id] ?? null;
  const toT1 =
    lv && lv.t1 != null
      ? ` ${lv.symbol} ${px(lv.price)} against T1 ${px(lv.t1)} — ${ptsTxt(Math.abs(lv.t1 - lv.price))} to go.`
      : "";
  const flatIn = ROOM_CLOCK.dayFlatMin - f.etMin;
  const room = f.ledger ? APLUS_RULES.dailyLossLimitPct * f.ledger.dayStartEquity + f.ledger.realizedTodayUsd : null;
  const hold = f.holds[best.id];
  const holdTxt = hold
    ? ` Holding is worth ${hold.edgeUsd >= 0 ? "+" : "−"}$${Math.abs(Math.round(hold.edgeUsd))} a contract over the bid — ${pctOf(hold.ev.window.pT1)} to T1 before the flat from here.`
    : "";
  const lines: Line[] = [
    say("Jax", `${best.id} ${signedPct(best.pnl_percent)} — come on, RUN.`, "FURIOUS_TYPING"),
    say("Nova", `Easy, Jax. ${best.id}: ${Math.abs(q.delta).toFixed(2)}Δ, theta ${prem(q.thetaDay)} a share a day.${toT1}${holdTxt}`, "ANALYZING"),
    say(
      "Gemma",
      `${flatIn > 0 ? `${flatIn} minutes to the 11:00 flat.` : "Past the 11:00 flat for day tickets."} ${htfLine(f)} ${printLine(f)}`,
      "EXPLAINING",
    ),
  ];
  if (f.refusalGate === "no_average" && f.card) {
    lines.push(say("Jax", "Add to it! It's working!", "SHOUTING"));
    lines.push(say("Sterling", `No. One plan, one fill — we never average into ${best.id}.`, "CROSSING_ARMS"));
  } else {
    lines.push(
      say(
        "Sterling",
        `Exits staged on ${best.id}: ${lv ? `${lv.symbol} ${px(lv.stop)} level, ` : ""}${best.trimmed ? "breakeven" : STOP_TXT}, 11:00.${room != null ? ` Halt room ${usd(room)}.` : ""}`,
        "CHECKING_TABLET",
      ),
    );
  }
  lines.push(say("Vince", `${best.id} marks ${prem(q.bid)} × ${prem(q.ask)} (model)${open.length > 1 ? ` · +${open.length - 1} more` : ""}. Nothing routes until a stop or the target.`, "STEADY_MONITORING"));
  return lines;
}

/** Nova's post-mortem: where the money came from, on the room's own model. */
function attributionLine(f: Facts): string | null {
  const x = f.exit;
  const p = x?.position;
  if (!x || !p || p.spot0 == null || p.iv0 == null || p.opened_at == null || p.entry_px == null || x.spot == null || !x.quote) return null;
  const a = attribute({
    type: p.type,
    strike: p.strike,
    exp: p.exp,
    contracts: x.qty ?? p.contracts ?? 1,
    spot0: p.spot0,
    iv0: p.iv0,
    t0Ms: p.opened_at,
    spot1: x.spot,
    iv1: x.quote.iv,
    t1Ms: f.nowMs,
    entryPx: p.entry_px,
    exitPx: x.quote.bid,
  });
  const s = (n: number) => `${n >= 0 ? "+" : "−"}$${Math.abs(Math.round(n))}`;
  return `Where it came from: price ${s(a.price)}, clock ${s(a.time)}, IV ${s(a.vol)}, crossings ${s(a.spread)} — ${s(a.total)} on this close.`;
}

function exitLines(f: Facts): Line[] {
  const x = f.exit!;
  const p = x.position;
  const src = f.desk ? f.desk.spotSource[p.ticker] : `${p.ticker} ${px(f.input.market_data[p.ticker].price)}`;
  const vince = say(
    "Vince",
    `SELL_CLOSE ${x.qty == null ? "all" : `${x.qty}×`} ${p.id} · limit ${x.quote ? prem(x.quote.bid) : "market"} (mid − ${prem(HALF_SPREAD)}) · ${src}. Sent.`,
    "SMASHING_ENTER_KEY",
  );
  const sterling = say(
    "Sterling",
    `Confirmed — ${x.reason.replace("_", " ")}: ${x.why}. ${x.closesAll ? "All of it." : `${x.qty} contract${x.qty === 1 ? "" : "s"} now; the rest rides with the stop at breakeven.`}`,
    "APPROVING",
  );
  const nova = say(
    "Nova",
    x.quote ? `${p.id}: bid ${prem(x.quote.bid)}, ${Math.abs(x.quote.delta).toFixed(2)}Δ, theta ${prem(x.quote.thetaDay)} a share a day. ${signedPct(p.pnl_percent)} on the mark.` : `${p.id}: ${signedPct(p.pnl_percent)} on the mark.`,
    "WRITING_ON_WHITEBOARD",
  );
  const post = attributionLine(f);
  if (x.reason === "take_profit" || x.reason === "t2" || x.reason === "t1") {
    const odds = oddsNote();
    return [
      say("Jax", `${p.id} ${signedPct(p.pnl_percent)} — pay me!`, "POINTING"),
      sterling,
      vince,
      nova,
      say(
        "Gemma",
        x.reason === "t1"
          ? `${htfLine(f)} T1 is the draw — the desk measured half off here, stop to breakeven, as the rule that pays.`
          : `${htfLine(f)} The draw printed — bank it and let the higher frame carry what's left.`,
        "GESTICURING_AT_WALL",
      ),
      say("Nova", post ?? (odds ? `Take it gladly. ${odds.line}` : "Take it gladly."), "NODDING"),
    ];
  }
  if (x.reason === "theta" || x.reason === "event") {
    return [
      say(
        "Nova",
        x.reason === "theta" ? `Theta stop: ${x.why}.` : `Release guard: ${x.why}.`,
        "WRITING_ON_WHITEBOARD",
      ),
      say("Jax", x.reason === "theta" ? `It hasn't even failed yet!` : "We're green and you want OUT before the number?", "SHOUTING"),
      say(
        "Sterling",
        x.reason === "theta"
          ? "It hasn't failed. It's run out of time to be worth what it costs to hold. Those are different things, and the ghost room tracks both."
          : "A print can gap straight through a level stop, and long premium eats the IV drop after it. Untrimmed premium doesn't sit through one.",
        "CROSSING_ARMS",
      ),
      sterling,
      vince,
      say("Gemma", post ?? `${htfLine(f)} ${printLine(f)}`, "EXPLAINING"),
    ];
  }
  if (x.reason === "time" || x.reason === "expiry") {
    return [
      say("Gemma", `${clockEt(f.etMin)} ET — the morning's delivery window is over; nothing on my calendar argues for staying.`, "GESTICURING_AT_WALL"),
      say("Jax", `Already? Fine — flat ${p.id} at ${signedPct(p.pnl_percent)}.`, "SHOUTING"),
      sterling,
      vince,
      nova,
    ];
  }
  // stop, level, failed hold
  return [
    say("Jax", `${p.id} at ${signedPct(p.pnl_percent)} — cut it, CUT IT.`, "SHOUTING"),
    say("Nova", x.reason === "stop" ? `${STOP_TXT} brake: ${x.why}.` : `${x.why}.`, "WRITING_ON_WHITEBOARD"),
    sterling,
    vince,
    say(
      "Gemma",
      x.reason === "stop"
        ? "The brake fired before the level did. That's what a backstop is for."
        : "The plan's level broke. No macro story saves a broken level.",
      "EXPLAINING",
    ),
  ];
}

const VETO_WHY: Record<string, string> = {
  one_book: "One book a day — MNQ or ES, never both. Two underliers on one morning is the same bet twice.",
  one_bias: "We don't buy the other side of our own position.",
  slots: "Three is the ceiling. We manage what we have.",
  cash_cap: "We don't buy smaller to make a contract fit the cap.",
  halt_day: "The day halt is the day halt. We're done until tomorrow.",
  halt_week: "The weekly halt is hit. Nothing new this week.",
  killzone: "Two entries a killzone. That's the cap.",
  after_ten: "After 10:00 it's A+ only, and this isn't one.",
  month: "Nine PATH a month, then A+ only.",
  cooldown: "Two losses in a row — A+ only until the streak breaks.",
  clock: "The stop would fire on theta before price ever got a vote. That's a clock, not a stop.",
  before_flat: "It's past the 11:00 flat. Day tickets don't start now.",
  trigger: "Price walked off the plan. A new plan, or nothing.",
  no_average: "One plan, one fill. We never average.",
  ledger: "No book counters, no halt check, no ticket.",
};

function vetoed(f: Facts, minds: MindState | null): Line[] {
  const c = f.card!;
  const gate = f.refusalGate ?? "";
  const tone = relationWord(minds, "Jax", "Sterling");
  const vm = vetoMemory(minds);
  const jaxBack =
    vm?.verdict === "cost"
      ? `${vm.line} Remember that, Sterling?`
      : tone === "respect"
        ? `Fine. You were right last time. It's still a PATH ${c.band ?? "—"}.`
        : tone === "grudge"
          ? `Of course you do. It's a PATH ${c.band ?? "—"} sitting right there!`
          : `It's a PATH ${c.band ?? "—"}, Sterling! It's right there!`;
  const rec = recordLine(minds, "Sterling");
  return [
    say("Jax", `${c.futSymbol} ${c.futSide}, PATH ${c.band ?? "—"} — ${where(c)}. ${sideWord(c.type).toUpperCase()}, now!`, "POINTING"),
    say("Nova", f.entry ? greeksLine(f) : `${c.name}: the desk armed it.`, "WRITING_ON_WHITEBOARD"),
    say("Sterling", `No. ${(f.refusal ?? "A gate failed").replace(/\.?$/, ".")}`, "CROSSING_ARMS"),
    say("Jax", jaxBack, "SHOUTING"),
    say("Sterling", `${VETO_WHY[gate] ?? "The list is the list."}${vm?.verdict === "saved" ? ` ${vm.line}` : rec ? ` My ${rec}.` : ""}`, "CROSSING_ARMS"),
    say("Gemma", `${htfLine(f)} The setup's fine; the book isn't.`, "GESTICURING_AT_WALL"),
    say("Vince", "Standing down. Nothing routes.", "STEADY_MONITORING"),
  ];
}

/** Where Jax says he is going on a dead tape — the people layer decides, the line follows. */
const JAX_ERRAND: Partial<Record<Activity, string>> = {
  coffee: "I'm getting coffee.",
  cooler: "Water run.",
  couch: "I'm taking the couch.",
  tv: "I'll be at the news TV.",
  window: "I need a window.",
  chat: "Who's at the bar?",
  phone: "Taking a call.",
};

/** What the ghost room and the calibration ledger can say out loud yet. */
function labNote(f: Facts): { line: string } | null {
  const l = f.lab;
  if (!l) return null;
  const notes: string[] = [];
  if (l.twins.n >= 1)
    notes.push(
      `Ghost room: over ${l.twins.n} fill${l.twins.n === 1 ? "" : "s"}, the room's exits made ${l.twins.roomUsd >= 0 ? "+" : "−"}$${Math.abs(Math.round(l.twins.roomUsd))} against ${l.twins.mandateUsd >= 0 ? "+" : "−"}$${Math.abs(Math.round(l.twins.mandateUsd))} for the mandate alone.`,
    );
  const r = l.refusals[0];
  if (r) notes.push(`Ghost room: the ${r.n} ticket${r.n === 1 ? "" : "s"} refused on "${r.gate}" would have made ${r.pnlUsd >= 0 ? "+" : "−"}$${Math.abs(Math.round(r.pnlUsd))} — ${r.wins} winner${r.wins === 1 ? "" : "s"}.`);
  if (l.calibration.n >= 3 && l.calibration.meanP != null && l.calibration.hitRate != null)
    notes.push(`Calibration: I've said ${pctOf(l.calibration.meanP)} on ${l.calibration.n} plans; ${pctOf(l.calibration.hitRate)} reached T1 before 11:00.`);
  return notes.length ? { line: notes[f.seed % notes.length]! } : null;
}

function chop(f: Facts, minds: MindState | null, acts: Partial<Record<Character, AgentAct>> | null): Line[] {
  const q = f.input.market_data.QQQ;
  const s = f.input.market_data.SPY;
  const note = pick([baselineNote(), bandNote(), qNote(), oddsNote(), sessionNote(), takeWordNote(), labNote(f)], f.seed);
  const jaxRank = minds ? minds.rank.Jax : 50;
  const jaxRec = recordLine(minds, "Jax");
  const room = f.ledger ? APLUS_RULES.dailyLossLimitPct * f.ledger.dayStartEquity + f.ledger.realizedTodayUsd : null;
  const errandAct = acts?.Jax?.act ?? "desk";
  const errand = JAX_ERRAND[errandAct] ?? null;
  return [
    say(
      "Jax",
      `QQQ ${px(q.price)}, RSI ${Math.round(q.rsi)} · SPY ${px(s.price)}, RSI ${Math.round(s.rsi)}. Dead tape. ${errand ?? "I'm staying on the screens anyway."}`,
      "FURIOUS_TYPING",
    ),
    say("Gemma", `${errandAct === "coffee" ? "Bring me one. " : ""}${printLine(f)}`, "EXPLAINING"),
    say("Nova", note ? `${errand ? "While you're up" : "For the record"}: ${note.line}` : `${vixTxt(f)}. Nothing priced to trade.`, "NODDING"),
    say(
      "Jax",
      jaxRec
        ? `I'm ${jaxRec}. ${jaxRank >= 58 ? "Just saying." : "Don't say it."}`
        : ["You're no fun.", "Then what IS the edge?", errandAct === "coffee" ? "Noted. Still getting coffee." : "Noted."][f.seed % 3]!,
      "POINTING",
    ),
    say(
      "Sterling",
      `Book: ${f.input.portfolio.open_positions.length}/${ROOM_MANDATE.maxOpenPositions} open${f.ledger ? `, day ${usd(f.ledger.realizedTodayUsd)}` : ""}${room != null ? `, halt room ${usd(room)}` : ""}.${f.refusal ? ` Binding: ${f.refusal.replace(/\.$/, "")}.` : ""}`,
      "CHECKING_TABLET",
    ),
    say("Vince", focusQuote(f), "STEADY_MONITORING"),
  ];
}

/* ── Director meetings ──────────────────────────────────────────────────── */

function brief(f: Facts): Line[] {
  const q = f.input.market_data.QQQ;
  const s = f.input.market_data.SPY;
  const ground = pick([baselineNote(), bandNote(), qNote()], f.seed);
  const fill = fillTierNote();
  const room = f.ledger ? APLUS_RULES.dailyLossLimitPct * f.ledger.dayStartEquity + f.ledger.realizedTodayUsd : null;
  return [
    say("Gemma", `Morning. ${htfLine(f)} ${printLine(f)}${f.desk?.weekTrade ? ` Week card: ${f.desk.weekTrade}` : ""}`, "GESTICURING_AT_WALL"),
    say("Nova", ground ? `On the board for today: ${ground.line}` : "Same rules as yesterday.", "WRITING_ON_WHITEBOARD"),
    say("Jax", `QQQ ${px(q.price)}, SPY ${px(s.price)}. I want the first sweep — sweep, 5m context, 1m trigger.`, "POINTING"),
    say("Sterling", `${room != null ? `Halt room ${usd(room)} today. ` : ""}Judas 09:30–09:45 is ours to watch, not to trade.`, "CROSSING_ARMS"),
    say("Vince", `Orders rest at CE or they don't go. ${fill ? fill.line : ""}`, "THUMBS_UP"),
  ];
}

function preNews(f: Facts, m: Meeting): Line[] {
  const e = m.event!;
  const open = f.input.portfolio.open_positions.length;
  const [hh, mm] = e.timeEt.split(":").map(Number);
  const t = (hh ?? 0) * 60 + (mm ?? 0);
  return [
    say("Gemma", `${e.name} at ${e.timeEt} ET — ${e.minutes} minutes. The blackout runs ${clockEt(t - 15)}–${clockEt(t + 15)}; nothing new opens inside it.`, "GESTICURING_AT_WALL"),
    say("Jax", "So we load up before it prints?", "POINTING"),
    say("Gemma", "No. The first impulse off a release is usually the raid. We trade the retest, after.", "EXPLAINING"),
    say("Nova", "And the print's direction isn't an edge — the desk tested the release-direction idea on four years and rejected it.", "WRITING_ON_WHITEBOARD"),
    say("Sterling", open ? `${open} open. Those keep their level exits through it; nothing new until ${clockEt(t + 15)}.` : "We're flat into it. Good.", "CROSSING_ARMS"),
    say("Vince", `Orders off until ${clockEt(t + 15)}. I'll have quotes up the second it prints.`, "STEADY_MONITORING"),
  ];
}

function postNews(f: Facts, m: Meeting): Line[] {
  const e = m.event!;
  const printed = e.actual ? `${e.name} printed ${e.actual}${e.vs ? ` vs ${e.vs}` : ""}.` : `${e.name} is out — the desk hasn't stamped the actual yet.`;
  const move = e.move
    ? `${e.move.symbol} went ${e.move.pct >= 0 ? "+" : "−"}${Math.abs(e.move.pct).toFixed(2)}% in the ${e.move.window}`
    : null;
  const setup = f.agenda?.setup;
  return [
    say("Gemma", printed, "GESTICURING_AT_WALL"),
    say("Jax", move ? `${move} — that's the move!` : "Did it move? Tell me it moved.", "SHOUTING"),
    say("Nova", "That was the first impulse, Jax. The retest is the trade — if the sequence prices one.", "WRITING_ON_WHITEBOARD"),
    say("Sterling", `Blackout's over. Same list as always.${setup ? ` Card on the board: ${setup.band} ${setup.symbol} ${setup.side}.` : ""}`, "CHECKING_TABLET"),
    say("Vince", `Quotes are back. ${focusQuote(f)}`, "STEADY_MONITORING"),
    say("Gemma", "If it was a raid, it closes back inside the range. Watch for that.", "EXPLAINING"),
  ];
}

function setupReview(f: Facts, m: Meeting): Line[] {
  const s = m.setup!;
  const bPlus = s.band === "B+";
  const q = qNote();
  return [
    say(
      "Nova",
      `New card: ${s.symbol} ${s.side}, PATH ${s.band}, fit ${s.confluence.toFixed(2)}${s.pT1 != null ? `, P(T1|fill) ${pctOf(s.pT1)}, E[R] ${rSigned(s.expR)}` : ""}. ${s.strategy}.`,
      "WRITING_ON_WHITEBOARD",
    ),
    say("Jax", bPlus ? "B+ is still a setup! Let me at it." : `${s.band}! Let's go!`, "POINTING"),
    say(
      "Sterling",
      bPlus
        ? "B+ is paper only — half a percent on the futures book, no options ticket. That's the rule."
        : s.actionable
          ? "It's on Vince's list. It still needs the CE touch."
          : `Not armed yet${s.missing ? ` — ${s.missing}` : ""}.`,
      "CROSSING_ARMS",
    ),
    say("Gemma", `${htfLine(f)} The ${s.side} is ${f.desk?.htf[s.symbol.includes("ES") ? "SPY" : "QQQ"] === (s.side === "long" ? "bull" : "bear") ? "with" : "against"} the higher frame. ${printLine(f)}`, "GESTICURING_AT_WALL"),
    say("Vince", f.card?.plan ? `CE would be ${px(f.card.plan.entry)} on ${f.card.futSymbol}.` : "No CE priced yet — nothing to rest.", "STEADY_MONITORING"),
    say("Nova", q ? `And remember: ${q.line}` : creed("Nova"), "NODDING"),
  ];
}

function debrief(f: Facts, minds: MindState | null): Line[] {
  const L = f.ledger;
  const win = minds?.memories.find((m) => m.kind === "win");
  const stop = minds?.memories.find((m) => m.kind === "stop");
  const sterlingRec = recordLine(minds, "Sterling");
  const jaxRec = recordLine(minds, "Jax");
  const fills = minds?.memories.filter((m) => m.kind === "fill").length ?? 0;
  return [
    say("Sterling", `Close. Day ${L ? usd(L.realizedTodayUsd) : "n/a"}, ${fills} fill${fills === 1 ? "" : "s"}.${sterlingRec ? ` My ${sterlingRec}.` : ""}`, "CHECKING_TABLET"),
    say("Nova", win ? `Best of the day: ${win.text} at ${win.clock}.` : stop ? `The one that hurt: ${stop.text} at ${stop.clock}.` : "No trades to grade. The gates held.", "WRITING_ON_WHITEBOARD"),
    say("Jax", jaxRec ? `${jaxRec}. Rank says I'm ${rankTitle(minds?.rank.Jax ?? 50)}.` : `No calls scored today. Rank says I'm ${rankTitle(minds?.rank.Jax ?? 50)}.`, "POINTING"),
    say("Vince", `${fills} order${fills === 1 ? "" : "s"} routed, every one at the model ask or bid.`, "THUMBS_UP"),
    ...(ghostDebrief(f) ? [say("Sterling", ghostDebrief(f)!, "CHECKING_TABLET")] : []),
    say("Gemma", `Tomorrow: ${printLine(f)}${scoreboard(f) ? ` ${scoreboard(f)}` : ""}`, "GESTICURING_AT_WALL"),
  ];
}

/** The ghost room's day, in one sentence: what every "no" was worth, and the room's exits against the mandate. */
function ghostDebrief(f: Facts): string | null {
  const l = f.lab;
  if (!l || (!l.refusals.length && !l.twins.n)) return null;
  const s = (n: number) => `${n >= 0 ? "+" : "−"}$${Math.abs(Math.round(n))}`;
  const parts: string[] = [];
  for (const r of l.refusals.slice(0, 2)) parts.push(`"${r.gate}" refused ${r.n}, which would have made ${s(r.pnlUsd)}`);
  if (l.twins.n) parts.push(`our exits ${s(l.twins.deltaUsd)} against the mandate alone over ${l.twins.n} fill${l.twins.n === 1 ? "" : "s"}`);
  return `Ghost room: ${parts.join("; ")}.`;
}

/** Who has been right: the best-calibrated person over the plans the lab has scored. */
function scoreboard(f: Facts): string | null {
  const t = f.lab?.track;
  if (!t) return null;
  const ranked = (Object.keys(t) as Character[]).filter((c) => t[c].brier != null).sort((a, b) => t[a].brier! - t[b].brier!);
  if (!ranked.length) return null;
  const best = ranked[0]!;
  return `Best calibrated so far: ${best}, Brier ${t[best].brier!.toFixed(3)} over ${t[best].n} plans${ranked.length > 1 ? `; ${ranked[ranked.length - 1]} trails at ${t[ranked[ranked.length - 1]!].brier!.toFixed(3)}` : ""}.`;
}

function restamp(f: Facts): Line[] {
  const note = pick([bandNote(), sessionNote(), oddsNote()], f.seed);
  return [
    say("Gemma", `Restamping the week plan. ${printLine(f)} Actuals go in only after they print.`, "GESTICURING_AT_WALL"),
    say("Nova", note ? `Research for the week: ${note.line}` : "Research shelf is unchanged.", "WRITING_ON_WHITEBOARD"),
    say("Jax", "Globex reopened at 18:00. Futures only until Monday's 09:30 bell.", "FURIOUS_TYPING"),
    say("Sterling", "Day and week halts reset with the new week. Nothing carries.", "CHECKING_TABLET"),
    say("Vince", "Nothing routes until Monday 09:30 ET.", "STEADY_MONITORING"),
  ];
}

/* ── Fit animations to places ───────────────────────────────────────────── */

const DEFAULT_ANIM: Record<Character, Animation> = {
  Gemma: "EXPLAINING",
  Jax: "FURIOUS_TYPING",
  Nova: "ANALYZING",
  Sterling: "CHECKING_TABLET",
  Vince: "STEADY_MONITORING",
};

const ALLOWED: Record<Character, readonly Animation[]> = {
  Gemma: ["GESTICURING_AT_WALL", "PACING", "EXPLAINING"],
  Jax: ["SHOUTING", "POINTING", "FURIOUS_TYPING"],
  Nova: ["WRITING_ON_WHITEBOARD", "NODDING", "ANALYZING"],
  Sterling: ["CROSSING_ARMS", "CHECKING_TABLET", "APPROVING"],
  Vince: ["SMASHING_ENTER_KEY", "THUMBS_UP", "STEADY_MONITORING"],
};

function fit(l: Line, places: Places, execute: boolean, pacing: boolean): DialogueLine {
  const at = places[l.who];
  let a: Animation = ALLOWED[l.who].includes(l.want) ? l.want : DEFAULT_ANIM[l.who];
  if (l.who === "Gemma") {
    if (a === "GESTICURING_AT_WALL" && at !== "THE_WHITEBOARD") a = pacing ? "PACING" : "EXPLAINING";
    else if (a === "EXPLAINING" && pacing && at !== "THE_WHITEBOARD") a = "PACING";
  }
  if (l.who === "Nova" && a === "WRITING_ON_WHITEBOARD" && at !== "THE_WHITEBOARD") a = "ANALYZING";
  if (l.who === "Vince" && a === "SMASHING_ENTER_KEY" && (!execute || at !== "VINCE_DESK")) a = "STEADY_MONITORING";
  return { character: l.who, text: l.text, animation: a };
}

/**
 * The meeting for this cycle. A trade (fill / exit / veto / the trigger)
 * outranks a scheduled meeting — the room talks about the ticket first.
 */
export function buildMeeting(
  f: Facts,
  places: Places,
  minds: MindState | null,
  meeting: Meeting | null,
  acts: Partial<Record<Character, AgentAct>> | null = null,
): DialogueLine[] {
  let lines: Line[];
  const tradeBeat = f.beat === "fill" || f.beat === "exit" || f.beat === "vetoed" || f.beat === "trigger_wait";
  if (f.beat === "rejected") lines = rejected(f);
  else if (!tradeBeat && meeting) {
    lines =
      meeting.kind === "brief"
        ? brief(f)
        : meeting.kind === "pre_news"
          ? preNews(f, meeting)
          : meeting.kind === "post_news"
            ? postNews(f, meeting)
            : meeting.kind === "setup"
              ? setupReview(f, meeting)
              : meeting.kind === "debrief"
                ? debrief(f, minds)
                : restamp(f);
  } else if (f.beat === "closed") lines = closed(f);
  else if (f.beat === "blind") lines = blind(f);
  else if (f.beat === "exit" && f.exit) lines = exitLines(f);
  else if (f.beat === "fill" && f.entry) lines = debate(f, minds, "fill") ?? fill(f);
  else if (f.beat === "trigger_wait" && f.card && f.entry) lines = debate(f, minds, "wait") ?? triggerWait(f, minds);
  else if (f.beat === "vetoed" && f.card) lines = debate(f, minds, "veto") ?? vetoed(f, minds);
  else if (f.beat === "holding" && f.input.portfolio.open_positions.length) lines = holding(f);
  else if (f.beat === "blocked" && f.card) lines = blocked(f, minds);
  else lines = chop(f, minds, acts);

  // Everyone speaks at least once — the contract names five people.
  for (const who of CREW) {
    if (!lines.some((l) => l.who === who)) lines.push(say(who, idleLine(who, f), DEFAULT_ANIM[who]));
  }
  const execute = f.beat === "fill" || f.beat === "exit";
  const pacing = Boolean(f.desk && (f.desk.judas || f.desk.news.blackout || (f.desk.news.next?.minutesAway ?? 999) <= 30));
  return lines.slice(0, 9).map((l) => fit(l, places, execute, pacing));
}

function idleLine(who: Character, f: Facts): string {
  switch (who) {
    case "Gemma":
      return `${htfLine(f)} ${printLine(f)}`;
    case "Jax":
      return `QQQ ${px(f.input.market_data.QQQ.price)}. Watching.`;
    case "Nova":
      return `${vixTxt(f)}.`;
    case "Sterling":
      return `${f.input.portfolio.open_positions.length}/${ROOM_MANDATE.maxOpenPositions} open.`;
    default:
      return focusQuote(f);
  }
}
