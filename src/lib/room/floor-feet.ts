/**
 * Where the feet are while someone walks (plan item M2). Presentation only: it never places, sizes or
 * refuses a trade.
 *
 * Today's walk swings the hips on a sine (`hip = 0.55 sin(phase)`, `knee = 0.15 + 0.75 max(0, cos)`), so
 * nothing is ever planted: the feet skate. This module plans the feet from the gait phase so that a foot
 * that is on the ground stays EXACTLY where it landed while the body passes over it:
 *
 *   - the gait phase is the one `floor-locomotion` produces (it advances by distance / stride, pi per step;
 *     2 pi is a full cycle of two steps; the LEFT foot strikes at phase 0 and the RIGHT at pi), so the
 *     body-frame position of a stance ankle is linear in phase with slope -stride/pi and cancels the walk;
 *   - the heel strikes toes-up, the foot rolls flat, the heel lifts and the foot leaves from the toe; the
 *     shoe pivots on the corner that is on the ground, so the ankle rises and moves as a rigid shoe would;
 *   - the swinging foot leaves and lands with the velocity the ground has, so it does not skid at touchdown
 *     (it reaches a little past its landing spot and claws back, as a real walker's does);
 *   - the pelvis drops just enough that neither leg is ever asked to reach further than it is long
 *     (`hipDrop`, smoothed so it does not stamp), and `legAngles` is the analytic two-bone solution in the
 *     avatar's own joint convention;
 *   - `REST_PHASE` is the phase where the feet are side by side. `floor-locomotion` starts every walk on it and
 *     ends every walk on it, so a person sets off by lifting one foot and arrives with the feet together.
 *
 * Plain numbers and arrays, no `three`, no clock: pass the phase in. Axes are the avatar's own, in its
 * local frame: x to its left, y up, z forward. Joint rotations are about local x; positive swings the
 * limb BACKWARD (a leg hanging along -y rotated by +a points to -z), exactly as `poseFor` uses them.
 */

export type V2 = [number, number];
export type V3 = [number, number, number];
export type Side = "L" | "R";

const TAU = Math.PI * 2;
const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
const smooth = (t: number) => {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
};
/** Minimum-jerk blend: zero velocity and acceleration at both ends. */
const minJerk = (t: number) => {
  const x = clamp(t, 0, 1);
  return x * x * x * (10 - 15 * x + 6 * x * x);
};

/** The avatar's shoe (a 0.11 x 0.07 x 0.25 box centred 0.05 ahead of the ankle): metres from the ankle. */
export const SHOE = { back: 0.075, front: 0.175, half: 0.035 } as const;
/** Height of the ankle above the ground with the shoe flat. */
export const SOLE = SHOE.half;

/** Fraction of the cycle a foot is on the ground. Both feet are down for the overlap (0.1 of the cycle at 0.6). */
export const DUTY = 0.6;
/** Share of stance spent rolling off the heel (toes coming down) and rolling onto the toes. */
const HEEL_ROLL = 0.16;
const TOE_ROLL_AT = 0.62;
/** Shoe pitch (about x, positive = toes DOWN) at heel strike and at toe-off. */
const PITCH_STRIKE = -0.35;
const PITCH_TOE_OFF = 0.6;
/** Shifts the whole stance range forward (fraction of the step); trades heel-strike reach against toe-off reach. */
const STANCE_SHIFT = -0.08;
/** The leg is planned a hair short of straight so the knee never locks and the IK stays well-conditioned. */
const SLACK = 0.003;

export interface FootState {
  state: "stance" | "swing";
  /** 0..1 progress through the stance or the swing. */
  u: number;
  /** Clearance of the swinging foot above its path along the ground, metres (0 in stance). */
  lift: number;
  /** [lateral, forward]: where the foot is planted (stance), or where it is now (swing), from its own hip. */
  planted: V2;
  /** The ankle in hip-local coordinates (x lateral, y up so negative below the hip, z forward), pelvis dropped by `hipDrop`. */
  ankle: V3;
  /** Shoe pitch in the avatar's convention: rotation about x, positive = toes down, 0 = flat. */
  pitch: number;
}

export interface Footstep {
  side: Side;
  /** The phase at which the heel lands (unwrapped: a multiple of 2 pi for the left foot, plus pi for the right). */
  atPhase: number;
}

