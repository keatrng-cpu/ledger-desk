/**
 * M1 — locomotion. A route is smoothed without leaving walkable cells, and a person follows it with an
 * acceleration limit, bounded turning and a gait that matches the ground covered.
 *   npx tsx scripts/verify-floor-locomotion.mjs
 *
 * The routes are REAL: the nav grid and the plan the Floor itself walks (every spot and anchor to a hub),
 * so "walkable" is the grid's own answer. Each check also runs against a deliberately broken variant
 * (negative controls at the bottom) so a check that cannot fail is caught.
 */
const L = await import("../src/lib/room/floor-locomotion.ts");
const FS = await import("../src/components/room/floor-scene.ts");

let fail = 0;
let pass = 0;
const check = (name, ok, detail = "") => {
  if (ok) pass++;
  else fail++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : ` — ${detail}`}`);
};

const nav = new FS.NavGrid(FS.LAYOUT);
const walkable = (x, z) => {
  const [i, j] = nav.cellOf(x, z);
  return nav.free(i, j);
};
const wrapPi = (a) => {
  let r = (a + Math.PI) % (Math.PI * 2);
  if (r < 0) r += Math.PI * 2;
  return r - Math.PI;
};

/* ── the routes ─────────────────────────────────────────────────────────── */
const stops = [
  ...Object.values(FS.LAYOUT.spots).filter((v) => v.pose !== "couch").map((v) => v.pos),
  ...Object.values(FS.LAYOUT.anchors).flatMap((ps) => Object.values(ps).filter((a) => a.pose !== "couch").map((a) => a.pos)),
].filter((p) => walkable(p[0], p[1]));
const hubs = [[-6, 1.8], [8, 2.5]];
const routes = [];
for (let k = 0; k < stops.length; k++) {
  for (const hub of hubs) {
    const from = k % 2 ? hub : stops[k];
    const to = k % 2 ? stops[k] : hub;
    const raw = nav.path(from, to);
    if (!nav.lastFound) continue;
    routes.push({ from, to, raw: [from, ...raw] });
  }
}
// And a handful of long cross-building walks.
for (let k = 0; k < stops.length - 7; k += 5) {
  const raw = nav.path(stops[k], stops[k + 7]);
  if (nav.lastFound) routes.push({ from: stops[k], to: stops[k + 7], raw: [stops[k], ...raw] });
}
check(`real routes to test (${routes.length})`, routes.length >= 40, `only ${routes.length}`);

const maxTurn = (poly) => {
  let m = 0;
  for (let i = 1; i < poly.length - 1; i++) {
    const a = Math.atan2(poly[i][0] - poly[i - 1][0], poly[i][1] - poly[i - 1][1]);
    const b = Math.atan2(poly[i + 1][0] - poly[i][0], poly[i + 1][1] - poly[i][1]);
    m = Math.max(m, Math.abs(wrapPi(b - a)));
  }
  return m;
};
const chordViolations = (poly, ok) => {
  // every 5 mm
  let bad = 0;
  for (let i = 0; i < poly.length; i++) {
    if (!ok(poly[i][0], poly[i][1])) bad++;
    const b = poly[i + 1];
    if (!b) break;
    const len = Math.hypot(b[0] - poly[i][0], b[1] - poly[i][1]);
    const k = Math.ceil(len / 0.005);
    for (let j = 1; j < k; j++) if (!ok(poly[i][0] + ((b[0] - poly[i][0]) * j) / k, poly[i][1] + ((b[1] - poly[i][1]) * j) / k)) bad++;
  }
  return bad;
};
const maxChord = (poly) => poly.reduce((m, p, i) => (i ? Math.max(m, Math.hypot(p[0] - poly[i - 1][0], p[1] - poly[i - 1][1])) : m), 0);

/* ── smoothPath ─────────────────────────────────────────────────────────── */
{
  let routeBad = 0;
  let rawBad = 0;
  let endsOk = true;
  let spacingOk = true;
  let rawTurn = 0;
  let smoothTurn = 0;
  let corners = 0;
  let sharpLeft = 0;
  for (const r of routes) {
    const sm = L.smoothPath(r.raw, walkable);
    routeBad += chordViolations(sm, walkable) ? 1 : 0;
    rawBad += chordViolations(r.raw, walkable) ? 1 : 0;
    endsOk &&= sm[0][0] === r.raw[0][0] && sm[0][1] === r.raw[0][1] && sm.at(-1)[0] === r.raw.at(-1)[0] && sm.at(-1)[1] === r.raw.at(-1)[1];
    spacingOk &&= maxChord(sm) <= 0.25;
    rawTurn = Math.max(rawTurn, maxTurn(r.raw));
    smoothTurn = Math.max(smoothTurn, maxTurn(sm));
    // Corners of the raw route that still turn more than 40 degrees in ONE chord afterwards.
    for (let i = 1; i < r.raw.length - 1; i++) {
      const a = Math.atan2(r.raw[i][0] - r.raw[i - 1][0], r.raw[i][1] - r.raw[i - 1][1]);
      const b = Math.atan2(r.raw[i + 1][0] - r.raw[i][0], r.raw[i + 1][1] - r.raw[i][1]);
      if (Math.abs(wrapPi(b - a)) > 0.3) corners++;
    }
    for (let i = 1; i < sm.length - 1; i++) {
      const a = Math.atan2(sm[i][0] - sm[i - 1][0], sm[i][1] - sm[i - 1][1]);
      const b = Math.atan2(sm[i + 1][0] - sm[i][0], sm[i + 1][1] - sm[i][1]);
      if (Math.abs(wrapPi(b - a)) > 0.7) sharpLeft++;
    }
  }
  check(`every smoothed route stays on walkable cells (points and every 5 mm of chord)`, routeBad === 0, `${routeBad} routes leave the grid`);
  check(`…while the router's own legs clip a blocked cell on ${rawBad} of ${routes.length} routes (the check can fail; the repair is doing work)`, rawBad > 0);
  check("start and end points are returned exactly", endsOk);
  check("output is dense (no chord over 0.25 m)", spacingOk);
  check(`corners are rounded (${sharpLeft} sharp vertices left over ${corners} raw corners, fallback included)`, sharpLeft <= corners * 0.25, `${sharpLeft}/${corners}`);
  console.log(`      (info) ${routes.length} routes; worst one-vertex turn ${smoothTurn.toFixed(2)} rad smoothed vs ${rawTurn.toFixed(2)} raw`);
}

