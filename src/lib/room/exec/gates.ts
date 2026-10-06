/**
 * Every refusal the execution layer can make, as pure functions of the broker's own numbers.
 *
 * The room already refuses with the desk's gates (orchestrator.ts). This layer is the SECOND opinion,
 * and it reads the BROKER: the real quote, the real account, the real positions, the real clock. It
 * collects every refusal rather than stopping at the first, so the audit row shows everything that was
 * wrong, and it never decides a trade — it only says "send this" (with a limit) or "do not, because".
 *
 * Exits are the one thing it will not hold hostage: a missing or stale quote prices an exit off the
 * model, a kill switch stops NEW risk and never traps an open position, and the only things that stop
 * a sale are not owning what it sells and not knowing what is owned.
 */

import { etWallParts } from "@/lib/trading/sessions";
import { ROOM_CLOCK } from "../mandate";
import { etDateOf, nextWeekday } from "../option-math";
import { EXEC_FLAGS, EXEC_LIMITS, LIVE_EVIDENCE, type ExecFlags, type ExecLimits, type LiveEvidenceLimits } from "./limits";
import { occSymbol } from "./occ";
import type { AuditRow, BrokerAccount, BrokerPosition, BrokerQuote, ExecPhase, OrderIntent, OrderRole, Refusal } from "./types";

export const r2 = (n: number) => Math.round(n * 100) / 100;
const pct = (x: number, d = 0) => `${(x * 100).toFixed(d)}%`;

/* ── Run-level: is anything allowed to leave at all ─────────────────────── */

export interface RunCtx {
  wanted: ExecPhase;
  killed: boolean;
  readiness: LiveReadiness | null;
}

export function checkRun(role: OrderRole, c: RunCtx): Refusal[] {
  const out: Refusal[] = [];
  if (c.wanted === "off") out.push({ code: "phase_off", why: "execution is off" });
  if (c.killed && role === "entry") out.push({ code: "killed", why: "the kill switch is on — no new entries (exits still run)" });
  // Live that lost its clearance stops NEW risk; it never traps what is already open.
  if (role === "entry" && c.wanted === "live" && !c.readiness?.ok) {
    const bad = (c.readiness?.items ?? []).filter((i) => !i.ok).map((i) => i.label);
    out.push({ code: "live_blocked", why: `live is not cleared: ${bad.slice(0, 3).join("; ")}${bad.length > 3 ? ` (+${bad.length - 3} more)` : ""}` });
  }
  return out;
}

/* ── Order-level ────────────────────────────────────────────────────────── */

export interface GateCtx {
  /** paper | live. Shadow runs the paper checks to say what WOULD have happened. */
  phase: ExecPhase;
  nowMs: number;
  feedLagSec: number | null;
  account: BrokerAccount | null;
  /** Null = the broker could not be read. */
  positions: BrokerPosition[] | null;
  /** Orders the audit says are not finished yet, any symbol. */
  inflight: { symbol: string; side: "buy" | "sell" }[];
  quote: BrokerQuote | null;
  /** Exit attempts already made on this contract today (0 = this is the first). */
  attempt: number;
}

export interface GateResult {
  ok: boolean;
  refusals: Refusal[];
  notes: string[];
  /** Where the order would go. Null for a refusal with no price, or a market exit. */
  limitPx: number | null;
  /** The order's size after the gates (an exit never sells more than the broker holds). */
  qty: number;
  symbol: string | null;
  market: boolean;
}

function symbolOf(i: OrderIntent, no: (c: string, w: string) => void): string | null {
  try {
    return occSymbol({ underlier: i.underlier, exp: i.exp, type: i.type, strike: i.strike });
  } catch (e) {
    no("bad_contract", e instanceof Error ? e.message : "bad contract");
    return null;
  }
}

function clockOf(nowMs: number) {
  const p = etWallParts(nowMs);
  return { weekday: p.weekday >= 1 && p.weekday <= 5, min: p.hour * 60 + p.minute };
}

const hhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

