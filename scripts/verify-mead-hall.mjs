/**
 * The Mead Hall against its contract (presentation only — it never touches the desk):
 *
 *   npx tsx scripts/verify-mead-hall.mjs
 *
 *   one hall        the Predict tab's 3D view and the Floor's wing are built by the SAME builder (mead-hall-build.ts), so they cannot drift
 *   the plan        floor-layout.json is exactly what scripts/build-mead-plan.mjs writes from src/lib/room/mead-hall-layout.ts; the wing sits
 *                   inside the plan's bounds, joined to the lounge by one doorway the NavGrid can walk through, and nothing in the GLB is the hall
 *   the people      every spot is inside the hall, on free floor, reachable from the lounge, clear of the hall's own regulars, one act each
 *   the screens     every screen the plan names has a mesh of that name in the builder; every Go-to chip names a plan screen; every camera exists
 *   the guards      no team or league marks, no order path, no Math.random (the hall replays the same), the paper-only wording stays
 */
import { readFileSync, existsSync } from "node:fs";

const ROOT = new URL("../", import.meta.url);
const read = (p) => readFileSync(new URL(p, ROOT), "utf8");
let pass = 0;
let fail = 0;
const check = (name, ok, detail = "") => {
  if (ok) pass++;
  else fail++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : ` — ${detail}`}`);
};

const L = await import("../src/lib/room/mead-hall-layout.ts");
const { buildMeadPlan } = await import("./build-mead-plan.mjs");
const planText = read("src/data/floor-layout.json");
const plan = JSON.parse(planText);
const FS = await import("../src/components/room/floor-scene.ts");

const src = {
  build: read("src/components/mead/mead-hall-build.ts"),
  extras: read("src/components/mead/mead-hall-extras.ts"),
  kit: read("src/components/mead/mead-hall-kit.ts"),
  people: read("src/components/mead/mead-people.ts"),
  scene: read("src/components/mead/mead-scene.ts"),
  screens: read("src/components/mead/mead-screens.ts"),
  record: read("src/components/mead/mead-record.ts"),
  floorMead: read("src/components/room/floor-mead.ts"),
  floorScene: read("src/components/room/floor-scene.ts"),
  tab: read("src/components/room/trading-floor-tab.tsx"),
  feed: read("src/components/room/use-mead-feed.ts"),
  layout: read("src/lib/room/mead-hall-layout.ts"),
  link: read("src/components/room/floor-link.ts"),
  analyzer: read("src/components/predict/pm-analyzer.tsx"),
};

console.log("one hall");
check("the Predict tab's scene builds the hall with MeadHall and carries none of the building code itself", /new MeadHall\(/.test(src.scene) && !/private build(Room|Bar|Booths|PoolTable|Screens|Crowd)\b/.test(src.scene));
check("the Floor's wing builds the hall with the same MeadHall", /new MeadHall\(/.test(src.floorMead) && /from "@\/components\/mead\/mead-hall-build"/.test(src.floorMead));
check("the two homes differ only by an option (home: standalone | floor)", /home: "standalone"/.test(src.scene) && /home: "floor"/.test(src.floorMead));
check("the hall keeps its own lights on its own layer, drawn in a pass of its own", /setLayer\(this\.root, this\.layer\)/.test(src.build) && /camera\.layers\.set\(HALL_LAYER\)/.test(src.floorMead) && /layers\.enable\(HALL_LAYER\)/.test(src.floorScene));
check("the Floor draws the hall first, then the office over it with the hall's depth", /private renderFrame\(\)/.test(src.floorScene) && /this\.mead\.pass\(r, this\.scene, this\.camera\)/.test(src.floorScene));
check("the standalone hall keeps the original six nav blocks exactly", /\[1\.6, -7, 9, -2\.55\], \/\/ bar \+ behind the bar/.test(src.scene) && /\[-7\.2, 3\.3, -3\.8, 5\.3\], \/\/ pool table/.test(src.scene));

console.log("the plan");
check("floor-layout.json is exactly what build-mead-plan.mjs writes (run it after a layout change)", buildMeadPlan(planText) === planText);
const hallRooms = plan.rooms.filter((r) => /^mead_/.test(r.id));
check("one hall room, flagged procedural and hall (Blender skips it, the box fallback skips it)", hallRooms.length === 1 && hallRooms.every((r) => r.procedural && r.hall));
const hallPlan = [
  ...plan.rooms.filter((x) => /^mead_/.test(x.id)),
  ...plan.walls.filter((x) => /^mead_/.test(x.id)),
  ...plan.furniture.filter((x) => /^mead_/.test(x.id)),
  ...plan.screens.filter((x) => /^mead_/.test(x.id)),
];
check("every hall entry in the plan is procedural AND hall", hallPlan.length > 0 && hallPlan.every((x) => x.procedural === true && x.hall === true), hallPlan.filter((x) => !(x.procedural && x.hall)).map((x) => x.id).join());
check("the old stub is gone (tv_mead, plate_Mead, study_*, mead_0..2)", !plan.screens.some((s) => s.id === "tv_mead" || s.id === "plate_Mead") && !("study_0" in plan.spots) && !("mead_0" in plan.spots));
const [hx0, hz0] = L.hallToFloor(L.HALL_ROOM.x0, L.HALL_ROOM.z0);
const [hx1, hz1] = L.hallToFloor(L.HALL_ROOM.x1, L.HALL_ROOM.z1);
check("the hall's interior is inside the plan's bounds (its walls sit on the edge)", hx1 <= plan.bounds.x[1] && hz1 <= plan.bounds.z[1] && hx0 >= plan.bounds.x[0] && hz0 >= plan.bounds.z[0], `${hx1},${hz1} vs ${JSON.stringify(plan.bounds)}`);
check("the building's own edge (shell) is unchanged, so Blender's exterior test and base slab are", plan.shell && plan.shell.x[1] === 14 && plan.shell.z[0] === -10 && plan.shell.z[1] === 17.4);
const east = plan.walls.find((w) => w.id === "ext_east");
check("the lounge's east wall carries the doorway the hall's west wall carries, and a doorway height", east && east.doors.length === 1 && east.doors[0][0] === L.HALL_DOOR_FLOOR[0] && east.doors[0][1] === L.HALL_DOOR_FLOOR[1] && east.doorH === L.HALL_DOOR_H, JSON.stringify(east));
check("the hall's west wall meets the lounge's east wall (outer face 14.06)", Math.abs(L.hallToFloor(L.HALL_ROOM.x0 - L.HALL_ROOM.wallT, 0)[0] - (14 + 0.12 / 2)) < 1e-6, String(L.hallToFloor(-9.2, 0)[0]));
const windows = plan.screens.filter((s) => s.kind === "window");
const clear = windows.every((w) => w.center[2] + w.size[0] / 2 <= east.doors[0][0] - 0.1 || w.center[2] - w.size[0] / 2 >= east.doors[0][1] + 0.1);
check("the three weather windows stand clear of the doorway (the Blender wall cuts both)", clear, windows.map((w) => `${w.id}@${w.center[2]}`).join());
// The GLB: it carries the wall, not the hall.
const glb = readFileSync(new URL("public/floor/office.glb", ROOT));
const jsonLen = glb.readUInt32LE(12);
const gltf = JSON.parse(glb.subarray(20, 20 + jsonLen).toString("utf8"));
const names = new Set(gltf.nodes.map((n) => n.name));
check("office.glb holds no hall node (the hall is built at runtime)", ![...names].some((n) => /^mead_/.test(n)));
check("office.glb still names every wall and every weather window", names.has("ext_east") && ["window_0", "window_1", "window_2"].every((n) => names.has(n)));

console.log("the people");
const nav = new FS.NavGrid(plan);
const free = (p) => nav.free(...nav.cellOf(p[0], p[1]));
const reach = (a, b) => {
  const pts = nav.path(a, b);
  if (!nav.lastFound) return null;
  let len = 0;
  let cur = a;
  for (const q of pts) {
    len += Math.hypot(q[0] - cur[0], q[1] - cur[1]);
    cur = q;
  }
  return len;
};
const lounge = [8, 2.5];
const spots = L.HALL_SPOTS;
check("21 spots, unique ids, every one in the plan at the transformed place", spots.length === 21 && new Set(spots.map((s) => s.id)).size === spots.length && spots.every((s) => {
  const p = plan.spots[s.id];
  const [fx, fz] = L.hallToFloor(s.x, s.z);
  return p && Math.abs(p.pos[0] - fx) < 1e-3 && Math.abs(p.pos[1] - fz) < 1e-3 && p.pose === s.pose && p.act === s.act;
}));
check("every spot is inside the hall's interior", spots.every((s) => s.x > L.HALL_ROOM.x0 && s.x < L.HALL_ROOM.x1 && s.z > L.HALL_ROOM.z0 && s.z < L.HALL_ROOM.z1));
check("every spot is on open floor", spots.every((s) => free(plan.spots[s.id].pos)), spots.filter((s) => !free(plan.spots[s.id].pos)).map((s) => s.id).join());
const lost = spots.filter((s) => reach(lounge, plan.spots[s.id].pos) == null).map((s) => s.id);
check("every spot can be walked to from the lounge (through the doorway)", lost.length === 0, lost.join());
const far = spots.map((s) => [s.id, reach(lounge, plan.spots[s.id].pos)]).filter(([, d]) => d != null && d > 50);
check("…and by a sensible way (under 50 m)", far.length === 0, far.map(([i, d]) => `${i} ${d.toFixed(1)}`).join());
const crowd = [];
for (const s of spots) for (const n of L.HALL_NPCS) if (Math.hypot(s.x - n.x, s.z - n.z) < 0.85) crowd.push(`${s.id}~${n.id}`);
check("no spot is within 0.85 m of one of the hall's own regulars", crowd.length === 0, crowd.join());
const stack = [];
for (let i = 0; i < spots.length; i++) for (let j = i + 1; j < spots.length; j++) if (Math.hypot(spots[i].x - spots[j].x, spots[i].z - spots[j].z) < 0.9) stack.push(`${spots[i].id}~${spots[j].id}`);
check("no two spots are within 0.9 m of each other", stack.length === 0, stack.join());
const acts = new Set(spots.map((s) => s.act));
check("every act a spot names has an idle animation in the scene", [...acts].every((a) => new RegExp(`case "${a}":`).test(src.floorScene)), [...acts].filter((a) => !new RegExp(`case "${a}":`).test(src.floorScene)).join());
check("a stool spot is a stool pose and the scene seats it at the stool's height", spots.filter((s) => s.pose === "stool").length === 2 && /mode === "stool" \? 0\.76/.test(src.floorScene));
const nearDoor = nav.path([14.8, 2.5], [13.2, 2.5]);
check("the doorway itself can be walked straight through", nav.lastFound && nearDoor.length >= 1);
const walled = L.HALL_BLOCKS.filter((b) => !plan.furniture.some((f) => f.id === `mead_blk_${b.id}` && f.obstacle === true));
check("every nav block of the layout is an obstacle in the plan", walled.length === 0, walled.map((b) => b.id).join());

console.log("the screens");
const nameInBuilder = (id) => {
  const t = id.replace(/_(\d)$/, "_${");
  return src.build.includes(`"${id}"`) || src.extras.includes(`"${id}"`) || new RegExp(`\`${t.replace(/\$\{/, "\\$\\{")}`).test(src.build + src.extras) || id.startsWith("mead_tv_") && /mead_tv_\$\{i\}/.test(src.build) || id.startsWith("mead_booth_") && /mead_booth_\$\{slot\}/.test(src.build);
};
const planScreens = plan.screens.filter((s) => /^mead_/.test(s.id));
check("the layout's screens are exactly the plan's hall screens", planScreens.length === L.HALL_SCREENS.length && L.HALL_SCREENS.every((s) => planScreens.some((p) => p.id === s.id && Math.abs(p.facing - s.facing) < 1e-6)));
check("every plan screen has a mesh of that name in the builder", L.HALL_SCREENS.every((s) => nameInBuilder(s.id)), L.HALL_SCREENS.filter((s) => !nameInBuilder(s.id)).map((s) => s.id).join());
check("every Go-to chip names a plan screen", L.HALL_PLACES.every((p) => plan.screens.some((s) => s.id === p.id)));
check("the Floor does not draw canvases for the hall's plan screens (the hall owns them)", /if \(s\.hall\) continue;/.test(src.floorScene));
const cams = Object.keys(L.HALL_CAMERAS).map((k) => (k === "overview" ? "mead" : `mead_${k}`));
check("every hall camera is in the plan, the scene's CameraPreset and (the overview) the tab's chips", cams.every((c) => plan.camera[c]) && cams.every((c) => src.floorScene.includes(`"${c}"`)) && /id: "mead", label: "Mead Hall"/.test(src.tab));
check("the tab lists the hall's views and its Go-to row", /mead hall/.test(src.tab) && /MEAD_VIEWS/.test(src.tab));
check("the Floor's hall reads the Predict analyzer's own graded board (loadHallBoard, scanner models included) and publishes it to the hall store the talk reads", /createSignalHallFeed/.test(src.feed) && /load:\s*loadHallBoard/.test(src.feed) && /setHall\(/.test(src.feed));
check("the Skald's Ledger reads sentences the engines already wrote (go-ledger, paper-scorer, journal)", /goStats\(\)\.line|go\.line/.test(src.record) && /paper\.verdict/.test(src.record) && /journal\.line/.test(src.record));

check("a tap on a market in the Floor's hall opens its desk panel in the Predict analyzer (paper only: a panel, nothing more)", /onHallTap/.test(src.floorScene) && /onHallTap: \(id\) => openPredictAt\(id\)/.test(src.tab) && /export function openPredictAt/.test(src.link) && /takePredictFocus\(\)/.test(src.analyzer));
check("the analyzer links back to the Floor's hall, and the Floor takes the camera it asked for once", /openFloorAt\(\"mead\"\)/.test(src.analyzer) && /takeFloorCamera\(\)/.test(src.tab));
check("the Floor's overview takes in the wing (the camera is the layout's FLOOR_OVERVIEW)", JSON.stringify(plan.camera.overview.pos) === JSON.stringify(L.FLOOR_OVERVIEW.pos) && JSON.stringify(plan.camera.overview.target) === JSON.stringify(L.FLOOR_OVERVIEW.target));

console.log("the guards");
const all = Object.entries(src).filter(([k]) => ["build", "extras", "kit", "people", "scene", "screens", "record", "floorMead", "layout", "link"].includes(k));
const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const marks = all.filter(([, t]) => /\bskol\b|vikings|\bNFL shield\b|minnesota vikings/i.test(strip(t))).map(([k]) => k);
check("no team or league marks in the hall's code (original Norse art only)", marks.length === 0, marks.join());
const orders = all.filter(([, t]) => /robinhood|rh-http|rh-mcp|rh-ledger|room\/exec|placeOrder|submitOrder|review_option_order/i.test(strip(t))).map(([k]) => k);
check("no order path: nothing in the hall imports a broker, the executor or an order call", orders.length === 0, orders.join());
const rnd = all.filter(([, t]) => /Math\.random/.test(strip(t))).map(([k]) => k);
check("no Math.random in the hall (it replays the same)", rnd.length === 0, rnd.join());
check("the hall says PAPER ONLY on its screens", /PAPER ONLY/.test(src.screens) && /NOTHING HERE IS A PICK/.test(src.screens));
check("an extras screen with a pick, a side or a win line cannot be written: no 'will win' / 'take the' / 'bet on' in the hall's screen text", !/will win|take the |bet on |lock it|guarantee/i.test(strip(src.screens)));

console.log(`\nmead hall: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
