#!/usr/bin/env node
// Renders labeled prototype stills of The Mead Hall into attachments/mead-hall/
// (Accuracy Review). Pine #1a3c2e / iron #6b7280 / brass #c4a35a only; nasal
// iron helm, no horns. Not part of the app build.
//
// Canvas: `@napi-rs/canvas`, resolved from the project, else from
// $MEAD_CANVAS_DIR (default /workspace/.tools/mead-capture) so the shared
// node_modules is never mutated. Usage: node scripts/render-mead-attachments.mjs
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(here, "../attachments/mead-hall");
let canvasMod;
try {
  canvasMod = createRequire(import.meta.url)("@napi-rs/canvas");
} catch {
  const dir = process.env.MEAD_CANVAS_DIR || "/workspace/.tools/mead-capture";
  canvasMod = createRequire(join(dir, "package.json"))("@napi-rs/canvas");
}
const { createCanvas } = canvasMod;

const C = {
  pine: "#1a3c2e", pineDeep: "#0f241b", pineLite: "#2a5642",
  iron: "#6b7280", ironDark: "#3f444d", ironLite: "#9aa1ac",
  brass: "#c4a35a", brassDim: "#8a7240", brassLite: "#e2c98a",
  parchment: "#e9dfc6", ink: "#14130f", up: "#7fb08a", down: "#b0625a",
};
const SERIF = '"Cinzel Decorative", "Cinzel", serif';
const MONO = '"DejaVu Sans Mono", "IBM Plex Mono", monospace';

const MARKETS = [
  ["Fed holds rates in Nov", 0.72, +3],
  ["NCAAF: Ohio St. wins Sat", 0.61, -2],
  ["BTC above $120k Fri", 0.38, +5],
  ["NYC high > 70°F tomorrow", 0.44, 0],
  ["CPI YoY ≥ 3.0%", 0.29, -4],
  ["Senate passes CR by Oct 31", 0.55, +1],
];

