/**
 * Alert vocabulary — shared by the server (send path), the cron endpoints and
 * the browser. Isomorphic: no Node imports, safe in the client bundle.
 */

/**
 * Every alert this desk can raise. The list is closed on purpose and mirrored
 * by a CHECK constraint in migrations/0007_alerts.sql — adding a kind in one
 * place and forgetting the other fails loudly at insert time rather than
 * silently accepting a typo'd kind that no dedupe key will ever match.
 *
 * The first four are ROADMAP B4. The `cron_*` three are B5's scheduled jobs,
 * which record a row whether or not a browser is subscribed.
 */
export const ALERT_KINDS = [
  "setup_armed",
  "halt_hit",
  "position_flattened",
  "news_blackout_15m",
  "cron_premarket_checklist",
  "cron_session_review",
  "cron_weekly_review",
] as const;

export type AlertKind = (typeof ALERT_KINDS)[number];

export function isAlertKind(v: unknown): v is AlertKind {
  return typeof v === "string" && (ALERT_KINDS as readonly string[]).includes(v);
}

/** Human label per kind — used in the notification and the review list. */
export const ALERT_LABELS: Record<AlertKind, string> = {
  setup_armed: "Setup armed",
  halt_hit: "Halt hit",
  position_flattened: "Position auto-flattened",
  news_blackout_15m: "News blackout in 15 min",
  cron_premarket_checklist: "Premarket checklist",
  cron_session_review: "Session review",
  cron_weekly_review: "Weekly review",
};

/**
 * Urgency, mapped to the Web Push `Urgency` header. `high` asks the push
 * service to wake a dozing device now; `normal` lets it batch. A setup arming
 * is worthless five minutes late, a weekly review is not.
 */
export const ALERT_URGENCY: Record<AlertKind, "normal" | "high"> = {
  setup_armed: "high",
  halt_hit: "high",
  position_flattened: "high",
  news_blackout_15m: "high",
  cron_premarket_checklist: "normal",
  cron_session_review: "normal",
  cron_weekly_review: "normal",
};

/** What the service worker receives as the push payload (JSON). */
export interface AlertNotification {
  kind: AlertKind;
  title: string;
  body: string;
  /** Deep link opened by notificationclick. Same-origin path only. */
  url: string;
  /** Groups replaceable notifications so a re-fire updates instead of stacking. */
  tag: string;
  ts: string;
}

/** One row of alert_log, as returned to the UI. */
export interface AlertRecord {
  id: number;
  kind: AlertKind;
  dedupeKey: string;
  title: string;
  body: string | null;
  delivered: number;
  createdAt: string;
}
