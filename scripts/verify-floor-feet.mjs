/**
 * M2 — feet. A foot that is down stays where it landed while the body passes over it, the leg angles reach
 * the planned ankle, and every heel strike is announced once.
 *   npx tsx scripts/verify-floor-feet.mjs
 *
 * The walk is driven by the REAL mover (floor-locomotion), so the phase advances exactly as it will in the
 * scene. The negative control at the bottom is the sinusoidal swing the Floor uses today, run through the
 * same measurement: it must fail the slide check, or the check cannot see skating.
 */
const F = await import("../src/lib/room/floor-feet.ts");
const L = await import("../src/lib/room/floor-locomotion.ts");

let fail = 0;
let pass = 0;
const check = (name, ok, detail = "") => {
  if (ok) pass++;
  else fail++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : ` — ${detail}`}`);
};
const rot = (y, z, p) => [y * Math.cos(p) - z * Math.sin(p), y * Math.sin(p) + z * Math.cos(p)];
const DT = 1 / 60;
const CORNERS = { heel: [-F.SOLE, -F.SHOE.back], toe: [-F.SOLE, F.SHOE.front] };

/** Walk `length` metres with the real mover and record the planned feet in the world. */
function walk(height, length, yaw = 0, path = null) {
  const s = height / 1.75;
  const thigh = 0.44 * s;
  const shin = 0.44 * s;
  const legLen = thigh + shin;
  const stride = L.strideOf(height);
  const dir = [Math.sin(yaw), Math.cos(yaw)];
  const poly = path ?? L.smoothPath([[0, 0], [dir[0] * length, dir[1] * length]], () => true);
  const P = L.walkParams({ height });
  let st = L.initMover(poly[0], path ? Math.atan2(poly[1][0] - poly[0][0], poly[1][1] - poly[0][1]) : yaw, height);
  const frames = [];
  let prevPlan = null;
  for (let i = 0; i < 6000; i++) {
    const before = st.phase;
    st = L.stepMover(st, poly, DT, P);
    const plan = F.footPlan(st.phase, st.speed, st.stride, legLen, before);
    const hipY = legLen + F.SOLE - plan.hipDrop;
    const feet = {};
    for (const [side, f, lat] of [["L", plan.left, 0.09], ["R", plan.right, -0.09]]) {
      const a = F.legAngles(f.ankle, thigh, shin);
      const [fy, fz] = F.legAnkle(a.hip, a.knee, thigh, shin);
      const cs = {};
      for (const [name, [cy, cz]] of Object.entries(CORNERS)) {
        const [dy, dz] = rot(cy, cz, f.pitch);
        const zl = f.ankle[2] + dz;
        // local (lateral, forward) -> world, yaw about +y: x' = x cos + z sin, z' = -x sin + z cos
        cs[name] = {
          h: hipY + f.ankle[1] + dy,
          pos: [st.pos[0] + lat * Math.cos(st.yaw) + zl * Math.sin(st.yaw), st.pos[1] - lat * Math.sin(st.yaw) + zl * Math.cos(st.yaw)],
        };
      }
      feet[side] = { f, a, ikErr: Math.hypot(fy - f.ankle[1], fz - f.ankle[2]), cs };
    }
    frames.push({ st, plan, hipY, feet, prevPlan });
    prevPlan = plan;
    if (st.arrived) break;
  }
  return { frames, thigh, shin, legLen, stride, poly };
}
const sequences = (run) => {
  const out = {};
  for (const side of ["L", "R"]) {
    for (const c of ["heel", "toe"]) out[side + c] = run.frames.map((fr) => ({ pos: fr.feet[side].cs[c].pos, stance: !fr.plan.standing && fr.feet[side].cs[c].h < 0.003 }));
  }
  return out;
};

/* ── a 10 m walk ────────────────────────────────────────────────────────── */
const run = walk(1.75, 10);
const moving = run.frames.filter((fr) => !fr.plan.standing);
{
  const seq = sequences(run);
  const slides = Object.values(seq).map((s) => F.footSlide(s));
  const total = slides.reduce((n, s) => n + s.total, 0);
  const worst = Math.max(...slides.map((s) => s.worstPlant));
  const heelPlants = slides[0].plants + slides[2].plants;
  check(`stance-foot slide over a 10 m walk: ${(total * 100).toFixed(3)} cm in total across both feet and both ends of the shoe`, total < 0.02, `${total}`);
  check(`…and ${(worst * 100).toFixed(3)} cm at worst in a single plant`, worst < 0.02);
  check(`…measured over ${heelPlants} heel plants (a check on nothing proves nothing)`, heelPlants >= 12 && slides.every((s) => s.plants >= 6), JSON.stringify(slides.map((s) => s.plants)));
  const noFlight = moving.every((fr) => fr.feet.L.cs.heel.h < 0.003 || fr.feet.L.cs.toe.h < 0.003 || fr.feet.R.cs.heel.h < 0.003 || fr.feet.R.cs.toe.h < 0.003);
  check("a foot is on the ground in every frame (no flight)", noFlight);
  let minH = Infinity;
  for (const fr of moving) for (const side of ["L", "R"]) for (const c of ["heel", "toe"]) minH = Math.min(minH, fr.feet[side].cs[c].h);
  check(`the shoe never goes through the floor (lowest corner ${(minH * 1000).toFixed(2)} mm)`, minH > -0.001);
  // The swinging foot actually lifts.
  let maxClear = 0;
  for (const fr of moving) for (const side of ["L", "R"]) if (fr.feet[side].f.state === "swing" && Math.abs(fr.feet[side].f.u - 0.5) < 0.05) maxClear = Math.max(maxClear, Math.min(fr.feet[side].cs.heel.h, fr.feet[side].cs.toe.h));
  check(`the swing foot clears the floor at mid-swing (${(maxClear * 100).toFixed(1)} cm)`, maxClear > 0.02);
}

/* ── the leg reaches the ankle it was given ─────────────────────────────── */
{
  const worstErr = Math.max(...moving.flatMap((fr) => [fr.feet.L.ikErr, fr.feet.R.ikErr]));
  check(`every planned ankle is reachable (${moving.length * 2} leg-frames) and the angles land within ${(worstErr * 1000).toFixed(3)} mm`, moving.every((fr) => fr.feet.L.a.reach && fr.feet.R.a.reach) && worstErr < 0.01, `${worstErr}`);
  const knee = moving.flatMap((fr) => [fr.feet.L.a.knee, fr.feet.R.a.knee]);
  check(`the knee only flexes (0 .. ${Math.max(...knee).toFixed(2)} rad) and never locks`, Math.min(...knee) >= 0 && Math.max(...knee) < 2.0);
  // A grid of targets, well inside and well outside the leg's length.
  const thigh = 0.44;
  const shin = 0.44;
  let reachable = 0;
  let worst = 0;
  let clamped = 0;
  let finite = true;
  for (let ty = -0.95; ty <= 0.2; ty += 0.025) {
    for (let tz = -0.8; tz <= 0.8; tz += 0.025) {
      const a = F.legAngles([0, ty, tz], thigh, shin);
      finite &&= Number.isFinite(a.hip) && Number.isFinite(a.knee);
      const d = Math.hypot(ty, tz);
      const [fy, fz] = F.legAnkle(a.hip, a.knee, thigh, shin);
      if (d >= 1e-3 + 1e-6 && d <= thigh + shin - 1e-6) {
        reachable++;
        worst = Math.max(worst, Math.hypot(fy - ty, fz - tz));
        if (!a.reach) worst = 99;
      } else if (d > thigh + shin) {
        clamped++;
        // At full stretch, pointing at the target.
        if (a.reach || Math.abs(Math.hypot(fy, fz) - (thigh + shin)) > 1e-6 || Math.abs(fy / (thigh + shin) - ty / d) > 1e-6) worst = 99;
      }
    }
  }
  check(`leg IK on a ${reachable}-target grid: forward kinematics within ${(worst * 1000).toFixed(4)} mm (limit 10 mm)`, worst < 0.01 && finite);
  check(`…and ${clamped} targets beyond the leg are clamped to full stretch toward them, not NaN`, clamped > 100 && finite);
  // Anchored on the avatar's own poses (poseFor): sitting is hip -1.5, knee 1.5.
  const seated = F.legAnkle(-1.5, 1.5, 0.44, 0.44);
  const back = F.legAngles([0, seated[0], seated[1]], 0.44, 0.44);
  check(`it inverts the avatar's own seated pose (hip -1.5, knee 1.5 -> ${back.hip.toFixed(3)}, ${back.knee.toFixed(3)})`, Math.abs(back.hip + 1.5) < 1e-9 && Math.abs(back.knee - 1.5) < 1e-9);
  check("a target straight below is hip 0, knee 0; a target ahead swings the thigh forward (negative)", (() => {
    const down = F.legAngles([0, -0.88, 0], 0.44, 0.44);
    const ahead = F.legAngles([0, -0.6, 0.4], 0.44, 0.44);
    return Math.abs(down.hip) < 1e-6 && Math.abs(down.knee) < 1e-3 && ahead.hip < 0 && ahead.knee > 0;
  })());
  check("a target to the side is reported, not silently dropped", F.legAngles([0.2, -0.6, 0.1], 0.44, 0.44).lateral === 0.2);
  check("ankleFor keeps the shoe at the planned pitch (hip + knee + ankle)", Math.abs(F.ankleFor(0.4, 0.7, -0.2) + 0.4 + 0.7 + 0.2) < 1e-12);
}

