/**
 * The playable Owner can walk (src/components/room/owner-walk.ts + the scene's spawn and walk tick).
 *
 *   npx tsx scripts/verify-owner-walk.mjs
 *
 * WHY: the Owner (Keaton) is meant to be walked around the floor with WASD after a click on the canvas. It did nothing. The spawn was
 * "the R&D seat minus 1.2 m" = (-0.6, 3.95), inside desk_RnD (z 3.85-4.75) and the nav grid's margin around it; a step that lands on
 * a blocked cell is refused and moves nothing, so an Owner on a blocked cell can never take a first step.
 *
 * This runs the REAL floor layout, the REAL NavGrid and the REAL OwnerAvatar.tryMove (no WebGL needed) and pins:
 *   - the mechanism: on a blocked cell no step in any direction moves the Owner (so the bug cannot hide behind a layout change);
 *   - the spawn is open floor, and close to where it was meant to be;
 *   - from the spawn the Owner really moves in every open direction at the scene's walking speed;
 *   - the Owner can reach the places a person would walk to (every room's spots), not only a pocket of the bullpen;
 *   - an Owner put back on a blocked cell is freed and then walks;
 *   - the scene uses the helper at the spawn and before each step.
 * Pure presentation: nothing here reads or writes a trading rule, a gate, the Manager's call or an account.
 */
import fs from "node:fs";

const { NavGrid } = await import("../src/components/room/floor-scene.ts");
const { OwnerAvatar } = await import("../src/components/room/floor-proto-avatars.ts");
const { nearestOpenFloor, onFreeFloor } = await import("../src/components/room/owner-walk.ts");
const LAYOUT = JSON.parse(fs.readFileSync(new URL("../src/data/floor-layout.json", import.meta.url), "utf8"));

