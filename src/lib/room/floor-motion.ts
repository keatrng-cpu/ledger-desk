/** Floor locomotion helpers (floor-62 #10 #11 #17 #18 #28). Pure, unit-tested. */
export type V2 = [number, number];
export const WALK = { walk: 1.35, pace: 0.8, urgent: 1.8, accel: 2.2, decelDist: 0.4, minArrive: 0.25, personal: 0.55, turnFirstRad: 1.2 } as const;

/** Ease toward the gait speed; slow down over the last `decelDist` metres (never below minArrive × gait). */
export function nextSpeed(cur: number, gait: number, remaining: number, dt: number): number {
  const cap = remaining < WALK.decelDist ? gait * Math.max(WALK.minArrive, remaining / WALK.decelDist) : gait;
  if (cur < cap) return Math.min(cap, cur + WALK.accel * dt);
  return cap;
}

/** True when the walker should rotate in place before stepping off (heading off by more than turnFirstRad). */
export function turnFirst(yaw: number, heading: number): boolean {
  let d = (heading - yaw) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return Math.abs(d) > WALK.turnFirstRad;
}

/** A unit-ish sidestep away from anyone inside personal space AHEAD of the walker; [0,0] when clear. */
export function separation(pos: V2, dir: V2, others: readonly V2[]): V2 {
  let sx = 0;
  let sz = 0;
  for (const o of others) {
    const ox = o[0] - pos[0];
    const oz = o[1] - pos[1];
    const d = Math.hypot(ox, oz);
    if (d < 1e-4 || d > WALK.personal) continue;
    if (ox * dir[0] + oz * dir[1] <= 0) continue; // behind
    // Sidestep perpendicular to the walk, away from the other person.
    const side = ox * -dir[1] + oz * dir[0] > 0 ? -1 : 1;
    const w = (WALK.personal - d) / WALK.personal;
    sx += -dir[1] * side * w;
    sz += dir[0] * side * w;
  }
  const m = Math.hypot(sx, sz);
  return m > 0.8 ? [(sx / m) * 0.8, (sz / m) * 0.8] : [sx, sz];
}
