/**
 * What a speech engine would be handed for every line the floor can say, and what is wrong with it.
 *
 * Used by the verifiers that already produce the floor's lines (verify-live-talk, verify-race-talk, verify-invest-office,
 * verify-floor-voice), so the corpus is the one the real engines write, not a list someone typed.
 *
 *   const { spokenProblems } = await import("./lib/spoken-check.mjs");
 *   spokenProblems([{ character: "Jax", text: "..." }, ...])   // → [] when every line is fine
 *
 * A line fails when its spoken form: moves, drops or splits a number; drops a plus or minus; still carries a symbol an engine
 * reads wrongly ($ % − → · × ≥ … _ |); glues a unit or a letter to a digit (5s, 782C); keeps a code name (camelCase, a file);
 * keeps an unspelled ALL-CAPS abbreviation; runs past a breath without a break; or comes out empty, doubled or with "undefined".
 * A new abbreviation or symbol therefore fails here until somebody decides how it is said — which is the point.
 */
const { spokenForm, spokenDigest, digestOf, chunkSpoken, numbersHeld, signsHeld } = await import("../../src/lib/room/spoken-form.ts");

export const MAX_PIECE_WORDS = 34;

const SYMBOLS = /[$%¢Δ−→←↑↓▲▼≥≤≈±×·•…~^*_#@<>=|[\]{}`"“”\/]/;
const GLUED = /\d[A-Za-z]|[A-Za-z]\d/;
const ORDINAL = /\b\d+(?:st|nd|rd|th)\b/g;
const CAMEL = /\b[a-z]+[A-Z]/; // a code name (maxCashFrac); a brand (BlackRock) starts with a capital and is fine
const FILE = /\.(?:tsx?|mjs|cjs|jsx?|json|py|sql)\b/;
const CAPS = /\b[A-Z]{2,}\b/;
const JUNK = /undefined|NaN|\bnull\b|\[object/;
const PUNCT = /,\s*,|,\s*\.|\s[,.!?]|\.\s*\./;

/** `say` is what the floor says for a caption (the real digest by default); a test passes a broken one to prove the checker notices. */
export function spokenProblems(lines, { say = spokenDigest } = {}) {
  const out = [];
  for (const l of lines) {
    const raw = typeof l === "string" ? l : l.text;
    const who = typeof l === "string" ? "" : `${l.character}: `;
    // What the floor actually says: the digest of a long caption. Its numbers are the caption's numbers minus the removed asides.
    const spoken = say(raw);
    const kept = digestOf(raw);
    const bad = [];
    if (spoken !== spokenForm(raw) && !numbersHeld(kept, spoken)) bad.push("the digest moved a number");
    if (spoken !== spokenForm(raw) && !signsHeld(kept, spoken)) bad.push("the digest dropped a sign");
    if (!spoken && /[A-Za-z0-9]/.test(raw)) bad.push("spoken form is empty");
    const full = spokenForm(raw);
    if (!numbersHeld(raw, full)) bad.push("a number moved");
    if (!signsHeld(raw, full)) bad.push("a plus or minus was dropped");
    const sym = SYMBOLS.exec(spoken);
    if (sym) bad.push(`symbol "${sym[0]}" left in`);
    const glued = GLUED.exec(spoken.replace(ORDINAL, " "));
    if (glued) bad.push(`"${glued[0]}" glued letter and digit`);
    if (CAMEL.test(spoken)) bad.push("a camelCase code name left in");
    if (FILE.test(spoken)) bad.push("a file name left in");
    const caps = CAPS.exec(spoken);
    if (caps) bad.push(`"${caps[0]}" is an abbreviation nobody decided how to say`);
    if (JUNK.test(spoken)) bad.push("junk text");
    if (PUNCT.test(spoken)) bad.push("doubled or misplaced punctuation");
    for (const piece of chunkSpoken(spoken)) {
      const n = piece.split(/\s+/).filter(Boolean).length;
      if (n > MAX_PIECE_WORDS) bad.push(`a ${n}-word piece with no break`);
    }
    if (bad.length) out.push(`${who}${raw.slice(0, 90)} → ${[...new Set(bad)].join("; ")} | said: ${spoken.slice(0, 110)}`);
  }
  return out;
}
