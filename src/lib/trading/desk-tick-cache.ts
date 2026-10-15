/**
 * Deep audit #10: /api/desk/card, read_desk, read_brain and read_floor each rebuilt the full desk
 * (3.5–5.0 s, ~110 KB each). One build per tick per warm instance: concurrent callers share the
 * in-flight promise, and a finished build is reused for TICK_MS. Per warm function instance only —
 * a cold instance still builds once.
 */
export const DESK_TICK_MS = 1_000;
type Entry<T> = { at: number; p: Promise<T>; done: boolean };
const CACHE = new Map<string, Entry<unknown>>();

export async function sharedDeskBuild<T extends { ok?: boolean }>(
  data: { left: string; right: string },
  build: (d: never) => Promise<T>,
  nowMs: () => number = Date.now,
  tickMs = DESK_TICK_MS,
): Promise<T> {
  const key = `${data.left}|${data.right}`;
  const hit = CACHE.get(key) as Entry<T> | undefined;
  if (hit && (!hit.done || nowMs() - hit.at < tickMs)) return hit.p;
  const p = build(data as never);
  const e: Entry<T> = { at: nowMs(), p, done: false };
  CACHE.set(key, e);
  // A failure is never served from cache; the finish time starts the tick (build takes seconds).
  p.then((v) => { e.done = true; if (!v || v.ok === false) CACHE.delete(key); else e.at = nowMs(); }, () => CACHE.delete(key));
  return p;
}
export function _clearDeskTickCache() { CACHE.clear(); }
