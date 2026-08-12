/**
 * ROADMAP E1 — order-ticket parity. ONE order description, shared by paper and
 * (later) live, so the two can differ ONLY in the adapter that consumes it.
 *
 * PURE MODULE. No I/O, no network, no broker SDK, no credentials — this file
 * describes an order, it never places one. `execution/shadow.ts` records what
 * this builder produced; nothing in this repo sends it anywhere (see ROADMAP
 * Phase E's four unlock conditions).
 *
 * WHY A TYPE AND NOT A FUNCTION CALL. The paper book and a future broker
 * adapter each need entry, stop, size, targets and the risk figures. If each
 * derives them from the raw setup independently, they drift — which is exactly
 * how paper R came to be ~3% kinder than live before `journal/pnl.ts` unified
 * the money math. One builder, one shape, one place to add a field.
 *
 * SYMBOL DISCIPLINE. `symbol` is the RESOLVED contract (MES/MNQ), never the
 * display label (ES/NQ). Pricing MES economics as ES is a 10x error, and an
 * order ticket is the one place that error would cost real money — so an
 * unknown symbol is a hard validation failure here, with NO fallback to MNQ.
 */

import { z } from "zod";
import {
  APLUS_RULES,
  CONTRACTS,
  type ContractKey,
} from "@/lib/aplus/config";
import { contractSpec, isKnownSymbol } from "@/lib/journal/pnl";
import type { BuiltPaperLevels, PaperTrade } from "@/lib/trading/paper-manager";

/** Bump when the persisted shape changes (shadow_orders.intent is versioned). */
export const ORDER_INTENT_VERSION = 1;

export type OrderSide = "long" | "short";
/** `entry` means: limit price, stop-entry trigger, or market reference price. */
export type OrderEntryType = "market" | "limit" | "stop";
export type TimeInForce = "day" | "gtc" | "ioc";

export interface OrderTarget {
  label: string;
  price: number;
  /** Contracts released at this leg. Legs sum to the order qty. */
  qty: number;
  /** Planned R at this leg — a price ratio, deliberately GROSS of commission. */
  rMultiple: number;
}

export interface OrderRisk {
  /** |entry − stop| in points. */
  points: number;
  /** Dollars per point per contract, from CONTRACTS. */
  pointValue: number;
  /** points × pointValue. */
  perContract: number;
  /** points × pointValue × qty — the planned 1R. */
  dollars: number;
  /** Round-turn commission for the whole order (CONTRACTS convention). */
  commission: number;
  /** Risk as a fraction of equity, when equity is known. */
  pct: number | null;
  equity: number | null;
}

/**
 * Desk context travelling with the ticket. NON-EXECUTABLE metadata: an adapter
 * must never read this to decide anything. It exists so a shadow record can be
 * diffed against what the human actually did, and grouped by Phase C.
 */
export interface OrderContext {
  displaySymbol: string | null;
  grade: string | null;
  score: number | null;
  strategy: string | null;
  killzone: string | null;
  note: string | null;
}

export interface OrderIntent {
  version: number;
  /** Idempotency key. Client-generated, carried into every downstream write. */
  clientOrderId: string;
  createdAt: string;
  /** RESOLVED contract symbol (MES/MNQ) — never the display label. */
  symbol: ContractKey;
  side: OrderSide;
  entryType: OrderEntryType;
  entry: number;
  qty: number;
  /** Protective stop price. Always present — an order without one is refused. */
  stop: number;
  targets: OrderTarget[];
  timeInForce: TimeInForce;
  risk: OrderRisk;
  context: OrderContext;
}

export interface OrderIntentInput {
  symbol: string;
  side: OrderSide;
  entry: number;
  stop: number;
  qty: number;
  /** Prices, or full legs. Plain prices are split per the scale-out rule. */
  targets?: readonly (number | { price: number; qty?: number; label?: string })[];
  entryType?: OrderEntryType;
  timeInForce?: TimeInForce;
  clientOrderId?: string;
  createdAt?: string | number | Date;
  equity?: number | null;
  context?: Partial<OrderContext>;
}

