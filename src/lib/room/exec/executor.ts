/**
 * One step of the execution layer: the server-side half of "the room decided, now carry it".
 *
 * WHAT A STEP DOES (and in this order)
 *   1. Off → nothing. Not the lease holder → watch only (two devices never fight over one account).
 *   2. Shadow → record what the room did beside the broker's real quote and what each gate would
 *      have said. Nothing is sent. This is the evidence the model's prices get judged on.
 *   3. Paper / live → read the broker (account, positions, working orders), advance every order the
 *      audit says is unfinished (poll, cancel what waited too long), send the room's NEW entries
 *      through the gates, then RECONCILE: steer the broker's positions toward the room's book, selling
 *      only what this system bought, escalating an exit that does not fill (limit, a step lower, then
 *      market). Entries that never filled come back as `voids` so the room's book stops claiming them.
 *
 * WHY RECONCILE INSTEAD OF FORWARDING EXITS
 * The room's book closes a trade the instant it decides to. If the exit order is refused, fails or
 * does not fill, an event-forwarder never tries again and the broker keeps a position nobody manages.
 * Comparing "what the room holds" with "what the broker holds" every step retries by construction,
 * and it cannot sell a position this system did not open.
 *
 * Idempotent end to end: the order id is derived from the decision, the audit row's unique key
 * reserves it before the broker is called, and a crash between the two is resolved by looking the
 * order up by client id — never guessed.
 */

import { etDateOf } from "../option-math";
import { checkEntry, checkExit, checkRun, evidenceOf, liveReadiness, type Evidence, type GateCtx, type LiveReadiness } from "./gates";
import { clientOrderId, reconcileKey, type DesiredPosition } from "./intent";
import { EXEC_LIMITS, type ExecFlags, type ExecLimits } from "./limits";
import { occSymbol, parseOcc } from "./occ";
import type { AuditRow, BrokerAccount, BrokerOrder, BrokerPosition, BrokerQuote, ExecPhase, OptionsBroker, OrderIntent, RowStatus } from "./types";

export interface ExecState {
  wanted: ExecPhase;
  /** When the phase last changed (ms), or null. */
  wantedAtMs: number | null;
  killed: boolean;
  killReason: string | null;
}

/** Everything the executor needs from storage. The SQL implementation is exec-sql.ts. */
export interface ExecStore {
  state(): Promise<ExecState>;
  /** True when this device now holds (or already held) the executor lease. */
  claimLease(deviceId: string, nowMs: number, leaseSec: number): Promise<boolean>;
  /** Insert-or-ignore on (user, client order id). `inserted: false` = another call already reserved it. */
  reserve(row: AuditRow): Promise<{ inserted: boolean; row: AuditRow }>;
  update(clientOrderId: string, patch: Partial<AuditRow>): Promise<void>;
  /** Rows not finished yet (reserved · working · error) for one phase. */
  open(phase: ExecPhase): Promise<AuditRow[]>;
  recent(limit: number): Promise<AuditRow[]>;
  /** Exit rows for a contract on an ET day: how many in all (the next sequence number) and how many ended unfilled (the escalation step). */
  exitCounts(phase: ExecPhase, symbol: string, etDate: string): Promise<{ total: number; misses: number }>;
  /** Net contracts this system has filled per contract (buys − sells) in a phase — the most it may ever sell. */
  owned(phase: ExecPhase): Promise<Map<string, number>>;
  /** Which of these room position ids already have an entry row, in any status. */
  knownPositionIds(ids: string[]): Promise<Set<string>>;
  evidenceRows(limit: number): Promise<AuditRow[]>;
}

export interface ExecDeps {
  store: ExecStore;
  /** Null = no keys for the wanted phase. */
  broker: OptionsBroker | null;
  nowMs: number;
  liveKeys: boolean;
  limits?: ExecLimits;
  flags?: ExecFlags;
}

export interface StepRequest {
  deviceId: string;
  /** Positions the room opened since the last step. */
  entries: OrderIntent[];
  /** Trades the room closed since the last step — the shadow record, and the reasons the real exits carry. */
  exits: OrderIntent[];
  /** Everything the room holds now: the target the broker is steered toward. */
  desired: (DesiredPosition & { openedAt: number })[];
  /** The desk's futures feed lag when the room decided. */
  feedLagSec: number | null;
  /** Close everything this system owns, whatever the room says. */
  flatten?: boolean;
}