export interface FootPlan {
  left: FootState;
  right: FootState;
  /** How far to lower the pelvis from its standing height (hip height = legLen + SOLE - hipDrop), metres, >= 0. */
  hipDrop: number;
  /** True when speed is too low to step: both feet flat under the hips (the caller crossfades into it). */
  standing: boolean;
  /** Heel strikes in (prevPhase, phase], when `prevPhase` is given. */
  footsteps: Footstep[];
}

interface Ankle {
  z: number;
  y: number;
  pitch: number;
}

const rot = (y: number, z: number, p: number): [number, number] => [y * Math.cos(p) - z * Math.sin(p), y * Math.sin(p) + z * Math.cos(p)];

/** The ankle during stance, x in [0,1] through it; z in the body frame (the walk's own motion is already removed). */
function stanceAnkle(x: number, stride: number): Ankle {
  const theta = x * DUTY;
  // Flat-foot reference: the ankle slides back 2 strides per cycle while the body passes over a planted foot.
  const zFlat = stride * (DUTY + STANCE_SHIFT - 2 * theta);
  if (x < HEEL_ROLL) {
    const p = PITCH_STRIKE * (1 - smooth(x / HEEL_ROLL));
    // Pivot on the heel corner, which stays where the flat shoe's heel would be.
    const [dy, dz] = rot(SOLE, SHOE.back, p);
    return { z: zFlat - SHOE.back + dz, y: dy, pitch: p };
  }
  if (x > TOE_ROLL_AT) {
    const p = PITCH_TOE_OFF * smooth((x - TOE_ROLL_AT) / (1 - TOE_ROLL_AT));
    const [dy, dz] = rot(SOLE, -SHOE.front, p);
    return { z: zFlat + SHOE.front + dz, y: dy, pitch: p };
  }
  return { z: zFlat, y: SOLE, pitch: 0 };
}

/** One foot at its own cycle fraction theta in [0,1). */
function footAt(theta: number, speed: number, stride: number): { a: Ankle; state: "stance" | "swing"; u: number; lift: number } {
  if (theta < DUTY) {
    const x = theta / DUTY;
    return { a: stanceAnkle(x, stride), state: "stance", u: x, lift: 0 };
  }
  const u = (theta - DUTY) / (1 - DUTY);
  const from = stanceAnkle(1, stride);
  const to = stanceAnkle(0, stride);
  const k = minJerk(u);
  // Forward travel is a cubic Hermite curve whose end velocities are the stance foot's own (the body-frame
  // velocity of a planted foot is -2 strides per cycle), so the foot leaves and lands moving exactly as the
  // ground does: it neither skids at touchdown nor jerks at toe-off. The cost is the swing-leg retraction a
  // real walker has: the foot reaches a little past its landing spot, then claws back.
  const m = -2 * stride * (1 - DUTY);
  const u2 = u * u;
  const u3 = u2 * u;
  const zSwing = from.z * (2 * u3 - 3 * u2 + 1) + m * (u3 - 2 * u2 + u) + to.z * (-2 * u3 + 3 * u2) + m * (u3 - u2);
  const clear = 0.035 + 0.045 * clamp(speed / 1.35, 0, 1);
  const lift = clear * Math.sin(Math.PI * u);
  return {
    a: { z: zSwing, y: from.y + (to.y - from.y) * k + lift, pitch: from.pitch + (to.pitch - from.pitch) * smooth(u) },
    state: "swing",
    u,
    lift,
  };
}

/**
 * The gait phase at which the feet are side by side: the left foot flat in mid-stance, the right passing it
 * (and, half a cycle later, the mirror image). A walk that starts and ends on this phase starts by lifting
 * one foot and ends with the feet together, instead of snapping a foot a step's length in either direction.
 * Solved once at the nominal step (0.735 m); the shoe geometry is not scaled with height, so for other
 * bodies the feet are side by side to within a centimetre or so.
 */
export const REST_PHASE: number = (() => {
  const stride = 0.735;
  const gap = (th: number) => footAt(th, 1.35, stride).a.z - footAt((th + 0.5) % 1, 1.35, stride).a.z;
  let lo = 0.2;
  let hi = 0.45;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (gap(lo) * gap(mid) <= 0) hi = mid;
    else lo = mid;
  }
  return ((lo + hi) / 2) * TAU;
})();

