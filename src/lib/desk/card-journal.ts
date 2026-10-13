/**
 * Fix 23 + 25 — the desk scores itself. Every A-/A/A+ card with a real
 * entry, stop and target is journaled once; open rows are resolved against
 * the live price on each card read; a closed row gets the Master seat's
 * post-trade review. The weekly report changes nothing by itself: it says
 * what each band earned and whether n is big enough to act on.
 */
import type { Sql } from "@/lib/db";

export const JOURNAL_BANDS = ["A+", "A", "A-"] as const;
export const RECAL_MIN_N = 30;

export interface JournalCard {
  symbol: string;
  side: string;
  band: string | null;
  q: number;
  entry: number | null;
  stopPx: number | null;
  target: number | null;
  rr: number | null;
  context: Record<string, unknown>;
}

const DDL = `create table if not exists desk_card_journal (
  id text primary key, day_key text not null, symbol text not null, side text not null, band text not null,
  q double precision not null, entry double precision not null, stop double precision not null, target double precision not null,
  rr double precision, opened_ms bigint not null, filled boolean not null default false, status text not null default 'open',
  r double precision, closed_ms bigint, context jsonb not null default '{}'::jsonb, review text)`;
let ready = false;
async function ensure(sql: Sql) {
  if (ready) return;
  await sql.query(DDL);
  ready = true;
}

export function etDayKey(ms: number): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date(ms));
}
export function etMinutes(ms: number): number {
  const p = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(ms));
  return Number(p.find((x) => x.type === "hour")?.value) * 60 + Number(p.find((x) => x.type === "minute")?.value);
}

export async function journalCards(sql: Sql, cards: JournalCard[], nowMs: number): Promise<number> {
  await ensure(sql);
  let n = 0;
  const day = etDayKey(nowMs);
  for (const c of cards) {
    if (!c.band || !(JOURNAL_BANDS as readonly string[]).includes(c.band)) continue;
    if (c.entry == null || c.stopPx == null || c.target == null) continue;
    const id = `${day}:${c.symbol}:${c.side}:${c.entry.toFixed(2)}`;
    await sql.query(
      `insert into desk_card_journal (id, day_key, symbol, side, band, q, entry, stop, target, rr, opened_ms, context)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb) on conflict (id) do nothing`,
      [id, day, c.symbol, c.side, c.band, c.q, c.entry, c.stopPx, c.target, c.rr, nowMs, JSON.stringify(c.context)],
    );
    n++;
  }
  return n;
}

/** Pure: what one sampled price does to an open row. */
export function resolveRow(
  r: { side: string; entry: number; stop: number; target: number; filled: boolean },
  px: number,
  pastFlat: boolean,
): { filled: boolean; status: "open" | "win" | "loss" | "flat" | "unfilled"; r: number | null } {
  const long = r.side === "long";
  const risk = Math.abs(r.entry - r.stop);
  const filled = r.filled || (long ? px <= r.entry : px >= r.entry);
  if (!filled) return { filled, status: pastFlat ? "unfilled" : "open", r: null };
  if (!(risk > 0)) return { filled, status: "flat", r: 0 };
  if (long ? px <= r.stop : px >= r.stop) return { filled, status: "loss", r: -1 };
  if (long ? px >= r.target : px <= r.target) return { filled, status: "win", r: +(Math.abs(r.target - r.entry) / risk).toFixed(2) };
  if (pastFlat) return { filled, status: "flat", r: +((long ? px - r.entry : r.entry - px) / risk).toFixed(2) };
  return { filled, status: "open", r: null };
}

/** Fix 25: the Master seat's review line for a closed row. */
export function reviewOf(status: string, r: number | null, ctx: Record<string, unknown>): string {
  const bits = [`${status.toUpperCase()}${r != null ? ` ${r > 0 ? "+" : ""}${r}R` : ""}`];
  if (ctx.mtfAlign != null) bits.push(`MTF align ${ctx.mtfAlign}`);
  if (ctx.chop) bits.push("taken in chop");
  if (ctx.ltfKill) bits.push(`LTF kill live at entry: ${ctx.ltfKill}`);
  if (ctx.dispStrength != null) bits.push(`displacement ${ctx.dispStrength}`);
  if (ctx.smt) bits.push(`SMT ${ctx.smt}`);
  if (ctx.master) bits.push(`Master said ${ctx.master}`);
  if (status === "loss" && ctx.chop) bits.push("lesson: A-band in chop lost");
  if (status === "loss" && Number(ctx.mtfAlign ?? 1) < 0.67) bits.push("lesson: alignment under 2/3");
  if (status === "win" && ctx.master === "PASS") bits.push("lesson: Master passed a winner");
  return bits.join(" · ");
}

