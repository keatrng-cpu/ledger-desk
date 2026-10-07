/**
 * How a person moves along a route on the Floor (plan item M1). Presentation only:
 * it never places, sizes or refuses a trade and reads nothing from the desk.
 *
 * Today the avatar walks a string-pulled A* route at a constant 1.35 m/s, snaps to each waypoint, turns by
 * an exponential on the heading error (a 90-degree corner is a 14-degree jump in one frame) and advances its
 * gait by speed x 4.4 whatever the ground actually covered. This module replaces that with:
 *
 *   smoothPath  corners rounded with a quadratic curve, densified to ~0.15 m, and NEVER outside walkable
 *               cells: a rounded corner that touches a blocked cell is retried with half the trim, then
 *               left sharp.
 *   stepMover   a path-constrained mover. The body is always ON the polyline (so a walkable polyline means
 *               a walkable walk), at arc length `s`. Speed follows an acceleration limit, brakes for sharp
 *               corners and to stop exactly at the end, yaw is rate-limited and smoothed, lean follows the
 *               turn and the gait phase advances by DISTANCE / stride.
 *
 * Plain arrays and numbers, no `three`, no clock, no randomness: time comes in as `dt`.
 * Axes are the scene's: x east, z south; yaw = atan2(dx, dz) (0 faces +z), exactly as `Avatar` uses it.
 */

export type V2 = [number, number];
export type Walkable = (x: number, z: number) => boolean;

const TAU = Math.PI * 2;
const wrapPi = (a: number): number => {
  let r = (a + Math.PI) % TAU;
  if (r < 0) r += TAU;
  return r - Math.PI;
};
const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
const dist2 = (a: V2, b: V2) => Math.hypot(b[0] - a[0], b[1] - a[1]);

/* ── smoothing ──────────────────────────────────────────────────────────── */

export interface SmoothOpts {
  /** Output spacing along the route, metres. Default 0.15. */
  spacing?: number;
  /** Most a corner is trimmed on each side, metres. Default 1.0. */
  maxTrim?: number;
  /** A corner turning less than this (radians) is left alone. Default 0.04. */
  minTurn?: number;
}

/** Chord probe spacing used to decide a corner or a leg is walkable. */
const PROBE = 0.01;

/**
 * A point counts as walkable only if its 4 mm neighbourhood is too. Sampling a chord every 5 mm can step over a
 * sliver where it clips the corner of a blocked cell; asking for 4 mm of room around every sample makes any
 * clip show up in at least one sample, so "walkable at every probe" really means "walkable".
 */
function withMargin(w: Walkable): Walkable {
  const e = 0.004;
  return (x, z) => w(x, z) && w(x + e, z) && w(x - e, z) && w(x, z + e) && w(x, z - e) && w(x + e, z + e) && w(x - e, z - e) && w(x + e, z - e) && w(x - e, z + e);
}

/**
 * Round the corners of `path` and return a dense polyline. `path[0]` must be where the walker IS (the nav
 * grid's `path()` omits the start, so prepend it). The first and last points are returned exactly.
 *
 * Guarantee: the output is walkable at every 5 mm of its length, provided `path[0]` and the last point are.
 * Three things make that true beyond the corner test:
 *   1. a short end spur that doubles back (the router walks to a cell centre, then to the exact goal) is cut
 *      off when the direct chord is walkable;
 *   2. a leg of the input that clips a blocked cell (the router samples its straight lines every 10 cm) has the
 *      stretch around the clip re-planned on a fine lattice of points that all have room around them;
 *   3. the finished polyline is audited at 5 mm and repaired the same way.
 */