/* ── the walk: one frame loop shared by the mover and the negative control ─ */
const DT = 1 / 60;
function walk(poly, step, init, maxSeconds = 90) {
  const frames = [];
  let st = init;
  let t = 0;
  while (t < maxSeconds) {
    st = step(st, DT);
    t += DT;
    frames.push({ pos: st.pos, yaw: st.yaw, speed: st.speed, phase: st.phase, lean: st.lean, yawRate: st.yawRate, arrived: st.arrived });
    if (st.arrived) break;
  }
  return { frames, seconds: t, final: st };
}
function audit(poly, run, limits) {
  const f = run.frames;
  let maxV = 0;
  let maxA = 0;
  let maxAField = 0;
  let maxAPos = 0;
  let aAt = -1;
  let maxYawStep = 0;
  let maxPosStep = 0;
  let offGrid = 0;
  let prevV = 0;
  let prevField = 0;
  let prevPos = poly[0];
  let yawPrev = null;
  // Displacement headings, to know which frames are on a straight stretch.
  const disp = f.map((fr, i) => {
    const a = i ? f[i - 1].pos : poly[0];
    return [fr.pos[0] - a[0], fr.pos[1] - a[1]];
  });
  const straightAt = (i) => {
    const d = disp[i];
    if (Math.hypot(d[0], d[1]) < 1e-9) return false;
    for (const j of [i - 1, i + 1]) {
      const e = disp[j];
      if (!e || Math.hypot(e[0], e[1]) < 1e-9) continue;
      const turn = Math.abs(wrapPi(Math.atan2(e[0], e[1]) - Math.atan2(d[0], d[1])));
      if (turn > 0.05) return false;
    }
    return true;
  };
  f.forEach((fr, i) => {
    const dp = Math.hypot(fr.pos[0] - prevPos[0], fr.pos[1] - prevPos[1]);
    const v = dp / DT;
    maxV = Math.max(maxV, v);
    // Acceleration two ways: the speed the mover REPORTS, and the speed the POSITIONS imply (only on straight
    // stretches, where a corner's chord cannot masquerade as a change of speed).
    maxAField = Math.max(maxAField, Math.abs(fr.speed - prevField) / DT);
    if (straightAt(i) && Math.abs(v - prevV) / DT > maxAPos) {
      maxAPos = Math.abs(v - prevV) / DT;
      aAt = i;
    }
    maxPosStep = Math.max(maxPosStep, dp);
    if (yawPrev !== null) maxYawStep = Math.max(maxYawStep, Math.abs(wrapPi(fr.yaw - yawPrev)));
    yawPrev = fr.yaw;
    if (!walkable(fr.pos[0], fr.pos[1])) offGrid++;
    prevV = v;
    prevField = fr.speed;
    prevPos = fr.pos;
  });
  maxA = Math.max(maxAField, maxAPos);
  const end = poly.at(-1);
  const last = f.at(-1);
  const arrivedAtEnd = !!last && last.arrived && Math.hypot(last.pos[0] - end[0], last.pos[1] - end[1]) < 1e-6;
  return {
    arrived: arrivedAtEnd,
    maxV,
    maxA,
    maxAField,
    maxAPos,
    aAt,
    maxYawStep,
    maxPosStep,
    offGrid,
    ok: {
      arrives: arrivedAtEnd,
      speedBound: maxV <= limits.vmax * 1.005,
      accelBound: maxA <= limits.accel * 1.05,
      yawBound: maxYawStep <= limits.yawStep,
      stepBound: maxPosStep <= limits.vmax * DT * 1.005,
      walkable: offGrid === 0,
    },
  };
}
const P = L.walkParams();
const limits = { vmax: P.vmax, accel: Math.max(P.accel, P.decel), yawStep: P.maxTurnRate * DT * 1.001 };

