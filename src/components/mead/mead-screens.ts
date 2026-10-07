/**
 * The Mead Hall's screens — plain 2D canvas, uploaded as three.js textures.
 *
 * Original mead-hall / Norse hall palette (pine, iron, brass) — knotwork
 * borders, nasal/spectacle iron helm. No team colors, no war-chant branding,
 * no league marks. Generic Norse only.
 * Presentation only — every number drawn here comes from the
 * PredictionMarketFeed state handed in; nothing is computed into a signal.
 */

import { isNflMarket, type PredictionMarket, type PredictionMarketFeedState, type SetupGrade } from "@/lib/predict/prediction-market-feed";
import { NO_GRADE_LABEL } from "@/lib/predict/signals";

/** Kalshi series prefix → a short family tag + a readable name. Broad on purpose: sports, econ, politics, weather, crypto. */
const SERIES: [RegExp, string, string][] = [
  [/^KXNFL/i, "NFL", "NFL game"],
  [/^KXNBA/i, "NBA", "NBA game"],
  [/^KXMLB/i, "MLB", "MLB game"],
  [/^KXNHL/i, "NHL", "NHL game"],
  [/^KXNCAAF/i, "NCAAF", "College football"],
  [/^KXGDP/i, "ECON", "GDP"],
  [/^KXCPI/i, "ECON", "CPI"],
  [/^KXFED|^FED/i, "ECON", "Fed decision"],
  [/^KXPAYROLL|^KXJOBS/i, "ECON", "Jobs report"],
  [/^KXBTC/i, "CRYPTO", "Bitcoin"],
  [/^KXETH/i, "CRYPTO", "Ether"],
  [/^KXHIGH(NY)?/i, "WEATHER", "NYC high temp"],
  [/^KX(SENATE|HOUSE|PRES|GOV|ELECT)|^(SENATE|HOUSE|PRES)/i, "POLITICS", "Election"],
];
const MOCK_TAG: [RegExp, string][] = [
  [/gdp|cpi|fed/i, "ECON"],
  [/senate|house|pres/i, "POLITICS"],
];

/** Family tag for a market of any type (NFL / NBA / ECON / POLITICS / WEATHER / CRYPTO / MARKET). */
export function categoryLabel(m: PredictionMarket): string {
  for (const [re, tag] of SERIES) if (re.test(m.id) || re.test(m.event)) return tag;
  if (m.source === "mock") {
    for (const [re, tag] of MOCK_TAG) if (re.test(m.id) || re.test(m.event)) return tag;
    if (/@/.test(m.event)) return "NFL";
  }
  return isNflMarket({ id: m.id, event: m.event }) ? "NFL" : "MARKET";
}

const MONTHS = "JAN FEB MAR APR MAY JUN JUL AUG SEP OCT NOV DEC".split(" ");

/**
 * A readable event line. Kalshi's raw `event` is an event ticker
 * ("KXHIGHNY-26OCT06"); a human event ("GB @ MIN", "Senate control 2026")
 * passes through untouched.
 */
export function eventLabel(m: PredictionMarket): string {
  const e = m.event;
  if (/\s/.test(e) || !/^[A-Z0-9]+(-[A-Z0-9.]+)+$/i.test(e)) return e;
  const [series, rest = ""] = e.split("-");
  const name = SERIES.find(([re]) => re.test(series))?.[2] ?? series.replace(/^KX/i, "");
  const d = /^(\d{2})([A-Z]{3})(\d{2})(.*)$/i.exec(rest);
  if (d && MONTHS.includes(d[2].toUpperCase())) {
    // Game events carry "hhmm" + team codes after the date ("2000NYYTB"): show the time; the outcome names the team.
    const hm = /^(\d{2})(\d{2})[A-Z]*$/i.exec(d[4]);
    const tail = hm ? ` · ${Number(hm[1]) % 12 || 12}:${hm[2]} ${Number(hm[1]) >= 12 ? "PM" : "AM"} ET` : d[4] ? ` ${d[4]}` : "";
    return `${name} · ${d[2].slice(0, 1).toUpperCase()}${d[2].slice(1).toLowerCase()} ${Number(d[3])}${tail}`;
  }
  return rest ? `${name} · ${rest}` : name;
}