export function smoothPath(path: V2[], isWalkable: Walkable, opts: SmoothOpts = {}): V2[] {
  const walkable = withMargin(isWalkable);
  const spacing = opts.spacing ?? 0.15;
  const maxTrim = opts.maxTrim ?? 1.0;
  const minTurn = opts.minTurn ?? 0.04;
  let pts: V2[] = [];
  for (const p of path) {
    const last = pts[pts.length - 1];
    if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) > 1e-6) pts.push([p[0], p[1]]);
  }
  if (pts.length < 2) return pts;
  pts = tidy(repairLegs(pruneSpurs(pts, walkable), walkable, PROBE), walkable, 0.06);
  if (pts.length < 3) return tidy(repairLegs(densify(pts, spacing), walkable, 0.005), walkable, 1e-6);
  const n = pts.length;
  const curves: (V2[] | null)[] = new Array(n).fill(null);
  for (let i = 1; i < n - 1; i++) {
    const P = pts[i]!;
    const prev = pts[i - 1]!;
    const next = pts[i + 1]!;
    const lp = dist2(prev, P);
    const ln = dist2(P, next);
    const ux = (prev[0] - P[0]) / lp;
    const uz = (prev[1] - P[1]) / lp;
    const vx = (next[0] - P[0]) / ln;
    const vz = (next[1] - P[1]) / ln;
    const cosA = clamp(ux * vx + uz * vz, -1, 1);
    const deflection = Math.PI - Math.acos(cosA);
    if (deflection < minTurn) continue;
    // A leg shared with another corner gives each at most half; a leg that ends the route can give nearly all.
    const sharePrev = i - 1 === 0 ? lp * 0.95 : lp * 0.5;
    const shareNext = i + 1 === n - 1 ? ln * 0.95 : ln * 0.5;
    let trim = Math.min(maxTrim, sharePrev, shareNext);
    for (let attempt = 0; attempt < 5 && trim > 0.02; attempt++, trim *= 0.5) {
      const curve = bezierCorner(P, ux, uz, vx, vz, trim, spacing);
      if (chordsWalkable(curve, walkable)) {
        curves[i] = curve;
        break;
      }
    }
  }
  const out: V2[] = [pts[0]!];
  for (let i = 1; i < n - 1; i++) {
    const c = curves[i];
    if (c) {
      pushDense(out, c[0]!, spacing);
      for (let k = 1; k < c.length; k++) out.push(c[k]!);
    } else pushDense(out, pts[i]!, spacing);
  }
  pushDense(out, pts[n - 1]!, spacing);
  return tidy(repairLegs(out, walkable, 0.005), walkable, 1e-6);
}

/** Cut a short, sharply doubled-back first or last leg when the direct chord is walkable. */
function pruneSpurs(pts: V2[], walkable: Walkable): V2[] {
  const out = pts.map((p) => [p[0], p[1]] as V2);
  const turnAt = (a: V2, b: V2, c: V2) => {
    const h1 = Math.atan2(b[0] - a[0], b[1] - a[1]);
    const h2 = Math.atan2(c[0] - b[0], c[1] - b[1]);
    return Math.abs(wrapPi(h2 - h1));
  };
  while (out.length >= 3) {
    const n = out.length;
    if (dist2(out[n - 2]!, out[n - 1]!) < 0.4 && turnAt(out[n - 3]!, out[n - 2]!, out[n - 1]!) > 1.0 && chordsWalkable([out[n - 3]!, out[n - 1]!], walkable)) out.splice(n - 2, 1);
    else break;
  }
  while (out.length >= 3) {
    if (dist2(out[0]!, out[1]!) < 0.4 && turnAt(out[0]!, out[1]!, out[2]!) > 1.0 && chordsWalkable([out[0]!, out[2]!], walkable)) out.splice(1, 1);
    else break;
  }
  return out;
}

/**
 * Drop the seams a detour leaves: points closer than `minLeg` to their neighbour and single points that make the
 * route fold back on itself (a turn of more than ~110 degrees) -- each only when the chord that replaces them is
 * walkable, so a corner that really is a corner stays.
 */
function tidy(pts: V2[], walkable: Walkable, minLeg: number): V2[] {
  let cur = pts;
  for (let pass = 0; pass < 8; pass++) {
    const out: V2[] = [cur[0]!];
    let changed = false;
    for (let i = 1; i < cur.length; i++) {
      const p = cur[i]!;
      const last = i === cur.length - 1;
      const prev = out[out.length - 1]!;
      const tiny = dist2(prev, p) < minLeg;
      if (tiny && !last && firstBlocked(prev, cur[i + 1]!, walkable, 0.005) === null) {
        changed = true;
        continue;
      }
      if (tiny && last && out.length > 1 && firstBlocked(out[out.length - 2]!, p, walkable, 0.005) === null) {
        out.pop();
        changed = true;
      }
      const next = cur[i + 1];
      if (!last && next && out.length) {
        const h1 = Math.atan2(p[0] - prev[0], p[1] - prev[1]);
        const h2 = Math.atan2(next[0] - p[0], next[1] - p[1]);
        if (Math.abs(wrapPi(h2 - h1)) > 1.9 && firstBlocked(prev, next, walkable, 0.005) === null) {
          changed = true;
          continue;
        }
      }
      out.push(p);
    }
    cur = out;
    if (!changed) break;
  }
  return cur;
}