/* ── the pelvis and the roll ────────────────────────────────────────────── */
{
  const drops = moving.map((fr) => fr.plan.hipDrop);
  const lo = Math.min(...drops);
  const hi = Math.max(...drops);
  check(`the pelvis drops ${(lo * 100).toFixed(1)} to ${(hi * 100).toFixed(1)} cm (bob ${((hi - lo) * 100).toFixed(1)} cm), never negative`, lo >= 0 && hi - lo < 0.07);
  let maxStep = 0;
  for (let i = 1; i < moving.length; i++) maxStep = Math.max(maxStep, Math.abs(moving[i].plan.hipDrop - moving[i - 1].plan.hipDrop));
  check(`…and moves smoothly (largest frame step ${(maxStep * 1000).toFixed(1)} mm = ${(maxStep * 60).toFixed(2)} m/s; a sinusoidal bob of this size at this cadence peaks near 0.3 m/s)`, maxStep < 0.006);
  let maxAnkle = 0;
  for (let i = 1; i < moving.length; i++) for (const side of ["L", "R"]) maxAnkle = Math.max(maxAnkle, Math.hypot(...moving[i].feet[side].f.ankle.map((v, k) => v - moving[i - 1].feet[side].f.ankle[k])));
  check(`no foot teleports (largest ankle step per frame ${(maxAnkle * 100).toFixed(1)} cm)`, maxAnkle < 0.1);
  const strike = moving.filter((fr) => fr.feet.L.f.state === "stance" && fr.feet.L.f.u < 0.03).map((fr) => fr.feet.L.f.pitch);
  const off = moving.filter((fr) => fr.feet.L.f.state === "stance" && fr.feet.L.f.u > 0.97).map((fr) => fr.feet.L.f.pitch);
  check(`heel strikes toes-up (pitch ${Math.min(...strike).toFixed(2)}) and leaves from the toe (pitch ${Math.max(...off).toFixed(2)})`, Math.min(...strike) < -0.2 && Math.max(...off) > 0.3);
  // The arms oppose the legs.
  const zl = moving.map((fr) => fr.feet.L.f.ankle[2]);
  const al = moving.map((fr) => F.armSwing(fr.st.phase, fr.st.speed).L);
  const ar = moving.map((fr) => F.armSwing(fr.st.phase, fr.st.speed).R);
  const mean = (v) => v.reduce((a, b) => a + b, 0) / v.length;
  const corr = (a, b) => {
    const ma = mean(a);
    const mb = mean(b);
    let n = 0, da = 0, db = 0;
    for (let i = 0; i < a.length; i++) {
      n += (a[i] - ma) * (b[i] - mb);
      da += (a[i] - ma) ** 2;
      db += (b[i] - mb) ** 2;
    }
    return n / Math.sqrt(da * db);
  };
  check(`each arm opposes its own leg (corr of left arm with left ankle z ${corr(al, zl).toFixed(2)}, with the right arm ${corr(al, ar).toFixed(2)})`, corr(al, zl) > 0.5 && corr(al, ar) < -0.99);
}