/**
 * How high the hip may be at cycle fraction `theta` (left foot) without overextending either leg, smoothed.
 * The raw limit is the lower of the two legs' (ankle height + sqrt(reach^2 - forward^2)); it dips sharply as the
 * landing foot reaches out. Taking the lowest limit within +-0.05 of a cycle and then averaging that over the
 * same window gives a curve that dips earlier and rises later but is never above the raw limit (every term
 * of the average is at or below it), so no leg is overextended and the pelvis does not stamp into each step.
 */
function hipHeight(theta: number, speed: number, stride: number, reach: number): number {
  const standH = reach + SOLE;
  const raw = (t: number): number => {
    const l = footAt(((t % 1) + 1) % 1, speed, stride).a;
    const r = footAt((((t + 0.5) % 1) + 1) % 1, speed, stride).a;
    const cap = (f: Ankle) => f.y + Math.sqrt(Math.max(1e-6, reach * reach - f.z * f.z));
    return Math.min(standH, cap(l), cap(r));
  };
  const W = 0.05;
  const N = 4;
  let sum = 0;
  for (let i = -N; i <= N; i++) {
    let low = Infinity;
    for (let j = -N; j <= N; j++) low = Math.min(low, raw(theta + ((i + j) * W) / N));
    sum += low;
  }
  return sum / (2 * N + 1);
}

/**
 * The feet for gait `phase` (radians; 2 pi per cycle, left heel strike at 0, right at pi).
 *
 * @param speed    walking speed, m/s (scales the swing clearance and decides `standing`)
 * @param strideLen length of one step, metres (`floor-locomotion`'s `strideOf(height)`); the SAME value that
 *                 advances the phase, or the stance foot will slide
 * @param legLen   hip-to-ankle length with the leg straight (thigh + shin), metres
 * @param prevPhase last frame's phase: when given, `footsteps` lists the heel strikes since
 */
export function footPlan(phase: number, speed: number, strideLen: number, legLen: number, prevPhase?: number): FootPlan {
  const footsteps = prevPhase === undefined ? [] : footstepsBetween(prevPhase, phase);
  if (speed < 0.05) {
    const flat = (): FootState => ({ state: "stance", u: 0, lift: 0, planted: [0, 0], ankle: [0, -(legLen - SLACK), 0], pitch: 0 });
    return { left: flat(), right: flat(), hipDrop: SLACK, standing: true, footsteps };
  }
  const cyc = ((phase % TAU) + TAU) % TAU;
  const thetaL = cyc / TAU;
  const thetaR = (thetaL + 0.5) % 1;
  const fl = footAt(thetaL, speed, strideLen);
  const fr = footAt(thetaR, speed, strideLen);
  const reach = legLen - SLACK;
  const hipH = hipHeight(thetaL, speed, strideLen, reach);
  const make = (f: ReturnType<typeof footAt>): FootState => ({
    state: f.state,
    u: f.u,
    lift: f.lift,
    planted: [0, f.a.z],
    ankle: [0, f.a.y - hipH, f.a.z],
    pitch: f.a.pitch,
  });
  return { left: make(fl), right: make(fr), hipDrop: legLen + SOLE - hipH, standing: false, footsteps };
}

/**
 * Heel strikes in (prev, next]: the left at every 2 pi, the right at every 2 pi + pi. Phases may be wrapped
 * (the mover keeps them in [0, 2 pi)); the step is read as forward progress of less than a half cycle, so
 * call it once per frame. A backward step yields none.
 */
export function footstepsBetween(prev: number, next: number): Footstep[] {
  const d = (((next - prev) % TAU) + TAU) % TAU;
  if (d === 0 || d > Math.PI) return [];
  const pc = ((prev % TAU) + TAU) % TAU;
  const base = prev - pc;
  const out: Footstep[] = [];
  for (let k = Math.floor(pc / Math.PI) + 1; k * Math.PI <= pc + d + 1e-12; k++) out.push({ side: k % 2 === 0 ? "L" : "R", atPhase: base + k * Math.PI });
  return out;
}

