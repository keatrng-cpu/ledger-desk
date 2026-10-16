/**
 * Sentry error capture for the Netlify functions. DSN from env SENTRY_DSN; unset → every call is a no-op
 * and @sentry/node is never even loaded. beforeSend/beforeBreadcrumb run every event through the shared
 * scrubber so RH / Databento / Supabase keys, bearer tokens, DB URLs and account numbers never leave.
 */
import { scrubValue } from "./scrub";

type SentryLike = {
  init(o: Record<string, unknown>): void;
  captureException(e: unknown, ctx?: Record<string, unknown>): string;
  flush(ms?: number): Promise<boolean>;
};

/** Explicit key names we drop even if the generic pattern changes. */
export const SCRUB_KEYS = ["RH_USERNAME", "RH_PASSWORD", "RH_MFA", "RH_TOKEN", "ROBINHOOD_TOKEN", "DATABENTO_API_KEY", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_ANON_KEY", "SUPABASE_KEY", "DATABASE_URL", "CRON_SECRET", "WATCHER_STATUS_TOKEN", "SLACK_DESK_WEBHOOK_URL", "SENTRY_DSN"];

export function scrubSentryEvent<E extends Record<string, unknown>>(event: E, env?: Record<string, string | undefined>): E {
  const e = scrubValue(event, env) as E & { request?: Record<string, unknown> };
  if (e.request) { delete e.request.cookies; delete e.request.headers; delete e.request.data; }
  for (const k of SCRUB_KEYS) if (k in e) (e as Record<string, unknown>)[k] = "[redacted]";
  return e;
}

let sentry: SentryLike | null = null;
let tried = false;

export async function initSentry(loader: () => Promise<SentryLike> = async () => (await import("@sentry/node")) as unknown as SentryLike): Promise<boolean> {
  if (tried) return sentry != null;
  tried = true;
  const dsn = typeof process !== "undefined" ? process.env.SENTRY_DSN?.trim() : undefined;
  if (!dsn) return false;
  try {
    const S = await loader();
    S.init({
      dsn,
      environment: process.env.CONTEXT || process.env.NODE_ENV || "production",
      release: process.env.COMMIT_REF,
      sendDefaultPii: false,
      tracesSampleRate: 0,
      beforeSend: (ev: Record<string, unknown>) => scrubSentryEvent(ev),
      beforeBreadcrumb: (b: Record<string, unknown>) => scrubValue(b),
    });
    sentry = S;
    return true;
  } catch (err) {
    console.warn("[sentry] init failed (continuing without):", String(err).slice(0, 200));
    return false;
  }
}

/** Capture and flush (serverless: the instance may freeze right after the response). Never throws. */
export async function captureError(err: unknown, tags: Record<string, string> = {}): Promise<void> {
  if (!(await initSentry()) || !sentry) return;
  try { sentry.captureException(err, { tags }); await sentry.flush(2000); } catch { /* monitoring must never break the caller */ }
}

/** Test hook. */
export function _resetSentryForTest() { sentry = null; tried = false; }