const smoothed = routes.map((r) => ({ ...r, sm: L.smoothPath(r.raw, walkable) }));
const runs = smoothed.map((r) => {
  const start = L.initMover(r.sm[0], Math.atan2(r.sm[1][0] - r.sm[0][0], r.sm[1][1] - r.sm[0][1]));
  const run = walk(r.sm, (s, dt) => L.stepMover(s, r.sm, dt, P), start);
  return { r, run, a: audit(r.sm, run, limits) };
});

{
  const every = (key) => runs.every((x) => x.a.ok[key]);
  const worst = (key, pick) => runs.filter((x) => !x.a.ok[key]).map(pick).slice(0, 3).join("; ");
  check(`every walk arrives exactly at the end (${runs.length} routes)`, every("arrives"), worst("arrives", (x) => `${x.r.from}->${x.r.to}`));
  check("speed never exceeds vmax (from positions, 60 fps)", every("speedBound"), `max ${Math.max(...runs.map((x) => x.a.maxV)).toFixed(3)}`);
  const wa = runs.reduce((m, x) => (x.a.maxA > m.a.maxA ? x : m), runs[0]);
  check("acceleration stays within the limit", every("accelBound"), `max ${wa.a.maxA.toFixed(2)} m/s2 (field ${wa.a.maxAField.toFixed(2)}, positions ${wa.a.maxAPos.toFixed(2)} at frame ${wa.a.aAt}) on ${wa.r.from}->${wa.r.to}`);
  check(`yaw never jumps more than ${(limits.yawStep).toFixed(3)} rad in a frame`, every("yawBound"), `max ${Math.max(...runs.map((x) => x.a.maxYawStep)).toFixed(3)}`);
  check("no waypoint snap: a frame never moves more than vmax x dt", every("stepBound"), `max ${Math.max(...runs.map((x) => x.a.maxPosStep)).toFixed(4)}`);
  check("the body is on a walkable cell in every frame", every("walkable"), `${runs.reduce((n, x) => n + x.a.offGrid, 0)} frames off the grid`);
  console.log(`      (info) worst: speed ${Math.max(...runs.map((x) => x.a.maxV)).toFixed(3)} m/s, accel ${Math.max(...runs.map((x) => x.a.maxA)).toFixed(2)} m/s2, yaw step ${Math.max(...runs.map((x) => x.a.maxYawStep)).toFixed(3)} rad`);
}