export const MEAD = {
  /** Pine — primary room / turf color (H≈155°). */
  pine: "#1a3c2e",
  pineDeep: "#122820",
  pineInk: "#0a1610",
  /** Iron — metal / helm accents. */
  iron: "#6b7280",
  /** Brass — warm accents (not team gold). */
  brass: "#c4a35a",
  brassDim: "#9a7e42",
  white: "#f8f5ee",
  yes: "#22c55e",
  no: "#ef4444",
  chalk: "#e9e4d6",
  board: "#1d2420",
} as const;

/** Clickable regions on the jumbotron, in canvas px (the scene maps UV → px). */
export const JUMBO_W = 1280;
export const JUMBO_H = 720;
export const JUMBO_HITS = {
  yes: { x: 70, y: 150, w: 520, h: 150 },
  no: { x: 690, y: 150, w: 520, h: 150 },
} as const;
/** Rows of "other markets" on the jumbotron: y of the first row and row pitch. */
export const JUMBO_ROWS = { x: 70, y0: 400, pitch: 48, n: 5 } as const;

const FONT = "Inter, system-ui, sans-serif";
const SLAB = "'Rockwell', 'Roboto Slab', Georgia, serif";

export const cents = (x: number | null | undefined) => (x == null ? "—" : `${Math.round(x * 100)}¢`);
export const price2 = (x: number | null | undefined) => (x == null ? "—" : x.toFixed(2));
export const pct = (x: number | null | undefined) => (x == null ? "—" : `${Math.round(x * 100)}%`);
export const edgeTag = (x: number | null | undefined) => (x == null ? "EDGE —" : `EDGE ${x >= 0 ? "+" : "−"}${Math.abs(x * 100).toFixed(1)}¢`);