/* ── footstep events ────────────────────────────────────────────────────── */
{
  const events = run.frames.flatMap((fr) => fr.plan.footsteps.map((e) => ({ ...e, frame: fr })));
  // The route is walked with a step that fits a whole number of steps, starting and ending on the rest phase.
  const stepLen = run.frames.at(-1).st.stride;
  const expected = Math.round(10 / stepLen);
  check(`${events.length} heel strikes over 10 m at ${stepLen.toFixed(3)} m a step (expected ${expected}), each at a multiple of pi`, events.length === expected && Math.abs(10 / stepLen - expected) < 1e-6 && events.every((e) => Math.abs(e.atPhase / Math.PI - Math.round(e.atPhase / Math.PI)) < 1e-9));
  check("…alternating right, left, right… (the left lands at phase 0 so the first after the start is the right)", events.every((e, i) => e.side === (i % 2 ? "L" : "R")));
  const idx = new Map(run.frames.map((fr, i) => [fr, i]));
  let sync = 0;
  for (const e of events) {
    const i = idx.get(e.frame);
    const foot = e.frame.feet[e.side];
    const before = run.frames[i - 1]?.feet[e.side].f.state;
    if (foot.f.state === "stance" && foot.f.u < 0.1 && before === "swing" && foot.cs.heel.h < 0.004) sync++;
  }
  check(`…and every event is the frame that foot's heel reaches the floor (${sync}/${events.length})`, sync === events.length);
  const w = F.footstepsBetween(6.28, 0.01);
  check("a wrapped phase (6.28 -> 0.01) still announces the left strike at 2 pi", w.length === 1 && w[0].side === "L" && Math.abs(w[0].atPhase - 2 * Math.PI) < 1e-9);
  check("no event when the phase stands still or runs backward", F.footstepsBetween(1, 1).length === 0 && F.footstepsBetween(4, 3.5).length === 0);
  check("a long jump is read as no step rather than a burst", F.footstepsBetween(0.1, 40).length === 0);
}

