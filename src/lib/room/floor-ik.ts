/**
 * Analytic two-bone reach for the avatar's arm (plan item M5). Presentation only: it never places, sizes or
 * refuses a trade.
 *
 * The rig, from `Avatar` in floor-scene.ts: a shoulder group hangs the upper arm along -y and carries the
 * elbow group `upper` below its origin; the elbow group rotates about local x only and carries the hand
 * `fore` below ITS origin (the hand is a sphere centred there). The shoulder group is rotated with
 * three.js's default Euler order, XYZ, i.e. R = Rx(sx) . Ry(sy) . Rz(sz). The elbow only flexes FORWARD:
 * elbow = -a turns the forearm toward +z in the upper arm's frame (a negative elbow is a bent arm), exactly
 * as `poseFor` writes it (POINTING has elbow -0.05, FACEPALM -2.25).
 *
 * `armAngles` inverts that: give it where the hand should be (relative to the shoulder joint, in the frame
 * the shoulder group lives in -- the spine's) and it returns the three shoulder angles and the elbow. The law
 * of cosines fixes the elbow; the elbow's SWIVEL around the shoulder-to-hand line is the one free choice, and
 * it is made by a pole vector (default: down and a little outward and back) so the elbow hangs like a person's.
 *
 * Plain numbers and arrays, no `three`, no clock. Axes are the avatar's own: x to its left, y up, z forward;
 * `side` 1 is the left arm (shoulder at +x), -1 the right.
 */

export type V3 = [number, number, number];

export interface ArmAngles {
  /** Shoulder group rotation, three.js Euler XYZ, radians. */
  sx: number;
  sy: number;
  sz: number;
  /** Elbow group rotation about x, radians, in [-elMax, 0]. */
  el: number;
  /** False when the target was out of the arm's range and the hand has been placed at the nearest point it can reach. */
  reach: boolean;
}

export interface ArmOpts {
  /**
   * Direction the elbow should point, shoulder-frame. Default (0.3 side, -1, -0.2): down, a little outward and
   * back. Only its component perpendicular to the shoulder-to-hand line matters.
   */
  pole?: V3;
  /**
   * The shoulder angles the arm has now. An Euler rotation has two spellings and any angle can be shifted by
   * 2 pi; with this the one closest to it is returned, so a hand moving smoothly gives angles that move smoothly
   * (the avatar eases each angle on its own, and a 6.28 jump would spin the arm).
   */
  near?: { sx: number; sy: number; sz: number };
  /** Largest elbow bend, radians. Default 2.6 (the arm folds to about 0.15 m reach). */
  elMax?: number;
}

/** Joint-to-joint arm lengths per unit of `height / 1.75`: shoulder-to-elbow and elbow-to-hand-centre. */
export const ARM_PER_S = { upper: 0.29, fore: 0.27 } as const;
/** The shoulder joint in the spine frame per unit of `height / 1.75` (x also scales with the build). */
export const SHOULDER_PER_S = { x: 0.215, y: 0.43 } as const;

/** `{ upper, fore }` for a person of this height. */
export const armLengths = (height: number): { upper: number; fore: number } => ({ upper: (ARM_PER_S.upper * height) / 1.75, fore: (ARM_PER_S.fore * height) / 1.75 });

type M3 = [number, number, number, number, number, number, number, number, number]; // row-major

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: V3) => Math.hypot(a[0], a[1], a[2]);
const scale = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const unit = (a: V3): V3 | null => {
  const n = norm(a);
  return n > 1e-12 ? scale(a, 1 / n) : null;
};

/** The rotation three.js builds for Euler (x, y, z) in XYZ order (Object3D.rotation default), row-major. */
export function rotXYZ(x: number, y: number, z: number): M3 {
  const a = Math.cos(x);
  const b = Math.sin(x);
  const c = Math.cos(y);
  const d = Math.sin(y);
  const e = Math.cos(z);
  const f = Math.sin(z);
  const ae = a * e;
  const af = a * f;
  const be = b * e;
  const bf = b * f;
  return [c * e, -c * f, d, af + be * d, ae - bf * d, -b * c, bf - ae * d, be + af * d, a * c];
}

export function applyM(m: M3, v: V3): V3 {
  return [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]];
}

/** Forward kinematics of the same arm: where the hand centre is, relative to the shoulder joint. */
export function armHand(a: { sx: number; sy: number; sz: number; el: number }, upper: number, fore: number): V3 {
  // Elbow group rotation about x applied to the forearm direction (0, -1, 0): (0, -cos el, -sin el).
  const inUpperFrame: V3 = [0, -upper - fore * Math.cos(a.el), -fore * Math.sin(a.el)];
  return applyM(rotXYZ(a.sx, a.sy, a.sz), inUpperFrame);
}

/** Where the elbow is, relative to the shoulder joint. */
export function armElbow(a: { sx: number; sy: number; sz: number }, upper: number): V3 {
  return applyM(rotXYZ(a.sx, a.sy, a.sz), [0, -upper, 0]);
}