/** A strip of over-under knotwork along a rectangle — original, generated. */
export function knotBorder(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string = MEAD.brass, size = 14) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(2, size * 0.22);
  ctx.lineCap = "round";
  const strand = (x0: number, y0: number, len: number, horiz: boolean) => {
    const n = Math.max(2, Math.floor(len / size));
    const step = len / n;
    for (const phase of [0, Math.PI]) {
      ctx.beginPath();
      for (let i = 0; i <= n * 8; i++) {
        const u = (i / (n * 8)) * len;
        const v = Math.sin((u / step) * Math.PI + phase) * size * 0.32;
        const px = horiz ? x0 + u : x0 + v;
        const py = horiz ? y0 + v : y0 + u;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();
    }
  };
  const m = size * 0.5;
  strand(x + m, y + m, w - 2 * m, true);
  strand(x + m, y + h - m, w - 2 * m, true);
  strand(x + m, y + m, h - 2 * m, false);
  strand(x + w - m, y + m, h - 2 * m, false);
  // Corner triquetra-ish knots.
  for (const [cx, cy] of [
    [x + m, y + m],
    [x + w - m, y + m],
    [x + m, y + h - m],
    [x + w - m, y + h - m],
  ]) {
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2;
      ctx.beginPath();
      ctx.arc(cx + Math.cos(a) * size * 0.35, cy + Math.sin(a) * size * 0.35, size * 0.45, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  ctx.restore();
}

/** Generic Norse nasal/spectacle iron helm (no cartoon white horns) — runner, neon, TVs. */
export function helmet(ctx: CanvasRenderingContext2D, cx: number, cy: number, s: number, fill: string = MEAD.iron, stroke: string = MEAD.pineInk) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(s / 100, s / 100);
  ctx.lineWidth = 5;
  ctx.strokeStyle = stroke;
  // Iron dome
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.arc(0, 6, 46, Math.PI, 0);
  ctx.lineTo(46, 20);
  ctx.lineTo(-46, 20);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // Brow / spectacle mask (Gjermundbu-inspired eye guard)
  ctx.fillStyle = "#6b7280";
  ctx.beginPath();
  ctx.moveTo(-40, 8);
  ctx.quadraticCurveTo(-28, 28, -14, 22);
  ctx.lineTo(-6, 14);
  ctx.lineTo(6, 14);
  ctx.lineTo(14, 22);
  ctx.quadraticCurveTo(28, 28, 40, 8);
  ctx.lineTo(40, 18);
  ctx.quadraticCurveTo(22, 36, 8, 28);
  ctx.lineTo(0, 20);
  ctx.lineTo(-8, 28);
  ctx.quadraticCurveTo(-22, 36, -40, 18);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // Nasal guard
  ctx.fillStyle = "#9ca3af";
  ctx.beginPath();
  ctx.moveTo(-6, 12);
  ctx.lineTo(6, 12);
  ctx.lineTo(5, 48);
  ctx.lineTo(0, 54);
  ctx.lineTo(-5, 48);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // Rim band + iron rivets (not ivory)
  ctx.fillStyle = "#4b5563";
  ctx.fillRect(-48, 16, 96, 10);
  ctx.strokeRect(-48, 16, 96, 10);
  ctx.fillStyle = "#d1d5db";
  for (const rx of [-36, -18, 18, 36]) {
    ctx.beginPath();
    ctx.arc(rx, 21, 2.5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function plate(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number, fill: string, stroke?: string, lw = 4) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.lineWidth = lw;
    ctx.strokeStyle = stroke;
    ctx.stroke();
  }
}

function fit(ctx: CanvasRenderingContext2D, text: string, max: number): string {
  if (ctx.measureText(text).width <= max) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > max) t = t.slice(0, -1);
  return `${t}…`;
}

/** The letter a screen shows: signal A–F when present; "—" when hall has no grade (no edge read). */
export const gradeText = (m: PredictionMarket): string => {
  if (m.hall) return m.hall.grade ?? "—";
  return m.setupGrade ?? "—";
};
/** Scanner-letter label (same pattern as Stand's `gradeLabel`): null → NO_GRADE_LABEL, never a letter. */
export const setupGradeLabel = (g: SetupGrade | null | undefined): string => g ?? NO_GRADE_LABEL;
export const gradeColor = (g: string): string =>
  g === "—" || g.toLowerCase().includes("no grade")
    ? "#94a3b8"
    : g.startsWith("A")
      ? "#86efac"
      : g === "B"
        ? MEAD.brass
        : g === "C"
          ? "#cbd5e1"
          : "#fca5a5";

export const marketName = (m: PredictionMarket) => `${m.outcome} · ${eventLabel(m)}`;

function srcBadge(ctx: CanvasRenderingContext2D, x: number, y: number, s: PredictionMarketFeedState | { status: string }) {
  const mock = s.status === "mock";
  const live = s.status === "live";
  ctx.font = `800 26px ${FONT}`;
  const label = mock ? "MOCK" : live ? "LIVE" : s.status.toUpperCase();
  const w = ctx.measureText(label).width + 44;
  plate(ctx, x - w, y, w, 38, 19, mock ? "#7c2d12" : "rgba(0,0,0,0.5)", mock ? "#fb923c" : live ? MEAD.yes : "#64748b", 3);
  ctx.fillStyle = mock ? "#fed7aa" : live ? "#86efac" : "#cbd5e1";
  ctx.beginPath();
  ctx.arc(x - w + 18, y + 19, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillText(label, x - w + 30, y + 29);
}

/* ── Jumbotron ─────────────────────────────────────────────────────────── */

export function drawJumbotron(c: HTMLCanvasElement, s: PredictionMarketFeedState, flash: { kind: "up" | "down" | null; k: number } = { kind: null, k: 0 }) {
  const ctx = c.getContext("2d")!;
  const W = JUMBO_W;
  const H = JUMBO_H;
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, MEAD.pineDeep);
  g.addColorStop(1, MEAD.pineInk);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  knotBorder(ctx, 6, 6, W - 12, H - 12, MEAD.brass, 22);
  const feat = s.markets.find((m) => m.id === s.featuredId) ?? null;
  ctx.fillStyle = MEAD.brass;
  ctx.font = `800 34px ${SLAB}`;
  ctx.fillText("LIVE ODDS", 60, 72);
  srcBadge(ctx, W - 50, 42, s);
  ctx.textAlign = "center";
  ctx.fillStyle = MEAD.white;
  ctx.font = `900 54px ${FONT}`;
  ctx.fillText(feat ? fit(ctx, feat.outcome, W - 520) : "THE HALL IS QUIET", W / 2, 112);
  if (feat) {
    ctx.font = `800 20px ${FONT}`;
    ctx.fillStyle = MEAD.brass;
    ctx.fillText(fit(ctx, `FEATURED · ${categoryLabel(feat)} · ${eventLabel(feat)}`, W - 300), W / 2, 138);
  }
  ctx.textAlign = "left";

  const box = (k: "yes" | "no", label: string, p: number | null, col: string, dark: string) => {
    const r = JUMBO_HITS[k];
    const glow = flash.kind && ((flash.kind === "up" && k === "yes") || (flash.kind === "down" && k === "no")) ? flash.k : 0;
    plate(ctx, r.x, r.y, r.w, r.h, 18, dark, col, 5 + glow * 6);
    if (glow > 0) {
      ctx.save();
      ctx.globalAlpha = glow * 0.35;
      plate(ctx, r.x, r.y, r.w, r.h, 18, col);
      ctx.restore();
    }
    ctx.textAlign = "center";
    ctx.fillStyle = col;
    ctx.font = `900 46px ${FONT}`;
    ctx.fillText(label, r.x + r.w / 2, r.y + 52);
    ctx.font = `900 66px ${FONT}`;
    ctx.fillText(price2(p), r.x + r.w / 2, r.y + 116);
    ctx.font = `700 18px ${FONT}`;
    ctx.fillStyle = "rgba(255,255,255,0.75)";
    ctx.fillText("TAP FOR PAPER TICKET", r.x + r.w / 2, r.y + r.h - 8);
    ctx.textAlign = "left";
  };
  box("yes", "YES", feat?.yesPrice ?? null, "#4ade80", "#06210f");
  box("no", "NO", feat?.noPrice ?? null, "#f87171", "#2a0707");

  // Featured footer: win chance, edge, grade.
  ctx.font = `700 24px ${FONT}`;
  ctx.fillStyle = "#cbd5e1";
  if (feat) {
    const line = feat.hall
      ? `${feat.hall.grade ? `Grade ${feat.hall.grade}   ·   ` : "No grade   ·   "}${feat.hall.line}`
      : `Win chance ${pct(feat.winChance)}   ·   ${edgeTag(feat.edge)}   ·   ${feat.setupGrade != null ? `Grade ${feat.setupGrade}` : "No grade"}   ·   ${feat.gates.word} ${feat.gates.passed}/${feat.gates.total}`;
    ctx.fillText(fit(ctx, line, W - 140), 70, 342);
  }

  // Other markets with probability bars.
  plate(ctx, 50, 360, W - 100, 310, 14, "rgba(255,255,255,0.04)", "rgba(196,163,90,0.35)", 2);
  ctx.fillStyle = MEAD.brass;
  ctx.font = `800 24px ${FONT}`;
  ctx.fillText("OTHER MARKETS", 70, 392);
  ctx.fillStyle = "#94a3b8";
  ctx.font = `600 18px ${FONT}`;
  ctx.textAlign = "right";
  ctx.fillText("YES · WIN CHANCE", W - 70, 392);
  ctx.textAlign = "left";
  const others = s.markets.filter((m) => m.id !== s.featuredId).slice(0, JUMBO_ROWS.n);
  others.forEach((m, i) => {
    const y = JUMBO_ROWS.y0 + 14 + i * JUMBO_ROWS.pitch;
    ctx.fillStyle = MEAD.white;
    ctx.font = `700 26px ${FONT}`;
    ctx.font = `800 16px ${FONT}`;
    ctx.fillStyle = "#a7c4b5";
    const tag = categoryLabel(m);
    ctx.fillText(tag, 70, y + 20);
    const tw = Math.max(64, ctx.measureText(tag).width + 14);
    ctx.font = `700 26px ${FONT}`;
    ctx.fillStyle = MEAD.white;
    ctx.fillText(fit(ctx, marketName(m), 520 - tw), 70 + tw, y + 22);
    ctx.font = `800 26px ${FONT}`;
    ctx.fillStyle = MEAD.brass;
    ctx.fillText(price2(m.yesPrice), 620, y + 22);
    const bx = 720;
    const bw = W - 70 - bx - 80;
    plate(ctx, bx, y + 4, bw, 22, 11, "rgba(255,255,255,0.12)");
    const p = m.winChance ?? m.yesPrice ?? 0;
    plate(ctx, bx, y + 4, Math.max(8, bw * p), 22, 11, p >= 0.5 ? "#22c55e" : p >= 0.3 ? MEAD.brass : "#ef4444");
    ctx.fillStyle = "#e2e8f0";
    ctx.font = `700 22px ${FONT}`;
    ctx.fillText(pct(m.winChance), bx + bw + 12, y + 23);
  });
  if (!others.length) {
    ctx.fillStyle = "#94a3b8";
    ctx.font = `600 24px ${FONT}`;
    ctx.fillText(s.note || "Waiting for the board…", 70, 450);
  }
  ctx.fillStyle = "#94a3b8";
  ctx.font = `600 18px ${FONT}`;
  ctx.textAlign = "center";
  ctx.fillText(`${(s.label ?? "PROBABILITIES").toUpperCase()} · ${s.fetchedAt ? new Date(s.fetchedAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit" }) : "—"} · PAPER ONLY`, W / 2, H - 28);
  ctx.textAlign = "left";
}

/** Which jumbotron hit a canvas px lands in (YES/NO box, or an "other markets" row index). */
export function jumboHit(px: number, py: number, s: PredictionMarketFeedState): { side: "YES" | "NO"; id: string } | null {
  const inR = (r: { x: number; y: number; w: number; h: number }) => px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h;
  if (s.featuredId && inR(JUMBO_HITS.yes)) return { side: "YES", id: s.featuredId };
  if (s.featuredId && inR(JUMBO_HITS.no)) return { side: "NO", id: s.featuredId };
  const others = s.markets.filter((m) => m.id !== s.featuredId).slice(0, JUMBO_ROWS.n);
  const i = Math.floor((py - JUMBO_ROWS.y0 - 14) / JUMBO_ROWS.pitch);
  if (px > 60 && px < JUMBO_W - 60 && i >= 0 && i < others.length) return { side: "YES", id: others[i].id };
  return null;
}

/* ── Rune Board (chalkboard) ────────────────────────────────────────────── */

export function drawRuneBoard(c: HTMLCanvasElement, s: PredictionMarketFeedState) {
  const ctx = c.getContext("2d")!;
  const W = c.width;
  const H = c.height;
  ctx.fillStyle = "#5b3a1e";
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = MEAD.board;
  ctx.fillRect(28, 28, W - 56, H - 56);
  // chalk dust
  ctx.globalAlpha = 0.06;
  for (let i = 0; i < 400; i++) {
    ctx.fillStyle = "#fff";
    ctx.fillRect((i * 97) % W, (i * 57) % H, 2 + (i % 5) * 6, 1);
  }
  ctx.globalAlpha = 1;
  knotBorder(ctx, 36, 36, W - 72, H - 72, MEAD.brassDim, 18);
  ctx.fillStyle = MEAD.chalk;
  ctx.textAlign = "center";
  ctx.font = `900 64px ${SLAB}`;
  ctx.fillText("RUNE BOARD", W / 2, 130);
  ctx.font = `700 30px ${FONT}`;
  ctx.fillStyle = MEAD.brass;
  ctx.fillText("TODAY'S TOP SETUPS", W / 2, 180);
  ctx.textAlign = "left";
  const byId = new Map(s.markets.map((m) => [m.id, m]));
  const top = s.topIds.map((id) => byId.get(id)).filter((m): m is PredictionMarket => !!m).slice(0, 6);
  top.forEach((m, i) => {
    const y = 250 + i * 104;
    // checkbox
    ctx.strokeStyle = MEAD.chalk;
    ctx.lineWidth = 4;
    ctx.strokeRect(80, y - 34, 40, 40);
    if (m.gates.word !== "STAND") {
      ctx.strokeStyle = m.gates.word === "GO" ? "#86efac" : MEAD.brass;
      ctx.beginPath();
      ctx.moveTo(86, y - 14);
      ctx.lineTo(98, y);
      ctx.lineTo(124, y - 40);
      ctx.stroke();
    }
    ctx.fillStyle = MEAD.chalk;
    ctx.font = `800 40px ${FONT}`;
    ctx.fillText(fit(ctx, `${m.outcome}  ${cents(m.yesPrice)}`, W - 330), 140, y);
    ctx.font = `600 24px ${FONT}`;
    ctx.fillStyle = "#b8c2b0";
    ctx.fillText(fit(ctx, `${categoryLabel(m)} · ${eventLabel(m)} · ${m.hall ? m.hall.sub : `win ${pct(m.winChance)} · ${edgeTag(m.edge)}`}`, W - 240), 140, y + 34);
    ctx.textAlign = "right";
    ctx.font = `900 44px ${SLAB}`;
    const g = gradeText(m);
    ctx.fillStyle = gradeColor(g);
    ctx.fillText(g, W - 80, y);
    ctx.textAlign = "left";
  });
  if (!top.length) {
    ctx.fillStyle = "#b8c2b0";
    ctx.font = `600 30px ${FONT}`;
    ctx.fillText("No setups chalked yet.", 80, 300);
  }
  ctx.fillStyle = MEAD.brass;
  ctx.font = `800 30px ${SLAB}`;
  ctx.textAlign = "center";
  ctx.fillText("HUNT VALUE. TRUST THE EDGE.", W / 2, H - 90);
  if (s.status === "mock") {
    ctx.fillStyle = "#fdba74";
    ctx.font = `800 22px ${FONT}`;
    ctx.fillText("MOCK ROWS — DEV ONLY", W / 2, H - 56);
  }
  ctx.textAlign = "left";
}

/* ── Over-bar TV (one market) ───────────────────────────────────────────── */

export function drawTv(c: HTMLCanvasElement, m: PredictionMarket | null, mock: boolean) {
  const ctx = c.getContext("2d")!;
  const W = c.width;
  const H = c.height;
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, MEAD.pineDeep);
  g.addColorStop(1, MEAD.pineInk);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = MEAD.brass;
  ctx.lineWidth = 6;
  ctx.strokeRect(6, 6, W - 12, H - 12);
  if (!m) {
    helmet(ctx, W / 2, H / 2, 120);
    return;
  }
  ctx.fillStyle = MEAD.white;
  ctx.textAlign = "center";
  ctx.font = `900 50px ${FONT}`;
  ctx.fillText(fit(ctx, `${m.outcome}`, W - 40), W / 2, 66);
  ctx.font = `600 24px ${FONT}`;
  ctx.fillStyle = "#a7c4b5";
  ctx.fillText(fit(ctx, `${categoryLabel(m)} · ${eventLabel(m)}`, W - 40), W / 2, 98);
  helmet(ctx, W / 2, 170, 70);
  ctx.fillStyle = "#e2e8f0";
  ctx.font = `800 26px ${FONT}`;
  ctx.fillText("WIN CHANCE", W / 2, 248);
  const bx = 40;
  const bw = W - 80;
  plate(ctx, bx, 262, bw, 40, 8, "rgba(255,255,255,0.12)");
  const p = m.winChance ?? 0;
  plate(ctx, bx, 262, Math.max(10, bw * p), 40, 8, "#16a34a");
  ctx.fillStyle = "#fff";
  ctx.font = `900 30px ${FONT}`;
  ctx.fillText(pct(m.winChance), W / 2, 293);
  // brass EDGE tag
  plate(ctx, W / 2 - 130, 318, 260, 64, 8, MEAD.brass, MEAD.pineInk, 4);
  ctx.fillStyle = MEAD.pineInk;
  ctx.font = `900 34px ${FONT}`;
  ctx.fillText(edgeTag(m.edge), W / 2, 362);
  if (mock) {
    ctx.fillStyle = "#fdba74";
    ctx.font = `800 18px ${FONT}`;
    ctx.fillText("MOCK", W - 50, 36);
  }
  ctx.textAlign = "left";
}

