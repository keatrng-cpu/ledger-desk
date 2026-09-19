/**
 * Local email/password sign-in (this app's Better Auth DB — not the broker).
 *
 * ENABLED. Until 2026-09-19 this was `false` and there was no `/login` route,
 * which meant nobody could ever sign in — and because `authMiddleware` throws
 * `UnauthorizedError` when signed out, every single write to `desk_trades`
 * failed. That is why the journal sat at zero rows for the life of the app.
 * The desk rendered fine because reads fall back to local state; only the
 * persistence layer was dead, silently.
 *
 * Email/password rather than the Grok broker on purpose: the broker path
 * (`genericOAuth` → `GROK_AUTH_ISSUER`) depends on per-app credentials being
 * injected by the sandbox deployer. On this Netlify site they are not, so the
 * broker is not a route to a session here. A local password is.
 *
 * Server-only: this module is imported by `./server` and nothing else, so it
 * may read `process.env` freely.
 */

/** Master switch for local email/password. */
export const emailAndPasswordEnabled = true;

/**
 * Whether NEW accounts may be created.
 *
 * Open by default, because a closed default is unreachable: the first account
 * has to be creatable before there is anyone to close the door behind. This is
 * a single-trader desk, so the intended lifecycle is:
 *
 *   1. Deploy, open `/login`, create the one account.
 *   2. Set `AUTH_SIGNUP_OPEN=false` in the Netlify environment and redeploy.
 *   3. Sign-up is refused server-side from then on.
 *
 * Until step 2, a stranger who finds the URL can register. The blast radius is
 * bounded — every query is scoped by `user_id` and RLS is deny-all (migration
 * 0010), so a new account sees an empty desk and none of the trade record —
 * but it is still an open door on a public host, and the track record this app
 * now exists to produce is not something to leave beside one.
 */
export const signUpOpen = process.env.AUTH_SIGNUP_OPEN !== "false";

/**
 * The `emailAndPassword` block handed to Better Auth.
 *
 * 12 characters rather than Better Auth's default 8: this password is the only
 * thing standing in front of a trading journal that is meant to be evidential,
 * and there is exactly one person who has to remember it.
 */
export const emailAndPasswordOptions = {
  enabled: true,
  disableSignUp: !signUpOpen,
  minPasswordLength: 12,
  maxPasswordLength: 128,
} as const;
