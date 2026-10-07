/**
 * ONE STATE VOCABULARY on screen.
 *
 * The desk's engines each keep their own verdict values — the board says
 * TAKE/STAND/MANAGE, the Synapse and the Veteran brain say STAND_DOWN/SKIP/
 * WATCH/REDUCE/TAKE, the options sleeve says ARMED_CALL/ARMED_PUT/WATCH/
 * STAND_DOWN. Those values are unchanged and still drive everything. This is
 * a DISPLAY layer only: it prints the entry-state words the Now hero uses
 * (WAIT · STALKING · HALF SIZE · TRIM · ARMED · ENTER · IN TRADE · MANAGING) and keeps the raw
 * value in the tooltip, so the header, Floor and Synapse can never read
 * "WAIT" / "STAND" / "STAND_DOWN" for the same moment.
 */
export type DisplayWord = "WAIT" | "STALKING" | "HALF SIZE" | "TRIM" | "ARMED" | "ENTER" | "IN TRADE" | "MANAGING";

export const WORD_COLOR: Record<DisplayWord, string> = {
  WAIT: "#8b8b94",
  STALKING: "var(--color-warn)",
  "HALF SIZE": "var(--color-warn)",
  TRIM: "var(--color-warn)",
  ARMED: "var(--color-primary)",
  ENTER: "#4ade80",
  "IN TRADE": "#22c55e",
  MANAGING: "#22c55e",
};

/**
 * Raw engine value → display word. Anything not listed reads WAIT (the
 * conservative word), never a stronger one.
 *
 *   STAND · STAND_DOWN · STAND ASIDE · SKIP · FLAT · HOLD · NONE → WAIT
 *   WATCH · STALK*                                               → STALKING
 *   REDUCE · HALF_SIZE                                           → HALF SIZE  (brain: take at half size)
 *   TRIM                                                         → TRIM       (overnight/invest exit — not half size)
 *   ARMED · ARMED_CALL · ARMED_PUT                               → ARMED
 *   TAKE · GO · ENTER                                            → ENTER
 *   MANAGE · MANAGING                                            → MANAGING
 *   OPEN · IN TRADE · IN_TRADE                                   → IN TRADE
 */
export function displayWord(raw: string | null | undefined): DisplayWord {
  const v = String(raw ?? "")
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_");
  if (!v) return "WAIT";
  if (v === "TAKE" || v === "GO" || v === "ENTER") return "ENTER";
  if (v.startsWith("ARMED")) return "ARMED";
  // REDUCE means "take it at half size" (veteran-brain) — never STALKING
  // (hero STALKING = not armed yet). Show the reduced size honestly.
  // TRIM is an overnight/invest exit word — not half size.
  if (v === "REDUCE" || v === "HALF_SIZE") return "HALF SIZE";
  if (v === "TRIM") return "TRIM";
  if (v === "WATCH" || v.startsWith("STALK")) return "STALKING";
  if (v === "MANAGE" || v === "MANAGING") return "MANAGING";
  if (v === "OPEN" || v === "IN_TRADE") return "IN TRADE";
  return "WAIT";
}

/** "WAIT" plus, when the engine's own word differs, the raw value for the tooltip. */
export function wordTitle(raw: string | null | undefined): string {
  const w = displayWord(raw);
  const r = String(raw ?? "").trim();
  return r && r.toUpperCase() !== w ? `${w} — engine value: ${r}` : w;
}

/**
 * Engine prose often LEADS with its verdict ("STAND DOWN — selectivity is the
 * edge", "STAND_DOWN · …"). Swap only that leading verdict token for the
 * display word; the rest of the sentence is the engine's, untouched.
 */
export function displayLead(text: string): string {
  return text.replace(
    /^(STAND[_ ]DOWN|STAND ASIDE|STAND|SKIP|WATCH|REDUCE|TAKE|MANAGE|ARMED_CALL|ARMED_PUT)\b/,
    (m) => displayWord(m),
  );
}
