/**
 * Floor command center — tab ids the cards / drawer know about.
 * Display only; never places or arms.
 */

export type CommandTabId =
  | "news"
  | "swing"
  | "tape"
  | "brain"
  | "predict"
  | "path"
  | "lab"
  | "discuss"
  | "learn";

export interface CommandCardDef {
  id: CommandTabId;
  label: string;
  /** Route id for ledger:open-tab (same as CATEGORIES in index.tsx). */
  openTab: CommandTabId;
}

export const COMMAND_CARDS: readonly CommandCardDef[] = [
  { id: "news", label: "News", openTab: "news" },
  { id: "swing", label: "Options", openTab: "swing" },
  { id: "tape", label: "Charts", openTab: "tape" },
  { id: "brain", label: "Brain", openTab: "brain" },
  { id: "predict", label: "Predict", openTab: "predict" },
  { id: "path", label: "Book", openTab: "path" },
  { id: "lab", label: "Lab", openTab: "lab" },
  { id: "discuss", label: "Discuss", openTab: "discuss" },
  { id: "learn", label: "Learn", openTab: "learn" },
] as const;

export type CardStatus = "live" | "empty" | "offline" | "stale" | "loading" | "unknown";

export interface CardRead {
  status: CardStatus;
  /** One-line primary read. */
  primary: string;
  /** Optional secondary lines (headlines, levels, etc.). */
  lines?: string[];
  /** Small chips (impact, grade). */
  chips?: { label: string; tone?: "up" | "down" | "warn" | "muted" }[];
  title?: string;
}
