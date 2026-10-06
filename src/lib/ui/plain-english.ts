/**
 * Plain English — a reading aid, not a second vocabulary.
 *
 * The desk speaks ICT/SMC shorthand (OTE, BSL, CE, SMT…). That is the right
 * language for the trader at speed and the wrong one for everyone else,
 * including the trader at 6am. This file holds ONE glossary used two ways:
 *
 *   - toggle OFF (default): text renders as written, every acronym carries a
 *     tooltip with its plain meaning;
 *   - toggle ON: the acronym is swapped for the plain words in place.
 *
 * Words only. No number, level or verdict is touched — `plainify` replaces
 * whole-word tokens from the table below and nothing else.
 * The choice persists in localStorage (`ledger-plain-english-v1`).
 */

export interface GlossaryEntry {
  /** What replaces the term when Plain English is on. */
  plain: string;
  /** The tooltip, always available. */
  tip: string;
}

export const GLOSSARY: Record<string, GlossaryEntry> = {
  OTE: {
    plain: "best entry zone",
    tip: "Optimal Trade Entry — the 62–79% pullback of the move, where an entry is cheapest.",
  },
  BSL: {
    plain: "buy stops above highs",
    tip: "Buy-side liquidity — buy stops resting above a high (PDH, session high, equal highs).",
  },
  SSL: {
    plain: "sell stops below lows",
    tip: "Sell-side liquidity — sell stops resting below a low (PDL, session low, equal lows).",
  },
  PDH: { plain: "yesterday's high", tip: "Previous Day High." },
  PDL: { plain: "yesterday's low", tip: "Previous Day Low." },
  PWH: { plain: "last week's high", tip: "Previous Week High." },
  PWL: { plain: "last week's low", tip: "Previous Week Low." },
  SMT: {
    plain: "NQ/ES divergence",
    tip: "Smart Money Technique — one index makes a new high/low and the other does not.",
  },
  CE: {
    plain: "middle of the entry zone",
    tip: "Consequent Encroachment — the 50% line of the entry array, where the limit rests.",
  },
  KZ: {
    plain: "trading window",
    tip: "Killzone — the London / NY AM / NY PM sessions where moves deliver.",
  },
  PATH: {
    plain: "trade-quality band",
    tip: "The desk's two-axis grade (A+ / A / A− trade, B+ paper, below journal only).",
  },
  HTF: {
    plain: "higher timeframe",
    tip: "Higher timeframe — the daily/4h read that sets the allowed direction.",
  },
  LTF: {
    plain: "lower timeframe",
    tip: "Lower timeframe — the 5m/1m read that confirms the turn.",
  },
  MSS: {
    plain: "structure shift",
    tip: "Market Structure Shift — the first break against the prior leg after a raid.",
  },
  BOS: { plain: "break of structure", tip: "Break of Structure — continuation through a swing." },
  CHoCH: {
    plain: "change of character",
    tip: "Change of Character — the first sign the trend is turning.",
  },
  CISD: {
    plain: "change in delivery",
    tip: "Change in State of Delivery — price starts delivering the other way.",
  },
  FVG: {
    plain: "price gap",
    tip: "Fair Value Gap — a three-candle imbalance price tends to revisit.",
  },
  IFVG: {
    plain: "flipped price gap",
    tip: "Inverse FVG — a gap price closed through, now acting the other way.",
  },
  OB: { plain: "order block", tip: "Order Block — the last opposite candle before the move." },
  DOL: {
    plain: "where price is headed",
    tip: "Draw On Liquidity — the pool price is most likely to reach next.",
  },
  ERL: {
    plain: "range-edge liquidity",
    tip: "External Range Liquidity — the highs/lows outside the dealing range.",
  },
  IRL: {
    plain: "in-range liquidity",
    tip: "Internal Range Liquidity — gaps and swings inside the dealing range.",
  },
  EQ: {
    plain: "middle of the range",
    tip: "Equilibrium — 50% of the dealing range; above is premium, below is discount.",
  },
  ATR: {
    plain: "average bar range",
    tip: "Average True Range (14) — the instrument's typical move per bar.",
  },
  T1: {
    plain: "first target",
    tip: "Target 1 — the nearest draw; half comes off here, stop to breakeven.",
  },
  T2: { plain: "second target", tip: "Target 2 — the range extreme; the runner's target." },
  Judas: {
    plain: "opening fake-out",
    tip: "Judas swing — the 9:30–9:45 ET raid that often runs the wrong way first.",
  },
};

const TERMS = Object.keys(GLOSSARY).sort((a, b) => b.length - a.length);
/** Whole-word, case-sensitive: "CE" never matches inside "CERT", "OB" never inside "OBV". */
export const TERM_RE = new RegExp(
  `(?<![A-Za-z0-9])(${TERMS.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})(?![A-Za-z0-9])`,
  "g",
);

/**
 * Swap every glossary term for its plain words. Numbers and everything else
 * pass through untouched.
 *
 * ONE PASS, NEVER RECURSIVE: the input is scanned once and a replacement is
 * never re-scanned, and no gloss contains a bracket — so "PDH (external BSL)"
 * reads "yesterday's high (external buy stops above highs)", never a
 * gloss nested inside a gloss. One short gloss per term.
 */
export function plainify(text: string): string {
  return text.replace(TERM_RE, (m) => GLOSSARY[m]?.plain ?? m);
}

/** Split text into plain runs and glossary terms, for rendering tooltips. */
export function splitTerms(text: string): { text: string; term: string | null }[] {
  const out: { text: string; term: string | null }[] = [];
  let last = 0;
  for (const m of text.matchAll(TERM_RE)) {
    const i = m.index ?? 0;
    if (i > last) out.push({ text: text.slice(last, i), term: null });
    out.push({ text: m[0], term: m[0] });
    last = i + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last), term: null });
  return out;
}

/* ── The preference (a tiny external store, SSR-safe) ───────────────────── */

const KEY = "ledger-plain-english-v1";
const listeners = new Set<() => void>();
let cached: boolean | null = null;

export function getPlainEnglish(): boolean {
  if (typeof window === "undefined") return false;
  if (cached == null) {
    try {
      cached = window.localStorage.getItem(KEY) === "1";
    } catch {
      cached = false;
    }
  }
  return cached;
}

export function setPlainEnglish(on: boolean): void {
  cached = on;
  try {
    window.localStorage.setItem(KEY, on ? "1" : "0");
  } catch {
    /* private mode — the toggle still works for this tab */
  }
  for (const l of listeners) l();
}

export function subscribePlainEnglish(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
