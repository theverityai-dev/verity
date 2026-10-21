"use client";
import Link from "next/link";
import { useEffect } from "react";
import { captureException } from "@sentry/nextjs";

export default function ErrorPage({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => { captureException(error); }, [error]);
  return <section role="alert" className="mx-auto max-w-lg space-y-4 p-6 text-text-primary">
    <h1 className="text-xl font-medium">This page could not load</h1>
    <p className="text-text-secondary">Please try again. If the problem continues, contact support with the reference below.</p>
    {error.digest && <p className="break-all text-sm text-text-tertiary">Reference: {error.digest}</p>}
    <button onClick={retry} className="rounded-[10px] bg-accent px-4 py-3 font-semibold text-accent-on hover:bg-accent-hover focus-visible:outline-none focus-visible:shadow-[0_0_0_3px_var(--color-accent-subtle)]">Try again</button>
    <Link href="/" className="ml-4 underline">Back to home</Link>
  </section>;
}