export interface Void {
  positionId: string;
  /** Contracts that DID fill — the room's position shrinks to this (0 = it never existed). */
  keepQty: number;
  why: string;
}

export interface StepResult {
  phase: ExecPhase;
  role: "executor" | "observer" | "idle" | "blocked";
  killed: boolean;
  killReason: string | null;
  notes: string[];
  rows: AuditRow[];
  voids: Void[];
  account: { equity: number; cash: number; buyingPower: number; optionsLevel: number | null } | null;
  positions: BrokerPosition[] | null;
  feed: string | null;
  env: "paper" | "live" | null;
  readiness: LiveReadiness;
  evidence: Evidence;
  atMs: number;
}

/** The app's word for a broker order's state, and what it filled. Unknown words stay `working`: still tracked, never assumed done. */
export function rowPatchFromBroker(o: BrokerOrder): Pick<AuditRow, "status" | "brokerStatus" | "brokerOrderId" | "filledQty" | "filledAvgPx"> {
  const s = o.status.toLowerCase();
  let status: RowStatus = "working";
  if (s === "filled") status = "filled";
  else if (["canceled", "cancelled", "expired", "done_for_day", "replaced"].includes(s)) status = "cancelled";
  else if (["rejected", "suspended"].includes(s)) status = "rejected";
  return { status, brokerStatus: o.status, brokerOrderId: o.id, filledQty: o.filledQty, filledAvgPx: o.filledAvgPx };
}

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 200);

function blankRow(i: OrderIntent, phase: ExecPhase, symbol: string, qty: number, nowMs: number, attempt = 0): AuditRow {
  return {
    clientOrderId: clientOrderId(i.decisionKey, phase),
    phase,
    role: i.role,
    symbol,
    side: i.side,
    qty,
    limitPx: null,
    status: "reserved",
    brokerStatus: null,
    reasons: [],
    brokerOrderId: null,
    filledQty: 0,
    filledAvgPx: null,
    intent: i,
    quote: null,
    attempt,
    atMs: nowMs,
    updatedMs: nowMs,
  };
}