/**
 * Wherever a leg crosses a blocked cell, replace the stretch around the clip with a detour found on a fine
 * lattice (see `detour`). A leg whose detour cannot be found is passed through as the router drew it.
 */
function repairLegs(pts: V2[], walkable: Walkable, probe: number): V2[] {
  const out: V2[] = [pts[0]!];
  let budget = 40;
  for (let i = 1; i < pts.length; i++) {
    const b = pts[i]!;
    for (let again = 0; again < 12 && budget > 0; again++) {
      const a = out[out.length - 1]!;
      const run = blockedRun(a, b, walkable, probe);
      if (!run) break;
      // Re-plan only the stretch around the clip, with 0.6 m of the clean leg on either side.
      const len = dist2(a, b);
      const t0 = Math.max(0, run.from - 0.6) / len;
      const t1 = Math.min(len, run.to + 0.6) / len;
      const a1: V2 = [a[0] + (b[0] - a[0]) * t0, a[1] + (b[1] - a[1]) * t0];
      const b1: V2 = [a[0] + (b[0] - a[0]) * t1, a[1] + (b[1] - a[1]) * t1];
      budget--;
      const d = detour(a1, b1, walkable);
      if (!d) break;
      if (t0 > 0) out.push(a1);
      for (const q of d) out.push(q);
      if (t1 < 1) out.push(b1);
      else break;
    }
    out.push(b);
  }
  return out;
}

/** The arc-length span (from a) of the first blocked stretch of a -> b, or null if the leg is clean. */
function blockedRun(a: V2, b: V2, walkable: Walkable, probe: number): { from: number; to: number } | null {
  const len = dist2(a, b);
  const steps = Math.max(1, Math.ceil(len / probe));
  let from = -1;
  let to = -1;
  for (let j = 0; j <= steps; j++) {
    const t = j / steps;
    const blocked = !walkable(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t);
    if (blocked) {
      if (from < 0) from = t * len;
      to = t * len;
    } else if (from >= 0 && t * len - to > 0.3) break;
  }
  return from < 0 ? null : { from, to };
}

/**
 * A route from a to b on a 6.25 cm lattice whose nodes all have room around them (nothing blocked within
 * 5 cm), so no edge between neighbours can cross a blocked cell; then pulled straight where a chord with 3 cm
 * of clearance allows. Returns the points to walk through (a and b themselves excluded), or null.
 *
 * Why not just nudge a via point off the edge of the cell? Because a squeeze where two blocked cells touch
 * at a corner leaves no walkable gap to nudge into: the only honest answer is to go round.
 */