export class OrderIntentError extends Error {
  readonly issues: string[];
  constructor(issues: string[]) {
    super(`invalid order intent: ${issues.join("; ")}`);
    this.name = "OrderIntentError";
    this.issues = issues;
  }
}

/* ------------------------------------------------------------------ *
 * Builders
 * ------------------------------------------------------------------ */

/**
 * Idempotency key. Prefer passing an id that already identifies the decision
 * (the paper trade id) so the same decision cannot be recorded — or one day
 * placed — twice under two names.
 */
export function newClientOrderId(prefix = "oi"): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function toIso(at: string | number | Date | undefined): string {
  if (at instanceof Date) return at.toISOString();
  if (typeof at === "number") return new Date(at).toISOString();
  if (typeof at === "string" && at) return new Date(at).toISOString();
  return new Date().toISOString();
}

function finite(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n) && n > 0;
}

function trimOrNull(v: unknown, max: number): string | null {
  const s = typeof v === "string" ? v.trim() : "";
  return s ? s.slice(0, max) : null;
}

/**
 * Split plain target prices into legs the way the paper book already scales
 * out (`APLUS_RULES.scaleOut`): half at TP1 → stop to BE, runner at TP2; a
 * single contract goes out whole at TP1. Parity means the live adapter would
 * receive the legs paper actually trades, not an idealised version of them.
 */
function buildTargets(
  raw: OrderIntentInput["targets"],
  qty: number,
  entry: number,
  riskPoints: number,
  side: OrderSide,
): OrderTarget[] {
  const legs = (raw ?? [])
    .map((t) => (typeof t === "number" ? { price: t } : t))
    .filter((t) => finite(t?.price));
  if (!legs.length) return [];

  const rOf = (price: number) =>
    riskPoints > 0
      ? Math.round((Math.abs(price - entry) / riskPoints) * 10_000) / 10_000
      : 0;

  // Explicit per-leg quantities are honoured verbatim.
  if (legs.some((l) => finite(l.qty))) {
    return legs.map((l, i) => ({
      label: l.label ?? `TP${i + 1}`,
      price: l.price,
      qty: Math.max(0, Math.trunc(l.qty ?? 0)),
      rMultiple: rOf(l.price),
    }));
  }

  const so = APLUS_RULES.scaleOut;
  const ordered = [...legs].sort((a, b) =>
    side === "long" ? a.price - b.price : b.price - a.price,
  );

  if (ordered.length === 1 || !so.enabled || qty < 2) {
    // One leg takes the whole order (matches the 1-contract paper path).
    const first = ordered[0]!;
    return [
      {
        label: first.label ?? "TP1",
        price: first.price,
        qty,
        rMultiple: rOf(first.price),
      },
    ];
  }

  const firstQty = Math.max(1, Math.floor(qty * so.tp1Fraction));
  const runnerQty = qty - firstQty;
  const [tp1, tp2] = ordered;
  return [
    {
      label: tp1!.label ?? "TP1",
      price: tp1!.price,
      qty: firstQty,
      rMultiple: rOf(tp1!.price),
    },
    {
      label: tp2!.label ?? "TP2",
      price: tp2!.price,
      qty: runnerQty,
      rMultiple: rOf(tp2!.price),
    },
  ];
}

/**
 * Build the shared ticket. Throws `OrderIntentError` on anything an adapter
 * must never be handed: unknown symbol, inverted stop, a target on the wrong
 * side of entry, legs that do not sum to the order size.
 */
