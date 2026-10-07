/**
 * M5 — arm IK. The fingertip lands on the target in the REAL three.js rig (an Object3D hierarchy built like
 * Avatar's armSide), not in this module's own arithmetic.
 *   npx tsx scripts/verify-floor-ik.mjs
 */
import * as THREE from "three";
const K = await import("../src/lib/room/floor-ik.ts");

let fail = 0;
let pass = 0;
const check = (name, ok, detail = "") => {
  if (ok) pass++;
  else fail++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : ` — ${detail}`}`);
};

const { upper, fore } = K.armLengths(1.75);
/** Avatar's arm: shoulder group, elbow group at -upper, hand at -fore below the elbow. Returns the hand relative to the shoulder. */
function rigHand(a) {
  const spine = new THREE.Group();
  const sh = new THREE.Group();
  const el = new THREE.Group();
  const hand = new THREE.Object3D();
  sh.position.set(0.215, 0.43, 0);
  el.position.y = -upper;
  hand.position.y = -fore;
  spine.add(sh);
  sh.add(el);
  el.add(hand);
  sh.rotation.set(a.sx, a.sy, a.sz);
  el.rotation.x = a.el;
  spine.updateMatrixWorld(true);
  const p = hand.getWorldPosition(new THREE.Vector3());
  return [p.x - 0.215, p.y - 0.43, p.z];
}

// The module's own forward kinematics agrees with the engine's.
{
  let worst = 0;
  for (let i = 0; i < 200; i++) {
    const a = { sx: Math.sin(i * 1.7) * 3, sy: Math.sin(i * 2.3) * 1.5, sz: Math.sin(i * 0.9) * 3, el: -Math.abs(Math.sin(i * 1.1)) * 2.6 };
    const h = rigHand(a);
    const m = K.armHand(a, upper, fore);
    worst = Math.max(worst, Math.hypot(h[0] - m[0], h[1] - m[1], h[2] - m[2]));
  }
  check(`armHand matches three.js Object3D forward kinematics on 200 random poses (worst ${worst.toExponential(1)} m)`, worst < 1e-9);
}

// A 200-target grid (100 directions x 2 radii), both arms.
const targets = [];
for (let i = 0; i < 100; i++) {
  const y = 1 - (2 * (i + 0.5)) / 100;
  const r = Math.sqrt(1 - y * y);
  const th = i * 2.399963;
  for (const rad of [0.25, 0.45]) targets.push([r * Math.cos(th) * rad, y * rad, r * Math.sin(th) * rad]);
}
const miss = (solve) => {
  let worst = 0;
  let bad = 0;
  for (const side of [1, -1]) {
    for (const t of targets) {
      const a = solve(t, side);
      const h = rigHand(a);
      const e = Math.hypot(h[0] - t[0], h[1] - t[1], h[2] - t[2]);
      worst = Math.max(worst, e);
      if (!(e < 0.03)) bad++;
    }
  }
  return { worst, bad };
};
const good = (t, side) => K.armAngles(t, upper, fore, side);
{
  const r = miss(good);
  check(`fingertip within 3 cm on 200 targets x 2 arms in the three.js rig (worst ${(r.worst * 1000).toFixed(4)} mm)`, r.bad === 0 && r.worst < 0.03, `${r.bad} misses`);
  check("every grid target reports reach = true", targets.every((t) => good(t, 1).reach && good(t, -1).reach));
  check("the elbow only bends forward (0 .. -2.6)", targets.every((t) => { const e = good(t, 1).el; return e <= 0 && e >= -2.6 - 1e-12; }));
}

// Out of range: clamped to the arm's reach, toward the target, never NaN.
{
  const far = [[0.1, 0.2, 0.9], [-2, 0.5, 0.3], [0, 3, 0]];
  const ok = far.every((t) => {
    const a = K.armAngles(t, upper, fore, 1);
    const h = rigHand(a);
    const n = Math.hypot(...t);
    return !a.reach && Number.isFinite(a.sx + a.sy + a.sz + a.el) && Math.abs(Math.hypot(...h) - (upper + fore)) < 1e-9 && Math.hypot(h[0] / (upper + fore) - t[0] / n, h[1] / (upper + fore) - t[1] / n, h[2] / (upper + fore) - t[2] / n) < 1e-9;
  });
  check("beyond reach: full stretch toward the target, reach = false, finite", ok);
  const near = K.armAngles([0.01, 0, 0], upper, fore, 1);
  const zero = K.armAngles([0, 0, 0], upper, fore, -1);
  const nan = K.armAngles([NaN, 0, 0], upper, fore, 1);
  check("inside the fold, at the shoulder itself, and NaN: finite and reach = false", [near, zero, nan].every((a) => !a.reach && Number.isFinite(a.sx + a.sy + a.sz + a.el)));
}

// The avatar's own poses (poseFor): the IK reaches the same hand position.
{
  const poses = { POINTING_R: [-1.55, 0, -0.05, -0.05], WRITING_R: [-1.95, 0, -0.18, -0.35], CHEER_L: [-2.75, 0, 0.45, -0.25], FACEPALM_R: [-1.75, 0.35, -0.45, -2.25], TABLET_L: [-0.5, -0.3, 0.1, -1.3], THUMBS_R: [-1.2, 0, -0.1, -1.25] };
  let worst = 0;
  for (const [k, [sx, sy, sz, el]] of Object.entries(poses)) {
    const side = k.endsWith("_L") ? 1 : -1;
    const t = rigHand({ sx, sy, sz, el });
    const a = K.armAngles(t, upper, fore, side);
    const h = rigHand(a);
    worst = Math.max(worst, Math.hypot(h[0] - t[0], h[1] - t[1], h[2] - t[2]));
  }
  check(`it reaches the hand position of six of poseFor's own arm poses (worst ${(worst * 1000).toFixed(4)} mm)`, worst < 1e-3);
  const p = K.armAngles(rigHand({ sx: -1.55, sy: 0, sz: -0.05, el: -0.05 }), upper, fore, -1);
  check(`a straight arm held forward is shoulder x ${p.sx.toFixed(2)} (the avatar writes -1.55)`, Math.abs(p.sx + 1.55) < 0.1);
}

