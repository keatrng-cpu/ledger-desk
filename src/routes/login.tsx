/**
 * Sign-in / sign-up — the route `gates.tsx` has always pointed at and that
 * never existed.
 *
 * This is not a cosmetic gap. `authMiddleware` throws when signed out, and
 * `openTrade`/`closeTrade` sit behind it, so with no way to sign in every
 * write to `desk_trades` failed. The desk still rendered — reads fall back to
 * local state — so the failure was invisible from the UI while the journal
 * stayed permanently empty.
 *
 * Deliberately plain. This page is seen once and then not again for months;
 * the design effort belongs on the desk, not here. What it does owe the
 * trader is honesty about failures, because a silent auth failure is what
 * caused the problem in the first place.
 */

import { useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { authClient } from "@/lib/auth/client";
import { useCurrentUserState } from "@/lib/auth/use-current-user";

export const Route = createFileRoute("/login")({
  component: LoginPage,
});

type Mode = "sign-in" | "sign-up";

function LoginPage() {
  const navigate = useNavigate();
  const { user, isPending } = useCurrentUserState();
  const [mode, setMode] = useState<Mode>("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Already signed in: say so rather than showing a form that will confuse.
  if (!isPending && user) {
    return (
      <Shell>
        <p className="text-sm text-[var(--color-muted)]">
          Signed in as{" "}
          <span className="text-[var(--color-fg)]">
            {user.primaryEmail ?? user.displayName ?? user.id}
          </span>
          .
        </p>
        <Link
          to="/"
          className="mt-4 inline-flex h-10 items-center justify-center rounded-[var(--radius-md)] bg-[var(--color-primary)] px-4 text-sm font-medium text-[var(--color-primary-fg)]"
        >
          Go to the desk
        </Link>
      </Shell>
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res =
        mode === "sign-in"
          ? await authClient.signIn.email({ email, password })
          : await authClient.signUp.email({
              email,
              password,
              name: name || email.split("@")[0] || "Trader",
            });
      if (res.error) {
        // Surface the server's own words. A generic "something went wrong"
        // here is exactly how the original failure stayed hidden for months.
        const msg = res.error.message ?? "Sign-in failed";
        setError(
          /sign.?up/i.test(msg) && /disabled|not allowed/i.test(msg)
            ? "Sign-up is closed on this deployment. Set AUTH_SIGNUP_OPEN=true and redeploy to create the first account."
            : msg,
        );
        return;
      }
      await navigate({ to: "/" });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const isSignUp = mode === "sign-up";

  return (
    <Shell>
      <form onSubmit={submit} className="flex flex-col gap-3">
        {isSignUp && (
          <Field
            label="Name"
            type="text"
            value={name}
            onChange={setName}
            autoComplete="name"
            placeholder="Optional"
          />
        )}
        <Field
          label="Email"
          type="email"
          value={email}
          onChange={setEmail}
          autoComplete="email"
          required
        />
        <Field
          label="Password"
          type="password"
          value={password}
          onChange={setPassword}
          autoComplete={isSignUp ? "new-password" : "current-password"}
          required
          hint={isSignUp ? "12 characters minimum." : undefined}
        />

        {error && (
          <p
            role="alert"
            className="rounded-[var(--radius-sm)] border border-[var(--color-down)] bg-[color-mix(in_oklab,var(--color-down)_12%,transparent)] px-3 py-2 text-sm text-[var(--color-down)]"
          >
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={busy || !email || !password}
          className="mt-1 inline-flex h-10 items-center justify-center rounded-[var(--radius-md)] bg-[var(--color-primary)] px-4 text-sm font-medium text-[var(--color-primary-fg)] disabled:opacity-50"
        >
          {busy ? "…" : isSignUp ? "Create account" : "Sign in"}
        </button>

        <button
          type="button"
          onClick={() => {
            setMode(isSignUp ? "sign-in" : "sign-up");
            setError(null);
          }}
          className="text-sm text-[var(--color-muted)] underline-offset-4 hover:underline"
        >
          {isSignUp ? "Have an account? Sign in" : "First time? Create the account"}
        </button>
      </form>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="grid min-h-dvh place-items-center bg-[var(--color-bg)] px-4">
      <div className="panel w-full max-w-sm p-6">
        <h1 className="text-lg font-semibold tracking-tight">Ledger Desk</h1>
        <p className="mb-5 mt-1 text-sm text-[var(--color-muted)]">
          Sign in to persist the trade journal.
        </p>
        {children}
      </div>
    </main>
  );
}

function Field({
  label,
  type,
  value,
  onChange,
  autoComplete,
  required,
  placeholder,
  hint,
}: {
  label: string;
  type: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete?: string;
  required?: boolean;
  placeholder?: string;
  hint?: string;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-[var(--color-muted)]">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete}
        required={required}
        placeholder={placeholder}
        className="h-10 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 text-sm text-[var(--color-fg)] outline-none focus:border-[var(--color-primary)]"
      />
      {hint && <span className="text-xs text-[var(--color-subtle)]">{hint}</span>}
    </label>
  );
}
