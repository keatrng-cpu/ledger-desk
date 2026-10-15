/** Labels the next q/band write on a tracked card (cap-attribution.ts). The writer names itself; nothing is inferred. */
let src: string | null = null;
export const setQSource = (s: string | null): void => { src = s; };
export const takeQSource = (): string | null => { const s = src; src = null; return s; };
/** Labelled write: the label is set only when the value actually changes, and is always cleared after,
 *  so a no-op write (or a write on an untracked card copy) never leaks its label onto a later write. */
export function qWrite<T extends object, K extends keyof T>(o: T, field: K, next: T[K], label: string): void {
  if (o[field] !== next) setQSource(label);
  o[field] = next;
  src = null;
}