/* ── starting and stopping ──────────────────────────────────────────────── */
{
  // At the rest phase the feet are side by side: the left flat in mid-stance, the right passing it.
  for (const h of [1.66, 1.75, 1.86]) {
    const s = h / 1.75;
    const p = F.footPlan(F.REST_PHASE, 1.35, L.strideOf(h), 0.88 * s);
    const apart = Math.abs(p.left.planted[1] - p.right.planted[1]);
    check(`rest phase, height ${h}: the feet are ${(apart * 100).toFixed(2)} cm apart front to back, the left flat on the floor, the right in the air`, apart < 0.012 && p.left.state === "stance" && Math.abs(p.left.pitch) < 1e-9 && p.right.state === "swing" && p.right.lift > 0.03);
  }
  // The foot that was a step away at the start of a walk is not: the first walking frame is the rest pose.
  const first = run.frames.find((fr) => !fr.plan.standing);
  const last = [...run.frames].reverse().find((fr) => !fr.plan.standing);
  const standing = F.footPlan(0, 0, run.stride, run.legLen);
  const heelPop = (fr) => Math.abs(fr.feet.L.f.ankle[2] - standing.left.ankle[2]);
  const liftPop = (fr) => Math.abs(fr.feet.R.cs.heel.h);
  check(`the first walking frame is within ${(heelPop(first) * 100).toFixed(1)} cm of standing (not a step's length), and the last within ${(heelPop(last) * 100).toFixed(1)} cm`, heelPop(first) < 0.08 && heelPop(last) < 0.08);
  console.log(`      (info) at the start the passing foot is ${(liftPop(first) * 100).toFixed(0)} cm off the floor and the stance foot ${(first.feet.L.f.ankle[2] * 100).toFixed(1)} cm from under the hip: the caller eases in over a few frames`);
  // The old arrangement for comparison: phase 0 on the first frame puts the left foot a step ahead.
  const cold = F.footPlan(0.01, 0.3, run.stride, run.legLen);
  check(`…a walk that started on phase 0 would have jumped the stance foot ${(Math.abs(cold.left.ankle[2]) * 100).toFixed(0)} cm`, Math.abs(cold.left.ankle[2]) > 0.3);
}

