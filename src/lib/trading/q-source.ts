/** Labels the next q/band write on a tracked card (cap-attribution.ts). The writer names itself; nothing is inferred. */
let src: string | null = null;
/** fix/cap-why-attribution-1016: a writer that pushes its reason lines BEFORE the write (applyDiscipline) names its
 *  own `why` here; otherwise cap-attribution falls back to the next reason line pushed after the write. */
let why: string | null = null;
export const setQSource = (s: string | null, w: string | null = null): void => { src = s; why = s == null ? null : w; };
export const takeQSource = (): string | null => { const s = src; src = null; return s; };
/** Read (and clear) the writer-supplied why. Call right after takeQSource. */
export const takeQWhy = (): string | null => { const w = why; why = null; return w; };
/** Labelled write: the label is set only when the value actually changes, and is always cleared after,
 *  so a no-op write (or a write on an untracked card copy) never leaks its label onto a later write. */
export function qWrite<T extends object, K extends keyof T>(o: T, field: K, next: T[K], label: string): void {
  if (o[field] !== next) setQSource(label);
  o[field] = next;
  src = null; why = null;
}
