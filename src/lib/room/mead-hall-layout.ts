/**
 * The Mead Hall's plan — one set of numbers, read by three things:
 *   - `components/mead/mead-hall-build.ts` (the three.js hall, built once for both homes),
 *   - `scripts/build-mead-plan.mjs` (writes the hall's walls, nav blocks, screens, spots and cameras into floor-layout.json),
 *   - the Floor's talk and activities (`mead_*` spot ids, the HALL zone).
 *
 * The hall lives in its own frame (x −9…9 across, z −7…11 from the jumbotron wall to the front, 7 m high) — the frame the
 * standalone Mead Hall tab has always used. `hallToFloor` puts it in the Floor: a wing east of the lounge, the same 18 m deep
 * as the building, joined by a doorway in the lounge's east wall.
 *
 * Pure data and arithmetic: no three.js, no DOM, no desk import. Presentation only.
 */

export type V2 = [number, number];
export type V3 = [number, number, number];

/** Interior bounds, hall frame (meters). `z1` is 4 m deeper than the standalone hall (z 7): the front lobby with the Long Table. */
export const HALL_ROOM = { x0: -9, x1: 9, z0: -7, z1: 11, h: 7, wallT: 0.2 } as const;

/**
 * Where the hall's origin sits in the Floor. x puts the hall's west wall (outer face −9.2) flush against the lounge's east
 * wall (x 14, 0.12 thick → face at 14.06); z puts the jumbotron wall on the building's north wall (z −10) and the front on its
 * south wall (z 8): 18 m, the same as the lounge.
 */
export const HALL_AT = { x: 23.26, z: -3 } as const;

export const hallToFloor = (x: number, z: number): V2 => [+(x + HALL_AT.x).toFixed(3), +(z + HALL_AT.z).toFixed(3)];
export const floorToHall = (x: number, z: number): V2 => [x - HALL_AT.x, z - HALL_AT.z];
/** Is this Floor point inside the hall's interior? */
export const inHall = (x: number, z: number): boolean => {
  const [hx, hz] = floorToHall(x, z);
  return hx > HALL_ROOM.x0 && hx < HALL_ROOM.x1 && hz > HALL_ROOM.z0 && hz < HALL_ROOM.z1;
};

/** The doorway in the hall's west wall, hall-frame z. In the Floor it is the same opening in the lounge's `ext_east`. */
export const HALL_DOOR = { z0: 4.0, z1: 7.0 } as const;
/** How high that opening is (the lounge wall's `doorH`): taller than an office door, because it is a hall's. */
export const HALL_DOOR_H = 2.6;

/** Floor-frame z of the doorway (what `ext_east.doors` carries). */
export const HALL_DOOR_FLOOR: V2 = [HALL_DOOR.z0 + HALL_AT.z, HALL_DOOR.z1 + HALL_AT.z];

/** The building's own north and south faces, which the hall's walls continue. */
export const HALL_WALL_Y = { solid: 7, low: 1.1 } as const;

type Box = [number, number, number, number]; // x0, z0, x1, z1

/** Things nobody walks through (hall frame). The first six are the standalone hall's own BLOCKS, with the bar's front edge at its true z. */
export const HALL_BLOCKS: { id: string; box: Box }[] = [
  { id: "bar", box: [1.6, -7, 9, -2.7] },
  { id: "stool_n0", box: [2.7, -2.45, 3.3, -1.85] },
  { id: "stool_n1", box: [5.1, -2.45, 5.7, -1.85] },
  { id: "stool_n2", box: [7.5, -2.45, 8.1, -1.85] },
  { id: "booth_a", box: [-9, -3.7, -5.6, -1.3] },
  { id: "booth_b", box: [-9, -0.3, -5.6, 2.1] },
  { id: "pool", box: [-7.2, 3.3, -3.8, 5.3] },
  { id: "runes", box: [-9, -7, -5.2, -5.6] },
  { id: "long_table", box: [0.9, 8.05, 5.9, 9.15] },
  { id: "hearth", box: [8.0, 4.9, 9, 7.9] },
  { id: "lectern", box: [-0.55, 8.1, 0.05, 9.1] },
  { id: "barrels", box: [7.7, 9.7, 9, 10.9] },
];

export type HallPose = "stand" | "sit" | "stool";

export interface HallSpot {
  id: string;
  x: number;
  z: number;
  /** What this person looks at (hall frame). */
  look: V2;
  pose: HallPose;
  /** What they are doing here: picks the idle animation (floor-scene `ambientFor`). */
  act: "mead_watch" | "mead_chat" | "mead_board" | "mead_bar" | "mead_pool" | "mead_table" | "mead_present" | "mead_hearth";
}

/**
 * Where the five go. Free of every block (nav inflates 0.28 m), reachable from the door, clear of the hall's own patrons.
 * Ids are the contract with the talk: `{ zone: "HALL", spot: "mead_…" }`.
 */
