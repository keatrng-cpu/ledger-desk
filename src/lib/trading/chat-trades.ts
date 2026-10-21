/**
 * Chat trades (Keaton + assistant, live-tape armed_*.py). SHADOW evidence only:
 * read by Review (journal + chart), Brain/Floor (setup priors). No gate, score,
 * size or fire path reads this module. Not in desk-rules.json -> RULES_HASH unchanged.
 */
export interface ChatExit { qty: number; px: number | null; tag: string; ct?: string }
export interface ChatTrade {
  id: string; day: string; setup: string; symbol: string; side: "long" | "short"; contract: string; qty: number;
  entry: number; entry_ct?: string; exits: ChatExit[]; pnl: number | null; trigger?: string;
  stop?: number; t1?: number; runner?: number; sweep?: number; u_entry?: number; smt?: string; note?: string; src?: string;
}
export interface Bar { t: number; o: number; h: number; l: number; c: number }

/** Parse armed-trade.log. Day comes from the BUY line's contract date. Manual/CORRECTION/FINAL lines override P&L. */
export function parseArmedLog(text: string): ChatTrade[] {
  const out: ChatTrade[] = [];
  let pend: { day: string; strike: number; right: string } | null = null;
  let cur: ChatTrade | null = null;
  let lastSetup = "?";
  for (const line of text.split("\n")) {
    const ct = line.slice(0, 8);
    const tag = [...line.matchAll(/\[([A-Z]\d?)\]/g)].map((m) => m[1]);
    const s = line.match(/\[([A-Z]\d?)\] (?:FIRE|ARMED|ENTRY|TRIGGER|LONG TRIGGER|SHORT TRIGGER)/);
    if (s && s[1] !== "D") lastSetup = s[1];
    const old = line.match(/CT ([A-Z]) BUY sent/); if (old) lastSetup = old[1];
    const buy = line.match(/BUY (?:sent: )?\d+x (\w+) (\d{4}-\d\d-\d\d) ([\d.]+)([CP])/);
    if (buy) pend = { day: buy[2], strike: Number(buy[3]), right: buy[4] };
    const fill = line.match(/(?:ENTRY FILLED|CT [A-Z] FILLED) (\d+)x @ ([\d.]+)/);
    if (fill && pend) {
      const side = pend.right === "C" ? "long" : "short";
      cur = { id: `chat-${pend.day}-${lastSetup}`, day: pend.day, setup: `${lastSetup}-${side.toUpperCase()}`, symbol: "QQQ", side,
        contract: `QQQ ${pend.day} ${pend.strike}${pend.right}`, qty: Number(fill[1]), entry: Number(fill[2]), entry_ct: ct, exits: [], pnl: null };
      out.push(cur); pend = null;
    }
    const sold = line.match(/(?:sold|filled) (\d+)x @ ([\d.]+)/);
    if (sold && cur) cur.exits.push({ qty: Number(sold[1]), px: Number(sold[2]), tag: /T1/.test(line) ? "T1" : "exit", ct });
    const done = line.match(/TRADE COMPLETE: .*P&L=\$(-?[\d.]+)/);
    if (done && cur && cur.pnl == null) cur.pnl = Number(done[1]);
    // corrections: "= +$72", "total P&L +$75", "= +$30" on CORRECTION / FINAL / closed manually lines
    if (/CORRECTION|FINAL|closed manually/.test(line)) {
      const m = line.match(/(?:=|P&L)\s*([+-])\$(\d+(?:\.\d+)?)/);
      const who = tag.find((x) => x !== "D");
      const tgt = [...out].reverse().find((t) => who && t.setup.startsWith(who + "-")) ?? cur;
      if (m && tgt) { tgt.pnl = (m[1] === "-" ? -1 : 1) * Number(m[2]); tgt.note = `corrected: ${line.slice(9, 160)}`; }
    }
  }
  return out;
}

/** Merge parsed log trades into the curated journal; curated rows win (by id). */
export function mergeChatTrades(curated: ChatTrade[], parsed: ChatTrade[]): ChatTrade[] {
  const key = (t: ChatTrade) => `${t.day}|${t.qty}|${t.entry}`;
  const ids = new Set(curated.flatMap((t) => [t.id, key(t)]));
  return [...curated, ...parsed.filter((t) => !ids.has(t.id) && !ids.has(key(t)))].sort((a, b) => (a.day + (a.entry_ct ?? "")).localeCompare(b.day + (b.entry_ct ?? "")));
}

/** Learning (shadow): per-tag priors from chat outcomes. Tags = setup traits from the trigger text. */
export function chatTags(t: ChatTrade): string[] {
  const s = `${t.trigger ?? ""} ${t.smt ?? ""}`.toLowerCase();
  const tags: string[] = [t.side];
  if (/sweep|swept/.test(s)) tags.push("sweep");
  if (/smt/.test(s)) tags.push("smt");
  if (/inversion|reclaim|prior high|displacement/.test(s)) tags.push("ltf_inversion");
  if (/5m/.test(s)) tags.push("htf_close");
  return tags;
}
export interface ChatPrior { tag: string; n: number; wins: number; winRate: number; avgPnl: number }
export function chatSetupPriors(trades: ChatTrade[]): ChatPrior[] {
  const m = new Map<string, { n: number; w: number; p: number }>();
  for (const t of trades) if (t.pnl != null) for (const tag of chatTags(t)) {
    const a = m.get(tag) ?? { n: 0, w: 0, p: 0 }; a.n++; if (t.pnl > 0) a.w++; a.p += t.pnl; m.set(tag, a);
  }
  return [...m].map(([tag, a]) => ({ tag, n: a.n, wins: a.w, winRate: a.w / a.n, avgPnl: a.p / a.n })).sort((x, y) => y.n - x.n);
}
/** Shadow comparison for a desk card: which chat traits it has/misses and the chat prior. Informs, never permits. */
export function chatShadowRead(card: { side: "long" | "short"; sweep?: boolean; smt?: boolean; ltfArmed?: boolean }, priors: ChatPrior[]) {
  const has = [card.side, card.sweep && "sweep", card.smt && "smt", card.ltfArmed && "ltf_inversion"].filter(Boolean) as string[];
  const miss = ["sweep", "smt", "ltf_inversion"].filter((x) => !has.includes(x));
  const p = priors.filter((x) => has.includes(x.tag));
  return { has, miss, n: Math.min(...p.map((x) => x.n), Infinity), line: `chat prior ${has.join("+")}: ${p.map((x) => `${x.tag} ${x.wins}/${x.n}`).join(", ")}${miss.length ? ` · missing ${miss.join(",")}` : ""}`, live: false as const };
}

