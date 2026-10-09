/**
 * The ask the desk would pay, read from Robinhood and cached for two seconds.
 * Four contracts: QQQ and SPY, call and put, at the nearest strike of the
 * session that is still open. No session, no number. A model price is not a mark.
 */
import type { Sql } from "@/lib/db";
import type { RhTooling } from "./rh-tools";

export interface OptionMark {
  underlier: "QQQ" | "SPY";
  side: "call" | "put";
  strike: number;
  expiry: string;
  bid: number | null;
  ask: number;
  asOfMs: number;
}

const ID_MS = 15 * 60_000;
const MARK_MS = 2_000;
const ids = new Map<string, { id: string; at: number }>();
let last: { at: number; key: string; marks: OptionMark[] } | null = null;

function etParts(now: Date): { y: number; m: number; d: number; h: number; wd: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    weekday: "short",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const wd = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
  return { y: Number(get("year")), m: Number(get("month")), d: Number(get("day")), h: Number(get("hour")), wd };
}

/** The expiry still trading. After 16:00 ET, the next weekday. */
export function liveExpiry(now = new Date()): string {
  const p = etParts(now);
  const day = new Date(Date.UTC(p.y, p.m - 1, p.d));
  if (p.h >= 16) day.setUTCDate(day.getUTCDate() + 1);
  let wd = p.h >= 16 ? (p.wd + 1) % 7 : p.wd;
  while (wd === 0 || wd === 6) {
    day.setUTCDate(day.getUTCDate() + 1);
    wd = (wd + 1) % 7;
  }
  const y = day.getUTCFullYear();
  const m = String(day.getUTCMonth() + 1).padStart(2, "0");
  const d = String(day.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

async function tooling(sql: Sql | null): Promise<RhTooling | null> {
  if (sql) {
    try {
      const rows = await sql.query<{ user_id: string }>(`select user_id from rh_oauth order by updated_at desc limit 1`);
      const userId = rows[0]?.user_id;
      if (userId) {
        const { toolingFromStored } = await import("./rh-mcp");
        const stored = await toolingFromStored(sql, userId);
        if (stored) return stored;
      }
    } catch {
      /* the env token is the other door */
    }
  }
  const { toolingFromEnv } = await import("./rh-http");
  return toolingFromEnv();
}

async function contractId(tools: RhTooling, underlier: "QQQ" | "SPY", side: "call" | "put", strike: number, expiry: string): Promise<string | null> {
  const key = `${underlier}:${expiry}:${side}:${strike}`;
  const hit = ids.get(key);
  if (hit && Date.now() - hit.at < ID_MS) return hit.id;
  const id = await tools.findOption({ underlier, expiry, type: side, strike });
  if (!id) return null;
  ids.set(key, { id, at: Date.now() });
  return id;
}

/** Null when Robinhood is not connected. Never a guessed premium. */
export async function readOptionMarks(
  spots: { QQQ: number | null; SPY: number | null },
  sql: Sql | null,
  now = new Date(),
): Promise<OptionMark[] | null> {
  const expiry = liveExpiry(now);
  const want = (["QQQ", "SPY"] as const).flatMap((underlier) => {
    const spot = spots[underlier];
    if (spot == null || !(spot > 0)) return [];
    const strike = Math.round(spot);
    return (["call", "put"] as const).map((side) => ({ underlier, side, strike, expiry }));
  });
  if (!want.length) return null;
  const key = want.map((w) => `${w.underlier}:${w.side}:${w.strike}:${w.expiry}`).join("|");
  if (last && last.key === key && Date.now() - last.at < MARK_MS) return last.marks;
  const tools = await tooling(sql);
  if (!tools) return null;
  const marks: OptionMark[] = [];
  await Promise.all(
    want.map(async (w) => {
      const id = await contractId(tools, w.underlier, w.side, w.strike, w.expiry).catch(() => null);
      const q = id ? await tools.quote(id).catch(() => null) : null;
      if (!q || q.ask == null || !(q.ask > 0)) return;
      marks.push({ ...w, bid: q.bid, ask: q.ask, asOfMs: q.asOfMs });
    }),
  );
  if (!marks.length) return null;
  last = { at: Date.now(), key, marks };
  return marks;
}