/* ── Booth screen: market watch ─────────────────────────────────────────── */

export function drawBooth(c: HTMLCanvasElement, s: PredictionMarketFeedState, offset = 0) {
  const ctx = c.getContext("2d")!;
  const W = c.width;
  const H = c.height;
  ctx.fillStyle = "#0b0f14";
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = "#475569";
  ctx.lineWidth = 6;
  ctx.strokeRect(4, 4, W - 8, H - 8);
  ctx.fillStyle = MEAD.white;
  ctx.font = `800 34px ${FONT}`;
  ctx.textAlign = "center";
  ctx.fillText("MARKET WATCH", W / 2, 48);
  ctx.textAlign = "left";
  const list = s.markets.length ? [...s.markets.slice(offset), ...s.markets.slice(0, offset)].slice(0, 4) : [];
  list.forEach((m, i) => {
    const y = 104 + i * 46;
    ctx.fillStyle = "#e2e8f0";
    ctx.font = `700 28px ${FONT}`;
    ctx.fillText(fit(ctx, `${m.outcome} · ${eventLabel(m)}`, W - 170), 26, y);
    ctx.textAlign = "right";
    ctx.fillStyle = MEAD.brass;
    ctx.fillText(price2(m.yesPrice), W - 26, y);
    ctx.textAlign = "left";
  });
  plate(ctx, 60, H - 70, W - 120, 50, 10, "#1e293b", "#64748b", 3);
  ctx.fillStyle = "#e2e8f0";
  ctx.font = `800 24px ${FONT}`;
  ctx.textAlign = "center";
  ctx.fillText(s.status === "mock" ? "PAPER TICKET · MOCK" : "PAPER TICKET", W / 2, H - 37);
  ctx.textAlign = "left";
}