/* ── other bodies, other headings ───────────────────────────────────────── */
{
  for (const h of [1.66, 1.8, 1.86]) {
    const r = walk(h, 10, 0.7);
    const seq = sequences(r);
    const total = Object.values(seq).reduce((n, s) => n + F.footSlide(s).total, 0);
    const mv = r.frames.filter((fr) => !fr.plan.standing);
    check(`height ${h}, heading 0.7 rad: slide ${(total * 100).toFixed(3)} cm, always reachable`, total < 0.02 && mv.every((fr) => fr.feet.L.a.reach && fr.feet.R.a.reach), `${total}`);
  }
  // A slow pacing walk (vmax 0.8 m/s) keeps its feet planted too.
  {
    const s = 1;
    const poly = L.smoothPath([[0, 0], [0, 8]], () => true);
    const P = L.walkParams({ vmax: 0.8 });
    let st = L.initMover([0, 0], 0);
    const seq = { LH: [], LT: [], RH: [], RT: [] };
    for (let i = 0; i < 3000; i++) {
      const before = st.phase;
      st = L.stepMover(st, poly, DT, P);
      const plan = F.footPlan(st.phase, st.speed, st.stride, 0.88 * s, before);
      const hipY = 0.88 * s + F.SOLE - plan.hipDrop;
      for (const [side, f] of [["L", plan.left], ["R", plan.right]]) {
        for (const [name, [cy, cz]] of Object.entries(CORNERS)) {
          const [dy, dz] = rot(cy, cz, f.pitch);
          seq[side + name[0].toUpperCase()].push({ pos: [0, st.pos[1] + f.ankle[2] + dz], stance: !plan.standing && hipY + f.ankle[1] + dy < 0.003 });
        }
      }
      if (st.arrived) break;
    }
    const total = Object.values(seq).reduce((n, x) => n + F.footSlide(x).total, 0);
    check(`pacing at 0.8 m/s: slide ${(total * 100).toFixed(3)} cm over 8 m`, total < 0.02, `${total}`);
  }
  const still = F.footPlan(1.234, 0, 0.735, 0.88, 1.2);
  check("standing still: both feet flat under the hips, no events", still.standing && still.footsteps.length === 0 && still.left.pitch === 0 && still.left.ankle[2] === 0 && still.left.state === "stance");
  const noisy = [0.0, 1.0, 5.9, 6.3, 100.0, -3.0, 1e6].every((ph) => {
    const p = F.footPlan(ph, 1.2, 0.735, 0.88);
    return [p.hipDrop, ...p.left.ankle, ...p.right.ankle].every(Number.isFinite);
  });
  check("any phase (negative, huge, wrapped) gives finite output", noisy);
  // A corner: report what the rig cannot do (feet pivot only about x).
  const turn = L.smoothPath([[0, 0], [0, 5], [5, 5]], () => true);
  const r = walk(1.75, 0, 0, turn);
  const seq = sequences(r);
  const total = Object.values(seq).reduce((n, s) => n + F.footSlide(s).total, 0);
  console.log(`      (info) around a 90-degree corner the planted shoe skids ${(total * 100).toFixed(1)} cm in total: the rig has no hip abduction, so the lateral part of a pivot cannot be planted`);
}

