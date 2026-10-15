/** Labels the next q/band write on a tracked card (cap-attribution.ts). The writer names itself; nothing is inferred. */
let src: string | null = null;
export const setQSource = (s: string | null): void => { src = s; };
export const takeQSource = (): string | null => { const s = src; src = null; return s; };
