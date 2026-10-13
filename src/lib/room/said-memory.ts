/**
 * What the floor has already said.
 *
 * The meeting script is rebuilt every cycle. Without this, Sterling reads the
 * same lesson and the same account line again. A line is stored by its gist
 * (numbers collapsed) for the session, and a repeat is not spoken. A live
 * fact — distance, a sweep, the leader — may be said again when the words
 * themselves changed.
 */

const KEY = "ledger.floor.said";
const KEEP_MS = 8 * 60 * 60 * 1000;
const MAX = 300;

export interface SaidRow {
  g: string;
  e: string;
  t: number;
  /** floor-62 #5: the numbers the line carried, so a material change can be said again. */
  n?: number[];
}

/** The numbers in a line, in order. */
export function speechNumbers(text: string): number[] {
  return (text.match(/-?\d[\d,]*(?:\.\d+)?/g) ?? []).map((x) => Number(x.replace(/,/g, ""))).filter(Number.isFinite);
}

/** A material change: any number moved by more than 0.2%, or by a whole unit on a small count. */
export function numbersMoved(a: readonly number[] | undefined, b: readonly number[]): boolean {
  if (!a) return false;
  if (a.length !== b.length) return true;
  return a.some((x, i) => {
    const y = b[i]!;
    const d = Math.abs(x - y);
    const m = Math.max(Math.abs(x), Math.abs(y));
    return m < 100 ? d >= 1 : d / m > 0.002;
  });
}

const LIVE = /\b(pts|points|away|sweep|inverse|leader)\b/i;

export function speechExact(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

/** Numbers and money collapse, so "$996.12 buying power" matches the next cent. */
export function speechGist(text: string): string {
  return speechExact(text)
    .replace(/\$\s?[\d,]+(?:\.\d+)?/g, "¤")
    .replace(/\b\d+(?:\.\d+)?%?/g, "#")
    .replace(/[^a-z¤#\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function heardBefore(text: string, rows: readonly SaidRow[], now: number): boolean {
  const e = speechExact(text);
  const g = speechGist(text);
  const live = LIVE.test(text);
  const nums = speechNumbers(text);
  for (let i = rows.length - 1; i >= 0; i--) {
    const r = rows[i]!;
    if (now - r.t > KEEP_MS) continue;
    if (r.e === e) return true;
    // floor-62 #5: same words with materially new numbers is a change and is said; a cent of drift is not.
    if (r.g === g && !numbersMoved(r.n, nums) && !(live && r.n == null)) return true;
  }
  return false;
}

export function rememberSaid(text: string, rows: SaidRow[], now: number): SaidRow[] {
  const next = rows.filter((r) => now - r.t <= KEEP_MS);
  next.push({ g: speechGist(text), e: speechExact(text), t: now, n: speechNumbers(text) });
  return next.slice(-MAX);
}

export function loadSaid(now = Date.now()): SaidRow[] {
  try {
    if (typeof localStorage === "undefined") return [];
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as SaidRow[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((r) => r && typeof r.g === "string" && typeof r.e === "string" && now - r.t <= KEEP_MS);
  } catch {
    return [];
  }
}

export function saveSaid(rows: readonly SaidRow[]): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(KEY, JSON.stringify(rows.slice(-MAX)));
  } catch {
    /* private mode */
  }
}