/* ── time against the physical estimate ─────────────────────────────────── */
{
  const rows = runs.map((x) => {
    const len = L.pathLength(x.r.sm);
    const est = L.estimateWalkSeconds(len, P);
    return { len, est, t: x.run.seconds, rel: (x.run.seconds - est) / est };
  });
  const worst = rows.reduce((m, r) => (Math.abs(r.rel) > Math.abs(m.rel) ? r : m), rows[0]);
  check(
    `arrival time is within 20% of the physical estimate on every route (worst ${(worst.rel * 100).toFixed(1)}% at ${worst.len.toFixed(1)} m)`,
    rows.every((r) => Math.abs(r.rel) <= 0.2),
    `${rows.filter((r) => Math.abs(r.rel) > 0.2).length} routes outside`,
  );
  const straight = [[0, 0], [10, 0]];
  const poly = L.smoothPath(straight, () => true);
  const run = walk(poly, (s, dt) => L.stepMover(s, poly, dt, P), L.initMover([0, 0], Math.PI / 2));
  const est = L.estimateWalkSeconds(10, P);
  check(`a 10 m straight walk takes ${run.seconds.toFixed(2)} s against ${est.toFixed(2)} s`, Math.abs(run.seconds - est) / est <= 0.05, `${run.seconds} vs ${est}`);
  const peak = Math.max(...run.frames.map((f) => f.speed));
  check(`it reaches cruise speed (${peak.toFixed(3)} m/s) and stops dead`, Math.abs(peak - P.vmax) < 1e-6 && run.final.speed === 0 && run.final.arrived);
}

/* ── gait phase follows ground covered; lean follows the turn ──────────── */
{
  const unwrapSum = (frames) => {
    let sum = 0;
    for (let i = 1; i < frames.length; i++) sum += (frames[i].phase - frames[i - 1].phase + Math.PI * 2) % (Math.PI * 2);
    return sum;
  };
  let worst = 0;
  for (const x of runs.slice(0, 30)) {
    const dist = L.pathLength(x.r.sm);
    const phase = unwrapSum(x.run.frames);
    const implied = (phase * L.strideOf(P.height)) / Math.PI;
    worst = Math.max(worst, Math.abs(implied - dist) / dist);
  }
  check(`phase advances by distance / stride (worst error ${(worst * 100).toFixed(2)}% of distance)`, worst < 0.01, `${worst}`);
  const poly = L.smoothPath([[0, 0], [10, 0]], () => true);
  const cad = (height) => {
    const p = L.walkParams({ height });
    const run = walk(poly, (s, dt) => L.stepMover(s, poly, dt, p), L.initMover([0, 0], Math.PI / 2));
    return { steps: unwrapSum(run.frames) / Math.PI, run };
  };
  const tall = cad(1.86);
  const short = cad(1.66);
  check(`a shorter person takes more steps over the same 10 m (${short.steps.toFixed(1)} vs ${tall.steps.toFixed(1)})`, short.steps > tall.steps * 1.08);
  const cruise = cad(1.75);
  const cruiseTime = cruise.run.seconds - 1.3;
  check(`cadence at cruise is a human one (${((cruise.steps / cruiseTime) * 60).toFixed(0)} steps/min)`, (cruise.steps / cruiseTime) * 60 > 90 && (cruise.steps / cruiseTime) * 60 < 135);

  const straightLean = Math.max(...cruise.run.frames.map((f) => Math.abs(f.lean)));
  check(`no lean on a straight line (${straightLean.toExponential(1)})`, straightLean < 1e-6);
  let agree = 0;
  let turning = 0;
  let maxLean = 0;
  for (const x of runs) {
    for (const f of x.run.frames) {
      maxLean = Math.max(maxLean, Math.abs(f.lean));
      if (Math.abs(f.yawRate) > 0.4 && f.speed > 0.4) {
        turning++;
        if (Math.sign(f.lean) === Math.sign(f.yawRate)) agree++;
      }
    }
  }
  check(`lean has the sign of the turn (${agree}/${turning} turning frames)`, turning > 20 && agree / turning > 0.95, `${agree}/${turning}`);
  check(`lean is clamped (max ${maxLean.toFixed(3)} <= ${P.maxLean})`, maxLean <= P.maxLean + 1e-9);

  // A walker facing away from the route stands and turns rather than moonwalking.
  const poly2 = L.smoothPath([[0, 0], [6, 0]], () => true);
  const back = walk(poly2, (s, dt) => L.stepMover(s, poly2, dt, P), L.initMover([0, 0], -Math.PI / 2));
  let moonwalk = 0;
  for (const f of back.frames) {
    const err = Math.abs(wrapPi(Math.PI / 2 - f.yaw));
    if (err > 1.2 && f.speed > 0.4) moonwalk++;
  }
  check("facing away from the route: no walking fast while still turned round", moonwalk === 0 && back.final.arrived, `${moonwalk} frames`);
}