/** The ankle rotation that gives the shoe the planned world pitch: total foot pitch = hip + knee + ankle. */
export const ankleFor = (hip: number, knee: number, pitch: number): number => pitch - hip - knee;

/* ── the leg ────────────────────────────────────────────────────────────── */

export interface LegAngles {
  /** Rotation about x of the thigh group (positive = thigh BACK; a forward thigh is negative). */
  hip: number;
  /** Rotation about x of the shin group relative to the thigh (positive = knee bends, shin goes back). */
  knee: number;
  /** False when the target was beyond the leg's length (or inside its fold) and has been clamped to it. */
  reach: boolean;
  /** The part of the target the leg cannot move toward: its lateral x (the rig hinges only about x). */
  lateral: number;
}

/**
 * Two-bone solution for the avatar's leg: hip and knee both hinge about local x, the leg hangs along -y.
 * `hipLocalTarget` is the ankle in hip-local coordinates (x ignored, y up, z forward); `thigh` and `shin` are
 * the hip-to-knee and knee-to-ankle lengths. The knee only flexes (knee >= 0): of the two ways to fold the
 * leg, the knee goes forward.
 */
export function legAngles(hipLocalTarget: V3, thigh: number, shin: number): LegAngles {
  const ty = hipLocalTarget[1];
  const tz = hipLocalTarget[2];
  let d = Math.hypot(ty, tz);
  const lo = Math.abs(thigh - shin) + 1e-6;
  const hi = thigh + shin;
  let reach = true;
  if (d > hi) {
    d = hi;
    reach = false;
  } else if (d < lo) {
    d = lo;
    reach = false;
  }
  // Angle of the hip-to-ankle line, in the same convention as the joints: direction = (-cos a, -sin a) in (y, z).
  const psi = d > 1e-9 && Math.hypot(ty, tz) > 1e-9 ? Math.atan2(-tz, -ty) : 0;
  const cosKnee = clamp((thigh * thigh + shin * shin - d * d) / (2 * thigh * shin), -1, 1);
  const interior = Math.acos(cosKnee);
  const cosHipTri = clamp((thigh * thigh + d * d - shin * shin) / (2 * thigh * d), -1, 1);
  const hipTri = Math.acos(cosHipTri);
  return { hip: psi - hipTri, knee: Math.PI - interior, reach, lateral: hipLocalTarget[0] };
}

/** Forward kinematics of the same leg: the ankle in hip-local (y, z) for the given joint angles. */
export function legAnkle(hip: number, knee: number, thigh: number, shin: number): V2 {
  return [-thigh * Math.cos(hip) - shin * Math.cos(hip + knee), -thigh * Math.sin(hip) - shin * Math.sin(hip + knee)];
}

/**
 * Arm swing that goes with the feet: each arm opposes its own leg. Returns shoulder rotations about x
 * (positive = arm back), so the left arm is back when the left foot is forward (heel strike, phase 0).
 */
export function armSwing(phase: number, speed: number, amplitude = 0.4): { L: number; R: number } {
  const a = amplitude * clamp(speed / 1.35, 0, 1) * Math.cos(phase);
  return { L: a, R: -a };
}

/* ── measuring slide ────────────────────────────────────────────────────── */

export interface SlideSample {
  /** World position of the part of the shoe that is meant to be planted, [x, z]. */
  pos: V2;
  /** Whether it is on the ground in this sample. */
  stance: boolean;
}

/**
 * How far a foot slides while it is down: the path length of `pos` over each run of consecutive stance
 * samples. `worstPlant` is the biggest single plant, `total` the sum over the whole sequence.
 */
export function footSlide(samples: SlideSample[]): { total: number; worstPlant: number; plants: number } {
  let total = 0;
  let worst = 0;
  let run = 0;
  let plants = 0;
  let prev: SlideSample | null = null;
  for (const s of samples) {
    if (s.stance) {
      if (prev && prev.stance) {
        const d = Math.hypot(s.pos[0] - prev.pos[0], s.pos[1] - prev.pos[1]);
        run += d;
        total += d;
      } else {
        plants++;
        run = 0;
      }
      worst = Math.max(worst, run);
    }
    prev = s;
  }
  return { total, worstPlant: worst, plants };
}
