/**
 * Bound a promise to a time budget without ever rejecting.
 *
 * For optional upstreams: a source that is nice to have but must not be
 * allowed to hold up the caller. The contract is deliberately narrow —
 * resolve with the value if it arrives in time, otherwise resolve with the
 * fallback, and swallow a rejection the same way. A helper that could throw
 * would just move the outage from "upstream slow" to "upstream slow AND we
 * crashed handling it".
 *
 * The underlying request is NOT cancelled (that is the caller's abort
 * signal's job); this only stops waiting for it.
 */
export function withBudget<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise<T>((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      () => {
        clearTimeout(timer);
        resolve(fallback);
      },
    );
  });
}