/* ── Neon sign ──────────────────────────────────────────────────────────── */

export function drawNeon(c: HTMLCanvasElement, on = 1) {
  const ctx = c.getContext("2d")!;
  const W = c.width;
  const H = c.height;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = "rgba(10,16,12,0.92)";
  ctx.beginPath();
  ctx.roundRect(8, 8, W - 16, H - 16, 40);
  ctx.fill();
  const glow = (col: string, blur: number) => {
    ctx.shadowColor = col;
    ctx.shadowBlur = blur * on;
  };
  ctx.lineWidth = 10;
  glow(MEAD.brass, 40);
  ctx.strokeStyle = MEAD.brass;
  ctx.stroke();
  helmet(ctx, W / 2, 96, 80);
  ctx.textAlign = "center";
  glow(MEAD.brass, 32);
  ctx.fillStyle = on > 0.5 ? "#e0c888" : "#8a7340";
  ctx.font = `900 92px ${SLAB}`;
  ctx.fillText("THE MEAD HALL", W / 2, 270);
  glow("#a7c4b5", 26);
  ctx.fillStyle = "#d4e8dc";
  ctx.font = `800 48px ${FONT}`;
  ctx.fillText("— PREDICTIONS —", W / 2, 350);
  ctx.shadowBlur = 0;
  ctx.textAlign = "left";
}