export function checkEntry(i: OrderIntent, c: GateCtx, L: ExecLimits = EXEC_LIMITS): GateResult {
  const refusals: Refusal[] = [];
  const notes: string[] = [];
  const no = (code: string, why: string) => void refusals.push({ code, why });
  const symbol = symbolOf(i, no);

  if (i.role !== "entry" || i.side !== "buy") no("bad_side", "an entry buys to open");
  if (!(Number.isInteger(i.qty) && i.qty >= 1)) no("bad_qty", `${i.qty} is not a whole number of contracts ≥ 1`);
  if (!(i.modelPx > 0)) no("bad_model_px", "the room sent no model price to check the chain against");

  // The clock: the room's own windows, re-read on the broker's side.
  const t = clockOf(c.nowMs);
  if (!t.weekday) no("session_closed", "weekend");
  else if (t.min < ROOM_CLOCK.optionsOpenMin) no("session_closed", `before ${hhmm(ROOM_CLOCK.optionsOpenMin)} ET`);
  else if (t.min >= ROOM_CLOCK.optionsCloseMin) no("session_closed", `after ${hhmm(ROOM_CLOCK.optionsCloseMin)} ET`);

  const today = etDateOf(c.nowMs);
  if (i.exp < today) no("expired", `${i.exp} is in the past`);
  else if (i.exp !== today && i.exp !== nextWeekday(today)) no("dte", `${i.exp} is beyond 1 DTE`);

  // The futures the room decided on.
  if (c.feedLagSec == null) no("desk_feed", "the desk's feed lag is unknown — the room's decision cannot be dated");
  else if (c.feedLagSec > L.maxFeedLagSec) no("desk_feed", `desk feed ${Math.round(c.feedLagSec)}s old (> ${L.maxFeedLagSec}s): the room decided on stale futures`);

  // The account.
  const a = c.account;
  if (!a) no("no_account", "the broker account is unreadable — buying power and approval cannot be verified");
  else {
    if (a.blocked === true || (a.status != null && a.status !== "ACTIVE")) no("account_blocked", `account ${a.status ?? "?"}${a.blocked ? " · trading blocked" : ""}`);
    if (a.optionsLevel == null) {
      if (c.phase === "live") no("options_level", "options approval level not reported — live treats unknown as no");
      else notes.push("options approval level not reported by the broker");
    } else if (a.optionsLevel < 2) no("options_level", `options level ${a.optionsLevel}: buying calls and puts needs level 2`);
  }

  // The quote.
  const q = c.quote;
  let limit: number | null = null;
  if (!q) no("no_quote", "no broker quote for this contract");
  else {
    const mid = q.mid > 0 ? q.mid : (q.bid + q.ask) / 2;
    if (!(q.bid > 0 && q.ask > 0) || q.bid > q.ask) no("bad_quote", `${q.bid} × ${q.ask} is not a tradable quote`);
    else {
      const age = (c.nowMs - q.ts) / 1000;
      if (!(age <= L.maxQuoteAgeSec)) no("stale_quote", `quote ${Math.round(age)}s old (> ${L.maxQuoteAgeSec}s)`);
      const spread = (q.ask - q.bid) / mid;
      if (spread > L.maxSpreadFrac) no("wide_spread", `spread ${pct(spread, 1)} of mid (> ${pct(L.maxSpreadFrac)})`);
      if (i.modelPx > 0) {
        const div = Math.abs(q.ask - i.modelPx) / i.modelPx;
        if (div > L.maxModelDivergence) no("model_divergence", `broker ask ${q.ask.toFixed(2)} vs the room's ${i.modelPx.toFixed(2)}: ${pct(div)} apart (> ${pct(L.maxModelDivergence)})`);
      }
      limit = r2(q.ask + L.entrySlipUsd);
    }
    if (q.feed !== "opra") {
      if (c.phase === "live") no("feed_not_opra", `quote feed is "${q.feed}" — live prices only off OPRA`);
      else notes.push(`quote feed "${q.feed}" is not the real NBBO — paper evidence only`);
    }
  }

  // Money — on the broker's numbers, never the room's.
  if (limit != null && a) {
    const cost = limit * i.qty * 100;
    const cash = Math.max(a.cash, 0);
    const cap = Math.min(L.maxTicketUsd, L.maxCashFracPerTrade * cash);
    if (cost > cap) no("ticket_cap", `$${cost.toFixed(0)} debit > $${cap.toFixed(0)} cap (the lesser of $${L.maxTicketUsd} and ${pct(L.maxCashFracPerTrade)} of $${cash.toFixed(0)} cash)`);
    const bp = a.optionsBuyingPower ?? a.buyingPower;
    if (cost > bp) no("buying_power", `$${cost.toFixed(0)} > $${bp.toFixed(0)} buying power`);
  }

  // Slots and the one-contract-one-order rules.
  const held = c.positions;
  if (held == null) no("positions_unknown", "broker positions unreadable — the open count cannot be checked");
  else {
    const open = new Set(held.filter((p) => p.qty > 0).map((p) => p.symbol));
    const pending = new Set(c.inflight.filter((o) => o.side === "buy").map((o) => o.symbol));
    const slots = new Set([...open, ...pending]);
    if (symbol && open.has(symbol)) no("no_average", "the broker already holds this contract — a plan is filled once, never averaged");
    else if (slots.size >= L.maxOpenPositions) no("max_open", `${slots.size} of ${L.maxOpenPositions} slots are taken`);
  }
  if (symbol && c.inflight.some((o) => o.symbol === symbol)) no("in_flight", "an order is already working on this contract");

  return { ok: refusals.length === 0, refusals, notes, limitPx: limit, qty: i.qty, symbol, market: false };
}

