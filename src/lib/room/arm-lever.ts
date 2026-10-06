/**
 * Read-only arm lever display (Floor overhaul Chunk C item 29).
 * Presentation only — never wired to agentAgree / RH autofire / place.
 */
export interface ArmLeverSnap {
  autofireEnabled: boolean;
  liveArmed: boolean;
  confirmedInWriting: boolean;
  optionsSessionOpen: boolean;
  newsBlackout: boolean;
  riskHalt: boolean;
  oneBookBlocked: boolean;
}

export type ArmLeverPosition = "safe" | "armed" | "live";

/** Pure presentation of arm flags as a lever pose. Display only. */
export function armLeverDisplay(arms: ArmLeverSnap | null | undefined): {
  position: ArmLeverPosition;
  angleDeg: number;
  label: string;
  lines: string[];
  note: string;
} {
  const note = "Display only — not wired to agentAgree / RH autofire";
  if (!arms) {
    return { position: "safe", angleDeg: -35, label: "SAFE", lines: ["No arm snap yet"], note };
  }
  const lines = [
    `autofire ${arms.autofireEnabled ? "ON" : "off"}`,
    `live ${arms.liveArmed ? "ARMED" : "shut"}`,
    `confirmed ${arms.confirmedInWriting ? "yes" : "no"}`,
    `session ${arms.optionsSessionOpen ? "open" : "closed"}`,
    arms.newsBlackout ? "news blackout" : null,
    arms.riskHalt ? "risk halt" : null,
    arms.oneBookBlocked ? "one-book blocked" : null,
  ].filter(Boolean) as string[];

  if (arms.autofireEnabled && arms.liveArmed && arms.confirmedInWriting) {
    return { position: "live", angleDeg: 45, label: "LIVE (display)", lines, note };
  }
  if (arms.autofireEnabled || arms.liveArmed) {
    return { position: "armed", angleDeg: 10, label: "ARMED (display)", lines, note };
  }
  return { position: "safe", angleDeg: -35, label: "SAFE", lines, note };
}