/* ── Wall / floor textures ──────────────────────────────────────────────── */

/** The field runner: pine turf, white yard lines, brass edges, a nasal helm at midfield. */
export function drawRunner(c: HTMLCanvasElement) {
  const ctx = c.getContext("2d")!;
  const W = c.width;
  const H = c.height;
  ctx.fillStyle = MEAD.pine;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = MEAD.brass;
  ctx.fillRect(0, 0, 22, H);
  ctx.fillRect(W - 22, 0, 22, H);
  ctx.fillStyle = MEAD.white;
  ctx.fillRect(26, 0, 6, H);
  ctx.fillRect(W - 32, 0, 6, H);
  const lines = 12;
  for (let i = 1; i < lines; i++) {
    const y = (i / lines) * H;
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.fillRect(60, y - 3, W - 120, 6);
    for (let k = 1; k < 5; k++) {
      const yy = y + (k / 5) * (H / lines);
      ctx.fillRect(44, yy - 1.5, 20, 3);
      ctx.fillRect(W - 64, yy - 1.5, 20, 3);
    }
  }
  ctx.save();
  ctx.translate(W / 2, H / 2);
  ctx.rotate(Math.PI);
  helmet(ctx, 0, 0, 170);
  ctx.restore();
  ctx.fillStyle = MEAD.brass;
  ctx.font = `900 64px ${SLAB}`;
  ctx.textAlign = "center";
  ctx.fillText("MEAD", W / 2, H * 0.2);
  ctx.save();
  ctx.translate(W / 2, H * 0.8);
  ctx.rotate(Math.PI);
  ctx.fillText("MEAD", 0, 0);
  ctx.restore();
  ctx.textAlign = "left";
}