export function checkExit(i: OrderIntent, c: GateCtx, L: ExecLimits = EXEC_LIMITS): GateResult {
  const refusals: Refusal[] = [];
  const notes: string[] = [];
  const no = (code: string, why: string) => void refusals.push({ code, why });
  const symbol = symbolOf(i, no);
  let qty = i.qty;

  if (i.role !== "exit" || i.side !== "sell") no("bad_side", "an exit sells to close");
  if (!(Number.isInteger(i.qty) && i.qty >= 1)) no("bad_qty", `${i.qty} is not a whole number of contracts ≥ 1`);

  const t = clockOf(c.nowMs);
  if (!t.weekday || t.min < ROOM_CLOCK.optionsOpenMin || t.min >= ROOM_CLOCK.optionsCloseMin) no("session_closed", "options are not trading");

  // Never sell what the broker has not confirmed: a sell with nothing held is a short.
  const held = c.positions;
  if (held == null) no("positions_unknown", "broker positions unreadable — never sell what the broker has not confirmed");
  else {
    const h = (symbol && held.find((p) => p.symbol === symbol)?.qty) || 0;
    if (h <= 0) no("no_position", "the broker holds none — nothing to sell (the entry never filled)");
    else if (qty > h) {
      notes.push(`clamped ${qty} → ${h}: the broker holds ${h}`);
      qty = h;
    }
  }
  if (symbol && c.inflight.some((o) => o.symbol === symbol)) no("in_flight", "an order is already working on this contract");

  // The price: out beats a price. Escalates a step per attempt, then market.
  let limit: number | null = null;
  let market = false;
  const q = c.quote;
  if (c.attempt >= L.maxExitLimitAttempts) {
    market = true;
    notes.push(`attempt ${c.attempt + 1}: market — the limit exits did not fill`);
  } else if (q && q.bid > 0) {
    limit = Math.max(0.01, r2(q.bid - L.exitSlipUsd * (c.attempt + 1)));
    if ((c.nowMs - q.ts) / 1000 > L.maxQuoteAgeSec) notes.push(`quote ${Math.round((c.nowMs - q.ts) / 1000)}s old — priced off it anyway: an exit is never held for a quote`);
  } else if (i.modelPx > 0) {
    limit = Math.max(0.01, r2(i.modelPx - L.exitSlipUsd * (c.attempt + 3)));
    notes.push("no broker quote — priced off the room's model bid, three steps down");
  } else {
    market = true;
    notes.push("no quote and no model price — market");
  }

  return { ok: refusals.length === 0, refusals, notes, limitPx: limit, qty, symbol, market };
}

/* ── The evidence the paper record gives, and what it must show before live is offered ── */

export interface Evidence {
  paperFills: number;
  paperRoundTrips: number;
  /** Rows with a broker quote beside the room's model price (paper and shadow). */
  quoteErrN: number;
  medianQuoteErrPct: number | null;
  entrySlipN: number;
  medianEntrySlipPct: number | null;
  /**
   * Entry fills whose distance from the quoted ask exceeds the live slip cap.
   * The median can hide one of these. Any one of them blocks live.
   */
  desyncFills: number;
  /** Rows whose fate the broker never confirmed. */
  unreconciled: number;
  errorRatePct: number | null;
  shadowN: number;
}

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

const RECONCILE_GRACE_MS = 10 * 60_000;

