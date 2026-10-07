/**
 * Where the playable Owner stands, and how a stuck Owner gets out — pure, presentation only.
 *
 * The Owner (Keaton) walks the floor with WASD. A step is refused when it lands on a blocked cell of the nav grid, and a refused step
 * moves nothing — so an Owner standing on a blocked cell can never take a first step. That is exactly what shipped: the spawn was
 * "the R&D seat minus 1.2 m", which is z = 3.95, inside desk_RnD (z 3.85–4.75) and its inflated margin, and WASD did nothing.
 *
 * Nothing here touches a trading rule, a gate or the Manager's state.
 */

export type V2 = [number, number];

/** The part of the scene's NavGrid this needs (NavGrid satisfies it). */
export interface NavLike {
  cellOf(x: number, z: number): [number, number];
  free(i: number, j: number): boolean;
  nearestFree(i: number, j: number): [number, number];
  center(i: number, j: number): V2;
}

/** True when the world point is on open floor. */
export function onFreeFloor(nav: NavLike, p: V2): boolean {
  const [i, j] = nav.cellOf(p[0], p[1]);
  return nav.free(i, j);
}

/**
 * The nearest open floor to a point: the point itself when it is open, else the centre of the nearest free cell. A point with no free
 * cell inside the search radius comes back unchanged (the caller can tell: `onFreeFloor` is still false).
 */
export function nearestOpenFloor(nav: NavLike, p: V2): V2 {
  const [i, j] = nav.cellOf(p[0], p[1]);
  if (nav.free(i, j)) return p;
  const [fi, fj] = nav.nearestFree(i, j);
  return nav.free(fi, fj) ? nav.center(fi, fj) : p;
}