function detour(a: V2, b: V2, walkable: Walkable): V2[] | null {
  const g = 0.0625;
  const roomyAt = (x: number, z: number, r: number) => {
    if (!walkable(x, z)) return false;
    for (let k = 0; k < 16; k++) {
      const ang = (k / 16) * TAU;
      if (!walkable(x + Math.sin(ang) * r, z + Math.cos(ang) * r)) return false;
    }
    return true;
  };
  for (const margin of [1.5, 4]) {
    const minX = Math.floor((Math.min(a[0], b[0]) - margin) / g);
    const minZ = Math.floor((Math.min(a[1], b[1]) - margin) / g);
    const w = Math.ceil((Math.max(a[0], b[0]) + margin) / g) - minX + 1;
    const h = Math.ceil((Math.max(a[1], b[1]) + margin) / g) - minZ + 1;
    if (w * h > 120_000) return null;
    const room = new Int8Array(w * h);
    const open = (ix: number, iz: number) => {
      if (ix < 0 || iz < 0 || ix >= w || iz >= h) return false;
      const k = iz * w + ix;
      if (room[k] === 0) room[k] = roomyAt((minX + ix) * g, (minZ + iz) * g, 0.05) ? 1 : -1;
      return room[k] === 1;
    };
    const near = (p: V2): number => {
      // The lattice node closest to p that can be reached from p by a walkable straight line.
      const cx = Math.round(p[0] / g) - minX;
      const cz = Math.round(p[1] / g) - minZ;
      let best = -1;
      let bestD = Infinity;
      for (let dz = -7; dz <= 7; dz++) {
        for (let dx = -7; dx <= 7; dx++) {
          if (!open(cx + dx, cz + dz)) continue;
          const q: V2 = [(minX + cx + dx) * g, (minZ + cz + dz) * g];
          const d = dist2(p, q);
          if (d < bestD && firstBlocked(p, q, walkable, 0.005) === null) {
            bestD = d;
            best = (cz + dz) * w + (cx + dx);
          }
        }
      }
      return best;
    };
    const s = near(a);
    const e = near(b);
    if (s < 0 || e < 0) continue;
    const node = (k: number): V2 => [(minX + (k % w)) * g, (minZ + Math.floor(k / w)) * g];
    const goal = node(e);
    const hCost = (k: number) => dist2(node(k), goal);
    const gScore = new Float32Array(w * h).fill(Infinity);
    const came = new Int32Array(w * h).fill(-1);
    const heap: [number, number, number][] = [];
    let seq = 0;
    const push = (f: number, k: number) => {
      heap.push([f, seq++, k]);
      let c = heap.length - 1;
      while (c > 0) {
        const p = (c - 1) >> 1;
        const hp = heap[p]!;
        const hc = heap[c]!;
        if (hp[0] < hc[0] || (hp[0] === hc[0] && hp[1] < hc[1])) break;
        heap[p] = hc;
        heap[c] = hp;
        c = p;
      }
    };
    const pop = (): number => {
      const top = heap[0]!;
      const last = heap.pop()!;
      if (heap.length) {
        heap[0] = last;
        let c = 0;
        for (;;) {
          const l = c * 2 + 1;
          const r = l + 1;
          let m = c;
          const less = (x: [number, number, number], y: [number, number, number]) => x[0] < y[0] || (x[0] === y[0] && x[1] < y[1]);
          if (l < heap.length && less(heap[l]!, heap[m]!)) m = l;
          if (r < heap.length && less(heap[r]!, heap[m]!)) m = r;
          if (m === c) break;
          const tmp = heap[m]!;
          heap[m] = heap[c]!;
          heap[c] = tmp;
          c = m;
        }
      }
      return top[2];
    };
    gScore[s] = 0;
    push(hCost(s), s);
    const closed = new Uint8Array(w * h);
    let found = false;
    let guard = 0;
    while (heap.length && guard++ < 150_000) {
      const k = pop();
      if (closed[k]) continue;
      if (k === e) {
        found = true;
        break;
      }
      closed[k] = 1;
      const ix = k % w;
      const iz = Math.floor(k / w);
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dz) continue;
          if (!open(ix + dx, iz + dz)) continue;
          const nk = (iz + dz) * w + (ix + dx);
          const ng = gScore[k]! + (dx && dz ? 1.4142 * g : g);
          if (ng < gScore[nk]!) {
            gScore[nk] = ng;
            came[nk] = k;
            push(ng + hCost(nk), nk);
          }
        }
      }
    }
    if (!found) continue;
    const chain: V2[] = [];
    for (let k = e; k !== -1; k = came[k]!) chain.push(node(k));
    chain.reverse();
    // Pull straight wherever a chord with 3 cm of room all along allows.
    const clearChord = (p: V2, q: V2) => {
      const len = dist2(p, q);
      const steps = Math.max(1, Math.ceil(len / 0.015));
      for (let j = 0; j <= steps; j++) {
        const t = j / steps;
        if (!roomyAt(p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, 0.03)) return false;
      }
      return true;
    };
    const pulled: V2[] = [chain[0]!];
    let cur = 0;
    while (cur < chain.length - 1) {
      let far = cur + 1;
      for (let j = Math.min(chain.length - 1, cur + 48); j > cur + 1; j--) {
        if (clearChord(chain[cur]!, chain[j]!)) {
          far = j;
          break;
        }
      }
      pulled.push(chain[far]!);
      cur = far;
    }
    return pulled;
  }
  return null;
}

