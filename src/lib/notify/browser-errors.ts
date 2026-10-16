/**
 * Browser-side crash reporting for panel error boundaries.
 *
 * Gated on the public VITE_SENTRY_DSN. When it is unset this is a no-op and
 * @sentry/browser is never loaded. The SDK is imported lazily so it stays out
 * of the main bundle and cannot itself break first paint.
 */
type SentryBrowser = typeof import("@sentry/browser");

let loading: Promise<SentryBrowser | null> | null = null;

function dsn(): string | undefined {
  const v = (import.meta as { env?: Record<string, string | undefined> }).env?.VITE_SENTRY_DSN;
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

function sentry(): Promise<SentryBrowser | null> {
  const d = dsn();
  if (!d || typeof window === "undefined") return Promise.resolve(null);
  loading ??= import("@sentry/browser")
    .then((S) => {
      S.init({ dsn: d, sendDefaultPii: false, tracesSampleRate: 0 });
      return S;
    })
    .catch(() => null);
  return loading;
}

export function reportPanelError(panel: string, error: unknown, componentStack?: string): void {
  void sentry().then((S) => {
    if (!S) return;
    S.withScope((scope) => {
      scope.setTag("panel", panel);
      scope.setTag("surface", "now-tab");
      if (componentStack) scope.setContext("react", { componentStack });
      S.captureException(error);
    });
  });
}