export const HALL_SPOTS: HallSpot[] = [
  { id: "mead_door", x: -8.0, z: 5.6, look: [-5, 5.6], pose: "stand", act: "mead_watch" },
  { id: "mead_chat_0", x: 0.4, z: 3.0, look: [1.5, 3.7], pose: "stand", act: "mead_chat" },
  { id: "mead_chat_1", x: 2.7, z: 3.0, look: [1.5, 3.7], pose: "stand", act: "mead_chat" },
  { id: "mead_chat_2", x: 1.5, z: 4.6, look: [1.5, 3.7], pose: "stand", act: "mead_chat" },
  { id: "mead_jumbo_0", x: -2.8, z: 3.4, look: [-1.8, -7], pose: "stand", act: "mead_watch" },
  { id: "mead_jumbo_1", x: -0.8, z: 3.4, look: [-1.8, -7], pose: "stand", act: "mead_watch" },
  { id: "mead_board", x: -5.9, z: -4.4, look: [-7, -6.4], pose: "stand", act: "mead_board" },
  { id: "mead_tap", x: 2.2, z: -1.4, look: [2.9, -3.2], pose: "stand", act: "mead_bar" },
  { id: "mead_bar_0", x: 4.2, z: -2.15, look: [4.2, -4], pose: "stool", act: "mead_bar" },
  { id: "mead_bar_1", x: 6.6, z: -2.15, look: [6.6, -4], pose: "stool", act: "mead_bar" },
  { id: "mead_pool_0", x: -5.5, z: 2.7, look: [-5.5, 4.3], pose: "stand", act: "mead_pool" },
  { id: "mead_pool_1", x: -5.5, z: 5.9, look: [-5.5, 4.3], pose: "stand", act: "mead_pool" },
  { id: "mead_lectern", x: -1.2, z: 8.6, look: [3.4, 8.6], pose: "stand", act: "mead_present" },
  { id: "mead_long_n0", x: 1.5, z: 7.6, look: [1.5, 8.6], pose: "sit", act: "mead_table" },
  { id: "mead_long_n1", x: 3.4, z: 7.6, look: [3.4, 8.6], pose: "sit", act: "mead_table" },
  { id: "mead_long_n2", x: 5.3, z: 7.6, look: [5.3, 8.6], pose: "sit", act: "mead_table" },
  { id: "mead_long_s0", x: 1.5, z: 9.6, look: [1.5, 8.6], pose: "sit", act: "mead_table" },
  { id: "mead_long_s1", x: 3.4, z: 9.6, look: [3.4, 8.6], pose: "sit", act: "mead_table" },
  { id: "mead_long_s2", x: 5.3, z: 9.6, look: [5.3, 8.6], pose: "sit", act: "mead_table" },
  { id: "mead_hearth_0", x: 6.7, z: 5.4, look: [9, 5.9], pose: "sit", act: "mead_hearth" },
  { id: "mead_hearth_1", x: 6.7, z: 7.4, look: [9, 6.9], pose: "sit", act: "mead_hearth" },
];

/** The hall's own people (the standalone crowd): they keep to these places, so the five never share a spot with one. */
export interface HallNpc {
  id: string;
  x: number;
  z: number;
  look: V2;
  seated: boolean;
  /** Raised off the floor (a bar stool). */
  baseY?: number;
  role?: "bartender";
}
export const HALL_NPCS: HallNpc[] = [
  { id: "bartender", x: 5.2, z: -4.25, look: [5.2, 0], seated: false, role: "bartender" },
  { id: "booth_a0", x: -7.4, z: -3.4, look: [-7.4, -2.5], seated: true },
  { id: "booth_a1", x: -7.4, z: -1.6, look: [-7.4, -2.5], seated: true },
  { id: "booth_b0", x: -7.4, z: 0.0, look: [-7.4, 0.9], seated: true },
  { id: "booth_b1", x: -7.4, z: 1.8, look: [-7.4, 0.9], seated: true },
  { id: "stool_0", x: 3.0, z: -2.05, look: [3.0, -4], seated: true, baseY: 0.32 },
  { id: "stool_1", x: 5.4, z: -2.05, look: [5.4, -4], seated: true, baseY: 0.32 },
  { id: "stool_2", x: 7.8, z: -2.05, look: [7.8, -4], seated: true, baseY: 0.32 },
  { id: "fan_0", x: -0.4, z: 2.2, look: [-1.8, -6], seated: false },
  { id: "fan_1", x: -3.2, z: 1.4, look: [-1.8, -6], seated: false },
  { id: "fan_2", x: -3.9, z: 4.4, look: [-5.5, 4.3], seated: false },
  { id: "fan_3", x: 1.4, z: 0.4, look: [-1.8, -6], seated: false },
];