interface Row { id: string; symbol: string; side: string; entry: number; stop: number; target: number; filled: boolean; day_key: string; context: unknown }

export async function resolveJournal(sql: Sql, prices: Record<string, number | null>, nowMs: number): Promise<number> {
  await ensure(sql);
  const rows = await sql.query<Row>(`select id, symbol, side, entry, stop, target, filled, day_key, context from desk_card_journal where status = 'open'`);
  const today = etDayKey(nowMs);
  let changed = 0;
  for (const r of rows) {
    const px = prices[r.symbol];
    const pastFlat = r.day_key < today || etMinutes(nowMs) >= 15 * 60 + 30;
    if (px == null || !Number.isFinite(px)) {
      if (r.day_key < today) {
        await sql.query(`update desk_card_journal set status = 'unscored', closed_ms = $2, review = 'no price sampled before the flat' where id = $1`, [r.id, nowMs]);
        changed++;
      }
      continue;
    }
    const o = resolveRow({ side: r.side, entry: Number(r.entry), stop: Number(r.stop), target: Number(r.target), filled: Boolean(r.filled) }, px, pastFlat);
    if (o.status === "open" && o.filled === Boolean(r.filled)) continue;
    const ctx = (typeof r.context === "string" ? JSON.parse(r.context) : (r.context ?? {})) as Record<string, unknown>;
    await sql.query(`update desk_card_journal set filled = $2, status = $3, r = $4, closed_ms = $5, review = $6 where id = $1`, [
      r.id,
      o.filled,
      o.status,
      o.r,
      o.status === "open" ? null : nowMs,
      o.status === "open" ? null : reviewOf(o.status, o.r, ctx),
    ]);
    changed++;
  }
  return changed;
}

export interface BandStat { band: string; n: number; wins: number; winRate: number | null; avgR: number | null; suggestion: string }

/** Pure: band stats + a recalibration SUGGESTION (never applied). */
export function bandReport(rows: { band: string; status: string; r: number | null }[]): BandStat[] {
  return JOURNAL_BANDS.map((band) => {
    const closed = rows.filter((x) => x.band === band && (x.status === "win" || x.status === "loss" || x.status === "flat"));
    const n = closed.length;
    const wins = closed.filter((x) => (x.r ?? 0) > 0).length;
    const avgR = n ? +(closed.reduce((s, x) => s + (x.r ?? 0), 0) / n).toFixed(2) : null;
    const suggestion =
      n < RECAL_MIN_N
        ? `insufficient n (${n}/${RECAL_MIN_N}) — no change`
        : avgR! < 0
          ? `negative expectancy over n=${n} — consider raising the ${band} q floor`
          : `positive expectancy over n=${n} — floor holds`;
    return { band, n, wins, winRate: n ? +(wins / n).toFixed(2) : null, avgR, suggestion };
  });
}

export async function journalReport(sql: Sql, nowMs: number, days = 7) {
  await ensure(sql);
  const from = etDayKey(nowMs - days * 86400e3);
  const rows = await sql.query<{ band: string; status: string; r: number | null; day_key: string; review: string | null; symbol: string; side: string }>(
    `select band, status, r, day_key, review, symbol, side from desk_card_journal where day_key >= $1 order by opened_ms desc`,
    [from],
  );
  const today = etDayKey(nowMs);
  const todays = rows.filter((x) => x.day_key === today && x.r != null && x.status !== "open");
  const rToday = todays.length ? +todays.reduce((s, x) => s + Number(x.r), 0).toFixed(2) : null;
  return {
    from,
    bands: bandReport(rows.map((x) => ({ band: x.band, status: x.status, r: x.r == null ? null : Number(x.r) }))),
    rToday,
    closedToday: todays.length,
    open: rows.filter((x) => x.status === "open").length,
    reviews: rows.filter((x) => x.review).slice(0, 10).map((x) => ({ day: x.day_key, symbol: x.symbol, side: x.side, review: x.review })),
    note: "Outcomes sampled at card reads (not tick data). Journal covers A-/A/A+ cards with entry, stop and target.",
  };
}

/** Fix 19: after ±2R on the day, A+ only. Null rToday (no data) = normal. */
export function governorOf(rToday: number | null): "normal" | "A+ only" {
  return rToday != null && Math.abs(rToday) >= 2 ? "A+ only" : "normal";
}