export function evidenceOf(rows: readonly AuditRow[], nowMs: number): Evidence {
  const paper = rows.filter((r) => r.phase === "paper");
  const filled = paper.filter((r) => r.status === "filled" && r.filledQty > 0);
  const trips = new Map<string, { buy: boolean; sell: boolean }>();
  for (const r of filled) {
    const k = `${r.symbol}|${r.intent.etDate}`;
    const g = trips.get(k) ?? { buy: false, sell: false };
    if (r.side === "buy") g.buy = true;
    else g.sell = true;
    trips.set(k, g);
  }
  const qerr: number[] = [];
  for (const r of rows) {
    if (r.phase !== "paper" && r.phase !== "shadow") continue;
    const q = r.quote;
    const m = r.intent.modelPx;
    if (!q || !(m > 0)) continue;
    const px = r.side === "buy" ? q.ask : q.bid;
    if (px > 0) qerr.push((Math.abs(px - m) / m) * 100);
  }
  const slip = filled
    .filter((r) => r.role === "entry" && r.quote && r.quote.ask > 0 && r.filledAvgPx != null)
    .map((r) => ((r.filledAvgPx! - r.quote!.ask) / r.quote!.ask) * 100);
  const touched = paper.filter((r) => ["working", "filled", "cancelled", "rejected", "error"].includes(r.status));
  const bad = paper.filter((r) => r.status === "error" || r.status === "rejected");
  const stuck = paper.filter((r) => r.status === "error" || ((r.status === "reserved" || r.status === "working") && nowMs - r.updatedMs > RECONCILE_GRACE_MS));
  return {
    paperFills: filled.length,
    paperRoundTrips: [...trips.values()].filter((g) => g.buy && g.sell).length,
    quoteErrN: qerr.length,
    medianQuoteErrPct: median(qerr),
    entrySlipN: slip.length,
    medianEntrySlipPct: median(slip),
    desyncFills: slip.filter((pct) => pct > LIVE_EVIDENCE.maxMedianEntrySlipPct || pct < -LIVE_EVIDENCE.maxMedianEntrySlipPct).length,
    unreconciled: stuck.length,
    errorRatePct: touched.length ? (bad.length / touched.length) * 100 : null,
    shadowN: rows.filter((r) => r.phase === "shadow").length,
  };
}

export interface ReadinessItem {
  id: string;
  ok: boolean;
  label: string;
  detail: string;
}
export interface LiveReadiness {
  ok: boolean;
  items: ReadinessItem[];
}

export function liveReadiness(
  i: { flags?: ExecFlags; evidence: Evidence; feed: string | null; liveKeys: boolean; killed: boolean },
  E: LiveEvidenceLimits = LIVE_EVIDENCE,
): LiveReadiness {
  const f: ExecFlags = i.flags ?? EXEC_FLAGS;
  const e = i.evidence;
  const num = (x: number | null, d = 1) => (x == null ? "no data" : x.toFixed(d));
  const items: ReadinessItem[] = [
    { id: "confirmed", ok: f.OPTIONS_LIVE_CONFIRMED_IN_WRITING, label: "Trader's written confirmation", detail: f.OPTIONS_LIVE_CONFIRMED_IN_WRITING ? "OPTIONS_LIVE_CONFIRMED_IN_WRITING is true" : "the broker's agreement permits automated live options trading — flip OPTIONS_LIVE_CONFIRMED_IN_WRITING in limits.ts after reading it" },
    { id: "runner", ok: f.SERVER_RUNNER_BUILT, label: "Server-side runner", detail: f.SERVER_RUNNER_BUILT ? "a scheduled runner drives the room with the tab closed" : "a stop only fires while a browser is open — not acceptable for money" },
    { id: "escalation", ok: f.EXIT_ESCALATION_VERIFIED_ON_PAPER, label: "Exits follow the Robinhood position", detail: f.EXIT_ESCALATION_VERIFIED_ON_PAPER ? "a position closes from the chart, not from an Alpaca paper account" : "exits are not confirmed" },
    { id: "account", ok: true, label: "Robinhood Agentic ••6158", detail: "The only account on this desk. Alpaca is not a broker here." },
    { id: "keys", ok: i.liveKeys, label: "Robinhood armed", detail: i.liveKeys ? "RH_LIVE_ARMED and RH_OPTIONS_AUTOFIRE_ENABLED are on" : "RH_LIVE_ARMED or RH_OPTIONS_AUTOFIRE_ENABLED is off — live place stays shut until both are true" },
    { id: "reconciled", ok: e.unreconciled <= E.maxUnreconciled, label: "Every order reconciled", detail: `${e.unreconciled} unconfirmed` },
    { id: "errors", ok: e.errorRatePct == null || e.errorRatePct <= E.maxErrorRatePct, label: `Broker errors and rejects ≤ ${E.maxErrorRatePct}%`, detail: `${num(e.errorRatePct)}%` },
    { id: "kill", ok: !i.killed, label: "Kill switch off", detail: i.killed ? "engaged" : "off" },
  ];
  return { ok: items.every((x) => x.ok), items };
}