/* ── edges ──────────────────────────────────────────────────────────────── */
{
  const e0 = L.stepMover(L.initMover([1, 2], 0.3), [], 1 / 60, P);
  check("an empty route arrives where it stands", e0.arrived && e0.pos[0] === 1 && e0.pos[1] === 2 && Number.isFinite(e0.yaw));
  const e1 = L.stepMover(L.initMover([1, 2], 0.3), [[4, 5]], 1 / 60, P);
  check("a one-point route arrives on it", e1.arrived && e1.pos[0] === 4 && e1.pos[1] === 5);
  const poly = L.smoothPath([[0, 0], [5, 0], [5, 5]], () => true);
  const s0 = L.initMover([0, 0], Math.PI / 2);
  check("dt = 0 changes nothing", L.stepMover(s0, poly, 0, P) === s0);
  let st = s0;
  for (let i = 0; i < 40; i++) st = L.stepMover(st, poly, 5, P);
  check("5 s frames (a stalled tab) still arrive, finite, on the route", st.arrived && Number.isFinite(st.pos[0]) && st.pos[0] === 5 && st.pos[1] === 5 && st.speed === 0);
  const a = L.stepMover(s0, poly, 0.4, P);
  let b = s0;
  for (let i = 0; i < 12; i++) b = L.stepMover(b, poly, 0.4 / 12, P);
  check("a long frame is split: one 0.4 s step stays within the acceleration limit", a.speed <= P.accel * 0.4 + 1e-9 && Math.abs(a.speed - b.speed) < 0.05, `${a.speed} vs ${b.speed}`);
  const again = (() => {
    let x = L.initMover([0, 0], Math.PI / 2);
    for (let i = 0; i < 300; i++) x = L.stepMover(x, poly, 1 / 60, P);
    return JSON.stringify(x);
  })();
  const again2 = (() => {
    let x = L.initMover([0, 0], Math.PI / 2);
    for (let i = 0; i < 300; i++) x = L.stepMover(x, poly, 1 / 60, P);
    return JSON.stringify(x);
  })();
  check("deterministic: two runs are bit-identical", again === again2);
  const pace = L.walkParams({ vmax: 0.8 });
  const pr = walk(poly, (s, dt) => L.stepMover(s, poly, dt, pace), L.initMover([0, 0], Math.PI / 2));
  check(`pacing (vmax 0.8) never exceeds 0.8 m/s (${Math.max(...pr.frames.map((f) => f.speed)).toFixed(3)})`, Math.max(...pr.frames.map((f) => f.speed)) <= 0.8 + 1e-9);
}

/* ── stress: free points picked anywhere in the building ────────────────── */
{
  let seed = 20261007;
  const rnd = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const free = [];
  while (free.length < 400) {
    const x = FS.LAYOUT.bounds.x[0] + rnd() * (FS.LAYOUT.bounds.x[1] - FS.LAYOUT.bounds.x[0]);
    const z = FS.LAYOUT.bounds.z[0] + rnd() * (FS.LAYOUT.bounds.z[1] - FS.LAYOUT.bounds.z[0]);
    if (walkable(x, z)) free.push([x, z]);
  }
  let paths = 0;
  let leaked = 0;
  let notArrived = 0;
  let timeOut = 0;
  for (let k = 0; k + 1 < free.length; k += 2) {
    const raw = nav.path(free[k], free[k + 1]);
    if (!nav.lastFound) continue;
    const sm = L.smoothPath([free[k], ...raw], walkable);
    paths++;
    if (chordViolations(sm, walkable)) leaked++;
    const run = walk(sm, (s, dt) => L.stepMover(s, sm, dt, P), L.initMover(sm[0], 0));
    const a = audit(sm, run, limits);
    if (!a.ok.arrives || !a.ok.walkable) {
      notArrived++;
      console.log(`      (info) failed: ${free[k].map((v) => v.toFixed(2))} -> ${free[k + 1].map((v) => v.toFixed(2))} arrives ${a.ok.arrives} walkable ${a.ok.walkable} (${a.offGrid} frames) seconds ${run.seconds.toFixed(1)}`);
    }
    const est = L.estimateWalkSeconds(L.pathLength(sm), P);
    if (Math.abs(run.seconds - est) / est > 0.25) timeOut++;
  }
  check(`stress: ${paths} routes between random free points all stay walkable`, paths >= 80 && leaked === 0, `${leaked} leaked`);
  check("…and every walk of them arrives with the body on walkable cells in every frame", notArrived === 0, `${notArrived} failed`);
  check(`…and arrives within 25% of the physical estimate (${timeOut} outside)`, timeOut <= Math.ceil(paths * 0.05), `${timeOut}/${paths}`);
}