/** three.js Euler XYZ out of a rotation matrix (principal branch: |y| <= pi/2). */
function eulerXYZ(m: M3): { x: number; y: number; z: number } {
  const y = Math.asin(clamp(m[2], -1, 1));
  if (Math.abs(m[2]) < 0.9999999) return { x: Math.atan2(-m[5], m[8]), y, z: Math.atan2(-m[1], m[0]) };
  return { x: Math.atan2(m[7], m[4]), y, z: 0 };
}

const wrapNear = (a: number, ref: number) => a - Math.round((a - ref) / (Math.PI * 2)) * Math.PI * 2;

/**
 * @param target  the hand centre relative to the shoulder joint, in the frame the shoulder group lives in
 * @param upper   shoulder-to-elbow length (`armLengths(height).upper`)
 * @param fore    elbow-to-hand-centre length (`armLengths(height).fore`)
 * @param side    1 for the left arm (shoulder at +x), -1 for the right
 */
export function armAngles(target: V3, upper: number, fore: number, side: 1 | -1, opts: ArmOpts = {}): ArmAngles {
  // Not a point at all (NaN from a missing screen): the avatar's resting arm, reported as unreached.
  if (!Number.isFinite(target[0] + target[1] + target[2])) return { sx: 0, sy: 0, sz: 0.08 * side, el: -0.12, reach: false };
  const elMax = opts.elMax ?? 2.6;
  const maxReach = upper + fore;
  const minReach = Math.sqrt(Math.max(0, upper * upper + fore * fore - 2 * upper * fore * Math.cos(Math.PI - elMax)));
  const raw = norm(target);
  let reach = true;
  let d = raw;
  if (d > maxReach) {
    d = maxReach;
    reach = false;
  } else if (d < minReach) {
    d = minReach;
    reach = false;
  }
  // A target on the shoulder itself has no direction: let the arm hang.
  const t: V3 = unit(target) ?? [0, -1, 0];

  // The elbow from the law of cosines: interior angle gamma at the elbow, flexion = pi - gamma, forward (negative).
  const cosGamma = clamp((upper * upper + fore * fore - d * d) / (2 * upper * fore), -1, 1);
  const el = -(Math.PI - Math.acos(cosGamma));

  // In the upper arm's own frame the hand and the elbow are fixed by that angle...
  const handL: V3 = [0, -upper - fore * Math.cos(el), -fore * Math.sin(el)];
  const elbowL: V3 = [0, -upper, 0];
  const hL = unit(handL) as V3;
  // ...and the elbow lies off the shoulder-hand line toward -z (a straight arm: the same direction, by continuity).
  const eL = unit(sub(elbowL, scale(hL, dot(elbowL, hL)))) ?? ([0, 0, -1] as V3);
  const wL = cross(hL, eL);

  // In the shoulder frame the swivel is chosen by the pole: the elbow goes to the pole's side of the line.
  const pole: V3 = opts.pole ?? [0.3 * side, -1, -0.2];
  const pPerp = unit(sub(pole, scale(t, dot(pole, t)))) ?? unit(sub([0, 0, -1], scale(t, dot([0, 0, -1], t)))) ?? ([1, 0, 0] as V3);
  const wW = cross(t, pPerp);

  // R maps (hL, eL, wL) onto (t, pPerp, wW): R = W . L^T with the frames as columns.
  const L: M3 = [hL[0], eL[0], wL[0], hL[1], eL[1], wL[1], hL[2], eL[2], wL[2]];
  const W: M3 = [t[0], pPerp[0], wW[0], t[1], pPerp[1], wW[1], t[2], pPerp[2], wW[2]];
  const R = mulMT(W, L);

  const e1 = eulerXYZ(R);
  // The other spelling of the same rotation: (x + pi, pi - y, z + pi).
  const e2 = { x: e1.x + Math.PI, y: Math.PI - e1.y, z: e1.z + Math.PI };
  let pick = e1;
  const near = opts.near;
  if (near) {
    const fit = (e: { x: number; y: number; z: number }) => ({ x: wrapNear(e.x, near.sx), y: wrapNear(e.y, near.sy), z: wrapNear(e.z, near.sz) });
    const a = fit(e1);
    const b = fit(e2);
    const cost = (e: { x: number; y: number; z: number }) => (e.x - near.sx) ** 2 + (e.y - near.sy) ** 2 + (e.z - near.sz) ** 2;
    pick = cost(a) <= cost(b) ? a : b;
  }
  return { sx: pick.x, sy: pick.y, sz: pick.z, el, reach };
}

/** A . B^T for row-major 3x3 (B's columns are the frame vectors, so this is W . L^T). */
function mulMT(a: M3, b: M3): M3 {
  const out: number[] = [];
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      let s = 0;
      for (let k = 0; k < 3; k++) s += a[i * 3 + k]! * b[j * 3 + k]!;
      out.push(s);
    }
  }
  return out as M3;
}