function firstBlocked(a: V2, b: V2, walkable: Walkable, probe: number): V2 | null {
  const len = dist2(a, b);
  const steps = Math.max(1, Math.ceil(len / probe));
  for (let j = 0; j <= steps; j++) {
    const t = j / steps;
    const x = a[0] + (b[0] - a[0]) * t;
    const z = a[1] + (b[1] - a[1]) * t;
    if (!walkable(x, z)) return [x, z];
  }
  return null;
}

function bezierCorner(P: V2, ux: number, uz: number, vx: number, vz: number, trim: number, spacing: number): V2[] {
  const A: V2 = [P[0] + ux * trim, P[1] + uz * trim];
  const B: V2 = [P[0] + vx * trim, P[1] + vz * trim];
  const arc = (Math.hypot(B[0] - A[0], B[1] - A[1]) + 2 * trim) / 2;
  const m = Math.max(2, Math.ceil(arc / spacing));
  const out: V2[] = [];
  for (let k = 0; k <= m; k++) {
    const t = k / m;
    const a = (1 - t) * (1 - t);
    const b = 2 * (1 - t) * t;
    const c = t * t;
    out.push([a * A[0] + b * P[0] + c * B[0], a * A[1] + b * P[1] + c * B[1]]);
  }
  out[0] = A;
  out[m] = B;
  return out;
}

function chordsWalkable(poly: V2[], walkable: Walkable): boolean {
  for (let k = 0; k < poly.length; k++) {
    const a = poly[k]!;
    if (!walkable(a[0], a[1])) return false;
    const b = poly[k + 1];
    if (!b) break;
    const len = dist2(a, b);
    const steps = Math.ceil(len / PROBE);
    for (let j = 1; j < steps; j++) {
      const t = j / steps;
      if (!walkable(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)) return false;
    }
  }
  return true;
}

function pushDense(out: V2[], to: V2, spacing: number): void {
  const from = out[out.length - 1]!;
  const len = dist2(from, to);
  if (len < 1e-9) return;
  const k = Math.ceil(len / spacing);
  for (let j = 1; j <= k; j++) {
    const t = j / k;
    out.push(j === k ? [to[0], to[1]] : [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t]);
  }
}

function densify(pts: V2[], spacing: number): V2[] {
  if (pts.length < 2) return pts.map((p) => [p[0], p[1]] as V2);
  const out: V2[] = [pts[0]!];
  for (let i = 1; i < pts.length; i++) pushDense(out, pts[i]!, spacing);
  return out;
}

/* ── the mover ──────────────────────────────────────────────────────────── */

export interface MoverState {
  pos: V2;
  yaw: number;
  /** Metres per second along the route. */
  speed: number;
  /** Gait phase, radians in [0, 2pi). One full turn is two steps; it advances by distance / stride. */
  phase: number;
  /** Roll into the turn, radians; it has the sign of `yawRate` (positive = into a turn toward +yaw). */
  lean: number;
  arrived: boolean;
  /** Arc length covered along the CURRENT path. Reset it (or call `initMover`) when you swap the path. */
  s: number;
  yawRate: number;
}

export interface MoverParams {
  vmax: number;
  accel: number;
  decel: number;
  /** Sideways acceleration a corner may demand (sets the corner speed limit v = sqrt(latAccel / curvature)). */
  latAccel: number;
  vMinCorner: number;
  maxTurnRate: number;
  /** 1/s: how fast the yaw RATE follows its target (bounds the yaw jerk). */
  turnResponse: number;
  /** Person height, metres: sets the stride. */
  height: number;
  /** Step length as a fraction of height (0.42 is the adult mean). */
  strideRatio: number;
  leanGain: number;
  maxLean: number;
  leanResponse: number;
  /** Look this far ahead for the heading to steer to, plus 0.15 s of travel. */
  lookahead: number;
  /** Heading error below which the walker may use full speed, and above which it must stand and turn. */
  alignFull: number;
  alignNone: number;
}

