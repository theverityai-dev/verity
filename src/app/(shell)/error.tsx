"use client";

import Link from "next/link";
import { useEffect } from "react";
import { captureException } from "@sentry/nextjs";
import { Button } from "@/components/ui/primitives";

/**
 * A page under the shell failed. This sits inside the shell layout, so the
 * sidebar, search and profile stay where they were and the person can leave
 * for another screen; the root error page would have replaced all of it.
 */
export default function ShellError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    captureException(error);
  }, [error]);

  return (
    <section role="alert" className="mx-auto flex max-w-lg flex-col items-start gap-3 pt-16">
      <h1>This page could not load</h1>
      <p className="m-0 text-[15px] leading-[22px] text-text-secondary">
        Nothing was changed. Try again, or open another page from the menu. If it keeps happening, send support the reference below.
      </p>
      {error.digest && <p className="m-0 break-all text-[13px] text-text-tertiary">Reference: {error.digest}</p>}
      <div className="mt-2 flex items-center gap-3">
        <Button onClick={() => retry()}>Try again</Button>
        <Link href="/" className="text-[15px] text-accent-ink no-underline hover:underline">
          Back to home
        </Link>
      </div>
    </section>
  );
}