export function buildOrderIntent(input: OrderIntentInput): OrderIntent {
  const symbolRaw = typeof input.symbol === "string" ? input.symbol.toUpperCase() : "";
  const issues: string[] = [];

  if (!isKnownSymbol(symbolRaw)) {
    issues.push(
      `unknown symbol "${input.symbol}" — pass the RESOLVED contract (${Object.keys(CONTRACTS).join("/")})`,
    );
  }
  if (input.side !== "long" && input.side !== "short") issues.push("side must be long|short");
  if (!finite(input.entry)) issues.push("entry must be a positive number");
  if (!finite(input.stop)) issues.push("stop must be a positive number");
  if (!Number.isInteger(input.qty) || input.qty < 1 || input.qty > 1000) {
    issues.push("qty must be an integer 1..1000");
  }
  if (issues.length) throw new OrderIntentError(issues);

  const symbol = symbolRaw as ContractKey;
  const spec = contractSpec(symbol);
  const side = input.side;
  const entry = input.entry;
  const stop = input.stop;
  const qty = input.qty;

  if (side === "long" && stop >= entry) issues.push("long stop must sit below entry");
  if (side === "short" && stop <= entry) issues.push("short stop must sit above entry");
  if (issues.length) throw new OrderIntentError(issues);

  const points = Math.abs(entry - stop);
  const targets = buildTargets(input.targets, qty, entry, points, side);

  for (const t of targets) {
    if (side === "long" && t.price <= entry) {
      issues.push(`${t.label} ${t.price} is not above entry for a long`);
    }
    if (side === "short" && t.price >= entry) {
      issues.push(`${t.label} ${t.price} is not below entry for a short`);
    }
  }
  if (targets.length) {
    const legQty = targets.reduce((s, t) => s + t.qty, 0);
    if (legQty !== qty) {
      issues.push(`target legs sum to ${legQty}, order qty is ${qty}`);
    }
  }
  if (issues.length) throw new OrderIntentError(issues);

  const perContract = points * spec.pointValue;
  const equity = finite(input.equity) ? input.equity : null;
  const dollars = perContract * qty;
  const ctx = input.context ?? {};

  return {
    version: ORDER_INTENT_VERSION,
    clientOrderId: (input.clientOrderId ?? newClientOrderId()).slice(0, 80),
    createdAt: toIso(input.createdAt),
    symbol,
    side,
    entryType: input.entryType ?? "limit",
    entry,
    qty,
    stop,
    targets,
    timeInForce: input.timeInForce ?? "day",
    risk: {
      points: round4(points),
      pointValue: spec.pointValue,
      perContract: round2(perContract),
      dollars: round2(dollars),
      commission: round2(spec.commission * qty),
      pct: equity && equity > 0 ? round4(dollars / equity) : null,
      equity,
    },
    context: {
      displaySymbol: trimOrNull(ctx.displaySymbol, 16),
      grade: trimOrNull(ctx.grade, 16),
      score:
        typeof ctx.score === "number" && Number.isFinite(ctx.score) ? ctx.score : null,
      strategy: trimOrNull(ctx.strategy, 120),
      killzone: trimOrNull(ctx.killzone, 32),
      note: trimOrNull(ctx.note, 500),
    },
  };
}

/** Non-throwing form for fire-and-forget call sites (shadow recording, polls). */
export function tryBuildOrderIntent(input: OrderIntentInput): OrderIntent | null {
  try {
    return buildOrderIntent(input);
  } catch {
    return null;
  }
}

/**
 * The ticket the paper book is about to open, from `buildPaperLevels` output.
 * This is the parity point: the same levels that create a `PaperTrade` create
 * the intent a live adapter would receive.
 */
export function orderIntentFromPaperLevels(
  levels: BuiltPaperLevels,
  opts?: {
    clientOrderId?: string;
    equity?: number | null;
    killzone?: string | null;
    strategy?: string | null;
    score?: number | null;
    note?: string | null;
    entryType?: OrderEntryType;
    timeInForce?: TimeInForce;
    createdAt?: string | number | Date;
  },
): OrderIntent {
  return buildOrderIntent({
    symbol: levels.symbol,
    side: levels.side,
    entry: levels.entry,
    stop: levels.stop,
    qty: levels.contracts,
    targets: [levels.tp1, levels.tp2],
    entryType: opts?.entryType ?? "limit",
    timeInForce: opts?.timeInForce,
    clientOrderId: opts?.clientOrderId,
    createdAt: opts?.createdAt,
    equity: opts?.equity ?? null,
    context: {
      displaySymbol: levels.displaySymbol,
      grade: String(levels.grade),
      score: opts?.score ?? null,
      strategy: opts?.strategy ?? null,
      killzone: opts?.killzone ?? null,
      note: opts?.note ?? null,
    },
  });
}