export const WALK_PARAMS: MoverParams = {
  vmax: 1.35,
  accel: 2.2,
  decel: 2.6,
  latAccel: 2.4,
  vMinCorner: 0.45,
  maxTurnRate: 6,
  turnResponse: 16,
  height: 1.75,
  strideRatio: 0.42,
  leanGain: 0.1,
  maxLean: 0.2,
  leanResponse: 10,
  lookahead: 0.3,
  alignFull: 0.5,
  alignNone: 1.4,
};

/** Defaults plus overrides; `pacing` is the slow walk (0.8 m/s). */
export function walkParams(over: Partial<MoverParams> = {}): MoverParams {
  return { ...WALK_PARAMS, ...over };
}

/** Length of one STEP (foot plant to the opposite foot's plant), metres. */
export const strideOf = (height: number, ratio = WALK_PARAMS.strideRatio): number => ratio * height;

/** Gait-phase radians per metre walked: pi per step. */
export const phasePerMetre = (height: number, ratio = WALK_PARAMS.strideRatio): number => Math.PI / strideOf(height, ratio);

export function initMover(pos: V2, yaw = 0): MoverState {
  return { pos: [pos[0], pos[1]], yaw, speed: 0, phase: 0, lean: 0, arrived: false, s: 0, yawRate: 0 };
}

/** Seconds a walk of `length` metres takes with this mover, from the profile alone (ramp up, cruise, ramp down). */
export function estimateWalkSeconds(length: number, p: MoverParams = WALK_PARAMS): number {
  const ramp = (p.vmax * p.vmax) / (2 * p.accel) + (p.vmax * p.vmax) / (2 * p.decel);
  if (length >= ramp) return (length - ramp) / p.vmax + p.vmax / p.accel + p.vmax / p.decel;
  const peak = Math.sqrt((2 * length) / (1 / p.accel + 1 / p.decel));
  return peak / p.accel + peak / p.decel;
}

export function pathLength(path: V2[]): number {
  let l = 0;
  for (let i = 1; i < path.length; i++) l += dist2(path[i - 1]!, path[i]!);
  return l;
}

interface Prep {
  first: V2 | undefined;
  last: V2 | undefined;
  n: number;
  cum: number[];
  total: number;
  heading: number[];
  kappa: number[];
}
const prepCache = new WeakMap<V2[], Prep>();

function prep(path: V2[]): Prep {
  const hit = prepCache.get(path);
  if (hit && hit.n === path.length && hit.first === path[0] && hit.last === path[path.length - 1]) return hit;
  const n = path.length;
  const cum = [0];
  const heading: number[] = [];
  for (let i = 1; i < n; i++) {
    const a = path[i - 1]!;
    const b = path[i]!;
    cum.push(cum[i - 1]! + dist2(a, b));
    heading.push(Math.atan2(b[0] - a[0], b[1] - a[1]));
  }
  const kappa = new Array<number>(n).fill(0);
  for (let i = 1; i < n - 1; i++) {
    const turn = Math.abs(wrapPi(heading[i]! - heading[i - 1]!));
    const ds = Math.min((cum[i + 1]! - cum[i - 1]!) / 2, 0.2);
    kappa[i] = ds > 1e-9 ? turn / ds : 0;
  }
  const smoothed = kappa.map((k, i) => Math.max(k, kappa[i - 1] ?? 0, kappa[i + 1] ?? 0));
  const p: Prep = { first: path[0], last: path[n - 1], n, cum, total: cum[n - 1] ?? 0, heading, kappa: smoothed };
  prepCache.set(path, p);
  return p;
}