/** A brass knotwork panel on pine — booth backs, bar front, wall banners. */
export function drawKnotPanel(c: HTMLCanvasElement, base: string = MEAD.pine) {
  const ctx = c.getContext("2d")!;
  const W = c.width;
  const H = c.height;
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, W, H);
  knotBorder(ctx, 10, 10, W - 20, H - 20, MEAD.brass, Math.min(W, H) / 10);
  ctx.strokeStyle = MEAD.brass;
  ctx.lineWidth = Math.min(W, H) / 40;
  const r = Math.min(W, H) * 0.18;
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2 - Math.PI / 2;
    ctx.beginPath();
    ctx.arc(W / 2 + Math.cos(a) * r * 0.6, H / 2 + Math.sin(a) * r * 0.6, r, 0, Math.PI * 2);
    ctx.stroke();
  }
}

/** Speech bubble for crew / bartender reactions. */
export function drawBubble(c: HTMLCanvasElement, text: string, tone: "up" | "down" | "hail" | "idle") {
  const ctx = c.getContext("2d")!;
  ctx.clearRect(0, 0, c.width, c.height);
  if (!text) return;
  const bg = tone === "hail" ? MEAD.brass : tone === "up" ? "#dcfce7" : tone === "down" ? "#fee2e2" : "#f8fafc";
  ctx.fillStyle = bg;
  ctx.beginPath();
  ctx.roundRect(6, 6, c.width - 12, c.height - 40, 24);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(c.width / 2 - 18, c.height - 36);
  ctx.lineTo(c.width / 2 + 18, c.height - 36);
  ctx.lineTo(c.width / 2, c.height - 6);
  ctx.fill();
  ctx.fillStyle = tone === "hail" ? MEAD.pineInk : "#0f172a";
  ctx.font = `900 ${tone === "hail" ? 58 : 40}px ${FONT}`;
  ctx.textAlign = "center";
  ctx.fillText(fit(ctx, text, c.width - 40), c.width / 2, (c.height - 34) / 2 + 18);
  ctx.textAlign = "left";
}

/** Tap-handle shield label: YES / NO. */
export function drawTapShield(c: HTMLCanvasElement, label: "YES" | "NO") {
  const ctx = c.getContext("2d")!;
  const W = c.width;
  const H = c.height;
  ctx.clearRect(0, 0, W, H);
  const col = label === "YES" ? "#15803d" : "#b91c1c";
  ctx.beginPath();
  ctx.moveTo(10, 10);
  ctx.lineTo(W - 10, 10);
  ctx.lineTo(W - 10, H * 0.55);
  ctx.quadraticCurveTo(W - 10, H * 0.85, W / 2, H - 8);
  ctx.quadraticCurveTo(10, H * 0.85, 10, H * 0.55);
  ctx.closePath();
  ctx.fillStyle = col;
  ctx.fill();
  ctx.lineWidth = 10;
  ctx.strokeStyle = MEAD.brass;
  ctx.stroke();
  ctx.fillStyle = MEAD.white;
  ctx.font = `900 ${label === "YES" ? 74 : 86}px ${FONT}`;
  ctx.textAlign = "center";
  ctx.fillText(label, W / 2, H * 0.5);
  ctx.textAlign = "left";
}
