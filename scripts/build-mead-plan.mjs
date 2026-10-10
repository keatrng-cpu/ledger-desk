/**
 * Writes the Mead Hall into src/data/floor-layout.json from src/lib/room/mead-hall-layout.ts — the one place those numbers live.
 *
 *   npx tsx scripts/build-mead-plan.mjs            # rewrite the plan in place
 *   npx tsx scripts/build-mead-plan.mjs --check    # exit 1 if the plan is not what the layout would write
 *
 * It owns every entry whose id starts with `mead_` (plus the old stub's `tv_mead`, `plate_Mead`, `study_0`, `study_1`, the
 * `mead` camera) and replaces them whole. It also keeps three edits that the hall needs elsewhere in the plan:
 *   - `bounds.x[1]` reaches the hall's east wall; `shell` keeps the building's own edge for Blender's exterior test;
 *   - the lounge's east wall `ext_east` carries the doorway into the hall, and the three weather windows move aside for it;
 *   - the two window spots follow their windows.
 * The file is patched as text, line by line, so a diff shows only what changed (the plan is one entry per line).
 * Entries flagged `hall` are the hall's own: the three.js hall draws them, so the runtime's box fallback skips them, and
 * `procedural` keeps Blender from baking them.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  HALL_AT,
  HALL_BLOCKS,
  HALL_CAMERAS,
  HALL_DOOR_FLOOR,
  HALL_DOOR_H,
  HALL_ROOM,
  HALL_SCREENS,
  HALL_SPOTS,
  boxToFurniture,
  hallCameraToFloor,
  hallToFloor,
} from "../src/lib/room/mead-hall-layout.ts";

const here = dirname(fileURLToPath(import.meta.url));
const FILE = join(here, "../src/data/floor-layout.json");
const CHECK = process.argv.includes("--check");

const r3 = (n) => +Number(n).toFixed(3);
const arr = (a) => `[${a.map(r3).join(", ")}]`;

/** The hall's east wall is the plan's new eastern edge. */
const EAST = r3(HALL_ROOM.x1 + HALL_ROOM.wallT / 2 + HALL_AT.x + 0.0);
const BOUNDS_X1 = Math.ceil(EAST + 0.5);

const OWNED = (id) => id === "mead" || /^mead_/.test(id) || id === "tv_mead" || id === "plate_Mead" || id === "study_0" || id === "study_1";

// ── entries ───────────────────────────────────────────────────────────────────────────────────────────────────────────
const [ix0, iz0] = hallToFloor(HALL_ROOM.x0, HALL_ROOM.z0);
const [ix1, iz1] = hallToFloor(HALL_ROOM.x1, HALL_ROOM.z1);
const wallN = r3(iz0 - HALL_ROOM.wallT / 2);
const wallS = r3(iz1 + HALL_ROOM.wallT / 2);
const wallW = r3(ix0 - HALL_ROOM.wallT);
const flags = `"procedural": true, "hall": true`;

const rooms = [`    { "id": "mead_hall", "label": "The Mead Hall — prediction markets, studied", "x": ${arr([ix0, ix1])}, "z": ${arr([iz0, iz1])}, "floor": "walnut", ${flags} }`];

const walls = [
  `    { "id": "mead_north", "a": ${arr([wallW, wallN])}, "b": ${arr([EAST, wallN])}, "height": 7, "kind": "solid", "doors": [], ${flags} }`,
  `    { "id": "mead_east", "a": ${arr([EAST, wallN])}, "b": ${arr([EAST, wallS])}, "height": 7, "kind": "solid", "doors": [], ${flags} }`,
  `    { "id": "mead_south", "a": ${arr([wallW, wallS])}, "b": ${arr([EAST, wallS])}, "height": 1.1, "kind": "low", "doors": [], ${flags} }`,
];

const furniture = HALL_BLOCKS.map((b) => {
  const f = boxToFurniture(b.box);
  return `    { "id": "mead_blk_${b.id}", "kind": "hall_block", "pos": ${arr(f.pos)}, "rot": 0, "size": ${arr(f.size)}, "obstacle": true, ${flags} }`;
});

const screens = HALL_SCREENS.map((s) => {
  const [x, z] = hallToFloor(s.center[0], s.center[2]);
  return `    { "id": "${s.id}", "kind": "${s.kind}", "center": ${arr([x, s.center[1], z])}, "size": ${arr(s.size)}, "facing": ${r3(s.facing)}, "px": ${arr(s.px)}, ${flags} }`;
});

const spots = HALL_SPOTS.map((s) => {
  const [x, z] = hallToFloor(s.x, s.z);
  const [lx, lz] = hallToFloor(s.look[0], s.look[1]);
  return `    "${s.id}": { "pos": ${arr([x, z])}, "look": ${arr([lx, lz])}, "pose": "${s.pose}", "act": "${s.act}" }`;
});

const cameras = Object.entries(HALL_CAMERAS).map(([k, c]) => {
  const f = hallCameraToFloor(c);
  return `    "${k === "overview" ? "mead" : `mead_${k}`}": { "pos": ${arr(f.pos)}, "target": ${arr(f.target)} }`;
});