/** Index of the segment containing arc length s (0 .. n-2). */
function segAt(P: Prep, s: number): number {
  let lo = 0;
  let hi = P.n - 2;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (P.cum[mid]! <= s) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

function pointAt(path: V2[], P: Prep, s: number): V2 {
  if (s >= P.total) return [path[P.n - 1]![0], path[P.n - 1]![1]];
  const i = segAt(P, Math.max(0, s));
  const a = path[i]!;
  const b = path[i + 1]!;
  const len = P.cum[i + 1]! - P.cum[i]!;
  const t = len > 1e-12 ? (s - P.cum[i]!) / len : 0;
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

/**
 * Advance `state` by `dt` seconds along `path` (the dense polyline from `smoothPath`; `path[0]` is where the
 * walker stands; do not mutate the array while it is in use). Returns a new state. Frames longer than 1/30 s
 * are split, so a stalled tab does not teleport anybody or break the limits.
 */
export function stepMover(state: MoverState, path: V2[], dt: number, params: MoverParams = WALK_PARAMS): MoverState {
  if (!(dt > 0)) return state;
  let cur = state;
  const n = Math.max(1, Math.ceil(dt / (1 / 30)));
  const h = dt / n;
  for (let k = 0; k < n; k++) cur = substep(cur, path, h, params);
  return cur;
}

function substep(st: MoverState, path: V2[], h: number, p: MoverParams): MoverState {
  if (path.length === 0) return { ...st, speed: 0, arrived: true, lean: st.lean * Math.exp(-p.leanResponse * h) };
  if (path.length === 1) {
    const only = path[0]!;
    return { ...st, pos: [only[0], only[1]], speed: 0, arrived: true, s: 0 };
  }
  const P = prep(path);
  const total = P.total;
  let { s, speed, yaw, yawRate, lean, phase } = st;
  s = clamp(s, 0, total);
  const rem = total - s;
  // Nothing (or next to nothing) left to walk: stand exactly on the end.
  const done = rem <= 1e-6 || (speed === 0 && rem < 2e-3);
  if (done) s = total;

  // The heading to steer to: the route a little ahead of where we are.
  const ahead = Math.min(total - 1e-9, s + p.lookahead + 0.15 * speed);
  const want = P.heading[segAt(P, Math.max(0, ahead))]!;
  const err = wrapPi(want - yaw);

  let dist = 0;
  if (!done) {
    // Speed ceiling: don't outrun your heading, don't take a corner faster than lateral acceleration allows,
    // and be able to stop at the end.
    const align = clamp((p.alignNone - Math.abs(err)) / (p.alignNone - p.alignFull), 0, 1);
    let vLim = p.vmax * align;
    const bPlan = 0.8 * p.decel;
    const horizon = (speed * speed) / (2 * bPlan) + 0.6;
    for (let i = segAt(P, s); i < P.n - 1; i++) {
      const ds = Math.max(0, P.cum[i]! - s);
      if (ds > horizon) break;
      const vc = Math.max(p.vMinCorner, Math.sqrt(p.latAccel / Math.max(P.kappa[i]!, 1e-9)));
      vLim = Math.min(vLim, Math.sqrt(vc * vc + 2 * bPlan * ds));
    }
    // A path swapped mid-walk may leave us too fast to stop; shed the excess at once rather than overrun.
    speed = Math.min(speed, Math.sqrt(2 * p.decel * 1.5 * rem));
    const aStop = (speed * speed) / (2 * rem);
    let a: number;
    if (speed > 1e-9 && aStop >= bPlan * 0.999) a = -aStop;
    else if (speed > vLim) a = -Math.min(p.decel, (speed - vLim) / h);
    else a = Math.min(p.accel, (vLim - speed) / h);
    if (a < 0 && speed + a * h <= 0) {
      dist = (speed * speed) / (2 * -a);
      speed = 0;
    } else {
      const v2 = speed + a * h;
      dist = ((speed + v2) / 2) * h;
      speed = v2;
    }
    s = Math.min(total, s + dist);
    if (total - s <= 1e-6 && speed < 1e-6) {
      s = total;
      speed = 0;
    }
  } else speed = 0;

  // Heading: rate-limited, and the rate itself is smoothed (bounded jerk).
  const desired = clamp(err * 8, -p.maxTurnRate, p.maxTurnRate);
  yawRate += (desired - yawRate) * (1 - Math.exp(-p.turnResponse * h));
  yaw = wrapPi(yaw + yawRate * h);
  const leanTarget = clamp(p.leanGain * speed * yawRate, -p.maxLean, p.maxLean);
  lean += (leanTarget - lean) * (1 - Math.exp(-p.leanResponse * h));
  phase = (phase + (Math.PI * dist) / strideOf(p.height, p.strideRatio)) % TAU;
  const arrived = s >= total - 1e-9 && speed === 0;
  return { pos: pointAt(path, P, s), yaw, speed, phase, lean, arrived, s, yawRate };
}