/** Marked-up chart from CLOSED bars only (bars with t <= asOf - 60s). Returns an SVG string. */
export function chatTradeChartSvg(t: ChatTrade, bars: Bar[], opts: { w?: number; h?: number; tz?: string; asOfSec?: number } = {}): string {
  const esc = (x: string) => x.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const W = opts.w ?? 900, H = opts.h ?? 420, P = 48, R = 110;
  const ctToSec = (ct?: string) => { if (!ct) return NaN; const [h, m, s] = ct.split(":").map(Number); return h * 3600 + m * 60 + (s || 0); };
  const tod = (sec: number) => { const d = new Date(sec * 1000); const f = new Intl.DateTimeFormat("en-US", { timeZone: opts.tz ?? "America/Chicago", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).formatToParts(d); const g = (k: string) => Number(f.find((x) => x.type === k)?.value); return g("hour") * 3600 + g("minute") * 60 + g("second"); };
  const closed = bars.filter((b) => opts.asOfSec == null || b.t + 60 <= opts.asOfSec);
  const eSec = ctToSec(t.entry_ct), xs = t.exits.map((e) => ctToSec(e.ct)).filter(Number.isFinite);
  const lo = (eSec || 0) - 25 * 60, hi = Math.max(eSec || 0, ...xs) + 15 * 60;
  const win = closed.filter((b) => { const s = tod(b.t); return s >= lo && s <= hi; });
  if (!win.length) return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="60"><text x="10" y="30">no closed bars for ${t.id}</text></svg>`;
  const lv = [t.stop, t.t1, t.runner, t.sweep].filter((x): x is number => x != null);
  const yMin = Math.min(...win.map((b) => b.l), ...lv) - 0.2, yMax = Math.max(...win.map((b) => b.h), ...lv) + 0.2;
  const X = (i: number) => P + (i + 0.5) * ((W - P - R) / win.length), Y = (v: number) => P + (yMax - v) / (yMax - yMin) * (H - 2 * P);
  const bw = Math.max(2, ((W - P - R) / win.length) * 0.6);
  const idxOf = (sec: number) => { let k = 0; win.forEach((b, i) => { if (tod(b.t) <= sec) k = i; }); return k; };
  let g = `<rect width="${W}" height="${H}" fill="#0d1117"/>`;
  win.forEach((b, i) => { const up = b.c >= b.o, col = up ? "#26a69a" : "#ef5350";
    g += `<line x1="${X(i)}" x2="${X(i)}" y1="${Y(b.h)}" y2="${Y(b.l)}" stroke="${col}"/><rect x="${X(i) - bw / 2}" y="${Y(Math.max(b.o, b.c))}" width="${bw}" height="${Math.max(1, Math.abs(Y(b.o) - Y(b.c)))}" fill="${col}"/>`; });
  const hl = (v: number | undefined, col: string, label: string, dash = "") => v == null ? "" : `<line x1="${P}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}" stroke="${col}" stroke-dasharray="${dash}"/><text x="${W - R + 4}" y="${Y(v) + (label === "swept" && v === t.stop ? 16 : 4)}" fill="${col}" font-size="11">${label} ${v}</text>`;
  g += hl(t.stop, "#ef5350", "stop", "4 3") + hl(t.t1, "#66bb6a", "T1", "4 3") + hl(t.runner, "#29b6f6", "run", "4 3") + hl(t.sweep, "#ffb300", "swept", "1 3");
  if (Number.isFinite(eSec)) { const i = idxOf(eSec), y = Y(t.u_entry ?? win[i].c);
    g += `<path d="M${X(i)},${y + 4} l-7,12 h14 z" fill="#fff"/><text x="${X(i) - 30}" y="${y + 30}" fill="#fff" font-size="11">BUY ${t.qty}x @${t.entry}</text>`; }
  t.exits.forEach((e) => { const s = ctToSec(e.ct); if (!Number.isFinite(s)) return; const i = idxOf(s), y = Y(win[i].h);
    g += `<path d="M${X(i)},${y - 4} l-7,-12 h14 z" fill="#ffd54f"/><text x="${X(i) - 30}" y="${y - 20}" fill="#ffd54f" font-size="11">${esc(e.tag.slice(0, 22))}${e.px ? " @" + e.px : ""}</text>`; });
  g += `<text x="${P}" y="24" fill="#e6edf3" font-size="14" font-family="sans-serif">${esc(t.setup)} · ${esc(t.contract)} · ${t.pnl == null ? "?" : (t.pnl >= 0 ? "+$" : "−$") + Math.abs(t.pnl)} · ${t.day}</text>`;
  g += `<text x="${P}" y="${H - 14}" fill="#8b949e" font-size="11" font-family="sans-serif">${esc((t.trigger ?? "").slice(0, 120))} · closed 1m bars</text>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" font-family="sans-serif">${g}</svg>`;
}