export async function execStep(d: ExecDeps, req: StepRequest): Promise<StepResult> {
  const L = d.limits ?? EXEC_LIMITS;
  const nowMs = d.nowMs;
  const st = await d.store.state();
  const evidence = evidenceOf(await d.store.evidenceRows(500), nowMs);
  const readiness = liveReadiness({ flags: d.flags, evidence, feed: d.broker?.dataFeed ?? null, liveKeys: d.liveKeys, killed: st.killed });
  const res: StepResult = {
    phase: st.wanted,
    role: "idle",
    killed: st.killed,
    killReason: st.killReason,
    notes: [],
    rows: [],
    voids: [],
    account: null,
    positions: null,
    feed: d.broker?.dataFeed ?? null,
    env: d.broker?.env ?? null,
    readiness,
    evidence,
    atMs: nowMs,
  };
  const finish = async (): Promise<StepResult> => {
    res.rows = await d.store.recent(30);
    return res;
  };

  if (st.wanted === "off") return finish();
  if (!(await d.store.claimLease(req.deviceId, nowMs, L.leaseSec))) {
    res.role = "observer";
    res.notes.push("another device is running the executor");
    return finish();
  }
  res.role = "executor";
  const phase = st.wanted;
  const b = d.broker;
  const etDate = etDateOf(nowMs);
  const runRefusals = (role: "entry" | "exit") => checkRun(role, { wanted: phase, killed: st.killed, readiness: phase === "live" ? readiness : null });
  const brief = (r: { code: string; why: string }) => `${r.code}: ${r.why}`;

  /* ── Shadow: record, compare, send nothing ─────────────────────────── */
  if (phase === "shadow") {
    let account: BrokerAccount | null = null;
    let accountRead = false;
    const readAccount = async () => {
      if (!accountRead && b) {
        accountRead = true;
        account = await b.account().catch(() => null);
      }
      return account;
    };
    for (const i of [...req.entries, ...req.exits]) {
      let symbol = "";
      try {
        symbol = occSymbol({ underlier: i.underlier, exp: i.exp, type: i.type, strike: i.strike });
      } catch {
        continue;
      }
      const quote: BrokerQuote | null = b ? await b.quote(symbol).catch(() => null) : null;
      const ctx: GateCtx = {
        phase: "paper",
        nowMs,
        feedLagSec: req.feedLagSec,
        account: await readAccount(),
        // A shadow exit sells what the room "holds": the broker holds nothing, so the position check is the room's own.
        positions: i.role === "exit" ? [{ symbol, qty: i.qty, avgPx: i.modelPx }] : [],
        inflight: [],
        quote,
        attempt: 0,
      };
      const g = i.role === "entry" ? checkEntry(i, ctx, L) : checkExit(i, ctx, L);
      const row = blankRow(i, "shadow", symbol, g.qty, nowMs);
      row.status = "shadow";
      row.quote = quote;
      row.limitPx = g.limitPx;
      row.reasons = [...(g.ok ? ["would send"] : g.refusals.map(brief)), ...g.notes, ...(b ? [] : ["no broker keys: shadow compares nothing"])];
      await d.store.reserve(row);
    }
    return finish();
  }

  /* ── Paper / live ──────────────────────────────────────────────────── */
  if (!b) {
    res.role = "blocked";
    res.notes.push(`no ${phase} broker keys set`);
    return finish();
  }
  const [account, positions] = await Promise.all([b.account().catch(() => null), b.positions().catch(() => null)]);
  res.account = account ? { equity: account.equity, cash: account.cash, buyingPower: account.buyingPower, optionsLevel: account.optionsLevel } : null;
  res.positions = positions;

  // 1. Advance every order the audit says is unfinished.
  for (const r of await d.store.open(phase)) {
    try {
      let o: BrokerOrder | null = null;
      if (r.brokerOrderId) o = await b.get(r.brokerOrderId);
      else if (nowMs - r.updatedMs > 15_000) o = await b.byClientId(r.clientOrderId);
      else continue; // another call is placing it right now
      if (!o) {
        await d.store.update(r.clientOrderId, { status: "cancelled", reasons: [...r.reasons, "never reached the broker (not found by client id)"], updatedMs: nowMs });
        continue;
      }
      let patch = rowPatchFromBroker(o);
      let reasons = r.reasons;
      const waitSec = r.role === "entry" ? L.entryWaitSec : L.exitWaitSec;
      if (patch.status === "working" && o.status.toLowerCase() !== "pending_cancel" && (nowMs - r.atMs) / 1000 > waitSec) {
        await b.cancel(o.id).catch((e) => res.notes.push(`cancel ${r.symbol}: ${msg(e)}`));
        const o2 = await b.get(o.id).catch(() => o);
        patch = rowPatchFromBroker(o2);
        reasons = [...reasons, `unfilled after ${waitSec}s — cancelled`];
      }
      await d.store.update(r.clientOrderId, { ...patch, reasons, updatedMs: nowMs });
    } catch (e) {
      res.notes.push(`sync ${r.symbol}: ${msg(e)}`);
    }
  }
  const inflight = (await d.store.open(phase)).map((r) => ({ symbol: r.symbol, side: r.side }));

  let placed = false;
  const place = async (row: AuditRow, limitPx: number | null, qty: number) => {
    placed = true;
    try {
      const o = await b.submit({ symbol: row.symbol, qty, side: row.side, limitPx, clientOrderId: row.clientOrderId });
      await d.store.update(row.clientOrderId, { ...rowPatchFromBroker(o), updatedMs: nowMs });
    } catch (e) {
      // The call failed; the order may or may not exist. Look it up by its deterministic id before saying anything.
      const o = await b.byClientId(row.clientOrderId).catch(() => null);
      if (o) await d.store.update(row.clientOrderId, { ...rowPatchFromBroker(o), updatedMs: nowMs });
      else await d.store.update(row.clientOrderId, { status: "error", reasons: [...row.reasons, `broker call failed: ${msg(e)}`], updatedMs: nowMs });
    }
    inflight.push({ symbol: row.symbol, side: row.side });
  };

  // 2. The room's NEW entries, through the gates.
  for (const i of req.entries) {
    let symbol = "";
    try {
      symbol = occSymbol({ underlier: i.underlier, exp: i.exp, type: i.type, strike: i.strike });
    } catch {
      res.notes.push(`entry ${i.decisionKey}: not a nameable contract`);
      continue;
    }
    const quote = await b.quote(symbol).catch(() => null);
    const g = checkEntry(i, { phase, nowMs, feedLagSec: req.feedLagSec, account, positions, inflight, quote, attempt: 0 }, L);
    const refusals = [...runRefusals("entry"), ...g.refusals];
    const row = blankRow(i, phase, symbol, g.qty, nowMs);
    row.quote = quote;
    row.limitPx = g.limitPx;
    row.reasons = [...refusals.map(brief), ...g.notes];
    row.status = refusals.length ? "refused" : "reserved";
    const { inserted } = await d.store.reserve(row);
    if (!inserted) {
      res.notes.push(`entry ${row.clientOrderId} was already handled`);
      continue;
    }
    if (!refusals.length) await place(row, g.limitPx, g.qty);
  }

  // 3. Reconcile: steer the broker toward the room's book. Sell only what this system bought.
  const want = new Map<string, number>();
  if (!req.flatten) for (const x of req.desired) want.set(x.symbol, (want.get(x.symbol) ?? 0) + x.qty);
  const owned = await d.store.owned(phase);
  for (const [symbol, ownedQty] of owned) {
    const actual = positions?.find((p) => p.symbol === symbol)?.qty ?? 0;
    const excess = Math.min(actual - (want.get(symbol) ?? 0), ownedQty);
    if (excess <= 0) continue;
    const occ = parseOcc(symbol);
    if (!occ || (occ.underlier !== "QQQ" && occ.underlier !== "SPY")) continue;
    const hint = req.exits.find((x) => {
      try {
        return occSymbol({ underlier: x.underlier, exp: x.exp, type: x.type, strike: x.strike }) === symbol;
      } catch {
        return false;
      }
    });
    const counts = await d.store.exitCounts(phase, symbol, etDate);
    const i: OrderIntent = {
      decisionKey: reconcileKey(etDate, symbol, counts.total),
      role: "exit",
      side: "sell",
      underlier: occ.underlier as "QQQ" | "SPY",
      type: occ.type,
      strike: occ.strike,
      exp: occ.exp,
      qty: excess,
      modelPx: hint?.modelPx ?? 0,
      reason: req.flatten ? "flatten all" : (hint?.reason ?? `the room does not hold it${counts.misses ? ` (attempt ${counts.misses + 1})` : ""}`),
      etDate,
      atMs: nowMs,
      positionId: hint?.positionId ?? null,
    };
    const quote = await b.quote(symbol).catch(() => null);
    const g = checkExit(i, { phase, nowMs, feedLagSec: req.feedLagSec, account, positions, inflight, quote, attempt: counts.misses }, L);
    if (!g.ok) {
      // Not recorded: these are "not now" (no position, one already working, market shut) and are re-read every step.
      res.notes.push(`exit ${symbol}: ${g.refusals.map(brief).join("; ")}`);
      continue;
    }
    const row = blankRow(i, phase, symbol, g.qty, nowMs, counts.misses);
    row.quote = quote;
    row.limitPx = g.limitPx;
    row.reasons = g.notes;
    const { inserted } = await d.store.reserve(row);
    if (inserted) await place(row, g.market ? null : g.limitPx, g.qty);
  }

  // 4. Entries that never became a position — and entries that were never sent at all — leave the room's book.
  // Stateless: a void is offered while the room still claims MORE than what filled, so a shrunk position stops being offered.
  const heldQty = new Map(req.desired.map((x) => [x.positionId, x.qty]));
  for (const r of await d.store.recent(60)) {
    if (r.phase !== phase || r.role !== "entry" || !r.intent.positionId) continue;
    const claimed = heldQty.get(r.intent.positionId);
    if (claimed == null || claimed <= r.filledQty) continue;
    if (r.status === "cancelled" || r.status === "rejected" || r.status === "refused") {
      res.voids.push({ positionId: r.intent.positionId, keepQty: r.filledQty, why: `${r.status}${r.reasons.length ? ` — ${r.reasons[0]}` : ""}` });
    }
  }
  // Only positions the room opened AFTER this phase was switched on can be "never sent".
  const stale = req.desired.filter((x) => nowMs - x.openedAt > 120_000 && x.openedAt >= (st.wantedAtMs ?? 0));
  if (stale.length) {
    const known = await d.store.knownPositionIds(stale.map((x) => x.positionId));
    for (const x of stale) if (!known.has(x.positionId)) res.voids.push({ positionId: x.positionId, keepQty: 0, why: "the entry was never sent (no audit row)" });
  }
  // What the broker holds AFTER this step moved it — the card shows the result, not the state before.
  if (placed) res.positions = await b.positions().catch(() => res.positions);
  return finish();
}
