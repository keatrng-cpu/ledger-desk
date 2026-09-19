/**
 * The canon — what the named educators actually say, attributed and graded.
 *
 * WHY A SEPARATE LAYER
 * The curriculum teaches what THIS DESK does, with every threshold imported
 * from the engine. That is the right thing to train on, but it is not the
 * same as what ICT, TJR or PB Trading teach, and a trader who cannot tell the
 * two apart will one day "correct" the desk toward a half-remembered video.
 * So the sources sit beside the rule, not inside it: each claim names who
 * said it, where, and how well that could be verified.
 *
 * STATUS IS THE POINT
 *   verified    — the source's own words were read (video, post, course page)
 *   paraphrase  — a faithful secondary write-up, or a consensus of students
 *   unverified  — widely repeated, could not be traced to the source
 *   contested   — the source says different things in different places
 *
 * A claim marked unverified is still worth showing, because the trader will
 * meet it in the wild — but it must never be shown as if it were the first
 * kind. Grading is done once, by research, and recorded here; it is not
 * re-derived at render time.
 *
 * Nothing in this file changes a gate. `desk` fields describe what the code
 * does so the trader can see where the desk follows a source and where it
 * deliberately does not.
 */

export type CanonSource = "ICT" | "TJR" | "PB" | "SMC" | "Evidence";
export type CanonStatus = "verified" | "paraphrase" | "unverified" | "contested";

export interface CanonClaim {
  who: CanonSource;
  /** The claim, as close to the source's own framing as the research allowed. */
  says: string;
  /** Where — a video/lesson title, a post, a course page. Short. */
  ref?: string;
  status: CanonStatus;
}

export interface CanonBlock {
  /** Module id this block attaches to. */
  moduleId: string;
  claims: CanonClaim[];
  /** Where the sources agree — one or two sentences. */
  consensus?: string;
  /** Where they disagree, and which side the desk takes and why. */
  conflict?: string;
  /**
   * What is actually validated versus asserted. This is the sentence most
   * courses leave out, so it is required on every block that makes a
   * mechanical claim.
   */
  evidence: string;
}

/**
 * Populated from the 2026-09-19 research pass (three sourced briefs: ICT
 * primary definitions; TJR + PB Trading models; cross-educator consensus and
 * published evidence). Edit here only with a source in hand.
 */
export const CANON: CanonBlock[] = [];

export function canonFor(moduleId: string): CanonBlock | null {
  return CANON.find((c) => c.moduleId === moduleId) ?? null;
}

/** Sources referenced anywhere, for the tab's footer. */
export function canonSources(): { who: CanonSource; label: string }[] {
  return [
    { who: "ICT", label: "Michael J. Huddleston — Inner Circle Trader (YouTube mentorship series, X)" },
    { who: "TJR", label: "Tyler Riches — TJR Trades (YouTube, X)" },
    { who: "PB", label: "PB Trading — Patty, Blake, Ronan (YouTube, course material)" },
    { who: "SMC", label: "Community SMC — the streamlined ICT vocabulary (BOS/CHoCH, OB, FVG)" },
    { who: "Evidence", label: "Published research and independent backtests, where any exist" },
  ];
}