/* ── NEGATIVE CONTROLS ──────────────────────────────────────────────────── */
console.log("  negative controls");
{
  // 1. The current follower: constant 1.35 m/s, snaps to each waypoint, exponential yaw. Same audit, same limits.
  const angleLerp = (a, b, k) => a + wrapPi(b - a) * k;
  const naiveStep = (route) => {
    const queue = route.slice(1).map((p) => [p[0], p[1]]);
    return (st, dt) => {
      let { pos, yaw, phase } = st;
      let arrived = st.arrived;
      let speed = 0;
      if (queue.length) {
        const next = queue[0];
        const dx = next[0] - pos[0];
        const dz = next[1] - pos[1];
        const d = Math.hypot(dx, dz);
        const step = 1.35 * dt;
        if (d <= step) {
          pos = [next[0], next[1]];
          queue.shift();
        } else pos = [pos[0] + (dx / d) * step, pos[1] + (dz / d) * step];
        yaw = angleLerp(yaw, Math.atan2(dx, dz), 1 - Math.exp(-10 * dt));
        phase += dt * 1.35 * 4.4;
        speed = 1.35;
        if (!queue.length) arrived = true;
      }
      return { pos, yaw, speed, phase, lean: 0, yawRate: 0, arrived };
    };
  };
  const failed = { accel: 0, yaw: 0, both: 0 };
  let ran = 0;
  for (const x of smoothed.slice(0, 40)) {
    const route = x.raw;
    const start = { pos: route[0], yaw: Math.atan2(route[1][0] - route[0][0], route[1][1] - route[0][1]), speed: 0, phase: 0, lean: 0, yawRate: 0, arrived: false };
    const run = walk(route, naiveStep(route), start);
    const a = audit(route, run, limits);
    ran++;
    if (!a.ok.accelBound) failed.accel++;
    if (!a.ok.yawBound) failed.yaw++;
    if (!a.ok.accelBound && !a.ok.yawBound) failed.both++;
  }
  check(`the waypoint follower breaks the acceleration limit on every route (${failed.accel}/${ran})`, failed.accel === ran);
  check(`…and breaks the yaw-step bound on ${failed.yaw}/${ran} routes (corners and the first frame)`, failed.yaw >= ran * 0.5, `${failed.yaw}/${ran}`);

  // 2. A smoother that rounds without asking the grid leaves walkable cells.
  const naiveRound = (poly, trim) => {
    const out = [poly[0]];
    for (let i = 1; i < poly.length - 1; i++) {
      const P0 = poly[i];
      const a = poly[i - 1];
      const b = poly[i + 1];
      const la = Math.hypot(a[0] - P0[0], a[1] - P0[1]);
      const lb = Math.hypot(b[0] - P0[0], b[1] - P0[1]);
      const t = Math.min(trim, la / 2, lb / 2);
      const A = [P0[0] + ((a[0] - P0[0]) / la) * t, P0[1] + ((a[1] - P0[1]) / la) * t];
      const B = [P0[0] + ((b[0] - P0[0]) / lb) * t, P0[1] + ((b[1] - P0[1]) / lb) * t];
      for (let k = 0; k <= 6; k++) {
        const u = k / 6;
        out.push([(1 - u) * (1 - u) * A[0] + 2 * (1 - u) * u * P0[0] + u * u * B[0], (1 - u) * (1 - u) * A[1] + 2 * (1 - u) * u * P0[1] + u * u * B[1]]);
      }
    }
    out.push(poly.at(-1));
    return out;
  };
  const leaks = routes.filter((r) => chordViolations(naiveRound(r.raw, 1.0), walkable) > 0).length;
  check(`a smoother with no walkable test leaves the grid on ${leaks} of ${routes.length} real routes`, leaks > 0);
  // The same check on the real smoother (above) passed on all of them: the check is able to fail.
  const synthetic = (x, z) => !(x >= 1.2 && x <= 1.8 && z >= 2.2 && z <= 2.8); // a block inside the L, where the curve would cut
  const turn = [[0, 2], [2, 2], [2, 4]];
  check("synthetic tight corner: the naive rounding enters the block", chordViolations(naiveRound(turn, 1.0), synthetic) > 0);
  const kept = L.smoothPath(turn, synthetic);
  check("synthetic tight corner: smoothPath backs off and stays out", chordViolations(kept, synthetic) === 0);
  check("…and still rounds the corner it can (worst turn per vertex under 90 degrees)", maxTurn(kept) < 1.4, `${maxTurn(kept)}`);
}

console.log(`\nlocomotion: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