/* ── NEGATIVE CONTROL: the sinusoidal swing the Floor uses today ───────── */
console.log("  negative control");
{
  const s = 1;
  const poly = L.smoothPath([[0, 0], [0, 10]], () => true);
  let st = L.initMover([0, 0], 0);
  const P = L.walkParams();
  let dist = 0;
  const seq = { LH: [], LT: [], RH: [], RT: [] };
  let contact = 0;
  let frames = 0;
  for (let i = 0; i < 3000; i++) {
    const z0 = st.pos[1];
    st = L.stepMover(st, poly, DT, P);
    dist += st.pos[1] - z0;
    const phi = 4.4 * dist; // walkPhase += dt * speed * 4.4
    const hipY = 0.92 * s + 0.03 * Math.abs(Math.cos(phi)); // poseFor WALK: bodyY = 0.03 |cos|
    const legs = {
      L: [0.55 * Math.sin(phi), 0.15 + 0.75 * Math.max(0, Math.cos(phi))],
      R: [-0.55 * Math.sin(phi), 0.15 + 0.75 * Math.max(0, -Math.cos(phi))],
    };
    let any = false;
    for (const side of ["L", "R"]) {
      const [hip, knee] = legs[side];
      const [ay, az] = F.legAnkle(hip, knee, 0.44, 0.44);
      for (const [name, [cy, cz]] of Object.entries(CORNERS)) {
        const [dy, dz] = rot(cy, cz, hip + knee); // the shoe rides the shin
        const h = hipY + ay + dy;
        const stance = h < 0.03;
        any ||= stance;
        seq[side + name[0].toUpperCase()].push({ pos: [0, st.pos[1] + az + dz], stance });
      }
    }
    frames++;
    if (any) contact++;
    if (st.arrived) break;
  }
  const slides = Object.values(seq).map((x) => F.footSlide(x));
  const total = slides.reduce((n, x) => n + x.total, 0);
  const worst = Math.max(...slides.map((x) => x.worstPlant));
  check(`the sinusoidal swing slides ${(total * 100).toFixed(0)} cm over the same walk (worst plant ${(worst * 100).toFixed(0)} cm): the slide check FAILS on it`, !(total < 0.02 && worst < 0.02) && total > 1);
  check(`…and it is off the ground in ${(((frames - contact) / frames) * 100).toFixed(0)}% of frames (no foot within 3 cm of the floor): the no-flight check fails too`, contact < frames * 0.9);
}

/* More mutants, each of which the matching check must catch. */
{
  // (1) The foot plan told a step 10% longer than the one the mover advances the phase by: the stance foot
  // is dragged back at the wrong speed and slides. The 2 cm slide bound has to see it.
  const poly = L.smoothPath([[0, 0], [0, 10]], () => true);
  let st = L.initMover([0, 0], 0);
  const P = L.walkParams();
  const seq = { LH: [], LT: [], RH: [], RT: [] };
  for (let i = 0; i < 3000; i++) {
    const before = st.phase;
    st = L.stepMover(st, poly, DT, P);
    const plan = F.footPlan(st.phase, st.speed, st.stride * 1.1, 0.88, before);
    const hipY = 0.88 + F.SOLE - plan.hipDrop;
    for (const [side, f] of [["L", plan.left], ["R", plan.right]]) {
      for (const [name, [cy, cz]] of Object.entries(CORNERS)) {
        const [dy, dz] = rot(cy, cz, f.pitch);
        seq[side + name[0].toUpperCase()].push({ pos: [0, st.pos[1] + f.ankle[2] + dz], stance: !plan.standing && hipY + f.ankle[1] + dy < 0.003 });
      }
    }
    if (st.arrived) break;
  }
  const total = Object.values(seq).reduce((n, x) => n + F.footSlide(x).total, 0);
  check(`a stride mismatch of 10% makes the planted feet slide ${(total * 100).toFixed(0)} cm: the slide check catches it`, total > 0.2);
  // (2) A solution that takes the thigh to the OTHER side of the hip-to-ankle line but keeps the knee bending the
  // same way (the classic sign slip) misses its targets.
  const wrong = (target, thigh, shin) => {
    const a = F.legAngles(target, thigh, shin);
    const d = Math.hypot(target[1], target[2]);
    const tri = Math.acos(Math.max(-1, Math.min(1, (thigh * thigh + d * d - shin * shin) / (2 * thigh * d))));
    return { hip: a.hip + 2 * tri, knee: a.knee };
  };
  let miss = 0;
  let tried = 0;
  for (let ty = -0.8; ty <= -0.3; ty += 0.1) {
    for (let tz = -0.4; tz <= 0.4; tz += 0.1) {
      const a = wrong([0, ty, tz], 0.44, 0.44);
      const [fy, fz] = F.legAnkle(a.hip, a.knee, 0.44, 0.44);
      tried++;
      if (Math.hypot(fy - ty, fz - tz) > 0.01) miss++;
    }
  }
  check(`a leg solution folded the wrong way misses ${miss} of ${tried} targets by more than 1 cm: the IK check catches it`, miss > tried / 2);
}

console.log(`\nfeet: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