// ── patch ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** The plan text with the Mead Hall written into it (pure: text in, text out). */
export function buildMeadPlan(text) {
  // The checked-out plan may carry CRLF (core.autocrlf on Windows): split on either, write back with the same ending.
  const EOL = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.split(/\r?\n/);

  /** Replace the owned entries of one section (`"name": [` … `]` or `{` … `}`) and append `add`. */
  function patchSection(name, open, close, idOf, add) {
    const start = lines.findIndex((l) => l.startsWith(`  "${name}": ${open}`));
    if (start < 0) throw new Error(`section ${name} not found`);
    let end = start + 1;
    while (!lines[end].startsWith(`  ${close}`)) end++;
    const body = lines.slice(start + 1, end).map((l) => l.replace(/,\s*$/, ""));
    const kept = body.filter((l) => !OWNED(idOf(l) ?? ""));
    const merged = [...kept, ...add];
    // Blank lines separate groups in the plan and stay as they are; only the last entry goes without a comma.
    let last = merged.length - 1;
    while (last >= 0 && !merged[last].trim()) last--;
    const all = merged.map((l, i) => (l.trim() && i < last ? `${l},` : l));
    lines.splice(start + 1, end - start - 1, ...all);
  }
  const idArr = (l) => /"id":\s*"([^"]+)"/.exec(l)?.[1];
  const idObj = (l) => /^\s*"([^"]+)":\s*\{/.exec(l)?.[1];

  patchSection("rooms", "[", "]", idArr, rooms);
  patchSection("walls", "[", "]", idArr, walls);
  patchSection("furniture", "[", "]", idArr, furniture);
  patchSection("screens", "[", "]", idArr, screens);
  patchSection("spots", "{", "}", idObj, spots);
  patchSection("camera", "{", "}", idObj, cameras);

  // bounds + shell
  const bi = lines.findIndex((l) => l.startsWith('  "bounds":'));
  const old = /"x":\s*\[(-?[\d.]+),\s*(-?[\d.]+)\],\s*"z":\s*\[(-?[\d.]+),\s*(-?[\d.]+)\]/.exec(lines[bi]);
  if (!old) throw new Error("bounds line not understood");
  const shellX1 = lines.some((l) => l.startsWith('  "shell":')) ? null : Number(old[2]);
  lines[bi] = `  "bounds": { "x": [${old[1]}, ${BOUNDS_X1}], "z": [${old[3]}, ${old[4]}] },`;
  if (shellX1 != null) lines.splice(bi + 1, 0, `  "shell": { "x": [${old[1]}, ${shellX1}], "z": [${old[3]}, ${old[4]}] },`);

  // the lounge's east wall: the doorway into the hall
  const ei = lines.findIndex((l) => /"id":\s*"ext_east"/.test(l));
  lines[ei] = lines[ei].replace(/"doors":\s*\[(?:\[[^\]]*\],?\s*)*\](,\s*"doorH":\s*[\d.]+)?/, `"doors": [${arr(HALL_DOOR_FLOOR)}], "doorH": ${HALL_DOOR_H}`);

  // the weather windows step aside for it; their spots follow
  const WINDOW_Z = { window_0: -6.4, window_1: -1.8, window_2: 6.1 };
  for (const [id, z] of Object.entries(WINDOW_Z)) {
    const wi = lines.findIndex((l) => new RegExp(`"id":\\s*"${id}"`).test(l));
    if (wi < 0) throw new Error(`${id} not found`);
    lines[wi] = lines[wi].replace(/"center":\s*\[([-\d.]+),\s*([-\d.]+),\s*([-\d.]+)\]/, (_m, x, y) => `"center": [${x}, ${y}, ${z}]`);
  }
  for (const [id, z] of Object.entries({ window_0: -6.4, window_1: -1.8 })) {
    const si = lines.findIndex((l) => new RegExp(`^\\s*"${id}":\\s*\\{`).test(l));
    if (si < 0) continue;
    lines[si] = lines[si].replace(/"pos":\s*\[([-\d.]+),\s*([-\d.]+)\]/, (_m, x) => `"pos": [${x}, ${z}]`).replace(/"look":\s*\[([-\d.]+),\s*([-\d.]+)\]/, (_m, x) => `"look": [${x}, ${z}]`);
  }

  const out = lines.join(EOL);
  JSON.parse(out); // the plan must stay valid JSON
  return out;
}

export const MEAD_PLAN_COUNTS = { rooms: rooms.length, walls: walls.length, blocks: furniture.length, screens: screens.length, spots: spots.length, cameras: cameras.length, boundsX1: BOUNDS_X1 };

// Run as a script (not when a verifier imports it).
if (process.argv[1]?.endsWith("build-mead-plan.mjs")) {
  const text = readFileSync(FILE, "utf8");
  const out = buildMeadPlan(text);
  if (CHECK) {
    if (out !== text) {
      console.error("floor-layout.json is not what scripts/build-mead-plan.mjs would write — run it and commit the result");
      process.exit(1);
    }
    console.log("mead plan is current");
  } else {
    writeFileSync(FILE, out);
    const c = MEAD_PLAN_COUNTS;
    console.log(`wrote ${FILE}: ${c.rooms} room, ${c.walls} walls, ${c.blocks} nav blocks, ${c.screens} screens, ${c.spots} spots, ${c.cameras} cameras; bounds x[1] ${c.boundsX1}`);
  }
}