/**
 * The ticket equivalent to an already-open paper trade. `clientOrderId`
 * defaults to the paper trade id so the book row, the mirrored `desk_trades`
 * row and the shadow record all carry ONE identity.
 */
export function orderIntentFromPaperTrade(
  trade: PaperTrade,
  opts?: {
    equity?: number | null;
    killzone?: string | null;
    entryType?: OrderEntryType;
    timeInForce?: TimeInForce;
  },
): OrderIntent {
  return buildOrderIntent({
    symbol: trade.symbol,
    side: trade.side,
    entry: trade.entry,
    stop: trade.stop,
    qty: trade.contracts,
    targets: [trade.tp1, trade.tp2],
    entryType: opts?.entryType ?? "limit",
    timeInForce: opts?.timeInForce,
    clientOrderId: trade.id,
    createdAt: trade.openedAt,
    equity: opts?.equity ?? null,
    context: {
      displaySymbol: trade.displaySymbol,
      grade: trade.grade,
      score: trade.score,
      strategy: trade.strategy,
      killzone: null,
      note: trade.reason,
    },
  });
}

/** Non-throwing pre-check for UI ("would this be a legal ticket?"). */
export function validateOrderIntent(
  input: OrderIntentInput,
): { ok: true } | { ok: false; issues: string[] } {
  try {
    buildOrderIntent(input);
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      issues: err instanceof OrderIntentError ? err.issues : ["invalid order intent"],
    };
  }
}

/** Human-readable one-liner for logs and the shadow diff review. */
export function describeOrderIntent(intent: OrderIntent): string {
  const tps = intent.targets.map((t) => `${t.label} ${t.price}`).join(" · ");
  return [
    `${intent.symbol} ${intent.side.toUpperCase()} ${intent.qty}ct`,
    `${intent.entryType} @ ${intent.entry}`,
    `SL ${intent.stop}`,
    tps,
    `risk $${intent.risk.dollars.toFixed(2)}`,
  ]
    .filter(Boolean)
    .join(" · ");
}

/* ------------------------------------------------------------------ *
 * Wire schema — validates an intent coming back off the wire / out of jsonb
 * ------------------------------------------------------------------ */

const contractKeys = Object.keys(CONTRACTS) as [ContractKey, ...ContractKey[]];

export const orderIntentSchema = z.object({
  version: z.number().int().min(1).max(ORDER_INTENT_VERSION),
  clientOrderId: z.string().min(1).max(80),
  createdAt: z.string().datetime(),
  symbol: z.enum(contractKeys),
  side: z.enum(["long", "short"]),
  entryType: z.enum(["market", "limit", "stop"]),
  entry: z.number().finite().positive(),
  qty: z.number().int().min(1).max(1000),
  stop: z.number().finite().positive(),
  targets: z
    .array(
      z.object({
        label: z.string().min(1).max(16),
        price: z.number().finite().positive(),
        qty: z.number().int().min(0).max(1000),
        rMultiple: z.number().finite(),
      }),
    )
    .max(8),
  timeInForce: z.enum(["day", "gtc", "ioc"]),
  risk: z.object({
    points: z.number().finite().nonnegative(),
    pointValue: z.number().finite().positive(),
    perContract: z.number().finite().nonnegative(),
    dollars: z.number().finite().nonnegative(),
    commission: z.number().finite().nonnegative(),
    pct: z.number().finite().nullable(),
    equity: z.number().finite().nullable(),
  }),
  context: z.object({
    displaySymbol: z.string().max(16).nullable(),
    grade: z.string().max(16).nullable(),
    score: z.number().finite().nullable(),
    strategy: z.string().max(120).nullable(),
    killzone: z.string().max(32).nullable(),
    note: z.string().max(500).nullable(),
  }),
});

export type OrderIntentWire = z.output<typeof orderIntentSchema>;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}