export interface HallCamera {
  pos: V3;
  target: V3;
}
/** Hall-frame camera presets; the first four are the standalone tab's own. */
export const HALL_CAMERAS: Record<string, HallCamera> = {
  overview: { pos: [0.6, 5.4, 12.6], target: [0.2, 2.1, -3] },
  jumbotron: { pos: [-1.8, 3.0, 0.2], target: [-1.8, 3.0, -7] },
  board: { pos: [-4.6, 2.7, -1.6], target: [-7.0, 2.6, -6.4] },
  bar: { pos: [5.2, 2.6, 2.4], target: [5.2, 2.4, -5] },
  /** Standing in the doorway, looking down the runner. */
  door: { pos: [-8.4, 2.1, 5.5], target: [-0.5, 1.8, -2.5] },
  table: { pos: [3.4, 3.0, 3.8], target: [3.4, 0.9, 8.6] },
  hearth: { pos: [2.4, 2.6, 4.4], target: [8.8, 1.0, 6.4] },
  /** A high three-quarter of the whole room, outside the south wall. */
  aerial: { pos: [4, 13.5, 19], target: [0, 0, 2] },
};

export const hallCameraToFloor = (c: HallCamera): HallCamera => {
  const [px, pz] = hallToFloor(c.pos[0], c.pos[2]);
  const [tx, tz] = hallToFloor(c.target[0], c.target[2]);
  return { pos: [px, c.pos[1], pz], target: [tx, c.target[1], tz] };
};

/**
 * The hall's clickable screens, hall frame. `facing` is the yaw the Floor's plan uses (0 → +z, 90 → +x, 180 → −z, 270 → −x).
 * The Floor registers each under its id so Go-to chips, double-click and hover work exactly as on every other screen.
 */
export interface HallScreenSpec {
  id: string;
  label: string;
  kind: "tv" | "poster";
  center: V3;
  size: V2;
  facing: number;
  px: V2;
}
export const JUMBO_SIZE: V2 = [5.8, (5.8 * 720) / 1280];
export const HALL_SCREENS: HallScreenSpec[] = [
  { id: "mead_jumbo", label: "Jumbotron", kind: "tv", center: [-1.8, 3.05, -6.8], size: JUMBO_SIZE, facing: 0, px: [1280, 720] },
  { id: "mead_board", label: "Rune Board", kind: "poster", center: [-7.0, 2.65, -6.4], size: [2.3, 3.07], facing: 25.8, px: [768, 1024] },
  { id: "mead_tv_0", label: "Over-bar TV 1", kind: "tv", center: [3.35, 3.6, -6.68], size: [1.75, 1.37], facing: 0, px: [512, 400] },
  { id: "mead_tv_1", label: "Over-bar TV 2", kind: "tv", center: [5.35, 3.6, -6.68], size: [1.75, 1.37], facing: 0, px: [512, 400] },
  { id: "mead_tv_2", label: "Over-bar TV 3", kind: "tv", center: [7.35, 3.6, -6.68], size: [1.75, 1.37], facing: 0, px: [512, 400] },
  { id: "mead_booth_0", label: "Booth market watch", kind: "tv", center: [-6.8, 1.15, -2.5], size: [0.8, 0.6], facing: 70, px: [512, 384] },
  { id: "mead_booth_1", label: "Booth market watch", kind: "tv", center: [-6.8, 1.15, 0.9], size: [0.8, 0.6], facing: 70, px: [512, 384] },
  { id: "mead_ledger", label: "The Skald's Ledger", kind: "poster", center: [-8.86, 2.55, 9.0], size: [2.6, 1.8], facing: 90, px: [1024, 710] },
];

/** The doorway-side camera chips the Floor tab lists under "Mead Hall". */
export const HALL_PLACES: { id: string; label: string }[] = [
  { id: "mead_jumbo", label: "Jumbotron" },
  { id: "mead_board", label: "Rune Board" },
  { id: "mead_tv_1", label: "Bar TVs" },
  { id: "mead_booth_0", label: "Booth screen" },
  { id: "mead_ledger", label: "The Ledger" },
];

/** Every id the plan generator owns (so a re-run replaces them and nothing else). */
export const HALL_PLAN_PREFIX = "mead_";

/** Hall-frame box → a plan furniture entry's centre and size (x, y, z). */
export const boxToFurniture = (b: Box, height = 1): { pos: V2; size: V3 } => {
  const [cx, cz] = hallToFloor((b[0] + b[2]) / 2, (b[1] + b[3]) / 2);
  return { pos: [cx, cz], size: [+(b[2] - b[0]).toFixed(3), height, +(b[3] - b[1]).toFixed(3)] };
};

/** Does a hall-frame point stand inside an inflated block? (the plan generator's and the verifier's clearance test) */
export const inBlock = (x: number, z: number, pad: number): string | null => {
  for (const { id, box } of HALL_BLOCKS) if (x > box[0] - pad && x < box[2] + pad && z > box[1] - pad && z < box[3] + pad) return id;
  return null;
};
