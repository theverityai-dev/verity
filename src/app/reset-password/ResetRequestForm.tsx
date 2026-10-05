"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Button, Field, Input } from "@/components/ui/primitives";
import { Icon } from "@/components/ui/icons";
import { requestPasswordReset } from "@/server/actions/platform";

export function ResetRequestForm() {
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [pending, startTransition] = useTransition();

  if (sent) {
    return (
      <div className="flex flex-col gap-5">
        <p role="status" className="m-0 rounded-[12px] bg-surface px-4 py-3 text-[14px] leading-relaxed text-text">
          If that email has a Verity login, a reset link is on its way. It expires in an hour — open it on this device.
        </p>
        <Link href="/sign-in" className="self-start text-[13px] text-accent-ink no-underline hover:underline">
          Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <form
      className="flex flex-col gap-5"
      action={(formData) => {
        setError(null);
        startTransition(async () => {
          const result = await requestPasswordReset(formData);
          if (result.ok) setSent(true);
          else setError(result.message);
        });
      }}
    >
      {error && (
        <p role="alert" className="m-0 flex items-start gap-2 rounded-md border border-danger/25 bg-danger-subtle px-3 py-2.5 text-[13px] text-danger">
          <span aria-hidden="true" className="mt-px leading-none">×</span>
          {error}
        </p>
      )}
      <Field label="Email" htmlFor="email" required>
        <div className="relative">
          <Icon name="mail" size={17} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-text-tertiary" />
          <Input id="email" name="email" type="email" autoComplete="email" required autoFocus placeholder="you@company.com" className="pl-11" />
        </div>
      </Field>
      <Button type="submit" variant="primary" disabled={pending} className="mt-1 w-full gap-2">
        {pending ? "Sending…" : "Send reset link"}
        {!pending && <Icon name="chevronRight" size={16} />}
      </Button>
      <Link href="/sign-in" className="self-center text-[13px] text-text-secondary no-underline hover:underline">
        Back to sign in
      </Link>
    </form>
  );
}
