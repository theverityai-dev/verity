"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Button, Field, Input } from "@/components/ui/primitives";
import { Icon } from "@/components/ui/icons";
import { signInWithPassword } from "@/server/actions/platform";

/**
 * Sign-in.
 *
 * The form posts to a server action; there is no client-side auth call and no
 * credential ever reaches component state beyond the input itself. The whole
 * `FormData` is handed across unchanged, which also keeps the password out of
 * Next's server-action log — see `signInWithPassword`.
 *
 * A failure returns a deliberately uniform message, because distinguishing
 * "no such account" from "wrong password" is an account-enumeration oracle.
 *
 * Icon-prefixed fields and the password visibility toggle are visual only —
 * the reference board's own composition — and touch nothing about how the
 * form submits.
 */
export function SignInForm({ returnTo = "/" }: { returnTo?: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [showPassword, setShowPassword] = useState(false);

  return (
    <form
      className="flex flex-col gap-5"
      action={(formData) => {
        setError(null);
        startTransition(async () => {
          const failure = await signInWithPassword(formData);
          // A successful sign-in redirects and never returns.
          if (failure) setError(failure.message);
        });
      }}
    >
      {/* Inline and quiet, rather than a full ErrorState panel. A failed
          password is an ordinary event on this screen, not a system fault, and
          a red block shouting at someone who mistyped is the wrong register.
          role="alert" so it is still announced. */}
      {error && (
        <p
          role="alert"
          className="m-0 flex items-start gap-2 rounded-md border border-danger/25 bg-danger-subtle px-3 py-2.5 text-[13px] text-danger"
        >
          <span aria-hidden="true" className="mt-px leading-none">
            ×
          </span>
          {error}
        </p>
      )}

      <input type="hidden" name="returnTo" value={returnTo} />
      <Field label="Email" htmlFor="email" required>
        <div className="relative">
          <Icon
            name="mail"
            size={17}
            className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-text-tertiary"
          />
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            autoFocus
            placeholder="you@company.com"
            className="pl-11"
          />
        </div>
      </Field>

      <Field label="Password" htmlFor="password" required>
        <div className="relative">
          <Icon
            name="lock"
            size={17}
            className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-text-tertiary"
          />
          <Input
            id="password"
            name="password"
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            required
            placeholder="Enter your password"
            className="pl-11 pr-11"
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            className="absolute right-3.5 top-1/2 -translate-y-1/2 cursor-pointer text-text-tertiary transition-colors hover:text-text-secondary"
          >
            <Icon name={showPassword ? "eyeOff" : "eye"} size={17} />
            <span className="sr-only">{showPassword ? "Hide password" : "Show password"}</span>
          </button>
        </div>
      </Field>

      <Link
        href="/reset-password"
        className="-mt-2.5 self-end text-[13px] text-accent-ink no-underline hover:underline"
      >
        Forgot password?
      </Link>

      <Button type="submit" variant="primary" disabled={pending} className="mt-1 w-full gap-2">
        {pending ? "Signing in…" : "Sign in"}
        {!pending && <Icon name="chevronRight" size={16} />}
      </Button>
    </form>
  );
}
