/**
 * The execution layer's vocabulary (shadow → paper; live is behind human-flipped flags, limits.ts).
 *
 * The room DECIDES (orchestrator.ts, deterministic). This layer only carries a decision to a
 * broker, re-checks it against the mandate on the BROKER's numbers, and writes down everything it
 * did. It never decides, never sizes a trade the room did not size, and a model never touches it.
 */

export type ExecPhase = "off" | "shadow" | "paper" | "live";
export const PHASES: readonly ExecPhase[] = ["off", "shadow", "paper", "live"];

export type OrderRole = "entry" | "exit";

/**
 * reserved   row written, broker not yet called (a crash here is resolved by client id)
 * refused    a gate said no — the reasons are on the row
 * shadow     recorded with the broker's quote, nothing sent
 * working    the broker has it
 * filled · cancelled · rejected   terminal
 * error      the call failed and the order's fate is UNKNOWN — looked up by client id, never guessed
 */
export type RowStatus = "reserved" | "refused" | "shadow" | "working" | "filled" | "cancelled" | "rejected" | "error";
export const TERMINAL_STATUS: ReadonlySet<RowStatus> = new Set<RowStatus>(["refused", "shadow", "filled", "cancelled", "rejected"]);

export interface OrderIntent {
  /**
   * What decided this: entries `E|<etDate>|<plan key>`, exits `X|<etDate>|<position id>|<reason>|<qty>`.
   * The broker's client order id is derived from it, so two browsers running the same room send ONE order.
   */
  decisionKey: string;
  role: OrderRole;
  side: "buy" | "sell";
  underlier: "QQQ" | "SPY";
  type: "CALL" | "PUT";
  strike: number;
  /** ET calendar date, YYYY-MM-DD. */
  exp: string;
  /** Whole contracts. */
  qty: number;
  /** The room's own model ask (entries) or bid (exits) for this contract; the chain is checked against it. */
  modelPx: number;
  reason: string;
  etDate: string;
  atMs: number;
  /** The room position this belongs to — the book voids it if its entry never fills. */
  positionId?: string | null;
}

export interface BrokerQuote {
  bid: number;
  ask: number;
  mid: number;
  /** Quote timestamp, epoch ms. */
  ts: number;
  /** "opra" is the real NBBO; "indicative" is Alpaca's free, modified feed and never prices a live order. */
  feed: string;
  iv?: number | null;
  delta?: number | null;
}

export interface BrokerPosition {
  symbol: string;
  qty: number;
  avgPx: number;
}

export interface BrokerOrder {
  id: string;
  clientOrderId: string;
  /** The broker's own word, verbatim. */
  status: string;
  symbol: string;
  side: "buy" | "sell";
  qty: number;
  limitPx: number | null;
  filledQty: number;
  filledAvgPx: number | null;
}

export interface BrokerAccount {
  equity: number;
  cash: number;
  buyingPower: number;
  /** Null = the broker did not say; live treats "unknown" as "no". */
  optionsBuyingPower: number | null;
  optionsLevel: number | null;
  status: string | null;
  blocked: boolean | null;
}

export interface OptionsBroker {
  readonly name: string;
  readonly env: "paper" | "live";
  /** The feed the quotes are requested on. */
  readonly dataFeed: "opra" | "indicative";
  account(): Promise<BrokerAccount>;
  quote(symbol: string): Promise<BrokerQuote | null>;
  positions(): Promise<BrokerPosition[]>;
  openOrders(): Promise<BrokerOrder[]>;
  /** `limitPx: null` is a market order (exits that escalated). */
  submit(o: { symbol: string; qty: number; side: "buy" | "sell"; limitPx: number | null; clientOrderId: string }): Promise<BrokerOrder>;
  get(id: string): Promise<BrokerOrder>;
  byClientId(clientOrderId: string): Promise<BrokerOrder | null>;
  cancel(id: string): Promise<void>;
}

export interface AuditRow {
  clientOrderId: string;
  phase: ExecPhase;
  role: OrderRole;
  symbol: string;
  side: "buy" | "sell";
  qty: number;
  limitPx: number | null;
  status: RowStatus;
  brokerStatus: string | null;
  reasons: string[];
  brokerOrderId: string | null;
  filledQty: number;
  filledAvgPx: number | null;
  intent: OrderIntent;
  quote: BrokerQuote | null;
  /** Exit attempt number for this symbol today (0 = first). Escalation reads it. */
  attempt: number;
  atMs: number;
  updatedMs: number;
}

export interface Refusal {
  code: string;
  why: string;
}