let pass = 0;
let fail = 0;
const check = (name, ok, detail = "") => {
  if (ok) pass++;
  else fail++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : ` — ${detail}`}`);
};

const nav = new NavGrid(LAYOUT);
const walkable = (x, z) => {
  const [i, j] = nav.cellOf(x, z);
  return nav.free(i, j);
};
const lab = LAYOUT.spots.office_rnd;
const intended = [lab.pos[0], lab.pos[1] - 1.2];
const spawn = nearestOpenFloor(nav, intended);
const DIRS = [[0, -1], [0, 1], [1, 0], [-1, 0], [0.7071, -0.7071], [-0.7071, -0.7071], [0.7071, 0.7071], [-0.7071, 0.7071]];
const SPEED = 2.4 / 60; // the scene's walking step at 60 fps (2.4 m/s)
const walk = (start, dir, steps = 120) => {
  const o = new OwnerAvatar([...start], [-8, -1]);
  for (let s = 0; s < steps; s++) o.tryMove(dir[0] * SPEED, dir[1] * SPEED, walkable);
  return { moved: Math.hypot(o.pos[0] - start[0], o.pos[1] - start[1]), at: o.pos };
};

console.log("the mechanism");
{
  // A tiny grid with a solid block in the middle; an Owner inside the block cannot move in any direction.
  const solid = (x, z) => !(Math.abs(x) < 1 && Math.abs(z) < 1);
  const stuck = DIRS.map((d) => {
    const o = new OwnerAvatar([0.1, 0.1], [0, 0]);
    for (let s = 0; s < 60; s++) o.tryMove(d[0] * SPEED, d[1] * SPEED, solid);
    return Math.hypot(o.pos[0] - 0.1, o.pos[1] - 0.1);
  });
  check("on a blocked cell no step in any of 8 directions moves the Owner (why a bad spawn is fatal)", stuck.every((m) => m < 1e-9), stuck.join());
  const o = new OwnerAvatar([0.1, 0.1], [0, 0]);
  const out = nearestOpenFloor({ cellOf: (x, z) => [Math.floor(x * 4), Math.floor(z * 4)], free: (i, j) => !(Math.abs(i + 0.5) < 4 && Math.abs(j + 0.5) < 4), nearestFree: (i, j) => [i, j + 6], center: (i, j) => [(i + 0.5) / 4, (j + 0.5) / 4] }, o.pos);
  check("nearestOpenFloor moves a blocked point to the centre of the nearest free cell", out[1] > 1 && out[1] !== o.pos[1], JSON.stringify(out));
  check("and leaves an open point exactly where it is", nearestOpenFloor({ cellOf: () => [0, 0], free: () => true, nearestFree: () => [9, 9], center: () => [9, 9] }, [3, 4]).join() === "3,4");
}

console.log("the real layout");
{
  check("the spawn is open floor", onFreeFloor(nav, spawn), JSON.stringify(spawn));
  check("…within two metres of where it was meant to be", Math.hypot(spawn[0] - intended[0], spawn[1] - intended[1]) <= 2, JSON.stringify([intended, spawn]));
  check("…and not inside any piece of furniture (the desk it was spawned in)", !LAYOUT.furniture.some((f) => f.obstacle && Math.abs(spawn[0] - f.pos[0]) < f.size[0] / 2 && Math.abs(spawn[1] - f.pos[1]) < (f.size[2] ?? f.size[0]) / 2), JSON.stringify(spawn));
  const results = DIRS.map((d) => walk(spawn, d));
  const free = results.filter((r) => r.moved > 0.05).length;
  check("from the spawn the Owner moves in most directions (not boxed in)", free >= 6, results.map((r) => r.moved.toFixed(2)).join(" "));
  check("…and in some direction walks a full two seconds without stopping (4.8 m)", results.some((r) => r.moved > 4.6), Math.max(...results.map((r) => r.moved)).toFixed(2));
  check("every position the walk reaches is open floor (no clipping through a desk)", results.every((r) => walkable(r.at[0], r.at[1])));
}

console.log("walk around: the places a person would go");
{
  const seen = new Set();
  const key = (i, j) => `${i},${j}`;
  const [si, sj] = nav.cellOf(spawn[0], spawn[1]);
  const stack = [[si, sj]];
  seen.add(key(si, sj));
  while (stack.length) {
    const [i, j] = stack.pop();
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      if (!nav.free(i + di, j + dj) || seen.has(key(i + di, j + dj))) continue;
      seen.add(key(i + di, j + dj));
      stack.push([i + di, j + dj]);
    }
  }
  const spots = Object.entries(LAYOUT.spots).filter(([, s]) => s.pos);
  const unreachable = spots.filter(([, s]) => {
    const [i, j] = nav.nearestFree(...nav.cellOf(s.pos[0], s.pos[1]));
    return !seen.has(key(i, j));
  });
  check(`the Owner can reach ${spots.length - unreachable.length} of ${spots.length} spots on the floor plan`, unreachable.length === 0, unreachable.map(([n]) => n).join(", "));
  const rooms = [...new Set(spots.map(([n]) => n.split("_")[0]))];
  check(`…across ${rooms.length} kinds of place (war room, lounge, annex, investment wing, offices)`, rooms.length >= 6);
}

console.log("freed when stuck");
{
  // The scene's pre-step rule: an Owner on a blocked cell is put on open floor, then walks.
  const raw = intended;
  const o = new OwnerAvatar([...raw], [-8, -1]);
  const wasBlocked = !onFreeFloor(nav, o.pos);
  if (wasBlocked) o.pos = nearestOpenFloor(nav, o.pos);
  check("an Owner placed at the old spawn is on open floor after the pre-step rule", onFreeFloor(nav, o.pos));
  const before = [...o.pos];
  for (let s = 0; s < 120; s++) o.tryMove(0, -SPEED, walkable);
  for (let s = 0; s < 120; s++) o.tryMove(SPEED, 0, walkable);
  check("…and then actually walks", Math.hypot(o.pos[0] - before[0], o.pos[1] - before[1]) > 0.5, JSON.stringify([before, o.pos]));
}

console.log("wired");
{
  const scene = fs.readFileSync(new URL("../src/components/room/floor-scene.ts", import.meta.url), "utf8");
  const helper = fs.readFileSync(new URL("../src/components/room/owner-walk.ts", import.meta.url), "utf8");
  check("the scene spawns the Owner through nearestOpenFloor", /new OwnerAvatar\(ownerStart, ownerLook\)/.test(scene) && /const ownerStart: \[number, number\] = nearestOpenFloor\(this\.nav,/.test(scene));
  check("…and frees a stuck Owner before each step", /if \(!onFreeFloor\(this\.nav, this\.owner\.pos\)\) this\.owner\.pos = nearestOpenFloor\(this\.nav, this\.owner\.pos\);/.test(scene));
  check("the walk still needs focus and walk mode (it never hijacks the page's keys)", /if \(this\.focused && this\.walkMode\) \{/.test(scene) && /if \(!this\.focused\) return;/.test(scene));
  check("the helper touches no trading rule, gate, account or Manager state", !/execution|rh-|manager-|mandate|config|fetch\(|account/i.test(helper.replace(/\/\*[\s\S]*?\*\//g, "")));
}

console.log(`\nowner-walk: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
