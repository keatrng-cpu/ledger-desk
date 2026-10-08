/**
 * Robinhood session for the desk sender.
 * RH_ACCESS_TOKEN is a bearer for api.robinhood.com. Unset → null (nothing is sent).
 * Orders are single-leg, Agentic 995386158 only. Review runs before place.
 */
import { RH_PREFERRED_ACCOUNT_NUMBER } from "./rh-autofire-gates";
import type { RhOrder } from "./rh-cycle";
import type { RhPos, RhQuote, RhTooling } from "./rh-tools";

const BASE = "https://api.robinhood.com";

function num(x: unknown): number | null {
  const v = typeof x === "number" ? x : typeof x === "string" && x.trim() !== "" ? Number(x) : NaN;
  return Number.isFinite(v) ? v : null;
}

type FetchLike = typeof fetch;

async function readJson(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function resultsOf(body: unknown): Record<string, unknown>[] {
  if (Array.isArray(body)) return body.filter((x) => x && typeof x === "object") as Record<string, unknown>[];
  const r = (body as { results?: unknown } | null)?.results;
  return Array.isArray(r) ? (r.filter((x) => x && typeof x === "object") as Record<string, unknown>[]) : [];
}

function placeBody(order: RhOrder, refId: string): Record<string, unknown> {
  const body: Record<string, unknown> = {
    account: `${BASE}/accounts/${order.account_number}/`,
    legs: order.legs.map((l) => ({
      option: `${BASE}/options/instruments/${l.option_id}/`,
      side: l.side,
      position_effect: l.position_effect,
      ratio_quantity: l.ratio_quantity,
    })),
    type: order.type,
    trigger: "immediate",
    quantity: order.quantity,
    time_in_force: order.time_in_force,
    ref_id: refId,
  };
  if (order.type === "limit" && order.price) body.price = order.price;
  return body;
}

export function toolingFromEnv(
  env: Record<string, string | undefined> = process.env,
  fetchImpl: FetchLike = fetch,
): RhTooling | null {
  const token = (env.RH_ACCESS_TOKEN ?? "").trim();
  if (!token) return null;
  const base = (env.RH_API_BASE ?? BASE).replace(/\/$/, "");
  const headers = { Authorization: `Bearer ${token}`, Accept: "application/json", "Content-Type": "application/json" };
  let dayPct: number | null = null;

  async function get(path: string): Promise<{ status: number; body: unknown }> {
    const res = await fetchImpl(`${base}${path}`, { headers });
    return { status: res.status, body: await readJson(res) };
  }

  return {
    async readAccount() {
      const accounts = await get("/accounts/?default_to_all_accounts=true");
      const row = resultsOf(accounts.body).find((a) => String(a.account_number ?? "") === RH_PREFERRED_ACCOUNT_NUMBER);
      if (!row || accounts.status >= 400) return null;
      const port = await get(`/portfolios/${RH_PREFERRED_ACCOUNT_NUMBER}/`);
      const p = (port.body ?? {}) as Record<string, unknown>;
      const equity = num(p.equity ?? p.extended_hours_equity);
      const prev = num(p.adjusted_equity_previous_close ?? p.last_core_equity);
      dayPct = equity != null && prev != null && prev > 0 ? (equity - prev) / prev : null;
      const buying = num(row.buying_power) ?? num(p.withdrawable_amount);
      return {
        account: row,
        portfolio: {
          cash: p.withdrawable_amount ?? row.cash ?? 0,
          buying_power: { buying_power: buying ?? row.buying_power },
        },
      };
    },
    async dayPnlPct() {
      return dayPct;
    },
    async positions() {
      const res = await get(`/options/positions/?account_numbers=${RH_PREFERRED_ACCOUNT_NUMBER}&nonzero=true`);
      if (res.status >= 400) return [];
      return resultsOf(res.body).map((p): RhPos => {
        const type = String(p.type ?? p.option_type ?? "").toLowerCase();
        return {
          optionId: String(p.option_id ?? p.option ?? "").replace(/\/$/, "").split("/").pop() || "",
          quantity: Math.abs(num(p.quantity) ?? 0),
          averagePrice: num(p.average_price),
          chainSymbol: String(p.chain_symbol ?? ""),
          optionType: type === "call" || type === "put" ? type : null,
        };
      }).filter((p) => p.optionId && p.quantity > 0);
    },
    async quote(optionId) {
      const res = await get(`/marketdata/options/?instruments=${encodeURIComponent(optionId)}`);
      const row = resultsOf(res.body)[0] ?? (res.body as Record<string, unknown> | null);
      if (!row || res.status >= 400) return null;
      const q: RhQuote = { bid: num(row.bid_price), ask: num(row.ask_price), asOfMs: Date.now() };
      return q;
    },
    async findOption(q) {
      const qs = new URLSearchParams({
        chain_symbol: q.underlier,
        expiration_dates: q.expiry,
        strike_price: String(q.strike),
        type: q.type,
        state: "active",
      });
      const res = await get(`/options/instruments/?${qs.toString()}`);
      const id = resultsOf(res.body)[0]?.id;
      return typeof id === "string" && id ? id : null;
    },
    async review(order) {
      const res = await fetchImpl(`${base}/options/orders/review/`, {
        method: "POST",
        headers,
        body: JSON.stringify(placeBody(order, refFrom(order))),
      });
      const body = await readJson(res);
      if (res.status === 404 || res.status === 405) {
        return { ok: false, blocking: true, alerts: ["Robinhood review is not available on this session."] };
      }
      const alerts = alertLines(body);
      const blocking = res.status >= 400 || alerts.some((a) => /not enough|rejected|cannot|insufficient|halt/i.test(a));
      return { ok: res.status < 400 && !blocking, blocking, alerts };
    },
    async place(order, refId) {
      const res = await fetchImpl(`${base}/options/orders/`, {
        method: "POST",
        headers,
        body: JSON.stringify(placeBody(order, refId)),
      });
      const body = (await readJson(res)) as { id?: string; detail?: string } | null;
      if (res.status >= 400 || !body?.id) {
        throw new Error(body?.detail || `place ${res.status}`);
      }
      return { id: body.id };
    },
  };
}

function refFrom(order: RhOrder): string {
  return order.refKey;
}

function alertLines(body: unknown): string[] {
  if (!body || typeof body !== "object") return [];
  const b = body as Record<string, unknown>;
  const raw = b.alerts ?? b.order_checks ?? b.detail;
  if (typeof raw === "string") return [raw];
  if (Array.isArray(raw)) {
    return raw.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).slice(0, 8);
  }
  return [];
}