// Mirror symmetry and the elbow's side.
{
  const t = [0.2, 0.15, 0.3];
  const l = K.armAngles(t, upper, fore, 1);
  const r = K.armAngles([-t[0], t[1], t[2]], upper, fore, -1);
  check("the right arm mirrors the left (sx, el equal; sy, sz negated)", Math.abs(l.sx - r.sx) < 1e-9 && Math.abs(l.el - r.el) < 1e-9 && Math.abs(l.sy + r.sy) < 1e-9 && Math.abs(l.sz + r.sz) < 1e-9);
  const fwd = K.armAngles([0, 0, 0.4], upper, fore, 1);
  const e = K.armElbow(fwd, upper);
  check(`reaching straight ahead the elbow hangs below the line and a little outward (y ${e[1].toFixed(2)}, x ${e[0].toFixed(2)})`, e[1] < -0.1 && e[0] > 0);
  // A pole above puts the elbow up.
  const up = K.armElbow(K.armAngles([0, 0, 0.4], upper, fore, 1, { pole: [0, 1, 0] }), upper);
  check("a pole vector above lifts the elbow", up[1] > 0.05);
}

// Smoothness with `near`: sweep the hand through the overhead region and watch the angles.
{
  let prev = null;
  let jump = 0;
  for (let i = 0; i <= 360; i++) {
    const a = (i / 360) * Math.PI * 2;
    const t = [0.12 * Math.sin(a), 0.4 * Math.cos(a), 0.15 + 0.1 * Math.sin(2 * a)];
    const s = K.armAngles(t, upper, fore, 1, prev ? { near: prev } : {});
    if (prev) jump = Math.max(jump, Math.abs(s.sx - prev.sx), Math.abs(s.sy - prev.sy), Math.abs(s.sz - prev.sz));
    prev = s;
  }
  check(`with near, a hand sweeping overhead moves the angles without a 2 pi spin (largest step ${jump.toFixed(2)} rad per degree)`, jump < 0.6, `${jump}`);
}

// NEGATIVE CONTROLS: three ways of pointing the wrong way, each must fail the grid check.
console.log("  negative controls");
{
  const flip = miss((t, s) => { const a = good(t, s); return { ...a, sx: -a.sx }; });
  check(`shoulder x negated: ${flip.bad} of ${targets.length * 2} targets miss by 3 cm or more`, flip.bad > targets.length);
  const wrongSide = miss((t, s) => { const a = good(t, s); return { ...a, sy: -a.sy, sz: -a.sz }; });
  check(`mirrored shoulder y,z without mirroring the target: ${wrongSide.bad} misses`, wrongSide.bad > targets.length / 2);
  const back = miss((t, s) => { const a = good(t, s); return { ...a, el: -a.el }; });
  check(`elbow bending backward: ${back.bad} misses`, back.bad > targets.length / 2);
}

console.log(`\nik: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
