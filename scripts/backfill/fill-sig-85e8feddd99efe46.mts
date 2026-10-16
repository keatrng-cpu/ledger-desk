/**
 * ONE-TIME backfill: the 10/15 live fill the watcher made before /api/desk/fills existed
 * (sig-85e8feddd99efe46 · RH entry order 6ad1151c-8bc9-4446-a02f-9223be78a8f9 · B+ ES long · 1x SPY 2026-10-16 770C @ 2.96, out @ 2.60).
 *
 *   npx tsx scripts/backfill/fill-sig-85e8feddd99efe46.mts [--watcher-dir /workspace/desk-watcher]          # dry run (default): prints payloads
 *   WATCHER_STATUS_TOKEN=... npx tsx scripts/backfill/fill-sig-85e8feddd99efe46.mts --apply --url https://<site>/api/desk/fills
 *
 * Builds the three events (placed, filled, exit) from the watcher's own log lines, then POSTs them through the same
 * endpoint the live watcher uses, so the write is idempotent (room_orders keyed by signal; desk_trades opened once).
 * Requires migration 0027 + this PR deployed. Never prints the token or the account number.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { scrubText, scrubValue } from "../../src/lib/notify/scrub.ts";

export const SIGNAL = "sig-85e8feddd99efe46";
type Rec = { ts?: string; kind?: string; text?: string; signal?: string; result?: { id?: string } | null };

export function buildBackfill(lines: string[]) {
  const recs: Rec[] = lines.map((l) => { try { return JSON.parse(l) as Rec; } catch { return {}; } });
  const placed = recs.find((r) => r.kind === "alert" && r.text?.startsWith("PLACED") && r.text.includes(`key=${SIGNAL}`));
  if (!placed) throw new Error(`no PLACED line for ${SIGNAL}`);
  const i = recs.indexOf(placed);
  const fire = recs.slice(i, i + 5).find((r) => r.text?.startsWith("FIRE "));
  const fill = recs.slice(i).find((r) => r.text?.startsWith("FILLED "));
  const exit = recs.slice(i).find((r) => r.text?.startsWith("EXIT "));
  const fm = fire?.text?.match(/^FIRE (\S+) (ES|MNQ) (long|short).*?entry=([\d.]+) stop=([\d.]+) tgt=([\d.]+)/);
  const pm = placed.text!.match(/^PLACED (\d+)x (\S+) (\S+) ([\d.]+)([CP]) @ ([\d.]+)/);
  if (!fm || !pm) throw new Error("could not parse FIRE/PLACED");
  const base = { signal: SIGNAL, symbol: fm[2], side: fm[3], band: fm[1], plan: { entry: +fm[4], stop: +fm[5], t1: +fm[6] },
    option: { underlier: pm[2], expiry: pm[3], strike: +pm[4], right: pm[5] === "C" ? "call" : "put", limit: +pm[6] }, qty: +pm[1] };
  const ms = (r?: Rec) => Date.parse(r?.ts ?? "");
  const out: Record<string, unknown>[] = [{ ...base, event: "placed", orderId: placed.result?.id, atMs: ms(placed) }];
  const f = fill?.text?.match(/^FILLED (\d+) @ ([\d.]+)/);
  if (f) out.push({ ...base, event: "filled", orderId: placed.result?.id, atMs: ms(fill), qty: +f[1], fillPx: +f[2] });
  const x = exit?.text?.match(/^EXIT (\d+) @ ([\d.]+):?\s*(.*?)\s*(?:\(px ([\d.]+)\))?$/);
  if (x && f) out.push({ ...base, event: "exit", orderId: exit?.result?.id, atMs: ms(exit), qty: +x[1], exitPx: +x[2], reason: x[3] || "exit",
    exitUnderlierPx: x[4] ? +x[4] : undefined, optionPnl: Math.round((+x[2] - +f[2]) * +x[1] * 100 * 100) / 100 });
  return out;
}

async function main() {
  const a = process.argv.slice(2); const arg = (k: string) => { const i = a.indexOf(`--${k}`); return i >= 0 ? a[i + 1] : undefined; };
  const dir = arg("watcher-dir") ?? "/workspace/desk-watcher";
  const payloads = buildBackfill(readFileSync(join(dir, "watcher.log"), "utf8").split("\n").filter(Boolean));
  if (!a.includes("--apply")) { console.log(JSON.stringify(scrubValue(payloads), null, 1)); /* scrubValue: strings scrubbed, numbers (atMs) kept */ console.log("dry run: nothing sent (pass --apply --url ...)"); return; }
  const url = arg("url"); const tok = process.env.WATCHER_STATUS_TOKEN?.trim();
  if (!url || !tok) throw new Error("--apply needs --url and env WATCHER_STATUS_TOKEN");
  for (const p of payloads) {
    const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${tok}` }, body: JSON.stringify(p), signal: AbortSignal.timeout(10_000) });
    console.log(p.event, r.status, scrubText((await r.text()).slice(0, 200)));
    if (!r.ok) process.exitCode = 1;
  }
}
if (process.argv[1] && /fill-sig-85e8feddd99efe46\.mts$/.test(process.argv[1])) main().catch((e) => { console.error(scrubText(String(e?.message ?? e))); process.exit(1); });