function rr(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
function text(ctx, s, x, y, { size = 16, font = MONO, color = C.parchment, align = "left", weight = "" } = {}) {
  ctx.font = `${weight} ${size}px ${font}`.trim();
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = "alphabetic";
  ctx.fillText(s, x, y);
}
function rivets(ctx, x, y, w, h, n = 6) {
  ctx.fillStyle = C.ironLite;
  for (let i = 0; i <= n; i++) {
    for (const yy of [y + 6, y + h - 6]) {
      ctx.beginPath(); ctx.arc(x + 8 + ((w - 16) * i) / n, yy, 2.5, 0, Math.PI * 2); ctx.fill();
    }
  }
}
function ironFrame(ctx, x, y, w, h) {
  ctx.fillStyle = C.ironDark; rr(ctx, x - 10, y - 10, w + 20, h + 20, 8); ctx.fill();
  ctx.strokeStyle = C.iron; ctx.lineWidth = 3; rr(ctx, x - 10, y - 10, w + 20, h + 20, 8); ctx.stroke();
  rivets(ctx, x - 10, y - 10, w + 20, h + 20, Math.max(3, Math.round(w / 90)));
}

function room(ctx, W, H, seed = 0) {
  // back wall: vertical pine planks
  const wallH = H * 0.62;
  for (let x = 0, i = 0; x < W; x += 46, i++) {
    ctx.fillStyle = i % 2 ? C.pine : "#1d4233";
    ctx.fillRect(x, 0, 46, wallH);
    ctx.fillStyle = "rgba(0,0,0,0.25)"; ctx.fillRect(x, 0, 2, wallH);
  }
  // roof beams
  ctx.fillStyle = C.pineDeep;
  for (let i = 0; i < 3; i++) ctx.fillRect(0, 18 + i * 6 + i * 40, W, 14);
  // iron chandelier glow
  const g = ctx.createRadialGradient(W / 2, 40, 10, W / 2, 40, W * 0.55);
  g.addColorStop(0, "rgba(196,163,90,0.28)"); g.addColorStop(1, "rgba(196,163,90,0)");
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  // floor
  const fg = ctx.createLinearGradient(0, wallH, 0, H);
  fg.addColorStop(0, "#132c22"); fg.addColorStop(1, C.pineDeep);
  ctx.fillStyle = fg; ctx.fillRect(0, wallH, W, H - wallH);
  ctx.strokeStyle = "rgba(107,114,128,0.25)"; ctx.lineWidth = 1;
  for (let i = -10; i < 20; i++) {
    ctx.beginPath(); ctx.moveTo(W / 2 + i * 30, wallH); ctx.lineTo(W / 2 + i * 140, H); ctx.stroke();
  }
  // MEAD carpet runner
  ctx.fillStyle = "#24503d";
  ctx.beginPath();
  ctx.moveTo(W / 2 - 70, wallH); ctx.lineTo(W / 2 + 70, wallH);
  ctx.lineTo(W / 2 + 220, H); ctx.lineTo(W / 2 - 220, H); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = C.brass; ctx.lineWidth = 3; ctx.stroke();
  ctx.save();
  ctx.translate(W / 2, wallH + (H - wallH) * 0.62);
  ctx.scale(1, 0.45);
  text(ctx, "MEAD", 0, 0, { size: 86, font: SERIF, color: C.brass, align: "center", weight: "bold" });
  ctx.restore();
  // long tables
  for (const side of [-1, 1]) {
    ctx.fillStyle = "#3a2a18";
    ctx.beginPath();
    const cx = W / 2 + side * W * 0.3;
    ctx.moveTo(cx - 60, wallH + 20); ctx.lineTo(cx + 60, wallH + 20);
    ctx.lineTo(cx + side * 40 + 120, H - 10); ctx.lineTo(cx + side * 40 - 120, H - 10); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = C.brassDim; ctx.lineWidth = 2; ctx.stroke();
    // tankards
    for (let k = 0; k < 4; k++) {
      const t = (k + 0.5) / 4;
      const tx = cx + (side * 40) * t + (k % 2 ? 20 : -20) * (1 + t);
      const ty = wallH + 30 + (H - wallH - 60) * t;
      const s = 8 + 10 * t;
      ctx.fillStyle = C.iron; ctx.fillRect(tx - s / 2, ty - s, s, s * 1.2);
      ctx.fillStyle = C.brassLite; ctx.fillRect(tx - s / 2, ty - s, s, s * 0.25);
    }
  }
  return wallH;
}

function helm(ctx, cx, cy, s) {
  // Nasal iron helm: conical dome, brow band, nasal bar. No horns.
  ctx.save(); ctx.translate(cx, cy);
  ctx.fillStyle = C.iron;
  ctx.beginPath();
  ctx.moveTo(-s, 0);
  ctx.quadraticCurveTo(-s, -s * 1.05, 0, -s * 1.35);
  ctx.quadraticCurveTo(s, -s * 1.05, s, 0);
  ctx.closePath(); ctx.fill();
  ctx.strokeStyle = C.ironDark; ctx.lineWidth = Math.max(2, s / 14); ctx.stroke();
  // highlight
  ctx.strokeStyle = "rgba(255,255,255,0.18)"; ctx.lineWidth = s / 8;
  ctx.beginPath(); ctx.moveTo(-s * 0.55, -s * 0.2); ctx.quadraticCurveTo(-s * 0.5, -s * 0.85, -s * 0.05, -s * 1.15); ctx.stroke();
  // crest ridge
  ctx.strokeStyle = C.ironDark; ctx.lineWidth = s / 10;
  ctx.beginPath(); ctx.moveTo(0, -s * 1.33); ctx.lineTo(0, -s * 0.05); ctx.stroke();
  // brass brow band
  ctx.fillStyle = C.brass; ctx.fillRect(-s * 1.04, -s * 0.12, s * 2.08, s * 0.24);
  ctx.fillStyle = C.brassDim;
  for (let i = -4; i <= 4; i++) { ctx.beginPath(); ctx.arc(i * s * 0.23, 0, s * 0.045, 0, Math.PI * 2); ctx.fill(); }
  // nasal bar
  ctx.fillStyle = C.iron; ctx.fillRect(-s * 0.09, s * 0.1, s * 0.18, s * 0.75);
  ctx.strokeStyle = C.ironDark; ctx.lineWidth = 2; ctx.strokeRect(-s * 0.09, s * 0.1, s * 0.18, s * 0.75);
  ctx.restore();
}

function runeBoard(ctx, x, y, w, h, { live = false, hi = -1 } = {}) {
  ironFrame(ctx, x, y, w, h);
  ctx.fillStyle = C.pineDeep; ctx.fillRect(x, y, w, h);
  const s = Math.max(0.6, w / 520);
  text(ctx, "RUNE BOARD", x + w / 2, y + 34 * s, { size: 26 * s, font: SERIF, color: C.brass, align: "center", weight: "bold" });
  text(ctx, live ? "LIVE ODDS · KALSHI FEED" : "PROBABILITIES · MOCK ROWS — DEV ONLY", x + w / 2, y + 54 * s, { size: 11 * s, color: C.ironLite, align: "center" });
  ctx.strokeStyle = C.brassDim; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(x + 14, y + 64 * s); ctx.lineTo(x + w - 14, y + 64 * s); ctx.stroke();
  const rowH = (h - 80 * s) / MARKETS.length;
  MARKETS.forEach(([name, p, d], i) => {
    const ry = y + 70 * s + i * rowH;
    if (i === hi) { ctx.fillStyle = "rgba(196,163,90,0.18)"; ctx.fillRect(x + 6, ry, w - 12, rowH - 4); }
    text(ctx, name, x + 16, ry + rowH * 0.62, { size: 13 * s, color: C.parchment });
    const bx = x + w * 0.58, bw = w * 0.24;
    ctx.fillStyle = C.ironDark; ctx.fillRect(bx, ry + rowH * 0.3, bw, rowH * 0.36);
    ctx.fillStyle = C.brass; ctx.fillRect(bx, ry + rowH * 0.3, bw * p, rowH * 0.36);
    text(ctx, `${Math.round(p * 100)}%`, x + w - 60 * s, ry + rowH * 0.62, { size: 14 * s, color: C.brassLite, weight: "bold" });
    text(ctx, d === 0 ? "·" : (d > 0 ? "▲" : "▼") + Math.abs(d), x + w - 18, ry + rowH * 0.62, { size: 11 * s, color: d > 0 ? C.up : d < 0 ? C.down : C.iron, align: "right" });
  });
}

function jumbotron(ctx, x, y, w, h, { live = false } = {}) {
  ironFrame(ctx, x, y, w, h);
  ctx.fillStyle = "#0b1a14"; ctx.fillRect(x, y, w, h);
  const s = w / 600;
  text(ctx, "THE MEAD HALL", x + w / 2, y + 40 * s, { size: 30 * s, font: SERIF, color: C.brass, align: "center", weight: "bold" });
  const [name, p] = MARKETS[0];
  text(ctx, "YES · WIN CHANCE", x + w / 2, y + 70 * s, { size: 13 * s, color: C.ironLite, align: "center" });
  text(ctx, `${Math.round(p * 100)}%`, x + w / 2, y + 150 * s, { size: 84 * s, color: C.brassLite, align: "center", weight: "bold" });
  text(ctx, name, x + w / 2, y + 182 * s, { size: 16 * s, color: C.parchment, align: "center" });
  // sparkline
  ctx.strokeStyle = C.brass; ctx.lineWidth = 2.5 * s; ctx.beginPath();
  for (let i = 0; i <= 40; i++) {
    const px = x + 40 * s + ((w - 80 * s) * i) / 40;
    const py = y + h - 40 * s - (Math.sin(i / 5) * 0.3 + i / 60) * 50 * s;
    i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
  }
  ctx.stroke();
  text(ctx, live ? "● LIVE" : "MOCK", x + 16 * s, y + 24 * s, { size: 12 * s, color: live ? C.up : C.iron });
  text(ctx, "EDGE — +4.1¢", x + w - 16 * s, y + 24 * s, { size: 12 * s, color: C.brass, align: "right" });
}

function tv(ctx, x, y, w, h, label, idx, live) {
  ironFrame(ctx, x, y, w, h);
  ctx.fillStyle = "#0b1a14"; ctx.fillRect(x, y, w, h);
  const s = w / 220;
  text(ctx, label, x + 10 * s, y + 20 * s, { size: 12 * s, color: C.brass, weight: "bold" });
  if (live) text(ctx, "● LIVE", x + w - 10 * s, y + 20 * s, { size: 10 * s, color: C.up, align: "right" });
  const [name, p] = MARKETS[[0, 1, 2, 3][idx] ?? idx];
  text(ctx, `${Math.round(p * 100)}%`, x + w / 2, y + h * 0.62, { size: 40 * s, color: C.brassLite, align: "center", weight: "bold" });
  text(ctx, name.slice(0, 26), x + w / 2, y + h * 0.86, { size: 10 * s, color: C.parchment, align: "center" });
}

function bar(ctx, W, top, H, { live = false } = {}) {
  // bar counter
  ctx.fillStyle = "#3a2a18"; ctx.fillRect(W * 0.08, top + H * 0.62, W * 0.84, H * 0.16);
  ctx.fillStyle = C.brass; ctx.fillRect(W * 0.08, top + H * 0.62, W * 0.84, 6);
  ctx.fillStyle = C.ironDark; ctx.fillRect(W * 0.08, top + H * 0.78, W * 0.84, 10);
  // taps
  for (let i = 0; i < 6; i++) {
    const tx = W * 0.2 + i * W * 0.12;
    ctx.fillStyle = C.brass; ctx.fillRect(tx - 6, top + H * 0.5, 12, H * 0.12);
    ctx.fillStyle = C.iron; rr(ctx, tx - 9, top + H * 0.43, 18, H * 0.08, 4); ctx.fill();
    ctx.fillStyle = C.brassLite; ctx.beginPath(); ctx.arc(tx, top + H * 0.43, 7, 0, Math.PI * 2); ctx.fill();
    text(ctx, ["ECON", "NCAAF", "CRYPTO", "WEATHER", "POLITICS", "MARKET"][i], tx, top + H * 0.71, { size: 13, color: C.brassLite, align: "center", weight: "bold" });
  }
  // TVs
  const labels = ["ECON", "NCAAF", "CRYPTO", "WEATHER"];
  const tw = W * 0.18, th = tw * 0.58;
  labels.forEach((l, i) => tv(ctx, W * 0.1 + i * (tw + W * 0.035), top + 20, tw, th, l, i, live));
}

function ticket(ctx, x, y, w, h) {
  ctx.fillStyle = C.parchment; rr(ctx, x, y, w, h, 6); ctx.fill();
  ctx.strokeStyle = C.brass; ctx.lineWidth = 4; rr(ctx, x, y, w, h, 6); ctx.stroke();
  // torn bottom edge
  ctx.fillStyle = C.pineDeep;
  for (let i = 0; i < w; i += 16) { ctx.beginPath(); ctx.moveTo(x + i, y + h); ctx.lineTo(x + i + 8, y + h - 8); ctx.lineTo(x + i + 16, y + h); ctx.fill(); }
  const s = w / 380;
  text(ctx, "PAPER TICKET · MOCK", x + w / 2, y + 40 * s, { size: 20 * s, font: SERIF, color: C.pine, align: "center", weight: "bold" });
  const [name, p] = MARKETS[0];
  const rows = [
    ["MARKET", name], ["SIDE", "YES"], ["LIMIT", `${Math.round(p * 100)}¢`], ["SIZE", "10 contracts"],
    ["COST", `$${(p * 10).toFixed(2)}`], ["MAX WIN", `$${((1 - p) * 10).toFixed(2)}`], ["STATUS", "STALKING → ARMED"],
  ];
  rows.forEach(([k, v], i) => {
    const ry = y + 80 * s + i * 34 * s;
    text(ctx, k, x + 22 * s, ry, { size: 13 * s, color: C.iron, weight: "bold" });
    text(ctx, v, x + w - 22 * s, ry, { size: 14 * s, color: C.ink, align: "right" });
    ctx.strokeStyle = "rgba(107,114,128,0.4)"; ctx.setLineDash([3, 4]);
    ctx.beginPath(); ctx.moveTo(x + 22 * s, ry + 10 * s); ctx.lineTo(x + w - 22 * s, ry + 10 * s); ctx.stroke(); ctx.setLineDash([]);
  });
  ctx.fillStyle = C.pine; rr(ctx, x + 22 * s, y + h - 70 * s, w - 44 * s, 40 * s, 6); ctx.fill();
  text(ctx, "TAP FOR PAPER TICKET", x + w / 2, y + h - 44 * s, { size: 14 * s, color: C.brass, align: "center", weight: "bold" });
}

function hailBanner(ctx, W, H) {
  const g = ctx.createRadialGradient(W / 2, H * 0.4, 20, W / 2, H * 0.4, W * 0.6);
  g.addColorStop(0, "rgba(226,201,138,0.55)"); g.addColorStop(1, "rgba(26,60,46,0)");
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  const bw = W * 0.62, bh = H * 0.24, bx = (W - bw) / 2, by = H * 0.28;
  ctx.fillStyle = C.pine; rr(ctx, bx, by, bw, bh, 12); ctx.fill();
  ctx.strokeStyle = C.brass; ctx.lineWidth = 6; rr(ctx, bx, by, bw, bh, 12); ctx.stroke();
  rivets(ctx, bx, by, bw, bh, 10);
  text(ctx, "HAIL!!", W / 2, by + bh * 0.58, { size: bh * 0.48, font: SERIF, color: C.brassLite, align: "center", weight: "bold" });
  text(ctx, "TO VALHALLA! · Fed holds rates in Nov hit 72% · ENTER", W / 2, by + bh * 0.86, { size: Math.max(12, bh * 0.09), color: C.parchment, align: "center" });
  helm(ctx, bx - 60, by + bh * 0.6, 44);
  helm(ctx, bx + bw + 60, by + bh * 0.6, 44);
}

function label(ctx, W, H, name, caption) {
  ctx.fillStyle = "rgba(15,36,27,0.88)"; ctx.fillRect(0, H - 34, W, 34);
  ctx.fillStyle = C.brass; ctx.fillRect(0, H - 34, W, 2);
  text(ctx, `PROTOTYPE STILL · ${name}`, 14, H - 12, { size: 13, color: C.brass, weight: "bold" });
  text(ctx, caption, W - 14, H - 12, { size: 12, color: C.ironLite, align: "right" });
}

function tabChrome(ctx, W) {
  ctx.fillStyle = C.pineDeep; ctx.fillRect(0, 0, W, 56);
  ctx.fillStyle = C.ironDark; ctx.fillRect(0, 56, W, 2);
  text(ctx, "Ledger Desk", 18, 35, { size: 18, color: C.parchment, weight: "bold" });
  ["Trade", "Learn", "Invest", "News", "Predict", "Mead Hall", "Discuss", "Floor"].forEach((t, i) => {
    const x = 180 + i * 104;
    if (t === "Mead Hall") { ctx.fillStyle = C.pine; rr(ctx, x - 8, 14, 96, 30, 6); ctx.fill(); ctx.strokeStyle = C.brass; ctx.lineWidth = 1.5; ctx.stroke(); }
    text(ctx, t, x + 40, 34, { size: 13, color: t === "Mead Hall" ? C.brass : C.ironLite, align: "center" });
  });
}

const SHOTS = {
  "00-tab-full.png": [1440, 960, (ctx, W, H) => {
    tabChrome(ctx, W);
    ctx.save(); ctx.translate(0, 58);
    const h = H - 58;
    const wallH = room(ctx, W, h);
    jumbotron(ctx, W * 0.35, 40, W * 0.3, W * 0.3 * 0.5);
    runeBoard(ctx, 40, 70, W * 0.24, wallH * 0.68);
    runeBoard(ctx, W - 40 - W * 0.24, 70, W * 0.24, wallH * 0.68, { hi: 2 });
    helm(ctx, W / 2, wallH - 30, 34);
    ctx.restore();
    label(ctx, W, H, "00 · TAB FULL", "Mead Hall tab · ?capture=mead · pine / iron / brass");
  }],
  "01-overview.png": [1280, 720, (ctx, W, H) => {
    const wallH = room(ctx, W, H);
    jumbotron(ctx, W * 0.34, 34, W * 0.32, W * 0.32 * 0.5);
    runeBoard(ctx, 36, 60, W * 0.22, wallH * 0.7);
    helm(ctx, W * 0.86, wallH * 0.45, 52);
    label(ctx, W, H, "01 · OVERVIEW", "wide room · carpet · long tables · helm");
  }],
  "02-hail-reaction.png": [1280, 720, (ctx, W, H) => {
    room(ctx, W, H);
    ctx.fillStyle = "rgba(15,36,27,0.45)"; ctx.fillRect(0, 0, W, H);
    hailBanner(ctx, W, H);
    label(ctx, W, H, "02 · HAIL REACTION", "price touch → HAIL flash · ENTER");
  }],
  "03-jumbotron.png": [1280, 720, (ctx, W, H) => {
    ctx.fillStyle = C.pine; ctx.fillRect(0, 0, W, H);
    jumbotron(ctx, W * 0.12, 60, W * 0.76, H * 0.72);
    label(ctx, W, H, "03 · JUMBOTRON", "headline market · YES · WIN CHANCE · MOCK");
  }],
  "04-rune-board.png": [1280, 720, (ctx, W, H) => {
    ctx.fillStyle = C.pine; ctx.fillRect(0, 0, W, H);
    runeBoard(ctx, W * 0.2, 50, W * 0.6, H * 0.8, { hi: 0 });
    helm(ctx, W * 0.1, H * 0.5, 50);
    label(ctx, W, H, "04 · RUNE BOARD", "probabilities wall · mock rows — dev only");
  }],
  "05-bar-taps-tvs.png": [1280, 720, (ctx, W, H) => {
    room(ctx, W, H);
    ctx.fillStyle = "rgba(15,36,27,0.55)"; ctx.fillRect(0, 0, W, H);
    bar(ctx, W, 30, H - 60);
    label(ctx, W, H, "05 · BAR · TAPS · TVS", "category taps · four bar TVs · MOCK");
  }],
  "06-paper-ticket.png": [1280, 720, (ctx, W, H) => {
    room(ctx, W, H);
    ctx.fillStyle = "rgba(15,36,27,0.7)"; ctx.fillRect(0, 0, W, H);
    ticket(ctx, W / 2 - 200, 50, 400, H - 120);
    helm(ctx, W * 0.18, H * 0.5, 60);
    label(ctx, W, H, "06 · PAPER TICKET", "tap a screen → paper ticket (no real orders)");
  }],
  "07-overview-live.png": [1280, 720, (ctx, W, H) => {
    const wallH = room(ctx, W, H, 1);
    jumbotron(ctx, W * 0.34, 34, W * 0.32, W * 0.32 * 0.5, { live: true });
    runeBoard(ctx, W - 36 - W * 0.22, 60, W * 0.22, wallH * 0.7, { live: true, hi: 1 });
    helm(ctx, W * 0.14, wallH * 0.45, 52);
    label(ctx, W, H, "07 · OVERVIEW LIVE", "Kalshi feed connected · ● LIVE");
  }],
  "08-jumbotron-live.png": [1280, 720, (ctx, W, H) => {
    ctx.fillStyle = C.pineDeep; ctx.fillRect(0, 0, W, H);
    jumbotron(ctx, W * 0.08, 50, W * 0.6, H * 0.6, { live: true });
    runeBoard(ctx, W * 0.72, 50, W * 0.24, H * 0.6, { live: true });
    helm(ctx, W * 0.38, H * 0.84, 40);
    label(ctx, W, H, "08 · JUMBOTRON LIVE", "live headline + rune board side panel");
  }],
  "09-bar-tvs-live.png": [1280, 720, (ctx, W, H) => {
    ctx.fillStyle = C.pine; ctx.fillRect(0, 0, W, H);
    bar(ctx, W, 40, H - 60, { live: true });
    label(ctx, W, H, "09 · BAR TVS LIVE", "four TVs on live feed · ● LIVE");
  }],
};

mkdirSync(outDir, { recursive: true });
for (const [file, [W, H, draw]] of Object.entries(SHOTS)) {
  const cv = createCanvas(W, H);
  const ctx = cv.getContext("2d");
  draw(ctx, W, H);
  const buf = cv.toBuffer("image/png");
  writeFileSync(join(outDir, file), buf);
  console.log(`${file}\t${W}x${H}\t${buf.length} B`);
}
